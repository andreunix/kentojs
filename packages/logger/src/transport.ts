import type { Formatter, LogEntry } from './formatters'

export interface Transport {
  write(entry: LogEntry, formatted: string): void
  flush?(): void | Promise<void>
  close?(): void | Promise<void>
}

// ─── Stdout transport ────────────────────────────────────────────────────────
// Writes formatted log lines to process stdout. Uses Bun's write for speed
// when available, falls back to process.stdout.write.

export class StdoutTransport implements Transport {
  private writer: (data: string) => void

  constructor() {
    this.writer = (data: string) => process.stdout.write(data + '\n')
  }

  write(_entry: LogEntry, formatted: string): void {
    this.writer(formatted)
  }
}

// ─── Stderr transport ────────────────────────────────────────────────────────

export class StderrTransport implements Transport {
  write(_entry: LogEntry, formatted: string): void {
    process.stderr.write(formatted + '\n')
  }
}

// ─── File transport ──────────────────────────────────────────────────────────
// Async-buffered file writer. Accumulates lines and flushes in batches for
// high throughput (inspired by Pino's sonic-boom approach).

export class FileTransport implements Transport {
  private fd: number | null = null
  private buffer: string[] = []
  private bufferSize = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly path: string
  private readonly maxBufferSize: number
  private readonly flushInterval: number

  constructor(opts: { path: string; maxBufferSize?: number; flushInterval?: number }) {
    this.path = opts.path
    this.maxBufferSize = opts.maxBufferSize ?? 4096
    this.flushInterval = opts.flushInterval ?? 1000
    this.open()
  }

  private open(): void {
    const file = Bun.file(this.path)
    // Open with append flag
    this.fd = 1 // placeholder — we use Bun.write
    this.scheduleFlush()
  }

  write(_entry: LogEntry, formatted: string): void {
    const line = formatted + '\n'
    this.buffer.push(line)
    this.bufferSize += line.length

    if (this.bufferSize >= this.maxBufferSize) {
      void this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const data = this.buffer.join('')
    this.buffer = []
    this.bufferSize = 0

    const file = Bun.file(this.path)
    const existing = await file.exists() ? await file.text() : ''
    await Bun.write(this.path, existing + data)
  }

  private scheduleFlush(): void {
    this.flushTimer = setInterval(() => {
      void this.flush()
    }, this.flushInterval)

    // Unref the timer so it doesn't keep the process alive
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      (this.flushTimer as any).unref()
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
    this.fd = null
  }
}

// ─── Multi transport ─────────────────────────────────────────────────────────
// Fan-out to multiple transports. Each can have its own min level.

import { LEVELS, type LevelName } from './levels'

export interface MultiTransportEntry {
  transport: Transport
  level?: LevelName
  formatter?: Formatter
}

export class MultiTransport implements Transport {
  private entries: Array<MultiTransportEntry & { levelValue: number }>

  constructor(entries: MultiTransportEntry[]) {
    this.entries = entries.map(e => ({
      ...e,
      levelValue: e.level ? LEVELS[e.level] : 0,
    }))
  }

  write(entry: LogEntry, formatted: string): void {
    for (const e of this.entries) {
      if (entry.level >= e.levelValue) {
        const output = e.formatter ? e.formatter(entry) : formatted
        e.transport.write(entry, output)
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.entries.map(e => e.transport.flush?.()))
  }

  async close(): Promise<void> {
    await Promise.all(this.entries.map(e => e.transport.close?.()))
  }
}
