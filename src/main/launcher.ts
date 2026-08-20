import { access, constants } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { shell } from 'electron'
import { getConfig, setConfig } from './config'
import { log } from './logger'
import type { LaunchResult } from '../shared/types'

/**
 * Arranca una version ya instalada.
 *
 * El ejecutable se recompone desde `workspacePath` + la entrada registrada en
 * `installed`, y se comprueba que la ruta resultante siga dentro de la carpeta
 * de trabajo: un config.json manipulado a mano no debe convertirse en "ejecuta
 * cualquier binario del sistema".
 */
export async function launchVersion(tag: string): Promise<LaunchResult> {
  const config = getConfig()
  const workspace = config.workspacePath

  if (!workspace) {
    return { ok: false, reason: 'no-workspace', message: 'No hay carpeta de trabajo configurada.' }
  }

  const entry = config.installed.find((item) => item.tag === tag)
  if (!entry) {
    return { ok: false, reason: 'not-installed', message: `La versión ${tag} no está instalada.` }
  }

  const exePath = resolve(join(workspace, entry.folder, entry.exe))
  if (relative(resolve(workspace), exePath).startsWith('..')) {
    log('error', 'ruta de ejecutable fuera del área de trabajo', { tag, exePath })
    return {
      ok: false,
      reason: 'outside-workspace',
      message: 'La ruta registrada apunta fuera de la carpeta de trabajo. No se ejecutará.'
    }
  }

  try {
    await access(exePath, constants.F_OK)
  } catch {
    // La carpeta se pudo borrar a mano por fuera de la app.
    return {
      ok: false,
      reason: 'missing',
      message: `No se encuentra ${entry.exe}. ¿Se borró la carpeta a mano?`,
      exePath
    }
  }

  // openPath usa ShellExecute: el proceso queda desligado del nuestro, asi que
  // cerrar el gestor no se lleva por delante el editor abierto.
  const error = await shell.openPath(exePath)
  if (error) {
    log('error', 'no se pudo iniciar la versión', { tag, error })
    return { ok: false, reason: 'failed', message: error, exePath }
  }

  log('info', 'versión iniciada', { tag, exePath })
  return { ok: true, exePath }
}

/** Quita del registro una version cuya carpeta ya no existe. */
export function forgetVersion(tag: string): void {
  const remaining = getConfig().installed.filter((item) => item.tag !== tag)
  setConfig({ installed: remaining })
  log('info', 'versión olvidada del registro', { tag })
}
