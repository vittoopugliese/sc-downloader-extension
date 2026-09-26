# Player Tools como instrumento: plan de FX, teclado sampler y slices

> **IMPLEMENTACIÓN PARCIAL — revisión 26/09/2026.** El teclado con pitch, los FX adicionales y Slice to pads tienen implementación. Por decisión de producto del 26/09, el sampler pasa a **ocho pads** y el nuevo botón del header divide **solamente el loop A–B seleccionado en ocho partes iguales**, con confirmación antes de reemplazar los sonidos. Las propuestas anteriores de seis pads y cortes 4/6 quedan sustituidas.

Fecha inicial: 23 de septiembre de 2026. Este documento registra implementación y trabajo pendiente; no implica publicación ni cambios comerciales.

### Estado comprobado en código (26/09/2026)

- **Implementado:** loop instrumental renderizado con velocidad, Keep Tone y FX; reproducción con pitch por resampling y Cut itself configurable. Mapa físico tipo FL con 45 teclas: Q = C5 (sample original), Z = C4, filas Z/Q de notas blancas y filas A/números de sostenidos y notas duplicadas para completar los huecos. Incluye puntuación, comillas, corchetes, menos e igual. ←/→ desplazan una octava (−4 a +3), sin capturar escritura ni Ctrl/Cmd/Alt; al entrar se reinicia en 0. Mensaje breve con desplazamiento visible y ayuda detallada sólo en tooltip, traducidos a los cinco idiomas. Al iniciar la preparación o reactivar el buffer se pausa el track si estaba sonando; si ya estaba pausado, sigue así. Salir del instrumento no reanuda la pista.
- **Implementado:** flanger, phaser, saturación y bitcrusher en `audio-effects-core.js`, con procesamiento live/offline; Echo Freeze momentáneo y controles en `tempo-control-main.js`. Freeze no se exporta.
- **Implementado en piano:** ADSR editable, note-off por keyup, opción Cut itself y límite de 32 voces con descarte de la más antigua; el audio completo se prepara para poder mover la selección sin volver a descargar. Cada nota reproduce la selección vigente. Esto es independiente del nuevo flujo de slices, que sólo renderiza A–B.
- **Implementado en pads/slices:** ocho slots (0–7); se conservan samples y teclas previos. Clap 2 y Hat 2 copiados del repo local `drumpads-main/files` completan los defaults, con J/K iniciales sin pisar teclas personalizadas. Botón junto a guardar loop y piano, confirmación modal, render único, ocho WAV con microfades, preparación y commit atómico separados, cancelación, claims por slot y receipts persistidos. Se reutiliza la autorización `save-loop-pad` (trial/Pro).
- **Pendiente fuera de esta entrega:** motor extraído `sampler-engine.js`, mediciones del presupuesto de voces, control de nota raíz y persistencia/restauración del instrumento piano. La presencia de FX en código no da por completado todo el gate de paridad/rendimiento/QA audible.
- **Validación:** existen verificadores del sampler, FX y navegador. La implementación no equivale a completar todos los gates de rendimiento, accesibilidad, locales y QA audible de este plan.

Las secciones siguientes describen el diseño objetivo; no son una lista de tareas ya completadas.

## 1. Objetivo y alcance

Convertir Player Tools en una superficie más tocable sin transformarlo en un DAW. El resultado incluye solamente:

- flanger;
- phaser;
- echo con freeze;
- bitcrusher;
- saturación;
- un modo de teclado que toque el loop activo como un instrumento afinado;
- `Slice to pads` en exactamente 8 cortes del loop seleccionado.

Quedan expresamente fuera: un filtro nuevo (se conserva el EQ actual), stutter/beat repeat, tape stop, reverb freeze, reverse por pad, roll, secuenciador, choke groups y grabación de automatización XY. El plan tampoco agrega detección de BPM o transientes como requisito de esta entrega.

## 2. Base inspeccionada al redactar el plan (23/09)

Esta tabla conserva el punto de partida; el estado actual está al principio del documento. El trabajo debe extender lo que ya existe y no crear otro motor de audio.

| Área | Estado actual | Consecuencia |
| --- | --- | --- |
| FX en vivo | `scripts/audio-effects-core.js` inserta reverb, delay y EQ sobre el audio actual de SoundCloud, conserva la ruta del sitio, limita la salida y maneja reemplazos del elemento `<audio>` | Ampliar el mismo controlador, sus snapshots, reset, bypass y cambio de track |
| FX offline | `SCTempoEffects.renderSample` replica reverb, delay y EQ con `OfflineAudioContext` | Todo efecto persistente nuevo debe tener paridad offline para pads y exportaciones; freeze será una interacción en vivo, no un ajuste exportable |
| UI | `scripts/tempo-control-main.js` contiene el panel, presets, FX, loop y sampler | Extraer lógica nueva a módulos puros antes de seguir agrandando este archivo |
| Sampler | Hay seis pads, teclas configurables, samples de fábrica, carga de archivo, reproducción one-shot y persistencia | Migrar sin perder los seis slots actuales; no levantar un segundo sampler |
| Loop a pad | El botón junto al loop captura rango, velocidad, Keep Tone y FX; background resuelve la pista y offscreen renderiza el WAV | Reutilizar el mismo snapshot y resolución para teclado y slices |
| Persistencia | `scdl-player-pads`, IndexedDB v2, stores `samples`, `operations` y `claims`; índice 0–5, 12 MB por blob y 30 s por muestra | Conservar índices 0–5 y preparar operaciones batch atómicas para esos mismos seis slots |
| Acceso | Guardar loop a pad se autoriza hoy como `export-loop` Pro; FX usan `set-effect` dentro del trial/Pro | Añadir capacidades explícitas en política; no inferir permisos en MAIN ni desde la UI |
| Pruebas | Hay unitarios del grafo, Playwright de FX y verificadores de looper/pads/exportación | Extender esos niveles con señales sintéticas y pruebas de interacción, no validar sólo el DOM |

La documentación vigente de Web Audio confirma que un `AudioBufferSourceNode` se crea por cada disparo, que `detune` y `playbackRate` determinan juntos la afinación, que un `AudioWorklet` es la vía adecuada para reducción de bits/frecuencia y que `OfflineAudioContext` permite reproducir el grafo fuera de tiempo real. Esas propiedades guían el diseño, pero primero se hará un spike del Worklet bajo MV3, MAIN world y la CSP real de la extensión.

## 3. Decisiones de producto por confirmar

El plan usa estos defaults para quedar implementable. Cambiarlos antes de E1 no invalida la arquitectura.

1. **Freeze:** botón momentáneo; al presionar deja de entrar señal nueva al echo y sostiene el contenido del delay; al soltar vuelve suavemente al feedback anterior. No persiste, no se guarda en presets y se cancela al cambiar de pista, resetear o activar bypass.
2. **Teclado:** teclado QWERTY físico tipo FL, no Web MIDI en esta entrega. Filas Z/Q de notas blancas, A/números de sostenidos y duplicados; todas las 45 teclas del mapa suenan. Tiene polifonía acotada, note-off por `keyup`, ADSR y Cut itself. Sólo captura teclas mientras el modo Instrument está activado y el foco no está en un campo editable.
3. **Afinación:** C5 (MIDI 72) es la nota raíz por defecto; Q reproduce el sample original y Z una octava abajo. ←/→ cambian la octava, con desplazamiento visible y reinicio al activar. La transposición usa `detune`/`playbackRate`, por lo que notas agudas duran menos y graves duran más, como resampling clásico. El control de nota raíz queda pendiente, sin time-stretch por nota.
4. **Fuente del instrumento:** snapshot del loop activo con velocidad, Keep Tone, EQ y FX persistentes ya aplicados. Máximo 30 s de audio resultante. El instrumento queda disponible durante la sesión y se conserva en IndexedDB para restaurarlo al reabrir, hasta reemplazarlo o borrarlo.
5. **Pads (decisión 26/09):** ocho. Se conservan índices 0–5 y teclas configurables actuales; se agregan índices 6–7 con el mismo aspecto, en una fila de ocho.
6. **Slices (decisión 26/09):** exactamente ocho divisiones temporales iguales del loop A–B, sin detección de transientes. Se reemplazan los ocho sonidos en orden tras una confirmación explícita; las teclas asignadas se conservan. Cancelar conserva los sonidos anteriores.
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
- Ninguna operación vuelve a descargar o decodificar la misma fuente ocho veces dentro de un batch.
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
engine.setInstrument({ id, buffer, rootMidi: 72, name, revision });
engine.noteOn({ keyId, midiNote, velocity: 1 });
engine.noteOff({ keyId });
engine.triggerPad({ index, velocity: 1 });
engine.stopAll({ releaseMs: 12 });
engine.setMode("pads" | "instrument");
```

Cada voz usa `AudioBufferSourceNode -> GainNode -> sampler master`. `detune = (midiNote - rootMidi) * 100`. La implementación limita a 32 voces y descarta la más antigua al superar ese límite. Ignora `event.repeat` y libera las voces en `blur`, `visibilitychange`, salida del modo, bypass y cambio de pista.

El botón Instrument se ubica junto al botón actual de enviar loop a pad. Flujo:

1. validar loop activo y duración efectiva;
2. capturar identidad/generación/rango/rate/Keep Tone/FX;
3. autorizar una vez;
4. mostrar estado Preparing y permitir cancelar;
5. resolver/decodificar/renderizar una vez en offscreen;
6. persistir el blob y metadatos versionados;
7. devolverlo a MAIN, decodificarlo en el contexto del sampler y activar Instrument sólo si la intención sigue vigente;
8. mostrar nota raíz, octava y ayuda de mapa; Escape sale del modo y devuelve los atajos normales.

Al activar Instrument, pausar el audio activo de SoundCloud si estaba reproduciéndose, antes de preparar el sample o reactivar uno ya cargado. Si ya estaba pausado, no cambiar su estado. No modificar el volumen ni reanudar automáticamente al salir, cancelar o fallar la preparación.

## 7. Slice to pads — implementación 26/09

El botón está en el **header del Sampler**, junto a guardar loop a pad y modo piano. Se habilita con un loop A–B activo y el acceso existente a guardar loops (trial/Pro). No toma la pista completa ni el buffer completo del piano.

Flujo:

1. Capturar selección, identidad/generación de pista, velocidad, Keep Tone y FX persistentes. El EQ maestro sigue vivo; no se hornea dos veces.
2. Mostrar confirmación modal que advierte que reemplaza los ocho sonidos, incluidos samples personalizados. Cancelar/Escape conserva todos los pads y devuelve el foco.
3. Renderizar A–B una vez con el pipeline existente. Máximo 30 segundos a la velocidad elegida, y 12 MiB de WAV preparado agregado.
4. Cortar el WAV PCM16 directamente, manteniendo sample rate/canales y sin ocho descargas ni otro resampling. Las colas de FX posteriores a B se excluyen. Los límites son `floor(totalFrames * i / 8)` y `floor(totalFrames * (i + 1) / 8)`: cobertura completa y diferencia máxima de un frame entre duraciones. Microfades de hasta 3 ms dentro de cada corte.
5. Persistir la preparación sin cambiar `samples`. MAIN verifica que el snapshot sigue vigente y recién entonces solicita commit. Cambiar pista, selección o ajustes, cerrar el panel, perder foco o cancelar durante preparación invalida la operación.
6. Commit de los ocho blobs y receipt en una sola transacción IndexedDB. Todos los claims deben seguir perteneciendo al batch: una carga más reciente en cualquier slot invalida el conjunto. Un error de cuota revierte toda la transacción.

Protocolo: `RENDER_LOOP_SLICES` (count fijo 8), `COMMIT_LOOP_SLICES`, `CANCEL_LOOP_SLICES`. Background valida remitente/owner, rango/duración/generación, track URL y allowlist de FX; resuelve el stream por el puente existente. Offscreen usa `OFFSCREEN_SLICES_BEGIN/RENDER/COMMIT/CANCEL` y guarda firma completa, owner, claims, preparación y receipt. Reintentar el mismo ID no vuelve a reemplazar; cambiar su firma produce conflicto. La cancelación anterior al inicio deja un tombstone. Una vez enviado el commit, ese guardado atómico es el punto de aplicación.

## 8. Persistencia y compatibilidad

Se conserva **IndexedDB v2**: `samples`, `operations` y `claims` ya permiten este batch; no hace falta una migración destructiva ni agregar un store. Validadores aceptan 0–7. Los seis registros previos se conservan sin re-encodear y los nuevos defaults no se escriben sobre muestras personalizadas.

`scripts/sampler-slices.js` contiene la coordinación offscreen. Las operaciones `kind: "slices"` almacenan owner, firma, snapshot y blobs preparados hasta el commit. Preparaciones/receipts tienen vigencia de cinco minutos y se limpian al iniciar otro batch; los samples guardados no caducan. Las preparaciones sobreviven al cierre/reinicio del offscreen. Persistir/restaurar el instrumento piano sigue siendo una tarea distinta.

## 9. UI, interacción y accesibilidad

- FX se organiza en grupos `Space` (Reverb/Echo), `Motion` (Flanger/Phaser) y `Color` (Saturation/Bitcrusher), manteniendo controles compactos de bypass individual.
- Renombrar visualmente Delay a Echo sólo después de conservar claves y migración. Freeze es un botón con `aria-pressed`, instrucciones de mantener pulsado y soporte Pointer + Space/Enter; `pointercancel`, `blur` y pérdida de visibilidad equivalen a soltar.
- Instrument muestra un mensaje breve de modo activo y flechas/octava; la explicación detallada queda sólo en el tooltip del mensaje. Escape sale. Mantener estados de preparación/error.
- Los ocho pads conservan el aspecto actual con número, tecla y nombre abreviado. Mantener carga por hold/Shift+Enter y navegación por teclado.
- Slice informa qué pads reemplazará. La confirmación inicial recibe foco, Escape cancela y el resultado se anuncia por `aria-live`.
- Respetar `prefers-reduced-motion`; no usar parpadeos para indicar nota o freeze.
- Todo texto visible nuevo debe ir a `_locales/en`, `es`, `de`, `ru` y `pt_BR`; eliminar strings ingleses inline del flujo tocado.

## 10. Acceso y seguridad

Agregar operaciones versionadas, por ejemplo `prepare-instrument` y `slice-loop-to-pads`, a la política y al cliente. La propuesta comercial de la sección 3 debe confirmarse antes de tocar la matriz. Una autorización cubre un snapshot/batch, no cada slice ni cada nota.

Validaciones obligatorias en background/offscreen:

- remitente de la extensión y página SoundCloud permitida;
- identidad/generación/rango coherentes;
- count sólo 8 e índices 0–7;
- FX normalizados con allowlist, nunca objetos arbitrarios;
- duración efectiva, bytes base64/blob, nombre y operation ID acotados;
- URLs resueltas por el pipeline existente, no aceptadas desde MAIN como autoridad;
- idempotencia por firma completa: reutilizar un ID con otra firma devuelve conflicto.

## 11. Etapas de implementación

### E0 — Baseline y decisiones

Confirmar sección 3. Registrar HEAD/diff y ejecutar verificadores actuales de FX, loop, tempo, pads, policy, background, offscreen y paquete. Crear fixtures de impulso, seno, ruido y transiente. Medir nivel seco, tails, CPU y memoria. Hacer el spike mínimo de AudioWorklet en el contexto real de la extensión y documentar URL/CSP/ciclo de vida.

Salida: defaults cerrados, baseline verde o fallos preexistentes clasificados, Worklet viable y presupuesto de audio acordado.

### E1 — Extracción y contratos

Crear `sampler-core`, `sampler-engine` y normalizador FX v2. Separar mensajes/persistencia de pads de la UI. Mantener comportamiento visible actual. Agregar tests puros de notas, voces, slices, schema y conservación de los seis slots.

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

### E5 — Sampler engine y 8 pads

Conservar los seis slots previos y ampliar a ocho en IndexedDB, UI y validadores; cualquier migración sólo añade metadatos/stores. Sustituir `playDrum` por el motor de voces. Mantener carga de archivo, teclas editables y loop-to-pad. Añadir stop/release y manejo de foco.

Salida: regresión funcional completa del sampler actual sobre el motor nuevo.

### E6 — Instrument

Añadir preparación/persistencia, botón, modo QWERTY, mapa cromático, raíz/octava, polifonía, cancelación y pausa de la fuente al entrar. Comprobar carreras de cambio de loop/pista y restauración después de reload.

Salida: loop activo tocable en notas con latencia estable y sin bloquear escritura/atajos fuera del modo.

### E7 — Slice to pads

Implementar cálculo por frames, render único, microfades, batch atómico, confirmación de overwrite, progreso/cancelación e idempotencia. Probar 8 cortes y fallos en fetch, render, cuota y commit.

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
- compatibilidad mantiene pads 0–5, admite los nuevos 6–7 y las operaciones idempotentes sobreviven reinicio del service worker;
- batch cancela sin escrituras y fallo de cuota no toca datos anteriores;
- exportación y loop-to-pad incluyen FX persistentes nuevos.

### E2E/UX

- Pointer, teclado y accesibilidad de Freeze;
- QWERTY note-on/off, foco editable, Escape, blur y combinaciones del navegador;
- 8 pads en 420 px y viewport angosto;
- confirmación y anuncio de overwrite;
- Free/trial/Pro según matriz confirmada;
- cinco locales sin claves faltantes;
- paquete limpio contiene Worklet y módulos, y no contiene fixtures/debug adapters.

## 13. Criterios de aceptación y presupuestos

- Activar cualquier efecto con audio reproduciéndose no interrumpe perceptiblemente la pista ni crea otra fuente para el mismo media element.
- Ningún sample es NaN/Infinity; pico final ≤ 0 dBFS y sin crecimiento sostenido con feedback máximo.
- Freeze puede mantenerse 60 s y soltarse sin salto evidente ni audio de la pista anterior.
- Note-on responde en el mismo gesto una vez cargado; objetivo inicial de latencia de scheduling ≤ 20 ms en la máquina de prueba, reportando hardware/browser.
- Treinta y dos voces y 8 pads no producen crecimiento continuo de nodos después de `stopAll`.
- Los 8 slices concatenados reproducen el mismo número total de frames que A–B transformado, con las rampas de borde dentro de cada slice y sin tails posteriores a B.
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

Cada etapa queda detrás de una constante de feature local hasta completar su gate. Esta entrega conserva schema v2: desactivar UI nueva no elimina blobs. Si una nueva rama FX falla, el normalizador conserva valores pero su wet efectivo se fuerza a cero y la ruta seca continúa. Si Instrument/Slice falla, el loop, los seis pads históricos y loop-to-pad tradicional siguen operativos.

La entrega final debe incluir: código, migración, tests, actualización de manifest/package/locales/ayuda, informe breve de mediciones y QA audible. No incluye commit, push, publicación en Chrome Web Store, cambio de precio ni deploy de servicios salvo pedido separado.

## 16. Verificaciones de esta entrega

- `node scripts/verify-sampler-core.js`: límites por frames, cobertura completa, estéreo, microfades y exclusión de tails posteriores a B.
- `npm run test:e2e:slices`: Chromium + audio sintético e IndexedDB real; render único, contenido de A–B, conservación v2, commit atómico, cancelación antes/durante preparación, owner/firma, claims, rollback de cuota y restauración de preparación tras recarga.
- `npm run test:e2e:tempo`: ocho pads, botón en el header, confirmación/Escape, conservación de teclas y cancelación sin commit, más regresiones existentes de piano/FX/loops.
- QA audible manual en SoundCloud real sigue siendo gate previo a publicación.

Validación de cierre (26/09): `npm test` pasó sus 51 verificaciones; también pasaron `test:e2e:tempo` (incluido cambio de FX durante preparación y preservación de los ocho pads al resetear), las tres variantes de `test:e2e:effects` y `test:player-tools` (34 tests del servicio). El paquete local se generó con la configuración de pruebas existente y pasó su smoke estático, incluyendo los dos WAV nuevos y `sampler-slices.js`. No se realizó publicación ni QA audible manual.
