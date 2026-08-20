import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { getConfig, setConfig } from './config'
import { cancelInstall, startInstall } from './installer'
import { listLibrary } from './library'
import { listNews } from './news'
import { forgetVersion, launchVersion } from './launcher'
import { hideDuringGame, restoreAfterGame } from './session'
import { log, logDir } from './logger'
import { listReleases } from './releases'
import type { LogLevel } from './logger'
import { clearWorkspace, inspectWorkspace } from './workspace'
import type { AppInfo, InstallRequest, PickResult, WindowAction } from '../shared/ipc'
import type {
  ClearResult,
  Config,
  LaunchResult,
  LibraryEntry,
  NewsResult,
  ReleasesResult,
  WorkspaceInspection
} from '../shared/types'

export function registerIpc(isDev: boolean): void {
  ipcMain.handle('app:info', (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    isDev
  }))

  ipcMain.handle('window:action', (event, action: WindowAction): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    switch (action) {
      case 'minimize':
        win.minimize()
        break
      case 'toggle-maximize':
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        break
      case 'close':
        win.close()
        break
    }
  })

  ipcMain.handle('config:get', (): Config => getConfig())

  ipcMain.handle('config:set', (_event, patch: Partial<Config>): Config => {
    // El renderer no puede reescribir la lista de instalaciones ni la version
    // del esquema: eso lo gestiona el motor de instalacion (fase 6).
    const { installed: _installed, version: _version, ...safe } = patch
    return setConfig(safe)
  })

  ipcMain.handle('workspace:pick', async (event): Promise<PickResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Elija la carpeta donde se realizarán las acciones de autoactualización',
      buttonLabel: 'Usar esta carpeta',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    const picked = result.filePaths[0]
    if (result.canceled || !picked) return { canceled: true }
    return { canceled: false, inspection: await inspectWorkspace(picked) }
  })

  ipcMain.handle(
    'workspace:inspect',
    (_event, path: string): Promise<WorkspaceInspection> => inspectWorkspace(path)
  )

  ipcMain.handle('workspace:clear', async (_event, path: string): Promise<ClearResult> => {
    log('warn', 'workspace:clear — vaciando carpeta de trabajo', { path })
    const result = await clearWorkspace(path)
    log('info', 'workspace:clear terminado', { deleted: result.deleted, failed: result.failed.length })
    return result
  })

  ipcMain.handle('workspace:reveal', async (_event, path: string): Promise<void> => {
    await shell.openPath(path)
  })

  ipcMain.handle('releases:list', (_event, force: boolean): Promise<ReleasesResult> => listReleases(force))

  ipcMain.handle('install:start', (event, request: InstallRequest): string => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No hay ventana asociada a la petición.')

    const jobId = randomUUID()
    log('info', 'install:start', {
      jobId,
      tag: request.release.tag,
      flavor: request.flavor,
      cleanup: request.cleanup
    })
    // No se espera: el progreso y el final viajan por eventos.
    void startInstall(win, jobId, request)
    return jobId
  })

  ipcMain.handle('install:cancel', (_event, jobId: string): void => {
    log('info', 'install:cancel solicitado', { jobId })
    cancelInstall(jobId)
  })

  ipcMain.handle('news:list', (_event, force: boolean): Promise<NewsResult> => listNews(force))

  /**
   * Los enlaces de las noticias se abren en el navegador del sistema, nunca
   * dentro de la app. Se vuelve a exigir https aqui aunque el parser ya filtre:
   * este canal queda expuesto al renderer y no debe poder abrir `file://` ni
   * nada que no sea una pagina web.
   */
  ipcMain.handle('app:open-external', async (_event, url: string): Promise<void> => {
    if (!/^https:\/\//i.test(url)) {
      log('warn', 'enlace externo rechazado', { url: String(url).slice(0, 200) })
      return
    }
    await shell.openExternal(url)
  })

  ipcMain.handle('library:list', (): Promise<LibraryEntry[]> => listLibrary())

  ipcMain.handle('godot:launch', async (event, tag: string): Promise<LaunchResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)

    // El aviso de cierre solo se engancha si de verdad vamos a escondernos:
    // sondear procesos para nada seria trabajo inutil.
    const hide = win !== null && getConfig().hideWhileRunning
    const result = await launchVersion(tag, hide && win ? () => {
      restoreAfterGame(win)
      if (!win.isDestroyed()) win.webContents.send('godot:closed', tag)
    } : undefined)

    if (result.ok && hide && win) hideDuringGame(win, tag)
    return result
  })

  ipcMain.handle('godot:forget', (_event, tag: string): void => forgetVersion(tag))

  ipcMain.handle('app:log', (_event, level: LogLevel, message: string): void => {
    log(level, `[renderer] ${String(message).slice(0, 2000)}`)
  })

  ipcMain.handle('app:open-logs', async (): Promise<void> => {
    await shell.openPath(logDir())
  })
}
