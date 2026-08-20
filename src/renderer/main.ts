import { bridge } from './bridge'
import { createTitlebar } from './components/titlebar'
import { openModal } from './components/modal'
import { escapeHtml } from './format'
import { runInstallFlow } from './views/install-flow'
import { renderOnboarding, validateSavedWorkspace } from './views/onboarding'
import { renderReleases } from './views/releases'
import { renderLibrary } from './views/library'
import { createShell } from './components/shell'
import { confirmWorkspaceChange, openSettings } from './views/settings'
import type { ReleasesView } from './views/releases'
import type { LibraryView } from './views/library'
import type { Section, Shell } from './components/shell'
import type { GodotFlavor, LibraryEntry, Release } from '../shared/types'

let content: HTMLElement | null = null
let shell: Shell | null = null
let view: ReleasesView | null = null
let library: LibraryView | null = null
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
    view?.endInstall()
    void refreshAfterInstall()
  })

  bridge.onGodotClosed(() => {
    // Al volver se repinta: la carpeta pudo cambiar mientras estabamos fuera.
    void library?.refresh()
  })

  bridge.onInstallError((error) => {
    if (error.jobId !== currentJobId) return
    currentJobId = null
    view?.endInstall()
    void refreshAfterInstall().then(() => {
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

/** Tras instalar cambian tanto la biblioteca como las marcas de la lista. */
async function refreshAfterInstall(): Promise<void> {
  const config = await bridge.getConfig()
  view?.setInstalled(config.installed.map((item) => item.tag))
  await library?.refresh()
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
  await launchByTag(release.tag, release.tag)
}

async function launchByTag(tag: string, label: string): Promise<void> {
  const result = await bridge.launchVersion(tag)
  if (result.ok) return

  if (result.reason === 'missing') {
    const answer = await openModal({
      title: `No se encuentra Godot ${escapeHtml(label)}`,
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
      await bridge.forgetVersion(tag)
      await library?.refresh()
    }
    return
  }

  await openModal({
    title: 'No se pudo iniciar',
    body: `<p>${escapeHtml(result.message)}</p>`,
    actions: [{ label: 'Entendido', value: 'ok', variant: 'accent' }]
  })
}

async function handleLaunchEntry(entry: LibraryEntry): Promise<void> {
  await launchByTag(entry.tag, entry.tag)
}

async function handleForget(entry: LibraryEntry): Promise<void> {
  await bridge.forgetVersion(entry.tag)
  await library?.refresh()
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
  setView(renderOnboarding(() => void buildShell()))
}

/**
 * Ambas vistas se crean una sola vez y se alterna cual esta visible.
 *
 * Destruirlas al navegar perderia el progreso de una descarga en curso, que es
 * justo el momento en el que uno se va a mirar otra cosa.
 */
function navigate(section: Section): void {
  if (!view || !library) return

  const toLibrary = section === 'library'
  library.element.hidden = !toLibrary
  view.element.hidden = toLibrary
  shell?.setActive(section)

  // Al volver puede haber cambiado lo instalado.
  if (toLibrary) void library.refresh()
}

async function buildShell(): Promise<void> {
  const config = await bridge.getConfig()

  shell = createShell({
    workspacePath: config.workspacePath ?? '',
    onNavigate: navigate,
    onOpenSettings: () => void handleSettings()
  })

  view = renderReleases({
    config,
    onInstall: (release, flavor) => void handleInstall(release, flavor),
    onLaunch: (release) => void handleLaunch(release),
    onCancelInstall: () => {
      if (currentJobId) void bridge.cancelInstall(currentJobId)
    }
  })

  library = renderLibrary({
    onLaunch: (entry) => void handleLaunchEntry(entry),
    onForget: (entry) => void handleForget(entry),
    onBrowse: () => navigate('releases')
  })

  shell.host.appendChild(library.element)
  shell.host.appendChild(view.element)
  setView(shell.element)

  // La biblioteca es la seccion de entrada: arrancar una version instalada es
  // lo que se hace a diario, buscar versiones nuevas es ocasional.
  navigate('library')
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
    await buildShell()
  } else {
    setView(renderOnboarding(() => void buildShell()))
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
