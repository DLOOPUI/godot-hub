/**
 * Paso 3: las 10 ultimas versiones stable, en vertical y descendente.
 *
 * La vista es un render completo por estado (cargando / error / lista): con
 * tres estados y una lista corta, redibujar entero cuesta menos que mantener
 * un diff a mano, y no hay foco de texto que preservar.
 */
import { bridge } from '../bridge'
import { iconAlert, iconDownload, iconFolder, iconRefresh, iconSettings } from '../components/icons'
import { escapeHtml, formatBytes, formatDate, formatDateTime, formatEta, formatSpeed } from '../format'
import type {
  Config,
  GodotFlavor,
  InstallPhase,
  InstallProgress,
  Release,
  ReleasesResult
} from '../../shared/types'

const PHASE_LABELS: Record<InstallPhase, string> = {
  cleanup: 'Preparando…',
  download: 'Descargando…',
  verify: 'Verificando SHA-512…',
  extract: 'Extrayendo…',
  finalize: 'Terminando…'
}

export interface ReleasesViewOptions {
  config: Config
  onInstall: (release: Release, flavor: GodotFlavor) => void
  onOpenSettings: () => void
  onCancelInstall: () => void
}

export interface ReleasesView {
  element: HTMLElement
  /** Bloquea la lista y muestra el progreso dentro de la tarjeta indicada. */
  beginInstall: (tag: string) => void
  updateProgress: (progress: InstallProgress) => void
  endInstall: () => void
  /** Recarga desde GitHub; la usa el atajo F5. */
  reload: () => void
  isBusy: () => boolean
}

export function renderReleases(options: ReleasesViewOptions): ReleasesView {
  const root = document.createElement('main')
  root.className = 'content'

  let flavor: GodotFlavor = options.config.flavor
  const workspacePath = options.config.workspacePath ?? ''
  const installedTags = new Set(options.config.installed.map((item) => item.tag))

  const stack = document.createElement('div')
  stack.className = 'stack'
  root.appendChild(stack)

  // Contenedor propio, no `.stack`: el `margin: 0 auto` de .stack anula el
  // stretch del flex y las tarjetas se encogerian al ancho de su contenido.
  const list = document.createElement('div')
  list.className = 'release-list'

  stack.innerHTML = `
    <div class="workspace-bar card">
      <div class="workspace-bar__info">
        <p class="section-label" style="margin: 0 0 2px">Carpeta de trabajo</p>
        <p class="workspace-bar__path">${escapeHtml(workspacePath)}</p>
      </div>
      <button class="btn btn--ghost" id="open-folder">${iconFolder()}<span>Abrir</span></button>
    </div>

    <div class="releases-head">
      <div>
        <h1 class="h1">Versiones stable de Godot</h1>
        <p class="muted" id="meta">Consultando GitHub&hellip;</p>
      </div>
      <div class="row">
        <div class="segmented" role="tablist" aria-label="Variante de Godot">
          <button class="segmented__option" role="tab" data-flavor="standard">Estándar</button>
          <button class="segmented__option" role="tab" data-flavor="mono">.NET (Mono)</button>
        </div>
        <button class="btn btn--ghost" id="refresh" aria-label="Recargar la lista">
          ${iconRefresh()}<span>Recargar</span>
        </button>
        <button class="btn btn--ghost btn--icon-only" id="settings" aria-label="Ajustes">
          ${iconSettings()}
        </button>
      </div>
    </div>
  `
  stack.appendChild(list)

  const meta = stack.querySelector<HTMLElement>('#meta')!
  const refreshButton = stack.querySelector<HTMLButtonElement>('#refresh')!

  stack.querySelector<HTMLButtonElement>('#open-folder')?.addEventListener('click', () => {
    void bridge.revealWorkspace(workspacePath)
  })

  stack.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', options.onOpenSettings)

  const syncFlavorButtons = (): void => {
    stack.querySelectorAll<HTMLButtonElement>('.segmented__option').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset['flavor'] === flavor))
    })
  }

  let lastResult: ReleasesResult | null = null
  let installingTag: string | null = null

  const paint = (result: ReleasesResult): void => {
    lastResult = result
    renderList(list, result, flavor, installedTags, options.onInstall)
    meta.innerHTML = describeMeta(result)
    if (installingTag) applyInstallingState(root, installingTag, options.onCancelInstall)
  }

  stack.querySelectorAll<HTMLButtonElement>('.segmented__option').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset['flavor'] === 'mono' ? 'mono' : 'standard'
      if (next === flavor || installingTag) return
      flavor = next
      syncFlavorButtons()
      void bridge.setConfig({ flavor })
      if (lastResult) paint(lastResult)
    })
  })
  syncFlavorButtons()

  const load = async (force: boolean): Promise<void> => {
    refreshButton.disabled = true
    if (force) meta.textContent = 'Consultando GitHub…'
    try {
      paint(await bridge.listReleases(force))
    } finally {
      refreshButton.disabled = installingTag !== null
    }
  }

  refreshButton.addEventListener('click', () => void load(true))
  void load(false)

  return {
    element: root,
    beginInstall: (tag) => {
      installingTag = tag
      applyInstallingState(root, tag, options.onCancelInstall)
    },
    updateProgress: (progress) => paintProgress(root, progress),
    endInstall: () => {
      installingTag = null
      if (lastResult) paint(lastResult)
    },
    reload: () => {
      if (!installingTag) void load(true)
    },
    isBusy: () => installingTag !== null
  }
}

/**
 * Una instalacion a la vez: dos descargas simultaneas sobre la misma carpeta
 * se pisarian al limpiar la version anterior.
 */
function applyInstallingState(root: HTMLElement, tag: string, onCancel: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('.release-card button, #refresh').forEach((button) => {
    button.disabled = true
  })

  const card = root.querySelector<HTMLElement>(`[data-tag="${CSS.escape(tag)}"]`)
  if (!card) return

  card.classList.add('release-card--installing')
  const button = card.querySelector<HTMLButtonElement>('.btn--install')
  button?.remove()

  const progress = document.createElement('div')
  progress.className = 'release-card__progress'
  // aria-live: un lector de pantalla anuncia los cambios de fase sin que el
  // usuario tenga que ir a buscarlos.
  progress.innerHTML = `
    <div class="progress" role="progressbar" aria-live="polite" data-progressbar>
      <div class="progress__track"><div class="progress__fill" data-fill></div></div>
      <div class="progress__meta">
        <span data-phase>Preparando…</span>
        <span data-stats></span>
      </div>
    </div>
    <button class="btn btn--ghost" data-cancel>Cancelar</button>
  `
  card.appendChild(progress)
  card.setAttribute('aria-busy', 'true')
  progress.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', onCancel)
  progress.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
}

function paintProgress(root: HTMLElement, progress: InstallProgress): void {
  const host = root.querySelector<HTMLElement>('.release-card__progress')
  if (!host) return

  const fill = host.querySelector<HTMLElement>('[data-fill]')!
  const phase = host.querySelector<HTMLElement>('[data-phase]')!
  const stats = host.querySelector<HTMLElement>('[data-stats]')!
  const bar = host.querySelector<HTMLElement>('[data-progressbar]')!

  phase.textContent = PHASE_LABELS[progress.phase]

  if (progress.phase === 'download' && progress.totalBytes > 0) {
    const percent = Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
    fill.style.width = `${percent}%`
    bar.setAttribute('aria-valuenow', String(percent))
    bar.setAttribute('aria-valuetext', `${PHASE_LABELS[progress.phase]} ${percent} %`)
    const parts = [
      `${percent} %`,
      `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`,
      formatSpeed(progress.speedBps),
      formatEta(progress.etaSec)
    ].filter(Boolean)
    stats.textContent = parts.join(' · ')
    return
  }

  // Fuera de la descarga no hay porcentaje real: la barra queda llena y el
  // texto de fase es lo que informa.
  fill.style.width = progress.phase === 'cleanup' ? '0%' : '100%'
  stats.textContent = ''
  bar.removeAttribute('aria-valuenow')
  bar.setAttribute('aria-valuetext', PHASE_LABELS[progress.phase])
}

function describeMeta(result: ReleasesResult): string {
  if (result.items.length === 0) return '&nbsp;'
  const when = result.fetchedAt ? formatDateTime(result.fetchedAt) : 'fecha desconocida'
  if (result.stale) {
    return `<span class="meta-warning">Datos del ${when} &mdash; ${escapeHtml(result.error ?? 'sin conexión')}</span>`
  }
  return `Actualizado ${when}`
}

function renderList(
  container: HTMLElement,
  result: ReleasesResult,
  flavor: GodotFlavor,
  installedTags: Set<string>,
  onInstall: (release: Release, flavor: GodotFlavor) => void
): void {
  container.innerHTML = ''

  // Sin items y con error: el error ES el estado, no un aviso sobre una lista.
  if (result.items.length === 0) {
    container.appendChild(emptyState(result.error))
    return
  }

  for (const release of result.items) {
    container.appendChild(releaseCard(release, flavor, installedTags.has(release.tag), onInstall))
  }
}

function emptyState(error: string | null): HTMLElement {
  const card = document.createElement('div')
  card.className = 'card empty-state'
  card.innerHTML = `
    <div class="empty-state__icon">${iconAlert('empty-state__svg')}</div>
    <h2 class="h2">${error ? 'No se pudo obtener la lista' : 'No hay versiones que mostrar'}</h2>
    <p class="muted">${escapeHtml(error ?? 'GitHub no devolvió ninguna versión stable.')}</p>
  `
  return card
}

function releaseCard(
  release: Release,
  flavor: GodotFlavor,
  isInstalled: boolean,
  onInstall: (release: Release, flavor: GodotFlavor) => void
): HTMLElement {
  const asset = release.assets[flavor]
  const card = document.createElement('article')
  card.className = 'card card--interactive release-card'
  card.dataset['tag'] = release.tag

  const details = [formatDate(release.publishedAt), asset ? formatBytes(asset.size) : null, 'win64']
    .filter(Boolean)
    .join(' · ')

  card.innerHTML = `
    <div class="release-card__info">
      <h3 class="h2">${escapeHtml(release.tag)}</h3>
      <p class="muted">${escapeHtml(details)}</p>
      ${isInstalled ? '<p style="margin-top:10px"><span class="badge badge--installed">Instalada actualmente</span></p>' : ''}
      ${
        asset
          ? ''
          : `<p style="margin-top:10px"><span class="badge badge--warning">Sin build ${flavor === 'mono' ? '.NET' : 'estándar'} para Windows</span></p>`
      }
    </div>
    <button class="btn btn--install" ${asset ? '' : 'disabled'}>
      ${iconDownload()}<span>${isInstalled ? 'Reinstalar' : 'Instalar'}</span>
    </button>
  `

  const button = card.querySelector<HTMLButtonElement>('button')!
  if (asset) {
    button.addEventListener('click', () => onInstall(release, flavor))
  }

  return card
}
