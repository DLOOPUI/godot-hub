/**
 * Ajustes: la salida de las decisiones "no me vuelvas a preguntar" y el unico
 * sitio desde el que se puede cambiar la carpeta de trabajo.
 *
 * Sin esto, marcar una casilla una vez encierra al usuario en esa eleccion para
 * siempre, que es la queja clasica del patron.
 */
import { bridge } from '../bridge'
import { iconFolder } from '../components/icons'
import { openModal } from '../components/modal'
import { escapeHtml } from '../format'
import type { CleanupMode, Config } from '../../shared/types'

const CLEANUP_LABELS: Record<CleanupMode, string> = {
  delete: 'eliminar la versión actual',
  keep: 'conservarla en la carpeta'
}

export interface SettingsResult {
  config: Config
  /** true si el usuario pidio cambiar de carpeta: el llamante vuelve al onboarding. */
  changeWorkspace: boolean
}

export async function openSettings(config: Config): Promise<SettingsResult> {
  let current = config
  let changeWorkspace = false

  const body = document.createElement('div')
  body.className = 'settings'
  body.innerHTML = `
    <label class="toggle settings__row">
      <input type="checkbox" id="ask-install" />
      <span class="toggle__track"><span class="toggle__thumb"></span></span>
      <span class="settings__text">
        <span class="toggle__label">Preguntar antes de instalar</span>
        <span class="muted">Vuelve a mostrar la confirmación del paso previo a la descarga.</span>
      </span>
    </label>

    <div class="settings__row settings__row--block">
      <span class="settings__text">
        <span class="toggle__label">Qué hacer con la versión actual</span>
        <span class="muted" id="cleanup-state"></span>
      </span>
      <button class="btn" id="forget-cleanup">Volver a preguntar</button>
    </div>

    <label class="toggle settings__row">
      <input type="checkbox" id="hide-running" />
      <span class="toggle__track"><span class="toggle__thumb"></span></span>
      <span class="settings__text">
        <span class="toggle__label">Esconder el gestor mientras Godot está abierto</span>
        <span class="muted">Vuelve a aparecer solo al cerrar Godot. Mientras tanto queda un icono en la bandeja del sistema.</span>
      </span>
    </label>

    <div class="settings__row settings__row--block">
      <span class="settings__text">
        <span class="toggle__label">Carpeta de trabajo</span>
        <span class="muted settings__path" id="workspace-path"></span>
      </span>
      <button class="btn" id="change-workspace">${iconFolder()}<span>Cambiar</span></button>
    </div>

    <div class="settings__row settings__row--block">
      <span class="settings__text">
        <span class="toggle__label">Registro de actividad</span>
        <span class="muted">Descargas, borrados y errores quedan anotados aquí.</span>
      </span>
      <button class="btn btn--ghost" id="open-logs">Abrir registros</button>
    </div>
  `

  const askInstall = body.querySelector<HTMLInputElement>('#ask-install')!
  const hideRunning = body.querySelector<HTMLInputElement>('#hide-running')!
  const cleanupState = body.querySelector<HTMLElement>('#cleanup-state')!
  const forgetButton = body.querySelector<HTMLButtonElement>('#forget-cleanup')!
  const workspacePath = body.querySelector<HTMLElement>('#workspace-path')!

  const sync = (): void => {
    askInstall.checked = !current.skipInstallConfirm
    hideRunning.checked = current.hideWhileRunning
    cleanupState.textContent = current.defaultCleanupMode
      ? `Recordado: ${CLEANUP_LABELS[current.defaultCleanupMode]}.`
      : 'Se pregunta en cada instalación.'
    forgetButton.disabled = current.defaultCleanupMode === null
    workspacePath.textContent = current.workspacePath ?? 'sin configurar'
  }
  sync()

  askInstall.addEventListener('change', () => {
    void bridge.setConfig({ skipInstallConfirm: !askInstall.checked }).then((next) => {
      current = next
      sync()
    })
  })

  hideRunning.addEventListener('change', () => {
    void bridge.setConfig({ hideWhileRunning: hideRunning.checked }).then((next) => {
      current = next
      sync()
    })
  })

  forgetButton.addEventListener('click', () => {
    void bridge.setConfig({ defaultCleanupMode: null }).then((next) => {
      current = next
      sync()
    })
  })

  body.querySelector<HTMLButtonElement>('#open-logs')?.addEventListener('click', () => {
    void bridge.openLogs()
  })

  body.querySelector<HTMLButtonElement>('#change-workspace')?.addEventListener('click', () => {
    changeWorkspace = true
    // Cierra Ajustes: la seleccion y el aviso de borrado son el onboarding, y
    // anidar ese flujo dentro de este modal no aporta nada.
    body.closest('.modal')?.querySelector<HTMLButtonElement>('.modal__actions .btn')?.click()
  })

  await openModal({
    title: 'Ajustes',
    body,
    actions: [{ label: 'Cerrar', value: 'close', variant: 'accent' }]
  })

  return { config: current, changeWorkspace }
}

/** Aviso previo al cambio de carpeta: la actual deja de gestionarse. */
export async function confirmWorkspaceChange(currentPath: string): Promise<boolean> {
  const result = await openModal({
    title: 'Cambiar la carpeta de trabajo',
    body: `
      <p>Se elegirá una carpeta nueva y habrá que vaciarla, igual que la primera vez.</p>
      <p class="path-chip"><code>${escapeHtml(currentPath)}</code></p>
      <p class="modal__note">
        Esta carpeta y lo que contenga se quedan como están: la app deja de gestionarla,
        no la borra.
      </p>
    `,
    actions: [
      { label: 'Cancelar', value: null, variant: 'ghost' },
      { label: 'Elegir otra carpeta', value: 'change', variant: 'accent', icon: iconFolder() }
    ]
  })
  return result.value === 'change'
}
