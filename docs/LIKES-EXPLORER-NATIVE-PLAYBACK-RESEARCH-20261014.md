# Likes Explorer: posibilidad de enviar un track al player nativo

> **Actualización:** el usuario autorizó implementar ambas opciones. La [implementación posterior](#implementación-posterior-del-14102026) conserva la preview y añade un botón verde agua junto al teleport. La investigación inicial que sigue es histórica.

Investigación del 14/10/2026: fuentes oficiales, código local y pruebas exploratorias con páginas públicas en Chromium nuevo, sin sesión personal. No se modificó la reproducción de la extensión. La transferencia completa no quedó validada.

La posibilidad más razonable es conservar el iframe para escuchar y añadir una acción explícita para reproducir el mismo track en el player de SoundCloud. La documentación pública no ofrece una llamada que transfiera el widget a ese player. La extensión tendría que activar la reproducción nativa mediante la interfaz del sitio y confirmar el cambio. Esta última vía requiere validación real antes de prometer que funciona con cualquier track.

## Capacidades verificadas

- La [Widget API oficial](https://developers.soundcloud.com/docs/api/html5-widget) recibe un iframe mediante `SC.Widget(iframe)`. `load(url, options)` recarga ese iframe. Permite play, pausa, seek, volumen y lectura de posición; su interfaz publicada no incluye transferencia al player de soundcloud.com, velocidad, conexión a Web Audio ni acceso al elemento de audio. Esto delimita la API documentada: no demuestra que una extensión sea incapaz de integrar el iframe por otros medios.
- La [guía de SoundCloud, Playing Tracks](https://developers.soundcloud.com/docs/api/guide) describe dos formas de reproducir desde una aplicación: widget o streams para un reproductor propio. Crear ese reproductor no equivale a reemplazar el track de la barra inferior del sitio.
- La [especificación OpenAPI publicada por SoundCloud](https://github.com/soundcloud/api/blob/master/openapi/api.yaml) documenta `GET /tracks/{track_urn}/streams`, que devuelve URLs. En la especificación consultada no se identificó un endpoint para controlar el player web o transferirle una sesión. La ausencia de ese contrato público no descarta interfaces internas privadas.
- Chrome permite [content scripts en frames que cumplan los patrones declarados](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#specify-frames). Por ello, el origen distinto del widget no hace imposible una futura integración de Player Tools dentro del iframe; sería una arquitectura adicional, no una función de la Widget API.

## Lo que hace hoy la extensión

- El widget se crea y controla por mensajes en `scripts/likes-player.js:12`, `scripts/likes-player.js:49` y `scripts/likes-player.js:67`. Su controlador local todavía no expone `getPosition` ni `seekTo`.
- Al confirmar reproducción del widget, Explorer pulsa el botón de pausa del player nativo (`scripts/likes-explorer.js:179`). Si el nativo comienza a sonar, pausa el widget (`scripts/likes-explorer.js:357`). La coordinación actual evita dos audios, pero no sustituye el track nativo.
- El bridge de Looper busca el permalink del player nativo como identidad (`scripts/looper-main-bridge.js:22`) y trabaja sobre elementos `HTMLMediaElement` (`scripts/looper-main-bridge.js:49`). Los efectos buscan el audio activo (`scripts/tempo-control-main.js:1849`) y conectan su grafo al elemento (`scripts/audio-effects-core.js:718`). Cambiar solamente un título o copiar la URL de un stream al audio existente dejaría sin resolver el estado de SoundCloud y la identidad que utiliza Looper: riesgo inferido de estas dependencias, no experimento realizado.
- El manifiesto inyecta solo CSS en el widget (`manifest.json:39`); los scripts de Player Tools se declaran para `https://soundcloud.com/*` (`manifest.json:58`). No existe ahora un puente de efectos/velocidad hacia `w.soundcloud.com`.
- Teleport ya localiza una tarjeta nativa por permalink y desplaza la página hasta ella (`scripts/soundcloud-likes-locator.js:18`). No pulsa Play y tiene límites de búsqueda de 30 segundos y 40 avances (`scripts/soundcloud-likes-locator.js:29`); no garantiza localizar toda una biblioteca extensa.

## Vía propuesta y límites por comprobar

Mantener Play/Pausa del iframe y ofrecer una acción independiente, por ejemplo **Usar en Player Tools**. Si el track está presente en una tarjeta nativa, comprobar su identidad y activar su Play. Para un track ausente, evaluar navegación SPA a su permalink y reproducción desde su página, conservando selección y filtros del Explorer. Son propuestas basadas en la interfaz existente, pendientes de prueba con SoundCloud real.

El [plan histórico, sección 8](LIKES-EXPLORER-IMPLEMENTATION-PLAN-20260912.md#8-reproducción-y-continuidad) ya describía un adaptador de reproducción nativa; no está implementado. Su decisión antigua de no usar un reproductor paralelo fue reemplazada por la entrega del widget y por la preferencia actual del usuario de conservarlo. Sirve como antecedente técnico, no como instrucción para retirar el iframe.

Confirmar que el permalink de la barra inferior coincide con el solicitado y que el audio nativo comienza a avanzar antes de declarar éxito. Pausar el widget durante el traspaso y conservarlo para reanudarlo si falla. Validar cambios rápidos de selección y no confundir el track anterior con el solicitado.

Si se quiere continuar desde el segundo actual, obtener la posición del widget y aplicarla al audio nativo tras cargar sus metadatos. La lectura del widget está documentada; la continuidad completa requiere implementar el puente y medir su resultado. No se promete un cambio sin interrupción.

La prueba decisiva debe mostrar un cambio de track en la barra nativa y comprobar velocidad, loop y efectos sobre ese mismo audio. Ni la documentación pública ni el test previo del widget constituyen por sí solos esa prueba.

## Prueba exploratoria y resultado

Se usaron las páginas públicas `forss/flickermood` y `forss/soulhack` en un navegador nuevo. El experimento cargó el core de tempo y el bridge de Looper al iniciar el documento, sin interfaz de licencia ni perfil personal. No ejercitó la UI completa de Player Tools.

- **Observado:** crear un enlace al segundo tema y ejecutar `click()` recargó el documento. Ocurrió tanto al añadirlo a `body` como dentro de `.l-main`; un identificador generado al inicio cambió entre documentos. Ese mecanismo concreto perdería el iframe activo. No demuestra que todos los enlaces nativos de SoundCloud recarguen, ni descarta un mecanismo SPA distinto.
- **Observado:** tras cerrar los diálogos de consentimiento e inicio de sesión, un clic real en Play seleccionó Flickermood en la barra inferior (`/forss/flickermood`). La prueba no detectó audio activo avanzando en el core de tempo durante 30 segundos. La captura muestra el player en 0:00 y pausado. No se determinó la causa; no atribuirlo a login, permisos o incompatibilidad de Player Tools sin más evidencia.
- **No verificado:** sustituir un track que ya suena por otro y aplicar velocidad, loop o efectos; preservar el iframe durante el cambio; continuidad de posición; biblioteca autenticada y tracks ausentes del DOM. La comprobación de audio falló antes de esas etapas.

El experimento final quedó como artefacto local, fuera de la suite: `test-results/likes-native-playback-live.cjs`. Puede repetirse con `node test-results/likes-native-playback-live.cjs`. Resultado y captura: `test-results/likes-native-playback/result.json` y `test-results/likes-native-playback/failure.png`. Los artefactos están ignorados por Git; las observaciones anteriores quedan registradas aquí. La ejecución no pasó y no se contabiliza como una validación de transferencia.

Siguiente paso técnico: un adaptador que accione el Play de una tarjeta nativa identificada por permalink; para tracks que no están montados, validar una navegación que conserve el documento o implementar restauración explícita. Probarlo en una sesión donde la reproducción nativa ya funcione. Solo después conectar una acción de Explorer y confirmar el estado real del audio antes de mostrar éxito.

## Implementación posterior del 14/10/2026

El botón **Usar en Player Tools** tiene fondo verde agua y un icono de Play con controles. Está inmediatamente a la derecha del teleport. Play/Pausa conserva la preview por iframe.

`scripts/soundcloud-playback.js` acciona una tarjeta nativa si está montada. Para un tema ausente navega mediante `history.pushState` y `popstate`: SoundCloud cambia su vista dentro del mismo documento. El Explorer conserva selección, búsqueda y el iframe; cambia la ruta de SoundCloud debajo del panel. Se comprueban el título y el enlace del artista de la nueva vista antes de pulsar Play, y el permalink del player más el avance del audio obtenido del bridge de Looper antes de confirmar éxito. Los metadatos canonical/OG no sirven para esta comprobación porque SoundCloud los conserva de la página inicial.

El iframe se pausa, sin desmontarlo ni reiniciar su posición. Volver a reproducir la preview pausa el nativo. El nuevo botón reutiliza la autorización `PLAY_LIKED_TRACK` y sus datos resueltos en la biblioteca. Las solicitudes antiguas se cancelan al pedir otro tema, volver a la preview, cerrar Explorer durante la carga, cambiar de colección o perder identidad/acceso. Un tema que ya suena no se pausa al pulsar otra vez el botón. La transferencia inicia la reproducción nativa; no copia el segundo exacto de la preview.

Si SoundCloud no inicia audio, se muestra un aviso para usar Play en la barra inferior o abrir la página del tema. La operación tiene un plazo de 15 segundos; no muestra éxito por el simple hecho de haber hecho clic. Los textos están en los cinco idiomas existentes. El adaptador está incluido en el manifiesto y en la lista de empaquetado, sin permisos adicionales.

Validación local: `npm.cmd test` (62 verificaciones), `node scripts/likes-explorer.browser-test.js`, `node scripts/likes-playback.browser-test.js` y `node scripts/likes-native-playback.browser-test.cjs` aprobados. La prueba nueva cubre tarjeta montada, navegación SPA, audio detenido, autoplay bloqueado, solicitudes tardías, vista anterior, identidad, persistencia del iframe y tamaños de 390/760/1024 px. Se corrigió una comprobación antigua del manifiesto que asumía que todos los content scripts tenían JavaScript, aunque el widget registra solo CSS.

**Prueba real aprobada:** `node scripts/likes-native-playback-live.cjs` ejecutó el adaptador y el widget en un mundo aislado, como los content scripts, con el core de tempo y el bridge de Looper en MAIN. Cambió la selección nativa de Soulhack a Flickermood sin recargar ni desmontar la preview; confirmó audio avanzando, velocidad real de 1,25× y repetición efectiva de un loop de 1 a 3 segundos. No necesitó el fallback de Play manual en esa ejecución. Evidencia local: `test-results/likes-native-live/result.json` y `handoff.png`. Usa páginas públicas en un navegador nuevo; no valida una biblioteca autenticada ni cada efecto de Player Tools.
