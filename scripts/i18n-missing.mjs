// Lists the wrapped English texts that have no Arabic yet: node scripts/i18n-missing.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ts = readFileSync('src/locales/extract.ts', 'utf8')
const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [] })
const { extractKeys } = await import('data:text/javascript,' + encodeURIComponent(ts.replace(/: string\[\]/g, '').replace(/: string/g, '').replace(/let m: RegExpExecArray \| null/, 'let m').replace(/export function rawText[\s\S]*$/, '')))
const ar = readFileSync('src/locales/ar.ts', 'utf8')
const have = new Set([...ar.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n')))
const keys = [...new Set(files('src').filter((f) => !f.startsWith('src/locales/') && f !== 'src/lib/i18n.ts').flatMap((f) => extractKeys(readFileSync(f, 'utf8'))))].filter((k) => !have.has(k))
console.log(JSON.stringify(keys, null, 1))
