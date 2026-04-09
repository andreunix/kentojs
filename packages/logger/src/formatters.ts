import { LEVELS, levelToName, type LevelName } from './levels'

export interface LogEntry {
  level: number
  time: number
  pid: number
  hostname: string
  name?: string
  msg: string
  [key: string]: unknown
}

export type Formatter = (entry: LogEntry) => string

// ─── JSON formatter (production) ─────────────────────────────────────────────
// Outputs newline-delimited JSON, one object per line — fast, machine-parseable.
// Field order is deterministic: level, time, pid, hostname, name, msg, ...rest

export function jsonFormatter(): Formatter {
  return function formatJson(entry: LogEntry): string {
    return fastStringify(entry)
  }
}

// Hand-rolled JSON serializer — avoids overhead of JSON.stringify's replacer
// and keeps field order deterministic (inspired by Pino's approach)
function fastStringify(entry: LogEntry): string {
  let json = '{"level":' + entry.level +
    ',"time":' + entry.time +
    ',"pid":' + entry.pid +
    ',"hostname":' + JSON.stringify(entry.hostname)

  if (entry.name !== undefined) {
    json += ',"name":' + JSON.stringify(entry.name)
  }

  json += ',"msg":' + JSON.stringify(entry.msg)

  for (const key in entry) {
    if (key === 'level' || key === 'time' || key === 'pid' || key === 'hostname' || key === 'name' || key === 'msg') continue
    const val = entry[key]
    if (val === undefined) continue
    json += ',' + JSON.stringify(key) + ':' + serializeValue(val)
  }

  json += '}'
  return json
}

function serializeValue(val: unknown): string {
  if (val === null) return 'null'
  if (typeof val === 'string') return JSON.stringify(val)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (val instanceof Error) return serializeError(val)
  if (val instanceof Date) return JSON.stringify(val.toISOString())
  if (typeof val === 'bigint') return '"' + val.toString() + 'n"'
  return JSON.stringify(val)
}

function serializeError(err: Error): string {
  let json = '{"type":' + JSON.stringify(err.constructor.name) +
    ',"message":' + JSON.stringify(err.message)
  if (err.stack) {
    json += ',"stack":' + JSON.stringify(err.stack)
  }
  if ('code' in err && (err as any).code !== undefined) {
    json += ',"code":' + JSON.stringify((err as any).code)
  }
  json += '}'
  return json
}

// ─── Pretty formatter (development / debug) ─────────────────────────────────
// Human-readable, colorized output with timestamps, level badges, and context.

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
} as const

const LEVEL_COLORS: Record<string, string> = {
  trace: ANSI.gray,
  debug: ANSI.cyan,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
  fatal: ANSI.bgRed + ANSI.white + ANSI.bold,
}

const LEVEL_LABELS: Record<string, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info:  ' INFO',
  warn:  ' WARN',
  error: 'ERROR',
  fatal: 'FATAL',
}

export interface PrettyOptions {
  colorize?: boolean
  translateTime?: boolean
  ignore?: string[]
  singleLine?: boolean
}

export function prettyFormatter(opts: PrettyOptions = {}): Formatter {
  const colorize = opts.colorize ?? true
  const translateTime = opts.translateTime ?? true
  const ignore = new Set(opts.ignore ?? [])
  const singleLine = opts.singleLine ?? false

  // Always ignore base fields from extra context printing
  const baseFields = new Set(['level', 'time', 'pid', 'hostname', 'name', 'msg', 'v'])

  return function formatPretty(entry: LogEntry): string {
    const levelName = levelToName(entry.level)
    const color = colorize ? (LEVEL_COLORS[levelName] ?? '') : ''
    const reset = colorize ? ANSI.reset : ''
    const dim = colorize ? ANSI.dim : ''
    const bold = colorize ? ANSI.bold : ''

    const label = LEVEL_LABELS[levelName] ?? levelName.toUpperCase().padStart(5)

    // Time
    let timeStr: string
    if (translateTime) {
      const d = new Date(entry.time)
      timeStr = formatTime(d)
    } else {
      timeStr = String(entry.time)
    }

    // Name prefix
    const nameStr = entry.name ? ` ${dim}(${entry.name})${reset}` : ''

    // Main line
    let line = `${dim}[${timeStr}]${reset} ${color}${label}${reset}${nameStr}${bold}: ${entry.msg}${reset}`

    // Extra fields
    const extras: string[] = []
    for (const key in entry) {
      if (baseFields.has(key) || ignore.has(key)) continue
      const val = entry[key]
      if (val === undefined) continue

      if (val instanceof Error || (val && typeof val === 'object' && 'stack' in (val as any) && 'message' in (val as any))) {
        const err = val as Error
        if (singleLine) {
          extras.push(`${dim}${key}=${reset}${ANSI.red}${err.message}${reset}`)
        } else {
          extras.push(`\n${ANSI.red}${err.stack ?? err.message}${reset}`)
        }
      } else if (typeof val === 'object' && val !== null) {
        extras.push(`${dim}${key}=${reset}${JSON.stringify(val)}`)
      } else {
        extras.push(`${dim}${key}=${reset}${String(val)}`)
      }
    }

    if (extras.length > 0) {
      if (singleLine) {
        line += ' ' + extras.join(' ')
      } else {
        // Stack traces get their own lines, others are inline
        const inline: string[] = []
        const blocks: string[] = []
        for (const e of extras) {
          if (e.startsWith('\n')) blocks.push(e)
          else inline.push(e)
        }
        if (inline.length) line += ' ' + inline.join(' ')
        if (blocks.length) line += blocks.join('')
      }
    }

    return line
  }
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}
