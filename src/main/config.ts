import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_CONFIG } from '../shared/types'
import type { Config } from '../shared/types'

let cache: Config | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/**
 * Normaliza lo leido de disco contra los valores por defecto. Un config.json
 * editado a mano o de una version anterior no debe tumbar la app: cualquier
 * campo ausente o con tipo incorrecto vuelve a su valor por defecto.
 */
function normalize(raw: unknown): Config {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG }
  const input = raw as Record<string, unknown>

  const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback

  return {
    version: 1,
    workspacePath: str(input['workspacePath']),
    workspaceConfirmed: bool(input['workspaceConfirmed'], false),
    skipInstallConfirm: bool(input['skipInstallConfirm'], false),
    defaultCleanupMode:
      input['defaultCleanupMode'] === 'delete' || input['defaultCleanupMode'] === 'keep'
        ? input['defaultCleanupMode']
        : null,
    flavor: input['flavor'] === 'mono' ? 'mono' : 'standard',
    installed: Array.isArray(input['installed'])
      ? (input['installed'].filter(
          (item) => typeof item === 'object' && item !== null && typeof (item as { tag?: unknown }).tag === 'string'
        ) as Config['installed'])
      : []
  }
}

export function getConfig(): Config {
  if (cache) return cache
  try {
    const path = configPath()
    cache = existsSync(path) ? normalize(JSON.parse(readFileSync(path, 'utf8'))) : { ...DEFAULT_CONFIG }
  } catch {
    // Archivo corrupto: se parte de cero en vez de dejar la app inutilizable.
    cache = { ...DEFAULT_CONFIG }
  }
  return cache
}

/**
 * Escritura atomica: se escribe en un temporal y se renombra. Un cierre a mitad
 * deja el config anterior intacto en vez de un JSON truncado.
 */
export function setConfig(patch: Partial<Config>): Config {
  const next: Config = { ...getConfig(), ...patch, version: 1 }
  const path = configPath()
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(temp, path)
  cache = next
  return next
}
