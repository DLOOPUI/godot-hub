import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // El codigo del proceso principal importa `electron`, que solo existe
      // dentro del runtime de Electron. En las pruebas se sustituye por un
      // doble con las cuatro cosas que realmente se usan.
      electron: resolve(__dirname, 'test/helpers/electron-mock.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000
  }
})
