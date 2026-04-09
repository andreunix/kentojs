import { describe, it, expect, beforeEach } from 'bun:test'
import { Logger, createLogger } from '../logger'
import { LEVELS, levelForMode } from '../levels'
import { jsonFormatter, prettyFormatter, type LogEntry } from '../formatters'
import type { Transport } from '../transport'

// ─── Test transport that captures entries ─────────────────────────────────────

class TestTransport implements Transport {
  entries: Array<{ entry: LogEntry; formatted: string }> = []

  write(entry: LogEntry, formatted: string): void {
    this.entries.push({ entry: { ...entry }, formatted })
  }

  clear(): void {
    this.entries = []
  }

  get last() {
    return this.entries[this.entries.length - 1]
  }

  get count() {
    return this.entries.length
  }
}

// ─── Level tests ──────────────────────────────────────────────────────────────

describe('levels', () => {
  it('maps modes to correct levels', () => {
    expect(levelForMode('production')).toBe('warn')
    expect(levelForMode('development')).toBe('debug')
    expect(levelForMode('debug')).toBe('trace')
    expect(levelForMode('unknown')).toBe('info')
  })

  it('has correct numeric values', () => {
    expect(LEVELS.trace).toBe(10)
    expect(LEVELS.debug).toBe(20)
    expect(LEVELS.info).toBe(30)
    expect(LEVELS.warn).toBe(40)
    expect(LEVELS.error).toBe(50)
    expect(LEVELS.fatal).toBe(60)
    expect(LEVELS.silent).toBe(Infinity)
  })
})

// ─── Logger tests ─────────────────────────────────────────────────────────────

describe('Logger', () => {
  let transport: TestTransport
  let logger: Logger

  beforeEach(() => {
    transport = new TestTransport()
    logger = new Logger({
      level: 'trace',
      transport,
      formatter: jsonFormatter(),
      name: 'test',
    })
  })

  it('logs messages at each level', () => {
    logger.trace('trace msg')
    logger.debug('debug msg')
    logger.info('info msg')
    logger.warn('warn msg')
    logger.error('error msg')
    logger.fatal('fatal msg')

    expect(transport.count).toBe(6)
    expect(transport.entries[0]!.entry.level).toBe(LEVELS.trace)
    expect(transport.entries[0]!.entry.msg).toBe('trace msg')
    expect(transport.entries[5]!.entry.level).toBe(LEVELS.fatal)
    expect(transport.entries[5]!.entry.msg).toBe('fatal msg')
  })

  it('includes name, pid, hostname, time in entries', () => {
    logger.info('hello')
    const entry = transport.last!.entry
    expect(entry.name).toBe('test')
    expect(typeof entry.pid).toBe('number')
    expect(typeof entry.hostname).toBe('string')
    expect(typeof entry.time).toBe('number')
  })

  it('respects log level threshold', () => {
    const warnLogger = new Logger({
      level: 'warn',
      transport,
      formatter: jsonFormatter(),
    })

    warnLogger.trace('nope')
    warnLogger.debug('nope')
    warnLogger.info('nope')
    warnLogger.warn('yes')
    warnLogger.error('yes')

    expect(transport.count).toBe(2)
  })

  it('supports object + message signature', () => {
    logger.info({ userId: 42, action: 'login' }, 'user logged in')

    const entry = transport.last!.entry
    expect(entry.msg).toBe('user logged in')
    expect(entry.userId).toBe(42)
    expect(entry.action).toBe('login')
  })

  it('supports message + extra object signature', () => {
    logger.info('user logged in', { userId: 42 })

    const entry = transport.last!.entry
    expect(entry.msg).toBe('user logged in')
    expect(entry.userId).toBe(42)
  })

  it('merges bindings into entries', () => {
    const bound = new Logger({
      level: 'trace',
      transport,
      formatter: jsonFormatter(),
      bindings: { service: 'auth', version: '1.0' },
    })

    bound.info('test')
    const entry = transport.last!.entry
    expect(entry.service).toBe('auth')
    expect(entry.version).toBe('1.0')
  })

  it('can change level at runtime', () => {
    logger.level = 'error'
    logger.info('skipped')
    expect(transport.count).toBe(0)

    logger.error('logged')
    expect(transport.count).toBe(1)
  })

  it('isLevelEnabled returns correct results', () => {
    const infoLogger = new Logger({ level: 'info', transport, formatter: jsonFormatter() })

    expect(infoLogger.isLevelEnabled('trace')).toBe(false)
    expect(infoLogger.isLevelEnabled('debug')).toBe(false)
    expect(infoLogger.isLevelEnabled('info')).toBe(true)
    expect(infoLogger.isLevelEnabled('warn')).toBe(true)
    expect(infoLogger.isLevelEnabled('error')).toBe(true)
  })

  it('respects enabled=false', () => {
    const disabled = new Logger({
      level: 'trace',
      transport,
      formatter: jsonFormatter(),
      enabled: false,
    })

    disabled.fatal('should not appear')
    expect(transport.count).toBe(0)
  })

  it('applies serializers', () => {
    const serialized = new Logger({
      level: 'trace',
      transport,
      formatter: jsonFormatter(),
      serializers: {
        err: (val: unknown) => {
          const err = val as Error
          return { type: err.constructor.name, message: err.message }
        },
      },
    })

    serialized.error('fail', { err: new TypeError('bad input') })
    const entry = transport.last!.entry
    expect((entry.err as any).type).toBe('TypeError')
    expect((entry.err as any).message).toBe('bad input')
  })
})

// ─── Child logger tests ───────────────────────────────────────────────────────

describe('child logger', () => {
  let transport: TestTransport

  beforeEach(() => {
    transport = new TestTransport()
  })

  it('inherits parent bindings and adds its own', () => {
    const parent = new Logger({
      level: 'trace',
      transport,
      formatter: jsonFormatter(),
      bindings: { service: 'api' },
    })

    const child = parent.child({ reqId: 'abc-123' })
    child.info('handling request')

    const entry = transport.last!.entry
    expect(entry.service).toBe('api')
    expect(entry.reqId).toBe('abc-123')
  })

  it('inherits parent level', () => {
    const parent = new Logger({
      level: 'warn',
      transport,
      formatter: jsonFormatter(),
    })

    const child = parent.child({ component: 'db' })
    child.info('skipped')
    expect(transport.count).toBe(0)

    child.warn('logged')
    expect(transport.count).toBe(1)
  })

  it('can override level', () => {
    const parent = new Logger({
      level: 'warn',
      transport,
      formatter: jsonFormatter(),
    })

    const child = parent.child({ component: 'debug-module' }, { level: 'trace' })
    child.trace('now visible')
    expect(transport.count).toBe(1)
  })
})

// ─── Mode-based level tests ──────────────────────────────────────────────────

describe('mode-based levels', () => {
  let transport: TestTransport

  beforeEach(() => {
    transport = new TestTransport()
  })

  it('production mode sets level to warn', () => {
    const log = new Logger({ mode: 'production', transport, formatter: jsonFormatter() })

    log.info('hidden')
    log.debug('hidden')
    log.trace('hidden')
    expect(transport.count).toBe(0)

    log.warn('visible')
    log.error('visible')
    log.fatal('visible')
    expect(transport.count).toBe(3)
  })

  it('development mode sets level to debug', () => {
    const log = new Logger({ mode: 'development', transport, formatter: jsonFormatter() })

    log.trace('hidden')
    expect(transport.count).toBe(0)

    log.debug('visible')
    log.info('visible')
    expect(transport.count).toBe(2)
  })

  it('debug mode sets level to trace (all visible)', () => {
    const log = new Logger({ mode: 'debug', transport, formatter: jsonFormatter() })

    log.trace('visible')
    log.debug('visible')
    log.info('visible')
    log.warn('visible')
    log.error('visible')
    log.fatal('visible')
    expect(transport.count).toBe(6)
  })
})

// ─── Formatter tests ──────────────────────────────────────────────────────────

describe('jsonFormatter', () => {
  it('produces valid JSON', () => {
    const fmt = jsonFormatter()
    const entry: LogEntry = {
      level: 30,
      time: 1700000000000,
      pid: 1234,
      hostname: 'test-host',
      name: 'app',
      msg: 'hello world',
    }

    const result = fmt(entry)
    const parsed = JSON.parse(result)

    expect(parsed.level).toBe(30)
    expect(parsed.time).toBe(1700000000000)
    expect(parsed.pid).toBe(1234)
    expect(parsed.hostname).toBe('test-host')
    expect(parsed.name).toBe('app')
    expect(parsed.msg).toBe('hello world')
  })

  it('handles extra fields', () => {
    const fmt = jsonFormatter()
    const entry: LogEntry = {
      level: 30,
      time: 1700000000000,
      pid: 1234,
      hostname: 'h',
      msg: 'test',
      userId: 42,
      tags: ['a', 'b'],
    }

    const parsed = JSON.parse(fmt(entry))
    expect(parsed.userId).toBe(42)
    expect(parsed.tags).toEqual(['a', 'b'])
  })

  it('serializes errors in extra fields', () => {
    const fmt = jsonFormatter()
    const err = new TypeError('bad')
    const entry: LogEntry = {
      level: 50,
      time: 1700000000000,
      pid: 1,
      hostname: 'h',
      msg: 'fail',
      err,
    }

    const parsed = JSON.parse(fmt(entry))
    expect(parsed.err.type).toBe('TypeError')
    expect(parsed.err.message).toBe('bad')
    expect(parsed.err.stack).toBeDefined()
  })
})

describe('prettyFormatter', () => {
  it('produces human-readable output', () => {
    const fmt = prettyFormatter({ colorize: false })
    const entry: LogEntry = {
      level: 30,
      time: 1700000000000,
      pid: 1,
      hostname: 'h',
      msg: 'hello',
    }

    const result = fmt(entry)
    expect(result).toContain('INFO')
    expect(result).toContain('hello')
  })

  it('includes logger name when set', () => {
    const fmt = prettyFormatter({ colorize: false })
    const entry: LogEntry = {
      level: 30,
      time: 1700000000000,
      pid: 1,
      hostname: 'h',
      name: 'myapp',
      msg: 'test',
    }

    const result = fmt(entry)
    expect(result).toContain('myapp')
  })
})

// ─── createLogger factory ────────────────────────────────────────────────────

describe('createLogger', () => {
  it('creates a Logger instance', () => {
    const log = createLogger({ level: 'info' })
    expect(log).toBeInstanceOf(Logger)
    expect(log.level).toBe('info')
  })
})
