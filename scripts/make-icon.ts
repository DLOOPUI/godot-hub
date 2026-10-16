/**
 * Genera build/icon.ico a partir de los iconos de David:
 * assets/ico.png (780x780), assets/ico1.png (300x300) y assets/ico2.png (150x150).
 *
 * Genera un ICO multi-resolucion con todos los tamaños estándar de Windows
 * (16, 20, 24, 32, 40, 48, 64, 128, 256 px). Para los tamaños pequeños (<=150px),
 * reescala desde ico2.png (150px) o ico1.png (300px) para conservar máxima
 * nitidez y contraste sin perder líneas finas al reducir desde 780px.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

interface IconFrame {
  size: number
  png: Buffer
}

/**
 * Empaqueta múltiples PNG como un ICO multi-resolución de Windows.
 */
function pngsToIco(frames: IconFrame[]): Buffer {
  const count = frames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // tipo: icono
  header.writeUInt16LE(count, 4) // numero de imagenes

  const entriesHeaderSize = 6 + 16 * count
  let currentOffset = entriesHeaderSize

  const entries: Buffer[] = []
  const pngs: Buffer[] = []

  for (const frame of frames) {
    const entry = Buffer.alloc(16)
    const w = frame.size >= 256 ? 0 : frame.size
    const h = frame.size >= 256 ? 0 : frame.size

    entry.writeUInt8(w, 0)
    entry.writeUInt8(h, 1)
    entry.writeUInt8(0, 2) // paleta
    entry.writeUInt8(0, 3) // reservado
    entry.writeUInt16LE(1, 4) // planos
    entry.writeUInt16LE(32, 6) // bits por pixel
    entry.writeUInt32LE(frame.png.length, 8)
    entry.writeUInt32LE(currentOffset, 12)

    entries.push(entry)
    pngs.push(frame.png)

    currentOffset += frame.png.length
  }

  return Buffer.concat([header, ...entries, ...pngs])
}

async function main(): Promise<void> {
  await app.whenReady()

  const assetsDir = join(process.cwd(), 'assets')
  const path780 = join(assetsDir, 'ico.png')
  const path300 = join(assetsDir, 'ico1.png')
  const path150 = join(assetsDir, 'ico2.png')

  const img780 = nativeImage.createFromPath(path780)
  const img300 = existsSync(path300) ? nativeImage.createFromPath(path300) : img780
  const img150 = existsSync(path150) ? nativeImage.createFromPath(path150) : img300

  if (img780.isEmpty()) {
    console.error(`no se pudo leer el maestro: ${path780}`)
    app.quit()
    return
  }

  const frames: IconFrame[] = []

  for (const size of SIZES) {
    let source = img780
    if (size <= 150 && !img150.isEmpty()) {
      source = img150
    } else if (size <= 300 && !img300.isEmpty()) {
      source = img300
    }

    const png = source.resize({ width: size, height: size, quality: 'best' }).toPNG()
    frames.push({ size, png })
  }

  const outDir = join(process.cwd(), 'build')
  await mkdir(outDir, { recursive: true })

  const frame256 = frames.find((f) => f.size === 256) ?? frames[frames.length - 1]
  await writeFile(join(outDir, 'icon.png'), frame256.png)

  const icoBuffer = pngsToIco(frames)
  await writeFile(join(outDir, 'icon.ico'), icoBuffer)

  console.log(`icono generado: ${SIZES.join(', ')} px, total ${icoBuffer.length} bytes`)
  app.quit()
}

void main()
