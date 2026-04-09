export interface PathKey {
  name: string | number
  type: string
}

export interface PathResult {
  regexp: RegExp
  keys: PathKey[]
}

export function pathToRegexp(
  path: string,
  options: { trailing?: boolean; end?: boolean } = {}
): PathResult {
  const keys: PathKey[] = []
  const trailing = options.trailing !== false
  const end = options.end !== false

  // Escape special regex characters in literal parts
  let pattern = ''
  let i = 0

  while (i < path.length) {
    if (path[i] === ':') {
      // Named parameter
      i++
      let name = ''
      while (i < path.length && /[a-zA-Z0-9_]/.test(path[i]!)) {
        name += path[i]
        i++
      }
      if (!name) { pattern += ':'; continue }

      keys.push({ name, type: 'param' })

      // Check for modifier: + (one or more), * (zero or more), ? (optional)
      if (i < path.length && path[i] === '+') {
        pattern += '([^/]+(?:/[^/]+)*)'
        i++
      } else if (i < path.length && path[i] === '*') {
        pattern += '(.*)'
        i++
      } else if (i < path.length && path[i] === '?') {
        // Optional parameter: make the preceding / and the param optional
        if (pattern.endsWith('\\/')) {
          pattern = pattern.slice(0, -2) + '(?:\\/([^/]+))?'
        } else {
          pattern += '([^/]+)?'
        }
        i++
      } else {
        pattern += '([^/]+)'
      }
    } else if (path[i] === '(' && path.slice(i, i + 4) === '(.*)') {
      // Wildcard group
      keys.push({ name: keys.length, type: 'param' })
      pattern += '(.*)'
      i += 4
    } else if (path[i] === '*') {
      // Simple wildcard
      keys.push({ name: keys.length, type: 'param' })
      pattern += '(.*)'
      i++
    } else {
      // Literal character — escape regex specials
      const ch = path[i]!
      if ('.+?^${}|[]\\'.includes(ch)) {
        pattern += `\\${ch}`
      } else {
        pattern += ch
      }
      i++
    }
  }

  // Handle trailing slash
  if (trailing && !pattern.endsWith('\\/') && !pattern.endsWith('\\/?')) {
    pattern += '\\/?'
  }

  // Build final regex
  const flags = ''
  const re = end
    ? new RegExp(`^${pattern}$`, flags)
    : new RegExp(`^${pattern}(?=\\/|$)`, flags)

  return { regexp: re, keys }
}

export function compile(
  path: string,
  _options?: { encode?: (value: string) => string }
): (params: Record<string, string>) => string {
  const encode = _options?.encode ?? encodeURIComponent
  return (params) => {
    let result = path
    // Replace named parameters
    result = result.replace(/:([a-zA-Z_]\w*)([+*?])?/g, (_match, name: string) => {
      const val = params[name]
      if (val === undefined) return ''
      return encode(val)
    })
    // Remove wildcard patterns
    result = result.replace(/\(\.\*\)/g, '')
    return result
  }
}

export interface PathToken {
  type: 'text' | 'param'
  value: string
  name?: string
}

export function parse(path: string): { tokens: PathToken[] } {
  const tokens: PathToken[] = []
  let i = 0
  let current = ''

  while (i < path.length) {
    if (path[i] === ':') {
      if (current) { tokens.push({ type: 'text', value: current }); current = '' }
      i++
      let name = ''
      while (i < path.length && /[a-zA-Z0-9_]/.test(path[i]!)) {
        name += path[i]
        i++
      }
      // Skip modifier
      if (i < path.length && ['+', '*', '?'].includes(path[i]!)) i++
      tokens.push({ type: 'param', value: `:${name}`, name })
    } else if (path[i] === '(' && path.slice(i, i + 4) === '(.*)') {
      if (current) { tokens.push({ type: 'text', value: current }); current = '' }
      tokens.push({ type: 'param', value: '(.*)', name: String(tokens.filter(t => t.type === 'param').length) })
      i += 4
    } else {
      current += path[i]
      i++
    }
  }
  if (current) tokens.push({ type: 'text', value: current })

  return { tokens }
}
