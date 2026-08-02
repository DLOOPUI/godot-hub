import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, Notification, shell } from 'electron'

/**
 * Toast nativo de Windows al terminar una instalacion.
 *
 * Requisitos en Windows para que el toast salga con nombre e icono en vez de
 * ignorarse: `app.setAppUserModelId()` (se hace en index.ts) y un acceso directo
 * en el Menu Inicio con ese mismo AppUserModelID. El instalador NSIS lo crea;
 * ejecutando sin instalar, el toast puede no aparecer.
 */
function iconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico')]
    : [join(app.getAppPath(), 'build', 'icon.ico')]

  return candidates.find((path) => existsSync(path))
}

export function notifyInstalled(tag: string, exePath: string, workspace: string): void {
  if (!Notification.isSupported()) return

  const icon = iconPath()
  const notification = new Notification({
    title: `Godot ${tag} instalado`,
    body: `Listo en ${workspace}`,
    ...(icon ? { icon } : {})
  })

  // Un clic lleva al ejecutable recien instalado, seleccionado en el Explorador.
  notification.on('click', () => shell.showItemInFolder(exePath))
  notification.show()
}

export function notifyFailed(tag: string, reason: string): void {
  if (!Notification.isSupported()) return

  const icon = iconPath()
  new Notification({
    title: `No se pudo instalar Godot ${tag}`,
    body: reason,
    ...(icon ? { icon } : {})
  }).show()
}
