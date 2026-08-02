import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import { setConfig, getConfig } from '../src/main/config'
import { cancelInstall, startInstall } from '../src/main/installer'
import { makeZip } from './helpers/zip'
import { startServer } from './helpers/server'
import type { TestServer } from './helpers/server'
import type { InstallDone, InstallError, InstallProgress, Release } from '../src/shared/types'

const ASSET = 'Godot_v9.9-stable_win64.exe.zip'

interface RunResult {
  done: InstallDone | null
  error: InstallError | null
  progress: InstallProgress[]
}

function sha512(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('hex')
}

function releaseFor(server: TestServer, assetName = ASSET): Release {
  return {
    tag: '9.9-stable',
    version: '9.9',
    publishedAt: '2026-01-01T00:00:00Z',
    assets: {
      standard: { name: assetName, url: `${server.url}/${assetName}`, size: 0 },
      checksums: { name: 'SHA512-SUMS.txt', url: `${server.url}/SHA512-SUMS.txt`, size: 0 }
    }
  }
}

/** Ventana falsa: el instalador solo usa isDestroyed, isFocused y send. */
function run(
  jobId: string,
  release: Release,
  onProgress?: (progress: InstallProgress, cancel: () => void) => void
): Promise<RunResult> {
  return new Promise((resolve) => {
    const result: RunResult = { done: null, error: null, progress: [] }
    const win = {
      isDestroyed: () => false,
      isFocused: () => true,
      webContents: {
        send: (channel: string, payload: unknown) => {
          if (channel === 'install:progress') {
            result.progress.push(payload as InstallProgress)
            onProgress?.(payload as InstallProgress, () => cancelInstall(jobId))
          }
          if (channel === 'install:done') {
            result.done = payload as InstallDone
            resolve(result)
          }
          if (channel === 'install:error') {
            result.error = payload as InstallError
            resolve(result)
          }
        }
      }
    } as unknown as BrowserWindow

    void startInstall(win, jobId, { release, flavor: 'standard', cleanup: 'keep' })
  })
}

describe('installer', () => {
  let workspace: string
  let server: TestServer
  let zip: Buffer
  let checksums: string

  const serve = async (payload: Buffer, sums?: string): Promise<void> => {
    server = await startServer({
      [`/${ASSET}`]: () => ({ body: payload }),
      '/SHA512-SUMS.txt': () => ({ body: sums ?? `${sha512(payload)}  ${ASSET}\n` })
    })
  }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'gau-ws-'))
    setConfig({ workspacePath: workspace, workspaceConfirmed: true, installed: [] })
    zip = makeZip([
      { name: 'Godot_v9.9-stable_win64.exe', content: 'ejecutable-falso' },
      { name: 'Godot_v9.9-stable_win64_console.exe', content: 'consola' }
    ])
    checksums = `${sha512(zip)}  ${ASSET}\n`
  })

  afterEach(async () => {
    await server?.close()
    await rm(workspace, { recursive: true, force: true })
  })

  it('descarga, verifica y extrae', async () => {
    await serve(zip, checksums)
    const result = await run('ok', releaseFor(server))

    expect(result.error).toBeNull()
    expect(result.done?.folder).toBe('Godot_v9.9-stable_win64')

    const files = await readdir(join(workspace, 'Godot_v9.9-stable_win64'))
    expect(files.sort()).toEqual([
      'Godot_v9.9-stable_win64.exe',
      'Godot_v9.9-stable_win64_console.exe'
    ])
    expect(await readFile(result.done!.exePath, 'utf8')).toBe('ejecutable-falso')
  })

  it('elige el ejecutable principal y no el _console', async () => {
    await serve(zip, checksums)
    const result = await run('exe', releaseFor(server))

    expect(result.done?.exePath).toMatch(/Godot_v9\.9-stable_win64\.exe$/)
    expect(result.done?.exePath).not.toMatch(/_console\.exe$/)
    expect(getConfig().installed[0]?.exe).toBe('Godot_v9.9-stable_win64.exe')
  })

  it('registra la instalación en la configuración', async () => {
    await serve(zip, checksums)
    await run('cfg', releaseFor(server))

    expect(getConfig().installed).toEqual([
      expect.objectContaining({ tag: '9.9-stable', folder: 'Godot_v9.9-stable_win64', flavor: 'standard' })
    ])
  })

  it('aborta y descarta la descarga si el SHA-512 no coincide', async () => {
    await serve(zip, `${'a'.repeat(128)}  ${ASSET}\n`)
    const result = await run('hash', releaseFor(server))

    expect(result.done).toBeNull()
    expect(result.error?.phase).toBe('verify')
    expect(result.error?.canceled).toBe(false)
    expect(result.error?.message).toMatch(/SHA-512/)
    expect(await readdir(workspace)).toEqual([])
  })

  it('aborta si SHA512-SUMS.txt no menciona el asset', async () => {
    await serve(zip, `${sha512(zip)}  otro-archivo.zip\n`)
    const result = await run('sinentrada', releaseFor(server))

    expect(result.error?.phase).toBe('verify')
    expect(result.error?.message).toMatch(/no incluye una entrada/)
  })

  it('no instala una versión que no publica checksums', async () => {
    await serve(zip, checksums)
    const release = releaseFor(server)
    delete release.assets.checksums

    const result = await run('sinsums', release)
    expect(result.done).toBeNull()
    expect(result.error?.message).toMatch(/SHA512-SUMS\.txt/)
  })

  it('cancelar deja la carpeta como estaba', async () => {
    // Un zip grande da margen para cancelar a mitad de la descarga.
    const big = makeZip([{ name: 'data.bin', content: Buffer.alloc(6 * 1024 * 1024, 7) }])
    await serve(big, `${sha512(big)}  ${ASSET}\n`)

    const result = await run('cancel', releaseFor(server), (progress, cancel) => {
      if (progress.phase === 'download' && progress.receivedBytes > 0) cancel()
    })

    expect(result.done).toBeNull()
    expect(result.error?.canceled).toBe(true)
    expect(await readdir(workspace)).toEqual([])
  })

  it('informa de una descarga interrumpida', async () => {
    server = await startServer({
      [`/${ASSET}`]: () => ({ body: zip, truncate: true }),
      '/SHA512-SUMS.txt': () => ({ body: checksums })
    })

    const result = await run('corte', releaseFor(server))
    expect(result.done).toBeNull()
    expect(result.error?.canceled).toBe(false)
    expect(existsSync(join(workspace, '.tmp'))).toBe(false)
  })

  describe('seguridad de la extracción', () => {
    /**
     * Lo que importa es el efecto, no que capa lo impide: yauzl valida los
     * nombres ("invalid relative path") antes de que corra la comprobacion del
     * instalador. Se afirma que la instalacion falla y que no aparece nada
     * fuera del destino; el mensaje concreto puede venir de cualquiera de las
     * dos capas.
     */
    const escapes = [
      ['..', '../fuera.txt', 'fuera.txt'],
      ['varios niveles de ..', '../../../fuera-lejos.txt', 'fuera-lejos.txt'],
      ['una ruta absoluta', '/fuera-absoluta.txt', 'fuera-absoluta.txt'],
      ['una ruta con unidad de Windows', 'C:\\fuera-unidad.txt', 'fuera-unidad.txt'],
      ['una barra invertida', '..\\fuera-barra.txt', 'fuera-barra.txt']
    ] as const

    for (const [label, entryName, leakedName] of escapes) {
      it(`no deja escribir fuera del destino con ${label}`, async () => {
        const malicious = makeZip([
          { name: 'Godot_v9.9-stable_win64.exe', content: 'ok' },
          { name: entryName, content: 'no debería existir' }
        ])
        await serve(malicious, `${sha512(malicious)}  ${ASSET}\n`)

        const result = await run(`slip-${leakedName}`, releaseFor(server))

        expect(result.done).toBeNull()
        expect(result.error?.phase).toBe('extract')
        expect(existsSync(join(workspace, leakedName))).toBe(false)
        expect(existsSync(join(tmpdir(), leakedName))).toBe(false)
        // La carpeta destino no queda a medias con lo que si se pudo escribir.
        expect(existsSync(join(workspace, 'Godot_v9.9-stable_win64', leakedName))).toBe(false)
      })
    }

    it('descarta el directorio raíz cuando el zip ya trae uno', async () => {
      // Asi vienen los zips de la variante .NET de Godot.
      const nested = makeZip([
        { name: 'Godot_v9.9-stable_win64/', directory: true },
        { name: 'Godot_v9.9-stable_win64/Godot_v9.9-stable_win64.exe', content: 'exe' },
        { name: 'Godot_v9.9-stable_win64/GodotSharp/lib.dll', content: 'dll' }
      ])
      await serve(nested, `${sha512(nested)}  ${ASSET}\n`)

      const result = await run('anidado', releaseFor(server))
      expect(result.error).toBeNull()

      const target = join(workspace, 'Godot_v9.9-stable_win64')
      expect((await readdir(target)).sort()).toEqual(['GodotSharp', 'Godot_v9.9-stable_win64.exe'])
      // Lo que NO debe haber: la carpeta repetida dentro de si misma.
      expect(existsSync(join(target, 'Godot_v9.9-stable_win64'))).toBe(false)
    })
  })
})
