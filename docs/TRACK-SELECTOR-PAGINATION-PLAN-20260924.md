# Selector de tracks paginado: implementación y mitigación

Estado: **PLAN ABIERTO**. Revisión: **24/09/2026**. Base inspeccionada: **`167832a`**. Este documento diseña la sustitución del selector que carga la colección completa; no declara la implementación terminada.

## Resultado buscado

Abrir y usar el selector de playlists, Likes y uploads sin materializar toda la colección en el popup ni en el content script. El total de la colección puede crecer a 50.000 pistas sin que crezcan en la misma proporción el heap del popup, el número de nodos DOM ni el tamaño de un mensaje de runtime.

La experiencia objetivo es progresiva:

1. El selector abre al tener la primera página utilizable.
2. Muestra las filas ya indexadas y obtiene páginas adicionales cerca del final de la ventana.
3. Guarda páginas, cursor y selección en IndexedDB para reabrir sin empezar desde cero.
4. Mantiene en memoria sólo la ventana visible, un margen pequeño y como máximo unas pocas ventanas cercanas.
5. `Seleccionar todo` representa toda la colección, incluidas las páginas todavía no visitadas, sin crear un `Set` con todos los IDs.
6. Descargar usa la enumeración durable existente y una referencia inmutable a la selección; no manda miles de tracks o IDs entre contextos.

## Decisiones de producto a confirmar

El plan usa provisionalmente estas decisiones recomendadas. Cambiarlas modifica UI y contratos, pero no invalida el objetivo de memoria acotada.

| Tema | Decisión recomendada usada por el plan | Alternativa y costo |
| --- | --- | --- |
| Apertura | Mostrar la primera página y continuar bajo demanda con prefetch corto. | Enumerar todo en segundo plano tarda más, hace muchas requests aunque el usuario no recorra la lista y consume más disco. |
| `Seleccionar todo` durante la carga | Incluir toda la colección, también lo que se descubra después. | Limitarlo a «lo cargado» es más difícil de explicar y cambia el resultado según el momento del clic. |
| Colección que cambia mientras está abierta | Snapshot estable. `Actualizar` crea una sesión nueva; la sesión actual no reordena filas. | Actualizar en vivo rompe índices, foco, conteos y la selección mientras el usuario interactúa. |
| Total visible antes de terminar | Mostrar encontrados/seleccionados y el total de SoundCloud como estimación; marcarlo exacto sólo al llegar al fin real. | Usar el total público como exacto confunde likes no descargables, playlists, duplicados y pistas inaccesibles. |
| Cierre del popup | Conservar la sesión y su checkpoint; pausar prefetch no necesario. | Continuar hasta 50.000 en segundo plano genera tráfico sin una acción activa del usuario. |
| Descarga antes de enumerar todo | Permitida. `all`/`all_except` sigue paginando hasta el final en el job; `explicit` incluye sólo IDs elegidos. | Bloquear hasta terminar empeora mucho la primera acción sobre bibliotecas grandes. |

Preguntas pendientes para el propietario:

1. ¿Preferís carga bajo demanda al acercarse al final o que, una vez abierto el selector, siga indexando toda la colección aunque cierres el popup?
2. ¿Confirmás que `Seleccionar todo` debe incluir también las pistas válidas todavía no cargadas?
3. ¿Confirmás snapshot estable con botón `Actualizar`, en vez de insertar o quitar filas en vivo?

Hasta obtener respuesta, la implementación debe seguir las opciones recomendadas y mantenerlas aisladas en constantes/política, no dispersarlas por la UI.

## Diagnóstico actual

El DOM ya está virtualizado parcialmente en `scripts/popup.js`: filas de 40 px, viewport de ocho filas y overscan de seis. Eso limita los nodos visibles, pero el resto del flujo sigue siendo completo:

```text
popup.openSelectionPanel
  -> GET_BULK_SELECTION_LIST
  -> content.page-intake.selectionList
  -> resolveBulk(null)
  -> array completo + selectionCache completo
  -> un mensaje con todos los items
  -> selectionItems completo en el popup
  -> render de una ventana pequeña
```

Problemas concretos:

- `selectionList()` acumula todos los tracks en el content script.
- `selectionCache.tracks` conserva otra referencia a la colección completa.
- el mensaje de runtime clona la lista completa;
- `selectionItems` vuelve a retenerla en el popup;
- `renderVisibleSelectionRows()` recrea todas las filas de la ventana con `replaceChildren()` aun si el rango no cambió;
- `tracksByIds()` reconstruye un `Map` de toda la colección y vuelve a enumerar si falta un ID;
- el total público puede incluir entradas no seleccionables y no es una verdad exacta;
- cerrar el popup durante la carga pierde el trabajo de selección;
- no hay contrato durable de sesión, revisión, TTL o limpieza para el selector.

Las descargas bulk ya resuelven otro problema: `SCDownloadSource.collectionPage()` enumera por páginas desde background y `SCBulkLibrary` guarda checkpoints/tracks en IndexedDB. El selector debe reutilizar esa fuente y sus defensas, sin reutilizar un job de descarga como si fuera una vista editable.

## Arquitectura objetivo

```text
Popup
  | OPEN_SELECTOR / GET_WINDOW / SET_SELECTION / START_SELECTED_JOB
  v
TrackSelectorManager (background)
  |-- SCDownloadSource.collectionPage()       páginas de <= 200
  |-- TrackSelectorStore (IndexedDB)          sesión, items, overrides, cursores
  `-- BulkJobManager                          recibe referencia congelada

Popup en memoria
  resumen + ventana visible + ventanas vecinas
  nunca la colección completa
```

### Autoridad por contexto

| Contexto | Responsabilidad | No debe conservar |
| --- | --- | --- |
| Content script | Detectar página y producir descriptor inicial de fuente. | Lista completa, caché de selección o trabajo durable. |
| Background | Validar descriptor, paginar SoundCloud, persistir sesión, deduplicar, pausar/reanudar y crear el job. | Un array de toda la colección. |
| IndexedDB | Orden, metadata durable, cursor, selección y lifecycle de la sesión. | Secretos, OAuth o cookies. |
| Popup | Render, foco, interacción y caché LRU pequeña. | Todos los tracks o todos los IDs seleccionados. |

El background puede paginar Likes autenticados mediante el adaptador ya configurado de `SCDownloadSource`; no necesita que la pestaña permanezca en la misma URL después de crear y validar el descriptor.

## Modelo durable

Subir `scdl_bulk_jobs` a una nueva versión y agregar stores propios. No mezclar estados editables del selector con `jobs`/`tracks`, cuyos estados significan ejecución de descarga.

### `selectorSessions`

Clave: `sessionId`.

Campos mínimos:

```text
sessionId
sourceKey                 kind + identidad + URL normalizada + sesión de cuenta
sourceDescriptor          kind, userId/sourceUrl, clientId, authenticated
status                    idle | enumerating | paused | ready | partial | failed | cancelled | locked
epoch                     invalida respuestas/cancelaciones antiguas
revision                  cambia al hacer commit o modificar selección
estimatedTotal            dato informativo de SoundCloud, puede ser null
enumerated                entradas crudas recorridas
eligible                  filas seleccionables y deduplicadas
skipped                   unavailable, duplicate, invalid
nextCursor
enumerationComplete
defaultSelected           true para Select all; false para Clear all
overrideCount
selectedKnown             exacto entre las filas conocidas
errorCode, error, retryAt
createdAt, updatedAt, expiresAt
lockedByJobId
```

### `selectorItems`

Clave: `[sessionId, index]`; índice único `[sessionId, trackId]`.

El índice es denso entre pistas elegibles y da numeración continua. Cada registro guarda:

```text
sessionId, index, trackId
title, durationMs
durableTrack              SCDownloadTrack.toDurable(...)
```

`durableTrack` permite promover lo ya indexado a un job sin refetch. Antes de fijarlo como contrato definitivo hay que medir bytes por registro y cuota. Si 50.000 registros completos resultan demasiado pesados, conservar sólo la proyección y dejar que el job reenumere; nunca resolverlo guardando el array en RAM.

### `selectorOverrides`

Clave: `[sessionId, trackId]`.

Sólo guarda excepciones respecto de `defaultSelected`:

- `defaultSelected=true`: un registro significa excluido;
- `defaultSelected=false`: un registro significa incluido;
- volver al valor por defecto elimina el registro.

Así `Select all` y `Clear all` son O(1). Una selección manual grande crece en disco según las acciones del usuario, no en el mensaje ni en el heap del popup.

### `selectorCursors`

Clave: `[sessionId, cursorNormalizado]`. Guarda el siguiente cursor, revisión y fecha de commit. Permite reconocer replay, cursor repetido y reanudación después de suspensión del service worker.

## Contrato de mensajes

Todos los handlers validan esquema, origen, tamaños, `sessionId`, `epoch` y revisión. Los errores públicos usan códigos estables; no devuelven cookies, token OAuth ni URLs con credenciales.

### Abrir o recuperar

```js
OPEN_TRACK_SELECTOR {
  tabId,
  collection: { kind, sourceUserId, sourceUrl, pageUrl, clientId, totalCount },
  defaultSelected
}

=> { session, firstWindow }
```

- validar `tabId` desde la pestaña activa y URL SoundCloud;
- normalizar un `sourceKey` sin parámetros variables;
- reutilizar sólo una sesión no expirada de la misma fuente/identidad;
- si no existe, crearla y pedir una sola página inicial;
- responder cuando haya una ventana o un error concluyente, sin esperar el fin de la colección.

### Leer ventana

```js
GET_TRACK_SELECTOR_WINDOW {
  sessionId,
  offset,
  limit,
  knownRevision
}

=> {
  session: { status, revision, eligible, estimatedTotal, enumerationComplete, ... },
  offset,
  items: [{ index, id, title, duration, selected }]
}
```

Límites iniciales propuestos: `limit <= 100`, strings truncados/validados y respuesta objetivo menor de 128 KiB. El test debe medir bytes reales serializados; el límite no se da por cumplido sólo por contar items.

### Cambiar selección

```js
SET_TRACK_SELECTOR_ITEM { sessionId, trackId, selected, epoch, expectedRevision }
SET_TRACK_SELECTOR_DEFAULT { sessionId, selected, epoch, expectedRevision }
```

La mutación ocurre en una transacción. Si la revisión quedó vieja, devolver `selection_conflict` con el resumen actual; el popup vuelve a leer la ventana antes de reintentar una acción explícita.

### Enumerar más

```js
LOAD_TRACK_SELECTOR_NEXT { sessionId, epoch, expectedCursor }
RETRY_TRACK_SELECTOR { sessionId, epoch }
REFRESH_TRACK_SELECTOR { sessionId }
CANCEL_TRACK_SELECTOR { sessionId, epoch }
```

Debe existir una sola promesa de página en curso por sesión. Solicitudes repetidas comparten esa promesa. `Refresh` incrementa epoch y crea un snapshot nuevo; no vacía el viejo hasta que el nuevo tenga una primera página válida.

### Descargar selección

```js
START_SELECTED_BULK_JOB {
  sessionId,
  selectionRevision,
  formatPreference,
  downloadDestination
}
```

El background bloquea la sesión en esa revisión, crea el job y guarda `selectionSessionId`, `selectionRevision` y `defaultSelected`. Cada página del job evalúa sus IDs contra `selectorOverrides` mediante consultas acotadas. El popup no manda `selectionIds`.

Si la sesión todavía no terminó:

- `defaultSelected=true` incluye las pistas válidas futuras salvo exclusiones explícitas;
- `defaultSelected=false` incluye sólo overrides positivos existentes al congelar la revisión;
- el job puede reutilizar las filas persistidas y continuar desde el cursor, o reenumerar si la medición demuestra que copiar/promover es más costoso;
- la sesión queda fijada hasta completar/cancelar el job y no participa de cleanup.

## Enumeración y consistencia

1. `TrackSelectorManager` solicita como máximo 200 entradas crudas por página.
2. Valida el cursor con las reglas de `SCDownloadSource`.
3. Convierte como máximo esa página a tracks durables.
4. En una sola transacción deduplica por `[sessionId, trackId]`, agrega índices densos, actualiza contadores, registra el cursor y recién entonces publica la nueva revisión.
5. Libera referencias a la página después del commit.
6. Precarga una página adicional sólo cuando el usuario está a dos ventanas del final conocido. El scroll estable no hace requests.

Una página vacía con `nextCursor` no significa fin. Permitir continuar con un máximo acotado de páginas vacías consecutivas; superar el límite deja estado `partial/empty_page_cycle`, no `ready`. Un cursor repetido o fuera del host/ruta permitidos deja `partial` y conserva las filas útiles.

Los contadores tienen significados separados:

- `estimatedTotal`: metadata de SoundCloud;
- `enumerated`: entradas crudas vistas;
- `eligible`: tracks válidos, descargables y deduplicados;
- `selectedKnown`: seleccionados entre los elegibles conocidos;
- el seleccionado exacto de toda la colección sólo existe al completar, salvo selección explícita finita.

## Popup y virtualización

### Estado acotado

Reemplazar `selectionItems` por:

```text
selectionSessionSummary
windowCache LRU            máximo 3-5 ventanas alineadas
visibleRange               start/end
inFlightWindows            deduplicadas por session/revision/window
requestSequence            descarta respuestas tardías
```

Con viewport actual, usar ventanas de 64 filas es suficiente para visible + overscan y deja margen. La cifra se valida con zoom 100–200 %, navegación por teclado y medición; no se convierte en constante histórica sin prueba.

### Render reconciliado

- calcular en `requestAnimationFrame`;
- recordar el último rango y no renderizar si no cambió;
- conservar nodos por `trackId`/índice cuando siguen dentro de la ventana;
- crear sólo filas que entran y retirar sólo las que salen;
- no ejecutar `replaceChildren()` para cada movimiento de scroll;
- usar `transform: translateY(...)` y spacer sólo sobre las filas conocidas;
- mostrar un loader/fila de continuación al final mientras `enumerationComplete=false`;
- ante una ventana aún no leída, renderizar placeholders con altura fija, sin saltar el layout.

### Foco y accesibilidad

- mantener un índice de foco lógico aunque su nodo salga del DOM;
- restaurar foco al volver a montar la fila;
- soportar Tab, Space, flechas, Home y End dentro del alcance conocido;
- ofrecer acción visible `Cargar más` además del disparador por proximidad, para teclado y lector;
- marcar el listado `aria-busy=true` sólo durante una página en curso;
- anunciar páginas agregadas, pausa/error y conteo exacto al finalizar sin anunciar cada scroll;
- no anunciar `estimatedTotal` como cantidad seleccionable exacta.

Al completar y corregir el total/alto, conservar el track ancla y su offset relativo para evitar saltos.

## Lifecycle, memoria y cuota

- una sesión de selector activa por `sourceKey`; abrir de nuevo se conecta a ella;
- TTL inicial recomendado: 24 horas para sesiones no fijadas;
- conservar como máximo la sesión más reciente por fuente y un máximo global pequeño, a decidir tras medir uso real;
- limpiar `items`, overrides y cursores por rango en una transacción o lotes idempotentes;
- no borrar sesiones `lockedByJobId`, pausadas recuperables o usadas por un job activo;
- si `navigator.storage.estimate()` indica presión de cuota, limpiar sesiones expiradas antes de escribir;
- si sigue sin espacio, dejar `storage_quota` visible y conservar la selección ya confirmada; no volver silenciosamente a la ruta de lista completa;
- al cerrar popup, abortar sólo lecturas de UI; el commit de página ya iniciado termina o se invalida por epoch;
- agregar `AbortSignal` opcional a `SCDownloadSource.collectionPage()` y pasarlo al cliente HTTP para cancelación/refresh reales.

## Errores y mitigaciones

| Riesgo | Mitigación | Comportamiento visible |
| --- | --- | --- |
| `429`/red/timeout | Checkpoint transaccional, `retryAt`, alarma y reanudación desde el mismo cursor. | Filas cargadas siguen usables; estado pausado y Retry cuando corresponda. |
| Cursor repetido o inválido | Allow-list de host/ruta y store de cursores vistos. | Resultado parcial explícito; no fingir lista completa. |
| Respuesta tardía tras refresh | Comparar `sessionId + epoch + cursor + revision` dentro de la transacción. | La sesión nueva no recibe filas antiguas. |
| Cambio de cuenta | Incluir identidad de sesión/cuenta en `sourceKey`; invalidar descriptor anterior. | Pedir actualizar/reabrir; nunca mezclar Likes. |
| Doble clic/calls repetidas | Promesa en curso compartida e idempotencia por cursor. | Una página y una mutación. |
| Duplicados entre páginas | Índice único `[sessionId, trackId]`. | Numeración densa; contador de duplicados separado. |
| Likes que son playlists | Contar como entrada no seleccionable según contrato actual. | Total estimado puede ser mayor que elegibles. |
| Popup cerrado | Estado en background/IndexedDB; UI desacoplada. | Reabrir recupera posición/sesión. |
| Worker suspendido | Cursor y estado escritos antes de publicar; `ensureSelectorRunning()` al despertar. | Reanuda sin volver a página 1. |
| Job iniciado mientras cambia selección | Congelar revisión y bloquear sesión. | La descarga corresponde exactamente a la confirmación. |
| Falta de cuota | Cleanup previo y error específico. | No spinner eterno ni fallback de memoria completa. |
| Playlist grande | Resolver descriptor/orden una vez y persistir cursor/entradas por páginas; no volver a resolver toda la playlist en cada página. | Misma UX progresiva que Likes/uploads. |

## Secuencia de implementación

### Etapa 0 — Baseline y contrato

Archivos: nuevo verificador de selector, `scripts/popup.js`, `page-intake.js` y fixtures.

1. Instrumentar número de filas DOM, items retenidos en popup, páginas, requests, bytes máximos por mensaje, tiempo a primera ventana y memoria tras cerrar.
2. Medir 1.000, 10.000 y 50.000 pistas sintéticas sobre la implementación actual para documentar el problema, sin descargar audio.
3. Registrar por separado heap del popup, background/content y tamaño lógico de IndexedDB.
4. Convertir las decisiones de producto confirmadas en pruebas de contrato.

Salida: informe baseline reproducible; ninguna afirmación de mejora basada sólo en que el DOM tiene pocas filas.

### Etapa 1 — Store de sesiones

Archivos: `scripts/bulk-library.js` o nuevo `scripts/track-selector-store.js`, migración IndexedDB y tests con Chromium real.

1. Crear stores/índices descritos y API transaccional.
2. Implementar create/get/commitPage/getWindow/setDefault/setOverride/pause/resume/lock/delete/cleanup.
3. Probar commit repetido, cursor cíclico, dedupe, conflictos de revisión, cleanup y versionchange/blocked.
4. Insertar 50.000 fixtures en páginas; leer principio/medio/final sin `getAll()`.

Salida: ninguna API pública del store devuelve toda una sesión de items.

### Etapa 2 — Manager en background

Archivos: nuevo `scripts/track-selector-manager.js`, `background.js`, `download-source.js`, manifiesto y packager.

1. Validar descriptor y crear/recuperar sesión.
2. Hacer una página por operación con deduplicación de in-flight.
3. Añadir retry, aborto, checkpoint, epoch y recuperación al despertar.
4. Emitir resumen por `chrome.runtime.sendMessage`; el popup también debe poder hacer polling al reabrir.
5. Probar que cerrar popup/navegar no inserta resultados obsoletos ni obliga a recomenzar.

Salida: primera ventana disponible sin `GET_BULK_SELECTION_LIST`; memoria transitoria limitada a una página.

### Etapa 3 — Popup paginado y render reconciliado

Archivos: `popup.js`, `popup.html`, i18n y `verify-popup-selection.js`.

1. Sustituir `selectionItems` por resumen + LRU de ventanas.
2. Abrir con primera ventana, loader final y progreso real.
3. Implementar rango estable, caché alineada, descarte de respuestas tardías y reconciliación de nodos.
4. Implementar foco, teclado, `aria-busy`, retry y `Cargar más`.
5. Conservar numeración continua y conteo basado en elegibles, no metadata.

Salida: scroll repetido dentro del mismo rango produce cero mensajes, cero consultas y cero reconstrucciones completas.

### Etapa 4 — Selección semántica y descarga

Archivos: selector store/manager, `download-intent.js`, `bulk-job-manager.js`, `bulk-library.js` y popup.

1. Implementar `defaultSelected + overrides` y conteos transaccionales.
2. Cambiar el inicio de descarga para usar `sessionId + revision`.
3. Bloquear/pinear sesión y evaluar la selección por página sin materializar IDs.
4. Reutilizar o promover datos persistidos en lotes; medir contra reenumeración antes de elegir el camino final.
5. Liberar el pin al terminar/cancelar y mantener retry de tracks sin cambiar la selección original.

Salida: selección de 50.000 con `all` ocupa O(1) overrides; `all_except` crece sólo con exclusiones; ningún mensaje contiene todos los IDs.

### Etapa 5 — Retirada de la ruta completa

Archivos: `popup.js`, `content.js`, `page-intake.js` y verificadores.

1. Eliminar producción de `GET_BULK_SELECTION_LIST`.
2. Eliminar `selectionList`, `selectionCache` y `tracksByIds` cuando no queden consumidores.
3. Conservar `selectionPage` sólo si sigue siendo adaptador probado; si background ya es autoridad, retirarlo también para evitar dos contratos.
4. No dejar fallback automático a `resolveBulk(null)` para colecciones pequeñas: puede reaparecer accidentalmente para Likes grandes.
5. Actualizar documentación y evidencia R2a/G2.

Salida: `rg` no encuentra la ruta completa fuera de documentos históricos o un test explícito que garantice su ausencia.

### Etapa 6 — QA real y rollout

1. Playlists y uploads: 0, 1, 25, 50, 51, 200 y 1.000 entradas.
2. Likes: cuenta autenticada, pública, entradas inaccesibles, playlists entre likes y duplicados.
3. Abrir/cerrar popup, SPA navigation, reinicio de worker/Chrome, cambio de cuenta y pérdida de red.
4. Zoom 100/125/150/200 %, teclado y lector de pantalla.
5. Comparar métricas con Etapa 0; documentar hardware/navegador y caché fría/caliente.

Salida: sólo después de QA real se marca R2a/G2 cerrado y se actualiza `ESTADO-ACTUAL`.

## Matriz mínima de pruebas automatizadas

| Área | Casos obligatorios |
| --- | --- |
| Store | 0/1/200/50k, dedupe, commit replay, cursor repetido, conflicto de revisión, cleanup y cuota/error. |
| Mensajes | Campos inválidos, offsets negativos, limit excesivo, session ajena/expirada, respuesta acotada. |
| Enumeración | Fin normal, página vacía con siguiente cursor, 401/403, 429+Retry-After, 5xx, aborto y respuesta tardía. |
| Virtualización | Inicio/medio/final, rango estable, scroll rápido, cambio de alto, ancla al completar y máximo de nodos. |
| Selección | all, none, all_except, explicit, toggle reversible, select all antes de completar y freeze de revisión. |
| Descarga | Selección incompleta, popup cerrado, reinicio, retry de fallidos y ninguna pista fuera de la selección congelada. |
| Accesibilidad | Foco desmontado/remontado, Space, Home/End, botón Cargar más, anuncios y error recuperable. |

La fixture de 50.000 debe verificar que el popup no contiene 50.000 objetos ni IDs. Insertar 50.000 registros en IndexedDB demuestra durabilidad, pero no basta: también hay que medir nodos, mensajes y heap retenido.

## Presupuestos y criterios de aceptación

Valores iniciales a validar en la Etapa 0:

- máximo 200 tracks completos en memoria por página de fuente;
- máximo 100 proyecciones por respuesta de ventana;
- máximo 5 ventanas en caché del popup;
- nodos de fila acotados a visible + overscan, objetivo menor de 32 en el layout actual;
- un solo fetch de página y hasta dos lecturas de ventana simultáneas por sesión;
- ningún mensaje de runtime mayor de 128 KiB en fixtures;
- abrir hace una página inicial y como máximo un prefetch, no recorre toda la colección;
- scroll que no cambia de ventana: cero IO y cero reconstrucción de filas;
- Select all/Clear all: O(1) escrituras respecto del tamaño de la colección;
- cerrar selector libera nodos, listeners, RAF y caché en memoria; el snapshot durable queda sujeto a TTL;
- 1k, 10k y 50k mantienen los mismos límites de popup/DOM/mensaje; sólo crece el almacenamiento de páginas realmente indexadas.

No fijar un objetivo de 60 FPS ni un límite absoluto de MB sin mediciones reproducibles. El cierre exige comparar p50/p95, tareas largas y heap retenido contra el baseline.

## Fuera de alcance

- No cambia el límite comercial FREE/PRO ni vuelve Pro la descarga bulk.
- No rediseña Likes Explorer ni comparte automáticamente su base de datos.
- No agrega búsqueda global al selector en esta entrega. Si se solicita, debe consultar un índice durable y no filtrar un array completo en el popup.
- No descarga 50.000 audios en un test de escala.
- No usa `public_likes_count` como límite de enumeración.
- No corrige memoria de decode/export de audio; es otro presupuesto y otro flujo.

## Checklist de cierre

- [ ] Decisiones de producto confirmadas.
- [ ] Baseline guardado con 1k/10k/50k.
- [ ] Sesión y ventanas durables implementadas.
- [ ] Popup progresivo y accesible implementado.
- [ ] Selección semántica sin listas completas implementada.
- [ ] Inicio de job por referencia/revisión implementado.
- [ ] Rutas `selectionList`/`selectionCache` retiradas de producción.
- [ ] Suite local y pruebas de navegador aprobadas.
- [ ] QA real de Likes/playlist/uploads registrado.
- [ ] Métricas posteriores comparadas con baseline.
- [ ] R2a/G2 y documentación de estado actualizados con evidencia.

