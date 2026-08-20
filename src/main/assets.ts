import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Icono de la app en tiempo de ejecucion. Empaquetada va como recurso suelto
 * (ver extraResources en electron-builder.yml); en desarrollo se lee de build/.
 */
export function iconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico')]
    : [join(app.getAppPath(), 'build', 'icon.ico')]

  return candidates.find((path) => existsSync(path))
}
