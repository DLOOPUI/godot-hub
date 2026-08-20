import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from './helpers/electron-mock'
import type { Config } from '../src/shared/types'

const configPath = (): string => join(app.getPath('userData'), 'config.json')

/** El modulo cachea en memoria: cada prueba parte de cero. */
async function freshConfig(seed?: string): Promise<typeof import('../src/main/config')> {
  vi.resetModules()
  await rm(configPath(), { force: true })
  if (seed !== undefined) writeFileSync(configPath(), seed, 'utf8')
  return import('../src/main/config')
}

afterEach(async () => {
  await rm(configPath(), { force: true })
})

describe('getConfig', () => {
  it('parte de los valores por defecto sin archivo', async () => {
    const { getConfig } = await freshConfig()
    const config = getConfig()

    expect(config.workspacePath).toBeNull()
    expect(config.workspaceConfirmed).toBe(false)
    expect(config.skipInstallConfirm).toBe(false)
    expect(config.defaultCleanupMode).toBeNull()
    expect(config.installed).toEqual([])
  })

  it('no revienta con un archivo corrupto', async () => {
    const { getConfig } = await freshConfig('{esto no es json')
    expect(getConfig().workspacePath).toBeNull()
  })

  it('repone los campos ausentes', async () => {
    const { getConfig } = await freshConfig('{"workspacePath":"D:\\\\algo"}')
    const config = getConfig()

    expect(config.workspacePath).toBe('D:\\algo')
    expect(config.flavor).toBe('standard')
    expect(config.installed).toEqual([])
  })

  it('descarta valores con el tipo equivocado', async () => {
    // Un config.json editado a mano no debe poder dejar la app en un estado raro.
    const { getConfig } = await freshConfig(
      '{"workspacePath":42,"skipInstallConfirm":"sí","defaultCleanupMode":"borrar-todo","flavor":"otra"}'
    )
    const config = getConfig()

    expect(config.workspacePath).toBeNull()
    expect(config.skipInstallConfirm).toBe(false)
    expect(config.defaultCleanupMode).toBeNull()
    expect(config.flavor).toBe('standard')
  })

  it('descarta entradas de installed que no tienen forma de versión', async () => {
    const { getConfig } = await freshConfig(
      '{"installed":[{"tag":"4.5-stable","folder":"x"},{"sin":"tag"},"texto suelto"]}'
    )
    expect(getConfig().installed).toHaveLength(1)
    expect(getConfig().installed[0]?.tag).toBe('4.5-stable')
  })

  it('acepta installed no siendo un array', async () => {
    const { getConfig } = await freshConfig('{"installed":"no soy un array"}')
    expect(getConfig().installed).toEqual([])
  })
})

describe('setConfig', () => {
  it('fusiona el parche y persiste a disco', async () => {
    const { setConfig } = await freshConfig()

    setConfig({ workspacePath: 'D:\\uno', workspaceConfirmed: true })
    setConfig({ skipInstallConfirm: true })

    const saved = JSON.parse(readFileSync(configPath(), 'utf8')) as Config
    expect(saved.workspacePath).toBe('D:\\uno')
    expect(saved.workspaceConfirmed).toBe(true)
    expect(saved.skipInstallConfirm).toBe(true)
  })

  it('devuelve la configuración resultante', async () => {
    const { setConfig } = await freshConfig()
    expect(setConfig({ flavor: 'mono' }).flavor).toBe('mono')
  })

  it('permite volver a null para olvidar una elección recordada', async () => {
    const { setConfig } = await freshConfig()

    setConfig({ defaultCleanupMode: 'delete' })
    expect(setConfig({ defaultCleanupMode: null }).defaultCleanupMode).toBeNull()
  })

  it('no deja un archivo a medias', async () => {
    // Se escribe en un temporal y se renombra: nunca hay un JSON truncado.
    const { setConfig } = await freshConfig()
    setConfig({ workspacePath: 'D:\\dos' })

    expect(() => JSON.parse(readFileSync(configPath(), 'utf8'))).not.toThrow()
  })
})

describe('migración desde el nombre anterior', () => {
  // `userData` se deriva del nombre del producto. Al pasar de "Godot
  // AutoUpdate" a "Godot Hub", sin migracion el usuario se encontraria el
  // onboarding otra vez y perderia la carpeta y las versiones registradas.
  const legacyDir = join(app.getPath('appData'), 'Godot AutoUpdate')
  const legacyConfigPath = join(legacyDir, 'config.json')

  const seedLegacy = (config: Partial<Config>): void => {
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(legacyConfigPath, JSON.stringify(config), 'utf8')
  }

  afterEach(async () => {
    await rm(legacyDir, { recursive: true, force: true })
  })

  it('recupera la configuración de la instalación anterior', async () => {
    seedLegacy({ workspacePath: 'D:/Godot', workspaceConfirmed: true, flavor: 'mono' })

    const { getConfig } = await freshConfig()
    const config = getConfig()

    expect(config.workspacePath).toBe('D:/Godot')
    expect(config.workspaceConfirmed).toBe(true)
    expect(config.flavor).toBe('mono')
  })

  it('recupera también las versiones ya instaladas', async () => {
    seedLegacy({
      workspacePath: 'D:/Godot',
      workspaceConfirmed: true,
      installed: [
        {
          tag: '4.7.1-stable',
          folder: 'Godot_v4.7.1-stable_win64',
          exe: 'Godot_v4.7.1-stable_win64.exe',
          flavor: 'standard',
          installedAt: '2026-08-01T10:00:00Z'
        }
      ]
    })

    const { getConfig } = await freshConfig()
    expect(getConfig().installed.map((item) => item.tag)).toEqual(['4.7.1-stable'])
  })

  it('copia, no mueve: la instalación anterior sigue usable', async () => {
    seedLegacy({ workspacePath: 'D:/Godot' })

    const { getConfig } = await freshConfig()
    getConfig()

    const original = JSON.parse(readFileSync(legacyConfigPath, 'utf8')) as Config
    expect(original.workspacePath).toBe('D:/Godot')
  })

  it('no pisa una configuración ya existente', async () => {
    seedLegacy({ workspacePath: 'D:/Antigua' })

    const { getConfig } = await freshConfig(JSON.stringify({ workspacePath: 'D:/Actual' }))
    expect(getConfig().workspacePath).toBe('D:/Actual')
  })

  it('arranca de cero si no hay nada que migrar', async () => {
    const { getConfig } = await freshConfig()
    expect(getConfig().workspacePath).toBeNull()
  })
})
