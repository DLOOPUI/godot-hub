import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getConfig, setConfig } from '../src/main/config'
import { forgetVersion, launchVersion, mentionsImage, stopWatching } from '../src/main/launcher'
import type { InstalledVersion } from '../src/shared/types'

const VERSION: InstalledVersion = {
  tag: '9.9-stable',
  folder: 'Godot_v9.9-stable_win64',
  exe: 'Godot_v9.9-stable_win64.exe',
  flavor: 'standard',
  installedAt: '2026-01-01T00:00:00Z'
}

describe('launchVersion', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'gau-launch-'))
    setConfig({ workspacePath: workspace, workspaceConfirmed: true, installed: [VERSION] })
  })

  afterEach(async () => {
    stopWatching()
    // Windows mantiene el .exe bloqueado un instante tras terminar el proceso:
    // sin reintentos, el borrado falla con EBUSY de forma intermitente.
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  /**
   * Se usa un ejecutable real del sistema (hostname.exe: imprime y termina) en
   * vez de un archivo falso. Es la unica forma de comprobar de verdad que se
   * lanza el proceso y que se detecta su cierre; con un .txt renombrado spawn
   * fallaria y la prueba no diria nada.
   */
  const installRealExe = async (): Promise<void> => {
    const dir = join(workspace, VERSION.folder)
    await mkdir(dir, { recursive: true })
    await copyFile(join(process.env['WINDIR'] ?? 'C:\Windows', 'System32', 'hostname.exe'),
      join(dir, VERSION.exe))
  }

  it('lanza el ejecutable de la versión instalada', async () => {
    await installRealExe()

    // Se espera al cierre antes de terminar: dejar el proceso vivo bloquea el
    // borrado de la carpeta temporal.
    const closed = new Promise<void>((resolve) => {
      void launchVersion(VERSION.tag, resolve).then((result) => {
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.exePath).toBe(join(workspace, VERSION.folder, VERSION.exe))
      })
    })

    await closed
  })

  it('avisa cuando Godot se cierra', async () => {
    await installRealExe()

    const closed = new Promise<void>((resolve) => {
      void launchVersion(VERSION.tag, resolve)
    })

    // hostname.exe termina solo; el aviso llega tras el primer sondeo.
    await expect(closed).resolves.toBeUndefined()
  })

  it('avisa si la carpeta se borró a mano', async () => {
    // Sin crear el ejecutable: la entrada sigue en config pero el disco no.
    const result = await launchVersion(VERSION.tag)

    expect(result).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('avisa si la versión no está registrada', async () => {
    const result = await launchVersion('1.0-stable')

    expect(result).toMatchObject({ ok: false, reason: 'not-installed' })
  })

  it('avisa si no hay carpeta de trabajo', async () => {
    setConfig({ workspacePath: null })

    const result = await launchVersion(VERSION.tag)
    expect(result).toMatchObject({ ok: false, reason: 'no-workspace' })
  })

  describe('config manipulada', () => {
    /**
     * `installed` lo escribe el proceso principal, pero config.json es un
     * archivo de texto que cualquiera puede editar. La propiedad que importa no
     * es el codigo de error concreto, sino que nunca se abra nada fuera del
     * area de trabajo: sin eso, "Iniciar" seria "ejecuta cualquier binario".
     */
    const tampered: [string, string, string][] = [
      ['sube con ..', '..\..\Windows\System32', 'calc.exe'],
      ['carpeta absoluta', 'C:\Windows\System32', 'calc.exe'],
      ['ejecutable absoluto', VERSION.folder, 'C:\Windows\System32\calc.exe'],
      ['sube desde el nombre del exe', VERSION.folder, '..\..\..\calc.exe']
    ]

    for (const [label, folder, exe] of tampered) {
      it(`no abre nada fuera del área de trabajo (${label})`, async () => {
        setConfig({ installed: [{ ...VERSION, folder, exe }] })

        const result = await launchVersion(VERSION.tag)

        // Las comprobaciones van antes de spawn: si devuelve !ok, no se
        // ejecuto nada.
        expect(result.ok).toBe(false)
      })
    }

    it('identifica explícitamente la ruta que se sale con ..', async () => {
      setConfig({ installed: [{ ...VERSION, folder: '..\..\Windows', exe: 'calc.exe' }] })

      const result = await launchVersion(VERSION.tag)
      expect(result).toMatchObject({ ok: false, reason: 'outside-workspace' })
    })
  })
})

describe('forgetVersion', () => {
  beforeEach(() => {
    setConfig({ installed: [VERSION, { ...VERSION, tag: '8.8-stable', folder: 'otra' }] })
  })

  it('quita solo la versión indicada', () => {
    forgetVersion(VERSION.tag)

    expect(getConfig().installed.map((item) => item.tag)).toEqual(['8.8-stable'])
  })

  it('no falla si la versión ya no estaba', () => {
    forgetVersion('inexistente')
    expect(getConfig().installed).toHaveLength(2)
  })
})

describe('mentionsImage', () => {
  const IMAGE = 'Godot_v4.7.1-stable_win64.exe'

  it('reconoce el proceso en la salida CSV', () => {
    // Salida real de: tasklist /FI "IMAGENAME eq ..." /FO CSV /NH
    const csv = '"Godot_v4.7.1-stable_win64.exe","29936","Console","2","320,304 KB"'
    expect(mentionsImage(csv, IMAGE)).toBe(true)
  })

  it('no se deja engañar por el formato de tabla, que recorta el nombre', () => {
    // Este era el fallo: con /NH sin CSV, tasklist imprime solo 25 caracteres y
    // sin extension, y la comparacion daba false con Godot abierto. La prueba
    // documenta por que el formato importa.
    const tabla = '\nGodot_v4.7.1-stable_win64    29936 Console                    2   320,304 KB\n'
    expect(mentionsImage(tabla, IMAGE)).toBe(false)
  })

  it('devuelve false cuando no hay ningún proceso', () => {
    const vacio = 'INFO: No tasks are running which match the specified criteria.'
    expect(mentionsImage(vacio, IMAGE)).toBe(false)
  })

  it('no confunde una versión con otra', () => {
    const otra = '"Godot_v4.6.3-stable_win64.exe","111","Console","2","10 KB"'
    expect(mentionsImage(otra, IMAGE)).toBe(false)
  })

  it('encuentra el proceso entre varias filas', () => {
    const varias = [
      '"Godot_v4.6.3-stable_win64.exe","111","Console","2","10 KB"',
      '"Godot_v4.7.1-stable_win64.exe","222","Console","2","20 KB"'
    ].join('\r\n')
    expect(mentionsImage(varias, IMAGE)).toBe(true)
  })
})
