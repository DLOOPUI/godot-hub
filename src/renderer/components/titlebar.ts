import { bridge } from '../bridge'
import { iconClose, iconMaximize, iconMinimize, iconRestore } from './icons'

/** Barra de titulo propia: la ventana es frameless para que el neumorfismo cubra todo. */
export function createTitlebar(title: string): HTMLElement {
  const bar = document.createElement('header')
  bar.className = 'titlebar'
  bar.innerHTML = `
    <span class="titlebar__title">${title}</span>
    <div class="titlebar__spacer"></div>
    <div class="titlebar__controls">
      <button class="winbtn" data-action="minimize" aria-label="Minimizar">${iconMinimize()}</button>
      <button class="winbtn" data-action="toggle-maximize" aria-label="Maximizar">${iconMaximize()}</button>
      <button class="winbtn winbtn--close" data-action="close" aria-label="Cerrar">${iconClose()}</button>
    </div>
  `

  bar.querySelectorAll<HTMLButtonElement>('.winbtn').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset['action']
      if (action === 'minimize' || action === 'toggle-maximize' || action === 'close') {
        void bridge.windowAction(action)
      }
    })
  })

  const maxButton = bar.querySelector<HTMLButtonElement>('[data-action="toggle-maximize"]')!
  bridge.onMaximizedChanged((isMaximized) => {
    maxButton.innerHTML = isMaximized ? iconRestore() : iconMaximize()
    maxButton.setAttribute('aria-label', isMaximized ? 'Restaurar' : 'Maximizar')
  })

  return bar
}
