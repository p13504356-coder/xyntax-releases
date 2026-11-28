/* XYNTAX — a small .xlsx reader (4.20). Reads the first worksheet of an Office Open XML workbook into rows of strings, with no
 * library: the ZIP container is parsed from its central directory, stored entries are copied and deflated ones inflated with
 * DecompressionStream("deflate-raw") in the browser or zlib in Node; shared strings, inline strings, numbers, booleans, formula
 * results and dates (number formats → serials → ISO dates, the 1904 epoch honoured) are read from the XML with a tolerant scanner.
 *   XLSXREAD.rows(file | Blob | ArrayBuffer | Uint8Array | Buffer, { sheet })  → Promise<string[][]>   (empty cells are "")
 *   XLSXREAD.isXlsx(bytes)                                                      → true when the bytes start a ZIP container
 *   XLSXREAD.serialToIso(n, date1904)                                           → "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"
 * Rows keep their position (row 3 of the sheet is rows[2]); trailing empty rows are dropped. Used for bank statements kept as
 * Excel files: BANKFEEDS.fromXlsx(rows) turns them into statement lines. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XLSXREAD = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNode = typeof process !== "undefined" && process.versions && process.versions.node && typeof require === "function";
  const td = new TextDecoder("utf-8");
  const u16 = (b, i) => b[i] | (b[i + 1] << 8), u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 16777216;
  const isXlsx = (b) => !!b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
  async function bytesOf(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && typeof input.arrayBuffer === "function") return new Uint8Array(await input.arrayBuffer());
    if (isNode && typeof Buffer !== "undefined" && Buffer.isBuffer(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new Error("Not a file");
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "function") { const ds = new DecompressionStream("deflate-raw"); const w = ds.writable.getWriter(); w.write(bytes); w.close(); const out = []; const rd = ds.readable.getReader(); let n = 0; for (;;) { const { value, done } = await rd.read(); if (done) break; out.push(value); n += value.length; } const all = new Uint8Array(n); let o = 0; for (const c of out) { all.set(c, o); o += c.length; } return all; }
    if (isNode) { const z = require("zlib"); const r = z.inflateRawSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); return new Uint8Array(r.buffer, r.byteOffset, r.byteLength); }
    throw new Error("This browser cannot inflate the workbook (no DecompressionStream)");
  }
  // the ZIP central directory → { name: { method, offset, csize, usize } }
  function directory(b) {
    let eocd = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) { if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { eocd = i; break; } }
    if (eocd < 0) throw new Error("Not a workbook (no ZIP directory)");
    const n = u16(b, eocd + 10); let p = u32(b, eocd + 16); const out = {};
    for (let k = 0; k < n && p + 46 <= b.length; k++) { if (!(b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 1 && b[p + 3] === 2)) break; const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24), nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42); const name = td.decode(b.subarray(p + 46, p + 46 + nl)); out[name] = { method, csize, usize, offset: off }; p += 46 + nl + el + cl; }
    return out;
  }
  async function entry(b, dir, name) {
    const e = dir[name]; if (!e) return null; const p = e.offset; if (!(b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 3 && b[p + 3] === 4)) throw new Error("Corrupt workbook entry " + name);
    const nl = u16(b, p + 26), el = u16(b, p + 28); const start = p + 30 + nl + el; const data = b.subarray(start, start + e.csize);
    if (e.method === 0) return data; if (e.method === 8) return inflateRaw(data); throw new Error("Unsupported compression in " + name);
  }
  const text = async (b, dir, name) => { const d = await entry(b, dir, name); return d ? td.decode(d) : null; };
  const unent = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => { const l = e.toLowerCase(); if (l === "amp") return "&"; if (l === "lt") return "<"; if (l === "gt") return ">"; if (l === "quot") return '"'; if (l === "apos") return "'"; if (l[0] === "#") return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10)); return m; });
  const attr = (tag, k) => { const m = new RegExp("\\s" + k + "=\"([^\"]*)\"").exec(tag) || new RegExp("\\s" + k + "='([^']*)'").exec(tag); return m ? m[1] : null; };
  // every <t> inside an element (rich text runs are joined); xml:space="preserve" keeps the blanks
  const tTexts = (xml) => { let out = ""; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g; let m; while ((m = re.exec(xml))) out += unent(m[1] || ""); return out; };
  function sharedStrings(xml) { const out = []; if (!xml) return out; const re = /<si>([\s\S]*?)<\/si>|<si\/>/g; let m; while ((m = re.exec(xml))) out.push(tTexts(m[1] || "")); return out; }
  // which cell styles are dates: built-in ids 14–22 and 45–47, or a custom format with day/month/year/hour codes (not currency text)
  function dateStyles(xml) { const set = new Set(); if (!xml) return set; const fmts = {}; const nf = /<numFmt\s[^>]*\/>/g; let m; while ((m = nf.exec(xml))) { const id = attr(m[0], "numFmtId"), code = unent(attr(m[0], "formatCode") || ""); if (id != null) fmts[id] = code; }
    const isDate = (id) => { const n = +id; if ((n >= 14 && n <= 22) || (n >= 45 && n <= 47)) return true; const c = fmts[id]; if (!c) return false; const s = c.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, ""); return /[dmyh]/i.test(s) && !/[#0]\.?[#0]*\s*%|General/i.test(s); };
    const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml); if (!xfs) return set; const xf = /<xf\s[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g; let i = 0; while ((m = xf.exec(xfs[1]))) { const id = attr(m[0], "numFmtId"); if (id != null && isDate(id)) set.add(i); i++; } return set; }
  function serialToIso(n, date1904) { n = +n; if (!isFinite(n)) return ""; let days = Math.floor(n); const frac = n - days; if (date1904) days += 1462; if (days >= 60) days -= 1; /* Lotus 1900 leap-year bug */ const ms = Date.UTC(1899, 11, 31) + days * 86400000; const d = new Date(ms); const iso = d.toISOString().slice(0, 10); if (frac > 1e-6) { const mins = Math.round(frac * 1440); const hh = String(Math.floor(mins / 60) % 24).padStart(2, "0"), mm = String(mins % 60).padStart(2, "0"); return iso + "T" + hh + ":" + mm; } return iso; }
  const colIndex = (ref) => { let n = 0; for (const ch of String(ref || "").replace(/\d+$/, "")) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64); return Math.max(0, n - 1); };
  function sheetRows(xml, sst, dates, date1904) {
    const rows = []; const put = (r, c, v) => { while (rows.length <= r) rows.push([]); const row = rows[r]; while (row.length <= c) row.push(""); row[c] = v; };
    const data = /<sheetData[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml); if (!data) return rows;
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g; let rm; let rowNo = 0;
    while ((rm = rowRe.exec(data[1]))) { const rAttr = attr("<row" + rm[1] + ">", "r"); const r = rAttr ? +rAttr - 1 : rowNo; rowNo = r + 1; let col = 0;
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm; while ((cm = cellRe.exec(rm[2]))) { const head = "<c" + cm[1] + ">"; const ref = attr(head, "r"); const c = ref ? colIndex(ref) : col; col = c + 1; const t = attr(head, "t") || "n"; const s = attr(head, "s"); const inner = cm[2] || ""; let v = "";
        if (t === "inlineStr") v = tTexts(inner);
        else { const vm = /<v>([\s\S]*?)<\/v>/.exec(inner); const raw = vm ? unent(vm[1]) : ""; if (t === "s") v = sst[+raw] != null ? sst[+raw] : ""; else if (t === "b") v = raw === "1" ? "TRUE" : "FALSE"; else if (t === "str" || t === "e") v = raw; else { v = raw; if (raw !== "" && s != null && dates.has(+s) && isFinite(+raw)) v = serialToIso(+raw, date1904); } }
        if (v !== "" || ref) put(r, c, v); } }
    while (rows.length && rows[rows.length - 1].every((x) => x === "")) rows.pop();
    const width = rows.reduce((k, r) => Math.max(k, r.length), 0); for (const r of rows) while (r.length < width) r.push("");
    return rows;
  }
  async function rows(input, opt) {
    opt = opt || {}; const b = await bytesOf(input); if (!isXlsx(b)) throw new Error("Not an .xlsx workbook"); const dir = directory(b);
    const wb = (await text(b, dir, "xl/workbook.xml")) || ""; const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/i.test(wb);
    let sheetPath = null; const rels = await text(b, dir, "xl/_rels/workbook.xml.rels"); const sheets = []; const sr = /<sheet\b[^>]*\/>/g; let m; while ((m = sr.exec(wb))) sheets.push({ name: unent(attr(m[0], "name") || ""), rid: attr(m[0], "r:id") || attr(m[0], "id"), sheetId: attr(m[0], "sheetId") });
    const want = opt.sheet != null ? (typeof opt.sheet === "number" ? sheets[opt.sheet] : sheets.find((s) => s.name === opt.sheet)) : sheets[0];
    if (want && rels) { const rr = new RegExp('<Relationship\\b[^>]*\\sId="' + want.rid + '"[^>]*/>').exec(rels); const tg = rr ? attr(rr[0], "Target") : null; if (tg) sheetPath = tg.startsWith("/") ? tg.slice(1) : "xl/" + tg.replace(/^\.\//, ""); }
    if (!sheetPath || !dir[sheetPath]) sheetPath = Object.keys(dir).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, c) => +a.replace(/\D/g, "") - +c.replace(/\D/g, ""))[0];
    if (!sheetPath) throw new Error("The workbook has no worksheet");
    const [sstXml, stylesXml, sheetXml] = await Promise.all([text(b, dir, "xl/sharedStrings.xml"), text(b, dir, "xl/styles.xml"), text(b, dir, sheetPath)]);
    return sheetRows(sheetXml || "", sharedStrings(sstXml), dateStyles(stylesXml), date1904);
  }
  return { rows, isXlsx, serialToIso, sheetNames: async (input) => { const b = await bytesOf(input); const dir = directory(b); const wb = (await text(b, dir, "xl/workbook.xml")) || ""; const out = []; const sr = /<sheet\b[^>]*\/>/g; let m; while ((m = sr.exec(wb))) out.push(unent(attr(m[0], "name") || "")); return out; } };
});
