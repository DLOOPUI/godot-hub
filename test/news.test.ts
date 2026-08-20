import { describe, expect, it } from 'vitest'
import { parseFeed } from '../src/main/news'

const item = (fields: Record<string, string>): string =>
  `<item>${Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join('')}</item>`

const feed = (...items: string[]): string =>
  `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>${items.join('')}</channel></rss>`

describe('parseFeed', () => {
  it('lee una entrada real del feed de Godot', () => {
    const xml = feed(
      item({
        title: 'Maintenance release: Godot 4.7.2',
        link: 'https://godotengine.org/article/maintenance-release-godot-4-7-2/',
        summary: 'The second 4.7 maintenance release has arrived!',
        category: 'Release',
        pubDate: 'Tue, 18 Aug 2026 12:00:00 +0000'
      })
    )

    const [entry] = parseFeed(xml)

    expect(entry?.title).toBe('Maintenance release: Godot 4.7.2')
    expect(entry?.link).toBe('https://godotengine.org/article/maintenance-release-godot-4-7-2/')
    expect(entry?.summary).toBe('The second 4.7 maintenance release has arrived!')
    expect(entry?.category).toBe('Release')
    expect(entry?.publishedAt).toBe('2026-08-18T12:00:00.000Z')
  })

  it('ordena de más reciente a más antigua', () => {
    const xml = feed(
      item({ title: 'Vieja', link: 'https://a.example/1', pubDate: 'Mon, 01 Jan 2024 00:00:00 +0000' }),
      item({ title: 'Nueva', link: 'https://a.example/2', pubDate: 'Wed, 01 Jan 2025 00:00:00 +0000' })
    )
    expect(parseFeed(xml).map((n) => n.title)).toEqual(['Nueva', 'Vieja'])
  })

  it('descarta entradas sin título', () => {
    const xml = feed(item({ link: 'https://a.example/1', pubDate: 'Mon, 01 Jan 2024 00:00:00 +0000' }))
    expect(parseFeed(xml)).toEqual([])
  })

  describe('enlaces', () => {
    // El enlace acaba en shell.openExternal: dejar pasar otros esquemas seria
    // convertir el feed en un vector para abrir cosas del sistema.
    const rechazados = [
      ['sin protocolo', 'godotengine.org/article/x'],
      ['http sin cifrar', 'http://godotengine.org/x'],
      ['javascript', 'javascript:alert(1)'],
      ['fichero local', 'file:///C:/Windows/System32/calc.exe']
    ] as const

    for (const [label, link] of rechazados) {
      it(`descarta un enlace ${label}`, () => {
        expect(parseFeed(feed(item({ title: 'X', link })))).toEqual([])
      })
    }

    it('acepta https', () => {
      expect(parseFeed(feed(item({ title: 'X', link: 'https://godotengine.org/x' })))).toHaveLength(1)
    })
  })

  it('no usa el HTML de description, solo el summary en texto plano', () => {
    // Meter ese HTML en la interfaz seria dejar que el feed inyecte marcado.
    const xml = feed(
      item({
        title: 'Con HTML',
        link: 'https://a.example/1',
        summary: 'Resumen limpio',
        description: '&lt;p&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/p&gt;'
      })
    )

    const [entry] = parseFeed(xml)
    expect(entry?.summary).toBe('Resumen limpio')
    expect(JSON.stringify(entry)).not.toContain('onerror')
  })

  it('decodifica entidades y CDATA', () => {
    const xml = feed(
      item({
        title: 'Godot &amp; amigos &#8212; parte 2',
        link: 'https://a.example/1',
        summary: '<![CDATA[Resumen con <etiquetas> dentro]]>'
      })
    )

    const [entry] = parseFeed(xml)
    expect(entry?.title).toBe('Godot & amigos — parte 2')
    expect(entry?.summary).toBe('Resumen con <etiquetas> dentro')
  })

  it('aguanta una entrada sin fecha ni resumen', () => {
    const [entry] = parseFeed(feed(item({ title: 'Suelta', link: 'https://a.example/1' })))
    expect(entry?.publishedAt).toBe('')
    expect(entry?.summary).toBe('')
  })

  it('devuelve vacío con XML inservible', () => {
    expect(parseFeed('no es xml')).toEqual([])
    expect(parseFeed('')).toEqual([])
  })

  it('se queda con 12 como máximo', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      item({ title: `N${i}`, link: `https://a.example/${i}`, pubDate: 'Mon, 01 Jan 2024 00:00:00 +0000' })
    )
    expect(parseFeed(feed(...many))).toHaveLength(12)
  })
})
