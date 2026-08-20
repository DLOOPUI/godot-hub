/**
 * Novedades: las últimas entradas del blog oficial de Godot.
 *
 * Solo se pinta el resumen en texto plano que trae el feed. El HTML del feed no
 * se usa: meterlo en la interfaz seria dejar que un tercero inyecte marcado. El
 * articulo completo se abre en el navegador del sistema.
 */
import { bridge } from '../bridge'
import { iconAlert, iconExternal, iconRefresh } from '../components/icons'
import { escapeHtml, formatDate, formatDateTime } from '../format'
import type { NewsItem, NewsResult } from '../../shared/types'

/** Etiquetas del feed traducidas; lo que no esté aquí se muestra tal cual. */
const CATEGORY_LABELS: Record<string, string> = {
  Release: 'Versión estable',
  'Pre-release': 'Versión de prueba',
  News: 'Noticia',
  Events: 'Evento'
}

export interface NewsView {
  element: HTMLElement
  refresh: (force?: boolean) => Promise<void>
}

export function renderNews(): NewsView {
  const root = document.createElement('section')

  const stack = document.createElement('div')
  stack.className = 'stack stack--flush'
  root.appendChild(stack)

  stack.innerHTML = `
    <div class="releases-head">
      <div>
        <h1 class="h1">Novedades de Godot</h1>
        <p class="muted" id="news-meta">Consultando godotengine.org&hellip;</p>
      </div>
      <button class="btn btn--ghost" id="news-refresh" aria-label="Recargar las noticias">
        ${iconRefresh()}<span>Recargar</span>
      </button>
    </div>
  `

  const meta = stack.querySelector<HTMLElement>('#news-meta')!
  const refreshButton = stack.querySelector<HTMLButtonElement>('#news-refresh')!
  const list = document.createElement('div')
  list.className = 'release-list'
  stack.appendChild(list)

  const refresh = async (force = false): Promise<void> => {
    refreshButton.disabled = true
    if (force) meta.textContent = 'Consultando godotengine.org…'
    try {
      paint(await bridge.listNews(force))
    } finally {
      refreshButton.disabled = false
    }
  }

  const paint = (result: NewsResult): void => {
    list.innerHTML = ''

    if (result.items.length === 0) {
      meta.innerHTML = '&nbsp;'
      list.appendChild(emptyState(result.error))
      return
    }

    const when = result.fetchedAt ? formatDateTime(result.fetchedAt) : 'fecha desconocida'
    meta.innerHTML = result.stale
      ? `<span class="meta-warning">Datos del ${when} &mdash; ${escapeHtml(result.error ?? 'sin conexión')}</span>`
      : `Actualizado ${when}`

    for (const item of result.items) list.appendChild(newsCard(item))
  }

  refreshButton.addEventListener('click', () => void refresh(true))

  return { element: root, refresh }
}

function emptyState(error: string | null): HTMLElement {
  const card = document.createElement('div')
  card.className = 'card empty-state'
  card.innerHTML = `
    <div class="empty-state__icon">${iconAlert('empty-state__svg')}</div>
    <h2 class="h2">No se pudieron cargar las noticias</h2>
    <p class="muted">${escapeHtml(error ?? 'El feed no traía ninguna entrada.')}</p>
  `
  return card
}

function newsCard(item: NewsItem): HTMLElement {
  const card = document.createElement('article')
  card.className = 'card card--interactive news-card'

  const label = CATEGORY_LABELS[item.category] ?? item.category
  const isRelease = item.category === 'Release'

  card.innerHTML = `
    <div class="news-card__head">
      ${label ? `<span class="badge ${isRelease ? 'badge--installed' : ''}">${escapeHtml(label)}</span>` : ''}
      <span class="muted news-card__date">${item.publishedAt ? escapeHtml(formatDate(item.publishedAt)) : ''}</span>
    </div>
    <h3 class="h2">${escapeHtml(item.title)}</h3>
    ${item.summary ? `<p class="muted news-card__summary">${escapeHtml(item.summary)}</p>` : ''}
    <div class="news-card__actions">
      <button class="btn btn--ghost" data-open>${iconExternal()}<span>Leer el artículo</span></button>
    </div>
  `

  card.querySelector<HTMLButtonElement>('[data-open]')?.addEventListener('click', () => {
    void bridge.openExternal(item.link)
  })

  return card
}
