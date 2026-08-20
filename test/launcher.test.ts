import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getConfig, setConfig } from '../src/main/config'
import { forgetVersion, launchVersion } from '../src/main/launcher'
import { openedPaths, __setOpenPathError } from './helpers/electron-mock'
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
    openedPaths.length = 0
    __setOpenPathError('')
    setConfig({ workspacePath: workspace, workspaceConfirmed: true, installed: [VERSION] })
  })

  afterEach(async () => {
    __setOpenPathError('')
    await rm(workspace, { recursive: true, force: true })
  })

  const createExe = async (): Promise<string> => {
    const dir = join(workspace, VERSION.folder)
    await mkdir(dir, { recursive: true })
    const exePath = join(dir, VERSION.exe)
    await writeFile(exePath, 'binario-falso')
    return exePath
  }

  it('abre el ejecutable de la versión instalada', async () => {
    const exePath = await createExe()

    const result = await launchVersion(VERSION.tag)

    expect(result.ok).toBe(true)
    expect(openedPaths).toEqual([exePath])
  })

  it('avisa si la carpeta se borró a mano', async () => {
    // Sin crear el ejecutable: la entrada sigue en config pero el disco no.
    const result = await launchVersion(VERSION.tag)

    expect(result).toMatchObject({ ok: false, reason: 'missing' })
    expect(openedPaths).toEqual([])
  })

  it('avisa si la versión no está registrada', async () => {
    const result = await launchVersion('1.0-stable')

    expect(result).toMatchObject({ ok: false, reason: 'not-installed' })
    expect(openedPaths).toEqual([])
  })

  it('avisa si no hay carpeta de trabajo', async () => {
    setConfig({ workspacePath: null })

    const result = await launchVersion(VERSION.tag)
    expect(result).toMatchObject({ ok: false, reason: 'no-workspace' })
  })

  it('propaga el error de Windows si no se puede abrir', async () => {
    await createExe()
    __setOpenPathError('No hay ninguna aplicación asociada')

    const result = await launchVersion(VERSION.tag)
    expect(result).toMatchObject({ ok: false, reason: 'failed' })
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

        expect(result.ok).toBe(false)
        expect(openedPaths).toEqual([])
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
