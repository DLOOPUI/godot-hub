const FRANJAS = 14
const RAYOS = ['var(--secundario)', 'var(--primario)', 'var(--papel)']
const CURVA = 'cubic-bezier(.75,0,.25,1)'

/**
 * La cortina: franjas negras sólidas que suben tapando la pantalla de una
 * esquina a la contraria, sin fade, con rayos de color cruzando por encima; en
 * medio se cambia el contenido y luego se retiran por el mismo camino.
 *
 * Es la transición que le gusta a David (Perfil - Como trabajo), la misma que
 * `Transicion.kt` de GENZAI y la de DE_LAUNCHER. La diagonal sale de girar la
 * capa entera, no de calcular cada franja inclinada. Sólidas, no translúcidas.
 */
export async function cortina(enMedio: () => Promise<void> | void): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await enMedio()
    return
  }

  const capa = document.createElement('div')
  capa.className = 'cortina'
  const franjas: HTMLElement[] = []
  for (let i = 0; i < FRANJAS; i++) {
    const franja = document.createElement('div')
    franja.className = 'cortina-franja'
    franja.style.left = `${(i / FRANJAS) * 100}%`
    // Un pelo más ancha que su hueco para que no asome una línea entre dos franjas.
    franja.style.width = `calc(${100 / FRANJAS}% + 2px)`
    franja.style.transform = 'translateY(105%)'
    capa.append(franja)
    franjas.push(franja)
  }
  const rayos = RAYOS.map((color, i) => {
    const rayo = document.createElement('div')
    rayo.className = 'cortina-rayo'
    rayo.style.background = color
    rayo.style.top = `${38 + i * 9}%`
    rayo.style.transform = 'translateX(-110%)'
    capa.append(rayo)
    return rayo
  })
  document.body.append(capa)

  const mover = (el: HTMLElement, de: string, a: string, retraso: number, duracion = 300) =>
    el.animate([{ transform: de }, { transform: a }], {
      duration: duracion,
      delay: retraso,
      easing: CURVA,
      fill: 'forwards'
    }).finished

  try {
    const cruce = rayos.map((r, i) =>
      mover(r, 'translateX(-110%)', 'translateX(110%)', 120 + i * 90, 520)
    )
    await Promise.all(
      franjas.map((f, i) => mover(f, 'translateY(105%)', 'translateY(0)', i * 26))
    )
    await enMedio()
    await Promise.all(cruce)
    await Promise.all(
      franjas.map((f, i) => mover(f, 'translateY(0)', 'translateY(105%)', i * 26))
    )
  } finally {
    capa.remove()
  }
}
