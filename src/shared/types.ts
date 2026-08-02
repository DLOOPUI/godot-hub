/** Modelos de dominio compartidos por main y renderer. */

/** Que hacer con la version ya instalada al instalar otra (paso 5). */
export type CleanupMode = 'delete' | 'keep'

/** Variante de Godot a descargar. */
export type GodotFlavor = 'standard' | 'mono'

export interface InstalledVersion {
  tag: string
  folder: string
  exe: string
  flavor: GodotFlavor
  installedAt: string
}

export interface Config {
  version: 1
  workspacePath: string | null
  workspaceConfirmed: boolean
  skipInstallConfirm: boolean
  defaultCleanupMode: CleanupMode | null
  flavor: GodotFlavor
  installed: InstalledVersion[]
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  workspacePath: null,
  workspaceConfirmed: false,
  skipInstallConfirm: false,
  defaultCleanupMode: null,
  flavor: 'standard',
  installed: []
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  /** Etiqueta oficial, p. ej. "4.5-stable". */
  tag: string
  /** Version sin sufijo, p. ej. "4.5". */
  version: string
  publishedAt: string
  /** El asset puede faltar en releases antiguos: por eso es opcional. */
  assets: Partial<Record<GodotFlavor, ReleaseAsset>> & { checksums?: ReleaseAsset }
}

export interface ReleasesResult {
  items: Release[]
  /** ISO de la ultima descarga real desde GitHub. */
  fetchedAt: string | null
  /** true cuando lo devuelto viene de cache porque la red fallo. */
  stale: boolean
  /** Mensaje de error ya redactado, o null. */
  error: string | null
}

export type InstallPhase = 'cleanup' | 'download' | 'verify' | 'extract' | 'finalize'

export interface InstallProgress {
  jobId: string
  phase: InstallPhase
  receivedBytes: number
  totalBytes: number
  /** Bytes por segundo de la descarga; 0 fuera de la fase de descarga. */
  speedBps: number
  /** Segundos restantes estimados, o null si no se puede estimar. */
  etaSec: number | null
}

export interface InstallDone {
  jobId: string
  tag: string
  folder: string
  exePath: string
}

export interface InstallError {
  jobId: string
  phase: InstallPhase
  message: string
  /** true cuando lo aborto el usuario, no un fallo. */
  canceled: boolean
}

/** Motivo por el que una carpeta no puede usarse como area de trabajo. */
export type WorkspaceRejection =
  | 'not-found'
  | 'not-a-directory'
  | 'not-writable'
  | 'drive-root'
  | 'protected'
  | 'contains-app'

export interface WorkspaceEntry {
  name: string
  isDirectory: boolean
}

export interface WorkspaceInspection {
  path: string
  /** `null` si la carpeta es valida. */
  rejection: WorkspaceRejection | null
  /** Mensaje ya redactado para mostrar al usuario. */
  rejectionMessage: string | null
  entries: WorkspaceEntry[]
  entryCount: number
  totalBytes: number
}

export interface ClearResult {
  deleted: number
  /** Elementos que no se pudieron borrar, normalmente por estar en uso. */
  failed: { name: string; reason: string }[]
}
