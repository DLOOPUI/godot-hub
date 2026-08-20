import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import { setConfig } from '../src/main/config'
import { startInstall } from '../src/main/installer'
import { makeZip } from './helpers/zip'
import type { InstallDone, InstallError } from '../src/shared/types'

const ASSET = 'Godot_v9.9-stable_win64.exe.zip'

/**
 * Reproduce las condiciones reales de una descarga de Godot: zip comprimido con
 * DEFLATE, decenas de trozos y pausas entre ellos. Con el archivo entero en un
 * solo chunk (como en el resto de pruebas) una perdida de bytes al principio del
 * flujo pasaria desapercibida.
 */
function chunkedServer(payload: Buffer, chunkSize: number, delayMs: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (request, response) => {
    if (request.url?.includes('SHA512-SUMS')) {
      const body = `${createHash('sha512').update(payload).digest('hex')}  ${ASSET}\n`
      response.writeHead(200, { 'content-length': String(Buffer.byteLength(body)) })
      response.end(body)
      return
    }

    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(payload.length)
    })

    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      if (!response.write(payload.subarray(offset, offset + chunkSize))) {
        await new Promise((resolve) => response.once('drain', resolve))
      }
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    response.end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || address === null) throw new Error('sin dirección')
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })
}

function install(
  jobId: string,
  baseUrl: string
): Promise<{ done: InstallDone | null; error: InstallError | null }> {
  return new Promise((resolve) => {
    const win = {
      isDestroyed: () => false,
      isFocused: () => true,
      webContents: {
        send: (channel: string, payload: unknown) => {
          if (channel === 'install:done') resolve({ done: payload as InstallDone, error: null })
          if (channel === 'install:error') resolve({ done: null, error: payload as InstallError })
        }
      }
    } as unknown as BrowserWindow

    void startInstall(win, jobId, {
      release: {
        tag: '9.9-stable',
        version: '9.9',
        publishedAt: '2026-01-01T00:00:00Z',
        assets: {
          standard: { name: ASSET, url: `${baseUrl}/${ASSET}`, size: 0 },
          checksums: { name: 'SHA512-SUMS.txt', url: `${baseUrl}/SHA512-SUMS.txt`, size: 0 }
        }
      },
      flavor: 'standard',
      cleanup: 'keep'
    })
  })
}

describe('integridad de la descarga', () => {
  let workspace: string
  let server: { url: string; close: () => Promise<void> } | null = null

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'gau-dl-'))
    setConfig({ workspacePath: workspace, workspaceConfirmed: true, installed: [] })
  })

  afterEach(async () => {
    await server?.close()
    server = null
    await rm(workspace, { recursive: true, force: true })
  })

  it('escribe en disco exactamente lo que se descargó, con el zip comprimido y troceado', async () => {
    // Contenido incompresible: obliga a que el DEFLATE mueva datos de verdad.
    const contents = randomBytes(4 * 1024 * 1024)
    const zip = makeZip(
      [
        { name: 'Godot_v9.9-stable_win64.exe', content: contents },
        { name: 'datos/extra.bin', content: randomBytes(512 * 1024) }
      ],
      { deflate: true }
    )

    server = await chunkedServer(zip, 64 * 1024, 1)
    const result = await install('integridad', server.url)

    expect(result.error).toBeNull()
    expect(result.done).not.toBeNull()

    // Byte a byte: si se perdiera un solo trozo del flujo, el inflate fallaría
    // o el contenido no coincidiría.
    const extracted = await readFile(result.done!.exePath)
    expect(extracted.length).toBe(contents.length)
    expect(createHash('sha512').update(extracted).digest('hex')).toBe(
      createHash('sha512').update(contents).digest('hex')
    )

    const extra = await stat(join(workspace, 'Godot_v9.9-stable_win64', 'datos', 'extra.bin'))
    expect(extra.size).toBe(512 * 1024)
  })

  it('detecta en la verificación un archivo alterado tras descargarlo', async () => {
    // El caso que se escapaba hasheando el flujo de red: los bytes recibidos
    // eran correctos, pero lo que quedaba en disco no. El SHA-512 daba el visto
    // bueno y el fallo salía luego como "invalid block type" al descomprimir.
    const zip = makeZip([{ name: 'Godot_v9.9-stable_win64.exe', content: randomBytes(256 * 1024) }], {
      deflate: true
    })

    // La descarga se sirve despacio (32 trozos x 4 ms) a proposito: con el
    // archivo entero de una vez terminaba antes de que el saboteador llegara a
    // actuar, y la prueba pasaba o fallaba segun el reloj.
    server = await chunkedServer(zip, 8 * 1024, 4)

    const tempFile = join(workspace, '.tmp', `${ASSET}.part`)
    const saboteur = setInterval(() => {
      void writeFile(tempFile, Buffer.alloc(64, 0)).catch(() => undefined)
    }, 3)

    const result = await install('alterado', server.url)
    clearInterval(saboteur)

    expect(result.done, 'la instalación no debía completarse').toBeNull()
    expect(result.error?.phase).toBe('verify')
    expect(result.error?.message).toMatch(/SHA-512|incompleta|no coincide/)
    // El zip corrupto no llega nunca a la fase de extracción.
    expect(result.error?.message).not.toMatch(/invalid block type/)
  })

  it('repite la descarga varias veces sin corromperse', async () => {
    // Una perdida de bytes al arrancar el flujo es una carrera: no falla siempre.
    const contents = randomBytes(1024 * 1024)
    const zip = makeZip([{ name: 'Godot_v9.9-stable_win64.exe', content: contents }], {
      deflate: true
    })
    const expected = createHash('sha512').update(contents).digest('hex')

    for (let attempt = 0; attempt < 6; attempt++) {
      server = await chunkedServer(zip, 16 * 1024, 0)
      const result = await install(`repeticion-${attempt}`, server.url)

      expect(result.error, `intento ${attempt}`).toBeNull()
      const extracted = await readFile(result.done!.exePath)
      expect(createHash('sha512').update(extracted).digest('hex'), `intento ${attempt}`).toBe(expected)

      await server.close()
      server = null
      await rm(join(workspace, 'Godot_v9.9-stable_win64'), { recursive: true, force: true })
    }
  })
})
