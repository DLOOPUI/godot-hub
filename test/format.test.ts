import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  formatBytes,
  formatCount,
  formatDate,
  formatEta,
  formatSpeed
} from '../src/renderer/format'

describe('formatBytes', () => {
  it('usa la unidad adecuada', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1,0 KB')
    expect(formatBytes(80 * 1024 * 1024)).toBe('80 MB')
  })

  it('usa coma decimal, como el resto de la interfaz', () => {
    expect(formatBytes(1536)).toBe('1,5 KB')
  })

  it('no rompe con valores absurdos', () => {
    expect(formatBytes(-5)).toBe('0 B')
  })
})

describe('formatCount', () => {
  it('concuerda singular y plural', () => {
    expect(formatCount(1, 'elemento', 'elementos')).toBe('1 elemento')
    expect(formatCount(7, 'elemento', 'elementos')).toBe('7 elementos')
    expect(formatCount(0, 'elemento', 'elementos')).toBe('0 elementos')
  })
})

describe('formatEta', () => {
  it('devuelve segundos por debajo del minuto', () => {
    expect(formatEta(45)).toBe('45 s')
  })

  it('devuelve minutos y segundos por encima', () => {
    expect(formatEta(125)).toBe('2 min 05 s')
  })

  it('no muestra nada cuando no se puede estimar', () => {
    expect(formatEta(null)).toBe('')
    expect(formatEta(0)).toBe('')
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('formatSpeed', () => {
  it('añade la unidad por segundo', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1,0 MB/s')
  })

  it('calla si aún no hay medida', () => {
    expect(formatSpeed(0)).toBe('')
  })
})

describe('formatDate', () => {
  it('no revienta con una fecha inválida', () => {
    expect(formatDate('')).toBe('fecha desconocida')
    expect(formatDate('no-es-una-fecha')).toBe('fecha desconocida')
  })
})

describe('escapeHtml', () => {
  it('neutraliza el marcado de los nombres de archivo', () => {
    // Los nombres vienen del disco y se insertan con innerHTML.
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    )
    expect(escapeHtml('a & b')).toBe('a &amp; b')
    expect(escapeHtml('dice "hola"')).toBe('dice &quot;hola&quot;')
  })

  it('escapa el ampersand antes que el resto', () => {
    // Si se hiciera al reves, "&lt;" acabaria como "&amp;lt;".
    expect(escapeHtml('<')).toBe('&lt;')
  })
})
