/**
 * Comparacion de versiones de Godot, compartida por el proceso principal y la
 * interfaz.
 *
 * Ordena por numero, no por texto: "4.10" va por encima de "4.9", que es justo
 * donde falla un sort de cadenas. Tampoco sirve la fecha, porque un parche
 * retroportado (4.5.2) sale despues de una minor mas nueva (4.6).
 */

/** Quita el sufijo "-stable" y deja solo los numeros. */
export function versionOf(tag: string): string {
  return tag.replace(/-stable$/, '')
}

/** Negativo si `a` es mayor: sirve directamente para ordenar descendente. */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** ¿`candidate` es una version posterior a `current`? Acepta etiquetas o numeros. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersionsDesc(versionOf(candidate), versionOf(current)) < 0
}
