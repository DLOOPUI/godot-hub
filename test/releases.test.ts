import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from './helpers/electron-mock'
import type { ReleasesResult } from '../src/shared/types'

/**
 * `releases.ts` guarda cache en memoria y en disco. Cada prueba recarga el
 * modulo y borra el archivo para partir siempre del mismo estado.
 */
async function freshListReleases(): Promise<(force?: boolean) => Promise<ReleasesResult>> {
  vi.resetModules()
  await rm(join(app.getPath('userData'), 'releases-cache.json'), { force: true })
  const module = await import('../src/main/releases')
  return module.listReleases
}

interface FakeRelease {
  tag_name: string
  draft?: boolean
  published_at?: string
  assets?: { name: string; browser_download_url: string; size: number }[]
}

function githubRelease(tag: string, extra: Partial<FakeRelease> = {}): FakeRelease {
  return {
    tag_name: tag,
    draft: false,
    published_at: '2026-01-01T00:00:00Z',
    assets: [
      { name: `Godot_v${tag}_win64.exe.zip`, browser_download_url: `https://x/${tag}/std`, size: 100 },
      { name: `Godot_v${tag}_mono_win64.zip`, browser_download_url: `https://x/${tag}/mono`, size: 200 },
      { name: 'SHA512-SUMS.txt', browser_download_url: `https://x/${tag}/sums`, size: 1 }
    ],
    ...extra
  }
}

function jsonResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('listReleases', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('parseo y orden', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    const setup = async (payload: unknown): Promise<ReleasesResult> => {
      fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload))
      vi.stubGlobal('fetch', fetchMock)
      const listReleases = await freshListReleases()
      return listReleases()
    }

    it('descarta lo que no sea stable', async () => {
      const result = await setup([
        githubRelease('4.5-stable'),
        githubRelease('4.6-beta1'),
        githubRelease('4.6-rc2'),
        githubRelease('4.4-dev3')
      ])
      expect(result.items.map((r) => r.tag)).toEqual(['4.5-stable'])
    })

    it('descarta los borradores', async () => {
      const result = await setup([
        githubRelease('4.5-stable'),
        githubRelease('4.6-stable', { draft: true })
      ])
      expect(result.items.map((r) => r.tag)).toEqual(['4.5-stable'])
    })

    it('ordena por versión, no alfabéticamente', async () => {
      // El caso que rompe un sort de cadenas: "4.10" < "4.9" como texto.
      const result = await setup([
        githubRelease('4.9-stable'),
        githubRelease('4.10-stable'),
        githubRelease('4.10.1-stable'),
        githubRelease('5.0-stable')
      ])
      expect(result.items.map((r) => r.tag)).toEqual([
        '5.0-stable',
        '4.10.1-stable',
        '4.10-stable',
        '4.9-stable'
      ])
    })

    it('ordena por versión aunque la fecha diga otra cosa', async () => {
      // Un parche retroportado sale despues que una minor mas nueva.
      const result = await setup([
        githubRelease('4.6-stable', { published_at: '2026-01-26T00:00:00Z' }),
        githubRelease('4.5.2-stable', { published_at: '2026-03-19T00:00:00Z' })
      ])
      expect(result.items.map((r) => r.tag)).toEqual(['4.6-stable', '4.5.2-stable'])
    })

    it('se queda con las 10 más recientes', async () => {
      const many = Array.from({ length: 25 }, (_, i) => githubRelease(`4.${i}-stable`))
      const result = await setup(many)
      expect(result.items).toHaveLength(10)
      expect(result.items[0]?.tag).toBe('4.24-stable')
    })

    it('clasifica los assets de Windows', async () => {
      const result = await setup([githubRelease('4.5-stable')])
      const release = result.items[0]!

      expect(release.version).toBe('4.5')
      expect(release.assets.standard?.name).toBe('Godot_v4.5-stable_win64.exe.zip')
      expect(release.assets.mono?.name).toBe('Godot_v4.5-stable_mono_win64.zip')
      expect(release.assets.checksums?.name).toBe('SHA512-SUMS.txt')
    })

    it('ignora los assets de otras plataformas', async () => {
      const result = await setup([
        githubRelease('4.5-stable', {
          assets: [
            { name: 'Godot_v4.5-stable_linux.x86_64.zip', browser_download_url: 'https://x/l', size: 1 },
            { name: 'Godot_v4.5-stable_macos.universal.zip', browser_download_url: 'https://x/m', size: 1 }
          ]
        })
      ])
      expect(result.items[0]?.assets.standard).toBeUndefined()
      expect(result.items[0]?.assets.mono).toBeUndefined()
    })
  })

  describe('caché', () => {
    it('la segunda llamada no toca la red', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([githubRelease('4.5-stable')]))
      vi.stubGlobal('fetch', fetchMock)
      const listReleases = await freshListReleases()

      await listReleases()
      const second = await listReleases()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(second.items).toHaveLength(1)
      expect(second.stale).toBe(false)
    })

    it('al forzar, revalida con ETag y acepta un 304', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([githubRelease('4.5-stable')], { etag: 'W/"abc"' }))
        .mockResolvedValueOnce(new Response(null, { status: 304 }))
      vi.stubGlobal('fetch', fetchMock)
      const listReleases = await freshListReleases()

      await listReleases()
      const refreshed = await listReleases(true)

      expect(refreshed.items).toHaveLength(1)
      expect(refreshed.stale).toBe(false)
      // Al forzar NO se manda If-None-Match: se quiere la lista completa.
      expect(fetchMock.mock.calls[1]?.[1]?.headers?.['If-None-Match']).toBeUndefined()
    })

    it('sirve la caché marcada como antigua si se cae la red', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([githubRelease('4.5-stable')]))
        .mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'))
      vi.stubGlobal('fetch', fetchMock)
      const listReleases = await freshListReleases()

      await listReleases()
      const offline = await listReleases(true)

      expect(offline.items).toHaveLength(1)
      expect(offline.stale).toBe(true)
      expect(offline.error).toMatch(/Sin conexión/)
      expect(offline.fetchedAt).not.toBeNull()
    })

    it('sin caché y sin red, devuelve el error como estado', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED')))
      const listReleases = await freshListReleases()

      const result = await listReleases()
      expect(result.items).toEqual([])
      expect(result.stale).toBe(false)
      expect(result.error).toMatch(/Sin conexión/)
    })
  })

  describe('errores de GitHub', () => {
    it('explica el límite de peticiones con la hora de reintento', async () => {
      const reset = String(Math.floor(Date.parse('2026-01-01T15:30:00Z') / 1000))
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('', { status: 403, headers: { 'x-ratelimit-reset': reset } })
        )
      )
      const listReleases = await freshListReleases()

      const result = await listReleases()
      expect(result.error).toMatch(/limitó las consultas/)
      expect(result.error).toMatch(/\d{2}:\d{2}/)
    })

    it('informa de un estado inesperado', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
      const listReleases = await freshListReleases()

      expect((await listReleases()).error).toMatch(/respondió 500/)
    })

    it('trata una respuesta sin versiones stable como error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([githubRelease('4.6-rc1')])))
      const listReleases = await freshListReleases()

      const result = await listReleases()
      expect(result.items).toEqual([])
      expect(result.error).toMatch(/ninguna versión stable/)
    })
  })
})
