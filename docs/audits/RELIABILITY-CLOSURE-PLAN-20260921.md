# Plan de cierre de gaps de confiabilidad

Fecha: 21/09/2026. Base: `98ee64b` (`fix wav downloads`), posterior a `5ffbf01`.

## Estado de partida

El límite preventivo que rechazaba loops WAV de diez minutos queda mitigado en `98ee64b`: el cálculo inicial usa 48 kHz estéreo, valida el sample rate real del `AudioContext` antes de decode y conserva el rechazo preventivo para 96 kHz. La regresión de loop corto sobre un track de diez minutos está en `verify-loop-download.js`.

Este plan no vuelve a tocar ese cálculo salvo que mediciones reales demuestren que el presupuesto es inseguro. El error Chromium `Failed to build audio file` es distinto: `track-download-execution.js` reduce el error devuelto por offscreen a un mensaje genérico. Se debe diagnosticar antes de asumir que es memoria, HLS o un error de render.

Los fixes ya existentes que deben conservarse son: serialización de build (`MAX_IN_FLIGHT = 1`), guardado ambiguo sin fallback duplicado, renovación de fuente una vez, límites de HTTP/cuerpo/memoria, recuperación del job desde IndexedDB, cancelación de contexto viejo, retención de completados, contador durable de retries y estados accesibles.

## Orden de implementación

### P0 — Diagnosticar y cerrar el fallo offscreen de Chromium

Archivos: `offscreen.js`, `bulk-job-manager.js`, `track-download-execution.js`, `verify-download-browser.js`, `verify-offscreen-idempotency.js` y un nuevo verificador de ciclo de vida offscreen.

1. Añadir un `operationId` padre y `buildId` por intento a todos los mensajes build/progress/abort/save. Guardar una proyección mínima de estado: `created`, `sent`, `building`, `built`, `saving`, `saved`, `failed`, `aborted`.
2. Conservar `code`, `status`, `stage` y causa legible al pasar `offscreen -> manager -> popup`. No reemplazar una respuesta válida de error por `Failed to build audio file`.
3. Distinguir cuatro casos: worker no puede contactar offscreen, offscreen no cargó, build falló de forma terminal y respuesta se perdió después de iniciar un efecto. Cada caso debe tener una acción distinta.
4. Reproducir en Chromium con un fixture directo y otro HLS; capturar sólo IDs, etapa y error tipado, nunca URL firmada, cookie ni token.
5. Si el worker se reinicia, reconciliar la operación por ID antes de crear otro build. No relanzar un save ni otro build si el resultado podría existir.
6. Hacer explícita la política de cierre: no cerrar el documento offscreen mientras haya builds/saves con lease vigente; liberar el lease sólo al terminar o al confirmar aborto.

Aceptación: el E2E que hoy falla identifica su etapa y causa concreta; una respuesta perdida no duplica archivo; abort, reinicio del worker y build HLS fallido dejan mapas/listeners vacíos; el error visible contiene una recomendación accionable.

### P0 — Unificar toda descarga de colecciones bajo paginación durable

Archivos: `inline-button.js`, `popup.js`, `content.js`, `download-intent.js`, `page-intake.js`, `background.js`, `bulk-job-manager.js`, `bulk-library.js`.

1. Retirar la ruta de producción `inline-button -> resolveBulkTracks(null) -> START_BULK_JOB`. El inline debe iniciar el mismo `START_PAGED_BULK_JOB` que el popup, con límite All explícito.
2. Reemplazar `selectionList()` y `tracksByIds()` por un selector paginado. El content script entrega ventanas ordenadas de IDs/metadata ligera; IndexedDB conserva orden, selección y cursor. Nunca enviar una colección completa como un mensaje de runtime.
3. Agregar selección masiva semántica: `all`, `all except IDs`, `explicit IDs`. No crear un `Set` con decenas de miles de IDs para “Seleccionar todo”.
4. Mantener el orden original de playlist y el límite exacto para popup, inline y selección manual.
5. Eliminar o aislar `START_BULK_JOB` como compatibilidad versionada con tamaño máximo estricto y migración; no dejarlo como camino silencioso para colecciones grandes.

Aceptación: playlist/likes de 50.000 tracks inicia desde popup e inline sin array completo en content, popup o mensaje; seleccionar todo y deseleccionar tres pistas persiste tras cerrar popup/reiniciar worker; 50 tracks exactos y límites 1/25/50/51/All conservan orden y cantidad.

### P0 — Hacer la enumeración recuperable sin depender de la pestaña

Archivos: `bulk-job-manager.js`, `bulk-library.js`, `page-intake.js`, `download-source.js`, `soundcloud-http.js`, `background.js`.

1. Persistir un descriptor inmutable de fuente al crear el job: tipo de colección, usuario/playlist, cursor, formato fijado, página origen y contexto de autenticación no secreto. No persistir OAuth ni URL firmadas.
2. Mover la obtención de cada página desde `chrome.tabs.sendMessage(enumerationTabId, GET_BULK_PAGE)` al worker. El content script sólo descubre y valida el descriptor inicial.
3. Para playlists, persistir IDs ordenados paginados y completar parciales por lotes; para likes propias, obtener OAuth sólo dentro del worker y revalidar identidad antes de cada página autenticada.
4. Convertir `partial` en un estado recuperable con acciones concretas: reanudar desde cursor, reconectar una pestaña cuando sea indispensable, o descargar los tracks ya enumerados.
5. Invalidar por epoch resultados de página tardíos en pausa, cancelación, cambio de cuenta o nueva colección.

Aceptación: empezar una colección, cerrar/navegar la pestaña y reiniciar el worker conserva cursor, orden y conteos; no duplica páginas ni mezcla una colección nueva con la anterior; caída en página 3 mantiene páginas 1–2 y ofrece recuperación.

### P1 — Congelar formato y explicar cada pista ausente

Archivos: `stream-selector.js`, `download-track.js`, `page-intake.js`, `bulk-library.js`, `bulk-job-manager.js`, `popup.js`, locales.

1. Guardar `formatPreference` y política de fallback dentro del job antes de la primera página. `bulkPage()` no debe volver a leer `chrome.storage.local` para un job activo.
2. Resolver las entradas de playlist por campos requeridos (`media`, `downloadable`, stream), no sólo porque tengan título. Hidratar una vez entradas parciales antes de descartarlas.
3. Persistir estado de cada entrada: `saved`, `failed`, `ambiguous_save`, `skipped_format_unavailable`, `skipped_source_unavailable`, `skipped_preview`, `skipped_duplicate` o `restricted`.
4. Exponer en el snapshot y popup: enumeradas, elegibles, guardadas, fallidas, ambiguas y omitidas por causa. El total visible no puede ser sólo `eligible`.
5. Permitir una acción explícita “reintentar omitidas con Auto” sólo para `format_unavailable`; no sustituir silenciosamente el formato elegido.
6. Mostrar formato efectivo, original/fallback y preview antes de empezar; documentar que Auto tiene una política de calidad/compatibilidad definida.

Aceptación: fixture de 30 entradas con formatos heterogéneos, previews y metadatos parciales muestra 30 contabilizadas y explica las 10 no descargadas; cambiar el selector durante la enumeración no cambia los formatos del job; retry Auto afecta sólo las omitidas compatibles.

### P1 — Respetar reintentos y evitar operaciones duplicadas en UI

Archivos: `bulk-library.js`, `bulk-job-manager.js`, `popup.js`, `tempo-control-main.js`, `content.js`, locales y verificadores.

1. Exponer `retryAt`, `errorCode`, `stage` y `canResume` en el snapshot público.
2. No borrar `retryAt` en `resumeJob()` antes de que venza. Si el usuario pulsa reanudar temprano, mantener pausa y mostrar la hora/espera restante; programar reanudación cuando corresponda.
3. Diferenciar pausa manual de pausa por rate limit/red. La pausa manual puede reanudarse inmediatamente; la otra debe respetar el proveedor.
4. Sustituir el timeout de 120 s del export del player por una consulta de operación. Al vencer la espera de UI, conservar el mismo ID, presentar “sigue procesando” y permitir reconexión; no liberar el botón para crear un segundo export ciego.
5. Probar cancelación durante Retry-After, suspensión de worker, respuesta tardía y clic repetido.

Aceptación: un 429 con `Retry-After: 60` no hace request antes de 60 s; al volver a abrir popup aparece el contador correcto; una exportación larga termina en un único save o estado ambiguo, nunca dos builds por timeout visual.

### P1 — Audio, HLS y memoria en dispositivos modestos

Archivos: `download-core.js`, `loop-audio-renderer.js`, `tempo-control-main.js`, `audio-effects-core.js`, verificadores y fixtures HLS.

1. Mantener el cambio WAV de `98ee64b` y ampliar su matriz: 3/10/30 minutos, 44,1/48/96 kHz, mono/estéreo, loop corto/largo, velocidades 0,5×/1×/1,5×/3× y Preserve Pitch.
2. Medir RSS/heap, tiempo y cancelación en ChromeOS para directo, HLS, bulk, loop y track transformado. Si falta duración antes de decode, aplicar un límite conservador y una explicación clara.
3. Añadir fixtures HLS para master/media, init map, 401/403/429/503, body cortado, abort, playlist circular, byte range y cifrado. Rechazar características no soportadas con código específico antes de producir un archivo dañado.
4. Confirmar que el primer fallo cancela y drena todos los workers de segmentos antes de renovar fuente; no iniciar otro build mientras queden fetches del anterior.
5. Verificar fidelidad: duración, frecuencia/tono, canales, discontinuidades y pico/clipping del WAV. Diferenciar en UI descarga normal, export transformado, velocidad, Keep Tone y el hecho de que los FX en vivo no se exportan hoy.

Aceptación: ningún caso excede presupuesto sin error tipado; cancelar libera recursos; 96 kHz se rechaza antes de decode; la prueba de tono no cambia frecuencia con Preserve Pitch; no hay solapamiento de builders tras un fallo HLS.

### P2 — Diagnóstico, confianza y entrega verificable

Archivos: `services/uninstall-feedback`, `popup.html`, `popup.js`, locales, README, TESTING, empaquetador y nuevos smoke tests.

1. Agregar diagnóstico voluntario y mínimo por fallo: versión, commit/build, etapa, código, formato pedido/efectivo, modo normal/transformado, tipo de dispositivo opcional y conteos. No recolectar títulos, URLs firmadas, cookie ni token.
2. Mantener el formulario de uninstall como señal cualitativa; no usarlo como tasa sin instalaciones/desinstalaciones por versión y fecha.
3. Explicar el permiso de cookies y su uso exclusivamente hacia SoundCloud en onboarding/Store. Evaluar permiso opcional en un cambio separado con migración y pruebas.
4. Actualizar README: ya no afirmar dos tracks simultáneos, estado sólo en `storage.session` ni cierre seguro de pestaña antes de terminar P0 de enumeración.
5. Crear el ZIP sólo tras pruebas, guardar SHA-256, versión, commit y fecha de Store. Probar el ZIP extraído, no sólo el árbol fuente. Confirmar que el empaquetador elimina el login de test y que el ZIP no incluye datos privados.

Aceptación: un reporte permite identificar etapa y build sin secreto; el ZIP probado coincide con el publicado; smoke tests incluyen MP3, M4A/HLS, carpeta, sesión autorizada y ruta de recovery.

## Secuencia de entrega

1. P0 offscreen: primero reproducción y tipado; después arreglo mínimo, test de regresión y Chromium.
2. P0 bulk: migrar inline/manual a páginas persistidas y mover enumeración al worker en el mismo contrato. No publicar una ruta nueva y mantener otra sin límites.
3. P1 formato/retry: contar omitidas, congelar contrato del job y respetar `retryAt`.
4. P1 audio: fixtures y medición ChromeOS; el fix de diez minutos queda como regresión permanente.
5. P2 diagnóstico/packaging y después release gate.

No combinar estos bloques con rediseños de UI, cambios de precio o migraciones de Player Tools. Cada bloque debe tener pruebas unitarias, integración manager + IndexedDB + mensajes y, cuando toque navegador, Chromium real. Las descargas públicas permanecen gratuitas e independientes de licencia Pro.
