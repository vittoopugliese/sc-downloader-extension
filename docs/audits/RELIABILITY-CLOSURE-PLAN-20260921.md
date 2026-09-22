# Plan maestro de confiabilidad y cierre de issues

Creado: 21/09/2026. Actualizado: 22/09/2026. Base actual verificada: `4a9ffba` (árbol limpio al iniciar la revisión). Base original: `98ee64b` (`fix wav downloads`).

Este documento consolida [la auditoría de código](CODEBASE-AUDIT-20260921.md), [el análisis de feedback](FEEDBACK-FIX-PLAN-20260921.md) y el plan de cierre original. Es el plan vigente para los issues identificados en esas fuentes; no certifica ausencia de defectos desconocidos. Esta actualización modifica documentación, no implementa los pendientes. Los informes anteriores conservan su valor histórico, pero sus hallazgos deben interpretarse según la matriz actual de abajo.

## Estado real de los cinco hallazgos de la auditoría

La auditoría corresponde a `404fbd9`. Sus cinco correcciones llegaron antes de `5ffbf01`; no deben registrarse como cinco bugs intactos en HEAD. Los commits recientes de pads/EQ no equivalen a implementar el resto del plan de reliability.

| Issue original | Evidencia actual y commit correctivo | Estado y cierre restante |
| --- | --- | --- |
| A1. Pérdida del puntero de sesión oculta el job | `f468a7c`: `loadJob()` consulta `SCBulkLibrary.getActiveJob()` y reconstruye la sesión. `5ffbf01` adapta el harness. | Corregido para jobs activos. Falta acceso durable a `partial`, `failed` y `completed_with_errors`, excluidos de `ACTIVE_STATUSES`, y resolución de varios candidatos. R1. |
| A2. Navegar durante `bulkPage()` produce TypeError o mezcla contextos | `0d8c7e8`: captura `context`/generación, registra AbortControllers y comprueba vigencia después de awaits. | Carrera original mitigada y regresión local presente. El manager todavía envía `GET_BULK_PAGE` a `enumerationTabId`; navegar puede cortar el job con `stale_context`. R2. |
| A3. Históricos sin limpieza | `eb7daf0`: `cleanupTerminalJobs()` se llama al crear jobs; conserva por defecto hasta 10 completados/cancelados y aplica 30 días, con borrado por rango. | Limpieza básica implementada. `failed`, `partial`, `completed_with_errors` se conservan indefinidamente; falta historial/resolución y manejo de cuota. R3. |
| A4. Retry desaparece al truncar 100 errores | `ac2b73f`: contadores durables `retryableFailedCount`/`ambiguousCount`, recuento de registros antiguos y `canRetry` en snapshot; popup usa `canRetry`. | Bug corregido. Mantener regresión 1 fallo recuperable + 100 ambiguos y añadir integración real/paginación de detalles. R4. |
| A5. Estado principal no accesible | `3adc777`: región separada `downloadAnnouncement` con `role=status`, `aria-live=polite`, `aria-atomic=true`; anuncios deduplicados de cambios significativos. | Solución implementada aunque `downloadStatus` no tenga aria-live. Falta prueba real de lector/teclado y cobertura de nuevos estados de recuperación. R5. |

Verificación ejecutada el 22/09 en `4a9ffba`: `verify-bulk-job-state-machine.js`, `verify-page-intake.js` y `verify-popup-ux.js`, las tres aprobadas. El harness del manager usa almacenamiento simulado; el test de popup es estático. Se inspeccionaron fixtures de retención/101 fallos en `bulk-library.browser-test.js`, pero no se ejecutó Chromium en esta actualización. Las 41 verificaciones y el E2E de 50.000 tracks del informe anterior son resultados históricos, no una nueva ejecución ni evidencia de publicación.

## Registro maestro y prioridades

Prioridades por impacto: P0 protege recuperación, continuidad y efectos irreversibles; P1 completa integridad, recursos y UX; P2 mejora diagnóstico y entrega. Un check sólo se cierra con evidencia asociada al commit/artefacto probado.

| ID | Prioridad | Trabajo restante | Dependencias |
| --- | --- | --- | --- |
| R0 | P0 | Diagnosticar offscreen, contrato de operación y reconciliación sin duplicar saves | Fixture de reproducción; integrar con R1 |
| R1 | P0 | Autoridad durable, historial recuperable, transiciones y migración | Conservar A1/A4; base para R2–R4 |
| R2 | P0 | Fuente independiente de pestaña y todas las entradas paginadas | R1; conservar A2 |
| R3 | P1 | Retención completa, intervención explícita y errores de cuota | R1; conservar A3 |
| R4 | P1 | Conteos completos, formato fijo, retries y detalles paginados | R1/R2; conservar A4; operación de R0 |
| R5 | P1 | Recuperación comprensible y accesible | Snapshots R1/R4; conservar A5 |
| R6 | P1 | Audio, HLS, memoria y claridad del export | Preservar WAV `98ee64b`; coordinar con R0 |
| R7 | P2 / bloqueo de publicación | Diagnóstico privado, documentación y validación del ZIP | Gates de R0–R6; higiene de datos inmediata |

## R1 — Autoridad durable y recuperación de extremo a extremo (P0)

Archivos: `bulk-library.js`, `bulk-job-manager.js`, `background.js`, `popup.js`, verificadores del manager y de IndexedDB.

1. Hacer de IndexedDB la autoridad para trabajo, selección activa, checkpoint y revisión. `storage.session` queda como caché reconstruible. La referencia durable y creación/transición del job deben actualizarse atómicamente; reparar referencias inexistentes al arrancar.
2. Agregar consulta paginada de trabajos recuperables, incluyendo `partial`, `failed`, `completed_with_errors` y guardados ambiguos. Hoy `getActiveJob()` sólo busca estados activos y elige el más recientemente actualizado; eso no es un historial recuperable.
3. Separar selección visible del trabajo y permiso de ejecución. Si hay varios candidatos, mostrarlos y reconciliar efectos antes de continuar; no ejecutar todos automáticamente ni ocultar silenciosamente los demás.
4. Centralizar comandos/transiciones con revisión/epoch esperado. Prohibir que un callback tardío sobrescriba una pausa, cancelación o job nuevo. Mantener commits de páginas idempotentes y actualización transaccional de contadores.
5. Recuperar destino, permiso de carpeta y estado de Chrome downloads/offscreen antes de guardar. Un permiso perdido requiere una acción de usuario; un resultado ambiguo no debe convertirse automáticamente en retry.
6. Migrar registros anteriores de forma idempotente. Recontar contadores ausentes, conservar estados terminales y fallos, manejar registro parcial/error de apertura sin resetear toda la base.

Aceptación: borrar únicamente sesión y reiniciar worker/navegador permite encontrar jobs activos y terminales recuperables; dos candidatos no producen dos runners; reinicio durante save no repite archivo; permiso revocado deja `needsDestinationCheck`; migración interrumpida puede repetirse sin perder pistas. Probar manager + IndexedDB real + mensajes controlables juntos, además del harness actual.

## R3 — Retención, historial y cuota (P1)

Archivos: `bulk-library.js`, `bulk-job-manager.js`, `background.js`, `popup.js`, locales y `bulk-library.browser-test.js`.

1. Conservar el borrado por rangos y la política existente de 10 jobs/30 días para completados/cancelados. Ejecutar mantenimiento también al inicio y tras terminar, con exclusión de trabajo seleccionado/en ejecución y de operaciones aún por reconciliar.
2. Revisar cancelados antes de purgarlos: si tienen fallos ambiguos o efectos pendientes, tratarlos como pendientes de intervención. Un estado terminal por sí solo no demuestra que sea seguro eliminar su evidencia.
3. Exponer historial paginado con resolver/descartar/eliminar explícitos para fallidos, parciales y ambiguos. No aplicarles una TTL silenciosa. Al resolverlos, hacerlos elegibles para retención; advertir cuando los pendientes excedan el presupuesto y ofrecer limpieza selectiva.
4. Tratar `QuotaExceededError`, almacenamiento bloqueado y abort de transacción como errores tipados recuperables. Conservar el último checkpoint confirmado; no informar página persistida si falló el commit ni borrar trabajos recuperables para liberar espacio automáticamente.
5. Limitar el mantenimiento por lotes/cursor: `status.getAll()` de todos los históricos puede crecer aunque sólo sobrevivan diez. Verificar consistencia de `jobs`, `tracks`, `seen`, `cursors` y referencias tras cada borrado.

Aceptación: fixture con activos, completados, cancelados ambiguos, fallidos y parciales elimina sólo los elegibles; ningún job vecino pierde registros; purga interrumpida es reiniciable; cuota simulada al guardar una página conserva checkpoint y ofrece recuperación; múltiples sesiones no acumulan completados fuera de política.

## R5 — Estado accesible y acciones comprensibles (P1)

Archivos: `popup.html`, `popup.js`, locales, tests del popup y puente del player.

1. Conservar `downloadAnnouncement`; anunciar inicio, pausa, espera por servidor, recuperación, finalización y fallo. No anunciar cada segmento o actualización de bytes.
2. Consumir capacidades explícitas del snapshot (`canRetry`, `canResume`, `canDownloadCollected`, `needsDestinationCheck`), independientes de la muestra de errores. Diferenciar enumeración y descarga sin presentar un lote parcial como completo.
3. Hacer accesibles con teclado historial, reconexión, destino, errores paginados y retry; mantener foco tras rerender y restaurarlo al cerrar detalles. Localizar mensajes y explicar la próxima acción, sin exponer IDs internos como ayuda al usuario.
4. Probar anuncios repetidos en operaciones distintas: la deduplicación de texto no debe silenciar el segundo inicio o éxito idéntico. Usar identidad de operación/transición cuando corresponda.

Aceptación: test DOM de estados/capacidades y recorrido manual con teclado + lector de pantalla. Se escucha cada transición relevante una vez, incluidos dos downloads consecutivos iguales; progreso no satura anuncios y ninguna acción disponible depende de los últimos 100 errores.

## Estado de partida

El límite preventivo que rechazaba loops WAV de diez minutos queda mitigado en `98ee64b`: el cálculo inicial usa 48 kHz estéreo, valida el sample rate real del `AudioContext` antes de decode y conserva el rechazo preventivo para 96 kHz. La regresión de loop corto sobre un track de diez minutos está en `verify-loop-download.js`.

Este plan no vuelve a tocar ese cálculo salvo que mediciones reales demuestren que el presupuesto es inseguro. El error Chromium `Failed to build audio file` fue reportado por el usuario y requiere reproducción actual. Corrección del diagnóstico original: `track-download-execution.js` conserva `buildResult.error`, `code` y `status`; el mensaje genérico es un fallback cuando no hay mensaje. No demuestra por sí mismo pérdida de un error válido, memoria insuficiente ni fallo HLS/render. Falta identificar la etapa y el contrato de respuesta que falló.

Los fixes ya existentes que deben conservarse son: serialización de build (`MAX_IN_FLIGHT = 1`), guardado ambiguo sin fallback duplicado, renovación de fuente una vez, límites de HTTP/cuerpo/memoria, recuperación del job desde IndexedDB, cancelación de contexto viejo, retención de completados, contador durable de retries y estados accesibles.

## Orden de implementación

### R0 / P0 — Diagnosticar y cerrar el fallo offscreen de Chromium

Archivos: `offscreen.js`, `bulk-job-manager.js`, `track-download-execution.js`, `verify-download-browser.js`, `verify-offscreen-idempotency.js` y un nuevo verificador de ciclo de vida offscreen.

1. Completar el contrato existente de `operationId` padre y `buildId` por intento en todos los mensajes build/progress/abort/save. Guardar una proyección durable mínima: `created`, `sent`, `building`, `built`, `saving`, `saved`, `failed`, `aborted`, `ambiguous_save`. Los IDs ya presentes en ejecución y las operaciones nuevas de pads no prueban recuperación durable del flujo general.
2. Conservar `code`, `status`, `stage` y causa legible al pasar `offscreen -> manager -> popup`. Tipar respuesta vacía/inválida y ausencia de `blobUrl` por separado de un fallo de build válido; mantener los mensajes y códigos que ya se preservan.
3. Distinguir cuatro casos: worker no puede contactar offscreen, offscreen no cargó, build falló de forma terminal y respuesta se perdió después de iniciar un efecto. Cada caso debe tener una acción distinta.
4. Reproducir en Chromium con un fixture directo y otro HLS; capturar sólo IDs, etapa y error tipado, nunca URL firmada, cookie ni token.
5. Si el worker se reinicia, reconciliar la operación por ID antes de crear otro build. No relanzar un save ni otro build si el resultado podría existir.
6. Hacer explícita la política de cierre: no cerrar el documento offscreen mientras haya builds/saves con lease vigente; liberar el lease sólo al terminar o al confirmar aborto.

Aceptación: reproducir o documentar por qué ya no se reproduce el fallo reportado con commit y entorno; todo fallo inyectado identifica etapa y causa concreta; una respuesta perdida no duplica archivo; abort, reinicio del worker y build HLS fallido dejan mapas/listeners vacíos; el error visible contiene una recomendación accionable. Incluir convivencia con render/playback de pads para que cerrar offscreen no interrumpa otro consumidor.

### R2a / P0 — Unificar toda descarga de colecciones bajo paginación durable

Archivos: `inline-button.js`, `popup.js`, `content.js`, `download-intent.js`, `page-intake.js`, `background.js`, `bulk-job-manager.js`, `bulk-library.js`.

1. Retirar la ruta de producción `inline-button -> resolveBulkTracks(null) -> START_BULK_JOB`. El inline debe iniciar el mismo `START_PAGED_BULK_JOB` que el popup, con límite All explícito.
2. Reemplazar `selectionList()` y `tracksByIds()` por un selector paginado. El content script entrega ventanas ordenadas de IDs/metadata ligera; IndexedDB conserva orden, selección y cursor. Nunca enviar una colección completa como un mensaje de runtime.
3. Agregar selección masiva semántica: `all`, `all except IDs`, `explicit IDs`. No crear un `Set` con decenas de miles de IDs para “Seleccionar todo”.
4. Mantener el orden original de playlist y el límite exacto para popup, inline y selección manual.
5. Eliminar o aislar `START_BULK_JOB` como compatibilidad versionada con tamaño máximo estricto y migración; no dejarlo como camino silencioso para colecciones grandes.

Aceptación: playlist/likes de 50.000 tracks inicia desde popup e inline sin array completo en content, popup o mensaje; seleccionar todo y deseleccionar tres pistas persiste tras cerrar popup/reiniciar worker; 50 tracks exactos y límites 1/25/50/51/All conservan orden y cantidad.

### R2b / P0 — Hacer la enumeración recuperable sin depender de la pestaña

Archivos: `bulk-job-manager.js`, `bulk-library.js`, `page-intake.js`, `download-source.js`, `soundcloud-http.js`, `background.js`.

1. Persistir un descriptor inmutable de fuente al crear el job: tipo de colección, usuario/playlist, cursor, formato fijado, página origen y contexto de autenticación no secreto. No persistir OAuth ni URL firmadas.
2. Mover la obtención de cada página desde `chrome.tabs.sendMessage(enumerationTabId, GET_BULK_PAGE)` al worker. El content script sólo descubre y valida el descriptor inicial.
3. Para playlists, persistir IDs ordenados paginados y completar parciales por lotes; para likes propias, obtener OAuth sólo dentro del worker y revalidar identidad antes de cada página autenticada.
4. Convertir `partial` en un estado recuperable con acciones concretas: reanudar desde cursor, reconectar una pestaña cuando sea indispensable, o descargar los tracks ya enumerados.
5. Invalidar por epoch resultados de página tardíos en pausa, cancelación, cambio de cuenta o nueva colección.

Aceptación: empezar una colección, cerrar/navegar la pestaña y reiniciar el worker conserva cursor, orden y conteos; no duplica páginas ni mezcla una colección nueva con la anterior; caída en página 3 mantiene páginas 1–2 y ofrece recuperación.

### R4a / P1 — Congelar formato y explicar cada pista ausente

Archivos: `stream-selector.js`, `download-track.js`, `page-intake.js`, `bulk-library.js`, `bulk-job-manager.js`, `popup.js`, locales.

1. Guardar `formatPreference` y política de fallback dentro del job antes de la primera página. `bulkPage()` no debe volver a leer `chrome.storage.local` para un job activo.
2. Resolver las entradas de playlist por campos requeridos (`media`, `downloadable`, stream), no sólo porque tengan título. Hidratar una vez entradas parciales antes de descartarlas.
3. Persistir estado de cada entrada: `saved`, `failed`, `ambiguous_save`, `skipped_format_unavailable`, `skipped_source_unavailable`, `skipped_preview`, `skipped_duplicate` o `restricted`.
4. Exponer en el snapshot y popup: enumeradas, elegibles, guardadas, fallidas, ambiguas y omitidas por causa. El total visible no puede ser sólo `eligible`.
5. Permitir una acción explícita “reintentar omitidas con Auto” sólo para `format_unavailable`; no sustituir silenciosamente el formato elegido.
6. Mostrar formato efectivo, original/fallback y preview antes de empezar; documentar que Auto tiene una política de calidad/compatibilidad definida.
7. Conservar los contadores transaccionales y `canRetry` de `ac2b73f`. Agregar detalles de fallos paginados desde IndexedDB; `recentFailures` sirve sólo para vista previa. Probar recuento de registros antiguos y transiciones repetidas sin doble incremento/decremento.
8. Definir invariantes de conteo: cada entrada enumerada se asigna a elegible u omitida con causa; cada elegible tiene un único estado de ejecución. Los ambiguos no cuentan simultáneamente como retryables. Distinguir duplicados de entradas originales para no falsear tamaño ni orden.

Aceptación: fixture de 30 entradas con formatos heterogéneos, previews y metadatos parciales muestra 30 contabilizadas y explica las 10 no descargadas; cambiar el selector durante la enumeración no cambia los formatos del job; retry Auto afecta sólo las omitidas compatibles.

### R4b / P1 — Respetar reintentos y evitar operaciones duplicadas en UI

Archivos: `bulk-library.js`, `bulk-job-manager.js`, `popup.js`, `tempo-control-main.js`, `content.js`, locales y verificadores.

1. Exponer `retryAt`, `errorCode`, `stage` y `canResume` en el snapshot público.
2. No borrar `retryAt` en `resumeJob()` antes de que venza. Si el usuario pulsa reanudar temprano, mantener pausa y mostrar la hora/espera restante; programar reanudación cuando corresponda.
3. Diferenciar pausa manual de pausa por rate limit/red. La pausa manual puede reanudarse inmediatamente; la otra debe respetar el proveedor.
4. Sustituir el timeout de 120 s del export del player por una consulta de operación. Al vencer la espera de UI, conservar el mismo ID, presentar “sigue procesando” y permitir reconexión; no liberar el botón para crear un segundo export ciego.
5. Probar cancelación durante Retry-After, suspensión de worker, respuesta tardía y clic repetido.
6. Aplicar el contrato al timeout del inline y a los distintos exports del player, no sólo a un callback de `tempo-control-main.js`. Persistir el deadline y despertar/reconciliar al volver el worker; un temporizador en memoria no garantiza reanudación tras suspensión.

Aceptación: un 429 con `Retry-After: 60` no hace request antes de 60 s; al volver a abrir popup aparece el contador correcto; una exportación larga termina en un único save o estado ambiguo, nunca dos builds por timeout visual.

### R6 / P1 — Audio, HLS y memoria en dispositivos modestos

Archivos: `download-core.js`, `loop-audio-renderer.js`, `tempo-control-main.js`, `audio-effects-core.js`, verificadores y fixtures HLS.

1. Mantener el cambio WAV de `98ee64b` y ampliar su matriz: 3/10/30 minutos, 44,1/48/96 kHz, mono/estéreo, loop corto/largo, velocidades 0,5×/1×/1,5×/3× y Preserve Pitch.
2. Medir RSS/heap, tiempo y cancelación en ChromeOS para directo, HLS, bulk, loop y track transformado. Si falta duración antes de decode, aplicar un límite conservador y una explicación clara.
3. Añadir fixtures HLS para master/media, init map, 401/403/429/503, body cortado, abort, playlist circular, byte range y cifrado. Rechazar características no soportadas con código específico antes de producir un archivo dañado.
4. Confirmar que el primer fallo cancela y drena todos los workers de segmentos antes de renovar fuente; no iniciar otro build mientras queden fetches del anterior.
5. Verificar fidelidad: duración, frecuencia/tono, canales, discontinuidades y pico/clipping del WAV. Diferenciar en UI descarga normal, export transformado, velocidad, Keep Tone y el hecho de que los FX en vivo no se exportan hoy.

Aceptación: ningún caso excede presupuesto sin error tipado; cancelar libera recursos; 96 kHz se rechaza antes de decode; la prueba de tono no cambia frecuencia con Preserve Pitch; no hay solapamiento de builders tras un fallo HLS.

### R7 / P2 — Diagnóstico, confianza y entrega verificable

Archivos: `services/uninstall-feedback`, `popup.html`, `popup.js`, locales, README, TESTING, empaquetador y nuevos smoke tests.

1. Agregar diagnóstico voluntario y mínimo por fallo: versión, commit/build, etapa, código, formato pedido/efectivo, modo normal/transformado, tipo de dispositivo opcional y conteos. No recolectar títulos, URLs firmadas, cookie ni token.
2. Mantener el formulario de uninstall como señal cualitativa; no usarlo como tasa sin instalaciones/desinstalaciones por versión y fecha.
3. Explicar el permiso de cookies y su uso exclusivamente hacia SoundCloud en onboarding/Store. Evaluar permiso opcional en un cambio separado con migración y pruebas.
4. Actualizar README: ya no afirmar dos tracks simultáneos, estado sólo en `storage.session` ni cierre seguro de pestaña antes de terminar P0 de enumeración.
5. Crear el ZIP sólo tras pruebas, guardar SHA-256, versión, commit y fecha de Store. Probar el ZIP extraído, no sólo el árbol fuente. Confirmar que el empaquetador elimina el login de test y que el ZIP no incluye datos privados.
6. Corregir la incorporación del TXT privado de contactos a Git: `git ls-files` confirma que está trackeado y su historial muestra incorporación en `8e58125`, pese a la intención de ignorarlo. Conservar una copia local ignorada, retirarlo del índice en un cambio específico y verificar exclusión del paquete. Eso no lo elimina del historial: revisar alcance de remotos y, si procede, acordar una limpieza coordinada antes de reescribir historial compartido. No publicar emails ni hashes personales en este documento, fixtures o diagnóstico.

Aceptación: un reporte permite identificar etapa y build sin secreto; el ZIP probado coincide con el publicado; smoke tests incluyen MP3, M4A/HLS, carpeta, sesión autorizada y ruta de recovery.

## Secuencia de implementación y entregables revisables

1. **PR1: base y reproducción.** Fijar commit/build, ejecutar regresiones A1–A5, crear harness integrado manager + IndexedDB real + transporte controlable. Reproducir R0 sin atribución prematura. Atender la copia privada de R7 como cambio separado, sin mezclar datos personales con fixtures.
2. **PR2: R1.** Esquema/migración durable, selección activa e historial recuperable, comandos con revisión y reconciliación de destino. Entregar tests de pérdida de sesión, varios candidatos y migración interrumpida.
3. **PR3: R0.** Resolver la causa reproducida y completar ciclo de vida de operaciones/leases. Tests Chromium de respuesta perdida, worker reiniciado, aborto y convivencia con pads. El diagnóstico inicial puede avanzar junto con PR2; recuperación debe usar su contrato durable.
4. **PR4: R2a/R2b.** Descriptor/fuente worker, estado parcial recuperable y migración de popup/inline/manual. Congelar formato ya al definir descriptor, aunque UI y contabilidad se completen en PR5. Evitar publicar mitad del contrato dejando rutas grandes sin límites.
5. **PR5: R4.** Contabilidad por entrada, hidratación, fallos paginados, capacidades explícitas, Retry-After y export consultable por ID. Conservar la protección de ambiguos.
6. **PR6: R3/R5.** Historial y limpieza segura, manejo de cuota, anuncios y teclado sobre los nuevos estados. Las protecciones de limpieza deben llegar antes de activar mantenimiento adicional.
7. **PR7: R6.** Matriz audio/HLS y presupuesto medido, con fixes respaldados por fallos reproducibles. El fix WAV de diez minutos permanece como regresión, no se reimplementa.
8. **PR8: R7 y release gate.** Ayuda/diagnóstico, comprobación de privacidad y pruebas del artefacto exacto. No marcar cerrado un gate sin evidencia; si falta ChromeOS, lector de pantalla o cuenta autorizada, registrar explícitamente pendiente.

Cada PR debe incluir issue IDs, comportamiento antes/después, pruebas, migración si aplica y compatibilidad con jobs existentes. Mantener fixtures de esquemas previos; no resolver un fallo de migración borrando IndexedDB. Para reversión, preferir un fix hacia adelante; no instalar un lector antiguo incompatible con el esquema nuevo.

No combinar estos bloques con rediseños de UI, cambios de precio o migraciones de Player Tools. Las descargas públicas permanecen gratuitas e independientes de licencia Pro.

## Matriz de pruebas y criterio de cierre global

| Gate | Evidencia requerida |
| --- | --- |
| G1. A1–A5 sin regresión | Pérdida de sesión, navegación con respuesta pendiente, retención por rangos, 1 retryable + 100 ambiguos, anuncios de transiciones; harness e integración real |
| G2. Continuidad | 50.000 tracks desde popup/inline/manual, orden/límites exactos, cerrar pestaña, reiniciar worker, navegar a otra colección, cambiar cuenta, pausa/cancelación con página tardía |
| G3. Integridad | Fallo en página 3 recupera 1–2; todas las entradas contabilizadas; formato no cambia a mitad; sin duplicar páginas/saves; originales, restricciones y previews explicados |
| G4. Persistencia | Reinicio con sesión vacía, estados terminales recuperables, múltiples candidatos, permiso revocado, migración/recuento interrumpidos, cuota y purga sin perder trabajos pendientes |
| G5. Operaciones | Offscreen directo/HLS, respuesta perdida antes/después de save, export >120 s, doble clic, Retry-After con reloj controlado, cierre concurrente con pads |
| G6. Audio y recursos | WAV 3/10/30 min y 44,1/48/96 kHz, Preserve Pitch, HLS malformado/HTTP/abort, duración ausente, fidelidad y cancelación; medición ChromeOS con dispositivo y picos registrados |
| G7. UX | Popup real con teclado/lector, dos operaciones iguales consecutivas, recuperación y fallos paginados, estados localizados y acciones según capacidades |
| G8. Artefacto | Suite local vigente (`npm test`, sin fijar número histórico), `test:e2e:bulk-store`, `test:e2e:download`, popup, audio/Player Tools/feedback afectados; ZIP extraído con SHA/version/commit, sin datos privados/login de test, smoke real autorizado |

Resultados de mocks, tests estáticos y navegador se registran por separado. No presentar los tests del servicio de licencias como pagos reales. Para cada gate, guardar fecha, comando/escenario, commit, resultado y limitación; los nuevos tests integrados se incorporan a scripts de verificación/CI al implementarlos.

## Cobertura de feedback sin inventar causas

- Audio poco claro (#100): R6 y UX R5; distinguir reproducción en vivo/export/archivo normal y pedir muestra voluntaria si no hay reproducción. No atribuir a MP3, tono o clipping sólo por el comentario.
- Un tercio de playlist ausente (#106): R2/R4 y G2/G3; comprobar metadatos parciales, formatos, restricciones y enumeración interrumpida.
- Reintentos/confusión (#113 y motivos similares): R0/R4/R5; deadline y etapa visibles, recuperación sin operación duplicada.
- Chromebook congelado (#86): R6/G6; límites existentes no sustituyen medición en dispositivo.
- Desconfianza por tokens (#61): R7; explicar permisos y conservar pruebas de emisores/destinos. El comentario no prueba robo de credenciales.
- “No anda”, actualización mala, buggy, reinstalación y respuestas vacías: R1/R7 para recuperación y diagnóstico; mantener causa sin determinar hasta obtener evidencia.
- Función faltante, precio y ya no lo necesita: ayuda Free/Pro y preguntas voluntarias; no inventar features, modificar precios ni declarar fallos técnicos a partir de esas etiquetas.

Las 114 respuestas corresponden a `2026.9.10`; no prueban que un commit posterior estuviera publicado ni que haya resuelto un caso concreto. Cierre técnico = implementación + regresión + validación del artefacto. Cierre de impacto = observar feedback de la versión efectivamente distribuida, con denominadores válidos; no prometer cero desinstalaciones.
