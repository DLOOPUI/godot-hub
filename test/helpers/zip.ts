/**
 * Escritor de ZIP minimo para las pruebas (metodo STORED, sin compresion).
 *
 * Existe porque no hay forma de fabricar con herramientas normales un zip con
 * entradas maliciosas (`../fuera.txt`, rutas absolutas): tanto Compress-Archive
 * como cualquier compresor lo impiden. Sin esto, la defensa zip-slip del
 * instalador no se puede probar, solo leer.
 */

import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** Nombre tal cual va al archivo: se escribe sin validar, a proposito. */
  name: string
  content?: string | Buffer
  /** Marca la entrada como directorio (el nombre debe acabar en "/"). */
  directory?: boolean
}

export interface ZipOptions {
  /**
   * DEFLATE en vez de STORED. Importa: los zips reales de Godot van comprimidos,
   * y solo con este metodo se ejercita el inflate, que es donde aparecen los
   * errores de tipo "invalid block type" cuando el archivo llega corrupto.
   */
  deflate?: boolean
}

export function makeZip(entries: ZipEntry[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = entry.directory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content ?? '', 'utf8')
    const crc = crc32(data)

    const compress = options.deflate === true && !entry.directory && data.length > 0
    const stored = compress ? deflateRawSync(data) : data
    const method = compress ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // firma
    local.writeUInt16LE(20, 4) // version necesaria
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8) // 0 = STORED, 8 = DEFLATE
    local.writeUInt16LE(0, 10) // hora
    local.writeUInt16LE(0, 12) // fecha
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18) // tamaño comprimido
    local.writeUInt32LE(data.length, 22) // tamaño real
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version que lo creo
    central.writeUInt16LE(20, 6) // version necesaria
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comentario
    central.writeUInt16LE(0, 34) // disco
    central.writeUInt16LE(0, 36) // atributos internos
    central.writeUInt32LE(entry.directory ? 0x10 : 0, 38) // atributos externos
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, stored)
    centrals.push(central, name)
    offset += local.length + name.length + stored.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // disco
  end.writeUInt16LE(0, 6) // disco del directorio central
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comentario

  return Buffer.concat([...locals, centralBuffer, end])
}
