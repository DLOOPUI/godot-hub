import { access, constants } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { getConfig } from './config'
import { walkSize } from './workspace'
import type { LibraryEntry } from '../shared/types'

/**
 * Las versiones instaladas, contrastadas con lo que hay en disco ahora mismo.
 *
 * `config.installed` es solo lo que la app recuerda haber instalado: la carpeta
 * puede haberse borrado por fuera. La biblioteca prefiere enseñar la entrada
 * marcada como ausente antes que ocultarla, para que el usuario entienda por
 * que su version ya no arranca.
 */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const config = getConfig()
  const workspace = config.workspacePath
  if (!workspace) return []

  const root = resolve(workspace)

  const entries = await Promise.all(
    config.installed.map(async (item): Promise<LibraryEntry> => {
      const folderPath = resolve(join(workspace, item.folder))
      const exePath = resolve(join(folderPath, item.exe))

      // Misma defensa que al lanzar: una entrada manipulada no debe hacer que
      // la app vaya a leer (ni a medir) fuera del area de trabajo.
      const inside = !relative(root, exePath).startsWith('..')

      let exists = false
      if (inside) {
        try {
          await access(exePath, constants.F_OK)
          exists = true
        } catch {
          exists = false
        }
      }

      return {
        ...item,
        exePath,
        folderPath,
        exists,
        sizeBytes: exists ? await walkSize(folderPath) : 0
      }
    })
  )

  // Mas recientes primero: es el orden en el que se buscan.
  return entries.sort((a, b) => Date.parse(b.installedAt) - Date.parse(a.installedAt))
}
