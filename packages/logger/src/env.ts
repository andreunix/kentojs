import { hostname as osHostname } from 'node:os'

export const pid: number = process.pid
export const hostname: string = osHostname()
