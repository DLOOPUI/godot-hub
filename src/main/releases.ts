import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import { compareVersionsDesc } from '../shared/version'
import type { Release, ReleaseAsset, ReleasesResult } from '../shared/types'

/**
 * Los builds oficiales de Godot 4.x se publican como releases de este repo.
 * (Las 3.x viven en godotengine/godot; si algun dia hacen falta, se consulta
 * esa segunda fuente y se fusiona antes de ordenar.)
 */
const RELEASES_URL = 'https://api.github.com/repos/godotengine/godot-builds/releases?per_page=100'

const MAX_RELEASES = 10
/** Ventana en la que se sirve cache sin tocar la red. */
const TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

interface CacheFile {
  etag: string | null
  fetchedAt: string
  items: Release[]
}

let memoryCache: CacheFile | null = null

function cachePath(): string {
  return join(app.getPath('userData'), 'releases-cache.json')
}

function readCache(): CacheFile | null {
  if (memoryCache) return memoryCache
  try {
    const path = cachePath()
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CacheFile
    if (!Array.isArray(parsed.items)) return null
    memoryCache = parsed
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache: CacheFile): void {
  try {
    const path = cachePath()
    const temp = `${path}.tmp`
    writeFileSync(temp, JSON.stringify(cache), 'utf8')
    renameSync(temp, path)
    memoryCache = cache
  } catch {
    // Una cache que no se puede escribir degrada el rendimiento, no la funcion.
  }
}

interface GithubAsset {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
}

interface GithubRelease {
  tag_name?: unknown
  draft?: unknown
  published_at?: unknown
  assets?: unknown
}

function toAsset(raw: GithubAsset): ReleaseAsset | null {
  if (typeof raw.name !== 'string' || typeof raw.browser_download_url !== 'string') return null
  return {
    name: raw.name,
    url: raw.browser_download_url,
    size: typeof raw.size === 'number' ? raw.size : 0
  }
}

/**
 * Nombres oficiales de los assets de Windows 64-bit:
 *   Godot_v4.5-stable_win64.exe.zip        (estandar)
 *   Godot_v4.5-stable_mono_win64.zip       (.NET)
 *   SHA512-SUMS.txt                        (verificacion)
 */
function classifyAssets(raw: unknown): Release['assets'] {
  const assets: Release['assets'] = {}
  if (!Array.isArray(raw)) return assets

  for (const item of raw as GithubAsset[]) {
    const asset = toAsset(item)
    if (!asset) continue
    const name = asset.name

    if (name === 'SHA512-SUMS.txt') {
      assets.checksums = asset
    } else if (/_mono_win64\.zip$/i.test(name)) {
      assets.mono = asset
    } else if (/_win64\.exe\.zip$/i.test(name)) {
      assets.standard = asset
    }
  }
  return assets
}

function parseReleases(payload: unknown): Release[] {
  if (!Array.isArray(payload)) return []

  const releases: Release[] = []
  for (const item of payload as GithubRelease[]) {
    const tag = item.tag_name
    if (typeof tag !== 'string' || !tag.endsWith('-stable') || item.draft === true) continue

    const version = tag.slice(0, -'-stable'.length)
    if (!/^\d+(\.\d+)*$/.test(version)) continue // descarta 4.5-stable-rc y similares

    releases.push({
      tag,
      version,
      publishedAt: typeof item.published_at === 'string' ? item.published_at : '',
      assets: classifyAssets(item.assets)
    })
  }

  releases.sort((a, b) => compareVersionsDesc(a.version, b.version))
  return releases.slice(0, MAX_RELEASES)
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'La consulta a GitHub tardó demasiado.'
    if (/ENOTFOUND|ECONNREFUSED|ENETUNREACH|net::/i.test(error.message)) {
      return 'Sin conexión con GitHub.'
    }
    return error.message
  }
  return 'Error desconocido al consultar GitHub.'
}

/**
 * Lista las 10 ultimas versiones stable.
 *
 * La API anonima de GitHub permite 60 peticiones/hora por IP, asi que se sirve
 * cache dentro del TTL y, fuera de el, se pregunta con ETag: un 304 no consume
 * cuota de contenido y evita volver a parsear ~1 MB de JSON.
 */
export async function listReleases(force = false): Promise<ReleasesResult> {
  const cache = readCache()
  const fresh = cache !== null && Date.now() - Date.parse(cache.fetchedAt) < TTL_MS

  if (cache && fresh && !force) {
    return { items: cache.items, fetchedAt: cache.fetchedAt, stale: false, error: null }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'godot-hub'
    }
    if (cache?.etag && !force) headers['If-None-Match'] = cache.etag

    const response = await net.fetch(RELEASES_URL, { headers, signal: controller.signal })

    if (response.status === 304 && cache) {
      const refreshed: CacheFile = { ...cache, fetchedAt: new Date().toISOString() }
      writeCache(refreshed)
      return { items: cache.items, fetchedAt: refreshed.fetchedAt, stale: false, error: null }
    }

    if (response.status === 403 || response.status === 429) {
      // Limite de peticiones agotado: es lo que mas probablemente se rompa.
      const reset = response.headers.get('x-ratelimit-reset')
      const when = reset
        ? new Date(Number(reset) * 1000).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
          })
        : null
      throw new Error(
        `GitHub limitó las consultas${when ? `. Vuelve a intentarlo a partir de las ${when}` : ''}.`
      )
    }

    if (!response.ok) {
      throw new Error(`GitHub respondió ${response.status}.`)
    }

    const items = parseReleases(await response.json())
    if (items.length === 0) {
      throw new Error('GitHub no devolvió ninguna versión stable.')
    }

    const next: CacheFile = {
      etag: response.headers.get('etag'),
      fetchedAt: new Date().toISOString(),
      items
    }
    writeCache(next)
    return { items, fetchedAt: next.fetchedAt, stale: false, error: null }
  } catch (error) {
    const message = describeError(error)
    // Con cache se sigue trabajando y solo se avisa de la antiguedad; sin ella
    // no hay nada que mostrar y el error es el estado.
    if (cache) {
      return { items: cache.items, fetchedAt: cache.fetchedAt, stale: true, error: message }
    }
    return { items: [], fetchedAt: null, stale: false, error: message }
  } finally {
    clearTimeout(timeout)
  }
}
