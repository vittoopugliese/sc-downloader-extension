# Stems estilo FL Studio: Browser, ventanas, EQ por canal y Channel Rack — 2026-10-17

Resumen de todo lo implementado en las sesiones del 16 y 17/10/2026 sobre la
página de Stems (`stems.html`). El plan de origen, con la evidencia técnica y las
decisiones, está en [stem-browser-channel-rack-plan.md](stem-browser-channel-rack-plan.md).
El uso de presets y del Piano Roll anterior sigue en [stem-presets.md](stem-presets.md).

Estado: implementado y probado en Chromium de Playwright. No probado todavía en
el Chrome del usuario ni publicado.

## Commits

| Commit | Contenido |
| --- | --- |
| `cc9970f` | Browser de samples flotante, preview y arrastre a la Playlist. |
| `f7a4bf0` | Waveform espectral en el Browser, preview desde el punto con clic derecho; se quitó la nota de calidad. |
| `6071e42` | Channel Rack, Piano Roll, EQ y Grabadora como ventanas estilo FL. |
| `a45d5cd` | Botones naranjas de ventanas, ventanas maximizables, ediciones de clips sin cortes de audio. |
| `6f78900` | EQ por canal (insert del mixer) más el EQ Master. |
| `517c5a1` | Clear All de cortes y dropdowns tipo Player Tools con borrar. |
| `90e2993` | Las pistas conservan su sample como instrumento al quitar clips. |
| `ee559fc` | Los samples importados se guardan con la separación. |
| `06f3867` | Channel Rack con vistas Channel Rack y Chops, modo One-shot con nota raíz. |

## Uso

### Botones de ventanas y atajos

En la barra de transporte, junto al tacho, el gamepad y la descarga, hay cinco
botones naranjas, más FXs. Las herramientas de la Playlist volvieron a 7 + 7.

| Ventana | Tecla |
| --- | --- |
| FXs del Master | F4 |
| Channel Rack | F6 |
| Piano Roll | F7 |
| Browser de samples | F8 (B también, con el foco en la Playlist) |
| EQ paramétrico | F9 |
| Grabadora | F10 |

- Como en FL Studio, la tecla trae al frente una ventana tapada; si ya está
  adelante, la cierra.
- Cada ventana se mueve desde el título y cambia de tamaño desde la esquina.
- Botones del título: acoplar debajo de la Playlist / soltar, maximizar /
  restaurar, cerrar. Doble clic en el título maximiza. Escape cierra.
- Posición, tamaño, acople y maximizado se recuerdan al recargar.
- Al agrandar o maximizar, el gráfico del EQ, la toma de la Grabadora y el Piano
  Roll crecen en alto.
- Los menús ⋮ de cada pista abren el Channel Rack, el Piano Roll o el EQ de ese
  canal.

### Browser de samples

- Elegís una carpeta raíz (permiso de solo lectura). Se recuerda; si Chrome
  revoca el permiso, se reconecta con un clic.
- Navegación por subcarpetas, ruta relativa, volver atrás (Retroceso) y
  actualizar. Las carpetas grandes se leen por partes y la lista se virtualiza.
- Clic en un archivo lo escucha. En la waveform: clic reproduce desde el inicio,
  clic derecho desde ese punto. Espacio reproduce o detiene.
- La waveform usa los colores por frecuencia del resto de la app.
- Arrastrar a una pista lo importa en esa posición, con snap. Enter lo agrega en
  el cursor.
- La preview suena aparte: no entra en la mezcla, la exportación ni la Grabadora.

### Channel Rack

Dos vistas, elegidas con las pestañas de arriba:

- **Channel Rack**: una fila por cada sample cargado: los stems, el sample de
  cada pista de usuario y los samples importados aunque no tengan clips. Todas
  las filas se secuencian en el mismo patrón, como en FL Studio. Cada fila tiene
  escuchar, modo, nota raíz y una tijera que abre sus Chops.
- **Chops**: el editor estilo Slicex del canal elegido: ocho pads A–K sobre la
  waveform, Auto-slice, Clear All y pasos por pad.

Modos de cada sample:

- **One-shot**: toca el sample completo, transpuesto desde la nota raíz. Un 808
  largo suena entero aunque la nota o el paso sean cortos. Los samples
  importados empiezan en este modo.
- **Chops**: secuencia el pad elegido del corte. Los stems empiezan en este modo.
- La nota raíz es la misma en el Rack y en el Piano Roll. En One-shot el Piano
  Roll usa el sample completo y oculta el selector de pad.
- Cambiar de modo no borra nada: One-shot y Chops guardan pasos separados y los
  cortes se conservan.

Clear All (icono de pads tachados, en Chops) vacía los ocho pads. Un segundo clic
los restaura. Una pista vaciada no vuelve a cortarse sola; una pista nueva sí
recibe el Auto-slice inicial.

### Patrones y dropdowns

- Los patrones son del proyecto, no de una pista: elegir otro canal mantiene el
  patrón abierto. «+» crea uno nuevo.
- El menú de patrones (Rack y Piano Roll) y el de separaciones guardadas funcionan
  como los presets de Player Tools: cada fila tiene su botón de borrar, que no
  abre la fila.
- Borrar una separación guardada pide confirmación en dos pasos. Si es la abierta,
  la sesión sigue en memoria y se apaga el autoguardado. En una carpeta, solo se
  borra la subcarpeta de esa separación.

### Quitar de la Playlist o eliminar del proyecto

- **Quitar de la playlist** (clip, herramienta o Supr): saca solo esas
  apariciones. El sample sigue siendo el instrumento de su pista y sigue en el
  Rack.
- **Eliminar del proyecto** (clic derecho en la biblioteca de samples): quita el
  sample y todos sus clips. Se puede deshacer.
- **Usar como instrumento de la pista** (clic derecho en un clip): cambia el
  sample de la pista.

### EQ por canal

- Cada canal (los cinco stems y las pistas de usuario) tiene su propio EQ, como
  un insert del mixer. El EQ que ya existía quedó como **Master**.
- La ventana EQ tiene un selector Master/canal y muestra el espectro del canal.
- Pasan por el EQ del canal: sus clips, la preview del patrón y los pads y notas
  del Piano Roll. La exportación WAV aplica el EQ de cada canal y luego el Master.
- Los pads y notas no pasan por el volumen de la pista ni por Keep Tone, igual
  que antes.

### FXs del Master

- Botón naranja **FXs** entre Piano Roll y EQ, con la misma ventana movible,
  redimensionable, acoplable y maximizable. F4 abre, trae al frente o cierra.
- Los seis efectos de Player Tools: Reverb, Echo, Flanger, Phaser, Saturation y
  Bitcrusher. Todos sus controles están a la vista, incluido Room, sin mantener
  apretada una perilla para abrir opciones. En ventanas chicas se puede desplazar.
- Presets Subtle, Studio, Wide y Dub; encendido por efecto que recuerda su nivel;
  bypass y reset exclusivos de FXs. Arrastrar las perillas, Shift para precisión,
  flechas para ajustar y doble clic para restablecer.
- Echo Freeze funciona mientras se mantiene el botón o Enter/Espacio. Pausa la
  Playlist o la preview del patrón y la reanuda al soltar. Cerrar la ventana o
  perder el foco libera Freeze.
- Los clips, patrones, pads y notas pasan por FXs y luego por el EQ Master.
  La Grabadora recibe esa salida. La preview del Browser sigue independiente.
- Los ajustes de FXs se guardan con la separación; las anteriores abren con los
  efectos apagados. El WAV de la Playlist aplica los FXs antes del EQ Master e
  incluye las colas de reverb/echo. Bypass de FXs conserva el EQ.

### Guardado

Con **Guardar localmente** activo se guardan también:

- Los samples importados, como `sample-<id>.wav` en la carpeta de la separación,
  o en IndexedDB bajo `<id del preset>#samples`. El audio se escribe antes que
  los datos que lo nombran.
- Instrumentos (modo, cortes, nota raíz), patrones con los pasos de cada canal,
  EQ de cada canal y la Playlist.

Los presets anteriores siguen abriendo.

## Técnico

### Módulos nuevos

| Archivo | Rol |
| --- | --- |
| `scripts/stem-sample-browser.mjs` | Ventana del Browser. `mountSampleBrowser({ t, importSamples, onToggle })`. |
| `scripts/stem-sample-library.mjs` | Carpeta raíz: `showDirectoryPicker({ id: 'stem-samples', mode: 'read' })`, handle en IndexedDB, permisos y caché de carpetas. |
| `scripts/stem-sample-preview.mjs` | Preview en su propio `AudioContext`, caché LRU de 32 MiB que cuenta en el presupuesto de la Playlist. |
| `scripts/stem-module-window.mjs` | Ventanas: `mountModuleWindow()`, `bringToFront`, `isOnTop`. Estado en `localStorage` bajo `stem-module-<id>`. |
| `scripts/stem-effects.mjs` | Ventana FXs y todos los parámetros del motor compartido de Player Tools. |
| `scripts/stem-row-menu.mjs` | Dropdown con borrar por fila: `createRowMenu()`. |
| `scripts/stem-rack-overview.mjs` | Vista Channel Rack con una fila por sample. |

### Cambios de modelo

- **Fuente estable** (`stem-playlist.mjs`): cada pista de usuario guarda
  `track.source`, el sample de su instrumento. Mover o quitar clips no la cambia.
  Los samples eliminados quedan en un `graveyard` mientras el historial de
  deshacer los necesite. Cada estado del historial guarda `sampleIds`, así deshacer
  y rehacer también restauran samples sin clips.
- **Canales del Rack**: `playlist.instrumentSources()` devuelve stems, pistas con
  sample y un canal `sample-<assetId>` por cada sample importado que no es fuente
  de ninguna pista.
- **Instrumento** (`stem-pattern-core.mjs`): `mode` (`'oneShot'` o `'slices'`),
  `slices`, `sliced` (evita repetir el Auto-slice) y `piano` (pad, nota raíz, etc.).
  `instrumentSample()` da el sample completo en One-shot o el pad elegido en Chops.
- **Patrón**: `steps` (pasos por pad), `hits` (pasos One-shot), `notes` y
  `channels`, que guarda `{ steps, hits, notes }` de cada canal distinto de
  `pattern.track`. Un patrón con varios canales se renderiza mezclando cada canal
  con su EQ.
- `schedulePianoNote(..., oneShot)`: en One-shot la duración es la del sample
  transpuesto, sin bucle de sustain.

### Audio de la Playlist

Diagnóstico de un subagente Codex: cada edición de clip reiniciaba todas las
fuentes de audio. Ahora:

- `engine.patch()` reemplaza solo los clips cambiados, agregados o quitados.
  Cambios de loop o final reanclan el reloj, salvo cerca de una vuelta.
- Al arrastrar, el audio se actualiza una vez por cuadro. Al estirar un borde se
  escucha al soltar.
- La regla dibuja solo lo visible, el layout de pistas se lee una vez por cuadro,
  el color espectral se cachea y el zoom dibuja una sola vez.

### EQ por canal

Diseño propuesto por un subagente Codex. Cada pista es un bus del motor: EQ, luego
volumen, luego el master de la Playlist, Keep Tone y el EQ Master. Las auditions
(pads y Piano Roll) usan buses propios: EQ de la pista y luego el Master. La UI
existente (`SCParametricEQUI`) se reutiliza con un adaptador, sin cambiar los
archivos compartidos con Player Tools. `renderArrangement(..., { masterEq })`
aplica los mismos inserts en la exportación.

### Pruebas

| Comando | Cubre |
| --- | --- |
| `npm run test:stems` | Unidades: patrones, motor que reemplaza solo el clip editado, cortes. |
| `npm run test:e2e:sample-browser` | Browser: carpeta, permisos, preview, arrastre. Usa perfil persistente. |
| `npm run test:e2e:module-windows` | Ventanas: teclas, frente/cierre, acople, maximizar, persistencia. |
| `npm run test:e2e:stem-fx` | Todos los controles FXs, presets, persistencia, Freeze, bypass, worklet, salida de audio y WAV, escritorio y 320 px. |
| `npm run test:e2e:channel-eq` | EQ por canal y exportación filtrada. |
| `npm run test:e2e:instruments` | Rack (Chops), Piano Roll, patrones, Clear All, presets. |
| `npm run test:e2e:rack-modes` | Vista Channel Rack, One-shot con nota raíz, modos sin pérdida, recarga, 390/320 px. |
| `npm run test:e2e:playlist` | Playlist, quitar vs. eliminar, deshacer. |
| `npm run test:e2e:stem-presets` | Guardado, samples importados, borrado de separaciones. |

Todas pasaban al cerrar el 17/10/2026, junto con `stems-ui`, `stem-local-audio` y
`stems`. En PowerShell usar `npm.cmd`: la política del sistema bloquea `npm.ps1`.

## Pendiente o a revisar

- Probar en Chrome real: F6 puede llevar el foco a la barra de direcciones.
- Si se usa «Usar como instrumento de la pista» con otro sample, los pasos de la
  pista pasan al sample nuevo; no quedan con el anterior.
- Un patrón puesto en otra pista de la Playlist suena con el EQ de esa pista.
- Los canales `sample-<id>` (samples importados que no son instrumento de una
  pista) no tienen EQ propio.
