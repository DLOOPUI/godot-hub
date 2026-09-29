/**
 * Aplica el tema de GENZAI a la interfaz: escribe los papeles y el borde en las
 * variables CSS de `:root`.
 *
 * La persistencia no es localStorage como en DE_LAUNCHER: aquí vive en
 * `config.json` con el resto de las preferencias, así que hay una sola fuente
 * de verdad y el tema se guarda con el mismo `config:set` que todo lo demás.
 * Se aplica en el acto, sin confirmar ni reiniciar: elegir mal se deshace
 * eligiendo otra.
 *
 * Los valores por defecto de tokens.css son la paleta original, para que no
 * haya un parpadeo de otro color antes de que corra este módulo.
 */
import { mezclar, paletaPorId, tonosDe, anillo, grosorPorId, radio } from '../shared/tema'
import type { Config } from '../shared/types'

/** Escribe los papeles de la paleta en las variables CSS. */
export function aplicarPaleta(config: Config): void {
  const t = tonosDe(paletaPorId(config.paletasPropias, config.paleta))
  const raiz = document.documentElement.style
  raiz.setProperty('--fondo', t.fondo)
  raiz.setProperty('--panel', t.panel)
  raiz.setProperty('--humo', t.humo)
  raiz.setProperty('--humo-2', mezclar(t.humo, '#FFFFFF', 0.05))
  raiz.setProperty('--primario', t.primario)
  raiz.setProperty('--primario-neon', t.primarioNeon)
  raiz.setProperty('--primario-sombra', t.primarioSombra)
  raiz.setProperty('--secundario', t.secundario)
  raiz.setProperty('--secundario-neon', t.secundarioNeon)
  raiz.setProperty('--papel', t.papel)
  raiz.setProperty('--texto', t.texto)
  raiz.setProperty('--aviso', t.aviso)
}

/**
 * Escribe el anillo de sombras del borde en las variables CSS.
 *
 * La variable guarda la expresión con em sin resolver, así que cada texto la
 * resuelve con su propio tamaño; y las sombras de color se corren a partir
 * del radio (`--r-borde`), para que un borde grueso no las tape enteras.
 */
export function aplicarBorde(config: Config): void {
  const g = grosorPorId(config.borde)
  const raiz = document.documentElement.style
  raiz.setProperty('--anillo', anillo(g))
  raiz.setProperty('--r-borde', radio(g))
}

/** Paleta y borde juntos: lo que se llama al arrancar. */
export function aplicarTema(config: Config): void {
  aplicarPaleta(config)
  aplicarBorde(config)
}
