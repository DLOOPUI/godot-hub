/**
 * Ajustes: la salida de las decisiones "no me vuelvas a preguntar", el único
 * sitio desde el que se puede cambiar la carpeta de trabajo — y, desde que
 * la interfaz es la de GENZAI, también donde se cambian la paleta y el grosor
 * del borde de los textos.
 *
 * Sin las salidas de las casillas, marcar una vez encierra al usuario en esa
 * elección para siempre. Y sin paleta y borde en Ajustes no hay estilo que
 * valga: en estos proyectos la paleta se cambia desde dentro, en el acto.
 */
import { bridge } from '../bridge'
import { iconFolder } from '../components/icons'
import { openModal } from '../components/modal'
import { escapeHtml } from '../format'
import { aplicarBorde, aplicarPaleta } from '../tema'
import { anillo, esHexValido, GROSORES, normalizarHex, radio, todas, tonosDe, PALETA_ORIGINAL } from '../../shared/tema'
import type { Grosor, Paleta } from '../../shared/tema'
import type { CleanupMode, Config } from '../../shared/types'

const CLEANUP_LABELS: Record<CleanupMode, string> = {
  delete: 'eliminar la versión actual',
  keep: 'conservarla en la carpeta'
}

export interface SettingsResult {
  config: Config
  /** true si el usuario pidio cambiar de carpeta: el llamador vuelve al onboarding. */
  changeWorkspace: boolean
}

/** Una carta de paleta, pintada con sus propios colores y no con los de la en uso. */
function cartaPaleta(p: Paleta, activa: boolean, conBorrar = true): string {
  const t = tonosDe(p)
  const estilo = `--p-fondo:${t.fondo};--p-primario:${t.primario};--p-secundario:${t.secundario}`
  return `
    <div class="paleta${activa ? ' activa' : ''}" role="button" tabindex="0" data-paleta="${escapeHtml(p.id)}" style="${estilo}">
      <span class="paleta-nombre">${escapeHtml(p.nombre)}</span>
      <div class="paleta-muestras">
        <span class="muestra" style="--m:${t.primario}" title="Primario ${t.primario}"></span>
        <span class="muestra" style="--m:${t.secundario}" title="Secundario ${t.secundario}"></span>
        <span class="muestra" style="--m:${t.fondo}" title="Fondo ${t.fondo}"></span>
      </div>
      <div class="paleta-pie">
        <span class="paleta-tag">${activa ? '使用中 · EN USO' : p.deFabrica ? '工場 · DE FÁBRICA' : '自作 · TUYA'}</span>
        ${p.deFabrica || !conBorrar ? '' : `<button class="btn btn--ghost btn--icon-only" type="button" data-borrar="${escapeHtml(p.id)}" aria-label="Borrar la paleta ${escapeHtml(p.nombre)}">×</button>`}
      </div>
    </div>`
}

/** Cada carta enseña el borde con su propio grosor, sin tener que elegirlo para verlo. */
function cartaGrosor(g: Grosor, enUso: string): string {
  const activa = g.id === enUso
  const estilo = `--anillo:${anillo(g)};--r-borde:${radio(g)}`
  return `
    <button class="grosor${activa ? ' activa' : ''}" type="button" data-grosor="${g.id}">
      <span class="muestra-borde" style="${estilo}">GODOT</span>
      <span class="muestra-borde muestra-borde-chica" style="${estilo}">${g.jp} · ${escapeHtml(g.nombre)}</span>
      <span class="paleta-tag">${activa ? '使用中 · EN USO' : '&nbsp;'}</span>
    </button>`
}

export async function openSettings(config: Config): Promise<SettingsResult> {
  let current = config
  let changeWorkspace = false

  const body = document.createElement('div')
  body.className = 'settings'
  body.innerHTML = `
    <div class="ajustes-bloque">
      <h3 class="ajustes-titulo">Paleta <span class="titulo-jp">パレット</span></h3>
      <p class="muted">Tres colores: primario profundo, secundario ácido y fondo oscuro. Se aplica en el acto, sin confirmar.</p>
      <div class="paletas" id="paletas"></div>

      <form class="nueva" id="form-paleta">
        <div class="celda">
          <input class="campo" id="nueva-nombre" placeholder="Nombre de tu paleta" autocomplete="off" />
          <div class="fila-color">
            <label for="campo-primario">Primario</label>
            <input class="campo" id="campo-primario" data-color="primario" value="#8B2FD6" autocomplete="off" />
            <span class="rueda" data-rueda="primario"><input type="color" aria-label="Elegir primario" /></span>
          </div>
          <div class="fila-color">
            <label for="campo-secundario">Secundario</label>
            <input class="campo" id="campo-secundario" data-color="secundario" value="#4AE04A" autocomplete="off" />
            <span class="rueda" data-rueda="secundario"><input type="color" aria-label="Elegir secundario" /></span>
          </div>
          <div class="fila-color">
            <label for="campo-fondo">Fondo</label>
            <input class="campo" id="campo-fondo" data-color="fondo" value="#0A0A0F" autocomplete="off" />
            <span class="rueda" data-rueda="fondo"><input type="color" aria-label="Elegir fondo" /></span>
          </div>
          <button class="btn btn--block" id="btn-guardar-paleta" type="submit" disabled>Guardar y usar</button>
          <p class="nota">El campo de texto y la rueda escriben el mismo dato. No se guarda un color a medio escribir.</p>
        </div>
        <div class="vista-previa" id="vista-previa"></div>
      </form>
    </div>

    <div class="ajustes-bloque">
      <h3 class="ajustes-titulo">Borde del texto <span class="titulo-jp">縁</span></h3>
      <p class="muted">El grosor del contorno negro de los textos con sombra. Negro puro siempre: es la tinta del cómic.</p>
      <div class="grosores" id="grosores"></div>
    </div>

    <div class="ajustes-bloque">
      <h3 class="ajustes-titulo">Preferencias <span class="titulo-jp">設定</span></h3>

      <label class="toggle settings__row">
        <input type="checkbox" id="ask-install" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
        <span class="settings__text">
          <span class="toggle__label">Preguntar antes de instalar</span>
          <span class="muted">Vuelve a mostrar la confirmación del paso previo a la descarga.</span>
        </span>
      </label>

      <div class="settings__row settings__row--block">
        <span class="settings__text">
          <span class="toggle__label">Qué hacer con la versión actual</span>
          <span class="muted" id="cleanup-state"></span>
        </span>
        <button class="btn" id="forget-cleanup">Volver a preguntar</button>
      </div>

      <label class="toggle settings__row">
        <input type="checkbox" id="hide-running" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
        <span class="settings__text">
          <span class="toggle__label">Esconder el gestor mientras Godot está abierto</span>
          <span class="muted">Vuelve a aparecer solo al cerrar Godot. Mientras tanto queda un icono en la bandeja del sistema.</span>
        </span>
      </label>

      <div class="settings__row settings__row--block">
        <span class="settings__text">
          <span class="toggle__label">Carpeta de trabajo</span>
          <span class="muted settings__path" id="workspace-path"></span>
        </span>
        <button class="btn" id="change-workspace">${iconFolder()}<span>Cambiar</span></button>
      </div>

      <div class="settings__row settings__row--block">
        <span class="settings__text">
          <span class="toggle__label">Registro de actividad</span>
          <span class="muted">Descargas, borrados y errores quedan anotados aquí.</span>
        </span>
        <button class="btn btn--ghost" id="open-logs">Abrir registros</button>
      </div>
    </div>
  `

  const askInstall = body.querySelector<HTMLInputElement>('#ask-install')!
  const hideRunning = body.querySelector<HTMLInputElement>('#hide-running')!
  const cleanupState = body.querySelector<HTMLElement>('#cleanup-state')!
  const forgetButton = body.querySelector<HTMLButtonElement>('#forget-cleanup')!
  const workspacePath = body.querySelector<HTMLElement>('#workspace-path')!

  const sync = (): void => {
    askInstall.checked = !current.skipInstallConfirm
    hideRunning.checked = current.hideWhileRunning
    cleanupState.textContent = current.defaultCleanupMode
      ? `Recordado: ${CLEANUP_LABELS[current.defaultCleanupMode]}.`
      : 'Se pregunta en cada instalación.'
    forgetButton.disabled = current.defaultCleanupMode === null
    workspacePath.textContent = current.workspacePath ?? 'sin configurar'
  }
  sync()

  askInstall.addEventListener('change', () => {
    void bridge.setConfig({ skipInstallConfirm: !askInstall.checked }).then((next) => {
      current = next
      sync()
    })
  })

  hideRunning.addEventListener('change', () => {
    void bridge.setConfig({ hideWhileRunning: hideRunning.checked }).then((next) => {
      current = next
      sync()
    })
  })

  forgetButton.addEventListener('click', () => {
    void bridge.setConfig({ defaultCleanupMode: null }).then((next) => {
      current = next
      sync()
    })
  })

  body.querySelector<HTMLButtonElement>('#open-logs')?.addEventListener('click', () => {
    void bridge.openLogs()
  })

  body.querySelector<HTMLButtonElement>('#change-workspace')?.addEventListener('click', () => {
    changeWorkspace = true
    // Cierra Ajustes: la seleccion y el aviso de borrado son el onboarding, y
    // anidar ese flujo dentro de este modal no aporta nada.
    body.closest('.modal')?.querySelector<HTMLButtonElement>('.modal__actions .btn')?.click()
  })

  // ─── Paletas ───────────────────────────────────────────────────────────
  // La persistencia no es localStorage como en DE_LAUNCHER: aquí va en
  // config.json con el resto de preferencias, con el mismo config:set.

  const rejillaPaletas = body.querySelector<HTMLElement>('#paletas')!

  const pintarPaletas = (): void => {
    rejillaPaletas.innerHTML = todas(current.paletasPropias)
      .map((p) => cartaPaleta(p, p.id === current.paleta))
      .join('')
  }

  const elegirPaleta = (id: string): void => {
    void bridge.setConfig({ paleta: id }).then((next) => {
      current = next
      aplicarPaleta(current)
      pintarPaletas()
    })
  }

  rejillaPaletas.addEventListener('click', (e) => {
    const objetivo = e.target as HTMLElement
    const borrar = objetivo.closest<HTMLButtonElement>('[data-borrar]')
    if (borrar) {
      const id = borrar.dataset['borrar']!
      // Si se borra la que está en uso, se vuelve al suelo: la original.
      const parche: Partial<Config> = { paletasPropias: current.paletasPropias.filter((p) => p.id !== id) }
      if (current.paleta === id) parche.paleta = PALETA_ORIGINAL
      void bridge.setConfig(parche).then((next) => {
        current = next
        aplicarPaleta(current)
        pintarPaletas()
      })
      return
    }
    const carta = objetivo.closest<HTMLElement>('[data-paleta]')
    if (carta) elegirPaleta(carta.dataset['paleta']!)
  })

  rejillaPaletas.addEventListener('keydown', (e) => {
    const carta = (e.target as HTMLElement).closest<HTMLElement>('[data-paleta]')
    if (carta && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      carta.click()
    }
  })

  // ─── Nueva paleta ──────────────────────────────────────────────────────
  // El campo de texto y la rueda escriben en el mismo dato: el texto es la
  // verdad y la rueda solo lo rellena, así que no se desincronizan (GENZAI).

  const form = body.querySelector<HTMLFormElement>('#form-paleta')!
  const nombre = body.querySelector<HTMLInputElement>('#nueva-nombre')!
  const guardar = body.querySelector<HTMLButtonElement>('#btn-guardar-paleta')!
  const campos = [...form.querySelectorAll<HTMLInputElement>('[data-color]')]
  const rueda = (clave: string) => form.querySelector<HTMLInputElement>(`[data-rueda="${clave}"] input`)!
  const valor = (clave: string) => campos.find((c) => c.dataset.color === clave)!.value

  const refrescar = () => {
    let validos = true
    for (const campo of campos) {
      const ok = esHexValido(campo.value)
      campo.classList.toggle('invalido', !ok)
      validos &&= ok
      if (ok) {
        const hex = normalizarHex(campo.value)
        rueda(campo.dataset.color!).value = hex.toLowerCase()
        ;(rueda(campo.dataset.color!).closest('.rueda') as HTMLElement).style.setProperty('--m', hex)
      }
    }
    // No deja guardar un color a medio escribir ni una paleta sin nombre.
    guardar.disabled = !validos || nombre.value.trim() === ''
    body.querySelector<HTMLElement>('#vista-previa')!.innerHTML = validos
      ? cartaPaleta(
          {
            id: 'previa',
            nombre: nombre.value.trim() || 'Mi paleta',
            primario: valor('primario'),
            secundario: valor('secundario'),
            fondo: valor('fondo')
          },
          false,
          false
        )
      : '<p class="nota">Escribe los tres colores enteros: #RRGGBB</p>'
  }

  for (const campo of campos) campo.addEventListener('input', refrescar)
  nombre.addEventListener('input', refrescar)
  form.querySelectorAll<HTMLInputElement>('[data-rueda] input').forEach((r) =>
    r.addEventListener('input', () => {
      const clave = (r.closest('[data-rueda]') as HTMLElement).dataset['rueda']!
      campos.find((c) => c.dataset.color === clave)!.value = r.value.toUpperCase()
      refrescar()
    })
  )

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (guardar.disabled) return
    const nueva = {
      id: `propia_${Date.now()}`,
      nombre: nombre.value.trim(),
      primario: normalizarHex(valor('primario')),
      secundario: normalizarHex(valor('secundario')),
      fondo: normalizarHex(valor('fondo'))
    }
    nombre.value = ''
    void bridge
      .setConfig({ paletasPropias: [...current.paletasPropias, nueva], paleta: nueva.id })
      .then((next) => {
        current = next
        aplicarPaleta(current)
        pintarPaletas()
        refrescar()
      })
  })

  // ─── Grosor del borde ──────────────────────────────────────────────────

  const rejillaGrosores = body.querySelector<HTMLElement>('#grosores')!

  const pintarGrosores = (): void => {
    rejillaGrosores.innerHTML = GROSORES.map((g) => cartaGrosor(g, current.borde)).join('')
  }

  rejillaGrosores.addEventListener('click', (e) => {
    const boton = (e.target as HTMLElement).closest<HTMLElement>('[data-grosor]')
    if (!boton) return
    void bridge.setConfig({ borde: boton.dataset['grosor']! }).then((next) => {
      current = next
      aplicarBorde(current)
      pintarGrosores()
    })
  })

  pintarPaletas()
  pintarGrosores()
  refrescar()

  await openModal({
    title: 'Ajustes',
    body,
    ancha: true,
    actions: [{ label: 'Cerrar', value: 'close', variant: 'accent' }]
  })

  return { config: current, changeWorkspace }
}

/** Aviso previo al cambio de carpeta: la actual deja de gestionarse. */
export async function confirmWorkspaceChange(currentPath: string): Promise<boolean> {
  const result = await openModal({
    title: 'Cambiar la carpeta de trabajo',
    body: `
      <p>Se elegirá una carpeta nueva y habrá que vaciarla, igual que la primera vez.</p>
      <p class="path-chip"><code>${escapeHtml(currentPath)}</code></p>
      <p class="modal__note">
        Esta carpeta y lo que contenga se quedan como están: la app deja de gestionarla,
        no la borra.
      </p>
    `,
    actions: [
      { label: 'Cancelar', value: null, variant: 'ghost' },
      { label: 'Elegir otra carpeta', value: 'change', variant: 'accent', icon: iconFolder() }
    ]
  })
  return result.value === 'change'
}
