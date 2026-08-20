import { bridge } from './bridge'
import { createTitlebar } from './components/titlebar'
import { openModal } from './components/modal'
import { escapeHtml } from './format'
import { runInstallFlow } from './views/install-flow'
import { renderOnboarding, validateSavedWorkspace } from './views/onboarding'
import { renderReleases } from './views/releases'
import { confirmWorkspaceChange, openSettings } from './views/settings'
import type { ReleasesView } from './views/releases'
import type { GodotFlavor, Release } from '../shared/types'

let content: HTMLElement | null = null
let view: ReleasesView | null = null
let currentJobId: string | null = null

function setView(element: HTMLElement): void {
  content?.remove()
  content = element
  document.getElementById('root')!.appendChild(element)
}

/**
 * Los eventos de instalacion se suscriben una sola vez, no por vista: la lista
 * se redibuja al terminar y volver a suscribirse dejaria listeners duplicados.
 */
function wireInstallEvents(): void {
  bridge.onInstallProgress((progress) => {
    if (progress.jobId === currentJobId) view?.updateProgress(progress)
  })

  bridge.onInstallDone((done) => {
    if (done.jobId !== currentJobId) return
    currentJobId = null
    void showReleases()
  })

  bridge.onInstallError((error) => {
    if (error.jobId !== currentJobId) return
    currentJobId = null
    void showReleases().then(() => {
      // Cancelar es una decision del usuario, no un fallo que reportar.
      if (error.canceled) return
      void openModal({
        title: 'No se pudo completar la instalación',
        body: `<p>${escapeHtml(error.message)}</p>`,
        actions: [{ label: 'Entendido', value: 'ok', variant: 'accent' }]
      })
    })
  })
}

/**
 * Atajos globales. Se ignoran mientras hay un modal abierto: ahi manda el
 * dialogo, y recargar la lista por detras solo confundiria.
 */
function wireShortcuts(): void {
  document.addEventListener('keydown', (event) => {
    if (document.querySelector('.modal-backdrop')) return

    const key = event.key.toLowerCase()

    if (key === 'f5' || (event.ctrlKey && key === 'r')) {
      event.preventDefault()
      view?.reload()
      return
    }

    if (event.ctrlKey && key === ',') {
      event.preventDefault()
      if (view && !view.isBusy()) void handleSettings()
    }
  })
}

async function handleInstall(release: Release, flavor: GodotFlavor): Promise<void> {
  // Se relee la config: las casillas "no preguntar" pueden haber cambiado
  // desde Ajustes o en una instalacion anterior de esta misma sesion.
  const config = await bridge.getConfig()
  const decision = await runInstallFlow(release, flavor, config)
  if (!decision) return

  view?.beginInstall(release.tag)
  currentJobId = await bridge.startInstall({
    release: decision.release,
    flavor: decision.flavor,
    cleanup: decision.cleanup
  })
}

/**
 * Inicia una version instalada. El unico fallo que admite reparacion desde aqui
 * es que la carpeta ya no exista: se ofrece quitarla del registro para que la
 * lista deje de prometer algo que no esta.
 */
async function handleLaunch(release: Release): Promise<void> {
  const result = await bridge.launchVersion(release.tag)
  if (result.ok) return

  if (result.reason === 'missing') {
    const answer = await openModal({
      title: `No se encuentra Godot ${escapeHtml(release.tag)}`,
      body: `
        <p>${escapeHtml(result.message)}</p>
        ${result.exePath ? `<p class="path-chip"><code>${escapeHtml(result.exePath)}</code></p>` : ''}
        <p class="modal__note">Puedes volver a instalarla, o quitarla de la lista de instaladas.</p>
      `,
      actions: [
        { label: 'Cerrar', value: null, variant: 'ghost' },
        { label: 'Quitar de la lista', value: 'forget' }
      ]
    })
    if (answer.value === 'forget') {
      await bridge.forgetVersion(release.tag)
      await showReleases()
    }
    return
  }

  await openModal({
    title: 'No se pudo iniciar',
    body: `<p>${escapeHtml(result.message)}</p>`,
    actions: [{ label: 'Entendido', value: 'ok', variant: 'accent' }]
  })
}

async function handleSettings(): Promise<void> {
  const latest = await bridge.getConfig()
  const result = await openSettings(latest)
  if (!result.changeWorkspace) return

  const previous = result.config.workspacePath ?? ''
  if (!(await confirmWorkspaceChange(previous))) return

  // Se invalida la carpeta actual antes de volver al onboarding: si el usuario
  // cancela ahi, la app no debe seguir operando sobre una eleccion a medias.
  await bridge.setConfig({ workspaceConfirmed: false })
  setView(renderOnboarding(() => void showReleases()))
}

async function showReleases(): Promise<void> {
  const config = await bridge.getConfig()
  view = renderReleases({
    config,
    onInstall: (release, flavor) => void handleInstall(release, flavor),
    onLaunch: (release) => void handleLaunch(release),
    onOpenSettings: () => void handleSettings(),
    onCancelInstall: () => {
      if (currentJobId) void bridge.cancelInstall(currentJobId)
    }
  })
  setView(view.element)
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root')!
  const info = await bridge.getAppInfo()
  root.appendChild(createTitlebar(`Godot Hub ${info.version}${info.isDev ? ' — dev' : ''}`))

  wireInstallEvents()
  wireShortcuts()

  const config = await bridge.getConfig()

  // La carpeta guardada puede haber dejado de ser valida entre sesiones.
  const stillValid =
    config.workspacePath !== null &&
    config.workspaceConfirmed &&
    (await validateSavedWorkspace(config.workspacePath)) === null

  if (stillValid) {
    await showReleases()
  } else {
    setView(renderOnboarding(() => void showReleases()))
  }
}

// Lo que se escape de un try/catch acaba en el mismo registro que el proceso
// principal, para no tener que abrir las DevTools a posteriori.
window.addEventListener('error', (event) => {
  void bridge.log('error', `${event.message} (${event.filename}:${event.lineno})`)
})
window.addEventListener('unhandledrejection', (event) => {
  void bridge.log('error', `unhandledRejection: ${String(event.reason)}`)
})

void bootstrap()
