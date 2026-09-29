/**
 * Genera build/icon.ico a partir del icono de David: assets/ico.png.
 *
 * El diseño ya no se dibuja aquí: David exporta el PNG maestro (780×780) y
 * este script solo lo reduce a 256 y lo empaqueta como ICO. Sigue sin meter
 * una dependencia de tratamiento de imágenes solo para esto: el reescalado lo
 * hace Chromium al renderizar la imagen a 256 en una ventana oculta.
 *
 * Se ejecuta a mano cuando cambia el diseño; el .ico resultante se versiona.
 * Los otros dos PNG de assets/ son el mismo icono a 300 y 150: quedan como
 * referencia, pero el ICO sale del maestro de 780.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'

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

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
  img{width:${SIZE}px;height:${SIZE}px;display:block}
</style></head>
<body><img src="${pathToFileURL(origen).href}"></body></html>`

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 400)) // deja asentar el render

  const image = await win.webContents.capturePage()
  const png = image.toPNG()

  const outDir = join(process.cwd(), 'build')
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'icon.png'), png)
  await writeFile(join(outDir, 'icon.ico'), pngToIco(png))

  console.log(`icono generado: ${image.getSize().width}x${image.getSize().height}, ${png.length} bytes`)
  app.quit()
}

void main()
