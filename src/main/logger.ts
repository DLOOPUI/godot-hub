import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type LogLevel = 'info' | 'warn' | 'error'

/** Se rota al superar este tamaño; se conserva una generacion anterior. */
const MAX_BYTES = 1024 * 1024
const FILE = 'app.log'
const PREVIOUS = 'app.log.1'

let directory: string | null = null

export function logDir(): string {
  if (!directory) {
    directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
  }
  return directory
}

function rotateIfNeeded(path: string): void {
  try {
    if (!existsSync(path) || statSync(path).size < MAX_BYTES) return
    const previous = join(logDir(), PREVIOUS)
    if (existsSync(previous)) unlinkSync(previous)
    renameSync(path, previous)
  } catch {
    // Un fallo rotando no debe impedir que se siga registrando.
  }
}

/**
 * Registro en `userData/logs/app.log`.
 *
 * Sincrono a proposito: la mayoria de lo que interesa registrar ocurre justo
 * antes de un cierre o un crash, y una escritura diferida se perderia ahi.
 */
export function log(level: LogLevel, message: string, meta?: unknown): void {
  const line =
    `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}` +
    (meta === undefined ? '' : ` ${safeStringify(meta)}`) +
    '\n'

  if (!app.isPackaged) console.log(line.trimEnd())

  try {
    const path = join(logDir(), FILE)
    rotateIfNeeded(path)
    appendFileSync(path, line, 'utf8')
  } catch {
    // Sin disco donde escribir, la app sigue funcionando.
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Captura lo que se escape de los try/catch para que quede rastro. */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (error) => log('error', 'uncaughtException', error))
  process.on('unhandledRejection', (reason) => log('error', 'unhandledRejection', reason))
}
