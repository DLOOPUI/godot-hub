/**
 * Unica frontera entre la UI y el backend.
 *
 * Ningun otro archivo del renderer puede tocar `window.api`. Si algun dia se
 * migra de Electron a Tauri, este archivo es lo unico que se reescribe.
 */
import type { GodotUpdaterApi } from '../preload/index'

declare global {
  interface Window {
    api: GodotUpdaterApi
  }
}

export const bridge: GodotUpdaterApi = window.api
