import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../shared/ipc'
import type { AppInfo, InstallRequest, PickResult, WindowAction } from '../shared/ipc'
import type {
  ClearResult,
  Config,
  InstallDone,
  InstallError,
  InstallProgress,
  ReleasesResult,
  WorkspaceInspection
} from '../shared/types'

type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
type EventChannel = (typeof EVENT_CHANNELS)[number]

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

function invoke<T>(channel: InvokeChannel, ...args: unknown[]): Promise<T> {
  if (!invokeAllowed.has(channel)) {
    return Promise.reject(new Error(`Canal IPC no permitido: ${channel}`))
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function on(channel: EventChannel, listener: (...args: never[]) => void): () => void {
  if (!eventAllowed.has(channel)) {
    throw new Error(`Canal de evento no permitido: ${channel}`)
  }
  const wrapped = (_event: unknown, ...args: unknown[]): void => {
    ;(listener as (...a: unknown[]) => void)(...args)
  }
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

/**
 * Superficie unica expuesta al renderer. No se expone `ipcRenderer` crudo ni
 * ninguna capacidad de Node: solo estas funciones concretas.
 */
const api = {
  getAppInfo: (): Promise<AppInfo> => invoke<AppInfo>('app:info'),
  windowAction: (action: WindowAction): Promise<void> => invoke<void>('window:action', action),
  onMaximizedChanged: (listener: (isMaximized: boolean) => void): (() => void) =>
    on('window:maximized-changed', listener as (...args: never[]) => void),

  getConfig: (): Promise<Config> => invoke<Config>('config:get'),
  setConfig: (patch: Partial<Config>): Promise<Config> => invoke<Config>('config:set', patch),

  pickWorkspace: (): Promise<PickResult> => invoke<PickResult>('workspace:pick'),
  inspectWorkspace: (path: string): Promise<WorkspaceInspection> =>
    invoke<WorkspaceInspection>('workspace:inspect', path),
  clearWorkspace: (path: string): Promise<ClearResult> => invoke<ClearResult>('workspace:clear', path),
  revealWorkspace: (path: string): Promise<void> => invoke<void>('workspace:reveal', path),

  listReleases: (force = false): Promise<ReleasesResult> => invoke<ReleasesResult>('releases:list', force),

  startInstall: (request: InstallRequest): Promise<string> => invoke<string>('install:start', request),
  cancelInstall: (jobId: string): Promise<void> => invoke<void>('install:cancel', jobId),
  onInstallProgress: (listener: (progress: InstallProgress) => void): (() => void) =>
    on('install:progress', listener as (...args: never[]) => void),
  onInstallDone: (listener: (done: InstallDone) => void): (() => void) =>
    on('install:done', listener as (...args: never[]) => void),
  onInstallError: (listener: (error: InstallError) => void): (() => void) =>
    on('install:error', listener as (...args: never[]) => void),

  log: (level: 'info' | 'warn' | 'error', message: string): Promise<void> =>
    invoke<void>('app:log', level, message),
  openLogs: (): Promise<void> => invoke<void>('app:open-logs')
}

export type GodotUpdaterApi = typeof api

contextBridge.exposeInMainWorld('api', api)
