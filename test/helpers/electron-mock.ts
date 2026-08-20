/**
 * Doble de `electron` para las pruebas.
 *
 * Solo implementa lo que usa el proceso principal. `userData` apunta a una
 * carpeta temporal distinta por proceso de test, y `trashItem` borra de verdad
 * (no hay Papelera en un entorno de pruebas), lo que basta para comprobar que
 * el borrado ocurre.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * En globalThis, no en una variable de modulo: las pruebas usan
 * `vi.resetModules()` y este archivo se recargaria con el resto, entregando una
 * carpeta temporal distinta a cada mitad del test.
 */
const KEY = '__gauUserData'
type Holder = { [KEY]?: string }

export const app = {
  isPackaged: false,
  getName: () => 'godot-autoupdate',
  getVersion: () => '0.0.0-test',
  getAppPath: () => process.cwd(),
  getPath: (name: string): string => {
    if (name === 'userData') {
      const holder = globalThis as Holder
      holder[KEY] ??= mkdtempSync(join(tmpdir(), 'gau-userdata-'))
      return holder[KEY]
    }
    if (name === 'home') return join(tmpdir(), 'gau-home')
    if (name === 'desktop') return join(tmpdir(), 'gau-home', 'Desktop')
    if (name === 'documents') return join(tmpdir(), 'gau-home', 'Documents')
    if (name === 'downloads') return join(tmpdir(), 'gau-home', 'Downloads')
    if (name === 'appData') return join(tmpdir(), 'gau-home', 'AppData')
    if (name === 'music') return join(tmpdir(), 'gau-home', 'Music')
    if (name === 'pictures') return join(tmpdir(), 'gau-home', 'Pictures')
    if (name === 'videos') return join(tmpdir(), 'gau-home', 'Videos')
    throw new Error(`getPath no soportado en pruebas: ${name}`)
  }
}

/**
 * Rutas pasadas a `shell.openPath`. Las pruebas del lanzador comprueban aqui
 * que se abrio el ejecutable correcto, ya que en un entorno de test no se puede
 * arrancar Godot de verdad.
 */
export const openedPaths: string[] = []

/** Fuerza el error que devolveria ShellExecute al no poder abrir el archivo. */
let openPathError = ''
export function __setOpenPathError(message: string): void {
  openPathError = message
}

export const shell = {
  /** Sin Papelera: se borra directamente y el llamante no nota la diferencia. */
  trashItem: async (path: string): Promise<void> => {
    await rm(path, { recursive: true, force: true })
  },
  openPath: async (path: string): Promise<string> => {
    openedPaths.push(path)
    return openPathError
  },
  showItemInFolder: (): void => undefined,
  openExternal: async (): Promise<void> => undefined
}

/** `net.fetch` de Electron tiene la misma firma que el fetch global. */
export const net = {
  fetch: (input: string, init?: RequestInit): Promise<Response> => globalThis.fetch(input, init)
}

export class Notification {
  static isSupported = (): boolean => false
  on(): this {
    return this
  }
  show(): void {}
}

export const BrowserWindow = class {}
export const ipcMain = { handle: (): void => undefined }
export const dialog = { showOpenDialog: async (): Promise<unknown> => ({ canceled: true }) }

/** Restablece el userData entre suites que necesiten empezar de cero. */
export function __resetUserData(): void {
  delete (globalThis as Holder)[KEY]
}
