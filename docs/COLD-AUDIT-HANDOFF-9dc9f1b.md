# Handoff para auditoria en frio del commit `9dc9f1b`

Fecha del relevamiento: 2026-09-09  
Commit auditado: `9dc9f1b1d07ec773207cff72dd362e60e035cbc5`  
Parent: `03cfba012159a6549acd80943578335b23d0ed4c`  
Titulo del commit: `Tempo and pitch selector and download with loop on wav integration`

## Proposito y regla de lectura

Este documento no aprueba la implementacion ni reemplaza una auditoria independiente. Es el paquete de contexto para poder revisar, luego y sin memoria de esta sesion, toda la feature introducida por `9dc9f1b`.

Las afirmaciones se clasifican asi:

- **Hecho comprobado:** surge del arbol Git, del codigo o de una ejecucion registrada abajo.
- **Evidencia historica:** se observo durante la implementacion, pero no queda completamente reproducible desde un clon limpio del commit.
- **Riesgo o hipotesis:** requiere prueba, medicion o decision explicita antes de aceptarse.
- **Bloqueante:** impide considerar al commit autocontenido o apto para release aunque la UI funcione localmente.

No usar `docs/TEMPO-INTEGRATION-AUDIT.md` como aprobacion independiente: fue escrito junto con la implementacion y contiene afirmaciones que este relevamiento corrige.

## Resultado corto

El commit agrega dos capacidades conectadas:

1. Un control global de velocidad en el player de SoundCloud, de `0.5x` a `2x` con pasos de `0.05`, y un toggle binario `Preserve Pitch`.
2. Exportacion WAV del loop A-B aplicando una foto de esa velocidad: pitch natural mediante resampling o pitch preservado mediante Signalsmith Stretch WASM.

La separacion principal es razonable: el control live no instala el grafo WASM y el renderer offline queda detras de `SCLoopAudioRenderer.render(...)`. Sin embargo, el commit no debe liberarse tal como esta:

- **Bloqueante:** los tres archivos nuevos declaran depender de `THIRD_PARTY_LICENSES.md`, pero ese archivo no existe ni esta versionado.
- **Bloqueante:** el empaquetador no incluye `THIRD_PARTY_LICENSES.md`; `verify-tempo-control.js` falla expresamente por esto.
- **Bloqueante de reproducibilidad:** `verify-pitched-loop-renderer.js` compara el vendor contra `repos/soundcloud-tempo-control-main/...`, pero `repos/` esta ignorado y no forma parte del commit. El test solo pasa en un workspace que conserve ese repo local.
- **Gate pendiente:** no existe una matriz suficiente de calidad, memoria, cancelacion y fuentes SoundCloud reales para el nuevo render offline.
- **Decision pendiente:** “pitch” significa aqui preservar o no el pitch al variar tempo; no existe un control independiente de tono/semitonos.
- **Gap funcional confirmado por el usuario:** la descarga normal iniciada desde el boton del player no respeta el tempo/pitch seleccionado. El codigo confirma que `playbackTransform` solo entra por `DOWNLOAD_LOOP`.

## Alcance exacto del commit

El diff contra el parent contiene 27 archivos, 1.924 inserciones y 24 eliminaciones.

### Modulos nuevos de runtime

| Archivo | Responsabilidad observable | Tamano aproximado actual |
| --- | --- | ---: |
| `scripts/tempo-control-core.js` | Descubrir audios, aplicar rate/preserve nativos y bloquear escrituras del host | 192 lineas de diff; 172 lineas no vacias medidas |
| `scripts/tempo-control-main.js` | Storage, UI Shadow DOM, montaje junto al download y eventos de pagina | 419 lineas de diff; 377 lineas no vacias medidas |
| `scripts/loop-audio-renderer.js` | Normalizar rango/transformacion y renderizar PCM offline | 358 lineas de diff; 331 lineas no vacias medidas |
| `scripts/vendor/signalsmith/wasm-factory.mjs` | Factory Emscripten/WASM pinneada de Signalsmith Stretch | Archivo generado/minificado, 15 lineas fisicas |

### Integraciones modificadas

| Frontera | Cambio |
| --- | --- |
| `manifest.json` | Registra core + adapter en MAIN a `document_start`; agrega CSP `wasm-unsafe-eval` |
| `offscreen.html` | Carga `loop-audio-renderer.js` antes de `download-core.js` |
| `scripts/looper.js` | Lee una foto `{rate, preservePitch}` al pulsar Download loop |
| `scripts/background.js` | Reenvia `playbackTransform` en `DOWNLOAD_LOOP` |
| `scripts/bulk-job-manager.js` | Lo pasa a la ejecucion y al mensaje offscreen |
| `scripts/track-download-execution.js` | Lo pasa a `buildTrack` |
| `scripts/offscreen.js` | Lo pasa a `SCDownload.buildTrackBlob` |
| `scripts/download-core.js` | Invoca renderer, siempre codifica el loop como WAV y etiqueta el filename |
| `scripts/package-extension.ps1` | Incluye los tres scripts runtime/WASM, pero omite la licencia requerida |
| `.gitignore` | Ignora `repos`, incluyendo las fuentes de referencia usadas por un test |

### Documentacion y verificadores agregados o modificados

- Nuevos: `docs/FEATURE-MAP-SOUNDCLOUD-EXTENSIONS.md`, `docs/TEMPO-INTEGRATION-AUDIT.md`, `scripts/verify-tempo-control.js`, `scripts/verify-tempo-browser.js` y `scripts/verify-pitched-loop-renderer.js`.
- Modificados: README, TESTING, runner general y verificadores de routing, descarga, browser E2E y ejecucion.
- El E2E previo del loop a `1x` fue transformado en el caso `0.5x + preserve pitch`; no se agrego un segundo caso. Por eso la regresion browser del camino base a `1x` ya no tiene la misma cobertura end-to-end.

### Cambios visibles en el workspace pero fuera del commit

Al cierre de este relevamiento hay trabajo posterior/concurrente que no pertenece a `9dc9f1b`:

- `scripts/tempo-control-main.js` esta modificado: cambia el trigger de texto por un velocimetro SVG inline mas el rate. No fue editado como parte de este relevamiento documental.
- `assets/icons/speed-meter.svg` figura sin versionar. El runtime modificado no lo importa como archivo: replica sus paths dentro de un string SVG porque el comentario indica que MAIN no dispone de `chrome.runtime.getURL()`.

Una auditoria del commit debe usar `git show 9dc9f1b:scripts/tempo-control-main.js`, no el archivo de trabajo actual. Una auditoria del producto candidato a release debe revisar ambos cambios por separado y decidir si el asset suelto se versiona, se elimina o se convierte en la fuente documentada del SVG inline. No agregarlo accidentalmente al commit de documentacion.

## Intencion de producto reconstruida

Requisitos que la implementacion intenta cumplir:

- control compacto junto al boton de descarga persistente del player;
- rango fijo `0.5x`-`2x` y step `0.05`;
- sin UI para editar minimo, maximo o step;
- aplicacion automatica al audio actual y a audios descubiertos despues;
- opcion para preservar pitch;
- preferencias recordadas localmente;
- el loop A-B actual debe descargarse con la velocidad elegida;
- la feature debe permanecer separada del resto por modulos y sin instalar un segundo reproductor live.

Capacidades no implementadas. Esta lista describe el codigo, no implica que todas hayan sido descartadas como requisitos:

- pitch independiente por semitonos o cents;
- hotkeys;
- perfiles por track, timeline, ramps, biblioteca o links compartibles;
- panel flotante/draggable del repo de looper;
- persistencia de loops del repo externo;
- export transformado de tracks completos desde el boton normal. El usuario reporto expresamente que espera que esa descarga respete pitch; tratarlo como gap abierto, no como exclusion aceptada;
- configuracion de min/max/step;
- motor Signalsmith para la escucha live;
- equivalencia sample-accurate entre lo que se escucha y el WAV.

## Semantica que no debe confundirse

La UI usa la palabra `Preserve Pitch`, pero no ofrece “cambiar pitch” en forma independiente.

| Rate | Preserve Pitch | Live | Export del loop |
| ---: | --- | --- | --- |
| `1x` | off/on | Audio normal | Copia PCM del rango; el toggle no cambia el resultado |
| distinto de `1x` | off | `HTMLMediaElement.playbackRate`; el tono cambia naturalmente | `OfflineAudioContext` o fallback de interpolacion lineal |
| distinto de `1x` | on | `preservesPitch` nativo de Chromium | Signalsmith Stretch WASM |

Consecuencia: live y export comparten intencion (`rate`, modo de pitch), pero usan motores distintos. “El WAV suena exactamente como el player” es una hipotesis no demostrada y no debe publicitarse.

## Arquitectura y flujo de datos

```text
SoundCloud / MAIN world
  tempo-control-main
      -> tempo-control-core
      -> HTMLAudioElement playbackRate/defaultPlaybackRate/preservesPitch
      -> localStorage + atributos DOM de snapshot

Usuario pulsa Download loop
  looper.js (isolated world)
      -> lee atributos DOM; localStorage es fallback
      -> snapshot { rate, preservePitch }
      -> runtime message DOWNLOAD_LOOP
  background.js
      -> BulkJobManager.downloadLoop
  track-download-execution.js
      -> OFFSCREEN_BUILD
  offscreen.js
      -> SCDownload.buildTrackBlob
  download-core.js
      -> decodifica el archivo/stream completo
      -> SCLoopAudioRenderer.render
      -> WAV PCM 16-bit
  download-destination
      -> guarda el archivo
```

### Interface principal y profundidad

`SCLoopAudioRenderer.render(audioBuffer, trimRange, playbackTransform, hooks)` es un modulo profundo util: concentra extraccion, duracion de salida, seleccion del motor, limite PCM, progreso y cancelacion cooperativa. Si se elimina, esa complejidad reaparece en descarga y tests; pasa el deletion test del plan arquitectonico.

`tempo-control-core.js` tambien encapsula una politica no trivial detras de una interface pequena (`create`, `install`, `setRate`, `setPreservePitch`, `snapshot`).

La integracion completa, sin embargo, agrega plumbing de `playbackTransform` por seis capas. El objeto no tiene hoy un tipo/modulo canonico y sus constantes/reglas se duplican en core, adapter, looper y renderer. La auditoria debe decidir si:

- la duplicacion es una validacion deliberada en fronteras no confiables; o
- corresponde crear un value object/normalizador compartido para el download intent, conservando validacion final en offscreen.

No agregar automaticamente otra capa superficial. El criterio es reducir conocimiento repetido en callers, no solo mover lineas.

## Contrato de estado y persistencia

Estado conceptual:

```text
PlaybackTransform = {
  rate: numero finito normalizado a 0.5..2 con dos decimales,
  preservePitch: boolean
}
```

Persistencia MAIN/world:

- `localStorage['scdl.tempo.rate']`
- `localStorage['scdl.tempo.preservePitch']`

Bridge DOM al looper aislado:

- host `#scdl-tempo-control`
- `data-scdl-tempo-rate`
- `data-scdl-tempo-preserve-pitch`

Reglas y efectos laterales:

- defaults: `1x` y preserve desactivado;
- preferencias globales para `soundcloud.com`, no por track;
- el evento `storage` propaga cambios entre tabs del mismo origen;
- el looper toma el snapshot al hacer click, no al terminar la descarga;
- si storage esta bloqueado, la UI sigue con defaults/estado en memoria y expone error; el looper prefiere los atributos DOM;
- la pagina host puede leer/modificar esos atributos y su propio localStorage; el renderer vuelve a limitar el rate, pero este no es un canal autenticado;
- el renderer acepta cualquier rate dentro del rango, no exige multiplo exacto de `0.05`;
- el valor `preservePitch` se reduce a boolean en renderer; en el bridge solo la cadena exacta `"true"` activa el modo.

Decision pendiente: confirmar que la preferencia deba ser global y sincronizarse entre tabs. El repo fuente avanzado manejaba perfiles por track, pero eso fue excluido del alcance actual.

## Control live: comportamiento tecnico

Hechos comprobados:

- se ejecuta solo en el frame superior de `https://soundcloud.com/*`;
- captura descriptors nativos de `playbackRate`, `defaultPlaybackRate` y variantes de `preservesPitch` antes de parchearlos;
- descubre `HTMLAudioElement` existentes, agregados por MutationObserver y recibidos por eventos;
- conserva WeakRefs y limpia referencias muertas durante `updateAll`;
- parchea setters configurables y `HTMLMediaElement.prototype.play` para reaplicar el estado si SoundCloud intenta sobrescribirlo;
- no afecta intencionalmente elementos de video;
- no ofrece `dispose()` ni restaura los descriptors/prototype originales durante la vida de la pagina;
- monta Shadow DOM abierto junto a `#scdl-player-download`, con fallback junto al sound badge o al final del player;
- doble click del slider restaura `1x`; Escape y click exterior cierran el panel;
- el toggle se deshabilita si el browser no expone un setter de preservacion compatible.

Riesgos que necesitan prueba:

- orden de parches entre tempo y `looper-main-bridge.js`, especialmente porque ambos tocan APIs del media element;
- reemplazo del elemento de audio en navegacion SPA y en estados de ads/previews;
- cambios futuros de DOM/clases del player;
- audio en frames o contextos distintos al top frame;
- listeners acumulados y costo del MutationObserver en sesiones largas;
- restricciones/rangos propios del browser para `playbackRate` y diferencias de `preservesPitch` entre versiones;
- convivencia con otras extensiones que parcheen los mismos descriptors;
- accesibilidad completa y comportamiento con zoom, viewport angosto y locales largos.

## Renderer offline: comportamiento tecnico

### Entrada y rango

- exige un AudioBuffer-like con sample rate entero `1..192000`, longitud positiva, canales positivos y `getChannelData`;
- valida `startMs >= 0` y `endMs > startMs`;
- convierte inicio con `floor` y final con `ceil`;
- limita el final a la longitud decodificada;
- usa como maximo dos canales; canales adicionales se descartan;
- el pipeline existente descarga/combina y decodifica la fuente completa antes de cortar el rango.

### Camino `1x`

- copia el segmento PCM sin Signalsmith, incluso si preserve esta activado;
- no hace crossfade en las fronteras A/B;
- no garantiza un loop sin click si el corte no coincide con un zero crossing.

### Camino natural

- calcula `ceil(frameCount / rate)`;
- si existe `OfflineAudioContext`, crea un buffer del segmento y aplica `AudioBufferSourceNode.playbackRate`;
- si no existe, usa interpolacion lineal propia;
- el fallback lineal no tiene un filtro antialias dedicado y no debe asumirse equivalente al renderer de Chromium;
- `startRendering()` solo comprueba abort antes y despues: no es cancelable de forma cooperativa durante la operacion.

### Camino preserve

- requiere sample rate minimo de 8 kHz;
- importa dinamicamente el factory local pinneado;
- cachea la promesa del factory, pero crea una instancia WASM por render;
- llama exports Emscripten de bajo nivel: `_main`, `_configure`, `_reset`, `_inputLatency`, `_outputLatency`, `_setBuffers`, `_setTransposeFactor`, `_setFormantSemitones`, `_setFormantBase`, `_seek` y `_process`;
- configura internamente dos canales, ventana aproximada de 120 ms, intervalo de 30 ms y `split=true`;
- para mono duplica la fuente hacia el canal interno y devuelve un canal; para mas de dos canales devuelve solo dos;
- rellena con cero fuera del A-B para satisfacer historia/latencia;
- procesa quanta de 128 frames, valida muestras finitas, reporta cada 5% y cede el event loop cada 256 quanta;
- no hay liberacion explicita de recursos/heap despues de cada render;
- usa transpose factor 1: el objetivo es conservar tono, no transponerlo.

### Memoria, tiempo y cancelacion

Existe un limite de 512 MiB para el array PCM de salida calculado. Ese limite no representa el pico real. El pico tambien puede incluir:

- bytes comprimidos descargados o segmentos HLS combinados;
- AudioBuffer decodificado del track completo;
- copia del rango;
- buffer del OfflineAudioContext;
- heap WASM y buffers de entrada/salida;
- Float32 PCM final;
- WAV PCM 16-bit y blob;
- dos jobs concurrentes del manager en otros flujos.

No hay medicion de RAM ni duracion maxima aceptada. Tampoco hay backpressure especifica para un loop lento. La cancelacion es cooperativa dentro del loop Signalsmith y del fallback lineal, pero `fetch`, `decodeAudioData` y `OfflineAudioContext.startRendering` tienen puntos donde el aborto puede demorarse segun la implementacion existente.

Decision de error pendiente: si Signalsmith falla, el codigo falla la descarga. No existe fallback silencioso a pitch natural, lo cual evita entregar un archivo semanticamente distinto, pero debe comunicarse claramente y probarse.

## Formato de salida y naming

- todo loop se vuelve a codificar como WAV PCM 16-bit;
- a `1x`: `Artist - Title (loop).wav`;
- con rate no unitario: `Artist - Title (loop 0.5x preserve pitch).wav` o `(... natural pitch).wav`;
- el WAV no incluye metadata estructurada propia para A, B, rate, modo de pitch o track identity; solo el filename expresa parte del estado;
- la descarga normal del track completo no recibe `playbackTransform`, por lo que hoy ignora rate/preserve aunque se inicie desde el player. Este comportamiento fue reportado por el usuario como incorrecto;

Debe probarse sanitizacion y longitud del filename con los nuevos sufijos, ademas de colisiones entre exports con configuraciones diferentes.

## Provenance, licencia y supply chain

Hechos comprobados:

- `scripts/vendor/signalsmith/wasm-factory.mjs` tiene SHA-256 `14c2c5858daff55746fb6c61dee3a67a9fc5ba5edf57ce715559297c041d3d89`;
- en el workspace actual coincide byte a byte con `repos/soundcloud-tempo-control-main/vendor/signalsmith/wasm-factory.mjs`;
- el repo local declara MIT para SoundCloud Tempo Control y MIT, copyright 2022 Geraint Luff / Signalsmith Audio Ltd., para Signalsmith Stretch;
- el repo local de referencia declara revision Signalsmith `57b93f4e9206a089a45387eaa39bdc9f310d3308`;
- los headers de `tempo-control-core.js`, `tempo-control-main.js` y `loop-audio-renderer.js` remiten a `THIRD_PARTY_LICENSES.md`.

Problemas del commit:

1. `THIRD_PARTY_LICENSES.md` no existe en el arbol del commit ni en el workspace actual.
2. `scripts/package-extension.ps1` tampoco lo incluye en su allow-list.
3. El vendor generado no trae por si solo, de forma visible, el texto completo de licencia en el paquete.
4. `repos/` esta ignorado, por lo que la fuente de referencia, licencia y metadata de provenance no viajan en el commit.
5. El test de hash depende de esa carpeta ignorada; un clon limpio no puede ejecutar esa comparacion.

Gate obligatorio antes de release:

- versionar avisos completos de ambas licencias aplicables;
- incluirlos en el ZIP;
- registrar revision upstream, hash del artefacto y proceso de actualizacion en una fuente versionada que no dependa de `repos/`;
- hacer que el test de integridad sea autocontenido;
- revisar si hubo otras porciones significativas copiadas/adaptadas que requieran notice;
- no copiar codigo del repo de Segment Looper mientras siga sin licencia comprobada.

## CSP y superficie de seguridad

El commit agrega para todas las extension pages:

```text
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'
```

Esto habilita el WASM local en offscreen, pero la politica es de alcance global a extension pages. La auditoria debe:

- confirmar que `wasm-unsafe-eval` sea imprescindible para el factory elegido y aceptable para Chrome Web Store;
- verificar que ningun input remoto pueda elegir la URL importada;
- confirmar que el factory y su payload quedan completamente locales;
- revisar si puede reducirse el blast radius con otro empaquetado/instanciacion;
- inspeccionar el ZIP real y el manifest mostrado por Chrome;
- confirmar que no se agregaron permisos ni trafico de red adicional. En el diff no se agregaron permisos; el engine es local.

## Evidencia disponible y fuerza de cada prueba

| Evidencia | Que demuestra | Que no demuestra |
| --- | --- | --- |
| `verify-tempo-control.js` | Manifest MAIN/top frame, guards mock, rango y strings de UI/package | SoundCloud real, licencia presente, packaging exitoso |
| `verify-tempo-browser.js` | Fixture Chromium: ubicacion, slider, native preserve, guard y bridge | Instalacion real desde manifest, SPA/ads/HLS, calidad audible |
| `verify-pitched-loop-renderer.js` | Normalizacion, duracion, factory mock, WASM real, seno 440 Hz a `0.5x` | Musica, stereo real, otros rates/sample rates, sesiones largas |
| `verify-loop-download.js` | Flujo simulado y naming natural | Decoder/codecs reales y preserve WASM |
| verificadores de routing/execution | `playbackTransform` llega por las capas | Integridad del valor en procesos reales o recovery |
| `verify-loop-browser.js` | Extension E2E local hasta archivo descargado | SoundCloud real; usa una fuente WAV/fixture controlada |
| hash SHA-256 | Artefacto local igual al repo local actual | Reproducibilidad en clon limpio o licencia incluida |

### Ejecuciones de este relevamiento

- `node scripts/verify-pitched-loop-renderer.js`: **PASS** en el workspace actual.
- `node scripts/verify-tempo-browser.js`: **PASS** y genero `test-results/tempo-control.png` ignorado por Git.
- `node scripts/verify-tempo-control.js`: **FAIL** con `Extension package is missing THIRD_PARTY_LICENSES.md.`
- `npm.cmd test`: **FAIL** al llegar a `verify-popup-ux.js`, con el fallo previo/no relacionado sobre preservar selection state del tutorial. Como el runner corta alli, no alcanza `verify-tempo-control.js` y oculta el fallo de licencia en la suite general.
- `npm test` desde PowerShell: no inicio porque la execution policy bloquea `npm.ps1`; usar `npm.cmd` en este entorno.

Evidencia historica informada durante la implementacion:

- E2E de un A-B de un segundo a `0.5x + preserve` produjo WAV de dos segundos y midio el seno de 220 Hz conservado.
- Se habia informado un ZIP actualizado y tests exitosos, pero ese estado no queda respaldado por el arbol actual porque la licencia falta y `dist/` esta ignorado. Tratarlo como evidencia historica, no como release reproducible.

## Defectos y riesgos priorizados para la auditoria

### P0 - bloqueantes de integridad/release

- licencia requerida ausente del commit y del paquete;
- verificador de provenance dependiente de un repo local ignorado;
- el commit no puede demostrar por si mismo la cadena completa source -> vendor -> notice -> ZIP;
- los documentos originales afirman presencia de licencia/package que el arbol contradice.

### P1 - correctness y regresion

- resolver y cubrir el gap confirmado: la descarga del boton del player debe respetar el estado de tempo/pitch segun la expectativa del usuario; definir formato, duracion, naming, progreso, limites y si tambien alcanza otros entry points de track completo;
- probar que el snapshot corresponde al track/rango correctos durante navegacion SPA;
- cubrir `1x`, natural y preserve como casos E2E separados;
- probar extremos `0.5x` y `2x`, pasos intermedios (`0.85`, `1.25`) y valores manipulados;
- probar mono, stereo y decidir/rechazar explicitamente mas de dos canales;
- probar 8k, 44.1k, 48k, 96k y bordes del rango;
- comprobar inicio/final de track, loops muy cortos, clicks de frontera y silencio;
- probar progressive, HLS y original real cuando el loop usa cada fuente;
- probar fallo de import/instanciacion WASM, sample rate invalido y salida no finita;
- probar abort en download, decode, natural render y preserve render;
- verificar recovery/restart del service worker y colision con bulk activo;
- revisar que el parche de rate no provoque loops de `ratechange` o interferencia con SoundCloud.

### P1 - performance

- medir tiempo, pico de RAM y capacidad de cancelacion en loops 10 s, 1 min, 10 min y mix largo;
- repetir exports secuenciales para detectar crecimiento de memoria/WASM;
- probar dos operaciones concurrentes relevantes;
- definir limite de duracion/bytes de entrada basado en medicion, no solo 512 MiB de salida.

### P1 - experiencia y accesibilidad

- localizar todos los strings nuevos de UI, progreso y error; hoy estan hardcodeados en ingles;
- validar teclado, foco, lector de pantalla, contrastes y forced colors;
- comprobar panel en viewport angosto, zoom, player reducido y fullscreen/modos alternativos;
- decidir si el cambio entre tabs es deseado;
- explicar que preserve puede tardar y que el export genera WAV grande;
- no consumir una futura prueba premium hasta que el archivo se haya guardado con exito.

### P2 - mantenibilidad

- centralizar o documentar deliberadamente constantes duplicadas de rate/storage/atributos;
- evaluar si `tempo-control-main.js` mezcla demasiada UI, CSS, storage y lifecycle para un adapter;
- documentar/encapsular el uso de exports Emscripten privados de Signalsmith;
- agregar `dispose` o comprobar que GC libera instancias y buffers;
- revisar si naming pertenece a download core o a una politica de output separada;
- medir el aumento neto de codigo contra el plan “replace, don't layer”. Esta feature agrega modulos pero casi no elimina caminos previos porque es comportamiento nuevo; no debe contarse como avance del refactor arquitectonico.

## Relacion con los planes de producto

Los planes del 5-7 de septiembre decian que pitch/velocidad eran backlog y que el export no aplicaba esos efectos. Esas frases quedaron historicas con `9dc9f1b`.

Decisiones comerciales que ahora deben cerrarse:

- si el control live de velocidad/preserve queda gratis para todos;
- si solo el export A-B transformado pertenece a Looper pago;
- si un fallo de render no consume la unica prueba gratis (recomendacion coherente con el plan actual: consumir solo despues de guardado exitoso);
- como se presenta la diferencia entre track completo gratis y loop creativo transformado;
- si el tamaño/tiempo extra de WAV exige limites visibles antes de cobrar;
- si “pitch” puede usarse en marketing sin sugerir transposicion independiente.

No activar paywall, checkout ni publicacion por este documento. El plan de lanzamiento sigue requiriendo autorizacion expresa para esas acciones.

## Relacion con el plan arquitectonico

Aplicando la terminologia de deep modules:

- `SCLoopAudioRenderer` es el seam mas profundo y con mejor locality del cambio.
- `SCTempoControl` concentra politica live reutilizable y protege al adapter de detalles de descriptors.
- el adapter visual sigue siendo grande y merece una revision de cohesion, no una division automatica.
- `playbackTransform` es hoy una interface informal repetida a traves de adapters; su validacion final es correcta, pero el significado debe quedar canonico.
- live y offline son dos owners deliberados de audio en contextos distintos. El limite debe mantenerse: Signalsmith offline no debe apropiarse del player sin una fase de diseño separada.
- la prueba de eliminacion del renderer es positiva; la de cada capa de pass-through no lo es por separado. Un refactor futuro debe reducir callers, no agregar wrappers.

## Matriz minima antes de aceptar la feature

| Dimension | Casos minimos |
| --- | --- |
| Rate | `0.5`, `0.85`, `1`, `1.25`, `2` |
| Pitch | natural y preserve para cada rate no unitario |
| Canales | mono, stereo; input >2 debe tener conducta decidida |
| Sample rate | 8k, 44.1k, 48k, 96k |
| Rango | inicio, medio, final, muy corto, largo, fuera de limites/manipulado |
| Fuente | progressive, HLS, original cuando aplique, error HTTP/decode |
| Lifecycle | SPA, cambio de track, audio reemplazado, dos tabs, storage bloqueado |
| Cancelacion | antes/durante fetch, decode, natural render, preserve render, save |
| Performance | loops crecientes, mix largo, exports repetidos, concurrencia |
| Output | duracion, pitch, amplitud finita, clipping, clicks, filename, guardado |
| UI/a11y | mouse, teclado, Escape, foco, screen reader, zoom, locales largos |
| Package | clon limpio, tests, ZIP allow-list, carga unpacked, notices visibles |

## Procedimiento de auditoria en frio

1. Crear un worktree o clon limpio en `9dc9f1b`; no usar `repos/` ni `dist/` heredados como evidencia.
2. Ejecutar `git status --short`, confirmar parent y revisar `git diff 03cfba0..9dc9f1b` completo.
3. Verificar que cualquier correccion posterior de licencia/provenance este en Git y dentro del ZIP.
4. Ejecutar `npm.cmd test`; despues ejecutar individualmente todos los verificadores posteriores al primer fallo para evitar fallos ocultos.
5. Ejecutar `npm.cmd run test:e2e:tempo` y `npm.cmd run test:e2e`; guardar logs y hashes de outputs.
6. Ejecutar el empaquetador en un directorio temporal, listar el ZIP y cargar exactamente ese contenido en Chromium.
7. Hacer la matriz de audio sintetica y luego una matriz autorizada de SoundCloud real.
8. Medir RAM/tiempo/cancelacion; registrar browser, OS, CPU, duracion, codec y sample rate.
9. Revisar manualmente prototype patches, CSP, imports, mensajes cross-world y datos persistidos.
10. Auditar licencia desde upstream pinneado y no solo desde el repo local copiado.
11. Revisar los planes comercial, release y arquitectura con las decisiones nuevas.
12. Emitir un resultado independiente: aceptar, aceptar con follow-ups o rechazar/rollback. No heredar la conclusion del documento de integracion.

Comandos base sugeridos:

```powershell
git show --stat --oneline 9dc9f1b1d07ec773207cff72dd362e60e035cbc5
git diff 03cfba012159a6549acd80943578335b23d0ed4c..9dc9f1b1d07ec773207cff72dd362e60e035cbc5
git ls-tree -r --name-only 9dc9f1b1d07ec773207cff72dd362e60e035cbc5
npm.cmd test
npm.cmd run test:e2e:tempo
npm.cmd run test:e2e
npm.cmd run package:extension
```

El packaging debe ejecutarse solo despues de corregir el notice faltante; en el estado exacto auditado debe fallar el gate de licencia aunque el script actual no haya llegado a copiarla.

## Criterios de aceptacion

La feature no esta lista para aprobar hasta que:

- [ ] commit/PR sea autocontenido desde clon limpio;
- [ ] notices y provenance esten versionados y empaquetados;
- [ ] suite general no oculte verificadores por un fallo previo;
- [ ] existan E2E separados para `1x`, natural y preserve;
- [ ] se complete la matriz minima proporcional al riesgo;
- [ ] se midan y definan limites de memoria/duracion;
- [ ] se pruebe cancelacion y limpieza de recursos;
- [ ] se valide SoundCloud real progressive/HLS y navegacion SPA;
- [ ] se localicen strings y se cierre accesibilidad;
- [ ] se decida alcance gratis/pago y semantica de la prueba;
- [ ] README, roadmap y launch plan describan el estado aceptado, no solo el implementado;
- [ ] un revisor distinto emita conclusion independiente.

## Opciones de rollback y aislamiento

El cambio tiene seams que facilitan una desactivacion selectiva:

- UI/live: quitar la entrada MAIN de tempo del manifest desactiva el control, pero una pagina ya cargada conserva los prototype patches hasta recargar.
- Export transformado: dejar de enviar `playbackTransform` o hacer que el renderer acepte solo `1x` restaura semantica base, pero debe conservarse la exportacion A-B existente.
- WASM: retirar renderer/vendor exige quitar el script de offscreen, CSP si deja de ser necesario, package items, tests y notices relacionados.

No hacer rollback parcial olvidando limpiar manifest, CSP, offscreen, allow-list, README y verificadores. Antes de revertir, confirmar si otros commits posteriores dependen del nuevo shape `playbackTransform`.

## Preguntas abiertas para la revision futura

1. ¿La feature aceptada es tempo + preserve binario, o se espera pitch independiente?
2. ¿La preferencia debe ser global, por tab o por track?
3. El usuario ya indico que la descarga normal del player debe respetar pitch. Falta precisar si tambien debe respetar siempre el rate, si produce WAV, y si la misma regla alcanza popup/inline/colecciones o solamente ese boton.
4. ¿Se acepta que live y WAV usen motores distintos?
5. ¿Ante fallo de preserve se aborta explicitamente o se ofrece al usuario natural pitch?
6. ¿Cual es el limite de loop por duracion/RAM y como se comunica antes de renderizar?
7. ¿Se aceptan solo mono/stereo o debe preservarse audio multicanal?
8. ¿El control live es gratuito y el export transformado premium?
9. ¿Como se versiona `PlaybackTransform` si luego aparecen semitonos/timeline?
10. ¿Puede eliminarse `wasm-unsafe-eval` global con otro build/loader?
11. ¿Que garantia de calidad subjetiva se exige antes de Store?
12. ¿Quien firma la auditoria independiente y con que browser/OS objetivo?

## Registro de contradicciones documentales detectadas

- `FEATURE-MAP-SOUNDCLOUD-EXTENSIONS.md` describe velocidad/preserve como futuros; desde este commit es una fotografia pre-implementacion.
- `TEMPO-INTEGRATION-AUDIT.md` dice que la suite verifica presencia de licencia y package inclusion; el test actual falla porque la allow-list no contiene la licencia y el archivo no existe.
- `product-roadmap-20260905.md` dice que no se encontro velocidad/pitch y que el WAV no exporta esos efectos; quedo desactualizado.
- `product-launch-plan-20260905.md` ubica pitch/velocidad en E8/backlog; la implementacion se adelanto sin cerrar todavia sus gates de release.
- README ya presenta la capacidad como disponible; esa promesa debe considerarse provisional hasta cerrar P0/P1.

Este handoff registra contexto y riesgos. No corrige el producto, no agrega la licencia faltante y no constituye autorizacion de release.
