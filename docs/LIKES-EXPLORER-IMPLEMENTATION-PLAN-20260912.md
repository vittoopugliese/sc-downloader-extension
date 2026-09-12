# Likes Explorer Pro: plan técnico de primera versión

Fecha: 2026-09-12. Estado: diseño de implementación, todavía no implementado.
Base inspeccionada: `629b55f558a75562c69ef7d98c1346f8ebce8a86`, incluyendo cambios locales de Player Tools en curso.

## 1. Pedido y resultado esperado

El usuario quiere acceder a likes antiguos con la misma facilidad que a los nuevos, aprovechando el selector virtualizado del popup y una galería visual amplia dentro de Player Toolkit. “Promptear la lista” significa desplegar el selector, recorrerlo rápidamente y elegir un track; no significa IA ni lenguaje natural.

Esta entrega autoriza y concreta el plan, no implementa todavía la feature. La implementación futura debe conservar las descargas gratuitas y coordinarse con los cambios locales de acceso Pro. No reiniciar ni sustituir esos cambios.

Promesa de V1: después de indexar, encontrar un track por portada, nombre o época; saltar a sus likes vecinos instantáneamente dentro del Explorer; solicitar su reproducción en SoundCloud. Ofrecer además localizarlo en la página nativa mediante scroll progresivo cancelable, describiendo su espera real.

Hay tres acciones diferentes:

| Acción | Resultado | Dependencia de infinite scroll |
| --- | --- | --- |
| Ver alrededor | Abre el Explorer en la posición original del like | Ninguna después de indexar esa zona |
| Reproducir | Solicita reproducir ese track en SoundCloud | No debe necesitar recorrer todos los likes |
| Localizar en SoundCloud | Busca, carga y centra la tarjeta nativa | Sí, si la tarjeta aún no está montada |

No llamar “teletransporte instantáneo” a la tercera acción. El índice no vuelve presentes las tarjetas ausentes del DOM.

## 2. Evidencia revisada

### Repositorio

| Archivo / símbolo | Hallazgo | Implicación |
| --- | --- | --- |
| `scripts/popup.js`: `renderVisibleSelectionRows` | Filas de 40 px, viewport máximo de 320 px, overscan de 6, spacer y translateY | Reutilizar cálculo de ventana; no copiar todo el modo descarga |
| `openSelectionPanel` | Espera `requestBulkSelectionList`; confirmación sobre 1.000 elementos | Virtualización acelera render, no primera carga |
| `enterSelectionMode` | Cada fila es un label de checkbox; selección inicia en scroll 0 | No poner botones de reproducción dentro de ese label |
| `scripts/page-intake.js`: `selectionList` | Resuelve todos los tracks y guarda `selectionCache` en memoria | No hay índice durable por usuario |
| `selectionProjection` | Sólo id, índice, título y duración | Faltan artwork, artista, permalink y fecha del like |
| `likesTracks` | `api-v2.soundcloud.com/users/{id}/likes`, páginas solicitadas de 50, `next_href`, dedupe de tracks y protección de cursor repetido | Extraer adaptador por página sin perder defensas actuales |
| `likesTracks` | Ignora entradas que no tengan `item.track`; proyecta sólo el track | Pierde fecha del like y posición entre playlists |
| `loggedInOrHydratedUser` | `/you/likes` resuelve usuario autenticado; likes públicos usan hidratación | Separar identidad del dueño de la colección e identidad de sesión |
| `scripts/download-track.js`: `fromSoundCloud` | `createdAt` y `year` derivan del track; conserva datos de streams y autorización | No usar esa fecha como likedAt ni persistir este objeto completo |
| `scripts/content.js` | Mensajes GET_BULK_SELECTION_LIST y GET_BULK_TRACKS_BY_IDS | Mantener compatibilidad del Downloader |
| `scripts/looper-main-bridge.js` | Opera sobre media descubierta: state, seek, loop, bypass | No existe un comando probado para seleccionar cualquier track |
| `scripts/looper.js` | Usa identidad del player y elementos de SoundCloud | El cambio de track debe respetar reconciliación de loops |
| `scripts/player-tools-policy.js` y `player-tools-access.js` | Archivos locales en desarrollo; autoridad de acceso en background | Integrar capability nueva; no crear segundo contador |
| `manifest.json` | MV3, storage, alarms y hosts de SoundCloud existentes | No agregar permisos amplios por defecto |

Cambios locales preexistentes al revisar: manifest, package, background, packaging, tempo core y sus verificaciones; archivos nuevos de policy/access/client y verificación de policy. Este plan no los modifica.

### Verificación ejecutada

- `node scripts/verify-page-intake.js`: pasó.
- `node scripts/verify-popup-browser.js`: pasó en escalas 1, 1.25, 1.5 y 2. Es una prueba de layout con HTML y datos preparados; no acredita reproducción ni indexación real.
- Puerto CDP local 9223: conexión rechazada; no había una sesión de diagnóstico disponible allí.
- Playwright headless, sesión aislada sin login, `https://soundcloud.com/forss/likes`: página y `/users/183/likes` respondieron 200.
- La respuesta real contenía `collection`, `next_href`, `query_urn`. Las entradas tenían `created_at`, `kind` y `track` o `playlist`.
- Ejemplo observado: like del track 201247503 en `2019-10-21T05:44:51Z`; creación del track en `2015-04-17T14:06:58Z`. Confirma que son fechas diferentes. Otra entrada era una playlist con fecha propia.
- Un scroll al fondo aumentó los enlaces `a.soundTitle__title` de 10 a 20. Se observó un payload de 23 entradas; ese incremento del DOM no prueba una petición por scroll: puede ser render diferido de datos ya cargados.
- Intento de reproducción en `https://soundcloud.com/forss/flickermood`: botón `.playButton` presente. El click no pudo completarse por overlays de consentimiento y posteriormente autenticación. No se forzó el click ni se eludió login. La reproducción y continuidad quedan sin validación end-to-end.
- La primera prueba de abrir un resultado terminó en una playlist: refuerza que no se puede tratar cualquier `soundTitle__title` como track.

El muestreo público confirma disponibilidad de fechas, no garantiza cobertura en todas las cuentas, épocas, regiones ni sesiones autenticadas. No se inspeccionaron likes privados del usuario.

La [guía oficial](https://developers.soundcloud.com/docs) documenta paginación mediante `next_href`. La [referencia pública](https://developers.soundcloud.com/docs/api/reference) corresponde a la API pública. El endpoint api-v2 usado por el repositorio y observado en el sitio es una integración con el cliente web: su forma debe aislarse en un adaptador y validarse con fixtures, no asumirse contractual por esa documentación.

## 3. Alcance cerrado recomendado

V1 incluye:

1. Índice local por usuario de SoundCloud, carga progresiva, reanudación y actualización.
2. Selector rápido en popup, con búsqueda por título/artista y acciones explícitas.
3. Explorer amplio, abierto desde Toolkit y popup: lista y galería virtualizadas, tres densidades de portada.
4. Navegación por año/mes de like; alternativa por posición y grupo “Sin fecha”.
5. Ver alrededor, conservando el orden original aunque se llegue desde búsqueda.
6. Reproducir un track mediante el player de SoundCloud, con fallback visible si requiere interacción.
7. Anterior/siguiente entre likes del contexto, mediante acciones manuales.
8. Restauración por track ancla y marcadores personales de épocas.
9. Localizar en la lista nativa como utilidad cancelable con presupuesto de tiempo.
10. Acceso Pro integrado y traducciones en en, es, pt_BR, de y ru.

Fuera de V1: búsqueda IA, análisis de portadas por color, embeddings, subir bibliotecas a servidores, sync entre dispositivos, audio propio/offscreen, descarga o caché de audio, generar playlists en la cuenta, reproducción de playlists como entradas del Explorer, shuffle inteligente y cola automática garantizada.

“Escuchar desde acá” en V1 significa reproducir el elegido y habilitar anterior/siguiente manual. No usar copy que prometa autoplay de toda la época. La cola automática requiere un hito posterior validado con fin de track, anuncios, loops, cambio manual y política de autoplay.

## 4. Diseño de interacción

### Popup

Agregar entrada `Explorar likes` para colecciones de likes; abre un modo de exploración distinto de selección de descarga. Conservar `Select` y sus checkboxes. En modo Explorer, fila con portada pequeña, título, artista, índice y botones separados de play/localizar; click en contenido principal ejecuta Ver alrededor.

Buscar no modifica `selectedIds` ni el límite de descarga. Mantener estados separados. Reutilizar función pura del rango visible si facilita ambos modos; no extraer un framework de listas. Escape vuelve a la pantalla previa. Cerrar el popup no cancela un play/localizar ya aceptado por background, pero sí libera sus suscripciones.

Mostrar resultados cacheados primero; indicar `Actualizando…`, cantidad indexada y si la colección está incompleta. No esperar el último request para permitir explorar. Sin caché, mostrar la primera página utilizable y continuar. No sugerir que años todavía no indexados están vacíos.

### Vista amplia

Overlay del content script en el frame superior de SoundCloud, preferentemente encapsulado en Shadow DOM. Mantener host único y recuperar montaje tras navegación SPA. Un nuevo acceso compacto desde Toolkit abre el overlay; no rediseñar dimensiones ni controles musicales existentes. Debe poder abrirse antes de reproducir el primer track.

Barra superior: usuario dueño, búsqueda, estado de actualización, lista/galería, densidad, cerrar. Navegación por épocas lateral o compacta según ancho. Player nativo conserva su espacio; overlay no tapa los controles inferiores. Guardar y restaurar foco y bloqueo de scroll al cerrar.

Galería: tarjetas de dimensiones estables, ratio 1:1, fallback de portada y títulos truncados. Virtualizar filas de tarjetas según ancho; ResizeObserver recalcula columnas manteniendo track ancla. Cargar imágenes sólo en ventana y overscan, con tamaños adecuados; no solicitar miles de imágenes t500x500.

Ver alrededor elimina temporalmente filtros, centra el track y lo resalta; conserva query anterior para `Volver a resultados`. No ordena por fecha de publicación. Anterior/siguiente usa la secuencia original de likes alrededor del track, incluso si se llegó desde una búsqueda. Guardar ese contexto como ids, no como números susceptibles de desplazarse al entrar likes nuevos.

Marcador: nombre editable, ownerId, trackId ancla y likedAt observado. Si el ancla ya no existe, informar y ofrecer la época más próxima, sin saltar silenciosamente a otro track.

### Estado y accesibilidad

Estados explícitos: sin cuenta/colección, no indexado, indexando, parcial pausado, listo, actualizando, offline, autenticación necesaria, rate limited, almacenamiento lleno y error recuperable. Diferenciar no-results de not-yet-indexed.

Controles accesibles por teclado; foco lógico persistente aunque la fila se desmonte; Enter para acción primaria y botón de play con nombre del track. Restaurar foco por id tras actualizar resultados. Evitar región aria-live que anuncie cada fila o cada request. Respetar reduced-motion y contrastes en ambos temas. Un shortcut global nuevo no es necesario para V1.

## 5. Modelo persistente

Usar IndexedDB en origen de extensión; background es dueño de escrituras. No usar IndexedDB del origen soundcloud.com ni chrome.storage.sync para bibliotecas. chrome.storage.local sólo para preferencias pequeñas y estado de acceso existente.

Base propuesta `scdl_likes_explorer`, versión 1:

| Store | Clave / índices | Datos |
| --- | --- | --- |
| libraries | ownerId | ownerPermalink, displayName, activeGeneration, phase, counts, lastRefreshAt, lastFullSyncAt, schemaVersion |
| entries | [ownerId, generation, kind, itemId] | sourceOrdinal, trackOrdinal nullable, likedAt ISO/null, kind, metadata mínima; índice [ownerId,generation,sourceOrdinal] |
| jobs | ownerId | jobId, generation, mode, next cursor, checkpoint, phase, retryAt, seen cursors acotados, lease |
| views | [ownerId,surface] | anchorTrackId, pixelOffset, query, mode, density, filtros |
| bookmarks | [ownerId,bookmarkId] | name, anchorTrackId, likedAt, createdAt |

Metadata de track: id, permalink canónico, title, artistName, artistId, artworkUrl, durationMs, genre opcional, publicationDate separada, availability observada. Guardar likedAt del wrapper. Para playlists sólo identidad, orden y fecha necesarios para reconciliación/posición nativa; no expandir sus tracks en V1.

No persistir objetos `fromSoundCloud` completos, tokens OAuth, client secrets, track_authorization, cookies ni URLs de audio. El cursor durable debe estar saneado: guardar sólo host/path/query permitidos para paginación, sin credenciales/client_id; reconstruir autorización al reanudar. No aceptar next_href arbitrario desde mensajes.

Cada generación tiene ordinales densos derivados del orden recibido; fechas iguales no cambian el orden. Deduplicar por kind+id dentro de generación. Cuenta total de likes del perfil puede incluir playlists/no disponibles: mostrar tracks indexados y entradas leídas por separado, sin inferir que faltan requests sólo por esa diferencia.

No usar un índice numérico como identidad. En re-like, la siguiente reconciliación reemplaza fecha y ubicación del mismo track. Para evitar carreras, UI consulta con generation y requestId y descarta respuestas anteriores. Cada sesión autenticada lleva epoch en memoria; cambiar cuenta invalida trabajo y respuestas pendientes. La sesión de licencia de la extensión no identifica la cuenta SoundCloud.

Retener bibliotecas por ownerId, pero no mostrar automáticamente una biblioteca privada/cacheada de otra cuenta al cambiar sesión. Elegir biblioteca explícitamente cuando corresponda. Configuración permite borrar una biblioteca o todo el índice y sus marcadores, con alcance visible. Si se agota espacio, conservar generación válida y ofrecer limpieza; no borrar bibliotecas arbitrariamente. Sin permiso unlimitedStorage inicial.

## 6. Indexación y sincronización

Separar `soundcloud-likes-source.js` del ciclo de vida de `SCPageIntake`. Contrato por página: `fetchPage({ ownerId, cursor, authContext, signal }) -> { entries, nextCursor }`. Mantener uso de 50 como tamaño inicial, tal como el código; medir antes de cambiarlo. Resolver clientId mediante lógica compartida existente, sin valores hardcodeados.

Orquestación en background con IDB, un job por ownerId y una petición de likes en vuelo global inicialmente. Background obtiene credenciales por el flujo existente de download-source y valida dueño; la página aporta contexto público resuelto, no autoridad ni URLs arbitrarias. Extraer resolución compartida de clientId/contexto donde sea necesario y probar que funciona desde background; si requiere pestaña abierta, pausar con motivo explícito, no fingir indexación autónoma.

Primera carga:

1. Crear generación de staging y job; tomar lease para evitar dos trabajadores.
2. Leer página, validar esquema/origen, normalizar entradas.
3. En una transacción guardar entradas y siguiente checkpoint. Abort de transacción no avanza cursor.
4. Publicar progreso después del commit. Sin generación previa, UI puede consultar staging parcial.
5. Seguir nextCursor hasta ausencia; cursor repetido/esquema inválido produce parcial con error, nunca “completo”.
6. Marcar completa y cambiar activeGeneration atómicamente. Limpiar generación previa después, en lotes.

MV3: no depender de timers largos ni de un Promise eterno. Persistir checkpoint por página; al despertar por apertura/reintento/alarma, adquirir lease vencida y continuar. Request repetido tras suspensión debe ser idempotente. Cancelar incrementa job epoch y usa AbortController cuando el proceso sigue vivo; resultados tardíos no escriben. Al iniciar recuperación, cursor expirado lleva a reinicio de staging, conservando generación válida anterior.

Actualización rápida: al abrir mostrar caché inmediatamente y consultar cabeza. Puede terminar tras encontrar una ventana de solapamiento estable (propuesta inicial: dos páginas con mismos ids/likedAt), marcando sólo `headRefreshedAt`. Una coincidencia no prueba que el resto siga intacto. Mezclar cabeza preservando orden y dedupe, publicar nueva generación coherente y mantener anclas por id.

Reconciliación completa: acción `Actualizar toda la biblioteca` y tarea diferida cuando lastFullSyncAt tenga más de siete días, si hay contexto/autenticación válidos. El plazo es política inicial ajustable, no promesa de exactitud diaria. Sólo una pasada completa exitosa permite retirar likes antiguos no vistos. No eliminarlos por una página fallida, un 403 ni porque dos cuentas tengan igual contador. Nuevos likes durante el recorrido: revalidar cabeza al finalizar y programar otra pasada si hay discrepancias; no afirmar snapshot transaccional del servidor.

HTTP: extender wrapper con signal sin romper consumidores. Timeout propuesto 15 s por petición; 429 respeta Retry-After (segundos o fecha), persiste retryAt y muestra espera; sin header, backoff con jitter y límite. 5xx/red: hasta tres reintentos acotados y luego pausa. 401 requiere revalidar login, 403 explica acceso; no loops infinitos. Cola comparte límites razonables con descargas para no saturar el mismo servicio. No registrar tokens ni URLs con query sensible.

## 7. Consulta, virtualización y rendimiento

Background responde páginas de metadata, no objetos completos de audio. Contrato query incluye ownerId, generation, texto, rango temporal, offset y limit (máximo propuesto 200). Respuesta: items, matchingCount conocido, indexedCount, completeness, generation. Consultas por ancla retornan posición real; no forzar al cliente a descargar toda la biblioteca para centrar una tarjeta.

Para V1, construir en memoria un índice compacto de búsqueda por generación bajo demanda: campos normalizados de título/artista e ids; cargar desde IDB en lotes. Mantener en caché sólo bibliotecas activas y descartar al cambiar generación. Filtrado simple con Unicode normalizado; no FTS/embeddings. El service worker puede reconstruirlo al despertar. Medir 10k/50k antes de adoptar estructura más compleja.

Ventana de lista: floor(scrollTop/rowHeight), overscan, alto virtual total. Galería: fila virtual = floor(itemIndex/columns); altura virtual = ceil(count/columns)*rowHeight. Controlar cambios de densidad, resize, borde final y scroll durante respuestas asíncronas. Render keyed por id cuando un elemento tiene foco. Cancelar consultas obsoletas.

Fechas: conservar UTC ISO y agrupar por zona horaria local explícita; nunca reinterpretar publicación como like. Épocas visibles sólo de datos cargados y grupo sin fecha. Saltar por posición es siempre alternativa. Restaurar por anchorTrackId + pixelOffset, no sólo scrollTop. Índice de meses puede persistirse por generación al completar cada lote.

Objetivos a medir, no resultados ya obtenidos: en biblioteca cacheada de 10k, primer contenido útil <500 ms en equipo de referencia; búsqueda p95 <150 ms después de preparar índice; salto local p95 <100 ms; DOM acotado por viewport+overscan y sin crecimiento proporcional a likes. Medir 1k, 10k y 50k. Primera indexación es proporcional a páginas y latencia; nunca prometer acceso instantáneo a 2020 en biblioteca aún no recorrida.

## 8. Reproducción y continuidad

Crear `soundcloud-playback.js`, adaptador del content script top-frame, distinto del bridge de seek/loop. Recibe trackId y permalink resueltos desde el índice validado, operationId y targetTabId fijado al aceptar la acción. No volver a consultar “pestaña activa” después de enfocar/navegar.

Estrategia V1:

1. Si la tarjeta del track está montada, identificarla por permalink/id y accionar su botón real. Nunca usar `.playButton` genérico de la página ni pulsar un toggle si ese track ya está sonando.
2. Si no está montada, persistir intención de reproducción y ancla del Explorer en background; navegar al permalink en la pestaña SoundCloud elegida y esperar handshake del nuevo documento.
3. Resolver botón principal perteneciente a ese track; intentar play asociado al pedido explícito del usuario. Verificar identidad del badge y estado playing/media, no sólo que `click()` no arrojó excepción.
4. Si autoplay, consentimiento, login, región o cambio del DOM lo impiden, mostrar `Track abierto: pulsá Play en SoundCloud` o el motivo detectado. No forzar overlays ni repetir toggles. Intención expira (propuesta 15 s) y se consume como máximo una vez.
5. Ofrecer volver al Explorer y recuperar ancla aunque la navegación haya sido completa.

No introducir un reproductor paralelo ni colocar streamUrl en un audio propio. No depender de módulos webpack privados sin evidencia y un coste de mantenimiento explícito. La integración debe tolerar que SoundCloud cambie selectores.

Reproducir otro track cancela la intención anterior. Cambiar de cuenta, salir de SoundCloud o cerrar la pestaña la invalida. Estado interno: requested -> opening -> waiting-for-player -> playing | needs-user-action | unavailable | cancelled. Mensaje de éxito sólo tras evidencia de identidad y reproducción; `opened` no equivale a `playing`.

Anterior/siguiente manual usa snapshot de ids del contexto original (o consulta por ancla en la generación fijada). Si uno no está disponible, informar y permitir avanzar; no saltar masivamente en automático. Cambio de identidad debe limpiar/reconciliar A–B según contratos existentes; no transferir rango del track anterior. Probar velocidad/Keep Tone y presets con el comportamiento actual, sin resetearlos por iniciativa de Explorer.

Gate de release: validar selección y play en sesión real autenticada, desde popup y overlay, con track no montado, cambio SPA y navegación completa. La prueba pública de esta sesión no satisface ese gate. Si sólo funciona apertura+play manual, la UI debe decir `Abrir para escuchar`; no publicar botón que prometa reproducción directa sin cumplirla.

## 9. Localizar en SoundCloud

Utilidad secundaria, identificada como progresiva. Content script posee el trabajo de DOM; background conserva operationId, targetTabId, ownerId y targetId para reabrir estado al cerrar popup. No mover scroll automáticamente al abrir Explorer.

1. Verificar ruta de likes del dueño elegido. Si es otra ruta, guardar retorno y navegar a esa colección.
2. Buscar tarjeta por permalink canónico/id de track; no por texto ni ordinal de filas.
3. Si está montada, centrar con scrollIntoView y resaltar brevemente.
4. Si falta, desplazar el contenedor de scroll efectivo hacia su sentinel/fondo. Esperar MutationObserver/progreso del listado, no hacer un bucle de wheel a intervalos fijos.
5. Volver a buscar tras cada avance. Medir ids nuevos y scrollHeight; manejar render de lotes ya descargados y requests adicionales.
6. Cancelar por acción del usuario, navegación ajena, cambio de cuenta, timeout o estancamiento. Propuestas iniciales: 30 s por operación, 8 s sin progreso y máximo 40 avances; al agotar ofrecer continuar explícitamente o Ver alrededor/Reproducir.
7. Mostrar “Buscando el track en SoundCloud…” y cantidad observada si fiable. No calcular porcentaje exacto con trackOrdinal porque hay playlists, ausentes y virtualización nativa posible.

Evitar observar el propio overlay como progreso. Al cancelar detener observers, RAF y timers y no continuar desplazando. No restaurar scroll sobre una nueva acción manual del usuario. Si la página elimina filas viejas, mantener set de ids observados y localizar el target en cada ventana, sin asumir crecimiento permanente del DOM.

No fabricar cursors basados en fechas ni inyectar tarjetas para engañar el estado de SoundCloud. Un atajo de deep link nativo sólo entra si se demuestra en un spike; hoy no está probado.

## 10. Módulos y mensajes propuestos

| Archivo | Responsabilidad |
| --- | --- |
| `scripts/soundcloud-likes-source.js` | Adaptador paginado y proyección de wrapper de like |
| `scripts/likes-library.js` | IDB, generaciones, checkpoint, consultas y reconciliación |
| `scripts/likes-jobs.js` | Orquestación reanudable, lease, cancelación y backoff |
| `scripts/likes-explorer.js` | Overlay, toolbar, galería/lista, foco y restauración |
| `scripts/likes-virtual-window.js` | Cálculo puro de ventanas, opcionalmente compartido con popup |
| `scripts/soundcloud-playback.js` | Selección de track, play y verificación de identidad |
| `scripts/soundcloud-likes-locator.js` | Scroll nativo cancelable |
| `scripts/background.js` | Routing, autorización, trabajos e intenciones entre documentos |
| `scripts/content.js` | Contexto de página y comandos top-frame |
| `scripts/popup.js`, `popup.html` | Entrada y selector rápido independiente |
| `scripts/tempo-control-main.js` | Entrada mínima desde Toolkit; localizar montaje real antes de editar |
| `scripts/player-tools-policy.js`, access/client | Capability y autorización de Explorer |
| `manifest.json`, packaging y locales | Carga de módulos, estilos y distribución |

Usar el estilo IIFE/CommonJS verificable del repositorio; no introducir bundler/framework para esta feature. Si el overlay usa CSS externo, incluirlo en packaging y declararlo accesible sólo si el mecanismo elegido lo necesita.

Mensajes nuevos orientativos:

- `GET_LIKES_LIBRARY_STATUS`, `START_LIKES_INDEX`, `CANCEL_LIKES_INDEX`, `REFRESH_LIKES_LIBRARY`.
- `QUERY_LIKES`, `GET_LIKES_AROUND`, `SAVE_LIKES_VIEW`, `SAVE_LIKES_BOOKMARK`, `DELETE_LIKES_LIBRARY`.
- `OPEN_LIKES_EXPLORER`, `PLAY_LIKED_TRACK`, `LOCATE_LIKED_TRACK`, `CANCEL_LIKES_ACTION`.

Envelope: requestId, ownerId, generation cuando aplica; operaciones durables devuelven operationId inmediatamente. Progreso por puerto/suscripción mientras UI esté abierta y consulta de estado al reabrir. No mantener runtime.sendMessage abierto durante una indexación completa. Respuestas con code estable y mensaje traducible, no errores técnicos expuestos tal cual.

Validar sender de extensión/content script, top-frame para UI, ownership de tab y tamaño de arrays/strings. Comandos web MAIN no conceden Pro. Autorizar en background cada operación Pro sensible, no sólo esconder botones. Permalinks https de soundcloud.com y rutas de track validadas; next cursors limitados al endpoint de likes del owner. No incorporar handlers genéricos de fetch o navegación arbitraria.

## 11. Free/Pro

Propuesta V1: capability `likesExplorer`, habilitada para Pro; nueva operación `explore-likes` registrada explícitamente. Explorer no gasta loops ni habilita tempo por sí mismo. Free conserva selección virtualizada y todas las descargas actuales. Una entrada de descubrimiento puede abrir explicación de Pro, sin iniciar indexación oculta ni simular compra.

El período de prueba comercial de Explorer no está definido por este pedido: V1 no inventa uno ni reutiliza los 20 loops. Mantener posibilidad de añadirlo luego mediante policy. Si se pierde Pro, conservar índice/marcadores y permitir borrarlos; impedir nuevas operaciones Explorer. No interrumpir audio nativo que ya esté sonando.

Coordinar integración con archivos locales existentes: `canAuthorize` actual permite cualquier operación al plan Pro antes de clasificar operaciones; al añadir handlers, validar operación en el router y ampliar fixtures para evitar que typos parezcan capacidades válidas.

## 12. Secuencia de implementación y criterios de salida

### Hito 0: cerrar integración de reproducción

Capturar fixtures saneados de likes públicos y autenticados con fechas, playlist, track no disponible y página siguiente. Ejecutar prueba autenticada de play desde intención persistida, navegación y vuelta al Explorer. Confirmar ubicación exacta del botón Toolkit y resolución de clientId en background. Documentar resultados y selectors observados, nunca credenciales.

Salida: decisión probada entre Play directo o Abrir para escuchar; contrato de source paginado; ninguna dependencia de una cola automática. El resto del índice puede desarrollarse mientras se valida reproducción, pero no dar ese gate por aprobado.

### Hito 1: datos e índice durable

Implementar source, proyección, IDB y checkpoints. Integrar paginación compartida con page-intake sólo donde sea seguro; mantener proyección de Downloader compatible. Añadir cancelación/reintentos, generaciones y consulta por ancla.

Salida: cierre/reapertura del popup y reinicio del service worker no pierden páginas confirmadas; fallo parcial no elimina biblioteca válida; cambio de usuario no mezcla datos.

### Hito 2: selector rápido y primera entrega vertical

Entrada de popup, resultados progresivos, búsqueda y Ver alrededor en lista amplia mínima; wiring Pro. Integrar Play/Abrir según hito 0 y persistencia de intención. Guardar ancla antes de navegar.

Salida: en datos de 10k, se elige un track antiguo sin renderizar todos y se abre/reproduce el track correcto; Downloader sigue seleccionando y descargando igual.

### Hito 3: galería y épocas

Añadir grid virtual, densidades, navegación año/mes/sin fecha, retorno a búsqueda, bookmarks y anterior/siguiente manual. Integrar acceso Toolkit sin rediseñarlo.

Salida: mismo track ancla tras resize, densidad, búsqueda y llegada de likes nuevos. Fechas del wrapper verificadas; playlists no alteran identidad ni playback.

### Hito 4: localizador nativo

Implementar adaptador DOM y estados cancelables. Probar montado/no montado, rutas equivocadas, fin de lista y falta de progreso.

Salida: una operación cancelada no vuelve a mover la página; al expirar ofrece alternativas funcionales; no se presenta como acceso instantáneo.

### Hito 5: actualización, robustez y distribución

Reconciliación completa, storage quota, autenticación, offline, restauración de jobs, traducciones y accesibilidad. Verificar manifest/packaging incluyen todos los módulos. Ejecutar regresiones proporcionales y empaquetar artefacto local, sin publicar.

Salida: matriz siguiente completa; documentar limitaciones reales y latencias medidas. Si Play no supera validación autenticada, publicar sólo con copy Abrir para escuchar y registrar esa reducción de alcance.

## 13. Matriz de validación

| Área | Casos obligatorios |
| --- | --- |
| Source | wrapper.created_at distinto de track.created_at; fecha ausente/inválida; playlists; id repetido; página vacía con cursor; cursor repetido; next host inválido |
| Durabilidad | suspensión entre fetch y commit, después de commit, dos pestañas mismo owner, cancelación con respuesta tardía, cursor expirado, cuota agotada |
| Sync | nuevo like, unlike viejo, re-like, mismo contador con contenido diferente, cambios durante recorrido, refresh fallido sin borrado |
| Identidad | usuario A/B, público vs /you/likes, logout durante indexación, cambio de pestaña antes del ack |
| Lista/grid | 0/1/1k/10k/50k, inicio/final, salto distante, zoom/resize, imágenes rotas, filtro vacío, foco en fila virtualizada |
| Playback | track montado/no montado, playlist excluida, ya sonando/pausado, dos clicks a destinos diferentes, SPA/full reload, login/consent/autoplay, no disponible |
| Toolkit | cambio de track con A–B activo, velocidad/Keep Tone, loop export y descarga completa con efectos |
| Locator | encontrado, no encontrado, carga incremental, DOM reciclado, timeout, cancelación, navegación manual y nuevo target |
| Pro | Free sin indexación nueva, Pro habilitado, pérdida de Pro conserva caché, borrar permitido, contador loops intacto |
| Regresión | selección/descarga de likes, playlists y uploads; formatos, carpetas, jobs, polling y estado del popup |

Agregar verificadores de source/library/playback/locator y prueba browser del Explorer con fixtures deterministas. No usar prueba live como dependencia de npm test. `scripts/run-verifications.js` descubre verify-*.js automáticamente: excluir nuevos browser/live de ese runner o adaptar su routing antes de nombrarlos, para que no se ejecuten accidentalmente como unitarios.

Pruebas browser con datos preparados verifican DOM/estado; smoke live aislado verifica cambios reales de SoundCloud. Conservar evidencia sin tokens: conteos, estado, fechas ejemplo y screenshots si son necesarios. La prueba de autoplay debe comprobar reproducción real y permalink correcto, no sólo CSS del botón.

## 14. Definición de terminado

- Plan Pro accede desde popup y Toolkit a la misma biblioteca persistente.
- Un like de época antigua indexada se encuentra y centra sin recorrer infinite scroll nativo.
- Búsqueda, galería, fechas y contexto conservan identidad y orden.
- Acción de escucha reproduce correctamente o comunica de manera explícita que requiere Play manual; nunca éxito falso.
- Localizador nativo tiene progreso y cancelación efectivos.
- Cerrar UI, reiniciar worker, cambiar cuenta o fallar la red no corrompe biblioteca ni reproduce otro track.
- Descargar sigue gratis y no cambia su selección por explorar.
- Se han medido rendimiento, accesibilidad, idiomas y regresiones; fixtures y documentación reflejan límites.

No quedan decisiones de arquitectura delegadas a “investigar después” salvo integración autenticada que no estuvo disponible en esta sesión: se describen su prueba, criterio de aprobación y fallback. No llamar al plan una garantía de compatibilidad permanente con el DOM/API interna de SoundCloud.
