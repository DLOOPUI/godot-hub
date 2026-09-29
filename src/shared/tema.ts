/**
 * El tema de GENZAI, compartido por main y renderer.
 *
 * Es puro, sin DOM ni Electron: main lo usa para el `backgroundColor` de la
 * ventana y el renderer para pintar las variables CSS. El modelo es
 * `ui/theme/Paletas.kt` de GENZAI (copiado tal cual en DE_LAUNCHER), y el borde
 * de los textos es el anillo de sombras de `bordes.ts` del launcher.
 *
 * Una paleta son **tres colores y nada más**: un primario profundo (el papel
 * del morado), un secundario ácido que grita (el papel del verde) y un fondo
 * oscuro (el papel del negro). El blanco no cuenta: el texto siempre va blanco
 * sobre lo oscuro. De esos tres salen los tonos que usa la interfaz.
 */

export interface Paleta {
  id: string
  nombre: string
  primario: string
  secundario: string
  fondo: string
  /** Las de fábrica no se pueden borrar: son el suelo al que que volver. */
  deFabrica?: boolean
}

/** Una paleta propia tal como vive en config.json. */
export type PaletaGuardada = Omit<Paleta, 'deFabrica'>

export interface Tonos {
  fondo: string
  panel: string
  humo: string
  primario: string
  primarioNeon: string
  primarioSombra: string
  secundario: string
  secundarioNeon: string
  papel: string
  texto: string
  aviso: string
}

export const PALETA_ORIGINAL = 'original'

export const PALETAS_DE_FABRICA: Paleta[] = [
  { id: PALETA_ORIGINAL, nombre: 'Morado y verde', primario: '#8B2FD6', secundario: '#4AE04A', fondo: '#0A0A0F', deFabrica: true },
  { id: 'cian_fucsia', nombre: 'Cian y fucsia', primario: '#D31FA8', secundario: '#26DDE0', fondo: '#06060A', deFabrica: true },
  { id: 'amarillo_violeta', nombre: 'Amarillo y violeta', primario: '#6B2FD6', secundario: '#E8E32A', fondo: '#121215', deFabrica: true },
  { id: 'naranja_cobalto', nombre: 'Naranja y cobalto', primario: '#1F52D6', secundario: '#FF7A1F', fondo: '#070B18', deFabrica: true }
]

/** Los tonos de fábrica, copiados de `AFINADAS` de GENZAI. El borde no está: siempre es negro. */
const AFINADAS: Record<string, Tonos> = {
  [PALETA_ORIGINAL]: {
    fondo: '#0A0A0F', panel: '#14141C', humo: '#22222E',
    primario: '#8B2FD6', primarioNeon: '#B55CFF', primarioSombra: '#3D1263',
    secundario: '#4AE04A', secundarioNeon: '#9DFF3C',
    papel: '#F2F0E8', texto: '#7A7A8C', aviso: '#FF5C7A'
  },
  cian_fucsia: {
    fondo: '#06060A', panel: '#121018', humo: '#211E2C',
    primario: '#D31FA8', primarioNeon: '#FF5FD2', primarioSombra: '#4E0B3C',
    secundario: '#26DDE0', secundarioNeon: '#7CFFFF',
    papel: '#F0EEF4', texto: '#7C7A90', aviso: '#FF4D4D'
  },
  amarillo_violeta: {
    fondo: '#121215', panel: '#1D1D22', humo: '#2C2C34',
    primario: '#6B2FD6', primarioNeon: '#9B6BFF', primarioSombra: '#2C1160',
    secundario: '#E8E32A', secundarioNeon: '#FBFF52',
    papel: '#F4F2EA', texto: '#8B8B98', aviso: '#FF5C5C'
  },
  // En GENZAI el primario afinado sube a #2F63EE: el cobalto sobre azul noche contrastaba poco.
  naranja_cobalto: {
    fondo: '#070B18', panel: '#111A2E', humo: '#1F2B47',
    primario: '#2F63EE', primarioNeon: '#6E9BFF', primarioSombra: '#0D2261',
    secundario: '#FF7A1F', secundarioNeon: '#FFA24D',
    papel: '#EFF2F8', texto: '#7B87A3', aviso: '#FF4D6E'
  }
}

// ─── Hexadecimal ─────────────────────────────────────────────────────────────

/** La almohadilla es opcional: un color copiado de cualquier sitio viene con o sin ella. */
export function normalizarHex(hex: string): string {
  const limpio = hex.trim().toUpperCase()
  return limpio.startsWith('#') ? limpio : `#${limpio}`
}

export const esHexValido = (hex: string) => /^#[0-9A-F]{6}$/.test(normalizarHex(hex))

type Rgb = [number, number, number]

const aRgb = (hex: string): Rgb => {
  const n = parseInt(normalizarHex(hex).slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const aHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** Interpolación lineal: t = 0 deja `desde`, t = 1 deja `hasta`. */
export const mezclar = (desde: string, hasta: string, t: number) => {
  const a = aRgb(desde)
  const b = aRgb(hasta)
  return aHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb)
}

/** Luminancia relativa, la misma medida que `Color.luminance()` de Compose. */
function luminancia(hex: string): number {
  const [r, g, b] = aRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ─── Derivación, para las propias ────────────────────────────────────────────

/** Los mismos porcentajes que `derivar()` de GENZAI. */
function derivar(p: Paleta): Tonos {
  // Siempre oscura: un fondo claro se oscurece solo en vez de romper la app.
  const base = luminancia(p.fondo) > 0.22 ? mezclar(p.fondo, '#000000', 0.72) : normalizarHex(p.fondo)
  const papel = '#F2F0E8'
  return {
    fondo: base,
    panel: mezclar(base, '#FFFFFF', 0.045),
    humo: mezclar(base, '#FFFFFF', 0.11),
    primario: normalizarHex(p.primario),
    primarioNeon: mezclar(p.primario, '#FFFFFF', 0.34),
    primarioSombra: mezclar(p.primario, '#000000', 0.62),
    secundario: normalizarHex(p.secundario),
    secundarioNeon: mezclar(p.secundario, '#FFFFFF', 0.3),
    papel,
    texto: mezclar(papel, base, 0.55),
    aviso: '#FF5C5C'
  }
}

export const tonosDe = (p: Paleta): Tonos => (p.deFabrica && AFINADAS[p.id]) || derivar(p)

/** La lista entera: fábrica primero y las propias detrás. */
export const todas = (propias: PaletaGuardada[]): Paleta[] => [
  ...PALETAS_DE_FABRICA,
  ...propias.map((p) => ({ ...p }))
]

/**
 * La paleta pedida, o la original si ya no existe (se borró una propia en uso).
 * Caer al suelo en vez de quejarse: la interfaz nunca se queda sin colores.
 */
export function paletaPorId(propias: PaletaGuardada[], id: string): Paleta {
  return todas(propias).find((p) => p.id === id) ?? PALETAS_DE_FABRICA[0]
}

// ─── El borde negro de los textos ─────────────────────────────────────────────

export interface Grosor {
  id: string
  nombre: string
  jp: string
  /** Radio del anillo en CSS, o null para quitar el borde. */
  radio: string | null
}

export const GROSORES: Grosor[] = [
  { id: 'sin', nombre: 'Sin borde', jp: '無し', radio: null },
  { id: 'fino', nombre: 'Fino', jp: '細い', radio: 'max(1px, .06em)' },
  // El de antes de poder elegir: David lo pidió "un poco más grande" que el fino.
  { id: 'normal', nombre: 'Normal', jp: '普通', radio: 'max(1.5px, .085em)' },
  { id: 'grueso', nombre: 'Grueso', jp: '太い', radio: 'max(2px, .115em)' },
  { id: 'muy-grueso', nombre: 'Muy grueso', jp: '極太', radio: 'max(2.5px, .15em)' }
]

export const BORDE_POR_DEFECTO = 'normal'

export const grosorPorId = (id: string): Grosor =>
  GROSORES.find((g) => g.id === id) ?? GROSORES.find((g) => g.id === BORDE_POR_DEFECTO)!

/**
 * Sombras del anillo. 24 y no menos: entre dos sombras vecinas queda un hueco de
 * 2·r·sen(180°/n); con "Muy grueso" en un título grande (r ≈ 9,6 px) son 2,5 px con
 * 24 sombras y 3,7 px con 16, suficiente para que asome una muesca en los trazos finos.
 *
 * No es `-webkit-text-stroke`: el trazo une a inglete y en las esquinas agudas
 * salen picos, y al seleccionar texto Chromium lo repinta en blanco encima. El
 * anillo es la letra desplazada en círculo, así que el contorno sale redondeado
 * solo y la selección no se rompe. Probado y descartado en DE_LAUNCHER.
 */
export function anillo(g: Grosor): string {
  if (!g.radio) return '0 0 0 transparent'
  return Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI
    const x = +Math.cos(a).toFixed(3)
    const y = +Math.sin(a).toFixed(3)
    return `calc(${g.radio} * ${x}) calc(${g.radio} * ${y}) 0 var(--borde)`
  }).join(', ')
}

/** Radio en CSS: con "Sin borde", 0 px, y las sombras de color vuelven a su distancia base. */
export const radio = (g: Grosor) => g.radio ?? '0px'
