import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearWorkspace, inspectWorkspace } from '../src/main/workspace'

describe('inspectWorkspace', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gau-insp-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('acepta una carpeta vacía y escribible', async () => {
    const result = await inspectWorkspace(dir)
    expect(result.rejection).toBeNull()
    expect(result.entryCount).toBe(0)
    expect(result.totalBytes).toBe(0)
  })

  it('cuenta entradas y tamaño, incluidas las de subcarpetas', async () => {
    await writeFile(join(dir, 'a.txt'), 'hola') // 4 bytes
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.bin'), Buffer.alloc(100))

    const result = await inspectWorkspace(dir)
    expect(result.entryCount).toBe(2) // solo el primer nivel
    expect(result.totalBytes).toBe(104) // el tamaño sí es recursivo
    expect(result.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'sub'])
    expect(result.entries.find((e) => e.name === 'sub')?.isDirectory).toBe(true)
  })

  it('incluye los archivos ocultos en el recuento', async () => {
    // Se borrarian igual que los demas: ocultarlos en el aviso seria mentir.
    await writeFile(join(dir, '.oculto'), 'x')
    const result = await inspectWorkspace(dir)
    expect(result.entryCount).toBe(1)
  })

  it('rechaza una carpeta que no existe', async () => {
    const result = await inspectWorkspace(join(dir, 'no-existe'))
    expect(result.rejection).toBe('not-found')
    expect(result.rejectionMessage).toBeTruthy()
  })

  it('rechaza una ruta que es un archivo', async () => {
    const file = join(dir, 'archivo.txt')
    await writeFile(file, 'x')
    const result = await inspectWorkspace(file)
    expect(result.rejection).toBe('not-a-directory')
  })

  it('rechaza la raíz de una unidad', async () => {
    const result = await inspectWorkspace(parse(process.cwd()).root)
    expect(result.rejection).toBe('drive-root')
  })

  describe('carpetas protegidas', () => {
    const cases: [string, string][] = [
      ['el perfil de usuario', join(tmpdir(), 'gau-home')],
      ['el escritorio', join(tmpdir(), 'gau-home', 'Desktop')],
      ['descargas', join(tmpdir(), 'gau-home', 'Downloads')],
      ['documentos', join(tmpdir(), 'gau-home', 'Documents')]
    ]

    for (const [label, path] of cases) {
      it(`rechaza ${label}`, async () => {
        await mkdir(path, { recursive: true })
        const result = await inspectWorkspace(path)
        expect(result.rejection).toBe('protected')
      })
    }

    it('rechaza una carpeta que CONTIENE una protegida', async () => {
      // Elegir C:\Users pasaria el filtro si solo se mirase la ruta exacta,
      // y vaciarla se llevaria el perfil entero por delante.
      await mkdir(join(tmpdir(), 'gau-home'), { recursive: true })
      const result = await inspectWorkspace(tmpdir())
      expect(result.rejection).toBe('protected')
    })
  })
})

describe('clearWorkspace', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gau-clear-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('vacía el contenido pero conserva la carpeta', async () => {
    await writeFile(join(dir, 'a.txt'), 'x')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.txt'), 'y')

    const result = await clearWorkspace(dir)

    expect(result.deleted).toBe(2)
    expect(result.failed).toEqual([])
    expect(existsSync(dir)).toBe(true)
    expect((await inspectWorkspace(dir)).entryCount).toBe(0)
  })

  it('se niega a vaciar una carpeta protegida aunque se lo pidan', async () => {
    // Segunda comprobacion en el proceso principal: el renderer no es la
    // ultima palabra antes de un borrado.
    const home = join(tmpdir(), 'gau-home')
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'importante.txt'), 'no me borres')

    await expect(clearWorkspace(home)).rejects.toThrow(/protegida/)
    expect(existsSync(join(home, 'importante.txt'))).toBe(true)
  })
})
