# Godot AutoUpdate

Gestor de versiones de Godot para Windows. Mantiene una carpeta dedicada, lista las 10
últimas versiones **stable** desde GitHub y descarga la elegida verificando su SHA-512,
con notificación nativa al terminar. Interfaz neumórfica en azules Godot.

Para el diseño y el por qué de cada decisión: [PLAN.md](PLAN.md).

---

## Requisitos

- **Windows 10 o 11** (la app usa APIs de Windows: toasts, Papelera de reciclaje)
- **Node.js 20 o superior** para desarrollar

Para usar la variante **.NET (Mono)** de Godot hace falta el SDK de .NET instalado
aparte; la app no lo gestiona.

## Puesta en marcha

```bash
npm install
```

Si `npm` avisa de scripts de instalación pendientes, hay que aprobarlos: `electron` y
`esbuild` descargan sus binarios nativos en ese paso y sin ellos nada arranca.

```bash
npm approve-scripts electron esbuild
```

Después, en modo desarrollo con recarga en caliente:

```bash
npm run dev
```

### Si Electron falla al arrancar

Con el mensaje `Electron failed to install correctly`. El zip se descarga completo pero
la extracción puede fallar en silencio (antivirus, permisos de la unidad). Como el zip
sigue en la caché, basta descomprimirlo a mano. En PowerShell, desde la raíz del
proyecto:

```bash
$v = (Get-Content node_modules\electron\package.json | ConvertFrom-Json).version; $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v$v-win32-x64.zip" | Select-Object -First 1; Expand-Archive $zip.FullName "node_modules\electron\dist" -Force; Set-Content "node_modules\electron\path.txt" "electron.exe" -NoNewline
```

Toma la versión de `node_modules\electron\package.json` en vez de coger el zip más
reciente de la caché, que con varios proyectos podría ser de otra versión.

Vuelve a pasar cada vez que se borra `node_modules`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca en desarrollo con recarga en caliente |
| `npm test` | Ejecuta las 63 pruebas (no toca la red) |
| `npm run test:watch` | Pruebas en modo vigilancia |
| `npm run typecheck` | `tsc --noEmit` sobre `src/` y `test/` |
| `npm run build` | Typecheck + compila los tres bundles a `out/` |
| `npm start` | Ejecuta lo compilado en `out/`, sin empaquetar |
| `npm run dist` | Genera el instalador NSIS en `release/` |
| `npm run make-icon` | Regenera `build/icon.ico` |

## Empaquetado

```bash
npm run dist
```

Produce `release/Godot AutoUpdate-<versión>-setup.exe` (~76 MB). El instalador no es de
un clic (permite elegir carpeta), se instala por usuario y no por máquina (no pide UAC),
y crea accesos directos en el escritorio y el Menú Inicio.

**El acceso directo del Menú Inicio no es opcional:** Windows saca de él el nombre
legible que muestra en las notificaciones. Ejecutando sin instalar, el toast aparece
igual pero con `com.david.godot-autoupdate` en la cabecera en vez de "Godot AutoUpdate".

**El instalador no está firmado.** SmartScreen avisará la primera vez (*Más información
→ Ejecutar de todas formas*). Evitarlo requiere un certificado de firma de código.

### El icono

`build/icon.ico` está versionado. Se genera renderizándolo con el propio Electron
([scripts/make-icon.ts](scripts/make-icon.ts)) y empaquetando el PNG en un contenedor
ICO, para no arrastrar una dependencia de tratamiento de imágenes por un solo archivo.
Solo hay que regenerarlo si cambia el diseño:

```bash
npm run make-icon
```

## Dónde guarda los datos

En `%APPDATA%\godot-autoupdate\`:

| Archivo | Contenido |
|---|---|
| `config.json` | Carpeta de trabajo, preferencias, versiones instaladas |
| `releases-cache.json` | Caché de la lista de GitHub (ETag, TTL de 6 h) |
| `logs\app.log` | Descargas, borrados y errores. Rota al llegar a 1 MB |

El desinstalador **no** borra esta carpeta.

Se puede abrir el registro desde la propia app: engranaje → *Abrir registros*.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `F5` o `Ctrl+R` | Recargar la lista de versiones |
| `Ctrl+,` | Abrir Ajustes |
| `Esc` | Cerrar el diálogo abierto |
| `Tab` / `Mayús+Tab` | Navegar (los diálogos atrapan el foco) |

Los atajos se ignoran mientras hay un diálogo abierto o una instalación en curso.

## Sobre la carpeta de trabajo

La app **borra y reescribe** el contenido de esa carpeta. Conviene una carpeta dedicada,
por ejemplo `D:\Godot\versiones`.

Se rechazan sin excepción la raíz de cualquier unidad, el perfil de usuario, Escritorio,
Documentos, Descargas, Música, Imágenes, Vídeos, `Windows`, `Program Files`,
`ProgramData`, OneDrive y la carpeta de la propia app. También cualquier carpeta que
*contenga* una de esas.

Dos cosas que conviene saber:

- El vaciado total ocurre **una sola vez**, al configurar la carpeta, y con confirmación
  explícita. No se repite en cada instalación.
- Lo borrado va a la **Papelera de reciclaje** siempre que Windows lo permita, así que
  un error es recuperable.

Para cambiarla después: engranaje → *Carpeta de trabajo* → *Cambiar*. La carpeta anterior
se queda como está; la app simplemente deja de gestionarla.

## Pruebas

```bash
npm test
```

63 pruebas en 5 archivos, sin acceso a red: `electron` se sustituye por un doble
([test/helpers/electron-mock.ts](test/helpers/electron-mock.ts)) y las descargas las
sirve un servidor HTTP local.

Dos ayudantes que merecen mención:

- **[test/helpers/zip.ts](test/helpers/zip.ts)** — escritor de ZIP mínimo. Existe porque
  ningún compresor normal permite crear entradas maliciosas (`../fuera.txt`, rutas
  absolutas), y sin poder fabricarlas la defensa de la extracción no se puede probar,
  solo leer.
- **[test/helpers/server.ts](test/helpers/server.ts)** — servidor local que además
  cuenta peticiones por ruta (así se comprueba que la caché no vuelve a pedir) y puede
  cortar una respuesta a mitad para simular una caída de red.

## Limitaciones conocidas

- **Solo Godot 4.x.** El repositorio `godot-builds` no contiene las 3.x.
- **Rate limit de GitHub:** 60 peticiones/hora por IP en anónimo. Mitigado con caché y
  ETag; en uso normal no se llega.
- Una versión que no publique `SHA512-SUMS.txt` no se instala, por diseño.
- Una sola instalación a la vez.

## Estructura

```
src/main/       proceso principal: ventana, IPC, config, releases, instalador, toasts, log
src/preload/    contextBridge con allowlist de canales
src/renderer/   interfaz (HTML/CSS/TS, sin framework)
src/shared/     contrato IPC y modelos, compartidos por ambos lados
test/           pruebas y ayudantes
build/          icono versionado
scripts/        generador del icono
```

El renderer no ve `fs` ni `ipcRenderer`: todo su I/O pasa por
[src/renderer/bridge.ts](src/renderer/bridge.ts), que es también lo único que habría que
reescribir para migrar a otro backend.
