import { spawn, execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { getConfig, setConfig } from './config'
import { log } from './logger'
import type { LaunchResult } from '../shared/types'

/**
 * Cada cuanto se comprueba si Godot sigue vivo despues de que muera el proceso
 * que lanzamos. Sondear no es elegante, pero es la unica forma fiable de saberlo
 * (ver la nota de abajo sobre los procesos de Godot).
 */
const POLL_MS = 1200

let watching: NodeJS.Timeout | null = null

/**
 * ¿Queda algun proceso con este nombre de imagen?
 *
 * Godot no se comporta como un ejecutable normal: al arrancar levanta DOS
 * procesos, y al abrir un proyecto desde el Administrador de Proyectos el
 * proceso original termina y el editor continua en otro distinto. Vigilar solo
 * el PID que lanzamos haria creer que Godot se cerro cuando en realidad acaba
 * de abrirse el editor.
 */
/**
 * ¿Menciona la salida de tasklist un proceso con este nombre?
 *
 * Se exporta para poder probarlo: aqui se colo un fallo real. Con el formato de
 * tabla (/NH) tasklist RECORTA el nombre a 25 caracteres y se come la extension,
 * asi que "Godot_v4.7.1-stable_win64.exe" sale impreso como
 * "Godot_v4.7.1-stable_win64" y la comparacion nunca casaba: el gestor daba a
 * Godot por cerrado un segundo despues de abrirlo. El formato CSV lo devuelve
 * completo y entrecomillado.
 */
export function mentionsImage(stdout: string, imageName: string): boolean {
  const target = imageName.toLowerCase()
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"'))
    .some((row) => row.toLowerCase().includes(`"${target}"`))
}

function anyRunning(imageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true },
      (error, stdout) => {
        // Sin tasklist (o si falla) se asume que ya no queda nada: es preferible
        // reaparecer de mas que dejar la ventana escondida para siempre.
        if (error) return resolve(false)
        resolve(mentionsImage(stdout, imageName))
      }
    )
  })
}

/** Espera a que no quede ningun proceso con ese nombre y entonces avisa. */
function waitUntilClosed(imageName: string, onClosed: () => void): void {
  if (watching) clearTimeout(watching)

  const poll = async (): Promise<void> => {
    if (await anyRunning(imageName)) {
      watching = setTimeout(() => void poll(), POLL_MS)
      return
    }
    watching = null
    log('info', 'Godot se cerró', { imageName })
    onClosed()
  }

  watching = setTimeout(() => void poll(), POLL_MS)
}

/** Corta la vigilancia en curso (al salir de la app). */
export function stopWatching(): void {
  if (watching) clearTimeout(watching)
  watching = null
}

/**
 * Arranca una version ya instalada.
 *
 * El ejecutable se recompone desde `workspacePath` + la entrada registrada en
 * `installed`, y se comprueba que la ruta resultante siga dentro de la carpeta
 * de trabajo: un config.json manipulado a mano no debe convertirse en "ejecuta
 * cualquier binario del sistema".
 *
 * `onClosed` se invoca cuando no queda ningun proceso de esa version.
 */
export async function launchVersion(tag: string, onClosed?: () => void): Promise<LaunchResult> {
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

  try {
    // detached + unref: Godot sobrevive aunque se cierre el gestor. Seguimos
    // recibiendo su 'exit' mientras sigamos vivos, que es lo que dispara la
    // vigilancia por nombre de imagen.
    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
      cwd: join(workspace, entry.folder)
    })

    child.on('error', (error) => log('error', 'fallo al arrancar Godot', error))
    child.unref()

    if (onClosed) waitUntilClosed(basename(exePath), onClosed)

    log('info', 'versión iniciada', { tag, exePath, pid: child.pid })
    return { ok: true, exePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar el proceso.'
    log('error', 'no se pudo iniciar la versión', { tag, message })
    return { ok: false, reason: 'failed', message, exePath }
  }
}

/** Quita del registro una version cuya carpeta ya no existe. */
export function forgetVersion(tag: string): void {
  const remaining = getConfig().installed.filter((item) => item.tag !== tag)
  setConfig({ installed: remaining })
  log('info', 'versión olvidada del registro', { tag })
}
