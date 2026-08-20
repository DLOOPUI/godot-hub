import { constants } from 'node:fs'
import { access, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join, parse, resolve, sep } from 'node:path'
import { app, shell } from 'electron'
import type { ClearResult, WorkspaceEntry, WorkspaceInspection, WorkspaceRejection } from '../shared/types'

/** Tope del recorrido de tamaño: una carpeta enorme no debe congelar el dialogo. */
const WALK_MAX_ENTRIES = 20_000
const WALK_MAX_MS = 2_500

const REJECTION_MESSAGES: Record<WorkspaceRejection, string> = {
  'not-found': 'La carpeta ya no existe.',
  'not-a-directory': 'La ruta seleccionada no es una carpeta.',
  'not-writable': 'No se puede escribir en esta carpeta. Elige otra o revisa los permisos.',
  'drive-root':
    'No se puede usar la raíz de una unidad. Crea una subcarpeta dedicada, por ejemplo D:\\Godot\\versiones.',
  protected:
    'Esta carpeta está protegida (sistema, perfil de usuario o carpetas personales). La app borra su contenido de forma recurrente, así que necesita una carpeta dedicada.',
  'contains-app': 'Esta carpeta contiene la propia aplicación. Elige una carpeta distinta.'
}

function normalizePath(path: string): string {
  const resolved = resolve(path)
  const trimmed = resolved.length > 3 && resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

function isSameOrInside(child: string, parent: string): boolean {
  const c = normalizePath(child)
  const p = normalizePath(parent)
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

function safeAppPath(getter: () => string): string | null {
  try {
    return getter()
  } catch {
    return null // p. ej. 'downloads' puede no existir en algunas sesiones
  }
}

/**
 * Carpetas que nunca pueden ser area de trabajo.
 *
 * El area de trabajo se vacia por completo al configurarla, asi que un error
 * aqui es destructivo e irreversible. Se bloquea sin opcion de continuar: no
 * hay un "entiendo el riesgo" que justifique apuntar esto al perfil de usuario.
 */
function protectedPaths(): string[] {
  const paths: (string | null | undefined)[] = [
    safeAppPath(() => app.getPath('home')),
    safeAppPath(() => app.getPath('appData')),
    safeAppPath(() => app.getPath('userData')),
    safeAppPath(() => app.getPath('desktop')),
    safeAppPath(() => app.getPath('documents')),
    safeAppPath(() => app.getPath('downloads')),
    safeAppPath(() => app.getPath('music')),
    safeAppPath(() => app.getPath('pictures')),
    safeAppPath(() => app.getPath('videos')),
    process.env['WINDIR'],
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['ProgramData'],
    process.env['OneDrive'],
    process.env['OneDriveConsumer'],
    process.env['OneDriveCommercial'],
    process.env['PUBLIC']
  ]
  return paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
}

function checkRejection(path: string): WorkspaceRejection | null {
  const resolved = resolve(path)

  if (parse(resolved).root === resolved) return 'drive-root'

  for (const candidate of protectedPaths()) {
    // Tambien se rechaza si la seleccion CONTIENE una carpeta protegida:
    // elegir C:\Users borraria el perfil entero.
    if (isSameOrInside(resolved, candidate) || isSameOrInside(candidate, resolved)) return 'protected'
  }

  const appDir = resolve(process.execPath, '..')
  if (isSameOrInside(appDir, resolved)) return 'contains-app'

  return null
}

/** Prueba de escritura real: los permisos de Windows no se deducen del modo POSIX. */
async function isWritable(path: string): Promise<boolean> {
  const probe = join(path, `.autoupdate-write-test-${process.pid}`)
  try {
    await writeFile(probe, '')
    await unlink(probe)
    return true
  } catch {
    return false
  }
}

/**
 * Tamaño de una carpeta, con los mismos topes que el resto: una carpeta enorme
 * devuelve una cifra aproximada en vez de congelar la interfaz.
 */
export async function walkSize(path: string): Promise<number> {
  const deadline = Date.now() + WALK_MAX_MS
  let visited = 0
  let total = 0

  const walk = async (dir: string): Promise<void> => {
    if (visited >= WALK_MAX_ENTRIES || Date.now() > deadline) return
    let items: import('node:fs').Dirent[]
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (visited >= WALK_MAX_ENTRIES || Date.now() > deadline) return
      visited++
      const full = join(dir, item.name)
      if (item.isDirectory()) {
        await walk(full)
      } else if (item.isFile()) {
        try {
          total += (await stat(full)).size
        } catch {
          // Archivo bloqueado o borrado a mitad del recorrido: se ignora.
        }
      }
    }
  }

  await walk(path)
  return total
}

export async function inspectWorkspace(path: string): Promise<WorkspaceInspection> {
  const empty = { entries: [] as WorkspaceEntry[], entryCount: 0, totalBytes: 0 }

  const reject = (rejection: WorkspaceRejection): WorkspaceInspection => ({
    path,
    rejection,
    rejectionMessage: REJECTION_MESSAGES[rejection],
    ...empty
  })

  try {
    if (!(await stat(path)).isDirectory()) return reject('not-a-directory')
  } catch {
    return reject('not-found')
  }

  const rejection = checkRejection(path)
  if (rejection) return reject(rejection)

  try {
    await access(path, constants.R_OK)
  } catch {
    return reject('not-writable')
  }
  if (!(await isWritable(path))) return reject('not-writable')

  // `withFileTypes` incluye ocultos y del sistema: contarlos importa, porque
  // tambien se borrarian.
  const items = await readdir(path, { withFileTypes: true })
  const entries: WorkspaceEntry[] = items.map((item) => ({
    name: item.name,
    isDirectory: item.isDirectory()
  }))

  return {
    path,
    rejection: null,
    rejectionMessage: null,
    entries,
    entryCount: entries.length,
    totalBytes: entries.length > 0 ? await walkSize(path) : 0
  }
}

/**
 * Vacia el contenido de la carpeta, no la carpeta misma.
 *
 * Va a la Papelera de reciclaje siempre que se pueda: si el usuario se equivoco
 * de carpeta pese a las advertencias, todavia puede recuperar lo suyo. Solo se
 * usa borrado permanente cuando la Papelera no esta disponible (unidad de red,
 * archivo demasiado grande), que es donde `trashItem` falla.
 */
export async function clearWorkspace(path: string): Promise<ClearResult> {
  const rejection = checkRejection(path)
  if (rejection) {
    // Segunda comprobacion antes de borrar: el renderer no es la ultima palabra.
    throw new Error(REJECTION_MESSAGES[rejection])
  }

  const items = await readdir(path, { withFileTypes: true })
  const result: ClearResult = { deleted: 0, failed: [] }

  for (const item of items) {
    const full = join(path, item.name)
    try {
      await shell.trashItem(full)
      result.deleted++
    } catch {
      try {
        await rm(full, { recursive: true, force: true })
        result.deleted++
      } catch (error) {
        result.failed.push({
          name: item.name,
          reason: error instanceof Error ? error.message : 'Error desconocido'
        })
      }
    }
  }

  return result
}
