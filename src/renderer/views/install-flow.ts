/**
 * Pasos 4 y 5: confirmar la instalacion y decidir que pasa con la version actual.
 *
 * Devuelve la decision, no la ejecuta: la descarga es de la fase 6.
 */
import { bridge } from '../bridge'
import { iconCheck, iconKeep, iconTrash } from '../components/icons'
import { openModal } from '../components/modal'
import { escapeHtml, formatBytes } from '../format'
import type { CleanupMode, Config, GodotFlavor, Release } from '../../shared/types'

export interface InstallDecision {
  release: Release
  flavor: GodotFlavor
  cleanup: CleanupMode
}

export async function runInstallFlow(
  release: Release,
  flavor: GodotFlavor,
  config: Config
): Promise<InstallDecision | null> {
  let current = config

  if (!current.skipInstallConfirm) {
    const confirmed = await confirmInstall(release, flavor)
    if (confirmed.value !== 'ok') return null
    if (confirmed.checked) current = await bridge.setConfig({ skipInstallConfirm: true })
  }

  const cleanup = await resolveCleanup(current)
  if (cleanup === null) return null

  return { release, flavor, cleanup }
}

/** Paso 4. La casilla "No preguntar a la proxima" es reversible desde Ajustes. */
async function confirmInstall(
  release: Release,
  flavor: GodotFlavor
): Promise<{ value: string | null; checked: boolean }> {
  const asset = release.assets[flavor]
  const size = asset ? formatBytes(asset.size) : 'tamaño desconocido'

  return openModal({
    title: `Instalar Godot ${escapeHtml(release.tag)}`,
    body: `
      <p>Se descargará el archivo (${size}) y se extraerá en la carpeta de trabajo.</p>
      <p class="modal__note">
        Variante: ${flavor === 'mono' ? '.NET (Mono)' : 'estándar'} &middot; win64.
        Se comprobará el SHA-512 antes de extraer.
      </p>
    `,
    checkbox: 'No preguntar a la próxima',
    actions: [
      { label: 'Cancelar', value: null, variant: 'ghost' },
      { label: 'Aceptar', value: 'ok', variant: 'accent', icon: iconCheck() }
    ]
  })
}

/**
 * Paso 5. No se salta con `skipInstallConfirm`: esa casilla cubre el aviso
 * informativo del paso 4, no una decision destructiva. Solo la salta su propia
 * memoria (`defaultCleanupMode`), tambien reversible desde Ajustes.
 */
async function resolveCleanup(config: Config): Promise<CleanupMode | null> {
  // Sin nada instalado no hay version que borrar: preguntar seria ruido.
  if (config.installed.length === 0) return 'keep'
  if (config.defaultCleanupMode) return config.defaultCleanupMode

  const installedList = config.installed
    .map((item) => `<li><code>${escapeHtml(item.tag)}</code></li>`)
    .join('')

  const result = await openModal({
    title: '¿Qué hacer con la versión actual?',
    body: `
      <p>Ahora mismo hay esto en la carpeta de trabajo:</p>
      <ul class="entry-list">${installedList}</ul>
    `,
    checkbox: 'Recordar mi elección',
    actions: [
      { label: 'Cancelar', value: null, variant: 'ghost' },
      { label: 'Conservarla en la carpeta', value: 'keep', icon: iconKeep() },
      { label: 'Eliminar la versión actual', value: 'delete', variant: 'danger', icon: iconTrash() }
    ]
  })

  if (result.value !== 'keep' && result.value !== 'delete') return null

  if (result.checked) await bridge.setConfig({ defaultCleanupMode: result.value })
  return result.value
}
