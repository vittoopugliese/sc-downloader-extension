# Likes Explorer — implementación local, 16 de septiembre de 2026

Base: `1faa3637f222c065c326e170e0ab2f335f3cfa9d`. Cambios sin commit ni publicación.

## Resultado

Se implementó el recorrido principal de V1: entrada discreta en `/you/likes`, biblioteca personal persistente, galería/lista virtualizada, búsqueda título/artista, navegación por mes del like y por posición, minimapa virtual con indicador arrastrable, ver alrededor/volver a resultados, marcadores y anterior/siguiente manual. Popup y Toolkit llevan al mismo Explorer. La interfaz usa Shadow DOM, mantiene libre el player inferior y adapta el panel a pantallas estrechas.

El problema del infinite scroll se resuelve separando la biblioteca de la página nativa. El adaptador pagina `/users/{ownerId}/likes` y guarda metadata mínima en IndexedDB **del origen de la extensión**. Las consultas y saltos del Explorer no necesitan tarjetas montadas en SoundCloud. No se descarga audio.

La acción de escucha es deliberadamente **Abrir para escuchar**: guarda el ancla y navega al permalink del track en la pestaña emisora. El usuario pulsa Play en SoundCloud. No se implementó ni se anuncia autoplay o una cola propia. El acceso del popup/Toolkit permite volver al Explorer. La utilidad secundaria **Localizar en SoundCloud** sí recorre el scroll, observa cambios de tarjetas y permite cancelación; tiene presupuestos de 30 segundos, 8 segundos sin progreso y 40 avances.

## Datos, seguridad y trabajos

- Nuevos módulos: `soundcloud-likes-source.js`, `likes-library.js`, `likes-jobs.js`, `likes-explorer.js`, `likes-explorer-i18n.js`, `soundcloud-likes-locator.js`, `likes-popup.js`.
- Background valida sender de extensión, frame superior, origen y dueño autenticado. Reutiliza la resolución de clientId de page-intake y la sesión OAuth de download-source; no persiste credenciales ni audio. Cursor limitado al endpoint del dueño y saneado.
- Capability `likesExplorer` y operación `explore-likes` requieren Pro lifetime. No consumen loops. Free puede borrar su biblioteca local desde la pantalla Pro. Downloader conserva sus acciones y formatos.
- Checkpoint y metadata se confirman en una transacción. Época, generación y revisión rechazan respuestas tardías. Un único ejecutor del worker serializa la red. Alarmas recuperan páginas pendientes al despertar; si no hay pestaña/contexto autenticado válido, pausa explícitamente.
- Primera indexación progresiva. Actualización mediante recorrido **completo**, con generación de staging; se conserva la generación completa anterior hasta publicar la nueva. Se retienen como máximo activa y anterior después de una publicación. No hay refresh optimizado sólo de cabeza todavía.
- Dedupe por kind/id; playlists conservadas como referencias, sin expansión. Fecha del wrapper separada de la fecha del track. Conteos de entradas leídas, playlists, duplicados, entradas desconocidas y tracks sin fecha.
- Búsqueda en metadata en memoria del worker, preparada desde IDB y cacheada por generación/revisión; respuestas máximas de 200 tracks. No se envía toda la biblioteca al content script. Agrupación temporal en UTC; no hay selector de zona horaria.
- Logout/cambio de cookie o entitlement invalida vistas y trabajo pendiente. La caché offline sólo puede usarse con identidad previamente verificada en la vida del worker y cookie sin cambios; un worker nuevo necesita autenticar antes de mostrar metadata.
- Reintentos de red/429 acotados con backoff y alarmas; pausa manual conserva cursor y cancela reintento programado.

## Portadas

En Almacenamiento (engranaje), el usuario elige **Guardar portadas**. Es opt-in, separado de indexación, con progreso, pausa, reanudación y borrado. No se descargan portadas al instalar o con Explorer cerrado antes de solicitarlo. Sin opt-in, sólo se cargan imágenes de las ventanas visibles y overscan, mediante caché HTTP habitual.

El worker valida host/imagen, omite credenciales, rechaza redirects, limita bytes leídos a 2 MiB y convierte con `createImageBitmap` y `OffscreenCanvas` a WebP real de 48/160 px. Blobs deduplicados por URL y cuenta, presupuesto de 200 MiB, un convertidor concurrente, epoch para impedir resurrección tras borrado/pausa. Mensajes de imágenes limitados a 12 y 512 KiB; caché de UI acotada. Las imágenes fallidas se contabilizan; volver a guardar después de terminar recorre pendientes/fallidas y omite assets existentes.

## Validación ejecutada

- `npm test`: 39 verificaciones locales aprobadas, incluyendo source, fechas, cursores, privacidad y Pro.
- `npm run test:player-tools`: policy/access/client/commerce y servicio de licencia aprobados.
- `npm run test:e2e:likes`: Chromium, biblioteca simulada de 50.000 tracks; virtualización, búsqueda, salto distante, drag, viewport 390/760/1024/1360, navegación SPA, gate Pro, localizador incremental y cancelación.
- La misma suite prueba IndexedDB real: dedupe, replay de checkpoint, pausa con respuesta tardía, reanudación y publicación de refresh sin perder la generación activa.
- La misma suite carga **la extensión real en un perfil Chromium temporal**: worker arranca, convierte/reabre WebP a 48 y 160 px, verifica cuenta cambiada durante fetch, bloqueo de commit, reanudación, validación de sender/owner, denegación Free y borrado permitido. Comprueba la entrada del popup real.
- `npm run test:e2e:popup`: aprobada a escalas 1/1.25/1.5/2 y página no compatible.
- `npm run test:e2e:tempo`: aprobado tras ubicar el acceso del Explorer como enlace compacto de marca, conservando los tres controles existentes.
- `npm run package:extension`: ZIP local generado y listado revisado. Wrapper Node multiplataforma reutiliza la allow-list PowerShell; incluye los siete módulos runtime nuevos y excluye pruebas. No se publica.
- `git diff --check`: aprobado.

Capturas de fixtures: `test-results/likes-explorer-desktop.png` y `test-results/likes-explorer-mobile.png`. Las portadas de esas capturas son placeholders de datos simulados, no una biblioteca personal capturada. No se presentan tiempos objetivo como latencias reales de SoundCloud.

## Gates pendientes antes de una publicación

No hubo una sesión SoundCloud autenticada disponible: CDP local 9223 no respondía. No se inspeccionaron cookies de perfiles personales ni likes privados. Quedan pendientes el recorrido real autenticado del adaptador, los cambios SPA del sitio actual, la carga de imágenes bajo su CSP y la localización de un like muy antiguo con DOM real. El fallback de escucha manual cumple la decisión del plan; **fast play automático no está validado ni implementado**.

También quedan para endurecimiento previo a release: benchmark de disco/memoria con portadas reales 10k/50k, pruebas de cuota y suspensión abrupta del worker durante cada fase, matriz extensa de zoom/teclado/lector de pantalla, gestión de bibliotecas de otras cuentas desconectadas y medición de red/CDN real. No hay afirmación de V1 completamente validada para publicación.

Lupa, random manual/continuo, imágenes para compartir y perfiles ajenos siguen fuera de V1, como establece el plan.

## Probar

1. Recargar la extensión descomprimida en Chrome/Chromium.
2. Con SoundCloud conectado y Pro activo, abrir `/you/likes` y pulsar `♡ Likes`.
3. Elegir Crear mi biblioteca; explorar mientras llegan las páginas. Usar posición o meses para saltar lejos sin mover la lista nativa.
4. Seleccionar un track y Abrir para escuchar; al volver por popup/Toolkit se recupera el ancla.
5. En el engranaje, guardar o borrar portadas y administrar lugares guardados.
