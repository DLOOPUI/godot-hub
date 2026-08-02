import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { net, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import yauzl from 'yauzl'
import { getConfig, setConfig } from './config'
import { log } from './logger'
import { notifyFailed, notifyInstalled } from './notify'
import type {
  CleanupMode,
  GodotFlavor,
  InstallDone,
  InstallError,
  InstallPhase,
  InstallProgress,
  InstalledVersion,
  Release
} from '../shared/types'

export interface InstallParams {
  release: Release
  flavor: GodotFlavor
  cleanup: CleanupMode
}

/** Subcarpeta de trabajo para descargas a medias. Se borra al terminar. */
const TEMP_DIR = '.tmp'
const PROGRESS_INTERVAL_MS = 120

interface Job {
  id: string
  controller: AbortController
  canceled: boolean
}

const jobs = new Map<string, Job>()

class CanceledError extends Error {
  constructor() {
    super('Instalación cancelada.')
    this.name = 'CanceledError'
  }
}

/**
 * Nombre de la carpeta destino, derivado del asset:
 *   Godot_v4.7.1-stable_win64.exe.zip  -> Godot_v4.7.1-stable_win64
 *   Godot_v4.7.1-stable_mono_win64.zip -> Godot_v4.7.1-stable_mono_win64
 */
function folderNameFor(assetName: string): string {
  return assetName.replace(/\.zip$/i, '').replace(/\.exe$/i, '')
}

function emit(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

/**
 * Descarga a disco informando del progreso.
 *
 * El contador va en un Transform dentro del pipeline, no en un listener 'data':
 * suscribirse a 'data' pone el stream en modo fluido antes de que el destino
 * este conectado, y cualquier trozo emitido en ese hueco se contaria sin
 * llegar a escribirse.
 */
async function download(
  url: string,
  destination: string,
  job: Job,
  report: (received: number, total: number, speedBps: number, etaSec: number | null) => void
): Promise<number> {
  const response = await net.fetch(url, { signal: job.controller.signal })
  if (!response.ok) throw new Error(`La descarga falló con estado ${response.status}.`)
  if (!response.body) throw new Error('La respuesta de descarga vino vacía.')

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  let lastEmit = 0
  const startedAt = Date.now()

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length

      const now = Date.now()
      if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now
        const elapsed = (now - startedAt) / 1000
        const speed = elapsed > 0 ? received / elapsed : 0
        const eta = speed > 0 && total > received ? (total - received) / speed : null
        report(received, total, speed, eta)
      }
      callback(null, chunk)
    }
  })

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    meter,
    createWriteStream(destination)
  )
  report(received, total || received, 0, 0)

  // El servidor dijo cuanto iba a mandar: si no cuadra, la descarga se corto
  // limpiamente y el archivo esta a medias.
  if (total > 0 && received !== total) {
    throw new Error(
      `La descarga quedó incompleta (${received} de ${total} bytes). Vuelve a intentarlo.`
    )
  }

  const written = (await stat(destination)).size
  if (written !== received) {
    throw new Error(`El archivo escrito no coincide con lo descargado (${written} de ${received} bytes).`)
  }

  return received
}

/**
 * SHA-512 del archivo ya escrito.
 *
 * Se lee de disco a proposito, en vez de hashear el flujo de red al vuelo:
 * lo que hay que verificar es el archivo que se va a descomprimir, no los bytes
 * que pasaron por la conexion. Si algo los altera despues de recibirlos —una
 * escritura parcial, un antivirus, un disco con problemas— hashear el flujo
 * daria por bueno un archivo corrupto, y el fallo aparecería mucho mas tarde
 * como un error de descompresion imposible de interpretar.
 */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** Descarga SHA512-SUMS.txt y saca el hash esperado del asset. */
async function expectedChecksum(url: string, assetName: string, job: Job): Promise<string> {
  const response = await net.fetch(url, { signal: job.controller.signal })
  if (!response.ok) throw new Error(`No se pudo leer SHA512-SUMS.txt (estado ${response.status}).`)

  const text = await response.text()
  for (const line of text.split(/\r?\n/)) {
    // Formato estandar de sha512sum: "<hex>  <nombre>" (o "*<nombre>" en binario).
    const match = /^([0-9a-f]{128})\s+\*?(.+)$/i.exec(line.trim())
    if (match && basename(match[2]!.trim()) === assetName) return match[1]!.toLowerCase()
  }
  throw new Error(`SHA512-SUMS.txt no incluye una entrada para ${assetName}.`)
}

/**
 * Extrae el zip en `targetDir`.
 *
 * Descarta el directorio raiz cuando el zip ya trae uno, para no acabar con
 * Godot_..._mono_win64/Godot_..._mono_win64/.
 *
 * Sobre zip-slip: yauzl ya rechaza por su cuenta rutas absolutas y cualquier
 * nombre con ".." (probado en test/installer.test.ts con las cinco variantes),
 * asi que la comprobacion de mas abajo no llega a dispararse hoy. Se mantiene
 * como segunda capa por si esa validacion cambia en una version futura.
 */
async function extract(zipPath: string, targetDir: string, job: Job): Promise<void> {
  const entries = await readZipEntries(zipPath)
  const rootPrefix = commonRootDir(entries.map((entry) => entry.fileName))

  await mkdir(targetDir, { recursive: true })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        rejectPromise(openError ?? new Error('No se pudo abrir el archivo descargado.'))
        return
      }

      const fail = (error: Error): void => {
        zipfile.close()
        rejectPromise(error)
      }

      zipfile.readEntry()

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (job.canceled) {
          fail(new CanceledError())
          return
        }

        const relativeName = rootPrefix
          ? entry.fileName.slice(rootPrefix.length).replace(/^\/+/, '')
          : entry.fileName

        if (!relativeName) {
          zipfile.readEntry()
          return
        }

        const destination = resolve(targetDir, relativeName)
        // Red de seguridad: ver la nota sobre zip-slip en la cabecera.
        const inside = relative(targetDir, destination)
        if (inside.startsWith('..') || resolve(destination) === resolve(targetDir)) {
          fail(new Error(`El archivo contiene una ruta no permitida: ${entry.fileName}`))
          return
        }

        if (/\/$/.test(entry.fileName)) {
          void mkdir(destination, { recursive: true }).then(
            () => zipfile.readEntry(),
            (error: Error) => fail(error)
          )
          return
        }

        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError ?? new Error(`No se pudo leer ${entry.fileName}.`))
            return
          }
          void mkdir(dirname(destination), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(destination)))
            .then(
              () => zipfile.readEntry(),
              (error: Error) => fail(error)
            )
        })
      })

      zipfile.on('end', () => resolvePromise())
      zipfile.on('error', (error: Error) => rejectPromise(error))
    })
  })
}

function readZipEntries(zipPath: string): Promise<yauzl.Entry[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error || !zipfile) {
        rejectPromise(error ?? new Error('No se pudo abrir el archivo descargado.'))
        return
      }
      const entries: yauzl.Entry[] = []
      zipfile.readEntry()
      zipfile.on('entry', (entry: yauzl.Entry) => {
        entries.push(entry)
        zipfile.readEntry()
      })
      zipfile.on('end', () => resolvePromise(entries))
      zipfile.on('error', rejectPromise)
    })
  })
}

/** Prefijo comun solo si TODAS las entradas cuelgan del mismo directorio raiz. */
function commonRootDir(names: string[]): string | null {
  if (names.length === 0) return null
  const first = names[0]!.split('/')[0]
  if (!first) return null
  const isRoot = names.every((name) => name === first || name.startsWith(`${first}/`))
  const hasNested = names.some((name) => name.startsWith(`${first}/`) && name !== `${first}/`)
  return isRoot && hasNested ? first : null
}

/** Ejecutable principal: el de Godot, no el `_console.exe` que lo acompaña. */
async function findExecutable(dir: string): Promise<string | null> {
  const found: string[] = []
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 2) return
    for (const item of await readdir(current, { withFileTypes: true })) {
      const full = join(current, item.name)
      if (item.isDirectory()) await walk(full, depth + 1)
      else if (/\.exe$/i.test(item.name)) found.push(full)
    }
  }
  await walk(dir, 0)
  if (found.length === 0) return null
  return found.find((path) => !/_console\.exe$/i.test(path)) ?? found[0]!
}

/**
 * Borra las versiones que la app registro como instaladas.
 *
 * Deliberadamente NO vacia la carpeta entera: el borrado total se hizo una vez,
 * con confirmacion explicita, al configurar el area de trabajo. Repetirlo aqui
 * destruiria cualquier archivo que el usuario dejara despues.
 */
async function removeInstalled(workspace: string, installed: InstalledVersion[]): Promise<void> {
  for (const item of installed) {
    const target = join(workspace, item.folder)
    if (relative(workspace, target).startsWith('..')) continue // ruta manipulada
    try {
      await stat(target)
    } catch {
      continue // ya no esta
    }
    try {
      await shell.trashItem(target)
    } catch {
      await rm(target, { recursive: true, force: true })
    }
  }
}

export function cancelInstall(jobId: string): void {
  const job = jobs.get(jobId)
  if (!job) return
  job.canceled = true
  job.controller.abort()
}

export async function startInstall(
  win: BrowserWindow,
  jobId: string,
  params: InstallParams
): Promise<void> {
  const job: Job = { id: jobId, controller: new AbortController(), canceled: false }
  jobs.set(jobId, job)

  let phase: InstallPhase = 'cleanup'
  const config = getConfig()
  const workspace = config.workspacePath

  const progress = (
    receivedBytes = 0,
    totalBytes = 0,
    speedBps = 0,
    etaSec: number | null = null
  ): void => {
    emit(win, 'install:progress', {
      jobId,
      phase,
      receivedBytes,
      totalBytes,
      speedBps,
      etaSec
    } satisfies InstallProgress)
  }

  let tempFile: string | null = null

  try {
    if (!workspace) throw new Error('No hay carpeta de trabajo configurada.')

    const asset = params.release.assets[params.flavor]
    if (!asset) throw new Error('Esta versión no tiene build de Windows para la variante elegida.')

    const checksumsAsset = params.release.assets.checksums
    if (!checksumsAsset) {
      // Es un ejecutable descargado de internet: sin comprobacion no se instala.
      throw new Error('Esta versión no publica SHA512-SUMS.txt y no se puede verificar la descarga.')
    }

    // 1. Limpieza de la version anterior
    progress()
    if (params.cleanup === 'delete' && config.installed.length > 0) {
      await removeInstalled(workspace, config.installed)
      setConfig({ installed: [] })
    }
    if (job.canceled) throw new CanceledError()

    // 2. Descarga
    phase = 'download'
    const tempDir = join(workspace, TEMP_DIR)
    await mkdir(tempDir, { recursive: true })
    tempFile = join(tempDir, `${asset.name}.part`)

    const downloadedBytes = await download(asset.url, tempFile, job, (received, total, speed, eta) =>
      progress(received, total, speed, eta)
    )
    if (job.canceled) throw new CanceledError()

    // 3. Verificacion (sobre el archivo en disco, no sobre el flujo)
    phase = 'verify'
    progress(downloadedBytes, downloadedBytes)
    const expected = await expectedChecksum(checksumsAsset.url, asset.name, job)
    const actualHash = await hashFile(tempFile)
    if (expected !== actualHash) {
      throw new Error('El archivo descargado no coincide con su SHA-512. Se ha descartado.')
    }
    if (job.canceled) throw new CanceledError()
    log('info', 'descarga verificada', { jobId, bytes: downloadedBytes })

    // 4. Extraccion
    phase = 'extract'
    progress(asset.size, asset.size)
    const folder = folderNameFor(asset.name)
    const targetDir = join(workspace, folder)
    await rm(targetDir, { recursive: true, force: true }) // reinstalar sobre restos
    const zipPath = join(tempDir, asset.name)
    await rename(tempFile, zipPath)
    tempFile = zipPath
    await extract(zipPath, targetDir, job)
    if (job.canceled) throw new CanceledError()

    // 5. Cierre
    phase = 'finalize'
    progress(asset.size, asset.size)
    await rm(tempDir, { recursive: true, force: true })
    tempFile = null

    const exePath = (await findExecutable(targetDir)) ?? join(targetDir, folder)
    const entry: InstalledVersion = {
      tag: params.release.tag,
      folder,
      exe: basename(exePath),
      flavor: params.flavor,
      installedAt: new Date().toISOString()
    }
    const kept = params.cleanup === 'delete' ? [] : getConfig().installed.filter((i) => i.folder !== folder)
    setConfig({ installed: [...kept, entry] })

    emit(win, 'install:done', {
      jobId,
      tag: params.release.tag,
      folder,
      exePath
    } satisfies InstallDone)

    log('info', 'instalación completada', { jobId, tag: params.release.tag, folder })
    notifyInstalled(params.release.tag, exePath, workspace)
  } catch (error) {
    const canceled = job.canceled || (error instanceof Error && error.name === 'AbortError')
    // Un parcial que se queda es basura que el usuario no pidio.
    if (tempFile) await rm(dirname(tempFile), { recursive: true, force: true }).catch(() => undefined)

    const message = canceled ? 'Instalación cancelada.' : describe(error)
    log(canceled ? 'info' : 'error', 'instalación interrumpida', { jobId, phase, canceled, message })
    emit(win, 'install:error', { jobId, phase, message, canceled } satisfies InstallError)

    // Con la ventana delante ya se ve el modal de error; el toast solo aporta
    // cuando el usuario se fue a otra cosa mientras descargaba.
    if (!canceled && !win.isDestroyed() && !win.isFocused()) {
      notifyFailed(params.release.tag, message)
    }
  } finally {
    jobs.delete(jobId)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (/ENOTFOUND|ECONNREFUSED|ENETUNREACH|net::/i.test(error.message)) {
      return 'Se perdió la conexión durante la descarga.'
    }
    if (/ENOSPC/i.test(error.message)) return 'No queda espacio en disco.'
    return error.message
  }
  return 'Error desconocido durante la instalación.'
}

/** Usado por el arranque para limpiar restos de una sesion interrumpida. */
export async function clearTempDir(workspace: string): Promise<void> {
  await rm(join(workspace, TEMP_DIR), { recursive: true, force: true }).catch(() => undefined)
}
