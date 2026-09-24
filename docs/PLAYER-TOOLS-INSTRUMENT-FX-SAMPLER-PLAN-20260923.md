# Player Tools como instrumento: plan de FX, teclado sampler y slices

> **ABIERTO / borrador de producto — revisión 24/09/2026 (`29d7946`).** Cinco FX adicionales, teclado instrumental y slices 4/8/16 siguen propuestos. Los seis pads y reverb/delay/EQ existentes no cierran este plan; decisiones de sección 3 pendientes. Estado y pendientes: [registro vigente](ESTADO-ACTUAL-20260924.md).

Fecha: 23 de septiembre de 2026. Estado: borrador ejecutable pendiente de confirmar las decisiones de la sección 3. Alcance autorizado: planificación; este documento no implementa funciones, no cambia la oferta comercial y no publica la extensión.

## 1. Objetivo y alcance

Convertir Player Tools en una superficie más tocable sin transformarlo en un DAW. El resultado incluye solamente:

- flanger;
- phaser;
- echo con freeze;
- bitcrusher;
- saturación;
- un modo de teclado que toque el loop activo como un instrumento afinado;
- `Slice to pads` en 4, 8 o 16 cortes.

Quedan expresamente fuera: un filtro nuevo (se conserva el EQ actual), stutter/beat repeat, tape stop, reverb freeze, reverse por pad, roll, secuenciador, choke groups y grabación de automatización XY. El plan tampoco agrega detección de BPM o transientes como requisito de esta entrega.

## 2. Base real inspeccionada

El trabajo debe extender lo que ya existe y no crear otro motor de audio.

| Área | Estado actual | Consecuencia |
| --- | --- | --- |
| FX en vivo | `scripts/audio-effects-core.js` inserta reverb, delay y EQ sobre el audio actual de SoundCloud, conserva la ruta del sitio, limita la salida y maneja reemplazos del elemento `<audio>` | Ampliar el mismo controlador, sus snapshots, reset, bypass y cambio de track |
| FX offline | `SCTempoEffects.renderSample` replica reverb, delay y EQ con `OfflineAudioContext` | Todo efecto persistente nuevo debe tener paridad offline para pads y exportaciones; freeze será una interacción en vivo, no un ajuste exportable |
| UI | `scripts/tempo-control-main.js` contiene el panel, presets, FX, loop y sampler | Extraer lógica nueva a módulos puros antes de seguir agrandando este archivo |
| Sampler | Hay seis pads, teclas configurables, samples de fábrica, carga de archivo, reproducción one-shot y persistencia | Migrar sin perder los seis slots actuales; no levantar un segundo sampler |
| Loop a pad | El botón junto al loop captura rango, velocidad, Keep Tone y FX; background resuelve la pista y offscreen renderiza el WAV | Reutilizar el mismo snapshot y resolución para teclado y slices |
| Persistencia | `scdl-player-pads`, IndexedDB v2, stores `samples`, `operations` y `claims`; índice 0–5, 12 MB por blob y 30 s por muestra | Crear una migración versionada y operaciones batch atómicas para 16 slots |
| Acceso | Guardar loop a pad se autoriza hoy como `export-loop` Pro; FX usan `set-effect` dentro del trial/Pro | Añadir capacidades explícitas en política; no inferir permisos en MAIN ni desde la UI |
| Pruebas | Hay unitarios del grafo, Playwright de FX y verificadores de looper/pads/exportación | Extender esos niveles con señales sintéticas y pruebas de interacción, no validar sólo el DOM |

La documentación vigente de Web Audio confirma que un `AudioBufferSourceNode` se crea por cada disparo, que `detune` y `playbackRate` determinan juntos la afinación, que un `AudioWorklet` es la vía adecuada para reducción de bits/frecuencia y que `OfflineAudioContext` permite reproducir el grafo fuera de tiempo real. Esas propiedades guían el diseño, pero primero se hará un spike del Worklet bajo MV3, MAIN world y la CSP real de la extensión.

## 3. Decisiones de producto por confirmar

El plan usa estos defaults para quedar implementable. Cambiarlos antes de E1 no invalida la arquitectura.

1. **Freeze:** botón momentáneo; al presionar deja de entrar señal nueva al echo y sostiene el contenido del delay; al soltar vuelve suavemente al feedback anterior. No persiste, no se guarda en presets y se cancela al cambiar de pista, resetear o activar bypass.
2. **Teclado:** teclado QWERTY del computador, no Web MIDI físico en esta entrega. Dos filas cromáticas al estilo FL Studio, polifonía, `keydown` para note-on y `keyup` para note-off. Sólo captura teclas mientras el modo Instrument está activado y el foco no está en un campo editable.
3. **Afinación:** C4 es la nota raíz por defecto. La transposición usa `detune`/`playbackRate`, por lo que notas agudas duran menos y graves duran más, como resampling clásico. Se añaden controles de octava y nota raíz, sin time-stretch por nota.
4. **Fuente del instrumento:** snapshot del loop activo con velocidad, Keep Tone, EQ y FX persistentes ya aplicados. Máximo 30 s de audio resultante. El instrumento queda disponible durante la sesión y se conserva en IndexedDB para restaurarlo al reabrir, hasta reemplazarlo o borrarlo.
5. **Pads:** migrar la superficie de 6 a 16 pads en una cuadrícula 4×4. Los seis registros existentes conservan índices 0–5; los demás empiezan vacíos. Fuera del modo Instrument, el mapa inicial será `1 2 3 4 / Q W E R / A S D F / Z X C V`, editable como hoy.
6. **Slices:** 4, 8 o 16 divisiones temporales iguales del loop, sin detección de transientes. Se asignan desde el pad 1 en orden; con 4 u 8 se reemplazan sólo esos slots. Antes de sobrescribir pads ocupados se muestra un resumen y se pide confirmación.
7. **Bordes:** cada slice aplica un microfade de 3 ms limitado por su duración para evitar clics. No hay choke group; los slices pueden superponerse.
8. **FX:** los cinco efectos nuevos funcionan en vivo y, salvo el gesto Freeze, quedan incluidos en loop-to-pad, slices, instrumento y exportaciones con FX. Bypass y Reset afectan a todos.
9. **Oferta:** los nuevos FX siguen la capacidad `tempo` actual durante trial/Pro. Crear instrumento, guardar sus datos y `Slice to pads` son Pro, igual que el render actual de loop a pad. No se cambia el precio ni el trial en este proyecto.
10. **Controles:** todos los nuevos FX tienen mezcla y ajustes avanzados; no se agrega pad XY ni automatización en esta entrega. El freeze y un futuro modo momentáneo comparten una base de gestos, pero sólo Freeze se entrega ahora.

## 4. Contratos e invariantes

- Una única fuente de verdad por estado: `audio-effects-core` para FX, un `SamplerEngine` para voces y el servicio offscreen para blobs persistidos.
- MAIN emite intenciones; background valida remitente, operación, tamaños e índices. Ningún atributo DOM concede Pro.
- Nunca crear dos `MediaElementAudioSourceNode` para el mismo elemento. Los efectos nuevos se montan dentro del grafo ya cacheado por elemento.
- Un snapshot de FX es versionado, normalizado y acotado. Valores desconocidos se ignoran al migrar; valores no finitos se rechazan.
- Cambiar pista, resetear o desmontar detiene LFO, voces, timers, fuentes y freeze pendientes. Bypass silencia procesamiento sin olvidar parámetros persistentes.
- La salida final conserva headroom y limitador. Feedback nunca alcanza una ganancia inestable; Freeze usa un valor seguro cercano a unidad y un filtro dentro del lazo.
- La preparación asíncrona captura `trackIdentity`, generación, rango y revisión de intención. Una respuesta tardía no activa un instrumento ni reemplaza pads de otra pista.
- `AudioBufferSourceNode` es desechable: cada nota y pad crea su propia fuente; nunca se reinicia una fuente finalizada.
- Un batch de slices es todo o nada respecto de sus slots. Un fallo no deja media cuadrícula nueva y media antigua.
- Ninguna operación vuelve a descargar o decodificar la misma fuente dieciséis veces dentro de un batch.
- El teclado no intercepta atajos cuando el modo está apagado, el panel está cerrado, hay un modal, el foco es editable o se usan Ctrl/Cmd/Alt.

## 5. Modelo de FX y grafo de audio

### 5.1 Snapshot v2

Ampliar el estado normalizado, sin renombrar `delay` todavía para preservar presets y datos existentes:

```json
{
  "schemaVersion": 2,
  "bypassed": false,
  "reverb": 0,
  "delay": 0,
  "delayTime": 250,
  "delayFeedback": 25,
  "delayTone": 70,
  "flanger": 0,
  "flangerRate": 0.25,
  "flangerDepth": 50,
  "flangerFeedback": 15,
  "phaser": 0,
  "phaserRate": 0.2,
  "phaserDepth": 50,
  "phaserFeedback": 10,
  "bitcrusher": 0,
  "bitDepth": 12,
  "sampleRateReduction": 25,
  "saturation": 0,
  "saturationDrive": 25,
  "saturationTone": 60,
  "preset": "custom"
}
```

Los límites exactos se fijan con pruebas auditivas antes de congelar el esquema. `freeze` no aparece: es estado efímero de interpretación. La normalización vive en funciones puras reutilizadas por MAIN, offscreen, background y tests.

### 5.2 Orden y topología

Ruta propuesta:

```text
source/EQ -> dry -------------------------------> master -> limiter
          -> saturation insert (wet/dry) ------>
          -> bitcrusher insert (wet/dry) ------>
          -> phaser branch (wet/dry + feedback)>
          -> flanger branch (wet/dry + feedback)>
          -> reverb send ----------------------->
          -> echo input -> delay feedback loop ->
```

La implementación debe verificar suma de ganancia y correlación de fase; si varias ramas activas elevan demasiado el nivel, usar mezcla equal-power o compensación por rama antes del limitador. No cambiar el volumen del audio seco cuando todos los efectos están en 0%.

- **Flanger:** delay corto modulado por LFO, profundidad, rate y feedback acotado. El oscilador se crea una vez por grafo, se inicia una vez y se desconecta al destruir el grafo.
- **Phaser:** cuatro etapas `allpass` con frecuencias moduladas por un LFO común, profundidad/rate y feedback moderado. No reutilizar el EQ como phaser.
- **Saturación:** `WaveShaperNode` con curva precalculada por nivel de drive, oversampling cuando esté disponible, filtro tonal y compensación de salida.
- **Bitcrusher:** `AudioWorkletProcessor` con cuantización y sample-and-hold. Añadir un recurso propio al paquete y probar que `audioWorklet.addModule()` carga bajo MV3/SoundCloud. Si el spike falla, bloquear E2 y documentar la limitación; no recurrir a `ScriptProcessorNode` obsoleto.
- **Echo Freeze:** insertar `delayInputGain` antes del delay. Al pulsar: rampa de entrada a 0, feedback a un máximo seguro y wet al valor necesario sin salto. Al soltar: restaurar feedback/wet previos y reabrir entrada con rampas cortas. Reset/cambio de pista reconstruye o vacía esa rama para no transportar audio anterior.

### 5.3 Paridad offline

Crear una factoría de grafo compartida para que live y `OfflineAudioContext` usen la misma normalización, orden y curvas. El Worklet en offline necesita una prueba específica; si el navegador no lo soporta de forma confiable, implementar el bitcrusher offline como transformación PCM pura con idéntica cuantización/sample-and-hold.

Calcular tails sólo para reverb y echo. Flanger, phaser, crusher y saturación no alargan la duración. Mantener límites de memoria y AbortSignal. Freeze no se renderiza: el snapshot captura el echo normal.

## 6. Motor de sampler instrumental

Extraer de `tempo-control-main.js` dos módulos:

- `scripts/sampler-core.js`: mapas de teclas/notas, afinación, slice ranges, límites, estado de voces y funciones puras.
- `scripts/sampler-engine.js`: `AudioContext`, cache de buffers, note-on/off, envelopes, polifonía, pads y cleanup.

Contrato propuesto:

```js
engine.setInstrument({ id, buffer, rootMidi: 60, name, revision });
engine.noteOn({ keyId, midiNote, velocity: 1 });
engine.noteOff({ keyId });
engine.triggerPad({ index, velocity: 1 });
engine.stopAll({ releaseMs: 12 });
engine.setMode("pads" | "instrument");
```

Cada voz usa `AudioBufferSourceNode -> GainNode -> sampler master`. `detune = (midiNote - rootMidi) * 100`. Agregar ataque corto y release corto para evitar clics; mantener polifonía inicial de 24 voces con voice stealing de la voz más antigua si se supera. Ignorar `event.repeat`; liberar todas las voces en `blur`, `visibilitychange`, salida del modo, bypass y cambio de pista.

El botón Instrument se ubica junto al botón actual de enviar loop a pad. Flujo:

1. validar loop activo y duración efectiva;
2. capturar identidad/generación/rango/rate/Keep Tone/FX;
3. autorizar una vez;
4. mostrar estado Preparing y permitir cancelar;
5. resolver/decodificar/renderizar una vez en offscreen;
6. persistir el blob y metadatos versionados;
7. devolverlo a MAIN, decodificarlo en el contexto del sampler y activar Instrument sólo si la intención sigue vigente;
8. mostrar nota raíz, octava y ayuda de mapa; Escape sale del modo y devuelve los atajos normales.

No pausar automáticamente SoundCloud al entrar: mostrar un control separado `Mute source while playing` activado por defecto para evitar que pista e instrumento se mezclen accidentalmente. Este mute debe usar una ruta reversible y nunca cambiar el volumen guardado del usuario.

## 7. Slice to pads

Añadir un botón `Slice` junto a las acciones de Loop Region. Al pulsarlo se abre un popover accesible con 4, 8 y 16, resumen de slots a reemplazar y cancelar/confirmar.

`sampler-core` calcula límites en frames, no acumulando milisegundos redondeados:

```text
startFrame(i) = floor(totalFrames * i / count)
endFrame(i)   = floor(totalFrames * (i + 1) / count)
```

Así no quedan huecos ni se pierde el último frame. La fuente es el mismo snapshot renderizado que usaría Instrument. Se renderiza el loop una vez, se divide el `AudioBuffer` resultante, se aplican microfades y se codifica cada slice. Nombre sugerido: `Track · Slice 01/16`.

Nuevo protocolo batch:

```json
{
  "type": "RENDER_LOOP_SLICES",
  "operationId": "slice_...",
  "count": 16,
  "startIndex": 0,
  "trimRange": {},
  "playbackTransform": {},
  "effects": {},
  "trackIdentity": "...",
  "expectedGeneration": 0
}
```

Background valida 4/8/16, slots, duración, tamaño agregado, autorización y pertenencia del sender. Offscreen crea una operación idempotente, mantiene claims para todos los slots y compromete los registros en una sola transacción IndexedDB sólo después de preparar todos los blobs. Cancelar aborta fetch/render y no toca pads existentes. Una segunda operación que reclama un slot invalida limpiamente la anterior.

## 8. Persistencia y migración

Subir la base `scdl-player-pads` a v3:

- conservar `samples` por índice y aceptar 0–15;
- añadir metadatos `kind: "pad" | "slice"`, `source`, `durationMs`, `revision` y `schemaVersion`, sin exigirlos a registros v2;
- crear store `instrument` con una única clave estable y blob/metadatos;
- generalizar `claims` para operaciones batch;
- conservar receipts de operaciones sólo con retención acotada para evitar crecimiento indefinido.

La migración no re-encodea los seis blobs existentes. Abrir v3 y listar debe mostrar exactamente los registros anteriores en 0–5. Si falla la migración, abortar y conservar v2; nunca borrar la base como recuperación automática.

Revisar los límites por blob y total. El límite inicial sigue siendo 12 MB por muestra y 30 s para el loop instrumental; antes de release medir el peor caso de 16 slices y rechazar antes de renderizar si excede el presupuesto agregado.

## 9. UI, interacción y accesibilidad

- FX se organiza en grupos `Space` (Reverb/Echo), `Motion` (Flanger/Phaser) y `Color` (Saturation/Bitcrusher), manteniendo controles compactos de bypass individual.
- Renombrar visualmente Delay a Echo sólo después de conservar claves y migración. Freeze es un botón con `aria-pressed`, instrucciones de mantener pulsado y soporte Pointer + Space/Enter; `pointercancel`, `blur` y pérdida de visibilidad equivalen a soltar.
- Instrument muestra claramente que el teclado está capturado, el mapa de notas, raíz/octava, botón Salir y estado de preparación/error.
- Los 16 pads usan una cuadrícula 4×4 con número, tecla y nombre abreviado. Mantener carga por hold/Shift+Enter y navegación por teclado.
- Slice informa qué pads reemplazará. La confirmación inicial recibe foco, Escape cancela y el resultado se anuncia por `aria-live`.
- Respetar `prefers-reduced-motion`; no usar parpadeos para indicar nota o freeze.
- Todo texto visible nuevo debe ir a `_locales/en`, `es`, `de`, `ru` y `pt_BR`; eliminar strings ingleses inline del flujo tocado.

## 10. Acceso y seguridad

Agregar operaciones versionadas, por ejemplo `prepare-instrument` y `slice-loop-to-pads`, a la política y al cliente. La propuesta comercial de la sección 3 debe confirmarse antes de tocar la matriz. Una autorización cubre un snapshot/batch, no cada slice ni cada nota.

Validaciones obligatorias en background/offscreen:

- remitente de la extensión y página SoundCloud permitida;
- identidad/generación/rango coherentes;
- count sólo 4/8/16 e índices 0–15;
- FX normalizados con allowlist, nunca objetos arbitrarios;
- duración efectiva, bytes base64/blob, nombre y operation ID acotados;
- URLs resueltas por el pipeline existente, no aceptadas desde MAIN como autoridad;
- idempotencia por firma completa: reutilizar un ID con otra firma devuelve conflicto.

## 11. Etapas de implementación

### E0 — Baseline y decisiones

Confirmar sección 3. Registrar HEAD/diff y ejecutar verificadores actuales de FX, loop, tempo, pads, policy, background, offscreen y paquete. Crear fixtures de impulso, seno, ruido y transiente. Medir nivel seco, tails, CPU y memoria. Hacer el spike mínimo de AudioWorklet en el contexto real de la extensión y documentar URL/CSP/ciclo de vida.

Salida: defaults cerrados, baseline verde o fallos preexistentes clasificados, Worklet viable y presupuesto de audio acordado.

### E1 — Extracción y contratos

Crear `sampler-core`, `sampler-engine` y normalizador FX v2. Separar mensajes/persistencia de pads de la UI. Mantener comportamiento visible actual. Agregar tests puros de notas, voces, slices, schema y migración 6→16.

Salida: refactor sin features visibles y sin regresiones.

### E2 — Saturación y bitcrusher

Implementar primero Color porque prueba la factoría de inserts y el Worklet. Añadir live/offline, UI, presets, reset/bypass, export/pad y empaquetado del processor. Comparar salida contra fixtures y validar ausencia de clipping/NaN/denormals.

Salida: paridad live/offline de ambos efectos y fallback explícito si Worklet no está disponible.

### E3 — Flanger y phaser

Implementar LFO, modulación, feedback, lifecycle y UI. Probar activación/desactivación repetida, reemplazo de `<audio>`, cambio de pista, 100 resets y múltiples grafos cacheados. Confirmar CPU con ambos activos.

Salida: Motion estable, sin osciladores/nodos huérfanos ni cambio de nivel con wet=0.

### E4 — Echo Freeze

Refactorizar la rama delay con input gain y estado efímero. Implementar gesto momentáneo, rampas, seguridad, cancelación y flush. Probar pointer/teclado, mantener 60 s, soltar, bypass, pausa, seek y navegación SPA.

Salida: freeze tocable sin runaway, pop ni audio viejo en otra pista.

### E5 — Sampler engine y 16 pads

Migrar IndexedDB, UI y validadores a 16 slots; preservar seis pads. Sustituir `playDrum` por el motor de voces. Mantener carga de archivo, teclas editables y loop-to-pad. Añadir stop/release y manejo de foco.

Salida: regresión funcional completa del sampler actual sobre el motor nuevo.

### E6 — Instrument

Añadir preparación/persistencia, botón, modo QWERTY, mapa cromático, raíz/octava, polifonía, cancelación y mute reversible de fuente. Comprobar carreras de cambio de loop/pista y restauración después de reload.

Salida: loop activo tocable en notas con latencia estable y sin bloquear escritura/atajos fuera del modo.

### E7 — Slice to pads

Implementar cálculo por frames, render único, microfades, batch atómico, confirmación de overwrite, progreso/cancelación e idempotencia. Probar 4/8/16 y fallos en fetch, render, cuota y commit.

Salida: slices ordenados, sin huecos ni reemplazos parciales.

### E8 — Integración y release gate

Actualizar presets, reset global, descargas con FX, locales, ayuda, manifest, empaquetado y telemetría existente sólo si el allowlist ya acepta los eventos. Ejecutar suite completa y QA manual en SoundCloud real. No publicar desde esta etapa sin autorización separada.

## 12. Matriz mínima de pruebas

### Unitarias/audio

- normalización y clamps de cada parámetro;
- wet=0 bit-identical o dentro de tolerancia definida respecto del dry;
- respuesta de flanger/phaser ante LFO y ausencia de feedback inestable;
- saturación simétrica, output finito y compensación;
- crusher con valores conocidos de bit depth/sample hold;
- freeze cierra input y restaura exactamente el estado anterior;
- live/offline dentro de tolerancia sobre las mismas señales;
- nota ±12 semitonos produce factor 2/0,5; note-off y voice stealing;
- slices cubren todos los frames una vez y mantienen canales/sample rate.

### Integración

- fuente SoundCloud propia y fuente ya tomada por el sitio;
- CORS no apto conserva playback nativo y muestra error recuperable;
- cambio de elemento audio, track, URL SPA, panel cerrado y pestaña oculta;
- reset/bypass no revive tails ni voces;
- instrumento/slice descartan respuestas viejas;
- migración mantiene pads 0–5 y operaciones idempotentes sobreviven reinicio del service worker;
- batch cancela sin escrituras y fallo de cuota no toca datos anteriores;
- exportación y loop-to-pad incluyen FX persistentes nuevos.

### E2E/UX

- Pointer, teclado y accesibilidad de Freeze;
- QWERTY note-on/off, foco editable, Escape, blur y combinaciones del navegador;
- 16 pads en 420 px y viewport angosto;
- confirmación y anuncio de overwrite;
- Free/trial/Pro según matriz confirmada;
- cinco locales sin claves faltantes;
- paquete limpio contiene Worklet y módulos, y no contiene fixtures/debug adapters.

## 13. Criterios de aceptación y presupuestos

- Activar cualquier efecto con audio reproduciéndose no interrumpe perceptiblemente la pista ni crea otra fuente para el mismo media element.
- Ningún sample es NaN/Infinity; pico final ≤ 0 dBFS y sin crecimiento sostenido con feedback máximo.
- Freeze puede mantenerse 60 s y soltarse sin salto evidente ni audio de la pista anterior.
- Note-on responde en el mismo gesto una vez cargado; objetivo inicial de latencia de scheduling ≤ 20 ms en la máquina de prueba, reportando hardware/browser.
- Veinticuatro voces y 16 pads no producen crecimiento continuo de nodos después de `stopAll`.
- Los 16 slices concatenados reproducen el mismo número total de frames que el loop renderizado, salvo las rampas de borde aplicadas dentro de cada slice.
- Una preparación cancelada o stale no cambia instrumento ni pads.
- Pads existentes sobreviven migración y rollback de código no borra IndexedDB.
- `npm test`, `npm run test:e2e:effects`, verificadores nuevos de sampler/slices, `npm run test:player-tools` y `npm run test:package` pasan; luego se hace QA audible manual.

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación / gate |
| --- | --- |
| AudioWorklet no carga desde MAIN/MV3 | Spike E0, recurso empaquetado/permitido y fallback sólo offline; no usar API obsoleta |
| CPU alta con LFO, allpass y 24 voces | Nodos lazy, desconexión real, presupuestos/medición y reducción de etapas antes de release |
| Feedback runaway o DC | clamps por contrato, filtro en loop, limiter, fixtures prolongadas y kill/reset síncrono |
| Diferencias live/offline | factoría/normalizador común y golden tests con misma señal |
| Archivo monolítico difícil de probar | extraer sampler y normalización antes de UI visible |
| Sobrescritura parcial de pads | render previo + transacción única + claims batch |
| Atajos de SoundCloud/navegador robados | modo explícito, guards de foco/modificadores, `code` físico y cleanup en blur |
| Pitch lento genera muestras muy largas | límite sobre duración efectiva antes de render y mensaje accionable |
| Slices con tails inesperados | render único antes de cortar, documentar que se captura el sonido procesado del loop |
| Scope creep hacia DAW/MIDI | exclusiones de sección 1 y Web MIDI como decisión separada |

## 15. Rollback y entrega

Cada etapa queda detrás de una constante de feature local hasta completar su gate. El schema v3 es aditivo: desactivar UI nueva no elimina blobs. Si una nueva rama FX falla, el normalizador conserva valores pero su wet efectivo se fuerza a cero y la ruta seca continúa. Si Instrument/Slice falla, el loop, los seis pads históricos y loop-to-pad tradicional siguen operativos.

La entrega final debe incluir: código, migración, tests, actualización de manifest/package/locales/ayuda, informe breve de mediciones y QA audible. No incluye commit, push, publicación en Chrome Web Store, cambio de precio ni deploy de servicios salvo pedido separado.
