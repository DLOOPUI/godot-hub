/**
 * Modal accesible: bloqueante, con focus trap, Esc = cancelar y devolucion del
 * foco al elemento que lo abrio.
 */
import { iconCheck } from './icons'

export interface ModalAction<T extends string> {
  /** Texto del boton. Cuando la accion es destructiva, el texto es la advertencia. */
  label: string
  /** Valor con el que se resuelve el modal. `null` = cancelar. */
  value: T | null
  variant?: 'default' | 'accent' | 'danger' | 'ghost'
  /** Icono SVG inline opcional (ver components/icons.ts). */
  icon?: string
}

export interface ModalOptions<T extends string> {
  title: string
  /** HTML (construido por la app, nunca contenido de red) o un elemento vivo. */
  body: string | HTMLElement
  actions: ModalAction<T>[]
  /** Casilla opcional al pie; su estado vuelve en `checked`. */
  checkbox?: string
  /** Impide cerrar con Esc o clic fuera. */
  mandatory?: boolean
}

export interface ModalResult<T extends string> {
  value: T | null
  /** Estado de la casilla al cerrar. `false` si no habia casilla. */
  checked: boolean
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function openModal<T extends string>(options: ModalOptions<T>): Promise<ModalResult<T>> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement as HTMLElement | null

    const backdrop = document.createElement('div')
    backdrop.className = 'modal-backdrop'

    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', 'modal-title')

    const actionsHtml = options.actions
      .map((action, index) => {
        const variant = action.variant ?? 'default'
        const cls = variant === 'default' ? 'btn' : `btn btn--${variant}`
        return `<button class="${cls}" data-index="${index}">${action.icon ?? ''}<span>${action.label}</span></button>`
      })
      .join('')

    // Se apilan a ancho completo (accion segura arriba) cuando no caben en fila:
    // con una etiqueta larga —los botones destructivos llevan la advertencia
    // dentro— o con mas de dos acciones, el wrap deja una linea suelta.
    const stacked =
      options.actions.length > 2 || options.actions.some((action) => action.label.length > 26)

    const checkboxHtml = options.checkbox
      ? `<label class="check modal__check">
           <input type="checkbox" data-modal-check />
           <span class="check__box">${iconCheck('')}</span>
           <span class="toggle__label">${options.checkbox}</span>
         </label>`
      : ''

    modal.innerHTML = `
      <h2 class="modal__title" id="modal-title">${options.title}</h2>
      <div class="modal__body"></div>
      ${checkboxHtml}
      <div class="modal__actions${stacked ? ' modal__actions--stacked' : ''}">${actionsHtml}</div>
    `

    const bodyHost = modal.querySelector<HTMLElement>('.modal__body')!
    if (typeof options.body === 'string') bodyHost.innerHTML = options.body
    else bodyHost.appendChild(options.body)

    backdrop.appendChild(modal)

    const checkbox = modal.querySelector<HTMLInputElement>('[data-modal-check]')

    const close = (value: T | null): void => {
      document.removeEventListener('keydown', onKeydown, true)
      backdrop.remove()
      previouslyFocused?.focus()
      resolve({ value, checked: checkbox?.checked ?? false })
    }

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !options.mandatory) {
        event.preventDefault()
        close(null)
        return
      }
      if (event.key !== 'Tab') return

      // Focus trap: el Tab no puede salir del modal.
      const focusables = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    modal.querySelectorAll<HTMLButtonElement>('.modal__actions .btn').forEach((button) => {
      button.addEventListener('click', () => {
        const action = options.actions[Number(button.dataset['index'])]
        if (action) close(action.value)
      })
    })

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && !options.mandatory) close(null)
    })

    document.addEventListener('keydown', onKeydown, true)
    document.body.appendChild(backdrop)

    // Foco inicial en la accion menos destructiva disponible.
    const buttons = modal.querySelectorAll<HTMLElement>('.modal__actions .btn')
    const safe = Array.from(buttons).find((b) => !b.classList.contains('btn--danger'))
    ;(safe ?? buttons[0])?.focus()
  })
}
