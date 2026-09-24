# Plan de implementación: confiabilidad de SoundCloud Track Downloader

> **HANDOFF HISTÓRICO; cierre global ABIERTO — revisión 24/09/2026 (`29d7946`).** Operaciones durables, límites HTTP/HLS, worker paginado, trial/licencias y package recibieron trabajo posterior. T01–T15 no son una lista de bugs actuales sin reproducción; conservar criterios y pendientes de escala/dispositivo/artefacto en el plan de cierre. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

## Contenido histórico de la base indicada

Fecha: 2026-09-20. Zona: America/Argentina/Buenos_Aires.

Este documento es un handoff para un agente que empieza sin contexto. Es un plan de cambios, no una certificación de seguridad ni el informe exhaustivo inicialmente solicitado. No se implementaron correcciones de producto durante la auditoría. El usuario pidió convertir la revisión en un plan detallado para que otro agente implemente.

## 1. Objetivo y límites

Reducir fallos evitables en descargas individuales, bulk y loops; recuperar errores transitorios; mantener memoria y colas acotadas; distinguir sesión ausente, restricciones de contenido y errores de red; conservar la gratuidad del descargador. Hacer que cada operación termine en éxito verificado, cancelación o un error accionable, sin loading indefinido ni éxito engañoso.

No prometer cero fallos o cero desinstalaciones. SoundCloud, Chrome, la red, restricciones regionales, archivos retirados, permisos y espacio disponible quedan parcialmente fuera del control de la extensión. No intentar eludir restricciones de acceso. Una descarga no disponible debe finalizar con una explicación precisa.

Implementar en cambios pequeños, con reproducciones antes de corregir. No mezclar rediseños, migraciones innecesarias, cambios de precio ni expansión de telemetría. El plan no autoriza publicar, enviar mensajes a usuarios, tocar cuentas reales, cambiar infraestructura productiva ni subir un ZIP a Chrome Web Store.

## 2. Repositorio y punto de partida real

Repositorio: `/Users/vittorio/Desktop/Program/sc-downloader-extension`.

Al comenzar y al retomar la auditoría:

- Rama `main`, árbol e índice limpios.
- HEAD y referencia local `origin/main`: `f902720fb3e178139067b54c27b9aa7fe55ff572`. No se hizo fetch para demostrar el estado remoto actual.
- Corte principal auditado: `fce0eceb92b1e7360ba4ab7db097656baefa5d41`.
- `d7cd47a58bf3e5223e743aed68c4283dc6da5925`: fallback de artwork a avatar del artista, con pruebas. Los dos cambios que el prompt describía como staged ya estaban commiteados.
- `f902720`: orden de status y teleport en Explorer. Preservar estos cambios.
- El rango `9c7e3a0..fce0ece` incluye también `44e01b8`, omitido de la lista original. No ignorarlo al atribuir cambios de UI.

Primero ejecutar:

```sh
git status --porcelain=v2
git diff --cached
git log --oneline --decorate -15
git rev-parse HEAD origin/main
git diff --check
```

Si aparecen cambios ajenos, preservarlos y delimitar qué código se está revisando. Trabajar desde el HEAD vigente después de comparar con esta base; no resetear a `fce0ece`. No restaurar ni sobrescribir el índice para reproducir un bug antiguo.

Existe una copia temporal del corte auditado en `/private/tmp/scdl-audit-QXMoLc`, creada con `git archive fce0ece`, con un symlink al node_modules local. No asumir que sobrevivirá a otra sesión. No contiene una rama de trabajo. Los tests y capturas de auditoría se ejecutaron allí, no sobre archivos editados del usuario.

## 3. Evidencia: qué está y qué no está demostrado

### Ejecutado con resultado conocido

Sobre la copia de `fce0ece`:

- `npm test`: 39 verificaciones aprobadas. El test de landing omitió la comparación con un archivo externo de reseñas que no existe en esta máquina.
- `npm run test:e2e:download`: aprobado en Chromium. Archivo en Downloads, directorio recordado y fallback a Downloads. Usa audio y respuestas de red sintéticos, NO una descarga pública live.
- `npm run test:e2e:popup`: aprobado. Layout a escalas 1, 1.25, 1.5 y 2; página no soportada. Parte del test elimina los scripts y construye estados de UI manualmente.
- `npm run test:e2e:feedback`: aprobado con servidor local y Turnstile simulado; incluye welcome. NO verifica el despliegue productivo.
- `npm run test:e2e:likes`: aprobado. Incluye IndexedDB, worker y controles de identidad; los 50.000 elementos del viewport se simulan mediante respuestas a mensajes. NO demuestra paginación real de 50.000 likes ni costo real de esas consultas en IndexedDB.
- Reproducción en Node VM sobre el código de download-core: `Retry-After` ausente → 0 ms; `2` → 2.000 ms; fecha HTTP unos 60 segundos futura → 500 ms; `60` → 10.000 ms.
- Reproducción en Node VM de segmentos HLS: un segmento devuelve 403; `Promise.all` rechaza; al resolver los otros tres segmentos, los workers continúan solicitando los segmentos restantes DESPUÉS del rechazo.
- ZIP existente comparado byte a byte contra blobs de Git, permitiendo únicamente la sustitución de `TEST_LOGIN` por `null`: 66 archivos, ninguno diferente o ajeno al commit, sin rutas test/debug/docs/node_modules.

Los primeros intentos de algunos tests de Chromium fallaron por restricciones de macOS/sandbox, no por un fallo de la extensión. Los resultados aprobados arriba corresponden a ejecuciones posteriores con salida de éxito recibida.

### No demostrado todavía

- No se repitieron en esta sesión las descargas públicas live MP3/M4A ni sus tamaños informados en el diagnóstico previo.
- No se completó una ejecución sobre el ZIP extraído. Los tests de extensión existentes cargan el árbol fuente.
- No se ejecutó aquí `npm run package:extension`; sobrescribe un artefacto local. Se inspeccionaron ambos empaquetadores y el ZIP ya existente.
- El dominio de welcome no pudo verificarse: la herramienta web no pudo acceder y curl en sandbox falló por DNS. La solicitud de escalación quedó reemplazada por otra solicitud, NO fue una respuesta HTTP negativa del dominio. No afirmar que el sitio está caído o que está publicado.
- Un probe adicional de Chromium para indexación/borrado/selector quedó sin resultado recuperable tras el cambio de sesión. Esos hallazgos son de lectura de código, no reproducciones browser confirmadas.
- No hay prueba en ChromeOS, medidas de RSS/heap, sesión real privada ni exportación original de los 97 formularios disponible y analizada en esta sesión.
- La revisión de los diffs grandes fue parcial; algunas salidas se truncaron. El implementador debe abrir los diffs completos de las áreas que cambie. No presentar este plan como auditoría exhaustiva de cada línea de los diez commits.

### Artefacto existente

`dist/soundcloud-track-downloader-2026.9.20.zip` está ignorado por Git, no trackeado.

SHA-256 observado:

```text
b39778aebc8879c41f2e71487e908c9e6e656262a0bbd5d3ad371186ce5ddfce
```

Corresponde a `fce0ece` con el login de test desactivado, no a `f902720`. No se sabe si es el ZIP subido a la tienda. Manifest, package, package-lock y softwareVersion de index.html coinciden en `2026.9.20` en el corte auditado. Los commits posteriores conservan ese número.

## 4. Arquitectura que hay que conservar y hacer verificable

| Flujo | Ruta principal | Particularidad |
| --- | --- | --- |
| Individual | popup/inline/player → download-intent → background → bulk-job-manager → track-download-execution → download-source → offscreen → download-core → destino | Individuales y loops comparten una cola en memoria. |
| Bulk gratuito | content → page-intake → GET_BULK_TRACKS o selección → START_BULK_JOB → manager → ejecución por track | Enumera likes con page-intake, NO con el indexador Pro. |
| Likes personales gratuitos | /you/likes → GET_LOGGED_IN_USER → cookie oauth_token → API /me → /users/{id}/likes | Actualmente el token vuelve al content script y queda en bulkContext. |
| Likes de perfil | /perfil/likes → usuario en hydration → API de likes | Actualmente no se adjunta token, incluso para el perfil propio por esta ruta. |
| Explorer Pro | content/likes-explorer → background → likes-jobs → soundcloud-likes-source → likes-library | Identidad autenticada separada del perfil fuente; IndexedDB v2. |
| Salida | download-destination → chrome.downloads o directorio mediante offscreen | Chrome espera complete; carpeta no disponible puede caer a Downloads. |

No hacer que bulk gratuito dependa de entitlement Pro, de una biblioteca previamente indexada o de una cuenta para descargar pistas públicas. Compartir utilidades HTTP/identidad/proyección es razonable; compartir requisitos de licencia no lo es.

## 5. Hallazgos priorizados y tareas de corrección

Las líneas referidas pertenecen al corte auditado o a archivos sin cambios respecto de él. Verificar numeración al implementar. `Confirmado estático` significa que se observó la ruta defectuosa, no que se reprodujo el caso de un usuario real.

### P0 / T01 — Evitar límite 0 con exactamente 50 tracks

Estado: confirmado estático, confianza alta.

Archivos: `scripts/popup.js:906`, `:922`, `:1287`; `scripts/page-intake.js:283`.

Los presets se filtran con `preset < total`. Para total=50 no existe opción `50`, pero se asigna `downloadLimit.value = "50"`. Un select sin opción coincidente queda sin selección; el handler usa `Number("")`, que da 0. La enumeración devuelve cero tracks. Este caso puede parecer que las descargas bulk no funcionan aunque las individuales sí.

Cambios:

1. Definir una política explícita: hasta 50, `All`; por encima de 50, `50`. Si se prefiere exactamente 50 como opción numérica, crearla realmente. No dejar una selección inválida.
2. Parsear la selección estrictamente: `all`, `select`, o entero positivo presente en las opciones. Una cadena vacía no es 0 ni All.
3. Mostrar junto al botón el alcance real: `Descargar 50 de N`; `Descargar todos los tracks disponibles` cuando corresponda. Mantener un indicio visible de que All incluye paginación.
4. No usar el contador público como garantía de pistas descargables: distinguir enumeradas, seleccionadas, omitidas y guardadas.

Aceptación: browser con popup.js real y totales 0, 1, 25, 26, 49, 50, 51, 200 y 1.000. Para 50, botón envía un límite válido y guarda la selección; ninguna ruta convierte un estado inválido en 0. All enumera hasta fin real, no hasta el contador de metadata.

### P0 / T02 — Estados terminales de extracción y auth para el caso Lorenzo

Estado: confirmado estático, confianza alta.

Archivos: `page-intake.js:312`, `:397`, `:461`, `:494`; `popup.js:675`, `:709`, `:772`; `background.js:327`; `content.js`.

Cuando /me falla o falta cookie, `loggedInOrHydratedUser` retorna null. La extracción devuelve null y `read()` sigue devolviendo loading. Los errores de API también se absorben en `extractCurrent`. El popup no distingue login ausente, API caída y extracción fallida; luego ofrece Retry mientras conserva copy de carga.

Cambios:

1. Modelar estado de extracción asociado a una generación de navegación. Estados mínimos: idle/loading/loaded/unsupported/error. Error estructurado con code, stage, retryable y status opcional.
2. Usar códigos compartidos, por ejemplo `auth_required`, `session_changed`, `reload_required`, `rate_limited`, `network_timeout`, `network_error`, `source_unavailable`, `unsupported_page`, `no_downloadable_tracks`.
3. /you/likes sin identidad: error auth localizado y CTA para iniciar sesión en SoundCloud. Después de login, volver a resolver identidad; no recomendar reinstalar.
4. /perfil/likes público: permitir enumeración pública. Si se intenta acceder a material no público, indicar restricción sin prometer que login lo hará accesible.
5. Un fallo terminal no debe reiniciar extracción en cada poll. Retry explícito o un número acotado de intentos cambia de estado.
6. Cancelar resultados obsoletos tras navegación, cuenta nueva, force refresh y cierre del contexto correspondiente. Deduplicar extracciones concurrentes para la misma generación.
7. Mantener la detección de pestaña sin content script y la instrucción de recarga. Añadir tratamiento de context invalidated/puerto cerrado, sin clasificarlos todos como login ausente.

Aceptación: /you/likes logged out termina en auth_required; 429 en rate_limited; timeout en network_timeout; ruta no compatible en unsupported. Inyectar retrasos y navegación SPA y comprobar que no aparecen datos de la página anterior. Probar idiomas existentes; no limitarse a regex sobre el source.

### P0 / T03 — Mantener OAuth en el worker y cerrar destinos arbitrarios

Estado: superficies de riesgo confirmadas estáticamente; explotación y filtración reales NO demostradas.

Archivos: `background.js:57`, `:182`, `:303`, `:327`; `download-source.js:61`, `:156`; `soundcloud-http.js:14`; `page-intake.js:294`, `:306`, `:415`; `offscreen.js:4`; `content.js:76`.

Hechos:

- GET_LOGGED_IN_USER devuelve `profile` con `{ user, oauthToken }` al content script.
- `soundcloud-http` adjunta Authorization al URL recibido sin validar destino.
- El bulk de likes sigue next_href sin validar origen/ruta; Explorer sí valida el cursor de entrada.
- resolveStream recibe streamUrl desde datos del mensaje y puede reintentar con OAuth.
- Muchos mensajes de background y offscreen no tienen validación específica de emisor; Explorer sí la tiene. Hay puentes DOM entre MAIN e isolated world que requieren revisar el flujo completo.
- La ruta normal de commerce no recibe oauth_token. Esto no equivale a demostrar que todas las rutas posibles impidan enviarlo a un destino ajeno.

Cambios:

1. Resolver /me y todas las páginas autenticadas en el worker. Devolver solamente campos de usuario necesarios y un identificador local de operación/sesión; nunca el token.
2. Validar destino antes de adjuntar Authorization: HTTPS, hostname exacto permitido, sin userinfo, ruta esperada. No aceptar hostname por includes ni suffix sin frontera de dominio.
3. Para streams, inventariar las URLs reales y definir una allowlist específica para endpoints resolutores de SoundCloud. No inventar una regla que rompa presets válidos. Separar API autenticada de CDN/audio sin OAuth.
4. Validar cursores por origen, ruta e identidad del perfil; normalizar sólo parámetros conocidos. Proteger redirects: preferir rechazo en API autenticada y resolver los casos legítimos explícitamente.
5. Matriz de mensajes por emisor: popup/extensión, content top frame SoundCloud, iframe permitido de Looper y offscreen. Verificar sender.id, URL/origin, frame cuando aplique y shape/tamaño de payload. No aplicar `frameId===0` indiscriminadamente a Looper, que funciona en frames.
6. Offscreen sólo acepta órdenes del worker/contexto interno autorizado; no confiar en un campo `type` enviado por cualquier content script. Validar buildId/blobUrl/fileName/directoryId y deduplicar operaciones.
7. No almacenar token en storage, IndexedDB, jobs, logs o diagnósticos. Identidad por cuenta y epoch; revocar operaciones al cambiar cookie.

Aceptación: usar token ficticio centinela. Probar URL ajena, protocolo inseguro, subdominio engañoso, userinfo, redirect externo, cursor de otro usuario y emisor inesperado. Todos deben rechazarse antes de enviar Authorization. Afirmar ausencia del centinela en respuestas a content, mensajes DOM, storage y tráfico de commerce. Las pruebas no deben imprimir tokens reales ni enviar el centinela a servicios externos.

Documentación contrastada con Context7: Chrome recomienda tratar mensajes de content scripts como no confiables, no enviarles secretos y no permitir fetch arbitrario. Referencias: https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure y https://developer.chrome.com/docs/extensions/develop/concepts/network-requests.

### P0 / T04 — Reintentos, timeouts y lectura completa de respuestas

Estado: Retry-After reproducido; timeouts/cobertura de APIs confirmados estáticamente.

Archivos: `download-core.js:23`, `:38`, `:201`; `soundcloud-http.js:41`; `page-intake.js:279`; `soundcloud-likes-source.js:31`; `likes-jobs.js:83`, `:98`; `player-tools-commerce.js:47`.

Cambios:

1. Extraer una política HTTP pequeña reutilizable, compatible con los contextos actuales, sin migrar a framework.
2. Distinguir header ausente, vacío, inválido, segundos y fecha HTTP. Usar reloj y espera inyectables en tests. Añadir jitter al backoff sin hacer flaky las pruebas.
3. No reintentar antes del Retry-After del servidor por truncarlo a 10 segundos. Si excede el presupuesto de espera interactiva, pausar/reprogramar con retryAt o retornar un error rate_limited accionable.
4. Mantener máximo de intentos y presupuesto total por etapa. Transitorios GET: red recuperable, 408/425/429/500/502/503/504. No reintentar abort voluntario ni un error permanente por defecto.
5. Timeout incluye llegada de headers Y lectura del body. Actualmente response.arrayBuffer/text se ejecuta fuera del try de fetchWithRetry: fallos leyendo el cuerpo no reciben el mismo retry.
6. Reintentar la unidad completa idempotente —manifest o segmento— ante fallo de lectura; cancelar body de respuestas abandonadas. Limitar bytes para respuesta JSON/playlist/audio/cover.
7. Aplicar política a resolución de fuente y enumeración de likes, no sólo a CDN. Distinguir cancelación del usuario y timeout con códigos separados.
8. POST de checkout/licencia/eventos necesita timeout, pero NO retry automático ciego. Sólo reintentar si existe idempotency key y contrato servidor probado. La cola de commerce no debe quedar bloqueada por analytics pendiente.

Aceptación: tabla de todos los códigos; headers ausentes/fecha/pasado/futuro; error de DNS simulado; socket/body cortado; servidor nunca termina body; abort previo/durante espera/lectura. Verificar cantidad exacta de requests, timers y listeners limpiados. Documentar el presupuesto: reintentos de red × posibles builds × resoluciones; no afirmar un máximo global ignorando número de segmentos/páginas.

### P0 / T05 — Cancelar y drenar hermanos HLS antes de renovar fuente

Estado: reproducción Node VM confirmada, confianza alta.

Archivos: `download-core.js:227`, `:253`, `:559`; `offscreen.js:60`, `:104`; `track-download-execution.js:33`.

Cuatro workers usan Promise.all. Si uno falla, la promesa exterior rechaza y los demás siguen consumiendo la cola. Offscreen elimina activeBuilds en finally aunque puedan quedar fetches vivos. El retry 401/403/404 puede iniciar otro build mientras sigue el anterior.

Cambios:

1. AbortController por build, vinculado al signal externo. Ante primer error fatal: abortar hermanos, impedir nuevas asignaciones de segmentos y esperar que todos terminen antes de resolver/rechazar.
2. Preservar el error original que disparó el fallo; no reemplazar 403 por AbortError de un hermano.
3. Liberar buffers, listeners y registro activo sólo después del drenaje.
4. Usar IDs distintos por intento de build o una estructura padre/intento inequívoca. Una respuesta/progreso tardío no puede actualizar un intento nuevo ni eliminar su controller.
5. Limitar recursión/ciclos en master playlists. Rechazar características no soportadas de HLS con código explícito en lugar de producir un archivo aparente. Verificar maps, variantes, byte ranges y cifrado con fixtures antes de declarar soporte.

Aceptación: 7 segmentos, primero 403 y otros 3 pendientes; después del error no se solicitan 5–7. activeBuilds queda vacío sólo al terminar todos. Renovación no solapa builders ni duplica save. Repetir con 503 agotado, abort y error leyendo body.

### P0 / T06 — Renovación de fuente coherente y guardado único

Estado: renovación acotada a dos builds observada; otros riesgos pendientes de pruebas adversariales.

Archivos: `track-download-execution.js:33`, `:57`, `:75`; `download-source.js:124`; `stream-selector.js`; `download-track.js`.

El bucle llama nuevamente resolveSource con el trackData original. Puede renovar URL CDN si el resolver sigue válido; no implica refrescar siempre metadata/track_authorization. Resolver tiene su propia recuperación 401/403/404. La cobertura previa simula success en segundo intento y no comprueba este conjunto con URLs realmente distintas.

Cambios:

1. Contrato explícito de renovación: razón, intento y última fuente. Si corresponde, refrescar metadata autorizada y resolver una URL nueva conservando identidad del track, preferencia de formato y transformación.
2. Alinear protocolo/preset/MIME/flags de original con la nueva fuente; no conservar isOriginalDownload al caer a HLS.
3. Máximo una renovación por operación ante 401/403/404 de medios. Separar acceso denegado/track retirado de URL caducada; no esconder error permanente tras mensajes genéricos.
4. Verificar cancelación antes de resolver, antes de renovar, antes de build y antes de guardar. Reaplicar efectos sólo sobre audio fuente limpio, nunca sobre salida ya procesada.
5. Guardar una vez por operación. No reintentar save por un error de limpieza/revoke. Diferenciar build, save y cleanup.

Aceptación: CDN vieja=403, nueva=200; resolver viejo inválido; refresh cambia progressive→HLS; original→transcode; nuevo 404 permanente; cancel en renovación; save complete seguido de fallo de revoke. Un único archivo confirmado y transform aplicada una vez.

### P0 / T07 — Presupuesto de memoria real, incluyendo loops 1×

Estado: rutas de asignación confirmadas estáticamente, no medición ChromeOS.

Archivos: `loop-audio-renderer.js:98`, `:110`, `:144`, `:211`, `:324`; `download-core.js:258`, `:375`, `:453`, `:568`; `metadata.js`.

El límite de 128 MiB cubre algunos PCM de SALIDA, no el decode de entrada ni el archivo comprimido. A velocidad 1× render() retorna copySegment antes de esos límites. Exportar un loop pequeño también decodifica la pista completa. finalizeLoopBlob no cierra AudioContext si decodeAudioData falla antes de entrar al segundo try/finally.

Cambios inmediatos:

1. Validación común previa a cualquier copia/render, incluida tasa 1. Evitar overflow, dimensiones imposibles y NaN.
2. Presupuesto previo al decode usando metadata como indicio conservador, formato y límites de bytes; revalidar dimensiones decodificadas. Metadata no confiable no sustituye un límite de lectura.
3. Meter toda la vida de AudioContext, incluido decode, dentro del finally de cierre. No afirmar que AbortSignal detiene decodeAudioData/OfflineAudioContext: comprobar las capacidades reales y evitar iniciar trabajo que no puede cancelarse con seguridad.
4. Contabilizar comprimido, copias, PCM entrada, segmento, PCM salida, WAV, Blob, metadata y buffers WASM. Error `memory_budget_exceeded` localizado antes de la asignación riesgosa siempre que sea posible.
5. Liberar chunks y referencias pronto; limitar portadas y audio original de gran tamaño. Medir si los Blobs se materializan o van a disco; no asumirlo.
6. Tratar el límite como protección, no como solución completa para sets largos. Segunda iteración: investigar guardado incremental/staging temporal de HLS y tagging compatible. Evitar construir varios buffers completos cuando el formato lo permite. No incorporar un transcoder pesado sin medir beneficio/memoria.

Estimación de partida, NO medida de RSS: PCM estéreo Float32 a 48 kHz ≈21,97 MiB/min. 5 min ≈109,9 MiB; 30 min ≈659,2 MiB; 60 min ≈1.318,4 MiB. Un loop de 10 s de un set de 60 min conserva ese decode enorme. El techo 128 MiB equivale a ~5,83 min de salida a ese formato; a 0,5× sólo ~2,91 min de entrada para export completo.

Audio MP3 128 kb/s de 60 min ≈54,9 MiB comprimidos. Progressive con tagging y Blob puede retener varias representaciones del tamaño comprimido; HLS añade chunks + concatenación. Es razonable presupuestar inicialmente ~2–4× comprimido más metadata, pero medir: no es un techo garantizado. Bulk sano procesa un track a la vez; enumeración/estado y segmentos huérfanos pueden añadir memoria. Un loop largo 1× sin límite puede superar varios GiB al coexistir PCM original/copia/WAV/Blob.

Aceptación: límites con objetos sintéticos sin reservar GiB en tests, y pruebas browser con audio sintético controlado. Cubrir tasas .25/.5/1/2/4, mono/estéreo, frecuencias diversas, loop pequeño de entrada grande, decode fallido, y 20 trabajos sucesivos sin crecimiento retenido. Verificar audio reproducible, no sólo tamaño de archivo.

### P1 / T08 — Cola, recursos offscreen y ciclo de vida del worker

Estado: cola individual finita por resolución de promesas y exclusión bulk observadas; ausencia de timeout/cancel de individuales confirmada estáticamente. Carreras adicionales requieren reproducción.

Archivos: `bulk-job-manager.js:39`, `:56`, `:285`, `:312`, `:326`, `:651`, `:741`, `:843`; `offscreen.js`.

La cola de individuales se recupera de un rechazo; no queda envenenada sólo por rechazar. createJob impide bulk mientras hay individuales y las individuales se rechazan con bulk activo, incluso pausado. NO describir el flujo normal como bulk e individual siempre concurrentes. Revisar especialmente retryFailedJob, limpieza de un job terminado y nuevos trabajos durante cierre offscreen.

Cambios:

1. Operaciones con ID y estado observable: queued/resolving/downloading/processing/saving/completed/failed/cancelled/interrupted. Admisión y recursos coordinados para single/loop/bulk/retry.
2. Cola acotada, FIFO según admisión, cancelación por ID y feedback de posición. Elegir un máximo razonable documentado; no acumular acciones invisibles indefinidamente.
3. Una operación colgada no bloquea todas: presupuesto por etapa, cleanup y siguiente job verificables. Distinguir pausa bulk de cancelación; un bulk pausado no debe parecer descarga individual rota.
4. Serializar creación Y cierre offscreen con uso/lease/generación; impedir cerrar un documento adquirido por un trabajo nuevo. La promesa compartida actual arregla creación concurrente normal, no certifica todas las carreras de cierre/reinicio.
5. Deduplicar build/save reentregados tras fallo de mensaje. `sendOffscreenMessage` reintenta hasta 12 veces; no usarlo como autorización para repetir side effects.
6. Reconstruir estado después de suspensión/reinicio: reconciliar descarga guardándose usando downloadId/checkpoint. Sin garantía de exactly-once ante caída entre save y checkpoint, marcar estado ambiguo y evitar duplicar automáticamente.
7. Elegir minimum_chrome_version según APIs realmente necesarias o implementar fallback probado. runtime.getContexts requiere Chrome 116+. No llamar API ausente sin mensaje claro.

Aceptación: dos singles, single+loop, bulk+single simultáneos, retry bulk+single, fallo inicial offscreen, rechazo de job seguido de éxito, cola cancelada, cierre durante alta nueva, worker reiniciado en cada etapa. Contador real de builders simultáneos <=1 para entradas válidas. Resto de segmentos de T05 también debe ser cero antes del próximo build.

Referencias consultadas: https://developer.chrome.com/docs/extensions/reference/runtime y https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle. Chrome documenta límites de inactividad, duración de solicitudes y respuesta fetch; mantener un timer no sustituye tolerancia a terminación.

### P1 / T09 — Bulk likes grande, privado, cancelable y sin truncamiento silencioso

Estado: riesgos y diferencias confirmados estáticamente; escala/límites efectivos pendientes de medir.

Archivos: `page-intake.js:279`, `:557`, `:613`; `content.js:178`; `bulk-job-manager.js:160`, `:165`, `:778`; `soundcloud-likes-source.js`.

Cambios:

1. Enumeración autenticada y validación de cursores conforme T03. Compartir helper con Explorer sin requerir Pro.
2. Cursor repetido → error de colección parcial con checkpoint, no break que aparenta éxito completo. Distinguir fin explícito, página vacía con next_cursor y página inválida.
3. 401/403 → detener operación con mensaje correcto; 429/5xx/timeout → política T04 con checkpoint. No reiniciar desde página 1 después de cada fallo.
4. En cada página confirmar sesión/epoch e identidad fuente. /you/likes queda vinculado a la cuenta que inició la operación. Un cambio de cookie invalida bulkContext y selectionCache aunque la URL no cambie.
5. El bulk actual pasa extractionId=null; necesita AbortController/operationId propio, incluso si se navega mientras enumera. Definir si navegar conserva la operación en background o la cancela; no mezclar resultados de rutas.
6. No recortar All por public_likes_count. Decidir explícitamente tratamiento de likes que son playlists, tracks privados inaccesibles, previews o entradas retiradas. Mostrar omitidos por categoría, sin prometer todos los contenidos de una cuenta.
7. Para miles de tracks, mover lista durable a IndexedDB por lotes y mantener en storage.session un resumen pequeño, no reescribir todos los tracks en cada progreso. Medir cuota y payload antes de migrar; la selección manual debe paginar/virtualizar y no depender de devolver toda la colección en un mensaje.
8. No marcar un job completed como éxito pleno si contiene failed; usar completed_with_errors o resumen equivalente, retry sólo de fallidos y omitidos explícitos.

Aceptación: 50/200/1.000/10.000/50.000 entradas sintéticas por páginas, con duplicados y playlists; memoria y almacenamiento acotados; count final correcto; sesión cambia en página 2; cursor repetido/ajeno/inválido; recuperación en página intermedia; cancel en espera; cierre de popup y navegación SPA. No ejecutar 50.000 descargas de audio reales para validar enumeración.

### P1 / T10 — Publicar progreso real de colecciones Explorer

Estado: confirmado estático, confianza alta.

Archivos: `likes-library.js:166`, especialmente `:182`; `likes-explorer.js` poll; `likes-jobs.js:235`.

commitCollection actualiza colección sólo si no hay activeGeneration o termina la paginación. Después de primera página ya hay activeGeneration: count/revision quedan congelados hasta última página aunque job.count crece. La UI puede mostrar indexación pero no incorporar nuevos resultados. El test grande responde complete=true de manera simulada y no detecta esto.

Cambios: publicar cada commit de la generación activa incompleta; durante refresh de una biblioteca completa conservar la generación anterior hasta commit final. Expresar ambas reglas, no reemplazar siempre activeGeneration. Periodos/cachés deben seguir revision y generation.

Aceptación: tres páginas con pausas entre ellas: count/revision y cards evolucionan 50→100→150. Refresh de completa mantiene snapshot anterior durante indexado y cambia atómicamente al terminar. Pause/error/delete/rebuild no resucitan resultados viejos.

### P1 / T11 — Borrado, migración y almacenamiento de Explorer

Estado: alcance de borrado y retención confirmados estáticamente; migración/reentrada pendientes de nuevas pruebas.

Archivos: `likes-library.js:121`, `:136`, `:196`; `likes-jobs.js:102`, `:208`, `:233`.

Hechos y cambios:

1. eraseCollection(imagesOnly=true) filtra por cuenta y `imagesOnly || collectionId`, así borra accountArtwork y TODOS los collectionArtworkJobs de la cuenta. Definir contrato: borrar portadas de colección conserva referencias de otras; si la acción realmente es global, nombrarla y confirmarla como global. Preferir semántica coherente con el selector actual.
2. Borrado completo no incluye tracks ni accountArtwork. Hacer garbage collection por referencias de colecciones/generaciones, sin borrar recursos compartidos. Comprobar también biblioteca legacy para no reintroducir datos borrados.
3. ensureLegacyMigrated copia datos y artworkJob, pero no collectionJobs. Revisar migración de indexado/refresh incompleto: no dejar sólo snapshot parcial y job legacy invisible ejecutándose aparte.
4. Hacer migración idempotente dentro de límites transaccionales; revalidar estado al entrar a la transacción para aperturas concurrentes. Si falla por cuota, conservar v1 utilizable y permitir reintento seguro.
5. Borrado/cancel/refresh deben invalidar epoch antes de que resultados tardíos escriban. Capturas de error de collectionTick no deben pausar/reprogramar un job nuevo creado mientras fallaba el anterior.
6. Al completar refresh, reubicar artwork job a generación nueva. Revisar spread de START_LIKES_ARTWORK: `...old` puede restaurar generación vieja sobre la actual. Verificar validez de sesión antes de commits de collectionArtworkTick, como ya hace la ruta legacy.
7. IndexedDB open/versionchange/blocked: evitar conexiones antiguas que bloqueen actualización o opening resuelto con conexión cerrada.

Aceptación: dos cuentas, dos colecciones con tracks/artwork compartidos y exclusivos; borrar una conserva la otra; borrar última libera datos sin referencias. Migración de v1 completa/parcial/pausada; fallo transaccional; dos aperturas; cuenta cambia durante fetch de artwork; refresh mientras una página vieja falla. No declarar rollback de esquema seguro si no se probó.

### P1 / T12 — Rendimiento real de Explorer, no sólo virtualización DOM

Estado: complejidad problemática confirmada estáticamente, impacto cuantitativo pendiente.

Archivos: `likes-library.js:105`, `:186`, `:203`; `likes-jobs.js:127`, `:213`, `:240`; `likes-explorer.js` polling.

window() usa cursor desde ordinal cero y salta uno por uno hasta offset. collectionRecords pide ventanas de 400 aumentando offset: un barrido completo acumula aproximadamente trabajo cuadrático en N. storageStats recorre stores y obtiene todos los artwork, incluyendo Blobs, para calcular tamaños. El status llama storageStats; no confundir DOM acotado con CPU/memoria de backend acotadas.

Cambios: rangos de índice que arranquen en ordinal solicitado; agregados de conteos/bytes/periodos mantenidos con escrituras o calculados bajo demanda; status liviano; caché acotada por bytes además de número de entradas; invalidación efectiva por account/collection/generation/revision. No cargar Blobs sólo para sumar su tamaño cuando ya existe metadata bytes.

Aceptación: IndexedDB REAL con 1k/10k/50k; medir consultas inicio/fin/búsqueda y status. Registrar cursores visitados y memoria, verificar crecimiento cercano a lineal para barrido completo y costo proporcional a ventana para viewport. Probar cambio de cuenta y borrado con cachés cargadas.

### P2 / T13 — Looper, gestos, accesibilidad y copy

Estado: cambios inspeccionados parcialmente; no hay causa demostrada de fallos generales de descarga atribuible al rediseño.

Archivos: `looper.js` rangeDraw; `tempo-control-main.js:875` y handlers pointercancel; `likes-explorer.js`; popup.html.

Priorizar después de T01–T12:

- pointercancel no debe confirmar un rango nuevo ni consumir trial; comprobar estado draft, captura de puntero y cambio de track durante autorización.
- Marcador único no activa loop ni consume uso; una activación completa consume sólo una vez; editar no abre sesiones nuevas por cada pixel.
- Revisar respuestas tardías de autorizaciones simultáneas y desmontaje de listeners tras SPA.
- Teclado, foco, aria-label localizado y targets utilizables; grilla fija de seis columnas puede ser demasiado pequeña a 390 px. No imponer un rediseño general.
- El botón de refresh que pausa no debe verse únicamente como spinner sin acción accesible.
- Distinguir visualmente descargas gratis de Explorer/Player Tools Pro. Preservar fallback artwork de d7cd47a y ajustes de f902720.
- Revisar debug.log y logging de runtime para no incluir metadata/URLs sensibles; debug.log no estaba en el ZIP inspeccionado.

Aceptación: tests e2e de loop/tempo/effects existentes, más pointercancel y autorización tardía en UI real. Manual teclado/zoom/viewport pequeño en Chromium. No dar por hecha una auditoría de accesibilidad completa por pasar el test de geometría.

### P1 / T14 — Onboarding, compatibilidad y paquete exacto de release

Archivos: background.js onInstalled; index.html; scripts/package-extension.js y .ps1; manifest/package/lock; tests browser.

Hechos: welcome abre sólo con reason===install; no update. El HTML de welcome selecciona texto de un diccionario cerrado; locale/version no se interpolan directamente como HTML. No se demostró XSS en esa ruta. Landing usa dominios sctd.vpugliese.online y soundcloud-downloader.online en distintos lugares; verificar cuál sirve cada recurso.

Cambios/validación:

1. Visitar dominio real con view=welcome/goodbye y assets necesarios; verificar status HTTP, DOM y consola, no sólo HEAD. Sin enviar formulario ni feedback real.
2. Onboarding offline: guía de recarga también disponible localmente en popup. Reintentar abrir welcome automáticamente no debe crear múltiples pestañas.
3. Revisión completa de host_permissions y API compatibility; establecer versión mínima verificada o fallback. No quitar cookies hasta migrar todas las funciones autenticadas. Investigar permiso opcional si mejora transparencia sin romper bulk.
4. Nueva versión única para el build corregido. Actualizar manifest/package/lock/landing aplicable; incluir identificador no sensible de build en información diagnóstica.
5. Generar ZIP en copia/staging temporal; no sobrescribir el artefacto original hasta preservar su hash. Comparar allowlist, referencias manifest/HTML/importScripts/imports/WASM/assets y contenidos transformados.
6. Fallar packaging si test login no se desactiva. Comprobar JS y PowerShell producen contenido equivalente normalizando diferencias de archivo justificadas; no basta comparar que ambos terminan.
7. Cargar la extensión desde ZIP extraído. Adaptar harness a una raíz de artefacto, sin depender de index.html o scripts de test que no se distribuyen. El test download actual navega a index.html en source; ese archivo no está en allowlist y no es necesario para runtime productivo.
8. Verificar ausencia de credenciales de prueba activas, logs, docs internos, .env y tests. Confirmar assets y WASM ejecutables con CSP de producción.
9. Entregar hash del ZIP probado y vincularlo a commit/version. Subida a CWS y despliegue de landing quedan fuera del plan automático.

Aceptación: test desde ZIP con login de prueba imposible, gratis funcional, Pro cubierto por fixture interno de test que no altere el paquete distribuido; prueba real pública MP3/HLS; onboarding install/update; todos los archivos de runtime presentes. La UI de test nunca se habilita al restaurar un test-pro viejo en producción.

### P2 / T15 — Observabilidad sin datos musicales ni secretos

Estado: commerce actual envía eventos pseudónimos; no hubo revisión exhaustiva de backend/despliegue.

Archivos: player-tools-commerce.js:147; background.js mensajes de completion; services/player-tools-license/src/validation.mjs e index.mjs; feedback.

Primero diagnóstico LOCAL exportable y visible al usuario. Campos permitidos: build/version, código de etapa y error enumerado, familia HTTP/status permitido, formato/protocolo enumerado, número de intento, tiempos agrupados, conteos agrupados, resultado de cancel/timeout, categoría de destino y capacidades del navegador. No serializar objetos Error completos ni cuerpos de respuesta.

Prohibido recolectar cookie/token, URL o ID de track/perfil, títulos, artista, playlist, nombres de carpetas, cursores, headers o identidad SoundCloud. No usar esos valores como scope, etiqueta, key o cause. No incluirlos en capturas automáticas. Reducir identificadores persistentes; diagnóstico local no necesita installationId.

Si se implementa envío remoto, separar aprobación/despliegue y disclosure de la corrección funcional. Whitelist de valores, no sólo nombres de propiedades o longitud <=64. Opt-in para diagnóstico detallado, retención corta y deduplicación por operación efímera. No aumentar silenciosamente el tracking actual. Timeouts y best-effort: analytics jamás bloquea descarga, UI o licencia.

Métricas útiles con denominador: operaciones iniciadas/finalizadas por build y etapa, éxitos/parciales/cancelaciones/fallos esperados/fallos inesperados; colas bloqueadas; retries que recuperan; errores de auth y reload. Separar tasa de éxito de downloads de formularios de desinstalación.

Aceptación: pruebas negativas con centinelas en TODOS los campos de entrada. Ninguno aparece en payloads/logs exportados. Inventario de destinos y payloads legible por usuario; checkout/licencia puede necesitar email/license key y no debe confundirse con analytics.

## 6. Secuencia de ejecución recomendada

Cada unidad debe incluir reproducción que falla antes, cambio mínimo y verificación. Si una hipótesis no se reproduce y el código no la sostiene, documentar/refutarla antes de añadir complejidad.

1. Baseline Git/artefacto y pruebas de regresión T01, T02, T04, T05, T07, T10, T11. No cambiar todas las arquitecturas a la vez.
2. Hotfix selector T01 y estados de extracción T02, conservando contrato compatible mientras se mueve auth.
3. Frontera de auth/mensajes T03, seguida de paginación segura de T09. No devolver tokens durante la transición.
4. Política HTTP T04 y drenaje HLS T05.
5. Renovación/single-save T06 y límites/cleanup T07.
6. Scheduler/lifecycle T08, incluyendo todas las entradas de retry y recuperación.
7. Bulk grande T09: checkpoints, IDB y selección paginada. Medir antes/después.
8. Explorer T10 y T11 en cambios separados; luego rendimiento T12.
9. Regresiones Looper/UX T13. No usar esta etapa para cambiar productos o pricing.
10. Diagnóstico local T15 y transparencia; observabilidad remota sólo con alcance explícito.
11. Empaquetado y gate de release T14; smoke con artefacto final y reporte.

No hace falta esperar las mejoras cosméticas para preparar un hotfix del descargador, pero no etiquetar ese hotfix como solución completa si queda un P0. Para una release que anuncie confiabilidad y Explorer estable, completar también integridad de colecciones y validación del paquete.

## 7. Matriz mínima de pruebas

| Área | Casos imprescindibles | Evidencia requerida |
| --- | --- | --- |
| Auth | logged in/out, cookie cambia/borrada/expirada; /you/likes y /perfil/likes | Mensaje correcto, sin token a content ni resultados de cuenta anterior. |
| Extracción | pestaña anterior a instalación, SPA, popup temprano, ruta no soportada, track retirado | Estado terminal correcto; retry controlado; sin loading eterno. |
| Selección | 0/25/26/49/50/51/200/1k, All y manual | Límite válido, orden y alcance exactos. |
| Paginación | cursor repetido/inválido/ajeno, página vacía con next, duplicados, playlists, privados | Fin real o parcial explícito; checkpoint y no pérdida silenciosa. |
| Red | 408/425/429/500/502/503/504; 401/403/404; fecha Retry-After; body truncado/colgado | Presupuesto de requests y espera; abort y códigos correctos. |
| HLS | init segment, variante master, ciclo master, fallo de hermano, refresh | Drenaje previo al retry; formato válido y guardado único. |
| Concurrencia | single+single, loop+single, bulk+single, retry bulk, creación/cierre offscreen | Máximo builder activo y transición de recursos verificadas. |
| Cancelación | queued, resolving, backoff, fetch/body, decode/render, saving | Sin nuevos trabajos, recursos liberados, estado honesto si guardado ya ocurrió. |
| Persistencia | reiniciar worker en build/save/checkpoint; cerrar popup/browser | Recuperación definida, sin duplicados automáticos en estado ambiguo. |
| Memoria | pistas 5/30/60 min; loop corto en pista larga; 1×/0,5×; HLS y progressive | RSS/heap y errores previos a asignaciones excesivas. |
| Explorer | 3 páginas reales IDB, refresh/pause/error/delete; v1→v2; 2 cuentas/colecciones | Atomicidad, aislamiento, progreso y limpieza correctos. |
| Escala | 1k/10k/50k metadata en IDB real | Tiempo, bytes, cursores visitados y requests medidos. |
| Paquete | ZIP extraído, credenciales desactivadas, recursos/CSP, versión/hash | Las pruebas apuntan al artefacto entregado. |

Comandos existentes útiles, primero inspeccionando scripts y ejecutando en entorno temporal cuando escriban artefactos:

```sh
npm test
npm run test:e2e:download
npm run test:e2e:likes
npm run test:e2e:popup
npm run test:e2e:feedback
npm run test:e2e
npm run test:e2e:tempo
npm run test:e2e:effects
node docs/audits/download-failures-20260916.cjs
```

`download-failures-20260916.cjs` usa VM y un único segmento con resolver simulado. Sirve de control, NO demuestra ausencia de solapamiento HLS o renovación real. Añadir tests multi-segmento y rutas completas.

Prueba live existente, sólo tras inspeccionar y con perfil aislado sin cuenta:

```sh
node docs/audits/download-diagnosis-20260916.cjs
```

Ese diagnóstico usa `SCDL_AUDIT_ROOT` si se proporciona, pero hay que adaptarlo para cualquier supuesto de source que no exista en ZIP. No registrar URLs de usuarios; usar pistas públicas de control elegidas para la prueba y no enviar feedback/checkout/eventos reales desde harness. Bloquear POST de negocio/analytics en fixtures sin falsear el tráfico CDN bajo prueba.

Si el sandbox impide Chromium, localhost o red, solicitar la escalación correspondiente. No confundir error del entorno con fallo del producto ni sustituir una prueba live por mock sin declararlo.

## 8. Protocolo ChromeOS / ID 86

La arquitectura hace plausible el congelamiento, pero no demuestra qué sufrió ese usuario. Solicitar modelo/RAM, versión ChromeOS/Chrome, build, formato, duración aproximada, single/bulk/loop y efectos. No solicitar historial musical ni cookies.

Reproducir en Chromebook real representativo, con perfil de prueba, pocas pestañas y luego carga de uso normal. Medir proceso SoundCloud, service worker y offscreen; registrar RSS/heap, long tasks, duración y resultado. CPU throttling de desktop no equivale a poca RAM de Chromebook.

Escenarios: MP3 progressive y AAC/HLS cortos/largos; bulk de pistas medianas; dos singles; loop 10 s en archivo largo; export 1×/0,5×; pérdida de red en segmentos; veinte operaciones sucesivas. Detener antes de presión peligrosa, usar límites escalonados y no reservar GiB en la máquina del usuario sin control. Comparar versión anterior/corregida con las mismas entradas.

## 9. Caso Lorenzo y lectura de formularios

No adjudicar una causa única a Lorenzo. Diferenciales: logout real que impide /you/likes; API/extracción fallida ocultada por loading; exactly-50 bug; selector 50 frente a All; paginación; diferencia entre botón gratuito y Explorer Pro; pestaña antigua. Reinstalar no es primer paso.

Información a pedir antes de atribuir causa: si estaba logueado en el momento exacto, ruta usada, captura del popup sin datos sensibles, navegador/OS/version/build, cantidad aproximada de likes, si ve 50/All, si pulsó descarga gratuita o Explorer, síntoma exacto (loading, error, cero archivos, 50 archivos o interrupción a mitad). Su frase de logout puede ser literal o un malentendido lingüístico.

Pasos guiados: iniciar sesión si quiere /you/likes; abrir ruta; recargar una vez si la pestaña precedía la instalación; abrir popup; comprobar colección detectada; seleccionar All conscientemente; ejecutar y observar etapa/código. Para control logged out usar un perfil público /usuario/likes y una pista pública individual. No pedirle desinstalar repetidamente.

Datos informados, NO recalculados contra CSV original: 95 respuestas válidas al excluir IDs 2 y 20; 61 downloads_did_not_work; 91 hashes distintos; 59 hashes con al menos un fallo; 59/79 orígenes considerados accionables ≈74,7%. Son proporciones entre quienes contestaron, no tasa de uninstall ni de fallos por descarga. Hash no equivale a persona. `2026.9.10` fue reutilizada, por lo que no identifica un build.

Para evaluar mejoras hacen falta denominadores comparables y build exacto. No atribuir los 61 reportes al mismo bug. Formularios internacionales y comentarios aislados no permiten cuantificar contribución de cada causa.

## 10. Privacidad / acusación de token logger

No se encontró en la ruta normal revisada una intención de enviar oauth_token al backend propio; commerce envía instalación/eventos y licencia usa datos de compra. Sin embargo, el resumen anterior era demasiado fuerte: el token sí cruza del worker al content script y faltan validaciones de destinos en otras rutas. Corregir T03 antes de afirmar que es sólo percepción. No hay evidencia de robo ocurrido.

Permisos actuales: cookies, tabs, downloads, offscreen, notifications, storage, alarms. Hosts: SoundCloud, APIs api/api-v2, subdominios sndcdn, media-streaming.soundcloud.cloud y backend sctd.vpugliese.online. Inventariar de nuevo al implementar; permisos no garantizan por sí solos que un fetch sólo salga a esos destinos.

Destinos observados: páginas/APIs/CDN SoundCloud; backend propio `/api/player-tools` (checkout, licencia, events); landing y feedback; fuentes Google en landing; Turnstile; Lemon Squeezy desde backend; enlaces CWS y GitHub. Completar inventario por cada request, redirect y payload antes de cerrar seguridad. La auditoría no validó servicios productivos ni secretos del servidor.

Copy recomendado después de corregir la frontera: explicar que el acceso de sesión se usa localmente para consultar likes/contenido permitido en SoundCloud, que no se pide copiar tokens ni contraseñas y qué datos pseudónimos sí se envían. No afirmar ausencia total de red/analytics. Revisar necesidad de cookies opcional sin romper funciones existentes.

## 11. Mapa de commits para el implementador

| Commit | Área a revisar | Deuda/cobertura relevante |
| --- | --- | --- |
| 9a4a6c2 | UI popup/Explorer, gestos A/B, drafts, test Pro, packaging | Pointercancel/trial, lectura de UI pequeña; tests del source con test login no equivalen al ZIP. |
| 1f05da2 | Colecciones IndexedDB v2, identidad fuente/cuenta | T10–T12; progreso parcial, migración incompleta, borrado y escalabilidad. |
| 937667c | sourceUserId después de spread; artwork/migración | Corrección de fuente externa observada; ampliar test a ciclo completo y generación artwork. |
| d050a4f | Eliminación Likes Map y nombres de colecciones | Comprobar listeners, scroll restoration, selección/bookmarks; no reintroducir Map. |
| 44e01b8 | UI/locales/ofertas Pro; commit omitido del prompt | Leer diff sin el extenso mensaje del commit; no asumir sólo los diez enumerados. |
| f7e0902 | Iconos, manifest, layout y acceso Explorer | Verificar assets ZIP/CSP, labels localizados y click targets. |
| fd4c67d | Remueve empty state al aparecer cards | Arreglo visual limitado; no corrige commitCollection ni demuestra indexación gradual. |
| 49c047e | Welcome sólo install y reload_required popup | Correcto en pruebas locales; falta dominio real/offline y diferenciación otros errores. |
| 026d8c4 | Retry medios y renovación una vez | T04–T06: Retry-After defectuoso, lectura body fuera de retry, HLS huérfano. |
| 5614126 | Bulk=1, cola singles/loops, creación offscreen, PCM=128 MiB | Mejora normal; faltan T07–T08 y drenaje. No es techo de memoria total. |
| fce0ece | Versión y diagnóstico | Identificar artefacto; no usar diagnóstico como demostración. |
| d7cd47a | Fallback artwork/avatar | Preservar y volver a ejecutar tests de preferencia/URLs inválidas. |
| f902720 | Orden status/teleport | Preservar; no soluciona fallos de pipeline. |

Releer `git show --format=short <commit> -- <rutas>` por archivo, con salida no truncada. No necesitas revertir los commits grandes para corregir estos problemas.

## 12. Criterio de finalización y release

Veredicto provisional de esta revisión para presentar la versión como corrección completa: **do not ship** hasta resolver y demostrar los P0. No significa que ninguna descarga actual funcione: el pipeline sintético browser pasó y hay mejoras reales.

Gate antes de entregar candidato:

1. Cada P0 con reproducción previa y test de regresión que pasa después; no hay token en content/mensajes ni destinos autenticados arbitrarios.
2. Exactly-50, /you/likes logged out, Retry-After, HLS hermanos y loop 1× cubiertos específicamente.
3. Ningún camino probado queda en cola/loading indefinido; cancel/timeout termina y libera recursos; audio guardado se valida.
4. Bulk All de 1k y 10k metadata sintética completa paginación, preserva sesión y no presenta truncamiento como éxito. 50k medido como prueba de escala.
5. Migración/borrado/progreso de Explorer no dañan otras cuentas/colecciones y regresiones de Looper pasan.
6. Riesgo de memoria acotado y medido; ChromeOS probado o limitación declarada con protección conservadora, nunca promesa de que 128 MiB evita cualquier congelamiento.
7. ZIP final extraído supera pruebas; versión única, hash registrado, test login desactivado; dominio welcome comprobado o fallback local funcional y limitación documentada.
8. Informe final del implementador: cambios por unidad, pruebas y entorno, fallos pendientes, riesgos y comandos reproducibles. Separar source/ZIP, mock/live y desktop/ChromeOS.

No reportar «todo arreglado» sólo por pasar las 39 verificaciones actuales. Si falta acceso a una sesión real, ChromeOS, despliegue o artefacto CWS, especificar qué se probó y qué no, y entregar el candidato con esas condiciones. Publicación y contacto con usuarios requieren instrucción explícita posterior.
