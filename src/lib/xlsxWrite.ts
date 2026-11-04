// Writes Excel workbooks (.xlsx) in the browser, with nothing but plain code: a zip (stored, not compressed) of the
// XML files Excel expects. Used for the migration workbook (one sheet per step, a bold frozen header, drop-down lists
// of allowed values) and the Excel reports (a totals row of formulas, native charts); right-to-left sheets for Arabic.

/** A formula with its value already worked out (Excel shows the value until it recalculates). */
export interface FormulaCell { f: string; v?: number }
export type XCell = string | number | FormulaCell

/** A native Excel chart drawn from a block of this sheet: labels in one column, numbers in another. */
export interface XChart {
  type: 'bar' | 'hbar' | 'line' | 'pie'
  title: string
  /** 0-based columns of the labels and of the numbers, and the 0-based rows they run over */
  catCol: number
  valCol: number
  firstRow: number
  lastRow: number
  /** where it is drawn: 0-based top-left cell, and its size in columns and rows */
  at: { col: number; row: number; cols: number; rows: number }
  /** hex colour without # */
  color?: string
}

export interface SheetSpec {
  name: string
  /** text, numbers (stored as numbers, so Excel can add them up) or formulas */
  rows: XCell[][]
  /** 0-based rows shown in bold with a line above (a totals row) */
  boldRows?: number[]
  /** native charts drawn on the sheet */
  charts?: XChart[]
  /** column widths in characters */
  widths?: number[]
  /** the first row is a header: bold and frozen */
  header?: boolean
  rtl?: boolean
  hidden?: boolean
  /** drop-down lists: a column (0-based) whose cells below the header must be one of the values in `source` (a range such as Lists!$A$2:$A$9) */
  lists?: { col: number; source: string }[]
}

/* ---------------- zip ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of files) {
    const data = enc.encode(text)
    const n = enc.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + n.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // file names in UTF-8
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, n.length, true)
    local.set(n, 30)
    const c = new Uint8Array(46 + n.length)
    const cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, n.length, true)
    cv.setUint32(42, offset, true)
    c.set(n, 46)
    parts.push(local, data)
    central.push(c)
    offset += local.length + data.length
  }
  const size = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22)
  let p = 0
  for (const part of [...parts, ...central, end]) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/* ---------------- XML ---------------- */

/** Control characters (other than tab and line breaks) are not allowed in XML: they are left out. */
const printable = (s: string) => [...s].filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13 }).join('')
const esc = (s: string) =>
  printable(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A sheet name Excel accepts: at most 31 characters, none of : \ / ? * [ ], and unique in the workbook. */
export function sheetName(name: string, taken: Set<string>) {
  const base = (name.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Sheet').slice(0, 31)
  let out = base
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`
  taken.add(out.toLowerCase())
  return out
}

/** A cell reference such as $B$2, for formulas and charts. */
export const cellRef = (col: number, row: number) => `$${colName(col)}$${row + 1}`
/** A 1-based-row range in A1 form (B2:B40) for formulas. */
export const rangeA1 = (col: number, fromRow: number, toRow: number) => `${colName(col)}${fromRow + 1}:${colName(col)}${toRow + 1}`
const quoted = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`

function cellXml(v: XCell, ref: string, style: string) {
  if (v === '') return style ? `<c r="${ref}"${style}/>` : ''
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${style}><v>${v}</v></c>` : ''
  if (typeof v === 'object') return `<c r="${ref}"${style}><f>${esc(v.f)}</f>${v.v !== undefined && Number.isFinite(v.v) ? `<v>${v.v}</v>` : ''}</c>`
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`
}

function sheetXml(s: SheetSpec, drawing: boolean) {
  const width = Math.max(1, ...s.rows.map((r) => r.length))
  const cols = Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.widths?.[i] ?? 18}" customWidth="1"/>`).join('')
  const bold = new Set(s.boldRows ?? [])
  const rows = s.rows.map((r, ri) => {
    const style = s.header && ri === 0 ? ' s="1"' : bold.has(ri) ? ' s="2"' : ''
    const cells = bold.has(ri) ? Array.from({ length: width }, (_, ci) => r[ci] ?? '') : r
    return `<row r="${ri + 1}">${cells.map((v, ci) => cellXml(v, `${colName(ci)}${ri + 1}`, typeof v === 'string' || bold.has(ri) ? style : '')).join('')}</row>`
  }).join('')
  const pane = s.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''
  const lists = s.lists?.length
    ? `<dataValidations count="${s.lists.length}">${s.lists.map((l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${colName(l.col)}2:${colName(l.col)}5000"><formula1>${esc(l.source)}</formula1></dataValidation>`).join('')}</dataValidations>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${s.rtl ? ' rightToLeft="1"' : ''}>${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData>${lists}${drawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`
}

const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** One chart part: a single series from the sheet, with the values cached so it shows before Excel recalculates. */
function chartXml(s: SheetSpec, ch: XChart) {
  const sh = quoted(s.name)
  const n = ch.lastRow - ch.firstRow + 1
  const cell = (col: number, row: number) => s.rows[row]?.[col]
  const cats = Array.from({ length: n }, (_, i) => `<c:pt idx="${i}"><c:v>${esc(String(cell(ch.catCol, ch.firstRow + i) ?? ''))}</c:v></c:pt>`).join('')
  const vals = Array.from({ length: n }, (_, i) => { const v = cell(ch.valCol, ch.firstRow + i); return typeof v === 'number' ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '' }).join('')
  const color = (ch.color ?? '0B6E70').replace('#', '')
  const head = ch.firstRow > 0 ? cell(ch.valCol, ch.firstRow - 1) : undefined
  const tx = ch.firstRow > 0 ? `<c:tx><c:strRef><c:f>${sh}!${cellRef(ch.valCol, ch.firstRow - 1)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(String(head ?? ''))}</c:v></c:pt></c:strCache></c:strRef></c:tx>` : ''
  const catRef = `<c:cat><c:strRef><c:f>${sh}!${cellRef(ch.catCol, ch.firstRow)}:${cellRef(ch.catCol, ch.lastRow)}</c:f><c:strCache><c:ptCount val="${n}"/>${cats}</c:strCache></c:strRef></c:cat>`
  const valRef = `<c:val><c:numRef><c:f>${sh}!${cellRef(ch.valCol, ch.firstRow)}:${cellRef(ch.valCol, ch.lastRow)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${vals}</c:numCache></c:numRef></c:val>`
  const fill = `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`
  const axes = (bar: boolean, horizontal: boolean) => `<c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 't' : 'l'}"/><c:majorGridlines/><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="1001"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="${bar ? 'between' : 'midCat'}"/></c:valAx>`
  let plot: string
  if (ch.type === 'pie') {
    plot = `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>${catRef}${valRef}</c:ser><c:firstSliceAng val="0"/></c:pieChart>`
  } else if (ch.type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${catRef}${valRef}<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="1001"/><c:axId val="1002"/></c:lineChart>${axes(false, false)}`
  } else {
    const h = ch.type === 'hbar'
    plot = `<c:barChart><c:barDir val="${h ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}${fill}<c:invertIfNegative val="0"/>${catRef}${valRef}</c:ser><c:gapWidth val="60"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>${axes(true, h)}`
  }
  const legend = ch.type === 'pie' ? '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>' : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace ${C_NS}><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
}

/** The drawing that places a sheet's charts; chart k of the sheet is relationship rId(k+1). */
function drawingXml(charts: XChart[]) {
  const anchor = (ch: XChart, i: number) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${ch.at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${ch.at.col + ch.at.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.row + ch.at.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${charts.map(anchor).join('')}</xdr:wsDr>`
}

/** An .xlsx file of the sheets given, ready to download. */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  // drawings (one per sheet with charts) and charts (numbered across the workbook)
  const parts: [string, string][] = []
  const overrides: string[] = []
  let drawingNo = 0
  let chartNo = 0
  const hasDrawing = sheets.map((s, i) => {
    if (!s.charts?.length) return false
    const d = ++drawingNo
    const rels: string[] = []
    s.charts.forEach((ch, k) => {
      const c = ++chartNo
      parts.push([`xl/charts/chart${c}.xml`, chartXml(s, ch)])
      overrides.push(`<Override PartName="/xl/charts/chart${c}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
      rels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${c}.xml"/>`)
    })
    parts.push([`xl/drawings/drawing${d}.xml`, drawingXml(s.charts)])
    parts.push([`xl/drawings/_rels/drawing${d}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`])
    parts.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`])
    overrides.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)
    return true
  })
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${overrides.join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/></patternFill></fill></fills><borders count="2"><border/><border><left/><right/><top style="medium"><color rgb="FF333333"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="1" borderId="1" applyFont="1" applyBorder="1"/></cellXfs></styleSheet>`],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, hasDrawing[i])]),
    ...parts,
  ]
  return zip(files)
}
