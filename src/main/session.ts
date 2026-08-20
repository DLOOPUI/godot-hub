import { app, Menu, nativeImage, Tray } from 'electron'
import type { BrowserWindow } from 'electron'
import { iconPath } from './assets'
import { log } from './logger'

/**
 * Esconder y recuperar la ventana mientras Godot esta abierto.
 *
 * Se esconde en vez de cerrar: si la app terminara de verdad no quedaria nadie
 * vigilando para volver a abrirla cuando Godot se cierre. Visualmente es lo
 * mismo —desaparece de la barra de tareas— pero el proceso sigue vivo.
 *
 * Mientras esta escondida aparece un icono en la bandeja del sistema. Sin el,
 * si Godot se colgara o el sondeo fallara, la ventana quedaria invisible y solo
 * se podria recuperar desde el Administrador de tareas.
 */
let tray: Tray | null = null

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export function hideDuringGame(win: BrowserWindow, tag: string): void {
  if (win.isDestroyed()) return

  const icon = iconPath()
  if (!tray && icon) {
    tray = new Tray(nativeImage.createFromPath(icon))
    tray.setToolTip(`Godot Hub — ${tag} en ejecución`)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Godot ${tag} en ejecución`, enabled: false },
        { type: 'separator' },
        { label: 'Mostrar Godot Hub', click: () => restoreAfterGame(win) },
        { label: 'Salir', click: () => app.quit() }
      ])
    )
    tray.on('double-click', () => restoreAfterGame(win))
  }

  win.hide()
  log('info', 'gestor escondido mientras Godot está abierto', { tag })
}

export function restoreAfterGame(win: BrowserWindow): void {
  destroyTray()
  if (win.isDestroyed()) return

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Al salir de la app no debe quedar un icono huerfano en la bandeja. */
export function disposeSession(): void {
  destroyTray()
}
