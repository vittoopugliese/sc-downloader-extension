# Likes Explorer: escucha directa y apertura en otra pestaña

Implementado localmente el 09/10/2026. No publicado.

El Explorer permite seleccionar un track y pulsar Reproducir sin localizar primero la tarjeta nativa de SoundCloud. La virtualización de seis columnas se conserva. Seleccionar una tarjeta muestra sus detalles inmediatamente, sin volver a consultar la biblioteca ni iniciar audio.

## Comportamiento

- Las portadas solo seleccionan. El único botón propio de Play/Pausa está en el detalle seleccionado. No hay anterior/siguiente ni avance automático: otro track requiere seleccionarlo y pulsar Reproducir.
- El iframe reemplaza la foto y el título internos dentro del detalle, encima del buscador. Ocupa 80 px de alto; escala el layout de 100 px del widget para conservar sus controles completos. No hay tarjeta inferior ni metadatos duplicados.
- Un único iframe activo, fuera de la ventana virtual. Elegir otra portada muestra sus metadatos y oculta el iframe sin desmontarlo ni cambiar el audio. Volver a seleccionar el track que suena vuelve a mostrar el mismo iframe. Cerrar/reabrir el Explorer tampoco lo recarga. Navegar por rutas SPA conserva la reproducción activa; recargar o cerrar la pestaña la termina.
- Abrir usa una pestaña nueva en segundo plano. No modifica el scroll, el track seleccionado ni los filtros del Explorer. El popup reutiliza una pestaña de likes existente o crea otra; no navega sobre una pestaña que contiene un track.
- Se guardan búsqueda, período, track ancla y desplazamiento dentro de su fila. Teleport continúa disponible como acción secundaria.
- La reproducción confirmada del widget pausa el player nativo de la misma pestaña; arrancar el nativo pausa el widget. No se controla el audio de otras pestañas.
- Las respuestas de solicitudes de reproducción antiguas se descartan. Borrar la biblioteca, cambiar de identidad o perder acceso cancela la reproducción correspondiente. No se muestra “reproduciendo” hasta recibir confirmación del widget.

## Implementación

`likes-player.js` encapsula el iframe, el protocolo postMessage, los estados y los plazos de carga. Valida origen **y** ventana emisora. Cada cambio de track reemplaza el iframe anterior, como hace `SC.Widget.load`, para que mensajes tardíos de otro track no afecten al actual. No carga JavaScript remoto en el contexto de la extensión ni agrega permisos.

`PLAY_LIKED_TRACK` atraviesa la misma autorización, validación de identidad, colección y generación que las demás operaciones de Explorer. El background resuelve la identidad del track desde IndexedDB. La UI no proporciona una URL de audio arbitraria.

El iframe se crea al pedir reproducción; no se precargan audios al recorrer portadas. El detalle muestra primero los metadatos indexados. Su contenedor permanece montado para evitar recargas accidentales al seleccionar otros tracks. La llegada del audio depende de SoundCloud y de la conexión, por lo que no se promete latencia cero.

El widget oficial queda visible con sus controles. Si Chrome bloquea el inicio automático se indica pulsar Play allí. Si un track no puede reproducirse en el embed, permanecen disponibles reintentar y abrirlo en otra pestaña. Esta reproducción usa el widget: Looper/FX/EQ del player nativo no se conectan automáticamente al audio del iframe.

Referencias consultadas: [Widget API](https://developers.soundcloud.com/docs/api/html5-widget), [controlador oficial usado para verificar el protocolo](https://w.soundcloud.com/player/api.js), [autoplay en Chrome](https://developer.chrome.com/blog/autoplay).

## Validación

- `npm.cmd test`: 62 verificaciones aprobadas, incluida la regresión de apertura del popup.
- `node scripts/likes-explorer.browser-test.js`: virtualización con 50.000 tracks, IndexedDB, localizador, worker real de extensión, autorización de reproducción y creación de pestaña inactiva sin actualizar la emisora.
- `node scripts/likes-playback.browser-test.js`: selección sin reproducción, iframe integrado de 80 px, ausencia de controles por portada y de avance automático, pausa, fallback de autoplay, cambios rápidos, cancelación pendiente, mensajes falsificados, conservación de vista, cierre/reapertura, navegación SPA, invalidación de identidad y layout de 390/760/1024 px. Biblioteca y widget simulados para controlar errores y carreras.
- `node scripts/likes-player-live.cjs`: navegador nuevo, página y widget reales de SoundCloud, track público `forss/flickermood` (293). Reproducción confirmada con eventos reales y avance superior a 1.000 ms. No usa un perfil personal ni valida una biblioteca autenticada real.
- Capturas locales: `test-results/likes-playback-desktop.png`, `test-results/likes-playback-mobile.png` (fixtures), `test-results/likes-player-live.png` (SoundCloud real).
- `git diff --check`: aprobado.

La suite adicional `npm.cmd run test:e2e:popup` detecta una discrepancia preexistente en la pestaña de ayuda: espera altura/radio de 27/7 px y el CSS produce 26/6 px (`verify-popup-browser.js:311`). Ese test elimina los scripts del HTML y ni siquiera ejecuta `likes-popup.js`; sus archivos de entrada no fueron modificados por este cambio. La regresión específica de apertura desde el popup sí pasa.
