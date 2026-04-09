import { LEVELS, levelForMode, nameToLevel, levelToName, type LevelName, type LevelValue } from './levels'
import { jsonFormatter, prettyFormatter, type Formatter, type LogEntry, type PrettyOptions } from './formatters'
import { StdoutTransport, StderrTransport, FileTransport, MultiTransport, type Transport, type MultiTransportEntry } from './transport'
import { hostname, pid } from './env'

// ─── Options ─────────────────────────────────────────────────────────────────

export interface LoggerOptions {
  /** Logger name — included in every log entry */
  name?: string

  /**
   * Minimum log level. Can be a level name or the framework mode
   * ('production', 'development', 'debug') — the logger will pick
   * the appropriate level automatically.
   */
  level?: LevelName | 'auto'

  /** Framework mode — used when level is 'auto' or omitted */
  mode?: string

  /** Custom formatter. Defaults based on mode. */
  formatter?: Formatter

  /** Custom transport. Defaults to StdoutTransport. */
  transport?: Transport

  /** Pretty print options (only used when formatter is auto-selected) */
  pretty?: PrettyOptions

  /** Extra bindings merged into every log entry */
  bindings?: Record<string, unknown>

  /** Serializers for specific keys — transform values before logging */
  serializers?: Record<string, (value: unknown) => unknown>

  /** Enable/disable logging entirely */
  enabled?: boolean

  /** Timestamp function — return epoch ms. Defaults to Date.now */
  timestamp?: () => number
}

// ─── Logger ──────────────────────────────────────────────────────────────────

export class Logger {
  readonly name: string | undefined
  private levelValue: number
  private levelName: LevelName
  private formatter: Formatter
  private transport: Transport
  private bindings: Record<string, unknown>
  private serializers: Record<string, (value: unknown) => unknown>
  private enabled: boolean
  private timestampFn: () => number
  private childLoggers: Logger[] = []

  constructor(opts: LoggerOptions = {}) {
    const mode = opts.mode ?? process.env.NODE_ENV ?? 'development'

    this.name = opts.name
    this.enabled = opts.enabled ?? true
    this.timestampFn = opts.timestamp ?? Date.now
    this.bindings = opts.bindings ? { ...opts.bindings } : {}
    this.serializers = opts.serializers ? { ...opts.serializers } : {}

    // Resolve level
    if (opts.level && opts.level !== 'auto') {
      this.levelName = opts.level
      this.levelValue = nameToLevel(opts.level)
    } else {
      this.levelName = levelForMode(mode)
      this.levelValue = LEVELS[this.levelName]
    }

    // Resolve formatter
    if (opts.formatter) {
      this.formatter = opts.formatter
    } else if (mode === 'production') {
      this.formatter = jsonFormatter()
    } else {
      this.formatter = prettyFormatter({
        colorize: true,
        translateTime: true,
        ...opts.pretty,
      })
    }

    // Resolve transport
    this.transport = opts.transport ?? new StdoutTransport()
  }

  // ── Level management ─────────────────────────────────────────────────────

  get level(): LevelName {
    return this.levelName
  }

  set level(name: LevelName) {
    this.levelName = name
    this.levelValue = nameToLevel(name)
  }

  isLevelEnabled(name: LevelName): boolean {
    return LEVELS[name] >= this.levelValue
  }

  // ── Core log methods ─────────────────────────────────────────────────────

  trace(msg: string, extra?: Record<string, unknown>): void
  trace(obj: Record<string, unknown>, msg?: string): void
  trace(msgOrObj: string | Record<string, unknown>, extraOrMsg?: string | Record<string, unknown>): void {
    this.write(LEVELS.trace, msgOrObj, extraOrMsg)
  }

  debug(msg: string, extra?: Record<string, unknown>): void
  debug(obj: Record<string, unknown>, msg?: string): void
  debug(msgOrObj: string | Record<string, unknown>, extraOrMsg?: string | Record<string, unknown>): void {
    this.write(LEVELS.debug, msgOrObj, extraOrMsg)
  }

  info(msg: string, extra?: Record<string, unknown>): void
  info(obj: Record<string, unknown>, msg?: string): void
  info(msgOrObj: string | Record<string, unknown>, extraOrMsg?: string | Record<string, unknown>): void {
    this.write(LEVELS.info, msgOrObj, extraOrMsg)
  }

  warn(msg: string, extra?: Record<string, unknown>): void
  warn(obj: Record<string, unknown>, msg?: string): void
  warn(msgOrObj: string | Record<string, unknown>, extraOrMsg?: string | Record<string, unknown>): void {
    this.write(LEVELS.warn, msgOrObj, extraOrMsg)
  }

  error(msg: string, extra?: Record<string, unknown>): void
  error(obj: Record<string, unknown>, msg?: string): void
  error(msgOrObj: string | Record<string, unknown>, extraOrMsg?: string | Record<string, unknown>): void {
    this.write(LEVELS.error, msgOrObj, extraOrMsg)
  }

  fatal(msg: string, extra?: Record<string, unknown>): void
  fatal(obj: Record<string, unknown>, msg?: string): void
  fatal(msgOrObj: string | Record<string, unknown>, extraOrMsg?: string | Record<string, unknown>): void {
    this.write(LEVELS.fatal, msgOrObj, extraOrMsg)
  }

  // ── Child loggers ────────────────────────────────────────────────────────

  child(bindings: Record<string, unknown>, opts?: Partial<Omit<LoggerOptions, 'mode'>>): Logger {
    const child = new Logger({
      name: opts?.name ?? this.name,
      level: opts?.level ?? this.levelName,
      formatter: opts?.formatter ?? this.formatter,
      transport: opts?.transport ?? this.transport,
      bindings: { ...this.bindings, ...bindings },
      serializers: { ...this.serializers, ...opts?.serializers },
      enabled: opts?.enabled ?? this.enabled,
      timestamp: opts?.timestamp ?? this.timestampFn,
    })

    // Bypass mode-based level resolution — inherit parent's exact level
    if (opts?.level && opts.level !== 'auto') {
      child.levelValue = nameToLevel(opts.level)
      child.levelName = opts.level
    } else {
      child.levelValue = this.levelValue
      child.levelName = this.levelName
    }

    this.childLoggers.push(child)
    return child
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    await this.transport.flush?.()
    await Promise.all(this.childLoggers.map(c => c.flush()))
  }

  async close(): Promise<void> {
    await this.flush()
    await this.transport.close?.()
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private write(
    level: number,
    msgOrObj: string | Record<string, unknown>,
    extraOrMsg?: string | Record<string, unknown>
  ): void {
    // Fast bail — check level before any allocation
    if (!this.enabled || level < this.levelValue) return

    let msg: string
    let extra: Record<string, unknown> | undefined

    if (typeof msgOrObj === 'string') {
      msg = msgOrObj
      extra = extraOrMsg as Record<string, unknown> | undefined
    } else {
      msg = (typeof extraOrMsg === 'string' ? extraOrMsg : '') || ''
      extra = msgOrObj
    }

    // Build log entry
    const entry: LogEntry = {
      level,
      time: this.timestampFn(),
      pid,
      hostname,
      msg,
    }

    if (this.name) entry.name = this.name

    // Merge bindings
    if (Object.keys(this.bindings).length > 0) {
      for (const key in this.bindings) {
        entry[key] = this.bindings[key]
      }
    }

    // Merge extra fields
    if (extra) {
      for (const key in extra) {
        let val = extra[key]

        // Apply serializers
        if (this.serializers[key]) {
          val = this.serializers[key]!(val)
        }

        entry[key] = val
      }
    }

    // Format and write
    const formatted = this.formatter(entry)
    this.transport.write(entry, formatted)
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createLogger(opts?: LoggerOptions): Logger {
  return new Logger(opts)
}
