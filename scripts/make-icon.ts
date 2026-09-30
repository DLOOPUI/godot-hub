/**
 * Genera build/icon.ico a partir del icono de David: assets/ico.png.
 *
 * El diseño ya no se dibuja aquí: David exporta el PNG maestro (780×780) y
 * este script solo lo reduce a 256 y lo empaqueta como ICO. Sigue sin meter
 * una dependencia de tratamiento de imágenes: el reescalado lo hace
 * `nativeImage.resize` de Electron, con calidad "best".
 *
 * Se fue de una versión que renderizaba la imagen en una ventana oculta y
 * capturaba la página: la página era un data: URL y Chromium le bloquea la
 * carga de subrecursos file:// (origen opaco), así que la captura salía un
 * lienzo casi vacío con el guiño de imagen rota en una esquina — el icono se
 * veía diminuto dentro de su hueco. Sin página no hay nada que bloquear.
 *
 * Se ejecuta a mano cuando cambia el diseño; el .ico resultante se versiona.
 * Los otros dos PNG de assets/ son el mismo icono a 300 y 150: quedan como
 * referencia, pero el ICO sale del maestro de 780.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'

const SIZE = 256

/**
 * Empaqueta un PNG como ICO. Windows Vista+ acepta un unico PNG de 256x256
 * dentro del contenedor, asi que basta la cabecera de 22 bytes.
 */
function pngToIco(png: Buffer): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // tipo: icono
  header.writeUInt16LE(1, 4) // numero de imagenes

  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0) // ancho 0 == 256
  entry.writeUInt8(0, 1) // alto 0 == 256
  entry.writeUInt8(0, 2) // paleta
  entry.writeUInt8(0, 3) // reservado
  entry.writeUInt16LE(1, 4) // planos
  entry.writeUInt16LE(32, 6) // bits por pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)

  return Buffer.concat([header, entry, png])
}

async function main(): Promise<void> {
  await app.whenReady()

  // cwd, no getAppPath(): el script se ejecuta con un paquete temporal como
  // punto de entrada y getAppPath() apuntaria ahi dentro.
  const origen = join(process.cwd(), 'assets', 'ico.png')

  const maestro = nativeImage.createFromPath(origen)
  if (maestro.isEmpty()) {
    console.error(`no se pudo leer el maestro: ${origen}`)
    app.quit()
    return
  }

  const png = maestro.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG()

  const outDir = join(process.cwd(), 'build')
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'icon.png'), png)
  await writeFile(join(outDir, 'icon.ico'), pngToIco(png))

  console.log(`icono generado: ${SIZE}x${SIZE}, ${png.length} bytes`)
  app.quit()
}

void main()
