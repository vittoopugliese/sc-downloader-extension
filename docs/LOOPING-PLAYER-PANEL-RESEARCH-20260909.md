# Investigación: looping desde el panel del player

Fecha: 2026-09-09

Fuentes primarias revisadas:

- código y verificadores del repositorio actual;
- `docs/TEMPO-INTEGRATION-AUDIT.md` y `docs/COLD-AUDIT-HANDOFF-9dc9f1b.md`;
- snapshot local `repos/soundcloud-looper-extension-main`.

Este documento es una investigación y propuesta de arquitectura. No implementa la
feature ni aprueba el estado actual para release.

## Conclusión ejecutiva

La nueva pestaña **Looping** es viable y puede mantener la velocidad y el modo
Keep Tone sin crear otro reproductor ni otro pipeline de audio. Un loop sobre el
media activo sólo lee y modifica `currentTime`; la velocidad actual sigue estando
gobernada por `playbackRate`/`defaultPlaybackRate` y el modo de tono por
`preservesPitch` ([`scripts/tempo-control-core.js:86-99`](../scripts/tempo-control-core.js),
[`scripts/looper.js:1813-1825`](../scripts/looper.js)).

La decisión importante no es tabs versus una sola vista. Primero hay que convertir
el loop actual en una sesión compartida. Hoy la implementación de waveform es a la
vez adapter visual, controlador de estado, detector del player, motor de repetición
y entry point de descarga. Su interface pública sólo permite `ensureMounted`,
`reset` y `getState`, así que el panel no puede activar el loop, capturar A/B ni
editar el rango sin duplicar lógica
([`scripts/looper.js:2102-2109`](../scripts/looper.js)).

La recomendación es:

1. extraer un módulo profundo `SCLoopSession` que sea la única fuente de verdad de
 `{ active, startMs, endMs, durationMs, trackIdentity }`;
2. conservar `SCLooperCore` para normalización y matemáticas del rango;
3. hacer que waveform y panel sean dos adapters de la misma interface;
4. ampliar el bridge MAIN existente para controlar el media activo, en vez de
 copiar el interceptor y temporizador del repo externo;
5. desacoplar la vida del loop de `location.href`: el loop debe pertenecer al track
 que realmente está sonando.

Esto permite decidir el layout después. Tabs y vista combinada pasan a ser dos
presentaciones intercambiables sobre el mismo módulo.

## Aclaración de interfaz

El control mostrado en la captura no es el popup de `chrome.action`. Es un panel
Shadow DOM inyectado en el player persistente de SoundCloud desde MAIN world. Se
monta después de `#scdl-player-download` y se posiciona como diálogo flotante
([`scripts/tempo-control-main.js:438-466`](../scripts/tempo-control-main.js),
[`scripts/tempo-control-main.js:547-568`](../scripts/tempo-control-main.js)).

El `popup.html` real ya tiene tabs de ayuda —incluida una guía de Looper— pero es
otra superficie y otro proceso de UI
([`popup.html:954-996`](../popup.html),
[`scripts/popup.js:111-152`](../scripts/popup.js)). En este documento, “panel”
significa el diálogo de la captura y “popup” significa la ventana real de la
extensión.

## Cómo funciona hoy el repositorio actual

### Tempo y Keep Tone

`tempo-control-core.js` es un módulo razonablemente profundo. Descubre audios,
recuerda referencias débiles, aplica rate/pitch a todos, protege las propiedades
contra escrituras posteriores del host y reaplica el estado al ejecutar `play()`
([`scripts/tempo-control-core.js:34-70`](../scripts/tempo-control-core.js),
[`scripts/tempo-control-core.js:93-134`](../scripts/tempo-control-core.js),
[`scripts/tempo-control-core.js:154-195`](../scripts/tempo-control-core.js)).

El adapter `tempo-control-main.js` mezcla cuatro responsabilidades:

- persistencia global en `localStorage`;
- template/CSS y eventos del panel;
- montaje dentro del player de SoundCloud;
- lifecycle de descubrimiento de audio y DOM.

Las preferencias se leen y escriben como `scdl.tempo.rate` y
`scdl.tempo.preservePitch` ([`scripts/tempo-control-main.js:9-19`](../scripts/tempo-control-main.js),
[`scripts/tempo-control-main.js:48-87`](../scripts/tempo-control-main.js)). La UI
actual ofrece `0.1x..4x`, step `0.0125`, presets, bypass y Keep Tone
([`scripts/tempo-control-core.js:9-15`](../scripts/tempo-control-core.js),
[`scripts/tempo-control-main.js:398-433`](../scripts/tempo-control-main.js)).

El estado efectivo se publica además en atributos del host Shadow DOM. El looper
lee esos atributos al iniciar una descarga y envía el snapshot
`{ rate, preservePitch }` al background
([`scripts/tempo-control-main.js:523-545`](../scripts/tempo-control-main.js),
[`scripts/looper.js:1478-1501`](../scripts/looper.js),
[`scripts/looper.js:1524-1556`](../scripts/looper.js)). Por eso el WAV A–B ya puede
usar la transformación elegida; el track completo todavía no recibe ese objeto
([`scripts/background.js:193-217`](../scripts/background.js),
[`docs/COLD-AUDIT-HANDOFF-9dc9f1b.md`](COLD-AUDIT-HANDOFF-9dc9f1b.md)).

### Looper A–B sobre waveform

`SCLooperCore` ya contiene la mayor parte de la lógica pura que una segunda UI
necesita:

- rango mínimo de 250 ms y rango inicial de 10 s;
- normalización/clamp de A y B;
- movimiento de cada marker y del rango entero;
- conversión posición ↔ tiempo;
- zoom;
- decisión de seek al salir del rango.

Fuente: [`scripts/looper-core.js:1-63`](../scripts/looper-core.js),
[`scripts/looper-core.js:65-110`](../scripts/looper-core.js),
[`scripts/looper-core.js:127-150`](../scripts/looper-core.js),
[`scripts/looper-core.js:207-229`](../scripts/looper-core.js).

`looper.js`, en cambio, concentra demasiadas capas en unas 2.100 líneas:

- encuentra waveform, menú y root del track;
- descubre el media y resuelve fallbacks cross-frame;
- mantiene `range`, player e identidad;
- dibuja markers, selección y zoom;
- fuerza el seek del loop;
- resuelve metadata y dispara la descarga;
- monta/desmonta todo durante navegación SPA.

El adapter de media actual es mejor que el repo de referencia: puntúa candidatos
por duración, reproducción, source y ready state; consulta documentos accesibles;
y cae al bridge MAIN para audios detached
([`scripts/looper.js:262-332`](../scripts/looper.js),
[`scripts/looper.js:351-400`](../scripts/looper.js),
[`scripts/looper.js:402-530`](../scripts/looper.js)).

El bridge MAIN se inyecta en todos los frames desde `document_start`, intercepta
`new Audio()`, `play()` y `load()`, recuerda el último media en reproducción y
acepta comandos `state` y `seek`
([`manifest.json:42-49`](../manifest.json),
[`scripts/looper-main-bridge.js:1-47`](../scripts/looper-main-bridge.js),
[`scripts/looper-main-bridge.js:57-94`](../scripts/looper-main-bridge.js),
[`scripts/looper-main-bridge.js:100-146`](../scripts/looper-main-bridge.js)).

La repetición se hace actualmente desde el content script con
`requestAnimationFrame`: cuando el tiempo queda fuera de A–B, busca volver a A y
reintenta si SoundCloud ignora el seek
([`scripts/looper.js:1813-1825`](../scripts/looper.js),
[`scripts/looper.js:1839-1899`](../scripts/looper.js)).

### Por qué hoy no puede funcionar fuera de la waveform

La activación comienza con `discoverTarget()`. Si no existe una página individual
compatible con waveform y botón More actions, retorna `false`. Sólo después crea
el adapter de media y el rango inicial
([`scripts/looper.js:1901-1937`](../scripts/looper.js)). Además, el loop se resetea
si cambia la URL de la página, aunque el player persistente siga reproduciendo la
misma canción ([`scripts/looper.js:1871-1885`](../scripts/looper.js),
[`scripts/looper.js:2010-2029`](../scripts/looper.js)).

Para el caso nuevo esto debe invertirse:

```text
media/track activo -> sesión de loop -> adapters visuales opcionales
```

La waveform debe ser una visualización/editora opcional, no una precondición para
crear la sesión.

## Qué hace el repo `soundcloud-looper-extension-main`

### Lo valioso

El repo confirma el comportamiento buscado sin depender de una waveform:

- `inject.js` corre en MAIN a `document_start` y `content.js` en isolated world
([`repos/soundcloud-looper-extension-main/manifest.json:20-32`](../repos/soundcloud-looper-extension-main/manifest.json));
- intercepta `HTMLMediaElement.prototype.play` para capturar incluso el audio
detached ([`repos/soundcloud-looper-extension-main/inject.js:18-30`](../repos/soundcloud-looper-extension-main/inject.js));
- cada 100 ms lee `currentTime` y, al alcanzar `end - 0.05`, asigna
`currentTime = start`
([`repos/soundcloud-looper-extension-main/inject.js:32-48`](../repos/soundcloud-looper-extension-main/inject.js));
- la UI captura A o B usando la posición que recibe del bridge y permite edición
textual ([`repos/soundcloud-looper-extension-main/content.js:42-75`](../repos/soundcloud-looper-extension-main/content.js),
[`repos/soundcloud-looper-extension-main/content.js:244-283`](../repos/soundcloud-looper-extension-main/content.js));
- opcionalmente guarda un loop por pathname en `chrome.storage.sync`
([`repos/soundcloud-looper-extension-main/content.js:16-24`](../repos/soundcloud-looper-extension-main/content.js),
[`repos/soundcloud-looper-extension-main/content.js:77-114`](../repos/soundcloud-looper-extension-main/content.js)).

La idea reutilizable es “capturar A/B en la posición viva del player y repetir
sobre el media real”. No hace falta portar su panel flotante para obtenerla.

### Lo que no conviene copiar

El repo externo:

- elige simplemente el último `HTMLMediaElement` que hizo `play()`, sin comparar
duración, source, estado ni identidad;
- identifica el track por `location.pathname`, no por la canción del player;
- no valida `start < end`, duración, valores finitos ni rango mínimo;
- usa `postMessage("*")` con un namespace público y sin request IDs;
- tiene polling fijo de 100 ms;
- silencia errores de storage;
- no contiene tests ni un archivo `LICENSE` en el snapshot local.

Fuentes: [`repos/soundcloud-looper-extension-main/inject.js:14-62`](../repos/soundcloud-looper-extension-main/inject.js),
[`repos/soundcloud-looper-extension-main/content.js:16-49`](../repos/soundcloud-looper-extension-main/content.js),
[`repos/soundcloud-looper-extension-main/content.js:77-114`](../repos/soundcloud-looper-extension-main/content.js),
[`repos/soundcloud-looper-extension-main/content.js:175-188`](../repos/soundcloud-looper-extension-main/content.js).

No debería copiarse código literal sin aclarar su licencia. Sí puede usarse el
comportamiento observado como referencia para una implementación propia.

## Arquitectura recomendada

```text
                   ┌──────────────────────────────┐
                   │ MAIN: active media runtime   │
                   │ capture · state · seek       │
                   │ rate/tone · loop enforcement │
                   └──────────────┬───────────────┘
                                  │ bridge versionado
                   ┌──────────────▼───────────────┐
                   │ SCLoopSession                │
                   │ estado A/B + identidad       │
                   │ validación + lifecycle       │
                   └───────┬──────────────┬───────┘
                           │              │
                 ┌─────────▼──────┐ ┌────▼────────────┐
                 │ waveform       │ │ panel del player │
                 │ adapter        │ │ adapter/tab      │
                 └─────────┬──────┘ └────┬────────────┘
                           │              │
                           └──────┬───────┘
                                  ▼
                         download A–B actual
                         + PlaybackTransform
```

### 1. `SCLoopSession`: el módulo profundo nuevo

Interface conceptual pequeña:

```js
session.command({ type: "capture-start" | "capture-end" | "set-range" |
                         "set-enabled" | "clear", ... })
session.snapshot()
session.subscribe(listener)
session.destroy()
```

La implementación oculta:

- resolución del media y track activos;
- creación y normalización del rango mediante `SCLooperCore`;
- activación aun sin waveform;
- invalidación sólo cuando cambia el track reproducido;
- sincronización con el bridge MAIN;
- retry/error state y estado de disponibilidad.

La interface no debería exponer `player`, timers, nodos DOM ni detalles del bridge.
Aplicando el deletion test: si se borra `SCLoopSession`, la coordinación reaparece
en el panel y en la waveform; por eso el módulo tiene profundidad real.

### 2. Un solo estado; dos adapters

El adapter waveform conserva markers, drag, zoom, teclado y botón Download loop,
pero deja de poseer `range`. Se suscribe a la sesión y traduce gestos a comandos.

El adapter del panel ofrece, como mínimo:

- Set A en la posición actual;
- Set B en la posición actual;
- edición precisa de A y B;
- activar/desactivar;
- clear/reset;
- un indicador `A → B`, duración y disponibilidad.

Si se agrega un control gráfico, debe dibujar el mismo snapshot. No debe introducir
un segundo rango local que luego “sincronice” con la waveform.

### 3. Expandir, no duplicar, el bridge MAIN

El bridge actual ya resuelve la parte difícil: audios detached y cross-frame. Puede
crecer a un protocolo versionado con comandos como:

```text
state
seek(timeMs)
setLoop({ startMs, endMs, enabled, trackIdentity })
clearLoop()
```

Mover el enforcement cerca del media evita consultar y cruzar el seam en cada
frame. La sesión sigue siendo dueña del estado semántico; MAIN sólo aplica el
rango validado al media correcto.

Tempo y loop no necesitan pelear por el audio si el ownership se define por
propiedad:

- tempo controla rate y preservesPitch;
- loop controla currentTime dentro de A–B;
- SoundCloud conserva play/pause y volumen;
- downloader sólo consume snapshots y renderiza offline.

A largo plazo conviene que tempo y loop compartan un único registro de media para
dejar de encadenar dos wrappers sobre `HTMLMediaElement.prototype.play`. No es
obligatorio hacer esa migración en el primer cambio: hoy la convivencia está
cubierta por el verificador de browser
([`scripts/verify-tempo-browser.js:181-202`](../scripts/verify-tempo-browser.js)).

### 4. Identidad y navegación

“Track actual” debe significar la canción del player persistente, no la URL visible.
El repo actual ya intenta obtener el permalink desde
`.playControls__soundBadge .playbackSoundBadge__titleLink` antes de caer a la página
o al source del media ([`scripts/looper.js:334-349`](../scripts/looper.js),
[`scripts/looper.js:507-514`](../scripts/looper.js)). Esa política debe extraerse y
volverse canónica.

Reglas propuestas:

- navegar por feed/perfil no destruye el loop si sigue sonando el mismo track;
- cambiar el track reproducido limpia/desactiva el rango transitorio;
- si la nueva página muestra la waveform del track activo, se monta el adapter y
refleja la sesión existente;
- si muestra otra waveform, no debe adjudicarle el rango del player;
- descarga y persistencia usan track ID/permalink del player, con pathname sólo
como fallback.

### 5. Persistencia separada

No hace falta persistencia para entregar la primera versión: hoy el loop es
deliberadamente temporal y se elimina con Escape/cambio de track
([`popup.html:985-996`](../popup.html)). Si se desea persistir después, debe ser un
módulo separado con esquema versionado y validación, no `loop:<pathname>` copiado
del repo externo.

## Tabs versus vista única

Ambas son técnicamente posibles después de extraer la sesión.

### Dos tabs: recomendación para la primera versión

Ventajas:

- conserva el panel compacto de la captura;
- separa dos tareas mentales: transformar playback y seleccionar A–B;
- deja espacio para inputs A/B, capture buttons y estado sin comprimir el slider;
- permite que el header/logo y los errores globales sean comunes.

Costes:

- el estado de tempo debe seguir visible en forma resumida dentro de Looping para
que el usuario entienda cómo escucha y cómo exportará;
- hay que implementar semántica real de tabs, foco con flechas y
`aria-controls`/`aria-selected`.

Orden sugerido dentro del panel:

```text
[ Speed & Tone ] [ Looping ]
--------------------------------
logo/nombre                estado
contenido de la tab activa
```

`Tone & Velocity` suena menos natural en inglés para esta función. Las etiquetas
más claras serían `Speed & Tone` / `Loop`, o `Playback` / `Looping`.

### Todo en una vista

Es mejor sólo si la primera versión del loop tiene muy pocos controles: Set A,
Set B y on/off. En cuanto se suman inputs precisos, slider doble, clear, duración o
download, la vista única aumenta la altura y reduce la legibilidad. No proporciona
una ventaja arquitectónica: seguirá usando la misma sesión.

## Entrega incremental propuesta

### Fase 1 — contrato y tests, sin cambiar la UI

- extraer `SCLoopSession` y la identidad del track activo;
- adaptar el looper de waveform a ese módulo sin alterar su UX;
- eliminar tests que inspeccionan/reemplazan texto interno de `looper.js` y probar
por la interface nueva;
- mantener el comportamiento A–B y descarga existente.

### Fase 2 — loop sin waveform

- permitir crear una sesión desde el media activo;
- ampliar el bridge con set/clear loop;
- verificar feed, búsqueda, playlist, perfil, navegación SPA, ads/previews y
reemplazo del audio;
- asegurar que cerrar el panel no detenga el motor.

### Fase 3 — tab Looping

- añadir el adapter visual al Shadow DOM existente;
- sincronizar en ambas direcciones con markers de waveform;
- añadir teclado, foco, estados unavailable/waiting y strings i18n;
- decidir si la tab contiene Download loop.

### Fase 4 — persistencia opcional

- un loop por track si ésa sigue siendo la decisión de producto;
- esquema versionado, track ID + permalink fallback;
- validación, errores visibles y migración explícita.

## Verificación realizada

En el workspace actual pasaron:

- `node scripts/verify-looper.js`;
- `node scripts/verify-looper-playback.js`;
- `node scripts/verify-looper-main-bridge.js`;
- `node scripts/verify-looper-mount.js`;
- `node scripts/verify-tempo-browser.js`.

`node scripts/verify-tempo-control.js` falla porque falta
`THIRD_PARTY_LICENSES.md`. Es un bloqueante previo ya documentado, no un fallo
causado por esta investigación
([`scripts/verify-tempo-control.js:23-36`](../scripts/verify-tempo-control.js),
[`docs/COLD-AUDIT-HANDOFF-9dc9f1b.md`](COLD-AUDIT-HANDOFF-9dc9f1b.md)).

El árbol ya tenía una modificación local no relacionada en
`scripts/tempo-control-main.js` (margen inferior de `.slider-wrap` de 10 px a
8 px). Se preservó y no se editó.

## Preguntas que cambian el diseño

### Comportamiento

1. ¿“Track actual” es siempre el audio del player persistente, aunque estés mirando
 otra página o waveform? Esta investigación recomienda que sí.  
SI, el audio del player existente, aunque este en otra waveform. Si estoy con un loop en una waveform y se esta reproduciendo ahi, tratemos de que el looper del popup replique esos cambios en tiempo real, sino, de igual manera tratemos de que los dos loops puedan convivir. SIEMPRE priorizamos el de la waveform, que puedo deslizar y hacer zoom en la waveform. Segundo el del popup. Tene en cuenta que el looper de popup va a loopear solo con un slider y no sera tan preciso. podrias agregarle los botones de set start y set end como los que tiene el repo que revisaste, de igual manera tambien te adjunte una imagen de referencia. 
2. ¿El loop debe continuar al cerrar el panel? La arquitectura propuesta asume que
 sí.  
SI - ademas, necesitamos agregar un bypass de loop y el actual del pitch. creo que estaria bueno que esten separados.
3. ¿Al navegar por SoundCloud debe continuar si el mismo track sigue sonando? La  
 recomendación es sí; sólo se limpia al cambiar el track reproducido.  
 SI.
4. ¿Al activar Loop debe hacer seek inmediato a A y respetar play/pause, o además
 debe iniciar reproducción? La referencia hace seek pero no llama `play()`.  
SI a todo. 
5. ¿Scrub manual antes de A debe ser permitido hasta llegar a B, o debe volver a A
 inmediatamente? El repo externo sólo fuerza B; el looper actual fuerza ambos
 bordes.  
Como vos quieras, acepto la recomendacion

### Edición y UI

6. ¿La primera versión necesita Set A/Set B en vivo, inputs editables, un slider
 doble, o los tres? Recomendación inicial: Set A/Set B + inputs; el mini-slider
 puede llegar después.  
SI , acepto la recomendacion. el slider viene luego
7. ¿La waveform y el panel deben editar exactamente el mismo rango en tiempo real?
 La propuesta asume que sí.  
SI, ya tenemos el audio conectado, creo que tomar el valor en los dos lados es posible para que se repliquen bidireccionalmente
8. ¿Querés tabs arriba del bloque completo de logo/header, o logo común arriba y
 tabs debajo? La recomendación visual es tabs arriba, header común debajo.  
Creo que al final NO quiero tabs. Revisa la imagen, la cual tiene el slider, pero creo que podrias primero hacer los botones. pero quiero que reordenes todo para NO tener tabs y para que se vea exactamente como la imagen. fijate que ahora tengo dos botones (corazon) par que el user setee dos velocidades favoritas. hagamos que con LONG PRESS en el boton, guardo la velocidad actual,  y con un click simplemente se pone. y fijate el header que ahora es primero los 4 botones (hacelos 2px menos de padding vertical y 3px menos de padding horizontal asi entran un poco mejor)
9. ¿Preferís `Speed & Tone` / `Looping`, `Playback` / `Looping`, o conservar
 literalmente `Tone & Velocity`?  
no hagamos tabs mejor. que todo se maneje del mismo panel unico. total el looper son dos inputs botones que pongan el start y end, el slider marcando a y b y el boton bypass loop
10. ¿La tab Looping debe incluir `Download loop`, o la descarga sigue disponible  
  sólo junto a la waveform? que la descarga siempre sea desde el player. que el popup solo edite values

### Estado y persistencia

11. ¿El rango es sólo temporal como hoy, o querés recordar automáticamente un loop
  por track? Si se guarda, ¿global/local o sincronizado entre navegadores?  
que NO se guarde, que sea rango temporal como hoy
12. ¿Al volver al track debe reactivarse automáticamente o sólo restaurar A/B
  apagado?  
no restauremos por ahora, menos complejidad por ahora
13. ¿Debe existir siempre un solo loop por track? Los documentos anteriores dicen
  que sí, pero conviene reconfirmarlo para fijar el esquema.  
SI solo uno por current track.

### Descarga y producto

14. ¿La tab debe mostrar explícitamente que el WAV usará el rate/Keep Tone efectivo,
  incluido bypass?  
por ahora no, siempre descargamos audio modificado
15. ¿El loop y su export siguen siendo gratuitos, premium o parte de una prueba? por ahora TODAS LAs features son gratis
16. El gap previo de descarga completa con tempo/pitch sigue abierto: ¿se resuelve
  en este mismo trabajo o se mantiene como entrega separada?  
CREO que ya esta terminado. revisalo igual

## Recomendación de alcance inmediato

Para minimizar riesgo y maximizar reutilización, la siguiente implementación debería
cerrarse así:

- un loop transitorio por track activo;
- Set A, Set B, inputs precisos, on/off y clear;
- tabs `Speed & Tone` y `Looping` en el panel del player;
- el loop continúa con el panel cerrado y al navegar si no cambia la canción;
- waveform y panel comparten el mismo estado;
- download del A–B usa el `PlaybackTransform` efectivo actual;
- sin copiar código, storage ni panel draggable del repo externo;
- persistencia e import/export quedan fuera hasta decidir su semántica.

Ese alcance aprovecha la lógica más fuerte del repositorio actual y adopta del repo
externo sólo la idea de producto que falta: marcar A/B directamente desde la
posición del audio que está sonando.