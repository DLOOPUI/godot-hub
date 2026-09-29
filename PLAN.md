# Godot Hub — registro de diseño

App de escritorio para Windows que gestiona una carpeta dedicada, lista las 10 últimas
versiones **stable** de Godot, descarga/instala la elegida y la arranca. Notificación
nativa al terminar. Interfaz de **GENZAI**: manga angular + cómic, con paleta y borde
de texto elegibles en Ajustes.

Este documento **no** es el plan original: se actualizó al terminar para describir lo
que realmente se construyó. Las decisiones que se apartaron del plan inicial están en
la sección [Desvíos respecto al plan original](#desvíos-respecto-al-plan-original), con
el motivo de cada una. Para instalar y ejecutar, ver [README.md](README.md).

Estado: **las 8 fases están implementadas y verificadas.**

---

## 1. Stack técnico

**Electron 33 + TypeScript + electron-vite. Renderer en HTML/CSS/TS puro, sin framework.**

Motivo: en la máquina de desarrollo había Node y no Rust. Electron cubre sin fricción
las tres cosas que el flujo necesita en Windows:

| Necesidad | API |
|---|---|
| Selector de carpeta nativo | `dialog.showOpenDialog({ properties: ['openDirectory'] })` |
| Notificación toast estilo OpenCode | `new Notification()` + `app.setAppUserModelId()` |
| Descarga con progreso + descompresión | `net.fetch` en el proceso principal + `yauzl` |

Alternativa si algún día importa el tamaño del binario (~150 MB → ~8 MB): **Tauri v2**,
reutilizando la misma UI. Decisión tomada por disponibilidad, no por preferencia; por
eso todo el I/O del renderer pasa por un único módulo [`bridge.ts`](src/renderer/bridge.ts),
que es lo único que habría que reescribir.

Sin framework de UI porque la app tiene tres pantallas y una lista de diez elementos.
El coste de React aquí sería mayor que el de redibujar un `<div>`.

### Estructura real

```
AUTOUPDATE/
├─ src/
│  ├─ main/                     # proceso principal (Node)
│  │  ├─ index.ts               # ventana, AppUserModelId, instancia única
│  │  ├─ ipc.ts                 # registro de handlers
│  │  ├─ config.ts              # config.json con escritura atómica
│  │  ├─ workspace.ts           # validar / inspeccionar / vaciar la carpeta
│  │  ├─ releases.ts            # consulta de GitHub + caché con ETag
│  │  ├─ installer.ts           # descarga, SHA-512, extracción, cancelación
│  │  ├─ launcher.ts            # arranca una versión y vigila cuándo se cierra
│  │  ├─ library.ts             # versiones instaladas contrastadas con el disco
│  │  ├─ news.ts                # feed del blog de Godot + parser acotado
│  │  ├─ session.ts             # esconder/restaurar la ventana y el icono de bandeja
│  │  ├─ notify.ts              # toasts de Windows
│  │  └─ logger.ts              # userData/logs/app.log con rotación
│  ├─ preload/index.ts          # contextBridge con allowlist de canales
│  ├─ renderer/
│  │  ├─ index.html             # incluye la CSP
│  │  ├─ main.ts                # enrutado, atajos, eventos de instalación, tema
│  │  ├─ bridge.ts              # única frontera con el backend
│  │  ├─ tema.ts                # aplica paleta y borde a las variables CSS
│  │  ├─ format.ts              # bytes, fechas, ETA, escapeHtml
│  │  ├─ fuentes/               # pack Técnica + Graffiti City, con licencias OFL
│  │  ├─ components/            # icons, modal, titlebar, cortina
│  │  ├─ styles/                # tokens.css, components.css
│  │  └─ views/                 # onboarding, library, releases, news, install-flow, settings
│  └─ shared/                   # ipc.ts (contrato), types.ts (modelos), tema.ts (paletas)
├─ test/                        # 111 pruebas (vitest)
│  └─ helpers/                  # electron-mock, escritor de zip, servidor HTTP
├─ build/icon.ico               # generado por scripts/make-icon.ts, versionado
├─ assets/                      # diseño del icono: PNG maestro de David (ico.png)
├─ scripts/make-icon.ts         # reduce el PNG a 256 y lo empaqueta como ICO
├─ electron-builder.yml         # empaquetado NSIS
└─ vitest.config.ts
```

**Seguridad de la ventana:** `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, CSP en el HTML. El renderer no recibe `fs` ni `ipcRenderer` crudo:
solo las funciones concretas del preload, con allowlist de canales.

---

## 2. Estado persistido

Dos archivos en `%APPDATA%\godot-hub\`:

**`config.json`** — preferencias. Escritura atómica (temp + `rename`) y normalización
defensiva al leer: cualquier campo ausente o con tipo incorrecto vuelve a su valor por
defecto, para que un archivo editado a mano no deje la app en un estado raro.

```jsonc
{
  "version": 1,
  "workspacePath": "D:\\Godot\\versiones",  // null antes del primer arranque
  "workspaceConfirmed": true,               // aceptó el borrado recurrente
  "skipInstallConfirm": false,              // "No preguntar a la próxima" (paso 4)
  "defaultCleanupMode": null,               // "delete" | "keep" | null (paso 5)
  "flavor": "standard",                     // "standard" | "mono"
  "hideWhileRunning": true,                 // esconderse mientras Godot está abierto
  "installed": [
    { "tag": "4.7.1-stable", "folder": "Godot_v4.7.1-stable_win64",
      "exe": "Godot_v4.7.1-stable_win64.exe", "flavor": "standard",
      "installedAt": "2026-07-29T02:39:05.198Z" }
  ],
  "paleta": "original",                     // id de la paleta en uso (tema)
  "borde": "normal",                        // grosor del borde de los textos
  "paletasPropias": []                      // las creadas en Ajustes
}
```

**`releases-cache.json`** — caché de la lista de GitHub (ETag + `fetchedAt` + items).
Separado a propósito: ver los desvíos.

`config:set` filtra `installed` y `version` del parche que llega del renderer. Esa lista
la gestiona solo el motor de instalación.

---

## 3. El flujo, tal como quedó

### Paso 1 — Elegir la carpeta

Se muestra si `workspacePath` es `null`, si `workspaceConfirmed` es `false`, o si la
ruta guardada ya no es válida (unidad desconectada, permisos cambiados). Esa
revalidación ocurre en cada arranque.

**Carpetas que se rechazan sin opción de continuar:** raíz de unidad, perfil de usuario,
Escritorio, Documentos, Descargas, Música, Imágenes, Vídeos, `Windows`, `Program Files`,
`ProgramData`, OneDrive, `Public`, y la carpeta de la propia app. También se rechaza
cualquier carpeta que **contenga** una de esas: elegir `C:\Users` pasaría un filtro que
solo mirase la ruta exacta, y vaciarla se llevaría el perfil entero.

La escritura se comprueba creando y borrando un archivo de prueba: en Windows los
permisos no se deducen del modo POSIX.

### Paso 2 — Advertencia de carpeta no vacía

Con contenido, modal bloqueante con el texto pedido, la lista de las primeras 8 entradas
(incluidas las ocultas, porque también se borrarían), el recuento y el tamaño total.

- `Elegir otra carpeta` (secundario)
- `Continuar y borrar todo el contenido de esta carpeta` (destructivo) — **el texto del
  botón afirmativo es la advertencia**, como se pidió.

El borrado va a la **Papelera de reciclaje** (`shell.trashItem`), con `fs.rm` solo como
respaldo cuando Windows no lo permite. Se vacía el contenido; la carpeta se conserva.
Si algún elemento está bloqueado por otro proceso, se informa de cuál y no se continúa.

`clearWorkspace` vuelve a validar la ruta en el proceso principal antes de borrar: el
renderer no es la última palabra.

### Las tres secciones

La app se divide en **Biblioteca** (lo instalado, para arrancarlo), **Versiones** (lo
publicado, para instalarlo) y **Novedades** (el blog oficial), con la Biblioteca como
entrada por ser lo del día a día.

El marco común —navegación, carpeta de trabajo y ajustes— vive en `components/shell.ts`,
fuera de las vistas: si cada una dibujara su cabecera, cambiar de pestaña la repintaría
y se vería el salto.

Las dos vistas se crean una sola vez y se alterna cuál está visible. Destruirlas al
navegar perdería el progreso de una descarga en curso, que es justo el momento en el que
uno se va a mirar otra cosa.

`config.installed` es solo lo que la app recuerda; `listLibrary` lo contrasta con el
disco y marca lo ausente en vez de ocultarlo.

La Biblioteca avisa cuando la versión más nueva que tienes se ha quedado por detrás de
la última stable. La comparación usa `shared/version.ts`, el mismo módulo que ordena la
lista de versiones: por número, nunca por texto ni por fecha.

**Novedades** lee `godotengine.org/rss.xml` con la misma política de caché que las
versiones (ETag, TTL de 1 h, y lo cacheado marcado con su fecha si falla la red). Se
piden al entrar en la sección, no al arrancar.

Dos decisiones de seguridad ahí. La primera: se usa el `<summary>` en texto plano y
**nunca** el `<description>`, que llega como HTML de un servidor externo; pintarlo sería
darle a un tercero la capacidad de inyectar marcado en la app. La segunda: el parser
descarta cualquier enlace que no sea `https`, y el canal `app:open-external` vuelve a
exigirlo en el proceso principal, porque ese canal queda expuesto al renderer y no debe
poder abrir `file://` ni nada que no sea una página web.

El parser es propio y acotado a este feed en lugar de una dependencia de XML genérica.
Tiene una trampa que costó un fallo: dentro de una plantilla de JavaScript, `\s` se
resuelve como `s` **antes** de construir la expresión regular, así que el patrón acababa
buscando `[sS]` y no casaba con nada. Se usa `String.raw`.

### Paso 3 — Lista de versiones

Fuente: releases de `godotengine/godot-builds`, filtrando `tag_name` que acabe en
`-stable` y descartando borradores. Orden **por versión, no alfabético ni por fecha**:
`4.10` va por encima de `4.9`, y un parche retroportado como `4.5.2` queda debajo de
`4.6` aunque sea posterior.

Assets resueltos por nombre: `..._win64.exe.zip` (estándar), `..._mono_win64.zip` (.NET)
y `SHA512-SUMS.txt`.

**Caché** con TTL de 6 h; fuera de él se revalida con `If-None-Match` y un 304 evita
volver a parsear ~1 MB de JSON. La API anónima de GitHub permite 60 peticiones/hora
por IP. Sin red, se sirve la caché marcada con su antigüedad; sin caché, el error es
el estado de la vista.

Toggle Estándar/.NET que persiste, botón de recarga y engranaje de Ajustes.

### Paso 4 — Confirmación de instalación

Modal con el tamaño, la variante y la casilla **"No preguntar a la próxima"**
(`skipInstallConfirm`). Reversible desde Ajustes.

### Paso 5 — Qué hacer con la versión actual

- `Eliminar la versión actual` (destructivo)
- `Conservarla en la carpeta`
- `Cancelar` — aborta la instalación

Casilla "Recordar mi elección" (`defaultCleanupMode`), también reversible desde Ajustes.
No aparece si no hay ninguna versión instalada: no habría nada que borrar.

### Instalación

Cinco fases, todas emitiendo progreso y todas cancelables:

1. **`cleanup`** — si eligió eliminar, borra las carpetas registradas en `installed`
   (a la Papelera). **No** vacía la carpeta de trabajo: ver los desvíos.
2. **`download`** — a `<carpeta>/.tmp/<asset>.part` en streaming, con porcentaje,
   velocidad y ETA. El SHA-512 se calcula sobre el flujo, no releyendo el disco.
3. **`verify`** — contra `SHA512-SUMS.txt`. Si no coincide, se aborta y se descarta.
4. **`extract`** — con `yauzl`, descartando el directorio raíz cuando el zip ya trae
   uno (los zips de .NET lo traen).
5. **`finalize`** — borra `.tmp`, registra en `installed`, notifica.

Un `.part` huérfano de un cierre a mitad se barre al arrancar.

### Iniciar una versión instalada

Las tarjetas de versiones instaladas llevan un botón **Iniciar** junto a *Reinstalar*.
`launchVersion` recompone el ejecutable desde `workspacePath` + la entrada de `installed`
y **comprueba que la ruta resultante siga dentro de la carpeta de trabajo** antes de
abrirla: `config.json` es un archivo de texto editable, y sin esa comprobación el botón
sería "ejecuta cualquier binario del sistema".

Se lanza con `spawn` en modo `detached` + `unref`, así que Godot sobrevive al gestor.

Si la carpeta se borró a mano, se ofrece quitar la versión del registro en vez de
fallar en silencio.

**Esconder el gestor mientras Godot está abierto** (`hideWhileRunning`, activo por
defecto): la ventana se oculta al lanzar y vuelve sola al cerrarse Godot. Se **esconde,
no se cierra**: si la app terminara de verdad no quedaría nadie vigilando para volver a
abrirla. Mientras está oculta hay un icono en la bandeja del sistema, sin el cual una
ventana invisible solo se podría recuperar desde el Administrador de tareas.

**Detectar que Godot se cerró es lo difícil de esta función.** Godot no se comporta como
un ejecutable normal: al arrancar levanta dos procesos, y al abrir un proyecto desde el
Administrador de Proyectos el proceso original termina mientras el editor continúa en
otro. Vigilar el PID lanzado haría reaparecer el gestor encima del editor recién
abierto. Por eso se sondea cada 1,2 s si queda **algún** proceso con ese nombre de
imagen, vía `tasklist`.

Ese sondeo tiene una trampa que costó un fallo real: con el formato de tabla (`/NH`)
`tasklist` recorta el nombre a 25 caracteres y descarta la extensión, de modo que
`Godot_v4.7.1-stable_win64.exe` se imprime como `Godot_v4.7.1-stable_win64` y la
comparación nunca casaba — el gestor daba a Godot por cerrado un segundo después de
abrirlo. Se usa `/FO CSV`, que devuelve el nombre completo. La función que analiza esa
salida está aislada y probada precisamente por eso.

### Notificación

`app.setAppUserModelId()` se fija antes de crear la ventana. El éxito notifica siempre;
el fallo solo si la ventana no está en primer plano, porque si lo está ya se ve el modal.
Un clic abre el Explorador con el ejecutable seleccionado.

**Windows saca el nombre legible del acceso directo del Menú Inicio.** Sin instalar, el
toast muestra `com.david.godot-hub` en la cabecera; con el instalador NSIS
muestra "Godot Hub".

---

## 4. Diseño — el estilo de GENZAI

Desde la versión 0.3.0 la interfaz es la misma de todos los proyectos: **manga
angular estilizado + cómic independiente, con aire urbano y de graffiti**. El
neumorfismo en azules Godot de la 0.2.0 se retiró entero (primitivas incluidas);
la decisión y sus reglas viven en `Perfil - Como trabajo` y en
`GENZAI - Estilo de interfaz`, y aquí solo se anota cómo se traducen.

**Colores como papeles.** `--primario` (profundo), `--secundario` (ácido) y
`--fondo` (oscuro), de los que [shared/tema.ts](src/shared/tema.ts) deriva panel,
humo, neones y texto. Las **cuatro paletas de fábrica** de GENZAI vienen con los
tonos afinados a mano; las propias se derivan y un fondo claro se oscurece solo.
Ningún color va escrito a mano fuera de esas variables. **Siempre oscura**.

**El texto: blanco siempre, y la sombra lleva el color.** Nunca letras verdes o
moradas: el orden de capas, de atrás adelante, es sombra(s) de color → borde
negro → relleno blanco. El borde es un **anillo de 24 sombras negras sin
difuminar** (`tema.ts`), no `-webkit-text-stroke`: el trazo saca picos en las
esquinas agudas de Graffiti City y al seleccionar texto Chromium lo repinta
encima. Las sombras de color se corren a partir del radio del anillo, para que
un borde grueso no las tape. Cada texto elige `--s1`, `--s2` y `--paso`; las dos
sombras para rótulos, solo secundario lo que grita (pestaña activa), solo
primario los títulos.

**Formas cortadas.** `clip-path` con esquina a inglete en todo: paneles, botones,
pestañas, barras, hasta el pulgar del toggle. Nada de `border-radius`.

**Sombras duras.** Sin difuminar, desplazadas. Los paneles llevan la silueta
negra corrida (`sombraDura` de GENZAI, el aire de papel recortado); los botones,
**las dos de color** (secundario cerca, primario detrás) con fondo negro de tinta.

**Fuentes.** El pack Técnica de GENZAI, igual que DE_LAUNCHER: **Anton** en
rótulos, **Archivo** en cuerpo y botones, **IBM Plex Mono** en rutas y etiquetas;
licencias OFL versionadas junto a los archivos. **Graffiti City** solo para la
marca "GODOT HUB", fija y sin tildes — esa fuente dibuja los acentos como huecos,
y las noticias (contenido ajeno con tildes) van en Archivo, que los trae
completos. El japonés de adorno (図書館, 更新, 便り…) va con la fuente del
sistema: ninguna del pack trae kana.

**Ajustes.** Paleta y borde se cambian desde Ajustes y **se aplican en el acto**,
sin confirmar ni reiniciar. La persistencia va en `config.json` con el resto de
preferencias (no en localStorage: una sola fuente de verdad), y la ventana lee
su `backgroundColor` de la paleta guardada.

**La cortina.** El cambio de sección cruza la transición de GENZAI: franjas
negras sólidas que suben en diagonal sin fade, rayos de color por encima, y se
retiran por el mismo camino. El contenido se cambia en el medio.

**Trama y rayado** de semitono y spray, animación **bounce** (se pasa de largo
y vuelve), y foco de teclado con `outline` sólido: las sombras duras no tienen
contraste suficiente para indicar foco. `prefers-reduced-motion` desactiva
cortina, rebotes y transiciones.

---

## 5. Contrato IPC

Declarado una sola vez en [shared/ipc.ts](src/shared/ipc.ts); el preload usa las listas
`INVOKE_CHANNELS` y `EVENT_CHANNELS` como allowlist.

```
invoke:  app:info · window:action · config:get · config:set
         workspace:pick · workspace:inspect · workspace:clear · workspace:reveal
         releases:list · install:start · install:cancel
         app:log · app:open-logs

eventos: window:maximized-changed
         install:progress · install:done · install:error
```

---

## 6. Fases

| # | Fase | Estado |
|---|---|---|
| 1 | Andamiaje: Electron + Vite + TS, ventana frameless | hecha |
| 2 | Tokens y componentes neumórficos | hecha |
| 3 | Config, onboarding, carpetas bloqueadas, vaciado | hecha |
| 4 | Releases: fetch, caché con ETag, orden por versión, estados | hecha |
| 5 | Confirmaciones, "no preguntar", modo de limpieza, Ajustes | hecha |
| 6 | Motor de instalación: descarga, SHA-512, extracción, cancelación | hecha |
| 7 | Notificación nativa y empaquetado NSIS | hecha |
| 8 | Pulido: registro, atajos, accesibilidad, cambio de carpeta | hecha |
| 9 | Interfaz de GENZAI: paletas y borde en Ajustes, fuentes, cortina | hecha |
| — | Pruebas: 111 en vitest | hecha |

---

## Desvíos respecto al plan original

Nueve decisiones cambiaron durante la construcción. Aquí están para que nadie deduzca
la intención equivocada leyendo el código:

1. **La caché de releases va en su propio archivo, no en `config.json`.** El plan la
   metía dentro. Meter ~30 KB de payload en el archivo de preferencias obligaba a
   normalizarlo en cada arranque y a reescribirlo entero por cada refresco. Separados,
   una caché corrupta se descarta sola sin tocar la configuración.

2. **El paso 5 tiene `Cancelar`; no es un modal bloqueante.** El plan lo definía como
   `mandatory`, sin Esc ni clic fuera. Un diálogo del que no se puede salir es una
   trampa. Cancelar aborta la instalación entera, que consigue lo mismo.

3. **`skipInstallConfirm` no salta el paso 5, pero `defaultCleanupMode` sí.** El plan
   decía a la vez que el paso 5 "aparece siempre" y que tuviera "Recordar mi elección",
   y las dos cosas juntas no se sostienen. La casilla del paso 4 cubre un aviso
   informativo; solo la memoria propia del paso 5 lo salta.

4. **Si no hay nada instalado, el paso 5 no aparece.** No hay versión que borrar.

5. **`cleanup: 'delete'` borra solo las carpetas registradas, no vacía la carpeta.** El
   vaciado total ocurre una vez, en el paso 2, con confirmación explícita. Repetirlo en
   cada instalación destruiría cualquier archivo que el usuario dejara después.

6. **Sin `SHA512-SUMS.txt` no se instala.** El plan no decidía el caso. Es un ejecutable
   descargado de internet; un error claro es mejor que instalar a ciegas. Las versiones
   actuales lo publican todas.

7. **Se puede cambiar la carpeta de trabajo desde Ajustes.** No estaba en el plan, y su
   ausencia era un hueco real: la elección quedaba fijada para siempre.

8. **La defensa zip-slip del instalador no es la que actúa.** El plan la presentaba como
   la protección. Las pruebas demostraron que **yauzl rechaza por su cuenta** rutas
   absolutas y cualquier nombre con `..`, así que la comprobación propia no llega a
   dispararse. Se mantiene como segunda capa por si esa validación cambia, pero el
   comentario en el código lo dice explícitamente para no engañar a quien lo lea.

9. **La interfaz de la 0.2.0 (neumorfismo en azules Godot) se retiró entera.** El plan
   original la daba por cerrada, pero la estética de todos los proyectos de David es la
   de GENZAI y esta app era la única que se salía. No se mezcló nada: las primitivas
   neumórficas, el modo claro y el azul Godot desaparecieron; la lista de desvíos y la
   sección 4 describen lo que hay ahora.

---

## Riesgos y limitaciones conocidas

1. **El instalador no está firmado.** SmartScreen avisará la primera vez. No es evitable
   sin un certificado de firma de código.

2. **El nombre en el toast** es el AppUserModelID crudo hasta que se instala con el NSIS.

3. **Solo Godot 4.x.** `godot-builds` no contiene las 3.x. Para incluirlas hay que
   consultar también los releases de `godotengine/godot` y fusionar antes de ordenar.

4. **Rate limit de GitHub:** 60 peticiones/hora por IP en anónimo. Mitigado con caché y
   ETag. Si molesta, se puede añadir un token personal opcional en Ajustes.

5. **Godot .NET necesita el SDK de .NET aparte.** La app no lo gestiona.

6. **La revalidación de la carpeta ocurre solo al arrancar.** Si se desconecta la unidad
   con la app abierta, el fallo aparece al intentar instalar, no antes.
