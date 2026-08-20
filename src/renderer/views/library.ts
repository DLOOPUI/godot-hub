/**
 * Biblioteca: lo que ya está instalado, para arrancarlo de un clic.
 *
 * Es la seccion de entrada porque es lo que se hace a diario; buscar versiones
 * nuevas es ocasional.
 */
import { bridge } from '../bridge'
import { iconDownload, iconFolder, iconPlay, iconTrash } from '../components/icons'
import { escapeHtml, formatBytes, formatDate } from '../format'
import { isNewer } from '../../shared/version'
import type { LibraryEntry } from '../../shared/types'

export interface LibraryViewOptions {
  onLaunch: (entry: LibraryEntry) => void
  /** Quitar del registro una version cuya carpeta ya no existe. */
  onForget: (entry: LibraryEntry) => void
  /** Llevar a la seccion de versiones (estado vacio). */
  onBrowse: () => void
}

export interface LibraryView {
  element: HTMLElement
  /** `latestTag` viene de la lista de versiones ya cacheada; null si aún no se sabe. */
  refresh: (latestTag?: string | null) => Promise<void>
}

export function renderLibrary(options: LibraryViewOptions): LibraryView {
  const root = document.createElement('section')

  const stack = document.createElement('div')
  stack.className = 'stack stack--flush'
  root.appendChild(stack)

  stack.innerHTML = `
    <div class="releases-head">
      <div>
        <h1 class="h1">Tu biblioteca</h1>
        <p class="muted" id="library-meta">&nbsp;</p>
      </div>
    </div>
  `

  const meta = stack.querySelector<HTMLElement>('#library-meta')!
  const notice = document.createElement('div')
  stack.appendChild(notice)
  const list = document.createElement('div')
  list.className = 'release-list'
  stack.appendChild(list)

  let latest: string | null = null

  const refresh = async (latestTag?: string | null): Promise<void> => {
    if (latestTag !== undefined) latest = latestTag
    const entries = await bridge.listLibrary()
    list.innerHTML = ''
    notice.innerHTML = ''

    if (entries.length === 0) {
      meta.innerHTML = '&nbsp;'
      list.appendChild(emptyState(options.onBrowse))
      return
    }

    const usable = entries.filter((entry) => entry.exists)
    const total = usable.reduce((sum, entry) => sum + entry.sizeBytes, 0)
    meta.textContent =
      `${entries.length} ${entries.length === 1 ? 'versión instalada' : 'versiones instaladas'}` +
      (total > 0 ? ` · ${formatBytes(total)} en disco` : '')

    // Aviso solo si la mas nueva que tienes se ha quedado atras.
    const newest = entries.filter((entry) => entry.exists).map((entry) => entry.tag)
    if (latest && newest.length > 0 && newest.every((tag) => isNewer(latest as string, tag))) {
      notice.appendChild(updateNotice(latest, options.onBrowse))
    }

    for (const entry of entries) {
      list.appendChild(libraryCard(entry, options))
    }
  }

  return { element: root, refresh }
}

/** Aviso de que hay una version mas reciente que la instalada. */
function updateNotice(latestTag: string, onBrowse: () => void): HTMLElement {
  const card = document.createElement('div')
  card.className = 'card update-notice'
  card.innerHTML = `
    <div class="settings__text">
      <span class="toggle__label">Hay una versión más nueva: ${escapeHtml(latestTag)}</span>
      <span class="muted">Tu biblioteca se ha quedado por detrás de la última stable publicada.</span>
    </div>
    <button class="btn btn--accent" data-browse>${iconDownload()}<span>Ver versiones</span></button>
  `
  card.querySelector<HTMLButtonElement>('[data-browse]')?.addEventListener('click', onBrowse)
  return card
}

function emptyState(onBrowse: () => void): HTMLElement {
  const card = document.createElement('div')
  card.className = 'card empty-state'
  card.innerHTML = `
    <div class="empty-state__icon">${iconDownload('empty-state__svg')}</div>
    <h2 class="h2">Todavía no hay ninguna versión instalada</h2>
    <p class="muted">Instala una desde la sección Versiones y aparecerá aquí para arrancarla.</p>
    <div class="row" style="justify-content: center; margin-top: var(--space-4)">
      <button class="btn btn--accent" data-browse>${iconDownload()}<span>Ver versiones</span></button>
    </div>
  `
  card.querySelector<HTMLButtonElement>('[data-browse]')?.addEventListener('click', onBrowse)
  return card
}

function libraryCard(entry: LibraryEntry, options: LibraryViewOptions): HTMLElement {
  const card = document.createElement('article')
  card.className = 'card card--interactive release-card'
  card.dataset['tag'] = entry.tag

  const details = [
    entry.flavor === 'mono' ? '.NET (Mono)' : 'Estándar',
    entry.exists ? formatBytes(entry.sizeBytes) : null,
    `instalada el ${formatDate(entry.installedAt)}`
  ]
    .filter(Boolean)
    .join(' · ')

  card.innerHTML = `
    <div class="release-card__info">
      <h3 class="h2">${escapeHtml(entry.tag)}</h3>
      <p class="muted">${escapeHtml(details)}</p>
      ${
        entry.exists
          ? ''
          : `<p style="margin-top:10px"><span class="badge badge--warning">No se encuentra la carpeta</span></p>`
      }
    </div>
    <div class="release-card__actions">
      ${
        entry.exists
          ? `<button class="btn btn--ghost btn--icon-only" data-folder aria-label="Abrir la carpeta de ${escapeHtml(entry.tag)}">${iconFolder()}</button>
             <button class="btn btn--launch" data-launch>${iconPlay()}<span>Iniciar</span></button>`
          : `<button class="btn btn--danger" data-forget>${iconTrash()}<span>Quitar de la lista</span></button>`
      }
    </div>
  `

  card.querySelector<HTMLButtonElement>('[data-launch]')?.addEventListener('click', () => options.onLaunch(entry))
  card.querySelector<HTMLButtonElement>('[data-forget]')?.addEventListener('click', () => options.onForget(entry))
  card
    .querySelector<HTMLButtonElement>('[data-folder]')
    ?.addEventListener('click', () => void bridge.revealWorkspace(entry.folderPath))

  return card
}

