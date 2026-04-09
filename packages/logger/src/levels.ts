export const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
} as const

export type LevelName = keyof typeof LEVELS
export type LevelValue = (typeof LEVELS)[LevelName]

const valueToName = new Map<number, LevelName>()
for (const [name, value] of Object.entries(LEVELS)) {
  valueToName.set(value, name as LevelName)
}

export function levelToName(value: number): LevelName | 'UNKNOWN' {
  return valueToName.get(value) ?? 'UNKNOWN'
}

export function nameToLevel(name: string): LevelValue {
  const level = LEVELS[name as LevelName]
  if (level === undefined) throw new Error(`Unknown log level: "${name}"`)
  return level
}

export function isValidLevel(name: string): name is LevelName {
  return name in LEVELS
}

export const MODE_LEVELS: Record<string, LevelName> = {
  production: 'warn',
  development: 'debug',
  debug: 'trace',
}

export function levelForMode(mode: string): LevelName {
  return MODE_LEVELS[mode] ?? 'info'
}
