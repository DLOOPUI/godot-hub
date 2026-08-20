import { bridge } from '../bridge'
import { iconFolder, iconSettings } from './icons'
import { escapeHtml } from '../format'

export type Section = 'library' | 'releases'

export interface ShellOptions {
  workspacePath: string
  onNavigate: (section: Section) => void
  onOpenSettings: () => void
}

export interface Shell {
  element: HTMLElement
  /** Donde se montan las vistas. */
  host: HTMLElement
  setActive: (section: Section) => void
}

/**
 * Marco comun a las dos secciones: navegacion, carpeta de trabajo y ajustes.
 *
 * Vive fuera de las vistas porque es lo que se mantiene fijo al cambiar de
 * seccion; si cada vista dibujara su propia cabecera, cambiar de pestaña
 * repintaria la barra entera y se veria el salto.
 */
export function createShell(options: ShellOptions): Shell {
  const element = document.createElement('main')
  element.className = 'content'

  const stack = document.createElement('div')
  stack.className = 'stack'
  element.appendChild(stack)

  stack.innerHTML = `
    <div class="nav">
      <div class="segmented" role="tablist" aria-label="Secciones">
        <button class="segmented__option" role="tab" data-section="library">Biblioteca</button>
        <button class="segmented__option" role="tab" data-section="releases">Versiones</button>
      </div>
      <div class="nav__spacer"></div>
      <button class="btn btn--ghost btn--icon-only" id="settings" aria-label="Ajustes">
        ${iconSettings()}
      </button>
    </div>

    <div class="workspace-bar card">
      <div class="workspace-bar__info">
        <p class="section-label" style="margin: 0 0 2px">Carpeta de trabajo</p>
        <p class="workspace-bar__path">${escapeHtml(options.workspacePath)}</p>
      </div>
      <button class="btn btn--ghost" id="open-folder">${iconFolder()}<span>Abrir</span></button>
    </div>
  `

  const host = document.createElement('div')
  host.className = 'shell__host'
  stack.appendChild(host)

  stack.querySelector<HTMLButtonElement>('#open-folder')?.addEventListener('click', () => {
    void bridge.revealWorkspace(options.workspacePath)
  })
  stack.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', options.onOpenSettings)

  const tabs = Array.from(stack.querySelectorAll<HTMLButtonElement>('[data-section]'))

  const setActive = (section: Section): void => {
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', String(tab.dataset['section'] === section))
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const section = tab.dataset['section'] === 'releases' ? 'releases' : 'library'
      setActive(section)
      options.onNavigate(section)
    })
  }

  return { element, host, setActive }
}
