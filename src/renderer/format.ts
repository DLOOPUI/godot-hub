/** Formato en es-ES: separador decimal coma, como el resto de la interfaz. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  const decimals = exponent === 0 ? 0 : value < 10 ? 1 : 0
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${UNITS[exponent]}`
}

export function formatCount(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('es-ES')} ${count === 1 ? singular : plural}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : ''
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.ceil(seconds)
  if (total < 60) return `${total} s`
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`
}

export function formatDate(iso: string): string {
  if (!iso) return 'fecha desconocida'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'fecha desconocida'
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'fecha desconocida'
  return date.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Escapa texto que vendra de disco (nombres de archivo) antes de meterlo en HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
