import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import type { NewsItem, NewsResult } from '../shared/types'

/** Feed oficial del blog de Godot: anuncios de versión y noticias del proyecto. */
const FEED_URL = 'https://godotengine.org/rss.xml'

const MAX_ITEMS = 12
/** Ventana en la que se sirve cache sin tocar la red. */
const TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

interface CacheFile {
  etag: string | null
  fetchedAt: string
  items: NewsItem[]
}

let memoryCache: CacheFile | null = null

function cachePath(): string {
  return join(app.getPath('userData'), 'news-cache.json')
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

/** Entidades XML basicas mas referencias numericas. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&') // el ultimo, o desharia los anteriores
}

function tagContent(block: string, tag: string): string {
  const match = new RegExp(String.raw`<${tag}(?:\s[^>]*)?>([\s\S]*?)</${tag}>`).exec(block)
  if (!match) return ''
  const raw = match[1] ?? ''
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  return decodeEntities((cdata ? (cdata[1] ?? '') : raw).trim())
}

/**
 * Parser acotado a este feed, en vez de una dependencia de XML generica.
 *
 * Se exporta para poder probarlo con el contenido real. Deliberadamente NO se
 * lee `<description>`: viene con HTML del servidor y meterlo en la interfaz
 * seria darle a un tercero la capacidad de inyectar marcado. El `<summary>` es
 * texto plano y basta para una tarjeta.
 */
export function parseFeed(xml: string): NewsItem[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  const items: NewsItem[] = []

  for (const block of blocks) {
    const title = tagContent(block, 'title')
    const link = tagContent(block, 'link')

    // Sin titulo no hay tarjeta; sin enlace https no hay nada que abrir, y
    // ademas evita colar esquemas raros en shell.openExternal.
    if (!title || !/^https:\/\//i.test(link)) continue

    const published = Date.parse(tagContent(block, 'pubDate'))

    items.push({
      title,
      link,
      summary: tagContent(block, 'summary'),
      category: tagContent(block, 'category'),
      publishedAt: Number.isNaN(published) ? '' : new Date(published).toISOString()
    })
  }

  items.sort((a, b) => Date.parse(b.publishedAt || '0') - Date.parse(a.publishedAt || '0'))
  return items.slice(0, MAX_ITEMS)
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'La consulta a godotengine.org tardó demasiado.'
    if (/ENOTFOUND|ECONNREFUSED|ENETUNREACH|net::/i.test(error.message)) {
      return 'Sin conexión con godotengine.org.'
    }
    return error.message
  }
  return 'Error desconocido al leer las noticias.'
}

/** Ultimas entradas del blog, con la misma politica de cache que las versiones. */
export async function listNews(force = false): Promise<NewsResult> {
  const cache = readCache()
  const fresh = cache !== null && Date.now() - Date.parse(cache.fetchedAt) < TTL_MS

  if (cache && fresh && !force) {
    return { items: cache.items, fetchedAt: cache.fetchedAt, stale: false, error: null }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers: Record<string, string> = { 'User-Agent': 'godot-hub' }
    if (cache?.etag && !force) headers['If-None-Match'] = cache.etag

    const response = await net.fetch(FEED_URL, { headers, signal: controller.signal })

    if (response.status === 304 && cache) {
      const refreshed: CacheFile = { ...cache, fetchedAt: new Date().toISOString() }
      writeCache(refreshed)
      return { items: cache.items, fetchedAt: refreshed.fetchedAt, stale: false, error: null }
    }

    if (!response.ok) throw new Error(`godotengine.org respondió ${response.status}.`)

    const items = parseFeed(await response.text())
    if (items.length === 0) throw new Error('El feed no traía ninguna noticia legible.')

    const next: CacheFile = {
      etag: response.headers.get('etag'),
      fetchedAt: new Date().toISOString(),
      items
    }
    writeCache(next)
    return { items, fetchedAt: next.fetchedAt, stale: false, error: null }
  } catch (error) {
    const message = describeError(error)
    if (cache) return { items: cache.items, fetchedAt: cache.fetchedAt, stale: true, error: message }
    return { items: [], fetchedAt: null, stale: false, error: message }
  } finally {
    clearTimeout(timeout)
  }
}
