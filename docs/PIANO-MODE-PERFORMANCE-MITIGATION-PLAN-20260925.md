# Piano mode: mitigación de rendimiento y ciclo de vida

Fecha: 25/09/2026. Base inspeccionada: `cd8fd3c`.
Estado: **plan técnico; las mitigaciones todavía no están implementadas**.
Alcance original: documentar el plan. Auditoría posterior: validar los hallazgos y ampliar la evidencia, sin implementar mitigaciones ni crear commits. La implementación se divide en etapas verificables.

## 1. Objetivo y límites

Resolver los cinco hallazgos de la revisión del instrumento sin cambiar su comportamiento musical acordado:

- seis pads, sin ampliaciones;
- mapa físico tipo FL de 45 teclas, Q = C5/sample original y notas duplicadas acordadas;
- instrumento monofónico con resampling, flechas para desplazar octavas de −4 a +3;
- pausa de la pista al entrar y ninguna reanudación automática al salir;
- mensaje breve traducido, explicación sólo en tooltip y nota activa a la derecha;
- conservar autorizaciones, límites de 30 s/12 MB y compatibilidad de descarga/loop-to-pad.

No incluye polifonía, MIDI, nueva persistencia del instrumento, cambios comerciales, publicación ni migración a React. La UI actual es DOM directo: no hay re-renders de componentes React que optimizar.

## 2. Evidencia y prioridades

| ID | Hallazgo | Evidencia actual | Prioridad |
| --- | --- | --- | --- |
| P1 | Cancelar no detiene el pipeline | `disableInstrument()` invalida la intención, pero no envía cancelación; `OFFSCREEN_INSTRUMENT_RENDER` tiene un controlador que MAIN no puede abortar | Alta |
| P2 | Actualizaciones redundantes en reposo | Intervalo de 250 ms → `readLoopState()` → `renderLoop()`; éste reescribe controles y llama a `drawWaveform()` aunque no cambien datos | Media |
| P3 | Nota pendiente revive después de detener/cambiar octava | `playInstrumentNote()` espera `resume()` y sólo vuelve a comprobar modo/buffer; prueba controlada de la revisión produjo una voz después de stop | Alta |
| P4 | La voz continúa al perder foco/visibilidad | Los handlers de blur/visibility actuales liberan Freeze, no la voz del instrumento | Alta |
| P5 | Caché incompleta | `loopMatchesInstrumentSnapshot()` compara pista/generación/rango, pero no rate, Keep Tone ni FX | Alta |

Por nota no se reconstruye el panel: se cambia el indicador y se crean los nodos de esa voz. No se demostró una fuga de memoria ni se midió CPU/RAM en SoundCloud real. La falta de `disconnect()` explícito merece cleanup, pero no demuestra por sí sola una fuga.

La cola `queueSingleDownload()` ya serializa trabajos: P1 puede acumular **trabajos pendientes y espera**, no implica necesariamente renders simultáneos. No modificar su concurrencia global para solucionar el instrumento.

### 2.1 Revalidación del 25/09/2026

Código auditado: **`7e32a88`**, con árbol limpio al comenzar. Las líneas siguientes corresponden a esa revisión; las rutas de producción están bajo `scripts/`. Los cinco hallazgos son reales, pero la evidencia distingue defectos funcionales, trabajo redundante y decisiones de comportamiento. No hay mediciones de CPU, memoria nativa o latencia audible que permitan cuantificar su impacto en SoundCloud real.

| ID | Veredicto y evidencia contrastada | Viabilidad |
| --- | --- | --- |
| P1 | **Confirmado.** `tempo-control-main.js:414` sólo invalida estado local; `requestPad()` (`:289`) conserva la promesa/timer hasta respuesta o 120 s. `content.js:146` no enruta cancelación de instrumento; `background.js:544` tampoco la recibe. `bulk-job-manager.js:1190` continúa resolución/cola/retries y `offscreen.js:140` crea un controlador sin cancelación externa. El reproductor sí descarta la respuesta vieja: el bug no es una activación tardía después de cancelar una preparación ya registrada. | Corregible con E3; la UI puede terminar inmediatamente, el procesamiento nativo ya iniciado no necesariamente. |
| P2 | **Confirmado como trabajo redundante, no como alto consumo medido.** Polling en `tempo-control-main.js:3102`, lectura y render incondicional en `:990`, escrituras de controles en `:1193`. `drawWaveform()` (`:1127`) **ya retorna si la waveform está colapsada**; no tiene guard de panel cerrado/documento oculto. Por tanto no es cierto que haya draws en todos los estados, aunque sí se reescriben controles. | Corregible con E4; medir antes de escoger overlay/otra capa y antes de atribuir mejoras de CPU. |
| P3 | **Confirmado con ejecución controlada.** `playInstrumentNote()` (`:484`) espera `resume()` y sólo revisa capacidad/modo/buffer. `stopInstrumentVoice()` (`:375`) no invalida esa espera. Nota → stop de octava → resolver resume inicia una voz; tres notas pendientes inician tres fuentes. | Corregible en E1 con revisión por solicitud y revisión al detener. |
| P4 | **Confirmada la ausencia de salida.** Los únicos listeners de blur/visibility (`tempo-control-main.js:2714`) llaman a `releaseEchoFreeze`; no detienen voz ni apagan modo y no hay handler de `pagehide`. Una fuente ya iniciada no recibe `stop()` por estos eventos. Que el navegador suspenda audio por su cuenta depende de su política. Apagar también el modo y conservar caché es la decisión propuesta en §7, no una garantía que ya existiera. | Corregible en E1, con validación de foco/visibilidad en navegador. |
| P5 | **Confirmado con ejecución controlada.** Comparación en `tempo-control-main.js:406` y reutilización en `:432`: rate/Keep Tone/FX no participan. Cambiar esos valores y reactivar usa el buffer anterior sin request. Los call sites de cambios/render (`:2845–2947`) no agregan la invalidación faltante. También falta `durationMs`, usado por el request. | Corregible en E2; compartir descriptor entre firma y request es necesario. |

### 2.2 Casos adicionales confirmados

Se agregan como variantes de P1, porque comparten su causa y su corrección; no se inflan los cinco hallazgos con IDs duplicados.

- **P1.a — Doble preparación durante autorización.** En `toggleLoopInstrument()` el guard de `instrumentPreparing` está antes del `await authorizePlayerTools()` (`:430`), pero la bandera se activa recién en `:454`. Dos clics mientras la autorización está pendiente pasan ambos guards y, al autorizar, emiten **dos requests de render**. El segundo no cancela al primero. Reproducción controlada: dos invocaciones, una autorización diferida, resolver ambas → dos mensajes `instrument`. E3 debe registrar la intención antes del await; probar que el segundo clic cancela sin emitir trabajos.
- **P1.b — Cerrar durante autorización permite activar modo con panel oculto.** `closePanel()` (`:2391`) sólo cancela si `instrumentPreparing` o `instrumentMode` ya están activos. Durante autorización ambos son falsos. Resolver autorización y render después del cierre deja `ui.panel.hidden === true` e `instrumentMode === true`. También puede pausar la pista después del cierre si estaba reproduciéndose. La reproducción automatizada demuestra panel oculto/modo activo; el efecto de pausa se deriva del call site `:445–446`. E1/E3 deben invalidar también la autorización pendiente y comprobar panel/sesión antes de continuar. El código actual no valida eso después del await.

### 2.3 Comprobaciones contra falsos positivos

- **Escape sin reentrada no revive una nota:** el guard de modo tras `resume()` evita ese caso. P3 requiere stop que conserve modo (octava), o salir/reentrar antes de resolver, o reemplazar buffer/sesión. Mantener Escape como prueba de regresión, no presentarlo como reproducción aislada del bug actual.
- **No se confirmó acumulación de listeners por remount SPA.** `mount()` (`:2999`) usa `ui?.host || createUi()` y reutiliza el host aunque lo haya removido. Que los listeners estén dentro de `createUi()` no demuestra que se registren otra vez en cada remount. La recomendación de §7 es preventiva; no requiere refactor obligatorio sin una reproducción adicional.
- **No se confirmó una fuga de nodos.** Falta cleanup explícito, pero eso no demuestra retención indefinida por el navegador. La prueba de `start()` fallido sigue siendo una prueba de robustez, no evidencia de una fuga medida.
- **No todos los bucles PCM carecen de yields.** `loop-audio-renderer.js`, en `renderPreserved()`, ya cede con `setTimeout(..., 0)` cada 256 bloques. Inspeccionar y medir las otras etapas; no agregar un Worker o duplicar yields por asumir que todo el render bloquea sin pausas.
- La prueba de navegador existente usa un bridge de render simulado para la UI; que pase no certifica la cancelación a través de background/offscreen ni estas carreras.

### 2.4 Evidencia reproducible y límites

Ejecutado en esta auditoría:

- `node scripts/audit-piano-mode.js`: **6 escenarios reproducidos** (P1, dos variantes de P3, P5, P1.a y P1.b). El script extrae y ejecuta las funciones reales de MAIN, con autorización/resume/transporte/audio controlados. No copia una implementación alternativa de esas funciones ni modifica producción. Es una **caracterización de defectos**, fuera del gate `verify-*`: después de corregirlos sus aserciones deben reemplazarse por expectativas de comportamiento correcto. No mide audio real ni demuestra el aborto del fetch remoto.
- `npm run test:e2e:tempo`: **pasó** en Chromium headless, incluida la cobertura existente de piano, mapa de notas, octavas, idiomas y reutilización del buffer.

P2/P4 se confirman por flujo de código; quedan pendientes los contadores de DOM/canvas, la reproducción de blur/hidden con audio real y el perfil de rendimiento de E0/E5. No se ejecutó la batería completa de release: esta entrega cambia documentación y agrega el reproductor de auditoría, sin cambiar el código de producción. No se requiere publicación para corregir los hallazgos en una rama local.

## 3. Contratos compartidos

Separar tres identidades; ninguna sustituye a las otras:

1. **Preparación:** `operationId` identifica el trabajo de background/offscreen; una revisión local invalida respuestas antiguas.
2. **Contenido:** `sourceSignature` identifica exactamente el audio procesado capturado.
3. **Interpretación:** `noteRevision` invalida note-ons pendientes, incluso cuando modo y buffer no cambian.

Estado objetivo conceptual:

```text
idle → authorizing → preparing → ready → active
          │             │         │       │
          └── cancel ───┴─────────┴───────┘ → idle o ready sin voz

active + blur/hidden → ready, modo apagado, buffer reutilizable
ready/active + cambio de firma → idle, buffer invalidado
```

`ready` significa buffer válido con modo apagado. Escape/cierre conservan un buffer válido, pero invalidan notas pendientes. Cambiar pista/rango/procesamiento descarta el buffer. Activar de nuevo comienza en octava 0.

Toda terminación debe ser idempotente. Las respuestas viejas no pueden apagar una preparación nueva, borrar su mensaje ni cancelar su voz. No mantener AudioBuffer/Blob/base64 en logs ni en registros de operaciones ya terminadas.

## 4. P1 — Cancelación de preparación de extremo a extremo

### Cambios

Archivos: `tempo-control-main.js`, `content.js`, `background.js`, `bulk-job-manager.js`, `offscreen.js`; inspeccionar y ajustar propagación en `download-core.js` y `loop-audio-renderer.js` sólo donde falten controles.

1. En MAIN registrar una preparación única **antes del primer await de autorización**. Capturar la identidad/rango y revisión. Un segundo click cancela esa intención; no inicia una autorización/render paralelo. Volver a validar la revisión después de autorizar.
2. Guardar `operationId`, firma y estado de la preparación actual. Escape, cierre, cambio de pista/rango/FX, pérdida de acceso, blur/hidden y timeout invalidan inmediatamente la intención y solicitan cancelación si se despachó un trabajo.
3. Añadir mensajes dedicados propuestos: acción MAIN `cancel-instrument`, request de extensión `CANCEL_LOOP_INSTRUMENT` y mensaje `OFFSCREEN_INSTRUMENT_CANCEL`. No reutilizar `cancelPadOperation()`: consulta un registro persistido de pads que el instrumento no crea.
4. Background valida sender como hoy y asocia la operación a `tabId`, `frameId` y, cuando esté disponible, `documentId`. El ID enviado por MAIN no es prueba de propiedad. Una pestaña no puede cancelar la operación de otra. Cancelar un trabajo propio no requiere una nueva autorización Pro, incluso si el acceso acaba de expirar.
5. Registrar la operación antes de resolver la pista o entrar en la cola. Rechazar reutilización conflictiva del ID; una petición duplicada idéntica comparte el resultado. El paso en cola comprueba cancelación antes de resolver URL y antes de enviar a offscreen. Una operación cancelada no empieza el render cuando llega su turno.
6. En offscreen usar un registro coherente de operación (`controller`, `promise`, estado y lector si existe). El handler de cancelación debe ejecutarse fuera de la cola de renders y abortar la operación exacta. Revisar el registro actual para que la instalación de `promise` y `controller` no sobrescriba información ni deje entradas tras una terminación temprana.
7. Pasar el signal a fetch/retries y comprobarlo entre etapas: resolución, descarga, decode, transformación, FX, codificación y respuesta. AbortError/cancelación no deben provocar reintentos de URL expirada ni mensajes genéricos de fallo.
8. Añadir cancelación al lector base64 si está trabajando. Liberar referencias y timers en `finally`, pero no borrar una entrada nueva que haya reemplazado a la misma operación.
9. Resolver y retirar la promesa pendiente en MAIN al cancelar; limpiar su timer de 120 s. Las respuestas posteriores se ignoran por ID/revisión. No esperar a offscreen para apagar el modo o limpiar la UI.

### Límites reales

`fetch` acepta AbortSignal. `decodeAudioData()` y `OfflineAudioContext.startRendering()` no ofrecen ese contrato de cancelación. Si una etapa nativa ya comenzó, marcarla obsoleta, esperar su terminación y **no continuar** hacia otra etapa ni publicar su resultado. No cerrar el documento offscreen compartido para interrumpirla: puede atender descargas/pads ajenos.

Los bucles PCM síncronos con checks no reciben mensajes nuevos mientras bloquean el event loop. Medir su duración; si superan el presupuesto de tareas largas, dividirlos en bloques con yields que permitan procesar cancelaciones. Un `await Promise.resolve()` repetido no es una garantía de atender mensajes. Moverlos a Worker sólo si el perfil lo justifica.

La cola debe conservar el trabajo nativo todavía activo hasta que realmente termine; resolver la cancelación de UI no debe liberar artificialmente el cupo de procesamiento.

### Carreras y reinicios

- Cancel antes del dispatch: sólo invalidar intención; no crear operación.
- Cancel recibido durante dispatch: registrar la cancelación antes de permitir el siguiente paso. Si se necesitan tombstones para mensajes fuera de orden, limitar cantidad y TTL.
- Tras reinicio del service worker: reconstruir/verificar ownership con metadatos guardados por background en almacenamiento de sesión o por el offscreen vivo, nunca con ownership aportado por MAIN. Elegir la opción compatible con el lifecycle existente en E0.
- IDs desconocidos devuelven resultado terminal sin crear renders ni filtrar operaciones de otro propietario.
- Keepalive y contadores de descargas se liberan cuando termina realmente el trabajo; no cerrar offscreen mientras otros consumidores lo usan.

### Pruebas y aceptación

Cancelar durante autorización, cola, fetch, decode, FX y conversión base64; cancelar dos veces; cancelar desde otra pestaña; respuesta tardía; reinicio del worker; 20 secuencias activar/cancelar.

Aceptar cuando la UI se cancela sin esperar trabajo nativo, fetch recibe abort, ningún trabajo cancelado en cola empieza a descargar, no hay retries después de cancelar y registros/timers vuelven a baseline al terminar las etapas no abortables. Una descarga o pad concurrente debe continuar intacto.

## 5. P2 — Separar estado, render y playhead

### Cambios

Archivos principales: `tempo-control-main.js` y verificadores de tempo/loop.

1. Mantener lectura y validación de estado separadas del dibujo. No eliminar la detección de cambio de pista/generación ni la invalidación de instrumentos para ahorrar renders.
2. Construir un modelo pequeño de presentación y comparar campos antes de mutar el DOM. Incluir disponibilidad, rango, duración, capacidad, preparación/descarga, selección, zoom y estados de controles. La comparación no debe depender sólo de `currentTimeMs`.
3. Separar actualizaciones de controles, waveform estática y playhead. Canvas estático se invalida por samples, tamaño/DPR, rango, zoom o preview; el avance de playback actualiza sólo el playhead mediante overlay o capa dedicada.
4. Agrupar invalidaciones visuales en un único `requestAnimationFrame` pendiente. No crear un loop RAF perpetuo para una pista pausada. Drag/resize siguen siendo fluidos y el primer frame al abrir muestra el estado más reciente.
5. Con panel cerrado, waveform colapsada o documento oculto: no dibujar esa superficie. Mantener los datos al día; renderizar una vez al volver a mostrarla.
6. Conservar inicialmente el polling de 250 ms como fallback de sincronización, pero hacer que un estado idéntico cause **cero escrituras/canvas draws**. Recién con evidencia de cobertura de eventos, evaluar reducir/suspender polling oculto y resincronizar al volver.
7. Evitar escrituras repetidas del indicador de nota si su valor no cambió. En reemplazo de voz, pasar directamente de nota anterior a nueva nota; limpiar sólo cuando no quede voz vigente. Mantener guard por identidad en `onended` para que una voz vieja no borre la nueva.
8. Mover tablas inmutables de nombres/puntuación fuera del handler; mejora menor, no criterio principal de éxito. Mantener estilos estables para que el indicador no desplace el texto.

### Pruebas y aceptación

Instrumentar por separado commits visuales, canvas estático, playhead y mutaciones de `.playing-note`.

- Tras el primer render, 10 s en pausa con estado estable: cero redibujos estáticos y cero escrituras de controles causadas por polling.
- Tocar notas no redibuja waveform ni reconstruye controles; sólo indicador y audio.
- Un lote de invalidaciones produce como máximo un commit por frame.
- Zoom, drag, resize, fin de descarga, pérdida de acceso y cambio de pista sí actualizan lo necesario.
- Panel cerrado/pestaña oculta: cero draws de canvas; reapertura correcta sin clicks extras.
- Playback activo mantiene playhead y loop correctos; no exigir que quede a cero el trabajo que representa avance real.

## 6. P3 — Invalidación de note-ons y cleanup de voces

### Cambios

Archivos: `tempo-control-main.js`, helpers puros en `sampler-core.js` sólo si aportan prueba/reutilización. No extraer todo el motor como requisito.

1. Introducir `noteRevision`. Incrementarla en cada note-on nuevo y en cada stop por cambio de octava, salida, blur/hidden, invalidación de buffer, reset o pérdida de acceso.
2. Capturar revisión, buffer e identidad de sesión al solicitar la nota. Tras cualquier await verificar que siguen vigentes, que hay acceso, que modo/panel siguen activos y que el documento no está oculto. La última nota solicitada gana cuando varias esperan activación.
3. Si AudioContext está `running`, crear la voz en el mismo gesto sin await. Si necesita resume, compartir una sola promesa pendiente y limpiarla en `finally`; cada solicitante hace su propia validación después. Un rechazo viejo no debe sobrescribir el estado/error de una sesión nueva.
4. Separar `invalidatePendingNotes()` de la liberación de la voz anterior. El note-on válido debe poder reemplazar la voz previa sin invalidar su propio token por llamar a un stop público.
5. Mantener un AudioBufferSourceNode y GainNode por disparo, necesarios para la reproducción. Release corto para reemplazo/stop; registrar temporalmente voces en release para poder limpiarlas también al desmontar.
6. Cleanup idempotente al terminar: desconectar source/gain, retirar handlers y referencias. Usar identidad de voz antes de limpiar el indicador. Si `start()` falla, limpiar también los nodos creados y no dejar una voz ficticia activa.
7. Conservar el AudioContext compartido con pads. No cerrarlo o suspenderlo al salir del instrumento mientras otro pad pueda estar sonando.

### Pruebas y aceptación

Usar una promesa de resume controlable: nota→octava, nota→Escape, nota→salir/reentrar, nota→cambio de buffer y ráfaga de tres notas antes de resolver. No debe sonar ninguna nota invalidada; en la ráfaga sólo arranca la última vigente.

Con contexto activo, note-on no espera resume. Verificar rechazo de resume/start, repeat ignorado, sostenidos, las 45 teclas y todo el rango de octavas. Después de `ended`/release no quedan voces registradas; un `ended` antiguo no borra la nota actual. Medir memoria antes de atribuir una fuga al grafo.

## 7. P4 — Salida por foco y visibilidad

### Decisión de comportamiento

Blur de ventana, documento oculto y `pagehide` apagan modo piano, invalidan note-ons y liberan voces. El buffer listo puede conservarse para reactivar rápido si su firma sigue vigente. Volver a la ventana no activa modo ni sonido automáticamente. Preparación en curso se cancela mediante P1. La pista de SoundCloud permanece pausada.

### Cambios

- Una función central de salida con motivo, política de conservar buffer y cancelación de preparación.
- Integrar Escape, cierre, cambio de pista, reset, revocación de acceso y desmontaje; blur/hidden usan la misma política y cleanup.
- Registrar listeners globales una sola vez, fuera de la creación repetible de UI, o retirarlos explícitamente. Verificar remount SPA sin handlers acumulados ni closures de UI anterior.
- Mantener los guards de campos editables, Ctrl/Cmd/Alt y composición. Enfocar un campo no es equivalente a perder foco de ventana.
- El tooltip/foco dentro del panel no debe apagar el instrumento. Un evento de salida no puede reanudar el track ni detener pads independientes.

### Pruebas y aceptación

Blur/hidden durante nota, resume pendiente y preparación; eventos repetidos; volver al sitio; 20 remounts; pad sonando junto con instrumento. Modo apagado e indicador vacío tras salida, ninguna voz tardía, buffer válido reutilizable y ningún listener adicional por remount.

## 8. P5 — Firma de contenido completa y determinista

### Modelo

Crear un builder puro de descriptor con campos explícitos:

```text
signatureVersion
trackIdentity + generation
startMs + endMs + durationMs usado por el render
effectiveRate + preservePitch
effects.schemaVersion + bypassed
parámetros persistentes normalizados de reverb/delay/flanger/phaser/crusher/saturation
EQ normalizado (bandas, activación y valores efectivos)
```

Derivar la allowlist de los parámetros realmente consumidos por el renderer, incluyendo parámetros avanzados y defaults. No serializar ciegamente `effectsController.snapshot()`: contiene disponibilidad, reason e initialized, que no representan contenido musical.

Excluir Freeze efímero, octava de interpretación, nota activa, foco, UI expandida y etiquetas de preset. El buffer original no se vuelve a renderizar por cambiar octava. Usar orden fijo y números normalizados; la comparación por cadena canónica es suficiente, no se necesita hash criptográfico. Normalizar una vez por cambio de fuente, no por tecla.

### Cambios

1. Capturar un descriptor inmutable tras autorización vigente. El request de render y su firma deben salir del **mismo descriptor**, evitando snapshots separados que puedan divergir.
2. Reutilizar sólo un buffer cuya firma completa coincide con el estado musical actual.
3. Tras aplicar un cambio autorizado de rate, Keep Tone, FX persistentes, EQ o bypass, invalidar caché, detener modo/voz y cancelar preparación obsoleta. Hacerlo al aplicar el valor, no al comenzar una autorización que puede fallar.
4. Los cambios continuos de slider invalidan una vez y no generan renders automáticos. El usuario reactiva con el botón cuando termina de ajustar.
5. Revalidar revisión/firma después de render y después de decode en MAIN. Un resultado obsoleto se descarta antes de activar el modo o reemplazar buffer.
6. Conservar sólo un buffer actual. No introducir caché ilimitada por combinación de FX. Background sigue validando todos los datos: la firma de MAIN no concede autoridad.

### Pruebas y aceptación

Cambiar individualmente rate, Keep Tone, cada efecto y parámetro avanzado, EQ y bypass: invalidar firma y preparar audio nuevo al reactivar. Valores equivalentes normalizados deben reutilizar buffer. Freeze, octava, tooltip, nota y nombre de preset sin cambio de valores no invalidan. Cambiar ajustes durante render/decode nunca activa el resultado anterior. Probar reset y cambios recibidos de storage además de controles visibles.

## 9. Orden de ejecución y entregables

| Etapa | Trabajo | Salida verificable |
| --- | --- | --- |
| E0 | Baseline, contadores de diagnóstico, contratos de operación/firma y estrategia de ownership tras reinicio | Casos reproducibles; métricas sin inventar; decisiones documentadas |
| E1 | P3 + P4, revisiones de nota y salida centralizada | Ninguna voz tardía; cleanup y foco correctos |
| E2 | P5, builder de firma y hooks de invalidación | Buffer siempre coherente; sin renders por sliders/octavas |
| E3 | P1, protocolo y propagación de cancelación | Cancelación efectiva por etapa; cola/ownership/lifecycle seguros |
| E4 | P2, comparaciones y dibujo selectivo | Reposo sin commits redundantes y waveform estable |
| E5 | Regresión cruzada y perfil audible real | Informe antes/después y gates cerrados |

E1/E2 pueden invalidar inmediatamente mientras E3 agrega la interrupción del trabajo externo. No marcar P1 resuelto antes de E3. Mantener commits pequeños por etapa; evitar una reescritura general del panel.

## 10. Verificación y presupuestos

Extender verificadores existentes: `verify-sampler-core.js`, `verify-tempo-browser.js`, `verify-loop-background-routing.js` y pruebas del renderer/offscreen. Agregar pruebas específicas de cancelación/firma si los actuales no tienen cobertura adecuada. Los nuevos `verify-*.js` locales se incorporan automáticamente a `run-verifications.js`; los tests que lancen navegador deben ubicarse/invocarse conscientemente según su lista de exclusiones.

Comandos de gate: `npm test`, `npm run test:e2e:tempo`, `npm run test:e2e`, `npm run test:e2e:effects`, `npm run test:player-tools`. Si se agregan módulos/recursos de producción, actualizar manifest/empaquetado y ejecutar `npm run test:package` sobre un artefacto actualizado. No publicar.

Perfil reproducible en Chromium: registrar versión, OS, hardware, sample rate, canales, duración del loop y FX. Comparar HEAD base y candidato, con contexto de audio caliente y DevTools cerrado durante la medición de latencia. Tomar al menos tres ejecuciones equivalentes.

Escenarios: reposo pausado 60 s; interpretación de 10 notas/s durante 60 s; 100 activar/salir; 20 preparar/cancelar; 20 remounts; loop de 30 s con FX; pestaña oculta y vuelta. La ráfaga sintética mide carga, no sustituye tocar y escuchar.

Registrar p50/p95 de keydown→`source.start()` (scheduling, no latencia acústica), número de resumes, renders, requests, nodos/voces activas, cancelaciones por etapa y tareas largas. Objetivo inicial: p95 de scheduling ≤20 ms en máquina de referencia, sin tareas de >50 ms atribuibles al handler de notas. No congelar cifras de CPU/RAM sin baseline.

Memoria: medir heap y registros de recursos después de calentamiento y de ciclos iguales; comprobar que voces/timers/operaciones regresan al estado esperado. La memoria nativa de audio no queda descrita por el heap JS. Documentar el buffer único retenido intencionalmente y evitar confundirlo con fuga. Nunca exigir liberación inmediata por GC.

Los contadores son de test/desarrollo: no registrar cada tecla en producción ni agregar telemetría. Verificar los cinco idiomas, tooltip, indicador de nota, pads y ausencia de reanudación accidental del track.

## 11. Rollback y cierre

Rollback por etapa mediante revert del commit concreto. No cambia IndexedDB ni borra samples. Revertir en conjunto ambos extremos de cualquier protocolo nuevo; una cancelación no soportada debe seguir invalidando localmente y descartando resultados viejos sin romper playback.

Cerrar cada P1–P5 sólo con sus pruebas y evidencia. Entrega final de implementación: commits, resultados de comandos, reporte de perfil con límites, QA audible y actualización de este documento. No afirmar cancelación instantánea de decode/render nativo ni ausencia de fugas sólo porque pasen unitarios.

## 12. Documentación consultada

Consulta mediante skill Context7, biblioteca `/mdn/content` (MDN Web Docs), el 25/09/2026. La distinción entre abortar fetch y descartar trabajo nativo informa específicamente P1:

- [Abortar fetch con AbortController](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#canceling_a_request).
- [BaseAudioContext.decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData): recibe datos/callbacks, no un AbortSignal.
- [OfflineAudioContext.startRendering](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/startRendering): inicia render y entrega su resultado, sin argumento AbortSignal.

Las propuestas de revisiones, firmas, cola y render selectivo se basan en los call sites del repositorio; son decisiones de diseño, no garantías medidas del navegador.
