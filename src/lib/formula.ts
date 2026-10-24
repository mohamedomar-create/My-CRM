// A small, safe arithmetic language for formula fields: numbers, field keys, + - * / and parentheses.
// No eval: it is parsed into a tree, so a formula can never run code.

type Node = { k: 'num'; v: number } | { k: 'ref'; name: string } | { k: 'neg'; a: Node } | { k: 'bin'; op: string; a: Node; b: Node }

function tokenize(src: string): string[] {
  const tokens: string[] = []
  const re = /\s*(\d+(?:\.\d+)?|[a-z_][a-z0-9_]*|[-+*/()])/giy
  let m: RegExpExecArray | null
  let pos = 0
  while (pos < src.length) {
    re.lastIndex = pos
    m = re.exec(src)
    if (!m) {
      if (src.slice(pos).trim() === '') break
      throw new Error(`Unexpected “${src.slice(pos).trim()[0]}”`)
    }
    tokens.push(m[1])
    pos = re.lastIndex
  }
  return tokens
}

export function parseFormula(src: string): Node {
  const t = tokenize(src)
  let i = 0
  const peek = () => t[i]
  const next = () => t[i++]
  function primary(): Node {
    const tok = next()
    if (tok === undefined) throw new Error('Formula ends too early')
    if (tok === '(') {
      const n = expr()
      if (next() !== ')') throw new Error('Missing “)”')
      return n
    }
    if (tok === '-') return { k: 'neg', a: primary() }
    if (/^\d/.test(tok)) return { k: 'num', v: Number(tok) }
    if (/^[a-z_]/i.test(tok)) return { k: 'ref', name: tok }
    throw new Error(`Unexpected “${tok}”`)
  }
  function term(): Node {
    let n = primary()
    while (peek() === '*' || peek() === '/') n = { k: 'bin', op: next(), a: n, b: primary() }
    return n
  }
  function expr(): Node {
    let n = term()
    while (peek() === '+' || peek() === '-') n = { k: 'bin', op: next(), a: n, b: term() }
    return n
  }
  if (!t.length) throw new Error('Formula is empty')
  const tree = expr()
  if (i < t.length) throw new Error(`Unexpected “${t[i]}”`)
  return tree
}

export function formulaRefs(src: string): string[] {
  const out = new Set<string>()
  const walk = (n: Node) => {
    if (n.k === 'ref') out.add(n.name)
    else if (n.k === 'neg') walk(n.a)
    else if (n.k === 'bin') {
      walk(n.a)
      walk(n.b)
    }
  }
  walk(parseFormula(src))
  return [...out]
}

export function evalFormula(src: string, values: Record<string, unknown>): number | null {
  let tree: Node
  try {
    tree = parseFormula(src)
  } catch {
    return null
  }
  const ev = (n: Node): number => {
    switch (n.k) {
      case 'num':
        return n.v
      case 'ref': {
        const v = Number(values[n.name])
        return Number.isFinite(v) ? v : 0
      }
      case 'neg':
        return -ev(n.a)
      case 'bin': {
        const a = ev(n.a)
        const b = ev(n.b)
        if (n.op === '+') return a + b
        if (n.op === '-') return a - b
        if (n.op === '*') return a * b
        return b === 0 ? 0 : a / b
      }
    }
  }
  const r = ev(tree)
  return Number.isFinite(r) ? Math.round(r * 100) / 100 : null
}
