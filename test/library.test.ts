import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setConfig } from '../src/main/config'
import { listLibrary } from '../src/main/library'
import type { InstalledVersion } from '../src/shared/types'

const base: InstalledVersion = {
  tag: '4.7.1-stable',
  folder: 'Godot_v4.7.1-stable_win64',
  exe: 'Godot_v4.7.1-stable_win64.exe',
  flavor: 'standard',
  installedAt: '2026-08-01T10:00:00Z'
}

describe('listLibrary', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'gau-lib-'))
    setConfig({ workspacePath: workspace, workspaceConfirmed: true, installed: [] })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  const install = async (entry: InstalledVersion, bytes = 2048): Promise<void> => {
    await mkdir(join(workspace, entry.folder), { recursive: true })
    await writeFile(join(workspace, entry.folder, entry.exe), Buffer.alloc(bytes))
  }

  it('está vacía sin nada instalado', async () => {
    expect(await listLibrary()).toEqual([])
  })

  it('está vacía si no hay carpeta de trabajo', async () => {
    setConfig({ workspacePath: null, installed: [base] })
    expect(await listLibrary()).toEqual([])
  })

  it('devuelve la versión instalada con sus rutas y tamaño', async () => {
    await install(base)
    setConfig({ installed: [base] })

    const [entry] = await listLibrary()

    expect(entry?.tag).toBe(base.tag)
    expect(entry?.exists).toBe(true)
    expect(entry?.exePath).toBe(join(workspace, base.folder, base.exe))
    expect(entry?.folderPath).toBe(join(workspace, base.folder))
    expect(entry?.sizeBytes).toBe(2048)
  })

  it('marca como ausente una versión cuya carpeta se borró a mano', async () => {
    // No se oculta: si desapareciera de la lista, el usuario no entenderia por
    // que su version ya no esta.
    setConfig({ installed: [base] })

    const [entry] = await listLibrary()

    expect(entry?.exists).toBe(false)
    expect(entry?.sizeBytes).toBe(0)
  })

  it('ordena de más reciente a más antigua', async () => {
    const older = { ...base, tag: '4.6-stable', folder: 'Godot_v4.6', installedAt: '2026-01-01T00:00:00Z' }
    const newer = { ...base, tag: '4.7.2-stable', folder: 'Godot_v4.7.2', installedAt: '2026-08-18T00:00:00Z' }
    await install(older)
    await install(newer)
    setConfig({ installed: [older, base, newer] })

    expect((await listLibrary()).map((item) => item.tag)).toEqual([
      '4.7.2-stable',
      '4.7.1-stable',
      '4.6-stable'
    ])
  })

  it('no mide ni da por buena una entrada que apunta fuera del área de trabajo', async () => {
    setConfig({ installed: [{ ...base, folder: '..\..\Windows', exe: 'notepad.exe' }] })

    const [entry] = await listLibrary()

    expect(entry?.exists).toBe(false)
    expect(entry?.sizeBytes).toBe(0)
  })
})
