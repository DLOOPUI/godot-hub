/**
 * Genera build/icon.ico renderizando el icono con el propio Electron.
 *
 * Se ejecuta a mano cuando cambia el diseno; el .ico resultante se versiona.
 * Evita meter una dependencia de tratamiento de imagenes solo para esto.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

const SIZE = 256

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
  .icon{
    width:${SIZE}px;height:${SIZE}px;border-radius:56px;
    background:#2b3a4a;display:grid;place-items:center;
    box-shadow:14px 14px 30px #1c2631, -14px -14px 30px #3a4c60;
  }
  /* stroke-width va en unidades del viewBox (24), no en pixeles del render. */
  svg{width:170px;height:170px;fill:none;stroke-linecap:round;stroke-linejoin:round}
  .ring{stroke:#5aa8e0;stroke-width:1.5;opacity:.6}
  .play{fill:#5aa8e0;stroke:#5aa8e0;stroke-width:2.4}
</style></head>
<body><div class="icon">
  <svg viewBox="0 0 24 24">
    <!-- Anillo + triangulo: un boton de arranque. El anillo lo distingue de un
         control de reproduccion y llena el lienzo, que con el triangulo suelto
         quedaba flotando. El triangulo va desplazado 0.4 a la derecha: su masa
         visual cae a la izquierda del centro geometrico. -->
    <circle class="ring" cx="12" cy="12" r="9"/>
    <path class="play" d="M10.2 7.9 16.4 12l-6.2 4.1z"/>
  </svg>
</div></body></html>`

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

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)
  await new Promise((resolve) => setTimeout(resolve, 400)) // deja asentar el render

  const image = await win.webContents.capturePage()
  const png = image.toPNG()

  // cwd, no getAppPath(): el script se ejecuta con un paquete temporal como
  // punto de entrada y getAppPath() apuntaria ahi dentro.
  const outDir = join(process.cwd(), 'build')
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'icon.png'), png)
  await writeFile(join(outDir, 'icon.ico'), pngToIco(png))

  console.log(`icono generado: ${image.getSize().width}x${image.getSize().height}, ${png.length} bytes`)
  app.quit()
}

void main()
