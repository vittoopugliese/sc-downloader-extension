# Plan técnico de mitigación de confiabilidad

> **PARCIAL; diagnóstico inicial histórico — revisión 24/09/2026 (`29d7946`).** M1–M8 de este plan no son M01–M18 del 23/09. Gran parte de operaciones/HTTP/almacenamiento ya está implementada. No cerrar benchmark, ChromeOS, integración real ni escala manual por tests sintéticos. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Fecha: 2026-09-20. Repositorio: `sc-downloader-extension`.

## 1. Para quién es y qué evidencia existe

Este documento permite que otro agente corrija **todos los problemas pendientes señalados en la auditoría posterior** a la primera implementación. Complementa [RELIABILITY-IMPLEMENTATION-HANDOFF-20260920.md](./RELIABILITY-IMPLEMENTATION-HANDOFF-20260920.md), que describe el diagnóstico inicial y contiene referencias históricas al código anterior. Al iniciar, leer este plan y comprobar de nuevo las rutas y números de línea: la referencia observada al redactarlo es `HEAD ccc6239` (`main`). `origin/main` local apunta a `f902720`; no se hizo `fetch`. La única modificación local observada era `scripts/fast-tooltips.js`; preservarla y volver a consultar `git status` antes de editar.

La implementación actual sí corrigió el valor predeterminado del selector para exactamente 50 pistas, dejó de devolver `oauthToken` en `GET_LOGGED_IN_USER`, validó los destinos de peticiones autenticadas, añadió estados de error, drenó trabajadores HLS después de un fallo y publicó páginas intermedias de Explorer. `npm test` pasó 40 verificaciones y `git diff --check` pasó durante la auditoría. Las pruebas previas de Chromium cargaron la extensión desde el árbol fuente y usaron audio/red sintéticos. No prueban una descarga pública live, el ZIP final ni consumo de memoria en ChromeOS. El script `verify-bulk-limit-browser.js` comprueba opciones/valor predeterminado, pero no pulsa All ni comprueba la paginación hasta su fin.

**Objetivo verificable:** cada operación debe acabar en éxito confirmado, cancelación o error accionable; no debe duplicar archivos al perder una respuesta, leer cuerpos sin límite, confundir falta de sesión con fallo de red, truncar All como éxito ni dañar otras colecciones al borrar datos. No prometer que se puede evitar todo fallo externo de SoundCloud, Chrome o disco.

### Mapa de trabajo

| Unidad | Prioridad | Problema y relación con el handoff | Bloquea release de confiabilidad |
| --- | --- | --- | --- |
| M1 | P0 | Guardado repetible/ambiguo y reinicio del worker; T06/T08 | Sí |
| M2 | P0 | Cuerpos y portadas materializados antes del límite; T04/T07 | Sí |
| M3 | P1 | HTTP, timeout y códigos de error fuera de `download-core`; T02/T04 | Sí, si quedan rutas con loading indefinido |
| M4 | P1 | Bulk sin checkpoint durable, escala o All completo; T01/T09 | Sí, para anunciar bulk confiable |
| M5 | P1 | Borrado, migración y carreras de Explorer; T10/T11 | Sí, para anunciar Explorer estable |
| M6 | P1 | Consultas/status de Explorer siguen cargando datos de más; T12 | Sí, para escala de 10k–50k |
| M7 | P1 | Cancelación, cola y vida de offscreen; T05/T08 | Sí |
| M8 | P1 | Cobertura HLS, seguridad residual y artefacto de release; T03/T05/T14 | Sí |

Priorizar M1/M2, después M3/M4, luego M5/M6/M7 y cerrar con M8. Las dependencias son reales: las pruebas de reinicio/guardado de M1 necesitan el estado durable de M4; la prueba del ZIP debe usar el código final. Se puede implementar por cambios pequeños, pero no declarar completado un punto porque pasen pruebas que sólo simulan su resultado.

## 2. M1 — Guardado repetible y estado ambiguo tras reinicio

### Falla actual

`scripts/bulk-job-manager.js` reintenta `sendOffscreenMessage(message, 12)` cuando el canal devuelve error o respuesta `undefined`. `scripts/download-destination.js` manda `OFFSCREEN_SAVE_TO_DIRECTORY` con `blobUrl`, nombre y directorio, sin identificador de guardado. `scripts/offscreen.js` ejecuta `SCDownloadDirectory.saveBlob` cada vez que recibe el mensaje. Si el archivo ya se escribió pero se perdió la respuesta, el reenvío puede escribir otra copia. Para `OFFSCREEN_BUILD`, el segundo mensaje recibe `invalid_build` mientras el primero continúa; si el primero responde tras perder el canal, su blob puede quedar huérfano. `processTrack` marca `done` después de `saveOutput`; una terminación del worker entre ambos pasos deja un guardado sin checkpoint. `recoverRunningJob` puede volver a procesarlo. Un nombre con `conflictAction: "uniquify"` no ofrece semántica de guardado único.

### Contrato de operación que hay que implementar

1. Crear un `operationId` estable por pista/job y un `buildAttemptId` distinto por renovación. Pasarlos desde `track-download-execution` hasta `download-destination` y offscreen. Para bulk, derivar el ID del `jobId` y el índice; para single/loop, crear un ID antes de admitir el trabajo. No usar sólo `Date.now()` como clave durable.
2. Separar etapas `queued`, `resolving`, `building`, `built`, `saving`, `saved`, `done`, `failed`, `cancelled`, `interrupted` y `ambiguous_save`. Registrar en almacenamiento durable los hitos suficientes para reconciliar: `operationId`, destino de categoría, `downloadId` si Chrome lo devolvió, nombre final, estado, timestamps y un identificador de blob temporal cuando exista. No persistir cookie, OAuth ni URL de audio.
3. En offscreen, mantener un registro por ID: un duplicado de build en curso se une a la misma promesa; un duplicado ya terminado devuelve el mismo resultado mientras el blob siga vivo. Un duplicado con el mismo ID y payload distinto se rechaza. Limitar vida/memoria del resultado cacheado y revocar el blob cuando el consumidor confirme o expire. Para directorio, el duplicado debe devolver el resultado anterior sin escribir de nuevo mientras el documento siga vivo.
4. No aplicar reintentos genéricos a órdenes con efectos. Si se pierde la respuesta de save y no hay forma de reconciliarla, marcar `ambiguous_save` y pedir intervención explícita; **no volver a guardar automáticamente**. Un registro persistido después de escribir no elimina por sí solo la ventana de caída entre escritura y checkpoint; documentar esa limitación.
5. En `chrome.downloads`, conservar `downloadId` tan pronto como Chrome lo confirme y reconciliar con `downloads.search` tras reinicio; no llamar otra vez a `downloads.download` para ese ID. En directorio, decidir un protocolo concreto de reconciliación por nombre/handle/tamaño o estado ambiguo. No inferir que un archivo de igual nombre es el mismo sin prueba suficiente.
6. Hacer que una falla de `OFFSCREEN_REVOKE` sea cleanup de mejor esfuerzo después de guardar. El resultado de `saveOutput` manda: no convertir éxito confirmado en error que active otro save. Asegurar que `recordTrackSuccess` sea idempotente.

### Pruebas que deben fallar antes y pasar después

- Simular respuesta perdida después de que `saveBlob` resolvió. Contar escrituras: exactamente una; si se reinicia offscreen durante la ventana no reconciliable, estado `ambiguous_save` y cero reintentos automáticos.
- Dos mensajes `OFFSCREEN_BUILD` con mismo ID mientras el primero está pendiente: un solo builder y resultado compartido; mismo ID con otro payload: rechazo.
- Reiniciar worker después de `chrome.downloads.download` y antes de `complete`, después de `complete` y antes de `done`, y en `saving` de directorio. Reconciliar o marcar ambiguo sin crear otro archivo.
- Save correcto seguido de fallo de revoke; resultado sigue siendo éxito, una sola transformación y un solo archivo.

**Aceptación:** ningún test de respuesta perdida produce dos archivos; cada estado incierto queda visible como incierto y requiere acción informada. No prometer *exactly once* donde la API y los checkpoints no lo permiten.

## 3. M2 — Límite de memoria antes de reservar memoria

### Falla actual

En `scripts/download-core.js`, `fetchWithRetry` compara `Content-Length` con el límite, pero si el header falta o miente llama `response.arrayBuffer()`/`response.text()` y sólo después calcula el tamaño. Un servidor puede hacer que el navegador materialice un body enorme antes de `memory_budget_exceeded`. `fetchCoverBuffer` no tiene límite propio. HLS retiene segmentos, los concatena y después puede generar copias, PCM, WAV, metadata y Blob. El límite de 128 MiB de audio y el de PCM decodificado no son un techo total de proceso. `encodeWavSegment` reserva `44 + dataLength` sin comprobar ese valor contra un presupuesto común.

### Implementación

1. Crear un lector acotado compartido para `Response.body.getReader()` en `download-core` y las peticiones JSON/HTML que lo necesiten. Contar **bytes recibidos antes de concatenar**, comprobar cada chunk y cancelar el reader/body al exceder el límite. Si `Content-Length` existe, rechazar anticipadamente; si no, el límite sigue aplicándose. Mantener el timeout y el `AbortSignal` activos hasta terminar o cancelar la lectura. En un entorno sin stream, usar un fallback acotado demostrado o terminar con error; no regresar a `arrayBuffer()` sin límite.
2. Definir límites separados y documentados por tipo: playlist (hoy 2 MiB), JSON, HTML de hidratación, bundle usado para `client_id`, portada (proponer 5 MiB y ajustar con fixtures), segmento y audio total (hoy 128 MiB). Para HLS, contar bytes agregados de segmentos **durante** la descarga concurrente; no esperar a `combineChunks`. Probar que el contador compartido no permite que cuatro workers excedan juntos el presupuesto.
3. Rechazar `Content-Length` inválido de forma segura y no fiarse de él como única comprobación. Evitar `TextEncoder().encode(text)` sólo para medir un body ya cargado. Los errores de tamaño no deben reintentarse como red transitoria.
4. Antes de decode/render/WAV, estimar memoria coexistente de comprimido, copia de entrada, PCM decodificado, salida, WAV, portada y metadata. Comprobar dimensiones con enteros seguros, sample rate y canales reales. Mantener la comprobación del renderer a 1× y tasas distintas; añadir límite antes de `encodeWavSegment` y antes del buffer final de metadata.
5. Liberar referencias y cerrar `AudioContext` en todos los caminos, incluso decode fallido o abort. Si el trabajo de decode/OfflineAudioContext no puede cancelarse en esa etapa, impedir iniciar operaciones que exceden el presupuesto y reflejar correctamente una cancelación tardía.

### Pruebas

- Respuesta sin `Content-Length` que entrega chunks hasta pasar el límite: se cancela antes de reservar un body completo; número de bytes aceptados acotado. Repetir con header falso, portada grande, playlist grande y body infinito.
- HLS con cuatro segmentos pendientes que juntos superan el límite; comprobar aborto/drenaje y que no se llama a concat ni save.
- Objetos sintéticos que representan pistas 5/30/60 minutos y loops cortos sobre entrada larga, a 0,5× y 1×, sin reservar GiB en test. Browser: veinte trabajos sucesivos y medidas de heap/RSS cuando haya entorno apropiado.
- Confirmar que un audio pequeño sigue siendo reproducible, con extensión/MIME correctos, después de etiquetado y HLS.

**Aceptación:** todos los cuerpos no confiables se rechazan durante lectura, antes de superar su presupuesto; error `memory_budget_exceeded` coherente y sin retry. La medición ChromeOS sigue siendo necesaria para afirmar resistencia a congelamientos en ese dispositivo.

## 4. M3 — HTTP, timeout y error correcto en todas las rutas

### Falla actual

`page-intake.js:124` cancela el temporizador al llegar los headers; `response.text()` en extracción, bundles y resolve queda fuera del timeout. `extractCurrent` también hace `fetch` y `text()` sin timeout. `soundcloud-http.js` y `soundcloud-likes-source.js` leen JSON completo sin el mismo presupuesto que `download-core`. `userTracksPage` acorta `Retry-After` a 10 segundos. En `/you/likes`, `loggedInOrHydratedUser` transforma `unknown_error` de `/me` en `auth_required`; una caída de red o respuesta inválida puede parecer logout. Los `POST` de commerce requieren timeout, pero no retry automático sin contrato de idempotencia.

### Implementación

1. Extraer una política HTTP pequeña compatible con content, worker y offscreen: timeout desde antes de `fetch` hasta terminar body, límite de bytes, abort externo, redirección prohibida para API autenticada, clasificación tipada y cleanup de timers/listeners. Para respuestas JSON, parsear después de leer bytes acotados; un JSON inválido debe ser `invalid_response`, no `auth_required`.
2. Definir `Retry-After` por segundos y fecha HTTP. Si excede el presupuesto interactivo, devolver `rate_limited` con `retryAt` o pausar un job con checkpoint; nunca reintentar antes de la fecha. Usar reloj/espera inyectables. Reintentar GET transitorios (`408`, `425`, `429`, `500`, `502`, `503`, `504`, fallo de red y lectura cortada) con límite de intentos y tiempo total. No reintentar `401/403/404`, cancelación voluntaria, tamaño excedido o JSON inválido por defecto.
3. Cambiar `getOAuthToken`/`resolveLoggedInUser` para producir `auth_required` sólo con cookie ausente o rechazo de autenticación verificable. Clasificar TypeError/red como `network_error`, timeout como `network_timeout`, `429` como `rate_limited` y `5xx` como `service_unavailable`. Proyectar esos códigos sin exponer token en mensajes. En el popup, mostrar retry sólo cuando el error sea recuperable.
4. Asociar toda extracción a generación de navegación y señal de aborto. Al navegar o cambiar la cookie, invalidar la generación, limpiar `bulkContext`/`selectionCache` y descartar respuestas tardías. Evitar que un resultado de `/me` anterior se publique después del cambio de cuenta.
5. Para checkout/licencia/eventos, imponer timeout por request y hacer analytics de mejor esfuerzo; no repetir `POST` automáticamente hasta probar un idempotency key con el servidor.

### Pruebas

- Headers que llegan y body que nunca termina: `network_timeout`, no spinner indefinido. Repetir en HTML de hidratación, bundle, JSON de likes, resolver y CDN.
- `/me`: cookie ausente → `auth_required`; DNS/fetch rechazado → `network_error`; `429` → `rate_limited`; `500` → `service_unavailable`; JSON corrupto → `invalid_response`; `401` → `auth_required`.
- `Retry-After: 60` y fecha futura: cero reintentos antes de `retryAt`. Aborto durante espera limpia timers y no emite request adicional.
- Navegación SPA y cambio de cuenta mientras llega una página: no se muestran ni guardan datos de la generación anterior.

**Aceptación:** todo request que afecta una operación tiene tiempo y bytes máximos; el código que ve el usuario corresponde a la causa comprobada.

## 5. M4 — Bulk All completo, durable y acotado

### Falla actual

`page-intake.resolveBulk` y `selectionList` acumulan todas las pistas en arrays dentro del content script. La selección devuelve toda la lista en un mensaje. `START_BULK_JOB` pasa todas las pistas al worker; `bulk-job-manager.createJob` guarda `tracks` y `trackStatus` completos en `chrome.storage.session` y `saveJob` reescribe ese objeto tras cada progreso. Esto escala mal y carece de checkpoint de página. La preview de hasta 50 pistas y `public_likes_count` no equivalen al fin real de la colección. Un cursor repetido falla ahora, pero no queda un progreso durable recuperable. El test actual del selector no verifica el click de All ni las páginas siguientes.

### Diseño propuesto

1. Introducir almacenamiento IndexedDB propio para bulk gratuito, separado de la licencia/Explorer Pro. Guardar registros compactos por `jobId`, índice y track; checkpoint por página con cursor normalizado, cuenta/epoch de sesión, sourceUserId, ruta, opción `all`/límite/selección, `enumerated`, `eligible`, `skipped` por motivo y `nextCursor`. `storage.session` contendrá sólo resumen de UI e ID activo. Definir cuota/política de limpieza para jobs finalizados; no borrar un job en curso.
2. Mover la enumeración grande al worker con mensajes de control/páginas; no devolver 50.000 tracks al content/popup. Mantener una ruta pública gratis que no dependa de Pro. El content puede aportar contexto inicial de la página; el worker confirma identidad y cursor antes de avanzar. Para playlist hidratada, transferir entradas en lotes acotados si no hay endpoint de paginación equivalente.
3. Cada página se confirma transaccionalmente con las pistas deduplicadas y el siguiente cursor; una caída reanuda desde el último checkpoint, sin reiniciar desde página 1 ni contar dos veces. Una página vacía con `next_href` continúa o termina con error explícito según contrato; un cursor repetido/inválido marca parcial, no éxito. Distinguir playlists, pistas no disponibles y duplicados en contadores.
4. `All` termina sólo cuando la API indica fin. El contador de metadata se usa como estimación para UI/confirmación, no como límite. Si se pidió `N`, detener al reunir `N` pistas elegibles según la semántica definida; mostrar `enumerated`, `selected`, `skipped`, `saved`, `failed` y `remaining` sin equiparar total público con descargables.
5. Paginar/virtualizar la selección manual con mensajes `offset/limit` y una revisión de colección. Guardar IDs seleccionados o rangos por job sin materializar todo en el popup. Invalidar selección cuando cuenta, fuente o generación cambien. Incorporar `operationId` y `AbortController` para cancelar enumeración incluso si el popup cierra o la navegación SPA cambia.
6. Sustituir `completed` cuando hay fallidos por `completed_with_errors` o un resumen equivalente que la UI y retry reconozcan. Reintentar sólo índices fallidos; respetar los checkpoints de guardado de M1. Migrar una vez jobs existentes de `storage.session` sin descargar de nuevo estados `done` y sin perder un job activo.

### Pruebas de aceptación

- Popup real: 0, 1, 25, 26, 49, 50, 51, 200 y 1.000; para 50, click efectivo; para All, páginas sintéticas hasta `next_href=null`, sin recortar por metadata. Comparar IDs ordenados recibidos con IDs esperados.
- Enumeración paginada de 1k/10k/50k con IndexedDB real, duplicados, playlists, privados/inaccesibles y cursor cíclico; medir bytes, tiempo, tamaño de mensajes y número de escrituras. No descargar 50.000 audios.
- Reinicio entre páginas, `429` con `retryAt`, cancel durante espera, cambio de cookie en página 2, popup cerrado y navegación SPA. El estado final refleja parcial/fallidos sin éxito engañoso.

**Aceptación:** All llega al fin real o declara parcial; carga/mensajes y almacenamiento crecen de forma controlada; ningún estado guardado requiere reescribir 50.000 objetos en cada progreso.

## 6. M5 — Integridad de Explorer: borrado, migración y carreras

### Falla actual

`likes-library.eraseCollection(imagesOnly=true)` borra `accountArtwork` y **todos** los `collectionArtworkJobs` de la cuenta, porque el predicado usa `imagesOnly || collectionId`. El borrado completo no elimina `tracks` ni artwork sin referencias. `ensureLegacyMigrated` marca una migración completa sin trasladar `collectionJobs`, y una segunda apertura puede observar estado viejo antes de entrar a la transacción. `collectionArtworkTick` escribe después de fetch asincrónico sin volver a validar sesión/cuenta y la generación de colección; el spread `...old` de `START_LIKES_ARTWORK` puede restaurar la generación anterior. El catch de `collectionTick` puede pausar un job nuevo al leerlo tras fallar uno viejo.

### Implementación

1. Definir la semántica visible de “borrar portadas”: si la acción se presenta para una colección, borrar sólo su job y hacer garbage collection de blobs que ninguna colección de esa cuenta referencia. Si se desea acción global, renombrarla claramente en UI y probarla como global. La clave `accountArtwork` es compartida por cuenta; no borrarla sólo por pertenecer a la colección seleccionada.
2. En borrado de colección, incrementar/inutilizar `epoch` de jobs de índice/artwork **antes** de eliminar. En una transacción, borrar colección, entradas, cursores, vistas/bookmarks y jobs de esa colección; luego eliminar `tracks`/`accountArtwork` sólo cuando no existan referencias desde ninguna generación retenida ni biblioteca legacy utilizable. Separar cleanup por lotes si la transacción sería demasiado grande, con checkpoint de GC idempotente.
3. En cada commit después de un `await` de red/artwork, comparar `jobId`, `epoch`, `generation`, identidad/`sessionEpoch` y fase actual dentro de la transacción. El catch sólo modifica el job que falló si esos campos aún coinciden; no pausar una generación nueva.
4. Al iniciar artwork, decidir explícitamente si se reanuda o reinicia. Construir el nuevo registro con la generación actual después del spread de `old`; nunca dejar que `...old` reemplace `generation`, `offset` o `epoch` elegidos. Durante refresh, preservar artwork de la generación visible hasta que la nueva sea activa; reubicar el job y limpiar referencias antiguas al completar.
5. Migrar v1→v2 con marcador transaccional revalidado al entrar, incluyendo job/checkpoint incompleto o pausado. Conservar v1 hasta comprobar v2; si falla por cuota, dejar v1 utilizable y permitir reintento. Manejar `versionchange` cerrando conexiones antiguas y `blocked`/error de apertura con estado visible; no reutilizar una promesa resuelta con DB cerrada.

### Pruebas

- Dos cuentas y dos colecciones por cuenta, con tracks/portadas compartidos y exclusivos. Borrar una conserva la otra; borrar la última libera datos sin referencias. Borrar sólo portadas no borra ninguna pista.
- v1 completa, parcial y pausada; migración repetida, dos aperturas concurrentes y fallo de cuota inyectado. Verificar que no desaparece la biblioteca antigua al fallar.
- Cambiar cuenta y borrar/refrescar durante fetch de página o portada; inyectar fallo de generación vieja después de crear la nueva. Ninguna respuesta tardía escribe, pausa o resucita datos nuevos.
- Tres páginas reales en IDB: 50→100→150 visibles; refresh mantiene snapshot anterior hasta commit final; borrar durante refresh no repuebla.

**Aceptación:** aislamiento por cuenta/colección y migración repetible demostrados en IndexedDB real, no sólo por fixtures de mensajes.

## 7. M6 — Coste real de status, búsqueda y artwork de Explorer

### Falla actual

`likes-library.window` ya busca desde el ordinal solicitado, pero `storageStats` sigue recorriendo todos los registros y usa `getAll` de artwork para calcular percentiles; eso carga Blobs en un poll de status. `likes-jobs` llama `storageStats` en `GET_LIKES_LIBRARY_STATUS`, y las consultas filtradas pueden reconstruir toda la colección en memoria. La virtualización DOM no limita por sí sola el coste de IndexedDB o del worker.

### Implementación

1. Mantener contadores/bytes de metadata y artwork al escribir/borrar en registros de estadísticas por cuenta/colección/generación, o calcularlos sólo bajo acción explícita. El status frecuente debe leer un resumen pequeño. Para percentiles, guardar sólo tamaños numéricos o calcular bajo demanda con cursor de metadata; nunca `getAll` de objetos que contienen Blob.
2. Acotar cachés por **bytes y entradas**, con invalidación por cuenta, colección, generación y revisión. Para búsqueda/periodos, usar índice o barrido paginado con progreso/cancelación; no construir un array global en cada poll. Invalidar tras cambio de cuenta/borrado/refresh.
3. Medir número de cursores visitados, bytes transferidos y tiempos de status/ventana inicio/medio/fin/búsqueda. Usar IndexedDB real con 1k, 10k y 50k; establecer umbrales a partir de la medición base antes de escoger estructura de índice.

**Aceptación:** costo de ventana proporcional al tamaño solicitado, status sin cargar blobs y memoria de caché con techo comprobado. Documentar mediciones antes/después y equipo/Chrome usados.

## 8. M7 — Cancelación, cola y vida de offscreen

### Falla actual

La cola de singles/loops está en memoria y no tiene admisión acotada ni cancelación por ID. `cancelJob` envía `abortAll` y puede cerrar offscreen sin esperar a que el build activo termine de drenar y limpiar. `closeOffscreenDocument` y `ensureOffscreenDocument` no comparten lease/generación; un trabajo nuevo puede adquirir el documento mientras otro lo cierra. `runtime.getContexts` se invoca sin fallback o versión mínima declarada.

### Implementación

1. Un scheduler para admisión de single/loop/bulk/retry con ID, máximo de cola documentado, FIFO y estados/posición observables. Conservar la regla de exclusión entre bulk y single si se elige esa política, pero responder `busy`/`paused_bulk` claramente. Dar cancelación por ID en queued y activa.
2. Hacer que `abortBuild` devuelva o permita esperar una confirmación de finalización real. `cancelJob` marca intención de cancelación, aborta, espera drenaje dentro de presupuesto y sólo entonces libera el lease y cierra offscreen. Si no se puede confirmar, marcar `interrupted`/ambiguo y no lanzar trabajo nuevo sobre recursos inciertos.
3. Serializar create/acquire/release/close del documento con mutex o promesa única y contador de leases. Cerrar sólo cuando leases=0 y la generación sigue siendo la que solicitó cierre. Ningún callback tardío de un build puede borrar el controller o progreso de otro intento.
4. Incorporar presupuestos por etapa para que una promesa colgada no bloquee toda la cola. Tras suspensión del worker, reconstruir estados y reconciliar M1 antes de admitir nuevo trabajo. Establecer `minimum_chrome_version` según `runtime.getContexts` o fallback probado.

### Pruebas

- Dos singles, single+loop, bulk+single, retry bulk+single, cola llena, cancelar queued/activo, offscreen que falla al iniciar y siguiente job exitoso.
- Cierre iniciado mientras otro trabajo adquiere lease; máximo un builder activo para entradas válidas y ningún cierre durante build/save.
- HLS abort/fallo con cuatro workers pendientes: cero requests nuevos tras error; al liberar lease, todos están drenados.
- Reinicio del worker en cada etapa y test de API `getContexts` ausente o Chrome mínimo seleccionado.

**Aceptación:** no hay cola invisible sin límite, solapamiento de builders ni cierre de offscreen aún adquirido.

## 9. M8 — HLS, frontera de seguridad y prueba del artefacto

### Falla/cobertura pendiente

El drenaje de segmentos tras un error y los IDs por intento mejoraron, pero el parser HLS elige la primera variante y no demuestra todos los casos de `EXT-X-MAP`, variantes, cifrado, byte ranges y archivos resultantes reproducibles. `download-source` valida URL de resolver antes de adjuntar OAuth, pero la URL de medio devuelta por el resolver aún necesita inventario/validación separada sin token. El paquete existente en `dist` no representa automáticamente el código actual; `package-extension.js` escribe un ZIP de nombre basado en versión y el test browser principal carga `root` fuente. `manifest.json`/`package.json` aún muestran `2026.9.20`.

### Implementación y gate

1. Crear fixtures HLS de master/media, mapas de inicialización, varias variantes, ciclo, segmentos 403/503, body cortado, byte ranges y cifrado. Para cada característica, soportarla con prueba de audio reproducible o rechazarla antes de guardar con `unsupported_hls`. Confirmar protocolo/preset/MIME al renovar progressive→HLS y original→transcode.
2. Inventariar URLs **reales permitidas** de resolver y CDN con muestras públicas controladas, sin sesión personal. Validar host/protocolo/ruta de resolver antes de OAuth y bloquear redirects externos; no enviar OAuth a CDN. Validar la URL de audio sin crear una allowlist imaginaria que rompa presets legítimos. Añadir pruebas con host engañoso, userinfo, `http:`, redirect y token centinela; verificar ausencia del centinela en respuestas al content, storage, logs y tráfico de commerce.
3. Dar al build corregido una versión única y preparar ZIP en staging sin sobrescribir el artefacto anterior hasta registrar su hash. Fallar packaging si `TEST_LOGIN` permanece activo. Comparar allowlist/recursos de JS y PowerShell y verificar que cada referencia de manifest/HTML/imports/WASM/assets existe.
4. Extraer **ese** ZIP y cargarlo como raíz de extensión en un perfil aislado. Adaptar harness para no depender de `index.html` o scripts de test omitidos del paquete. Probar single, bulk gratuito, offscreen, directorio y fallback, login de test desactivado y Pro con fixture que no se distribuya. Registrar hash SHA-256, versión y commit del artefacto que efectivamente pasó.
5. Ejecutar por separado una descarga pública MP3/HLS live de control, sin tocar cuenta real ni POST de negocio/analytics, y una medición ChromeOS representativa si se quiere afirmar solución para ese entorno. Registrar que son evidencias distintas de fixtures sintéticos. Publicación en CWS o despliegue del sitio requieren autorización posterior.

**Aceptación:** no se guarda salida HLS aparente si el input requiere una función no soportada; el token centinela nunca llega a destino ajeno; el ZIP extraído, no sólo el source, pasa smoke y tiene hash/version trazables.

## 10. Orden de implementación y evidencia mínima por entrega

1. **Preparación:** `git status --porcelain=v2`, `git diff --cached`, `git log -5`, `git diff --check`; preservar `fast-tooltips.js` u otros cambios ajenos. Anotar commit/versión de inicio. Convertir cada hallazgo en un test que falla antes, salvo tareas de medición donde corresponde registrar baseline.
2. **Guardar una sola vez:** M1 junto con el drenaje/lease mínimo de M7. Primero evitar reenvío de efectos sin dedupe; luego checkpoint/reconciliación. No migrar bulk grande antes de definir el ID de operación.
3. **Acotar red/memoria:** M2 y M3 con un helper de lectura/política compartido, cambios por contexto. Verificar audio simple, HLS y loops tras cada cambio.
4. **Bulk durable:** M4, usando los IDs y estados de M1. Mantener gratis y soportar jobs viejos. Ejecutar pruebas reales de IndexedDB y browser click-through.
5. **Explorer:** M5, después M6. Primero integridad y GC, luego optimización medida; no optimizar consultas sobre datos que todavía pueden quedar huérfanos o resucitar.
6. **Release candidate:** M8, regresiones completas y artefacto extraído. Publicar sólo con decisión explícita y evidencia final.

Para cada unidad entregar: causa reproducida o razón para descartarla, archivos y contrato cambiados, prueba que fallaba y ahora pasa, pruebas de regresión, riesgos restantes y evidencia source/browser/ZIP/live claramente etiquetada. Comandos base: `npm test`, `npm run test:e2e:download`, `npm run test:e2e:popup`, `npm run test:e2e:likes`, `npm run test:e2e:tempo`, `npm run test:e2e:effects` y `git diff --check`. Ejecutar tests ampliados sólo cuando cubran una condición concreta de aceptación. Los tests de Chromium con fixtures no sustituyen live/ZIP/ChromeOS.

### Criterio final de cierre

No quedan operaciones que puedan duplicar save tras respuesta perdida o reinicio; los cuerpos y la memoria de trabajo se acotan antes de la reserva peligrosa; todas las rutas relevantes terminan con código correcto; bulk All enumera hasta fin o marca parcial y puede reanudar; Explorer conserva datos compartidos, migra sin pérdida y tiene status acotado; cancelar espera drenaje; el ZIP final probado coincide con hash, versión y commit. Si alguna capacidad depende de ChromeOS, red live, sesión privada o un estado ambiguo de filesystem que no pudo observarse, declararla explícitamente en el reporte de entrega y no presentarla como garantía ya demostrada.
