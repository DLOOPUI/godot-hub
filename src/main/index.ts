import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { getConfig } from './config'
import { clearTempDir } from './installer'
import { registerIpc } from './ipc'
import { stopWatching } from './launcher'
import { disposeSession } from './session'
import { installCrashHandlers, log } from './logger'

const isDev = !app.isPackaged

/**
 * Obligatorio en Windows: sin AppUserModelId los toasts nativos aparecen sin
 * nombre ni icono (o no aparecen). Se fija antes de crear cualquier ventana.
 */
app.setAppUserModelId('com.david.godot-hub')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#2b3a4a', // igual a --surface: evita el flash blanco al abrir
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const notifyMaximized = (): void => {
    mainWindow?.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', notifyMaximized)
  mainWindow.on('unmaximize', notifyMaximized)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Los enlaces externos van al navegador del sistema, nunca a una ventana Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Una sola instancia: dos procesos escribiendo la misma carpeta de trabajo
// terminarian pisandose durante una descarga.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    installCrashHandlers()
    log('info', 'arranque', { version: app.getVersion(), electron: process.versions.electron })
    registerIpc(isDev)

    // Un cierre a mitad de descarga deja un .part huerfano en la carpeta de
    // trabajo. Se barre al arrancar, antes de que el usuario vea la lista.
    const workspace = getConfig().workspacePath
    if (workspace) await clearTempDir(workspace)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    stopWatching()
    disposeSession()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
