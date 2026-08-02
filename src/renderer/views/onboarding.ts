/**
 * Pasos 1 y 2 del flujo: elegir la carpeta de trabajo y dejarla vacia.
 *
 * Sale de aqui solo cuando la carpeta esta validada, confirmada y vacia.
 */
import { bridge } from '../bridge'
import { iconFolder, iconTrash } from '../components/icons'
import { openModal } from '../components/modal'
import { escapeHtml, formatBytes, formatCount } from '../format'
import type { WorkspaceInspection } from '../../shared/types'

const MAX_LISTED_ENTRIES = 8

export function renderOnboarding(onReady: (path: string) => void): HTMLElement {
  const root = document.createElement('main')
  root.className = 'content'

  root.innerHTML = `
    <div class="stack" style="max-width: 560px; margin-top: 6vh">
      <div style="text-align: center">
        <div class="hero-icon">${iconFolder('hero-icon__svg')}</div>
        <h1 class="h1" style="margin-top: var(--space-4)">
          Elija la carpeta donde se realizarán las acciones de autoactualización
        </h1>
        <p class="muted" style="margin-top: var(--space-3)">
          Será una carpeta dedicada: la app borra y reescribe su contenido en cada
          actualización. No uses una carpeta con cosas tuyas dentro.
        </p>
      </div>

      <div class="card">
        <button class="btn btn--accent btn--block" id="pick">
          ${iconFolder()}<span>Seleccionar carpeta&hellip;</span>
        </button>
        <p class="muted" id="status" style="margin-top: var(--space-3); text-align: center">&nbsp;</p>
      </div>
    </div>
  `

  const pickButton = root.querySelector<HTMLButtonElement>('#pick')!
  const status = root.querySelector<HTMLElement>('#status')!

  const setStatus = (text: string, tone: 'muted' | 'danger' = 'muted'): void => {
    status.textContent = text || ' '
    status.style.color = tone === 'danger' ? 'var(--danger)' : 'var(--text-muted)'
  }

  pickButton.addEventListener('click', () => {
    void handlePick(pickButton, setStatus, onReady)
  })

  return root
}

async function handlePick(
  button: HTMLButtonElement,
  setStatus: (text: string, tone?: 'muted' | 'danger') => void,
  onReady: (path: string) => void
): Promise<void> {
  button.disabled = true
  try {
    const result = await bridge.pickWorkspace()
    if (result.canceled) {
      setStatus('')
      return
    }
    await processInspection(result.inspection, setStatus, onReady)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Error inesperado', 'danger')
  } finally {
    button.disabled = false
  }
}

async function processInspection(
  inspection: WorkspaceInspection,
  setStatus: (text: string, tone?: 'muted' | 'danger') => void,
  onReady: (path: string) => void
): Promise<void> {
  if (inspection.rejectionMessage) {
    setStatus(inspection.rejectionMessage, 'danger')
    return
  }

  // Carpeta vacia: nada que advertir, se guarda y se sigue.
  if (inspection.entryCount === 0) {
    await bridge.setConfig({ workspacePath: inspection.path, workspaceConfirmed: true })
    onReady(inspection.path)
    return
  }

  const confirmed = await confirmWipe(inspection)
  if (!confirmed) {
    setStatus('Selecciona otra carpeta.')
    return
  }

  setStatus('Vaciando la carpeta…')
  const result = await bridge.clearWorkspace(inspection.path)

  if (result.failed.length > 0) {
    const list = result.failed
      .slice(0, MAX_LISTED_ENTRIES)
      .map((item) => `<li><code>${escapeHtml(item.name)}</code> &mdash; ${escapeHtml(item.reason)}</li>`)
      .join('')
    await openModal({
      title: 'No se pudo vaciar del todo',
      body: `
        <p>Estos elementos no se pudieron borrar, normalmente porque otro programa
        los tiene abiertos. Ciérralos e inténtalo otra vez, o elige otra carpeta.</p>
        <ul class="entry-list">${list}</ul>
      `,
      actions: [{ label: 'Entendido', value: 'ok', variant: 'accent' }]
    })
    setStatus('La carpeta no quedó vacía. Vuelve a intentarlo.', 'danger')
    return
  }

  await bridge.setConfig({ workspacePath: inspection.path, workspaceConfirmed: true })
  onReady(inspection.path)
}

/** Paso 2: el boton afirmativo lleva la advertencia dentro del propio texto. */
async function confirmWipe(inspection: WorkspaceInspection): Promise<boolean> {
  const listed = inspection.entries.slice(0, MAX_LISTED_ENTRIES)
  const rest = inspection.entryCount - listed.length
  const items = listed
    .map(
      (entry) =>
        `<li>${entry.isDirectory ? '&#128193;' : '&#128196;'} <code>${escapeHtml(entry.name)}</code></li>`
    )
    .join('')

  const result = await openModal({
    title: 'Esta carpeta contiene archivos',
    body: `
      <p>El proceso de autoactualización requiere eliminar constantemente los archivos
      dentro de la carpeta seleccionada. &iquest;Desea continuar?</p>
      <p class="path-chip"><code>${escapeHtml(inspection.path)}</code></p>
      <ul class="entry-list">${items}${rest > 0 ? `<li class="entry-list__more">y ${formatCount(rest, 'elemento más', 'elementos más')}</li>` : ''}</ul>
      <p style="margin-top: var(--space-3)">
        <span class="badge badge--warning">
          ${formatCount(inspection.entryCount, 'elemento', 'elementos')} &middot; ${formatBytes(inspection.totalBytes)}
        </span>
      </p>
      <p class="modal__note">Lo borrado va a la Papelera de reciclaje siempre que Windows lo permita.</p>
      <p class="modal__note">Ruta: se vaciará el contenido, la carpeta en sí se conserva.</p>
    `,
    actions: [
      { label: 'Elegir otra carpeta', value: null, variant: 'ghost' },
      {
        label: 'Continuar y borrar todo el contenido de esta carpeta',
        value: 'wipe',
        variant: 'danger',
        icon: iconTrash()
      }
    ]
  })

  return result.value === 'wipe'
}

/**
 * Arranques posteriores: la carpeta guardada puede haber desaparecido o haberse
 * vuelto invalida (unidad desconectada, permisos cambiados).
 */
export async function validateSavedWorkspace(path: string): Promise<string | null> {
  const inspection = await bridge.inspectWorkspace(path)
  return inspection.rejection ? inspection.rejectionMessage : null
}
