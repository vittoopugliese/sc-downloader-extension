# Likes Explorer Pro: plan técnico por etapas y guía de implementación

> **V1 IMPLEMENTADA; QA/evolución ABIERTOS — revisión 24/09/2026 (`29d7946`).** Biblioteca, búsqueda, mapa, portadas y navegación existen. Trial de siete días seguido de PRO; bookmarks/lugares guardados fueron retirados en `1b16710`. No prometer autoplay/shuffle, terceros ni cerrar benchmarks/QA real por fixtures. Estado y pendientes: [registro vigente](ESTADO-ACTUAL-20260924.md).

> Implementación local iniciada y entregada el 2026-09-16 por pedido del usuario. Ver [handoff, pruebas y gates pendientes](LIKES-EXPLORER-HANDOFF-20260916.md). Las afirmaciones siguientes de «todavía no implementado» y «sólo plan» describen la edición histórica del 15 de septiembre; no son el estado actual. El gate autenticado sigue pendiente y la escucha usa Abrir para escuchar.

Creado: 2026-09-12. Actualizado: 2026-09-15. Estado: plan detallado; **Likes Explorer todavía no está implementado**, confirmado por el usuario.
Base actual inspeccionada: `e2c076b03cc7a7ee998450a40152a59569fe618d`. La revisión original usó `629b55f558a75562c69ef7d98c1346f8ebce8a86`.

## 0. Instrucciones de lectura y decisiones confirmadas

Este documento debe permitir trabajar sin acceso a la conversación original. Describe trabajo futuro: ningún módulo propuesto, contrato nuevo ni resultado esperado debe interpretarse como código ya existente. La tarea del 15 de septiembre es actualizar este plan, no implementar ni publicar la feature.

Fuentes de producto: conversación `C:\Users\torib\Desktop\plan_final_destilar_por_etapas.txt`, boceto `C:\Users\torib\Desktop\LIKES_EXPLORER_BOCETO.png` y respuestas del usuario del 2026-09-15. El boceto se describe aquí para que su ausencia en otra máquina no bloquee la implementación.

| Decisión del usuario | Consecuencia obligatoria |
| --- | --- |
| Primero sólo likes personales en `https://soundcloud.com/you/likes` | Botón lateral únicamente en esa ruta; verificar cuenta autenticada. Perfiles ajenos quedan para después |
| Botón muy sutil, al costado derecho | Cerrado inicialmente; no abrir paneles ni descargar portadas por instalar la extensión |
| Elegir zona abre galería propia | El salto primario mueve el Explorer; localizar en SoundCloud es otra acción, progresiva |
| Foto 3: indicador arrastrable | Representa la ventana del Explorer sobre el mapa; no es una lupa en la primera entrega |
| Primero cargar lista como el selector virtualizado del Downloader | Priorizar metadata y lista utilizable antes de esperar portadas o el final de la indexación |
| Guardar opcionalmente todas las portadas personales, ligeras y WebP | Trabajo independiente, con aceptación explícita, progreso, pausa, reanudación y borrado |
| Lupa después del guardado de portadas | Etapa posterior de vista ampliada para navegar por zonas/track; no análisis con IA |
| Pro con lifetime existente | Reutilizar licencia y policy; no nuevo producto, compra, suscripción ni consumo de los 20 loops |
| Documentar dos variantes de random para después | Botón de redescubrimiento y reproducción aleatoria continua tienen etapas y gates distintos |
| Explorer no existe todavía | Implementación nueva que reutiliza infraestructura, no una supuesta migración de Explorer |

Las secciones 1–11 describen la base; la 12 fija el orden; las 15–22 concretan minimapa, portadas, contratos y ampliaciones. Las cifras identificadas como propuestas son valores iniciales medibles, no decisiones adicionales que requieran volver a preguntar. No ampliar automáticamente el alcance a las demás ideas comerciales de la conversación.

Ruta rápida de lectura:

- [Etapas y criterios de salida](#12-secuencia-de-implementación-y-criterios-de-salida).
- [Minimapa y traducción del boceto](#15-especificación-del-minimapa-y-layout).
- [Portadas WebP y almacenamiento](#16-portadas-webp-descarga-conversión-y-caché-personal).
- [Lupa](#17-lupa-futura), [random](#18-random-dos-features-distintas-para-etapas-posteriores) y [compartir imágenes](#19-imágenes-locales-para-compartir-etapa-futura).
- [Contratos y guía de implementación](#20-contratos-concretos-y-guía-para-quien-implemente).
- [Inventario de ideas](#21-inventario-de-ideas-y-límites-de-esta-destilación) y [validación](#22-validación-entrega-y-asuntos-que-requieren-evidencia-real).

## 1. Pedido y resultado esperado

El usuario quiere reencontrar likes antiguos por portada, nombre o época. La entrada principal es un botón lateral sutil dentro de `/you/likes` que abre un minimapa visual y una vista propia de lista/galería. Popup y Player Toolkit son accesos secundarios a la misma biblioteca. “Promptear la lista” significa desplegar el selector, recorrerlo rápidamente y elegir un track; no significa IA ni lenguaje natural.

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
| `scripts/player-tools-policy.js` y `player-tools-access.js` | Infraestructura existente; autoridad de acceso en background; operaciones desconocidas ya se rechazan antes de conceder Pro | Integrar capability nueva y registrarla; no crear segundo contador |
| `manifest.json` | MV3, storage, alarms y hosts de SoundCloud existentes | No agregar permisos amplios por defecto |

En la revisión inicial de esta tarea esos módulos ya existían y `git status --short` mostró `current_description.txt` sin seguimiento. Durante la edición el repositorio avanzó externamente a `2415e9d` y aparecieron cambios ajenos en `scripts/tempo-control-main.js`. Este trabajo sólo edita el presente documento. La base técnica inspeccionada sigue siendo la indicada arriba; volver a consultar git antes de implementar. No asumir los cambios locales descritos en la revisión antigua como pendientes actuales.

### Evidencia histórica del 12 de septiembre (no repetida en esta edición)

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

## 3. Alcance confirmado y entregas

V1 incluye:

1. Índice local de likes personales, carga progresiva, reanudación y actualización.
2. Botón sutil en `/you/likes` y lista virtualizada con búsqueda por título/artista.
3. Minimap lateral de portadas con indicador arrastrable, asociado a galería/lista propia; accesos secundarios desde popup/Toolkit para la misma colección personal.
4. Navegación por año/mes de like; alternativa por posición y grupo “Sin fecha”.
5. Ver alrededor, conservando el orden original aunque se llegue desde búsqueda.
6. Reproducir un track mediante el player de SoundCloud, con fallback visible si requiere interacción.
7. Anterior/siguiente entre likes del contexto, mediante acciones manuales.
8. Restauración por track ancla y marcadores personales de épocas.
9. Localizar en la lista nativa como utilidad cancelable con presupuesto de tiempo.
10. Acceso Pro lifetime integrado y traducciones en en, es, pt_BR, de y ru.
11. Carga de imágenes visibles y opción de guardar todas las portadas personales como WebP ligeras en caché local de la extensión.

La primera entrega funcional es la lista del hito 2; la V1 visual completa termina en el hito 6. Fuera de V1, pero detallados para después: lupa, redescubrimiento aleatorio, cola random, imágenes para compartir y colecciones ajenas. Fuera de este plan: búsqueda IA, análisis de portadas por color, embeddings, subir bibliotecas a servidores, sync entre dispositivos, audio propio, caché de audio y generar playlists en la cuenta. Las playlists que aparecen entre likes se conservan como referencias de orden, sin expandirlas ni reproducirlas como entradas de Explorer.

“Escuchar desde acá” en V1 significa reproducir el elegido y habilitar anterior/siguiente manual. No usar copy que prometa autoplay de toda la época. La cola automática requiere un hito posterior validado con fin de track, anuncios, loops, cambio manual y política de autoplay.

## 4. Diseño de interacción

### Popup

Agregar entrada secundaria `Explorar mis likes`; dirige a la colección personal en una pestaña SoundCloud fijada antes de iniciar la acción. Si no está en `/you/likes`, navegar a esa ruta como consecuencia del click explícito. No interpretar el perfil ajeno activo como dueño. Abre un modo de exploración distinto de selección de descarga. Conservar `Select` y sus checkboxes. En modo Explorer, fila con portada pequeña, título, artista, índice y botones separados de play/localizar; click en contenido principal ejecuta Ver alrededor.

Buscar no modifica `selectedIds` ni el límite de descarga. Mantener estados separados. Reutilizar función pura del rango visible si facilita ambos modos; no extraer un framework de listas. Escape vuelve a la pantalla previa. Cerrar el popup no cancela un play/localizar ya aceptado por background, pero sí libera sus suscripciones.

Mostrar resultados cacheados primero; indicar `Actualizando…`, cantidad indexada y si la colección está incompleta. No esperar el último request para permitir explorar. Sin caché, mostrar la primera página utilizable y continuar. No sugerir que años todavía no indexados están vacíos.

### Vista amplia

Host único del content script en el frame superior, encapsulado en Shadow DOM. Contiene botón de entrada, rail del minimapa y panel de lista/galería propia. Recuperar montaje tras navegación SPA sólo en `/you/likes`; desmontar al salir. Un acceso compacto desde Toolkit lleva a esa ruta y abre el mismo Explorer. Debe funcionar antes de reproducir el primer track. Layout y comportamiento exactos: sección 15.

Barra superior: usuario dueño, búsqueda, estado de actualización, lista/galería, densidad, cerrar. Navegación por épocas lateral o compacta según ancho. Player nativo conserva su espacio; overlay no tapa los controles inferiores. Guardar y restaurar foco al cerrar; no bloquear scroll global, según sección 15.2.

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
| entries | [ownerId, generation, kind, itemId] | sourceOrdinal, trackOrdinal sólo en tracks, likedAt ISO/null, kind, metadata mínima; índices detallados en sección 20.3 |
| jobs | ownerId | jobId, generation, mode, next cursor, checkpoint, phase, retryAt, seen cursors acotados, lease |
| views | [ownerId,surface] | anchorTrackId, pixelOffset, query, mode, density, filtros |
| bookmarks | [ownerId,bookmarkId] | name, anchorTrackId, likedAt, createdAt |

Metadata de track: id, permalink canónico, title, artistName, artistId, artworkUrl, durationMs, genre opcional, publicationDate separada, availability observada. Guardar likedAt del wrapper. Para playlists sólo identidad, orden y fecha necesarios para reconciliación/posición nativa; no expandir sus tracks en V1.

No persistir objetos `fromSoundCloud` completos, tokens OAuth, client secrets, track_authorization, cookies ni URLs de audio. El cursor durable debe estar saneado: guardar sólo host/path/query permitidos para paginación, sin credenciales/client_id; reconstruir autorización al reanudar. No aceptar next_href arbitrario desde mensajes.

Cada generación tiene ordinales densos derivados del orden recibido; fechas iguales no cambian el orden. Deduplicar por kind+id dentro de generación. Cuenta total de likes del perfil puede incluir playlists/no disponibles: mostrar tracks indexados y entradas leídas por separado, sin inferir que faltan requests sólo por esa diferencia.

No usar un índice numérico como identidad. En re-like, la siguiente reconciliación reemplaza fecha y ubicación del mismo track. Para evitar carreras, UI consulta con generation y requestId y descarta respuestas anteriores. Cada sesión autenticada lleva epoch en memoria; cambiar cuenta invalida trabajo y respuestas pendientes. La sesión de licencia de la extensión no identifica la cuenta SoundCloud.

Retener bibliotecas por ownerId, pero sólo exponer para explorar la del usuario autenticado actual. Logout o cambio de cuenta oculta inmediatamente metadata e imágenes anteriores. La pantalla de almacenamiento puede permitir borrar datos locales de otra cuenta sin revelar su biblioteca. Configuración permite borrar sólo portadas, una biblioteca o todos los datos de Explorer, con alcance visible. Si se agota espacio, conservar generación válida y ofrecer limpieza; no borrar bibliotecas arbitrariamente. Sin permiso unlimitedStorage inicial.

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
5. Ofrecer volver a `/you/likes`, abrir Explorer y recuperar ancla aunque la navegación haya sido completa. Como el host sólo vive en esa ruta, en la página del track el retorno se ofrece desde el acceso secundario del popup/Toolkit; no dejar flotando el botón lateral fuera de likes.

No introducir un reproductor paralelo ni colocar streamUrl en un audio propio. No depender de módulos webpack privados sin evidencia y un coste de mantenimiento explícito. La integración debe tolerar que SoundCloud cambie selectores.

Reproducir otro track cancela la intención anterior. Cambiar de cuenta, salir de SoundCloud o cerrar la pestaña la invalida. Estado interno: requested -> opening -> waiting-for-player -> playing | needs-user-action | unavailable | cancelled. Mensaje de éxito sólo tras evidencia de identidad y reproducción; `opened` no equivale a `playing`.

Anterior/siguiente manual usa snapshot de ids del contexto original (o consulta por ancla en la generación fijada). Si uno no está disponible, informar y permitir avanzar; no saltar masivamente en automático. Cambio de identidad debe limpiar/reconciliar A–B según contratos existentes; no transferir rango del track anterior. Probar velocidad/Keep Tone y presets con el comportamiento actual, sin resetearlos por iniciativa de Explorer.

Gate de release: validar selección y play en sesión real autenticada, desde popup y overlay, con track no montado, cambio SPA y navegación completa. La prueba pública histórica de sección 2 no satisface ese gate. Si sólo funciona apertura+play manual, la UI debe decir `Abrir para escuchar`; no publicar botón que prometa reproducción directa sin cumplirla.

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

Decisión confirmada: capability `likesExplorer`, habilitada con el **Pro lifetime existente**; nueva operación `explore-likes` registrada explícitamente. Explorer no gasta loops ni habilita tempo por sí mismo. Free conserva selección virtualizada y todas las descargas actuales. El botón lateral puede mostrar un candado discreto y abrir explicación del Pro existente, sin iniciar indexación ni caché de portadas para Free.

El período de prueba comercial de Explorer no está definido por este pedido: V1 no inventa uno ni reutiliza los 20 loops. Mantener posibilidad de añadirlo luego mediante policy. Si se pierde Pro, conservar índice/marcadores y permitir borrarlos; impedir nuevas operaciones Explorer. No interrumpir audio nativo que ya esté sonando.

`canAuthorize` actual ya rechaza operaciones desconocidas antes de comprobar Pro. Conservar ese orden, añadir `explore-likes` al conjunto de operaciones Pro y `likesExplorer` al snapshot. Cada handler de lectura/exploración, play, localización, generación de portadas y futuros random/share verifica acceso en background. Revalidar también antes de ejecutar cada lote de un job, no sólo al crearlo. Pérdida de Pro pausa los trabajos, invalida intenciones pendientes y vacía vistas; conserva datos para recuperar acceso o borrarlos. Cerrar la UI no termina la licencia ni afecta sesiones de loops.

## 12. Secuencia de implementación y criterios de salida

### Hito 0: verificar contratos de integración

Capturar fixtures saneados de likes personales autenticados con fechas, playlist, track no disponible y página siguiente. Se pueden reutilizar fixtures públicos como prueba del adaptador, sin habilitar perfiles ajenos. Ejecutar prueba autenticada de play desde intención persistida, navegación y vuelta al Explorer. Confirmar detección de ruta, cuenta y clientId en background, espacio lateral real y ubicación del acceso Toolkit. Documentar resultados y selectores observados, nunca credenciales.

Salida: decisión probada entre Play directo o Abrir para escuchar; contrato de source paginado; ninguna dependencia de una cola automática. El resto del índice puede desarrollarse mientras se valida reproducción, pero no dar ese gate por aprobado.

### Hito 1: datos e índice durable

Implementar source, proyección, IDB y checkpoints. Integrar paginación compartida con page-intake sólo donde sea seguro; mantener proyección de Downloader compatible. Añadir cancelación/reintentos, generaciones y consulta por ancla.

Salida: cierre/reapertura del popup y reinicio del service worker no pierden páginas confirmadas; fallo parcial no elimina biblioteca válida; cambio de usuario no mezcla datos.

### Hito 2: botón personal y lista, primera entrega utilizable

Montar botón sólo en `/you/likes`. Conectar Pro, resultados progresivos, búsqueda y Ver alrededor en lista propia mínima. Añadir acceso secundario del popup y restauración. Integrar Play/Abrir según hito 0 y persistencia de intención. Guardar ancla antes de navegar. No esperar descarga masiva de portadas; renderizar placeholder cuando falte imagen.

Salida: en datos de 10k, se elige un track antiguo sin renderizar todos y se abre/reproduce el track correcto; Downloader sigue seleccionando y descargando igual.

### Hito 3: galería, épocas y minimapa arrastrable

Añadir grid virtual, densidades, navegación año/mes/sin fecha, retorno a búsqueda, bookmarks y anterior/siguiente manual. Implementar minimapa de sección 15 y carga de imágenes visibles. Integrar acceso Toolkit sin rediseñarlo. Sin lupa todavía.

Salida: mismo track ancla tras resize, densidad, búsqueda y llegada de likes nuevos. Arrastrar indicador o elegir portada lleva a la zona/track correctos del Explorer. Fechas del wrapper verificadas; playlists no alteran identidad ni playback. Portadas y DOM acotados a ventanas visibles.

### Hito 4: portadas personales persistentes

Implementar pipeline WebP, stores y job de sección 16. Preguntar desde la UI si desea guardar todas las portadas; indexación y navegación siguen disponibles si rechaza. Añadir progreso, pausa/reanudación, límite de espacio y borrado exclusivo de portadas. Validar conversión en el worker real de la extensión, no sólo en una página de prueba.

Salida: todas las portadas disponibles caben o se informa explícitamente caché parcial; las fallidas no bloquean navegación. Reiniciar worker no pierde archivos confirmados; borrar portadas no elimina índice, bookmarks ni audio descargado.

### Hito 5: localizador nativo

Implementar adaptador DOM y estados cancelables. Probar montado/no montado, rutas equivocadas, fin de lista y falta de progreso.

Salida: una operación cancelada no vuelve a mover la página; al expirar ofrece alternativas funcionales; no se presenta como acceso instantáneo.

### Hito 6: actualización, robustez y distribución de V1 visual

Reconciliación completa, storage quota, autenticación, offline, restauración de jobs, traducciones y accesibilidad. Verificar manifest/packaging incluyen todos los módulos. Ejecutar regresiones proporcionales y empaquetar artefacto local, sin publicar.

Salida: matriz siguiente completa; documentar limitaciones reales y latencias medidas. Si Play no supera validación autenticada, publicar sólo con copy Abrir para escuchar y registrar esa reducción de alcance.

### Etapas posteriores, registradas pero no incluidas en V1

- Hito 7: lupa contextual sobre minimapa ya existente, sección 17.
- Hito 8: botón de redescubrimiento aleatorio sobre índice completo, sección 18.1. Prioridad explícita del usuario después de la base visual.
- Hito 9: modo de reproducción aleatoria continua, sección 18.2. No declarar terminado al implementar solamente el botón anterior.
- Hito 10: tarjetas locales para compartir un año o el like más antiguo, sección 19.
- Hito 11: explorar colecciones de otras personas y accesos desde perfiles; revisar elegibilidad, identidad y política de portadas antes de habilitarlo. No alterar el Downloader público existente para implementar esta futura etapa.

Hitos 7 y 8 dependen de datos/galería pero no uno del otro; se puede priorizar random antes que lupa. Para cada entrega informar hitos terminados y pendientes; terminar hito 2 no equivale a completar V1 visual.

## 13. Matriz de validación

| Área | Casos obligatorios |
| --- | --- |
| Source | wrapper.created_at distinto de track.created_at; fecha ausente/inválida; playlists; id repetido; página vacía con cursor; cursor repetido; next host inválido |
| Durabilidad | suspensión entre fetch y commit, después de commit, dos pestañas mismo owner, cancelación con respuesta tardía, cursor expirado, cuota agotada |
| Sync | nuevo like, unlike viejo, re-like, mismo contador con contenido diferente, cambios durante recorrido, refresh fallido sin borrado |
| Identidad | usuario A/B, público vs /you/likes, logout durante indexación, cambio de pestaña antes del ack |
| Lista/grid | 0/1/1k/10k/50k, inicio/final, salto distante, zoom/resize, imágenes rotas, filtro vacío, foco en fila virtualizada |
| Minimap | rueda sólo dentro del rail, click zona/track, drag fuera del rail, pointercancel, último elemento, cambio de generación durante drag, indicador recortado, filtros y colección parcial |
| Portadas | opt-in ausente/presente, URL compartida, imagen rota, tipo real WebP, reinicio durante conversión/commit, cuota, cambio de cuenta, revocar Pro, borrar durante fetch, CSP y reciclado de object URLs |
| Playback | track montado/no montado, playlist excluida, ya sonando/pausado, dos clicks a destinos diferentes, SPA/full reload, login/consent/autoplay, no disponible |
| Toolkit | cambio de track con A–B activo, velocidad/Keep Tone, loop export y descarga completa con efectos |
| Locator | encontrado, no encontrado, carga incremental, DOM reciclado, timeout, cancelación, navegación manual y nuevo target |
| Pro | Free sin indexación nueva, Pro habilitado, pérdida de Pro conserva caché, borrar permitido, contador loops intacto |
| Regresión | selección/descarga de likes, playlists y uploads; formatos, carpetas, jobs, polling y estado del popup |

Agregar verificadores de source/library/playback/locator y prueba browser del Explorer con fixtures deterministas. No usar prueba live como dependencia de npm test. `scripts/run-verifications.js` descubre verify-*.js automáticamente: excluir nuevos browser/live de ese runner o adaptar su routing antes de nombrarlos, para que no se ejecuten accidentalmente como unitarios.

Pruebas browser con datos preparados verifican DOM/estado; smoke live aislado verifica cambios reales de SoundCloud. Conservar evidencia sin tokens: conteos, estado, fechas ejemplo y screenshots si son necesarios. La prueba de autoplay debe comprobar reproducción real y permalink correcto, no sólo CSS del botón.

## 14. Definición de terminado

- Plan Pro accede desde botón personal, popup y Toolkit a la misma biblioteca persistente; Free mantiene Downloader completo.
- El botón lateral sólo existe en `/you/likes`; SPA, logout y cambio de cuenta limpian host y datos visibles.
- La lista funciona antes de completar la indexación y la caché de imágenes.
- Minimap arrastrable y galería comparten ancla; cada portada se resuelve al track correcto sin mover la lista nativa.
- Guardar todas las portadas es opcional, personal, WebP, reanudable y con uso de espacio visible.
- Un like de época antigua indexada se encuentra y centra sin recorrer infinite scroll nativo.
- Búsqueda, galería, fechas y contexto conservan identidad y orden.
- Acción de escucha reproduce correctamente o comunica de manera explícita que requiere Play manual; nunca éxito falso.
- Localizador nativo tiene progreso y cancelación efectivos.
- Cerrar UI, reiniciar worker, cambiar cuenta o fallar la red no corrompe biblioteca ni reproduce otro track.
- Descargar sigue gratis y no cambia su selección por explorar.
- Se han medido rendimiento, accesibilidad, idiomas y regresiones; fixtures y documentación reflejan límites.

Las integraciones que requieren demostración real se enumeran en sección 22 con gates y fallbacks. Ninguna se considera verificada por escribir este plan. No llamar al plan una garantía de compatibilidad permanente con el DOM/API interna de SoundCloud.

## 15. Especificación del minimapa y layout

### 15.1. Traducción del boceto

El boceto contiene tres estados de la misma página, no tres columnas del producto:

1. SoundCloud normal con un botón pequeño `Likes` junto al margen derecho, aproximadamente a media altura. El rojo del boceto identifica el control; no obliga a usar un fondo brillante permanente. Propuesta: fondo discreto adaptado al tema, texto legible, hover/focus claros, área pulsable de al menos 32 × 32 px aunque el dibujo visual sea menor.
2. Al abrir aparece un rail vertical angosto, redondeado, lleno de miniaturas cuadradas de artwork. Los cuadrados de colores del boceto representan portadas reales; no implementar clasificación por color. La scrollbar nativa permanece disponible a su derecha.
3. Sobre ese rail aparece un rectángulo gris arrastrable. Su relleno debe ser translúcido para seguir viendo las portadas. Señala qué rango muestra la lista/galería propia. La lupa es una ampliación futura independiente.

El rail no comprime 50.000 portadas en una sola pantalla. Es una cuadrícula virtualizada con scroll propio. Así cada celda puede seguir representando un track y ser seleccionable. Para saltos enormes ofrecer navegación por año/mes y un control de posición 0–100% del índice disponible. Este último muestra `Posición en likes indexados` si la carga es parcial; no inventa un total fiable.

### 15.2. Layout inicial y navegación de página

Propuesta inicial: rail de 112 px de ancho útil, 6 columnas, celda calculada a partir del ancho y gap de 2 px. Alto disponible entre cabecera nativa y player inferior, dejando margen mínimo de 12 px. Medir rectángulos nativos; no asumir alturas fijas del header/player en todos los zooms. Si no se identifica el player, usar margen inferior conservador de 88 px y validarlo manualmente. No cubrir la scrollbar del documento: considerar `window.innerWidth - document.documentElement.clientWidth` y un inset mínimo de 8 px para sistemas con scrollbar superpuesta.

Al abrir, panel de lista/galería a la izquierda del rail: ancho objetivo 560 px, limitado al espacio disponible. Es superficie de Explorer superpuesta sobre contenido, no modificación de tarjetas nativas. Dejar el player visible y usar fondo sólido para leer. El host exterior tiene `pointer-events:none`; sólo controles/panel/rail tienen `pointer-events:auto`. Abrir no mueve el scroll nativo ni bloquea todo el documento. Wheel en panel/rail desplaza su propio contenedor y usa `overscroll-behavior:contain`; fuera de ambos SoundCloud sigue respondiendo. Sin backdrops transparentes que intercepten clicks de toda la página.

Si viewport <760 px o no caben al menos 320 px útiles para panel y rail, usar una sola superficie de Explorer con pestañas `Lista`/`Galería` y navegación temporal/posición; ocultar rail persistente. El botón sigue permitiendo abrir/cerrar. La accesibilidad y navegación no pueden depender de apuntar a una miniatura de 16 px. En pantalla estrecha el panel ocupa el área entre header y player; no tapar controles nativos.

Normalizar pathname quitando barra final, ignorar query/hash para decidir visibilidad; aceptar únicamente `/you/likes` bajo origen `https://soundcloud.com`. Un perfil con ruta `/<nombre>/likes` no habilita esta entrada, aunque coincida con el usuario propio. Reutilizar detección SPA de page-intake/content si es viable; no instalar varios wrappers de history. Un host por documento, montaje idempotente tras body disponible, listeners y observers con función `dispose()`. `popstate` no basta para detectar todos los `pushState`: probar navegación real desde menú de SoundCloud. Logout con URL sin cambios también desmonta contenido de cuenta.

### 15.3. Estado compartido entre panel y rail

Estado mínimo por sesión de vista:

```text
ownerId, generation, revision, routeEpoch
mode: list | gallery
anchorTrackId, anchorPixelOffset
query, temporalFilter, previousResults
mapScrollTop, mapAnchorTrackId
drag: null | { pointerId, generation, revision, startAnchor, grabOffset }
visibleRange: { firstTrackOrdinal, lastTrackOrdinal }
```

Los ordinales internos empiezan en 0. El número mostrado al usuario empieza en 1. Orden: más reciente primero, exactamente como el adaptador; ni título, ni color, ni publicación reordenan la colección. Un click en miniatura lleva al track exacto en Explorer y lo resalta; un click en zona vacía válida del rail centra la fila más próxima; nunca reproduce sólo por hover o drag. Play es acción explícita.

Con filtro activo, la lista puede contener ids dispersos. El rail conserva orden de biblioteca y marca sólo el ancla actual, sin fingir un rango contiguo de resultados. Elegir el rail guarda query/filtros en `previousResults`, ejecuta Ver alrededor sin filtros y muestra `Volver a resultados`. Arrastrar sigue esta misma regla una vez al iniciar. Al restaurar resultados, recuperar query y track ancla anterior si todavía coincide; en otro caso mostrar resultados actualizados con explicación.

Si cambia la galería por scroll del usuario, actualizar indicador y desplazar el rail sólo si el indicador queda fuera de su ventana. Si el usuario está scrolleando el rail para buscar otra sección, no recentrarlo hasta elegir destino o pulsar `Volver a zona visible`. Un origen de evento (`panel`, `map`, `restore`) evita realimentar scroll infinitamente.

### 15.4. Fórmulas y drag

Sean N tracks indexados, C columnas del mapa, P altura de fila de mapa incluyendo gap, H viewport del mapa y M = ceil(N/C) × P. Para N=0 mostrar vacío sin cálculos de división. El rail tiene spacer de alto M y renderiza sólo filas visibles + 4 filas de overscan inicial por lado.

Para puntero dentro del área de celdas:

```text
contentY = clamp(clientY - mapTop + mapScrollTop, 0, max(0, M - epsilon))
row = floor(contentY / P)
column = clamp(floor((clientX - cellsLeft) / cellPitch), 0, C - 1)
ordinal = clamp(row * C + column, 0, N - 1)
```

Verificar hit-test de gap: si cae en gap puede elegir celda más cercana de esa fila; última fila parcial nunca genera ids inexistentes. Obtener identidad desde consulta paginada de esa generación, no desde índice de un array de DOM reciclado.

Indicador real en coordenadas de contenido: inicio = floor(firstTrackOrdinal/C) × P; fin = (floor(lastTrackOrdinal/C)+1) × P. Dibujar intersección con viewport restando mapScrollTop. Si su altura real es menor de 24 px, ampliar sólo la zona de agarre/hit-test, no los números del rango representado. Si supera H, recortarlo; no confundir el rectángulo recortado con toda la biblioteca.

`pointerdown` en indicador captura puntero y guarda offset de agarre respecto de inicio real. Durante drag, convertir posición a ordinal de primera fila destino y consultar por ancla; actualizar como máximo una vez por animation frame y permitir una sola consulta de navegación activa, descartando respuestas anteriores. No escribir preferencias en cada movimiento; persistir en pointerup. Autoscroll del mapa cerca de sus bordes (24 px iniciales, máximo propuesto 300 px/s) permite arrastrar más allá de la ventana. Detener RAF y captura en pointerup, pointercancel, Escape, navegación, pérdida Pro o cambio de cuenta.

No recalcular posición bajo los dedos al agregar páginas/nuevos likes. Congelar vista a generation+revision durante drag; aplazar publicación visual y guardar ids ancla. Al terminar aplicar datos nuevos y resolver ancla por id. Si una revisión fijada deja de estar disponible, cancelar drag y reconsultar con aviso breve en vez de saltar a otro track silenciosamente.

La rueda del minimapa sólo cambia su viewport; no selecciona ni mueve el panel hasta click/drag. El control global de posición calcula `round(percent * (N-1))` y llama a la misma navegación por ancla. Año/mes consulta primer id del grupo temporal. Teclado: rail enfocable, flechas por fila, PageUp/Down por ventana, Home/End a límites conocidos y Enter confirma destino. Proveer lista alternativa completa, etiquetas de título/artista e indicador textual de rango; no crear 50.000 elementos accesibles invisibles.

## 16. Portadas WebP: descarga, conversión y caché personal

### 16.1. Significado de guardar todas las fotos

En este plan significa almacenar **portadas de los tracks de los likes personales** en el almacenamiento local de la extensión. No es descarga de fotos del perfil, ZIP, archivos sueltos en Downloads, copia del audio ni sync remoto. Esta interpretación da soporte al minimapa y a la futura lupa. Una exportación de archivos al usuario sería otra feature.

La metadata guarda URLs de artwork sin esperar imágenes. La lista puede abrir con placeholders; las imágenes visibles se solicitan por demanda. Cuando haya suficiente información, mostrar una vez por cuenta un aviso no modal:

> ¿Guardar las portadas de tus likes en este navegador para explorar más rápido? Se guardan versiones pequeñas. Podés pausar o borrarlas cuando quieras.

Acciones `Guardar portadas` y `Ahora no`, con ajuste accesible después. No repetir por cada apertura si rechazó. Mostrar cantidad conocida, aclarar colección parcial y estimación de espacio sólo tras medir una muestra real. La aceptación se guarda por ownerId; cambiar de cuenta no hereda permiso. Borrar toda la biblioteca borra también este consentimiento; borrar sólo imágenes lo conserva pero pausa la caché hasta reanudar explícitamente, para que no se rellene inmediatamente.

Sin aceptación: memoria acotada para imágenes visibles y caché HTTP que gestione Chrome, sin trabajo de precarga persistente de toda la biblioteca. Con aceptación: job recorre todas las portadas únicas de los tracks indexados y continúa con nuevas entradas. No afirmar `todas guardadas` mientras indexación siga parcial o existan fallos/cuota pendiente. Texto de resultado: `X portadas guardadas · Y sin portada · Z pendientes/fallidas`.

### 16.2. Pipeline propuesto

1. UI pide por id de track y variante; background obtiene artwork URL del registro autorizado. Nunca aceptar una URL arbitraria del cliente.
2. Preferir artwork de track; avatar de artista sólo como fallback identificado visualmente, sin contabilizarlo como portada original. Track sin ambos usa placeholder determinista y no bloquea job.
3. Fetch desde origen de extensión con hosts sndcdn ya permitidos, `credentials:omit` y sin token OAuth. Validar HTTPS, host exacto o subdominio real terminado en `.sndcdn.com`, y destino final de redirects; imponer timeout y límite de bytes también leyendo cuerpo, no sólo Content-Length. No descargar un URL de audio por coincidir host.
4. Obtener una imagen fuente de tamaño moderado (objetivo ~200 px; adaptar sólo transformaciones de URL probadas). No deducir que renombrar `.jpg` a `.webp` convierte la imagen. Validar MIME de imagen y decodificación; límite inicial 2 MiB comprimidos y rechazar dimensiones decodificadas desproporcionadas. La elección de una fuente pequeña reduce riesgo de consumo al decodificar; medir pico de memoria.
5. `createImageBitmap(blob)` y canvas 2D para reescalar manteniendo proporción. Encajar en cuadrado; usar el mismo criterio de crop centrado en galería/miniatura para que sea reconocible. Dos variantes propuestas: 48 × 48 para minimapa y 160 × 160 para galería/lupa. Calidad WebP inicial 0.65 y 0.75 respectivamente. No generar tamaño grande para exportar arte sólo por anticipación.
6. En worker, evaluar `OffscreenCanvas` y `convertToBlob({type:'image/webp', quality})`; verificar que el Blob resultante tenga MIME `image/webp`, dimensiones esperadas y contenido decodificable. Si devuelve otro formato, no guardarlo como WebP. La API puede recurrir a PNG si no soporta el formato solicitado; esto está documentado en [MDN convertToBlob](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob).
7. Guardar blobs, bytes y estado en transacción breve. Fetch, decode y encode ocurren fuera de la transacción de IDB. Cerrar ImageBitmap, liberar buffers y canvas entre trabajos. No sostener imágenes de toda la biblioteca decodificadas en memoria.

Validar este pipeline en el service worker real. Si allí falta una capacidad de conversión, usar un helper de extensión bajo demanda que devuelva el resultado, con integración explícita en la infraestructura offscreen existente. No crear un segundo documento offscreen sin coordinar su ciclo de vida con el audio. Hasta demostrar ese fallback, la lista y las imágenes por demanda siguen funcionando; la caché masiva WebP permanece deshabilitada con motivo visible. `OffscreenCanvas` no implica que sea necesario un documento `chrome.offscreen`.

### 16.3. Stores adicionales y límites

| Store | Clave | Datos |
| --- | --- | --- |
| artwork | [ownerId, assetKey, variant] | blob WebP, bytes, width, height, sourceFingerprint, encoderVersion, savedAt, lastAccessAt |
| artworkRefs | [ownerId, trackId] | assetKey, sourceFingerprint; índice [ownerId,assetKey] |
| artworkJobs | ownerId | jobId, jobEpoch, status, generation, pending checkpoint, counters, retryAt, consentVersion |
| artworkPreferences | ownerId | accepted, pausedByUser, budgetBytes, requestedVariants |

`assetKey` deriva de URL de fuente validada y versión de conversión; quitar sólo parámetros de tamaño conocidos al deduplicar, nunca query arbitraria que cambie contenido. Dos tracks con misma portada pueden compartir blobs dentro de una cuenta. Variantes y caché no se duplican por cada generación de metadata. Si cambia artwork URL, actualizar ref; borrar blob antiguo sólo sin referencias y fuera de vistas activas. En unlike confirmado, limpiar refs huérfanas después de publicar la generación nueva. No compartir caché entre cuentas en V1.

Presupuesto inicial propuesto: 200 MiB globales para artwork de Explorer; medir con muestra, mostrar uso real y permitir limpieza. No prometer que 50.000 portadas siempre caben. Consultar `navigator.storage.estimate()` desde contexto de extensión y usar margen conservador, sabiendo que cuota/uso pueden ser aproximados. Metadata tiene prioridad. Cache IDB pertenece al origen de extensión; no hay que aplicar el límite de `chrome.storage.local` a IDB. Chrome documenta disponibilidad de IDB/CacheStorage en service workers en [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

Si se alcanza presupuesto o cuota: pausar precarga, conservar lo guardado y navegar con placeholders/por demanda. Mostrar opciones de borrar imágenes o reintentar tras liberar espacio. No añadir `unlimitedStorage` ni elevar presupuesto silenciosamente. No desalojar automáticamente la colección que el usuario pidió guardar completa; eso impediría distinguir completa de parcial. Caché temporal de pantalla sí usa LRU acotado.

### 16.4. Scheduling, reanudación y entrega a UI

Una conversión concurrente y hasta dos fetch de artwork iniciales. Prioridad: metadata interactiva y portadas de ventana visible; luego precarga. Backoff y cancelación propios para CDN, separados del cursor de likes. Fallo de una portada se registra por assetKey y deja avanzar las demás; máximo tres intentos por corrida, botón `Reintentar fallidas`. Reanudar salta variantes válidas ya persistidas. Una imagen confirmada no se vuelve a convertir por cerrar popup.

El job tiene epoch: borrar caché, revocar permiso, cambiar cuenta o pausar invalida resultados tardíos antes del commit. Pausa conserva pendientes; `Cancelar guardado` detiene el job sin borrar lo ya guardado. Indexación puede seguir sin caché; borrar sólo imágenes no cancela indexación. Revocar Pro pausa ambos jobs.

Chrome usa mensajes serializables JSON; no enviar Blob/ArrayBuffer como si runtime messaging los transfiriera directamente. Ver [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging). Implementación inicial: responder variantes codificadas como data URL en lotes pequeños, máximo 12 imágenes y 512 KiB por respuesta; partir respuestas mayores. UI decodifica a Blob/object URL local o aplica data URL si la CSP real lo permite. Mantener únicamente ventana+overscan y LRU de hasta 256 miniaturas / 64 imágenes medianas. Deduplicar requests por assetKey/variant, revocar object URLs al expulsar y en dispose. Probar CSP de SoundCloud y carga desde Shadow DOM; encapsular estilos no elimina CSP. Nunca mandar todas las imágenes en un solo mensaje.

## 17. Lupa futura

Depende de minimapa correcto y pipeline de imágenes; no bloquea V1. Al hover sostenido (propuesta 200 ms) o foco de teclado sobre una zona, abrir tarjeta flotante junto al rail con 3 × 3 portadas medianas, rango de posiciones y año/mes si conocido. No llamarla análisis: es ampliación visual de likes vecinos en orden original.

La lupa usa generación, ancla y query por vecinos del índice; no amplía una captura borrosa del minimapa. Si caché está incompleta, mostrar placeholders y solicitar sólo esas 9 imágenes. No exigir que estén guardadas todas para funcionar. Click en portada centra ese track en galería; `Ir a esta zona` centra el ancla de la lupa. Play sigue siendo botón separado.

La lupa no desplaza automáticamente SoundCloud ni se activa durante drag. Escape cierra, foco se conserva, posición se limita al viewport y no tapa permanentemente indicador/player. No abrir/cerrar al cruzar desde rail a lupa; pequeña demora de cierre. En touch, botón explícito `Ampliar zona`. Tests: borde superior/inferior, cambio rápido de ancla, imagen fallida, teclado, zoom y cierre durante fetch.

## 18. Random: dos features distintas para etapas posteriores

### 18.1. Botón “Descubrir otro like”

Motivación aportada por el usuario: en su experiencia, shuffle de SoundCloud web elige repetidamente entre likes cercanos/cargados. El ejemplo aproximado de una ventana de 10 tracks no es una regla técnica verificada del sitio y no debe publicarse como tal. Promesa propia: **elegir entre todos tus likes indexados, aunque nunca hayas scrolleado hasta ellos**. Con 1.500 likes, puede elegir posiciones 1500, 492, 830, 4 y 1120; no depende de tarjetas montadas.

Este botón elige una vez por click. No reemplaza todavía el shuffle nativo ni crea autoplay. En Explorer, elige track, centra su galería y muestra acciones de escuchar/localizar. Si se agrega un botón separado `Reproducir un like al azar`, ese texto autoriza play y usa adaptador existente; no hacer sonar audio por una acción que sólo promete descubrir.

Contrato propuesto `PICK_RANDOM_LIKE({ownerId, generation, scope, excludeIds})`: scope inicial `all`; opción `period` para una época elegida. Para `all` exigir índice completo si el texto promete toda la biblioteca. Durante indexación permitir sólo acción claramente rotulada `Al azar entre los X indexados`, si se implementa ese modo parcial. Un año no está completo sólo porque ya se observaron algunos likes de ese año.

Construir conjunto de ids de tracks elegibles: excluir playlists, registros sin identidad y no disponibles conocidos. Estado de reproducción desconocido no garantiza que se pueda escuchar; tratar fallo sin corrupción del conjunto. Usar selección uniforme sobre el conjunto elegible de la generación, no página aleatoria seguida de track aleatorio (sesga páginas incompletas). RNG inyectable para tests; producción puede usar `crypto.getRandomValues` con rechazo de sobrante al mapear a [0,n), evitando sesgo de módulo. No ponderar por popularidad, antigüedad ni tamaño de portada.

Propuesta de UX: excluir track actual y últimos 20 descubrimientos, salvo que no queden candidatos; reducir historial empezando por el más antiguo. Con N=1 mostrar `Es el único like disponible` y no prometer otro. Con N=0 mostrar vacío. Identidad y generación devueltas se validan antes de navegar. Guardar historial acotado local por cuenta para no repetir inmediatamente tras cerrar popup. Botón futuro con icono random junto al player debe identificarse como función de la extensión; no cambiar a escondidas el botón shuffle de SoundCloud.

Tests deterministas: primer/último índice alcanzables; exclusión actual; todos excluidos; 0/1/2 candidatos; playlist/ausente; parcial vs completo; filtro temporal; generación cambiada; no depender de DOM. Usar RNG falso para comprobar límites, no tests probabilísticos que fallen al azar. El hito termina cuando el botón realmente recorre el índice global autorizado.

### 18.2. Reproducción aleatoria continua / resolver la experiencia del botón random

Modo explícito `Random de todos mis likes`, independiente del shuffle nativo. Prioridad futura del usuario, pero requiere demostrar control de transición entre tracks. Preferir un control propio claramente identificado al lado del player/Toolkit. Sustituir el significado del botón nativo sólo se considera después de observar su estado e interacción; no forma parte automática de este plan.

Sesión: ownerId, tabId fijo, sessionId, generation de origen, ids barajados, posición, historial reproducido, currentTrackId, transitionId y phase. Generar Fisher–Yates uniforme sobre candidatos y consumir la bolsa sin repeticiones hasta agotarla. Guardar checkpoint de bolsa/posición para no repetir por despertar del worker; nunca reanudar audio automáticamente tras reiniciar navegador. Al completar una vuelta, ofrecer o iniciar nueva vuelta sólo si el modo sigue activado; evitar repetir inmediatamente el último track.

Estados: off -> starting -> playing -> advancing -> playing; destinos alternativos paused, needs-user-action, stalled, stopped. Cada transición sólo se acepta una vez mediante sessionId+transitionId+identidad observada. `ended` repetido no puede avanzar dos lugares. La posición se confirma al verificar el nuevo track sonando; intento fallido queda registrado separadamente. Siguiente manual del modo elige próximo de la bolsa; anterior reproduce historial real, no otro azar.

Distinguir fin real de track, pausa manual, seek al final, anuncio y cambio de media/frame. No tomar cualquier `ended` de la página como evento válido. A–B activo mantiene loop y no dispara avance; desactivar loop restituye final normal. Pausa del usuario pausa el modo. Cambio manual a otro track fuera del modo lo pausa y ofrece continuar; logout, pérdida Pro, cierre de pestaña y salida de SoundCloud lo detienen. Una segunda pestaña no puede consumir la misma sesión. No saltar anuncios ni intervenir sobre medios que no corresponden al track.

Al activar el modo detectar shuffle/repeat nativos y pedir que se desactiven si no se puede coordinar de manera fiable. No inventar control sobre una cola nativa no verificada. El gate debe probar que autoplay nativo y controlador propio no compiten por el próximo track. Si no se puede garantizar una sola autoridad de avance, mantener sólo botón manual del hito 8 y documentar bloqueo del modo continuo.

Track no disponible: registrar fallo y probar hasta tres siguientes como máximo por transición; después pausar con explicación. Login/consent/autoplay requieren intervención del usuario, no reintentos de clicks infinitos. En navegación completa, persistir intención y recuperar handshake sin perder sesión ni ancla de Explorer. Fin de sesión nunca borra likes ni cambia favoritos.

Refresh durante sesión: conservar bolsa de ids de la generación inicial y comprobar disponibilidad antes de play; likes nuevos entran en la próxima vuelta. Unlike confirmado retira ese id de pendientes. No recalcular bolsa en cada petición ni usar ordinales antiguos como identidades. Estado y metadata mínimos, sin URLs de streams.

Gate de salida: sesión autenticada real con al menos 10 transiciones observadas, track antiguo no montado, pausa/reanudar, siguiente/anterior, A–B, cambio manual, dos pestañas, worker reiniciado, anuncio cuando esté disponible y fallo de reproducción. Si no se pudo observar un escenario crítico, reportarlo pendiente. Pruebas con fixtures cubren máquina de estados pero no acreditan compatibilidad real con autoplay/cola.

## 19. Imágenes locales para compartir (etapa futura)

Conservar estas ideas de la conversación: `Share this year`, composición `My SoundCloud 2018 · 527 Likes` con 9 covers, botón `Copy image`, firma pequeña `Made with SoundCloud Track Downloader`, y variante `My oldest SoundCloud Like: 2012`. No publicar automáticamente ni integrar una red social para esta etapa.

Seleccionar año según likedAt, mostrar número de tracks liked en ese año y etiquetar como tracks si no se cuentan playlists. Si indexación está incompleta, bloquear afirmaciones de total anual definitivo y de like más antiguo absoluto; ofrecer `Entre mis likes indexados` o esperar recorrido completo. Fechas ausentes no permiten afirmar que el más antiguo observado sea el primero real.

Generación propuesta: canvas local cuadrado 1080 × 1080, cuadrícula 3 × 3, fondo sobrio, año, cantidad y firma. Elegir inicialmente nueve tracks distintos repartidos por el orden del año; permitir cambiar covers antes de copiar. Si hay menos de nueve, adaptar layout o placeholders sin duplicar silenciosamente. No afirmar que son los más escuchados: no hay datos de escucha en este índice. Portadas medianas pueden verse blandas al exportar; pedir una variante mayor sólo para esas nueve, con límites propios y borrado temporal. No descargar todas en alta resolución por esta feature.

Reutilizar fetch seguro y conversión local para evitar canvas contaminado por imágenes cross-origin. Probar `navigator.clipboard.write` de imagen en contexto real y gesto de usuario; si no funciona, ofrecer `Guardar imagen` con archivo local generado. Guardar/copy se ejecuta tras preview y acción explícita; no añadir permisos de clipboard hasta demostrar necesidad. El usuario decide dónde compartirla. No incluir nombre real, perfil o contenido de otra cuenta automáticamente.

Validación: 0/1/8/9+ covers, títulos largos, letras RU/DE/PT-BR/ES, año parcial, imagen fallida, clipboard denegado, exportación sin acceso Pro, datos de cuenta equivocada y preview idéntica a archivo. La campaña/guiones que usen esta pieza pertenecen al plan de contenido separado, no al runtime de Explorer.

## 20. Contratos concretos y guía para quien implemente

### 20.1. Lecturas iniciales y fronteras de módulos

Antes de escribir código, leer `manifest.json`, `scripts/background.js`, `scripts/content.js`, `scripts/page-intake.js`, `scripts/popup.js`, `scripts/soundcloud-http.js`, `scripts/download-source.js`, `scripts/player-tools-policy.js`, `scripts/player-tools-access.js`, `scripts/player-tools-client.js`, `scripts/run-verifications.js`, `scripts/package-extension.ps1` y las pruebas correspondientes. Revisar estado de git y documentación local aplicable; no sobrescribir cambios ajenos. Los nombres nuevos de sección 10 son propuestas, no archivos que deban existir.

Añadir a la distribución, además de los módulos base de sección 10:

| Módulo nuevo propuesto | Responsabilidad y contrato |
| --- | --- |
| `likes-minimap.js` | Render del rail, indicador, hit-testing y navegación; recibe query/navigation, no conoce OAuth ni IndexedDB |
| `likes-artwork.js` | Resolver asset autorizado, fetch/conversión, cuotas y cache; métodos ensureVariant, readBatch, clearOwner |
| `likes-artwork-jobs.js` | Precarga con consentimiento y checkpoints, separada de metadata |
| `likes-random.js` (futuro) | Selección uniforme y bolsa/historial, con RNG inyectado |
| `likes-random-session.js` (futuro) | Máquina de transiciones continua, no render ni descarga de audio |
| `likes-share.js` (futuro) | Composición local/preview/copy de tarjetas, sin publicación remota |

Usar dependencias inyectadas para request, clock, storage y random en lógica verificable. UI conoce operaciones de biblioteca, no cursores api-v2. Source transforma wrappers sin saber de Pro o DOM; router/job verifican acceso. Library es dueño de transacciones y consultas, sin timers de interfaz. Minimap y galería comparten función de navegación por id, no dos versiones de selección.

### 20.2. Registro normalizado y ejemplos

Ejemplo didáctico de wrapper de entrada, no fixture live nuevo:

```json
{
  "created_at": "2020-02-10T13:00:00Z",
  "track": {
    "id": 123,
    "title": "Example track",
    "created_at": "2016-01-01T00:00:00Z",
    "duration": 180000,
    "permalink_url": "https://soundcloud.com/example/track",
    "artwork_url": "https://i1.sndcdn.com/example-large.jpg",
    "user": { "id": 456, "username": "Example artist" }
  }
}
```

Normalizar kind por presencia de track/playlist validado, no asumir que wrapper.kind sea literalmente `track`. Guardar ids como strings canónicas; rechazar ids vacíos/inválidos. Evitar introducir dependencia en duración formateada del Downloader: `durationMs` es número finito >=0 o null. Normalizar fechas válidas a ISO UTC, inválidas a null. `likedAt` del ejemplo es 2020, `publicationDate` 2016. Indexación por época usa 2020.

```json
{
  "ownerId": "42", "generation": "g1", "kind": "track", "itemId": "123",
  "sourceOrdinal": 0, "trackOrdinal": 0,
  "likedAt": "2020-02-10T13:00:00.000Z",
  "title": "Example track", "artistName": "Example artist", "artistId": "456",
  "durationMs": 180000, "publicationDate": "2016-01-01T00:00:00.000Z",
  "permalink": "https://soundcloud.com/example/track",
  "artworkUrl": "https://i1.sndcdn.com/example-large.jpg", "availability": "unknown"
}
```

`sourceOrdinal` es posición densa de entradas únicas reconocidas track/playlist; no es número exacto de tarjeta en SoundCloud. Contar aparte `rawEntriesRead`, `unsupportedEntries`, `duplicateEntries`, `trackCount`, `playlistCount`. No descartar silenciosamente track con id pero título faltante: usar título de fallback y availability unknown/unavailable según evidencia. Entrada desconocida sin identidad no recibe trackOrdinal; registrar conteo y calidad de datos, sin romper cursor ni afirmar cobertura perfecta. Para fechas faltantes, `unknownDateCount` se muestra aparte.

### 20.3. Índices IDB y consistencia

Además del índice sourceOrdinal, `entries` necesita [ownerId,generation,trackOrdinal] para ventanas de tracks y [ownerId,generation,likedAt] para fechas válidas. Omitir trackOrdinal en playlists: null no es clave válida de IDB. Omitir/gestionar índices de likedAt ausente; la consulta de sin fecha usa índice derivado o recorrido de metadata, nunca un rango IDB con null. La clave primaria ya permite resolver track por [ownerId,generation,'track',trackId].

Añadir `revision` monotónica a libraries/jobs y respuestas para la generación parcial: una página nueva cambia el conjunto sin cambiar generation. Incrementar revisión en el mismo commit que la página. Generaciones completas son inmutables; refresh publica otra. Cada petición de UI conserva generation+revision; respuestas de revisión obsoleta no reemplazan viewport más reciente. Durante primera carga append-only, conservar ancla estable y actualizar counts fuera del drag. No ordenar staging después de cada página.

Para consultas por fecha/posición, publicar `periods` con {year,month,count,firstTrackId,complete:false|true} derivados de likedAt. No marcar un mes completo sólo por una heurística de orden hasta que una pasada completa valide la colección; eso evita falsos totales si API entrega fechas desordenadas. Una biblioteca completa puede tener `unknownDateCount > 0` y cobertura temporal incompleta. Zona horaria de agrupación guardada por vista; cambiarla recalcula grupos sin modificar timestamps ni orden.

Las transacciones no abarcan await de red. `commitPage` verifica lease token, jobEpoch, sesión autorizada capturada y checkpoint esperado, deduplica usando clave primaria, asigna ordinales nuevos, guarda checkpoint y revision de manera atómica. Contadores sólo aumentan por inserciones reales. La reejecución de misma página tras suspensión no duplica datos ni avanza dos veces. El token de lease se adquiere/renueva en transacción; otro worker sólo recupera lease vencida. Valores iniciales: lease 60 s, request timeout 15 s, unidad de trabajo una página; revalidar token después del fetch antes de escribir.

Guardar cursores ya saneados observados por job en store auxiliar `jobCursors` con clave [jobId,cursorFingerprint], o estructura equivalente durable. Un set de sólo los últimos cursores no detecta ciclos largos; usarlo únicamente como caché del registro durable. Al repetir cursor producir parcial/error, no éxito. Limpiar fingerprints al finalizar/cancelar definitivamente el job. No imprimir cursor original con credenciales en logs.

Refresh de cabeza no muta generation activa mientras UI la consulta: construir staging, copiar cola anterior en lotes con dedupe, aplicar cabeza nueva y publicar sólo al terminar. Mantener generation antigua durante publicación y operaciones fijadas; retención inicial de hasta dos generaciones, leases de lectura con expiración corta para drag/consulta. Antes de eliminar una generación fijada, invalidar operación y restaurar por id en activa. Una cuota insuficiente durante staging conserva activa y pausa; no borrar activa para hacer sitio.

### 20.4. Autenticación, despertar y cancelación

`GET_LOGGED_IN_USER` y `getOAuthToken` en background son puntos de integración existentes. Extraer helper interno para resolver identidad autenticada; Explorer no necesita recibir token en content script. El usuario autenticado debe coincidir con ownerId antes de crear/reanudar job o devolver datos. ClientId puede venir del contexto existente saneado, pero no determina identidad. Si falta contexto válido, devolver `needs-soundcloud-tab`/`auth-required` y no intentar indexar otra cuenta pública como fallback.

Mantener epoch en memoria por sesión y jobEpoch durable por trabajo. El token de cuenta capturado para fetch se asocia al owner verificado; observar cambios relevantes de cookies/logout, invalidar caché de identidad y revalidar al abrir vista, despertar worker y entre lotes. No persistir OAuth para recuperar epoch. Al reiniciar worker, la sesión anterior no se presume válida por existir un job. Para lecturas offline, permitir cache sólo mientras se conserva una identidad local ya verificada y no se detectó cambio/logout; tras despertar sin poder verificarla, mostrar estado de autenticación pendiente en lugar de revelar otra biblioteca.

Al finalizar cada unidad persistir estado y programar reanudación si queda trabajo. Registrar listeners de runtime/alarms al cargar worker y recuperar trabajos no terminados al despertar. No depender de mantener un puerto abierto ni de un setInterval para completar biblioteca. Chrome puede terminar el worker y perder variables globales; ver [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). Alarma es oportunidad de recuperación, no promesa de ejecución exacta. Una ráfaga puede procesar páginas mientras el worker siga activo, pero la siguiente siempre debe poder retomarse desde disco.

Cancelar indexación significa pausar con cursor utilizable y no borrar páginas. `Reiniciar índice` crea staging nuevo mediante acción separada. Cerrar panel deja continuar trabajo solicitado si cuenta/Pro siguen válidos; detener explícitamente y logout sí lo pausan. Cancelar play/localizar es independiente de indexación. Cleanup de UI no debe cancelar globalmente un job que otra vista usa.

### 20.5. Mensajes, límites y errores

Usar `success` como envelope para encajar con helpers existentes; no mezclar APIs nuevas `ok` y `success` sin adaptador. Ejemplo:

```json
{
  "type": "QUERY_LIKES", "requestId": "q17", "ownerId": "42",
  "generation": "g1", "revision": 3,
  "query": "example", "period": null, "offset": 0, "limit": 100
}
```

```json
{
  "success": true, "requestId": "q17", "ownerId": "42",
  "generation": "g1", "revision": 3, "items": [],
  "matchingCount": 0, "indexedCount": 500,
  "completeness": "partial", "unknownDateCount": 2, "hasMore": false
}
```

0 resultados sobre 500 indexados no significa que los likes aún no leídos no contengan coincidencias. La UI muestra esa distinción. Para preparación del índice de búsqueda, devolver `search-preparing` y estado; no contestar items vacíos como resultado definitivo.

| Operación | Entrada específica | Resultado/efecto |
| --- | --- | --- |
| GET_LIKES_LIBRARY_STATUS | ownerId, tab/context validado | phase, counts, generation/revision, auth/access, artworkStatus |
| START_LIKES_INDEX / REFRESH_LIKES_LIBRARY | mode initial/head/full | ack inmediato con operationId; creación idempotente |
| CANCEL_LIKES_INDEX | operationId | pause durable; no borrar biblioteca |
| QUERY_LIKES | texto/period/offset/limit | ventana de metadata, count y completeness |
| GET_LIKES_AROUND | trackId, before/after | ancla, trackOrdinal y vecinos en orden original |
| GET_LIKES_AT_POSITION / GET_LIKES_PERIODS | ordinal / zona horaria | id ancla / grupos temporales |
| SAVE_LIKES_VIEW / SAVE_LIKES_BOOKMARK | ids ancla y preferencias/nombre | estado pequeño validado; sin blobs |
| START_LIKES_ARTWORK / PAUSE_LIKES_ARTWORK | ownerId, consentimiento/version | job separado de metadata |
| GET_LIKES_ARTWORK | trackIds + variant | lote acotado, fallos por item, sin bloquear por portada rota |
| DELETE_LIKES_ARTWORK | ownerId | invalida epoch, elimina blobs/refs y pausa precarga |
| DELETE_LIKES_LIBRARY | ownerId, alcance explícito | cancela trabajos/intenciones, elimina stores de cuenta |
| PLAY_LIKED_TRACK / LOCATE_LIKED_TRACK | trackId, targetTabId | operationId; progreso consultable |
| CANCEL_LIKES_ACTION | operationId | invalida esa intención, conserva índice |
| PICK_RANDOM_LIKE (futuro) | scope/exclusiones acotadas | id elegido + generation + descripción del conjunto |

Límites iniciales: query 200 caracteres, limit 1–200, before+after <=200, nombre de bookmark 80 caracteres, ids por mensaje <=200 salvo artwork <=12. Validar enteros no negativos, enum de variant/mode y ownership real del tab. Content script sólo opera su sender.tab.id y frame 0; popup de extensión puede pedir tabId explícito verificado. Intentos de UI MAIN sólo abren acciones visuales mediante puente, nunca autorizan Pro o fetch de datos.

Errores estables propuestos: `pro-required`, `auth-required`, `owner-mismatch`, `needs-soundcloud-tab`, `not-indexed`, `partial-library`, `search-preparing`, `stale-generation`, `invalid-request`, `rate-limited`, `storage-full`, `cursor-expired`, `cursor-cycle`, `track-missing`, `needs-user-action`, `cancelled`. Mantener convención existente de errores HTTP en adaptador y mapear en router; no reescribir todo el Downloader para uniformar nombres.

Estados/progreso se envían tras commit; UI consulta estado al abrir/reconectar y no depende de haber recibido todos los eventos. Un operationId no puede reutilizarse para otro owner. Repetir START mientras hay job devuelve el mismo job compatible. Dedupe de play por requestId evita doble toggle al reintentar mensaje.

## 21. Inventario de ideas y límites de esta destilación

| Idea de la conversación / boceto | Destino en este plan |
| --- | --- |
| Reencontrar música vieja con galería de artwork | Lista/galería y minimapa, hitos 2–3 |
| Abrir Explorer desde player/perfil | Toolkit/popup personal en V1; perfil ajeno hito 11 |
| Lista rápida como selector Downloader | Metadata progresiva + ventanas; no reutilizar espera de lista completa |
| Navegar por año/mes, conteos por año | likedAt del wrapper, periodos completos/parciales y sin fecha |
| Buscar likes antiguos | Texto por título/artista en V1; sin búsqueda IA |
| Guardar fotos antes de navegación visual avanzada | Opt-in de caché personal WebP, hito 4 |
| Indicador de la foto 3 | Drag del rango visible en galería propia, hito 3 |
| Lupa y salto a secciones | Hito 7, consulta de vecinos y miniaturas medianas |
| Random con alcance real de biblioteca | Hitos 8 y 9 separados; no ventana del DOM |
| Compartir año, nueve covers, copy image, firma | Hito 10, render local y preview |
| Compartir like más antiguo | Hito 10 con gate de cobertura temporal |
| Debate Free/Pro | Cerrado por usuario: lifetime Pro existente |
| Likes de otros usuarios | Futuro explícito; cache de todas las portadas autorizada sólo para personales |

Las siguientes ideas se conservan como índice de próximos planes, **sin ejecutarlas ni desarrollarlas en este documento**:

- Store/localización: cinco descripciones EN, RU, DE, PT-BR, ES a partir de `current_description.txt`, adaptación SEO y tutorial para cargarlas en Chrome Web Store.
- Player Tools: header/icono y boceto `NEW_PLAYER_HEADER.png`, quitar rating del panel premium, EQ de pago en escucha/exportación, presets de FX/velocidad/loops editables y eliminables, restaurar settings, estructura visual de presets; aclarar quick A/B y compartir timestamps; shortcuts futuros.
- Monetización global: revisar límites de trial/velocidad/preserve pitch, distribución Free/Pro de reverb/delay/EQ, precio fundador y futuras subidas. La decisión de Explorer no cambia esas reglas automáticamente.
- Rating/retención: prompt tras descargas exitosas, cadencia propuesta por usuario de 1–2 descargas, `No volver a mostrar` persistente y tratamiento de reviews. Requiere su propio diseño, no un prompt en Explorer.
- Material de lanzamiento: screenshots por feature, al menos diez guiones de video basados en la guía manual, Shorts/TikTok/Reels reutilizables y videos explicativos de YouTube.
- Landing SEO: ampliar sitio existente con páginas por intención, incluyendo `/find-old-soundcloud-likes`; no crear otra landing desde cero por asumir que falta.
- Analytics/distribución: embudo desde apertura de herramientas hasta compra, retención/uninstall y acciones de crecimiento. Las cifras/afirmaciones de mercado de la conversación son antecedentes a verificar en ese plan; no resultados medidos por esta edición.

La narrativa para comunicar Explorer puede ser `Rediscover years of Likes` y una demo de biblioteca grande -> año -> portada -> escuchar. No comprometer una fecha exacta, conteo completo o reproducción automática en marketing antes de pasar los gates técnicos correspondientes.

## 22. Validación, entrega y asuntos que requieren evidencia real

### 22.1. Gates técnicos y fallback

| Incertidumbre real | Cómo cerrarla | Si falla |
| --- | --- | --- |
| Api-v2/auth/clientId actuales | Capturar páginas personales saneadas y probar fetch desde worker | Pausar con auth/context necesario; adaptar source sin tocar proyección Downloader |
| Fecha de like y entradas especiales | Comparar wrapper y track, fixtures con playlists/ausentes | Grupo sin fecha/calidad parcial; no usar fecha de publicación |
| Play de track no montado | Identidad correcta + media playing en sesión autenticada | Abrir para escuchar con Play manual |
| Conversión WebP en worker | Decodificar/re-escalar/convertir/reabrir blob en extensión real | Helper coordinado sólo si se prueba; cache WebP pendiente mientras lista funciona |
| Imágenes desde Shadow DOM/CSP | Mostrar variante servida por mensajes en sitio real, ambos temas | Adaptar mecanismo de render local; no pedir permisos amplios sin evidencia |
| Espacio lateral/SPA | Probar ruta directa, menú, atrás/adelante, zoom y viewport estrecho | Layout compacto de una superficie; no superponer player |
| Localización nativa antigua | Scroll controlado hasta target real y cancelación | Tiempo agotado + Ver alrededor/Abrir; no éxito falso |
| Cola random frente a cola SoundCloud | Transiciones autenticadas, native shuffle/repeat, anuncios y A–B | Mantener random manual; continuo no entregado |
| Clipboard de imagen | Copiar preview con gesto real y pegar en aplicación de prueba | Guardar imagen local |

No pedir al usuario decisiones técnicas rutinarias ya resueltas por estas reglas. Pedir información sólo si falta acceso indispensable para un gate real y continuar las partes independientes. Una prueba no ejecutada se registra pendiente, nunca aprobada por inferencia.

### 22.2. Pruebas y comandos por etapa

La edición de este documento no necesita ejecutar suites de runtime. Durante implementación:

1. Hitos 0–1: verificadores de source/IDB/jobs con red, reloj y storage controlados. Casos de sección 13, auth invalidada entre fetch/commit y suspensión antes/después de commit. Ejecutar regresión `node scripts/verify-page-intake.js` y pruebas de HTTP/DownloadSource existentes que se hayan tocado.
2. Hito 2: policy/access/client y browser de lista con fixtures; validar free sin indexar, Pro sin consumir loops, búsqueda parcial, desmontaje por SPA y foco. Ejecutar `npm run test:player-tools` y `npm run test:e2e:popup` si se modificó el popup.
3. Hito 3: pruebas puras de fórmulas de rail y browser de drag/scroll/filtro/resize; colecciones 0,1,1k,10k,50k y zoom 100/125/150/200%. Comprobar número de celdas montadas y requests de imágenes, no sólo screenshot.
4. Hito 4: muestras JPEG/PNG/WebP, MIME incorrecto, URL compartida, imagen gigante, error CDN, aborto, quota, reinicio y borrado con fetch pendiente. Reabrir blobs y comprobar MIME/dimensiones; medir uso de disco y pico de memoria con 10k/50k.
5. Hito 5: locator con DOM incremental/reciclado, estancamiento y entrada manual; comprobar que cancelar deja de mover scroll definitivamente.
6. Hito 6: `npm test`, regresiones browser afectadas y `npm run package:extension`. Revisar ZIP contra allow-list: cada script/CSS runtime nuevo incluido y cargado en orden. Excluir explícitamente verificadores browser/live nuevos de `run-verifications.js` antes de darles nombre verify-*.js. Ninguna prueba live debe ser dependencia de npm test.
7. Hitos posteriores: añadir tests de sus secciones y repetir regresiones sólo de superficies tocadas. No marcar modo continuo validado por aprobar selección aleatoria pura.

### 22.3. Recorrido manual mínimo de V1

- Free, `/you/likes`: botón discreto visible; abre información Pro; no crea índice ni precarga fotos. Descargar likes sigue funcionando.
- Pro, primer uso: abrir -> primeras filas aparecen antes del último request -> buscar entre lo indexado -> seguir recibiendo progreso. Rechazar fotos no impide navegar.
- Indexación terminada: saltar a año antiguo, elegir portada, observar vecinos correctos, usar Volver a resultados. Seleccionar desde minimapa nunca mueve lista nativa.
- Arrastrar indicador a otra sección; scrollear rail sin seleccionar; saltar al final; cambiar densidad/ancho y conservar track ancla.
- Aceptar fotos: progreso separado; pausar/reanudar, cerrar UI y despertar worker. Volver sin red con contexto de identidad aún válido: portadas guardadas visibles, faltantes identificadas.
- Escuchar track lejano: identidad correcta o instrucción Play manual; volver a likes recupera ancla. A–B anterior no se aplica al nuevo track.
- Localizar nativo: progreso real y cancelación. Cambiar ruta manualmente detiene tarea y retira botón lateral.
- Logout/cuenta B: no mostrar títulos, portadas ni resultados de A. Volver a A recupera caché sólo tras validar cuenta.
- Borrar sólo portadas: índice/bookmarks sobreviven y precarga queda pausada. Borrar biblioteca: nada reaparece por respuestas tardías.
- Perder Pro: nuevas lecturas/acciones/jobs bloqueados, audio nativo actual no interrumpido, datos locales borrables.

### 22.4. Evidencia que debe dejar cada implementación

Al terminar un hito actualizar estado de este documento o un handoff enlazado con: commit/base, archivos cambiados, decisión de fallback si aplica, verificadores ejecutados y resultado, casos manuales observados, limitaciones pendientes y próximo hito. Registrar latencias con tamaño de biblioteca, navegador, equipo y si caché estaba caliente; no presentar objetivos de sección 7 como mediciones. Fixtures saneados sin cookies, OAuth, clientId persistido ni URLs sensibles. Capturas sólo cuando ayuden a evaluar layout.

Fuentes técnicas consultadas al actualizar el plan: documentación oficial de Chrome sobre mensajes, ciclo de vida de worker y almacenamiento, y documentación de MDN sobre convertToBlob, enlazadas en sus secciones. La integración api-v2/DOM de SoundCloud conserva evidencia histórica de sección 2 y requiere nueva validación autenticada. Esta edición revisó código local y contratos; no ejecutó una sesión real de Explorer porque todavía no existe.
