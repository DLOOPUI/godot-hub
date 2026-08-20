/**
 * Contrato IPC compartido por main, preload y renderer.
 *
 * Cada canal se declara aqui una sola vez. El preload usa `INVOKE_CHANNELS` como
 * allowlist: lo que no este en esta lista no se puede llamar desde el renderer.
 */
import type {
  CleanupMode,
  ClearResult,
  Config,
  GodotFlavor,
  InstallDone,
  InstallError,
  InstallProgress,
  LaunchResult,
  Release,
  ReleasesResult,
  WorkspaceInspection
} from './types'

export interface InstallRequest {
  release: Release
  flavor: GodotFlavor
  cleanup: CleanupMode
}

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

export interface AppInfo {
  name: string
  version: string
  electron: string
  isDev: boolean
}

/** Resultado del selector nativo de carpeta. */
export type PickResult = { canceled: true } | { canceled: false; inspection: WorkspaceInspection }

/** Peticiones renderer -> main (patron invoke/handle). */
export interface InvokeMap {
  'app:info': () => AppInfo
  'window:action': (action: WindowAction) => void
  'config:get': () => Config
  'config:set': (patch: Partial<Config>) => Config
  'workspace:pick': () => PickResult
  'workspace:inspect': (path: string) => WorkspaceInspection
  'workspace:clear': (path: string) => ClearResult
  'workspace:reveal': (path: string) => void
  'releases:list': (force: boolean) => ReleasesResult
  /** Devuelve el id del trabajo; el progreso llega por eventos. */
  'install:start': (request: InstallRequest) => string
  'install:cancel': (jobId: string) => void
  'godot:launch': (tag: string) => LaunchResult
  'godot:forget': (tag: string) => void
  'app:log': (level: 'info' | 'warn' | 'error', message: string) => void
  'app:open-logs': () => void
}

/** Eventos main -> renderer (patron send/on). */
export interface EventMap {
  'window:maximized-changed': (isMaximized: boolean) => void
  'install:progress': (progress: InstallProgress) => void
  'install:done': (done: InstallDone) => void
  'install:error': (error: InstallError) => void
  /** Godot se cerró y el gestor vuelve a estar visible. */
  'godot:closed': (tag: string) => void
}

export const INVOKE_CHANNELS = [
  'app:info',
  'window:action',
  'config:get',
  'config:set',
  'workspace:pick',
  'workspace:inspect',
  'workspace:clear',
  'workspace:reveal',
  'releases:list',
  'install:start',
  'install:cancel',
  'godot:launch',
  'godot:forget',
  'app:log',
  'app:open-logs'
] as const satisfies readonly (keyof InvokeMap)[]

export const EVENT_CHANNELS = [
  'window:maximized-changed',
  'install:progress',
  'install:done',
  'install:error',
  'godot:closed'
] as const satisfies readonly (keyof EventMap)[]
