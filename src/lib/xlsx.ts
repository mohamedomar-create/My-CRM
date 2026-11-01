// Reads Excel workbooks (.xlsx) in the browser, with nothing but what the browser already has: an .xlsx file is a zip
// of XML files, unzipped here with DecompressionStream. Each sheet comes back as rows of text, the way a CSV would:
// dates as YYYY-MM-DD, numbers as plain digits, formulas as their last calculated value.

export interface Sheet {
  name: string
  rows: string[][]
}

/* ---------------- zip ---------------- */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The files in a zip, by name (only the ones asked for are unzipped). */
function zipEntries(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // The end-of-central-directory record is in the last 64 KB (after an optional comment).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This file is not an Excel workbook (.xlsx)')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const names = new TextDecoder()
  const out = new Map<string, () => Promise<Uint8Array>>()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('This Excel file is damaged')
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = names.decode(buf.subarray(p + 46, p + 46 + nameLen))
    out.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = buf.subarray(start, start + size)
      if (method === 0) return data
      if (method === 8) return inflate(data)
      throw new Error('This Excel file uses a kind of compression that can’t be read here. Save it again from Excel, or as CSV.')
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/* ---------------- XML ---------------- */

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()])
    // Excel writes some control characters as _xHHHH_
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].replace(/^\w+:/, '')] = decode(m[3] ?? m[4] ?? '')
  return out
}

/** The text inside every <t> of an element (rich text has several), leaving out phonetic hints. */
const texts = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decode(m[1] ?? '')).join('')

/* ---------------- dates ---------------- */

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

function isDateFormat(code: string) {
  // [h]:mm and [mm]:ss are durations, not dates.
  if (/\[(h+|m+|s+)\]/i.test(code)) return false
  // Leave out text in quotes, escaped characters and [colours]/[conditions]; what is left is a date if it has d, m or y.
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
  // "m" alone could be minutes (h:mm, mm:ss): it means a month only when there is no hour or second beside it.
  return /[dy]/i.test(bare) || (/m/i.test(bare) && !/[hs]/i.test(bare))
}

function serialDate(serial: number, date1904: boolean) {
  const days = serial + (date1904 ? 1462 : 0)
  const ms = Math.round((days - 25569) * 86_400_000)
  return new Date(ms).toISOString().slice(0, 10)
}

const columnIndex = (ref: string) => {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/* ---------------- workbook ---------------- */

/** Reads every sheet of an .xlsx file. */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<Sheet[]> {
  const files = zipEntries(data instanceof Uint8Array ? data : new Uint8Array(data))
  const text = async (name: string) => {
    const f = files.get(name)
    return f ? new TextDecoder().decode(await f()) : ''
  }
  const workbook = await text('xl/workbook.xml')
  if (!workbook) throw new Error('This file is not an Excel workbook (.xlsx)')
  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*"(1|true)"/i.test(workbook)
  const rels = new Map([...(await text('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const a = attrs(m[0])
    return [a.Id, a.Target]
  }))
  const shared = [...(await text('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => texts(m[1] ?? ''))

  // Which cell styles are dates.
  const styles = await text('xl/styles.xml')
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => { const a = attrs(m[0]); return [Number(a.numFmtId), a.formatCode ?? ''] }))
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attrs(m[0]).numFmtId ?? 0)
    return DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))
  })

  const sheets: Sheet[] = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0])
    const target = rels.get(a.id) ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = await text(path)
    const rows: string[][] = []
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(attrs(row[1]).r ?? rows.length + 1) - 1
      const cells: string[] = []
      let next = 0
      for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(c[1])
        const col = ca.r ? columnIndex(ca.r) : next
        next = col + 1
        const body = c[2] ?? ''
        const v = decode(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '')
        let value = ''
        switch (ca.t) {
          case 's': value = shared[Number(v)] ?? ''; break
          case 'inlineStr': value = texts(body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? ''); break
          case 'str': value = v; break
          case 'b': value = v === '1' ? 'TRUE' : 'FALSE'; break
          case 'e': value = ''; break
          case 'd': value = v.slice(0, 10); break
          default: {
            if (v === '') break
            const n = Number(v)
            if (!Number.isFinite(n)) value = v
            else if (dateStyle[Number(ca.s ?? 0)]) value = serialDate(n, date1904)
            else value = Math.abs(n) < 1e21 && String(n).includes('e') === false ? String(n) : v
          }
        }
        cells[col] = value
      }
      rows[r] = Array.from(cells, (x) => x ?? '')
    }
    const dense = Array.from(rows, (x) => x ?? []).filter((x) => x.some((v) => v.trim() !== ''))
    const width = Math.max(0, ...dense.map((x) => x.length))
    sheets.push({ name: a.name ?? `Sheet ${sheets.length + 1}`, rows: dense.map((x) => [...x, ...Array(width - x.length).fill('')]) })
  }
  return sheets
}
