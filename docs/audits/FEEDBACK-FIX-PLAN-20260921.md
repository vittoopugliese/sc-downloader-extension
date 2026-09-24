# Plan de fixes a partir de 114 respuestas de desinstalación

> **PARCIAL; diagnóstico fechado — revisión 24/09/2026 (`29d7946`).** HTTP/recovery/offscreen y export EQ/FX tienen fixes posteriores; la afirmación de que reverb/delay no se exportan ya no describe HEAD. Selección manual completa vuelve a ser cierta en `29d7946`. Impacto del feedback, ChromeOS, audio real y publicación siguen sin cierre demostrado. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Fecha: 21/09/2026. Base revisada: `5ffbf01`, manifest/package `2026.10.5`.
Alcance: diagnóstico y plan; no se implementaron fixes de producto ni se publicó una versión.

## 1. Datos y atribución

El usuario aportó 114 registros, del 12/09/2026 20:22:06 UTC al 21/09/2026 13:10:14 UTC. Todos declaran `2026.9.10`. El análisis anterior terminaba en el registro 97: hay 17 respuestas nuevas, de las cuales 12 seleccionan fallo de descarga, 2 ya no lo necesitan, 2 otros y 1 confusión de uso.

Se mantienen excluidos los registros 2 y 20: el diagnóstico previo documenta que el desarrollador los confirmó como pruebas propias. No se excluyen comentarios negativos ni vagos.

| Motivo | Respuestas sin pruebas propias | % de 112 |
| --- | ---: | ---: |
| Descargas que no funcionan | 73 | 65,2% |
| Otros | 17 | 15,2% |
| Ya no lo necesita | 14 | 12,5% |
| Confuso de usar | 5 | 4,5% |
| Falta una función | 2 | 1,8% |
| Precio | 1 | 0,9% |

El registro 113 selecciona confusión pero describe un fallo de reintentos. No cambiar el motivo original al agrupar; se puede agregar una etiqueta técnica secundaria. Los pares 9/10, 22/23, 50/51 y 87/88 comparten hash; no tratarlos como ocho personas independientes. Un hash tampoco identifica inequívocamente a una persona. Los porcentajes son distribución del formulario, no tasa de fallos de descarga ni de desinstalación.

Los fixes del 20 y 21 de septiembre son posteriores a buena parte de los reportes. Los reportes nuevos también conservan la versión antigua. Sin identificar el ZIP publicado y la versión instalada, no se puede concluir que los fixes recientes fracasaron. Las auditorías previas además encontraron distintos artefactos con el mismo número de versión.

Contactos y comentarios privados: `repos/uninstall-feedback-emails-20260921.txt`, excluido por la regla existente `repos` en `.gitignore`, comprobado con `git check-ignore -v`. Hay cuatro registros con email, tres direcciones distintas y dos contactos externos. No se enviaron mensajes ni se accedió a una casilla de correo. Ese TXT guarda los contactos y comentarios, no una exportación completa de los 114 registros.

## 2. Mapa del sistema revisado

| Área | Responsabilidad y archivos |
| --- | --- |
| Descubrimiento e interfaz | `content.js`, `page-intake.js`, `popup.js`, `inline-button.js`, `download-intent.js`: detectar página/colección, elegir formato y enviar operaciones. |
| Coordinación | `background.js`, `bulk-job-manager.js`: mensajes, sesión SoundCloud, cola, progreso, recuperación y enumeración. |
| Persistencia bulk | `bulk-library.js`: IndexedDB con jobs, tracks, deduplicación, cursores, estados y contadores. |
| Fuentes | `soundcloud-http.js`, `download-source.js`, `download-track.js`, `stream-selector.js`: metadatos, auth, selección y renovación de fuentes. |
| Construcción y guardado | `track-download-execution.js`, `offscreen.js`, `download-core.js`, `download-destination.js`, `directory-storage.js`, `metadata.js`: HLS/directo, tags, Blob, Downloads/carpeta. |
| Audio y looper | `tempo-control-main.js`, `tempo-control-core.js`, `audio-effects-core.js`, `looper*`, `loop-session.js`, `loop-audio-renderer.js`: reproducción, FX, selección A–B, render WAV. |
| Likes Explorer | `likes-explorer.js`, `likes-jobs.js`, `likes-library.js`, `soundcloud-likes-source.js`: indexación y exploración separadas del bulk gratuito. |
| Acceso y comercio | `player-tools-*`, `services/player-tools-license`: trial, licencia y operaciones Pro. La descarga normal debe seguir siendo gratuita. |
| Web, feedback y entrega | `index.html`, locales, `services/uninstall-feedback`, empaquetadores y verificadores. El formulario actual no registra etapa/código de fallo. |

Se revisaron estos contratos y los módulos centrales, historial y auditorías previas. Esto no equivale a auditar cada línea del repositorio, escuchar archivos de usuarios, verificar pagos reales o ejecutar en ChromeOS.

## 3. Qué ya está corregido y debe conservarse

| Cambio | Evidencia en historial/código actual |
| --- | --- |
| Orientación de recarga tras instalar | `49c047e`; errores de extracción terminales en intake/popup. |
| Reintentos transitorios y renovación de fuente vencida | `026d8c4`, reforzado por límites HTTP posteriores; el build renueva una vez ante 401/403/404. |
| Menor presión de recursos | `5614126`, `1fd55da`: serialización, límites de cuerpos/PCM/WAV y presupuesto estimado. |
| Guardado incierto y duplicados | `1fd55da`, `77dcccd`, `b71c000`: idempotencia, estados ambiguos y reconciliación de downloadId. |
| HTTP acotado y cancelación | `2833199`, `da3af5d`, `3849776`; timeout incluye consumo del cuerpo. |
| Persistencia y paginación bulk | `7ac67a1`, `01398a3`, `e953b8a`, `404fbd9`. |
| Recuperación sin puntero de sesión | `f468a7c`; ahora consulta trabajos activos en IndexedDB. |
| Contexto inmutable durante una página | `0d8c7e8`; captura contexto/generación y cancela solicitudes obsoletas. |
| Retención y capacidad de retry | `eb7daf0`, `ac2b73f`; no depende sólo de los últimos 100 errores. |
| Anuncios de estado | `3adc777`; cambios relevantes en región accesible. |

La auditoría local `CODEBASE-AUDIT-20260921.md` usa base `404fbd9`. Sus problemas de puntero de sesión, contexto mutable, retención, retry truncado y anuncio de estado recibieron commits posteriores: no volver a presentarlos sin más como defectos actuales.

## 4. Hipótesis por feedback y brechas actuales

### Audio poco claro — registro 100

No identifica pista, formato, botón ni si el problema ocurre en SoundCloud o en el archivo descargado. No demuestra corrupción del audio ni un fallo de Signalsmith.

Hechos actuales:

- `tempo-control-main.js:994` descarga con `effectiveRate` y `preservePitch`. Si se modificó la velocidad, exportar desde el player puede producir WAV transformado. Popup/inline normales siguen otro contrato.
- `stream-selector.js` prioriza MP3, luego M4A y Opus en Auto entre transcodes; antes intenta original si está habilitado. Una reproducción Node con MP3 progressive y AAC 160 disponibles confirmó que Auto elige MP3. Esto demuestra la selección, no que MP3 sea la causa del comentario ni que AAC sea siempre superior.
- El comando de exportación transporta velocidad/tono, no reverb/delay. Los FX se aplican al audio en vivo en otro módulo: lo oído con FX puede diferir del archivo exportado.
- `candidates()` permite previews `snipped` cuando no hay fuentes completas; esa condición no queda explícita en la proyección descargable.
- `encodeWavSegment()` limita muestras a [-1, 1]. La saturación puede deformar picos si un render los excede; no se midió clipping en un archivo de usuario.

### Falta un tercio de la playlist — registro 106

No atribuir el porcentaje a una causa única sin la playlist. Hay mecanismos concretos compatibles:

1. `page-intake.js:240` considera suficiente que una entrada tenga título para evitar su hidratación. Una entrada parcial con título pero sin `media` puede terminar sin fuente y quedar filtrada. Hallazgo estático; falta fixture representativo de una respuesta real.
2. Un formato explícito ausente genera `streamUrl=null`; `canDownload()` da false si tampoco hay original. Reproducido con una pista MP3/AAC y preferencia Opus. En bulk, el manager la omite como `skipped.invalid`, aunque existe audio en otros formatos.
3. `getPublicJobSnapshot()` usa `eligible` como total y no expone `enumerated` ni `skipped`. Una colección puede mostrar éxito sobre las elegibles sin explicar las omitidas.
4. `requestBulkPage()` sigue enviando mensajes a `enumerationTabId`. Navegar/cerrar la pestaña corta la enumeración; `failEnumeration()` puede dejar `partial` con tracks pendientes, sin acción para descargarlos o reconectar. Los arreglos de contexto evitan mezclar páginas, pero no eliminan esta dependencia.
5. También son posibles restricciones reales, originales no disponibles, previews, errores HTTP, URLs vencidas o fallos de destino. No son demostrables por este formulario.

### Sólo reintentaba — registro 113; confusión 19/21/24/69

La extracción actual ya limita reintentos y conserva estados terminales: no hay evidencia para afirmar que hoy sigue aquel loading infinito. Persisten brechas de recuperación:

- `failEnumeration()` guarda `retryAt` al pausar, pero `resumeJob()` lo borra y reanuda sin comprobar si ya venció. El snapshot tampoco lo expone. Se puede ofrecer reanudar antes del tiempo indicado por el servidor.
- La UI del player vence su espera a los 120 segundos, libera el botón y no cancela/reconcilia la operación subyacente. Un clic posterior genera otro ID. Posible confusión o repetición en procesamiento largo, confirmada por lectura del contrato; no reproducida en navegador.
- La selección manual todavía usa `selectionList()` → `resolveBulk(null)` y cache completo, fuera de la ruta paginada principal.

### Congelamiento en Chromebook — registro 86

Ya se redujo concurrencia y se agregaron presupuestos. No prometer que está resuelto en ese dispositivo sin medirlo. `checkDecodeBudget()` depende de `durationMs` antes del decode; si falta, el límite de PCM se comprueba después de asignarlo. HLS conserva chunks y buffer combinado; decode/render/WAV requieren más copias. El presupuesto estimado no es una medición de memoria total del navegador.

### Desconfianza por el token — registro 61

El permiso `cookies` sigue presente. El worker lee OAuth para SoundCloud; la respuesta actual de `GET_LOGGED_IN_USER` proyecta campos de usuario y no expone el token como lo hacía el código anterior. No hay evidencia en estos datos de robo de tokens. Hace falta explicar el permiso y mantener pruebas de destinos/emisores. El comentario no permite inferir un incidente.

### Otros comentarios y motivos

- 5 (“no anda”), 17 (“new update not good”) y 99 (“a little buggy”): señales reales pero insuficientes para asignar causa; usar el mismo diagnóstico por etapa.
- 7 (“need reinstall”): puede ser mantenimiento del usuario o intento de recuperación; recarga y recuperación visibles reducen la necesidad de reinstalar.
- 36 (“hj”) y respuestas sin texto: sin información causal adicional; no inventar causas por país/idioma.
- `missing_feature` (30/53): no identifica la función; no justifica construir una feature concreta.
- `pricing` (74, excluida prueba 20): aclarar alcance gratuito y Pro; no permite decidir un cambio de precio.
- `no_longer_needed`: puede ser uso ocasional legítimo, no necesariamente un fallo. El comentario 99 admite etiqueta adicional de estabilidad.

## 5. Plan de implementación, en orden

### F0 — Fijar la base de comparación

Registrar versión, commit y SHA-256 del ZIP enviado a Store, fecha de publicación y resultados sobre ese artefacto. No reutilizar una versión para distintos builds publicados. Comparar feedback por versión y sumar denominadores de Store antes de calcular tasas.

Agregar un diagnóstico local acotado con etapa (`extract/enumerate/resolve/build/save`), código, formato pedido/efectivo, modo normal/transformado y contadores. Copia/exportación voluntaria desde el error. No guardar cookies, URLs firmadas ni títulos en telemetría automática. El formulario de desinstalación no puede depender de consultar una extensión ya eliminada: empezar con preguntas voluntarias sobre síntoma, modo y dispositivo. Si se amplía el servicio, actualizar validación y migración conjuntamente.

Aceptación: un error de descarga permite identificar etapa y build sin datos de sesión; una instalación vieja se distingue de la nueva.

### F1 — Hacer explicable y recuperable cada pista del lote

Archivos: `page-intake.js`, `download-track.js`, `stream-selector.js`, `bulk-library.js`, `bulk-job-manager.js`, `popup.js`, locales.

1. Completar metadatos por ausencia de campos necesarios, no sólo por ausencia de título. Resolver metadatos sin fuente una vez antes de descartarlos.
2. Congelar formato/política al crear el job: hoy `bulkPage()` vuelve a leer la preferencia global en cada página.
3. Persistir resultados por entrada: guardada, fallida, omitida y motivo (`format_unavailable`, `source_unavailable`, preview, duplicada, etc.). Evitar reducir todo a `invalid`.
4. Exponer total enumerado, elegible, omitido, guardado, fallido y ambiguo; mostrar detalles paginados. No usar el contador público como prueba de disponibilidad.
5. Ofrecer “reintentar con Auto” para formato ausente, explícito y sólo sobre afectadas. No cambiar silenciosamente un MP3 solicitado por otro formato.
6. Hacer visible preview/original no disponible y cualquier fallback efectivo.

Aceptación: fixture de 30 entradas con 10 no disponibles o sin formato muestra las 30 contabilizadas y el motivo de las 10; no presenta “20/20” como colección completa. Probar entrada con título sin media, original permitido, retiradas y fuentes que se renuevan.

### F2 — Terminar la independencia y recuperación de la enumeración

Archivos: `background.js`, `page-intake.js`, `bulk-job-manager.js`, `bulk-library.js`, `soundcloud-http.js`.

Persistir descriptor inmutable de fuente/cuenta/colección y cursor. Ejecutar la obtención de páginas en el worker; reservar el content script para descubrir el contexto inicial. Para playlists, almacenar IDs ordenados por páginas, sin un mensaje/snapshot gigante. Obtener credenciales vigentes en el worker y revalidar identidad al reanudar.

Agregar estados/acciones para enumeración parcial: continuar desde checkpoint, reconectar cuando corresponda o descargar sólo lo ya obtenido. Cambiar cuenta debe pausar con explicación. Integrar también selección manual paginada.

Aceptación: empezar, navegar/cerrar pestaña, reiniciar worker y perder `storage.session` conserva cursor/orden/resultados; no mezcla colecciones ni repite guardados. Un fallo en página 3 conserva páginas 1/2 y ofrece recuperación. Validar manager + IndexedDB real + mensajería juntos, no sólo mocks separados.

### F3 — Reintentos con causa, espera y operación reconocible

Preservar `retryAt` hasta UI y bloquear reanudación temprana por rate limit también en el worker. Compartir la clasificación de errores, no necesariamente todos los tiempos/reintentos de procesos distintos. Dar acciones concretas: esperar, recargar pestaña, iniciar sesión, revisar carpeta o cambiar formato.

Para exportación del player, mantener ID consultable y estado real tras perder/vencer la respuesta. El timeout de UI no debe habilitar una operación duplicada sin reconciliación. Limpiar listeners al vencer/cancelar y conservar el estado de guardado ambiguo.

Aceptación: reloj simulado con 429 no hace solicitudes antes de `retryAt`; red caída termina en estado accionable; export que dura más de 120 segundos sigue identificable y guarda una sola vez; retry no repite archivos ya guardados ni ambiguos.

### F4 — Claridad de audio y verificación de fidelidad

Mostrar antes de exportar modo, velocidad, Keep Tone y formato real; distinguir descarga normal y exportación transformada. Mantener acceso evidente a 1×/sin modificación y explicar que FX en vivo no se exportan actualmente. No agregar exportación de reverb/delay como supuesto arreglo del reporte.

Definir Auto con un criterio de calidad/disponibilidad documentado y validado, separándolo de la preferencia MP3 por compatibilidad. Evaluar AAC disponible frente al MP3 actual con muestras reales; no prometer calidad original al convertir un stream a WAV. Identificar previews como tales.

Validar fuente normal sin alteración involuntaria, duración, canales, frecuencia/tono, discontinuidades y picos del WAV a 0,5×/1×/1,5×/3× con/sin Keep Tone. Usar tonos, transientes y música de prueba autorizada; escuchar además de medir. Si aparece clipping, corregir headroom/ganancia en el render que lo genera; no introducir normalización indiscriminada.

Aceptación: UI y archivo coinciden; descargar normal no hereda accidentalmente FX/rate; límites y artefactos de transformación quedan documentados. El test de tono que ya pasa no certifica por sí solo calidad perceptual sobre música.

### F5 — Memoria en equipos modestos

Mantener serialización/límites actuales. Medir pico de memoria y tiempo en ChromeOS para directo, HLS, bulk, loop y track transformado de 3/10/30 minutos. Probar duración ausente/incorrecta y velocidades lentas.

Fortalecer la prevalidación antes de decode cuando falten datos y contabilizar buffers retenidos, copias y memoria del renderer. Cuando exceda el presupuesto, ofrecer descarga normal o rango más corto con explicación. Evaluar procesamiento por segmentos sólo después de medir: no es un refactor pequeño.

Aceptación: casos fuera de presupuesto fallan antes de grandes asignaciones previsibles; cancelación libera recursos; no congelamiento en el dispositivo objetivo. Un mock de memoria no sustituye la prueba ChromeOS.

### F6 — Confianza, ayuda y entrega

Explicar cookies/sesión en onboarding/Store donde el usuario ve el permiso; estudiar permiso opcional como trabajo separado con pruebas de migración. Mantener descargas públicas gratuitas e independientes de la licencia.

Actualizar README/ayuda: hoy documenta dos tracks concurrentes y estado en `storage.session`, mientras el código usa serialización e IndexedDB. Corregir también la promesa de poder cerrar la pestaña durante enumeración hasta completar F2. Aclarar Free/Pro sin atribuirle todos los abandonos.

Antes de publicar: verificaciones locales, E2E integrado, descarga pública real MP3/M4A, prueba autenticada autorizada, prueba sobre ZIP extraído y revisión de archivos incluidos. Los contactos privados nunca deben entrar en el paquete ni en Git.

## 6. Verificación realizada en esta revisión

- `npm test`: 41 verificaciones locales aprobadas en `5ffbf01`. La comprobación de landing omite comparación con el archivo externo de reseñas ausente; no equivale a revisar reseñas nuevas del Store.
- Reproducción Node con módulos reales: Auto elige MP3 frente a AAC 160 disponible; preferencia Opus deja no elegible una pista con MP3/AAC sin original.
- `git check-ignore -v` confirma exclusión del TXT privado.
- No se ejecutaron E2E de navegador, pruebas live, mediciones ChromeOS ni pruebas sobre ZIP en esta sesión. Los resultados de auditorías anteriores se citan como históricos.
- Se preservó `docs/audits/CODEBASE-AUDIT-20260921.md`, que ya estaba sin seguimiento al comenzar.

Primera tanda recomendada: F0 + F1 + F3; después F2. Investigar F4 desde el principio con fixtures y completar F5 antes de atribuir resolución al reporte de Chromebook. F6 acompaña la entrega. No rehacer mitigaciones que ya están implementadas.
