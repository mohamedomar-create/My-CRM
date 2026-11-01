// Phase H1: Excel files are read in the browser. A workbook is built here the way Excel writes one (a zip of XML,
// some parts compressed), so the reader is tested on dates, shared and inline text, gaps between cells and formulas.
import { describe, expect, it } from 'vitest'
import { readXlsx } from './xlsx'

async function deflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A minimal zip writer (the reader doesn't check CRCs, so they are left at 0). */
async function zip(files: Record<string, string>, compress: string[]) {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text)
    const method = compress.includes(name) ? 8 : 0
    const data = method ? await deflate(raw) : raw
    const n = enc.encode(name)
    const local = new Uint8Array(30 + n.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, method, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true)
    local.set(n, 30); local.set(data, 30 + n.length)
    const central = new Uint8Array(46 + n.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, method, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true)
    central.set(n, 46)
    locals.push(local); centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let p = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length }
  return out
}

const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/><sheets><sheet name="العملاء" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`
const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
const strings = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
<si><t>Name</t></si><si><t>Joined</t></si><si><r><t>Nile </t></r><r><rPr><b/></rPr><t xml:space="preserve">Foods &amp; Co</t></r><rPh><t>ignore</t></rPh></si>
<si><t>شركة الدلتا</t></si><si><t>Line_x000A_break</t></si></sst>`
const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="[h]:mm"/></numFmts>
<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="4"/><xf numFmtId="165"/></cellXfs></styleSheet>`
const sheet1 = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Amount</t></is></c><c r="D1" t="inlineStr"><is><t>Phone</t></is></c><c r="E1" t="inlineStr"><is><t>VIP</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46000</v></c><c r="C2" s="3"><v>12500.5</v></c><c r="D2"><v>201001234567</v></c><c r="E2" t="b"><v>1</v></c></row>
<row r="3"/>
<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" s="2"><v>45658</v></c><c r="D4" t="str"><f>A4&amp;""</f><v>0122</v></c></row>
<row r="5"><c r="A5" t="s"><v>4</v></c><c r="C5"><v>0.1</v></c><c r="E5" s="4"><v>1.5</v></c></row>
</sheetData></worksheet>`
const sheet2 = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="inlineStr"><is><t>x</t></is></c><c><v>7</v></c></row></sheetData></worksheet>`

describe('reading Excel files', () => {
  it('reads every sheet as rows of text: dates, numbers, shared and inline text, gaps and formulas', async () => {
    const file = await zip({
      'xl/workbook.xml': workbook,
      'xl/_rels/workbook.xml.rels': rels,
      'xl/sharedStrings.xml': strings,
      'xl/styles.xml': styles,
      'xl/worksheets/sheet1.xml': sheet1,
      'xl/worksheets/sheet2.xml': sheet2,
    }, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml'])
    const sheets = await readXlsx(file)
    expect(sheets.map((s) => s.name)).toEqual(['العملاء', 'Other'])
    expect(sheets[0].rows).toEqual([
      ['Name', 'Joined', 'Amount', 'Phone', 'VIP'],
      ['Nile Foods & Co', '2025-12-09', '12500.5', '201001234567', 'TRUE'],
      ['شركة الدلتا', '2025-01-01', '', '0122', ''],
      ['Line\nbreak', '', '0.1', '', '1.5'],
    ])
    expect(sheets[1].rows).toEqual([['x', '7']])
  })

  it('says so when a file is not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('Name,Phone\nA,1'))).rejects.toThrow(/not an Excel workbook/)
  })
})
