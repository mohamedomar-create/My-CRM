// Finds the English texts wrapped for translation in the source: tr('…'), tr(cond ? '…' : '…'), N_('…').
// Used by the translation test, and by `npm run i18n:missing` to list what still needs Arabic.

/** Every string literal in the first argument of each tr( / N_( call. */
export function extractKeys(src: string): string[] {
  const keys: string[] = []
  const re = /\b(?:tr|N_)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length
    let depth = 0
    for (; i < src.length; i++) {
      const ch = src[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1
        let text = ''
        while (j < src.length && src[j] !== ch) {
          if (src[j] === '\\') { const e = src[j + 1]; text += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; continue }
          text += src[j]
          j++
        }
        // A literal compared with something (mode === 'register' ? …) is a condition, not text to show.
        const before = src.slice(Math.max(0, i - 4), i).trimEnd()
        const after = src.slice(j + 1, j + 5).trimStart()
        const compared = /[=!]==?$/.test(before) || /^[=!]==?/.test(after)
        if (!compared && text !== '' && (ch !== '`' || !text.includes('${'))) keys.push(text)
        i = j
        continue
      }
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth-- }
      else if (ch === ',' && depth === 0) break
    }
  }
  return keys
}

/** English text left in JSX (between tags, or in placeholder / title / aria-label / alt) that isn't wrapped. */
export function rawText(src: string): string[] {
  const found: string[] = []
  for (const m of src.matchAll(/>([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)</g)) {
    const t = m[1].trim()
    // TypeScript generics and comparisons can look like tags; real JSX text has no arrows, operators or statements.
    if (t && !/=>|&&|\|\||===|!==|\breturn\b|\s=\s|^\)|\($|^[=:?]|\s[?:]\s|^[\w.]+\.\w+$|^[a-z]+[A-Z]\w*$/.test(t)) found.push(t)
  }
  // Text between a value and a tag or another value: "<b>{n}</b> rows found", "Show {name}’s".
  const code = /=>|&&|\|\||===|!==|\breturn\b|\s=\s|[;?:(),.[\]]\s*$|^\s*[;?:(),.[\]]|^\s*\w+\s*$|\b(?:const|let|if|else|new|typeof|as|of|in)\b|[=+*/%!]/
  // Quoted strings (already wrapped, or not screen text) are left out of this check.
  const bare = src.replace(/'(?:[^'\\\n]|\\.)*'|`[^`]*`|"(?:[^"\\\n]|\\.)*"/g, "''")
  for (const m of bare.matchAll(/(?<=[>}])([^<>{}\n`'"]*[A-Za-z]{2,}[^<>{}\n`'"]*)(?=[{<])/g)) {
    const t = m[1].trim()
    if (t.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 2 && !code.test(m[1])) found.push(t)
  }
  // A single word in front of a value: "Rule {i + 1}", "New {name}".
  for (const m of bare.matchAll(/>\s*([A-Z][a-z]+)\s*\{/g)) found.push(m[1])
  for (const m of src.matchAll(/\b(?:placeholder|title|aria-label|alt)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
    // E-mail addresses and web addresses are the same in every language.
    if (!/^[\w.@+-]+@[\w.-]+$/.test(m[1]) && !/^[a-z]+:\/\//.test(m[1])) found.push(m[1])
  }
  return [...new Set(found)]
}
