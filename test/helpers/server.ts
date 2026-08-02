import { createServer } from 'node:http'
import type { Server } from 'node:http'

export interface TestServer {
  url: string
  close: () => Promise<void>
  /** Numero de peticiones servidas por ruta, para comprobar cacheo. */
  hits: Map<string, number>
}

export interface RouteResponse {
  body: string | Buffer
  status?: number
  headers?: Record<string, string>
  /** Corta la conexion a mitad de la respuesta, para simular caidas. */
  truncate?: boolean
}

/** Servidor local: las pruebas no dependen de la red ni del rate limit de GitHub. */
export async function startServer(routes: Record<string, () => RouteResponse>): Promise<TestServer> {
  const hits = new Map<string, number>()

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]!
    hits.set(path, (hits.get(path) ?? 0) + 1)

    const route = routes[path]
    if (!route) {
      response.writeHead(404)
      response.end('no encontrado')
      return
    }

    const result = route()
    const body = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body, 'utf8')

    response.writeHead(result.status ?? 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      ...result.headers
    })

    if (result.truncate) {
      response.write(body.subarray(0, Math.floor(body.length / 2)))
      response.destroy()
      return
    }
    response.end(body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('sin dirección')

  return {
    url: `http://127.0.0.1:${address.port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
