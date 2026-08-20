/** Iconos SVG inline (trazo, 24x24). El color se hereda via `stroke`. */

const wrap = (paths: string, cls: string): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

/** Flecha a bandeja: el glifo ordinario de descarga. */
export const iconDownload = (cls = 'btn__icon'): string =>
  wrap('<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>', cls)

export const iconFolder = (cls = 'btn__icon'): string =>
  wrap('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', cls)

export const iconTrash = (cls = 'btn__icon'): string =>
  wrap(
    '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4h6v3"/>',
    cls
  )

export const iconAlert = (cls = 'btn__icon'): string =>
  wrap('<path d="M12 9v5"/><path d="M12 17.5h.01"/><circle cx="12" cy="12" r="9"/>', cls)

export const iconRefresh = (cls = 'btn__icon'): string =>
  wrap(
    '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
    cls
  )

export const iconCheck = (cls = 'btn__icon'): string => wrap('<path d="m5 12.5 4.5 4.5L19 7"/>', cls)

/** Triangulo de reproduccion: iniciar la version instalada. */
export const iconPlay = (cls = 'btn__icon'): string =>
  wrap('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke-width="1.5"/>', cls)

/** Flecha saliendo de un marco: abre fuera de la app. */
export const iconExternal = (cls = 'btn__icon'): string =>
  wrap(
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    cls
  )

export const iconSettings = (cls = 'btn__icon'): string =>
  wrap(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    cls
  )

export const iconKeep = (cls = 'btn__icon'): string =>
  wrap('<path d="M5 12.5 10 17l9-9"/><path d="M3 19h18"/>', cls)

export const iconMinimize = (): string => wrap('<path d="M5 12h14"/>', 'winbtn__icon')

export const iconMaximize = (): string =>
  wrap('<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>', 'winbtn__icon')

export const iconRestore = (): string =>
  wrap(
    '<rect x="4.5" y="7.5" width="11" height="11" rx="2"/><path d="M8.5 5.5h9a2 2 0 0 1 2 2v9"/>',
    'winbtn__icon'
  )

export const iconClose = (): string => wrap('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', 'winbtn__icon')
