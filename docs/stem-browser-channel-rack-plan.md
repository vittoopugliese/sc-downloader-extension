# Plan técnico: Browser de samples, Channel Rack y borrado independiente

Fecha: 2026-10-16. Estado: implementado completo (secciones 1–6). Guía de uso y detalle técnico: [stem-workspace-fl-20261017.md](stem-workspace-fl-20261017.md).

## Resultado esperado

Elegir una carpeta de samples, navegarla en una ventana flotante, escuchar un
archivo con una waveform pequeña y arrastrarlo a Playlist. Un 808 debe poder
seguir siendo un instrumento aunque se quite su clip de Playlist. Los cortes,
los pasos, los patrones y los archivos guardados tienen acciones distintas.

## Evidencia y límites de la inspección

- `scripts/stem-playlist.mjs:409`: eliminar clips modifica `state.clips`.
  Sin embargo, `trackSource()` (`:889`) busca la fuente entre los clips; quitar
  el último deja al instrumento sin buffer, y quitar el primero puede cambiar
  su fuente por otro sample. `scripts/stems-page.mjs:330` consume esa resolución.
- `scripts/stem-channel-rack.mjs:225`: un instrumento sin slices dispara
  Auto-slice al montarse. No distingue una configuración nueva de una vaciada.
- `scripts/stem-sampler.mjs:110`: Auto-slice limita cada recorte a un segundo;
  la asignación por clic usa 154 ms; el borde final del recorte se arrastra (`:26`).
  El reproductor ya admite rangos largos (`:186`).
- `scripts/stem-channel-rack.mjs:56`: el tacho de pasos vacía el compás visible.
  `scripts/stem-instruments.mjs:206`: el otro elimina un patrón.
- `scripts/tempo-control-main.js:2683`: Player Tools construye filas con cargar
  y eliminar; no expone todavía un componente reutilizable.
- `scripts/stem-library-ui.mjs:89` usa un selector nativo. `StemPresets` en
  `scripts/stem-presets.mjs` no implementa eliminación.
- `scripts/stem-playlist.mjs:153` y `:966`: los samples importados están
  excluidos del guardado actual. Persistir solo un ID de fuente no lo resuelve.
- Hay 14 herramientas en `scripts/stem-playlist.mjs:473`; B está libre. La
  disposición usa siete columnas en `assets/stem-playlist.css:96`.

FL Studio instalado: `C:\Program Files\Image-Line\FL Studio 2025`, ejecutable
25.2.4.5242. REA 6.4.0 está disponible mediante su launcher local, registrado
en Claude; no aparece conectado en esta sesión. Doctor no encontró un motor
Ghidra/IDA configurado para decompilar. La captura nativa incluida usa un helper
de macOS; no se observó la UI de Windows en ejecución.

REA inspeccionó recursos PE de FL64.exe y FLEngine_x64.dll. Evidencias:

- FL64: `ev_f91b571474d7d4300a6a50bbbc27aa3a32f2cc0af99b73b00510c9954759ce12`.
- FLEngine: `ev_52c4dd0d601e42a72a557b1c7d954ca342495912a23798f191d3cb2c22d6e149`.
  SHA-256: `b74993c5b6f3e8caa7c82dc279e48218271d7722f32cd9b862a50afd3fe143dc`.
  Inventario completo de 323 recursos; recurso RCDATA `TBROWSERFORM`, índice
  163, offset 55194560, longitud 4056. Una lectura posterior de ese rango con
  PowerShell encontró la firma TPF0 y nombres/cadenas `TBrowserForm`,
  `FL Studio Browser`, `CloseBtn`, `Escape` y `WebParentPanel`.
  Esto identifica recursos del browser; no prueba sus algoritmos ni ejecución.

El comportamiento de referencia procede del
[manual oficial del Browser](https://www.image-line.com/fl-studio-learning-content/fl-studio-online-manual/html/browser.htm):
carpetas, preview, waveform, ventana desacoplable y arrastre de samples a Playlist.
El plan propone una implementación propia en la extensión. La inspección del
código nativo del browser queda parcial por las limitaciones indicadas.

## 1. Separar fuente, instrumento y clip

Mantener inicialmente una fuente por instrumento/pista, como en el modelo actual,
pero introducir `sourceAssetId` estable. El registro de samples conserva el audio;
el instrumento referencia ese registro; cada clip referencia el sample y define
su posición y recorte. La fuente no se vuelve a elegir al reordenar o borrar clips.

Al importar sobre una pista sin fuente, asignar esa fuente. Si ya tiene fuente,
agregar el clip sin reemplazarla; el reemplazo será una acción explícita.
Migrar proyectos anteriores resolviendo una sola vez la fuente con la regla
actual y conservando todos los cortes/patrones existentes.

| Acción | Efecto |
| --- | --- |
| Quitar de Playlist | Elimina las instancias seleccionadas; conserva sample e instrumento. |
| Eliminar sample del proyecto | Quita el asset y sus clips; desvincula instrumentos dependientes. Los patrones quedan editables, con fuente ausente. |
| Borrar pasos del compás | Vacía pasos del compás visible; conserva slices y patrón. |
| Eliminar patrón | Elimina el patrón y sus clips derivados. |
| Clear All (slices) | Vacía las ocho asignaciones de audio; conserva pasos y notas. |

El borrado global mostrará las dependencias afectadas y se podrá deshacer.
No elimina el archivo original de la carpeta. Su historial debe retener las
referencias de audio necesarias para restaurar clips e instrumentos, y liberar
buffers al descartar entradas del historial.

Archivos: `stem-playlist.mjs`, `stem-playlist-core.mjs`, `stem-pattern-core.mjs`,
`stem-instruments.mjs`, `stems-page.mjs`.

## 2. Clear All de slices

Decisión del usuario: se mantiene el Auto-slice inicial actual, para stems y
samples importados. Se agrega **Clear All**, que vacía las ocho asignaciones;
después el usuario elige el recorte sobre la waveform del Rack, como hoy.
No se agrega un modo one-shot automático ni se adivina el tipo de sample.

Agregar API al sampler para vaciar todas las asignaciones. Persistir un estado
explícito de inicialización que distinga «nunca inicializado» de «vaciado por
el usuario»: hoy `stem-channel-rack.mjs:225` vuelve a cortar cualquier
instrumento sin slices al montarse, y eso deshace Clear All al cambiar de pista
o reabrir. Solo el primer montaje dispara Auto-slice. Cancelar cualquier
Auto-slice pendiente al limpiar o cambiar de fuente.

Clear All usa un icono propio (no un tercer tacho) y tooltip «Borrar todos los
cortes». Para un 808, el recorte elegido en la waveform se amplía arrastrando
su borde final hasta abarcar el sonido completo; el largo inicial del clic
(154 ms) no cambia.

Los slices son compartidos por los patrones y Piano Roll del instrumento;
restablecerlos cambia el sonido de esos patrones. Conservar pasos/notas y permitir
deshacer. Los pads sin asignación permanecen silenciosos.

## 3. Dropdowns iguales a Player Tools

Extraer la presentación del selector de presets a un componente pequeño con
callbacks para seleccionar/eliminar, conservando aspecto y comportamiento.
Usarlo en Player Tools, `patternControls()` (Rack y Piano Roll) y separaciones
guardadas. Cada fila tiene nombre y botón de eliminar; eliminar no selecciona
ni carga la fila. Incluir teclado, Escape, foco, cierre exterior y estado ocupado.

Eliminar el tacho externo de patrón deja espacio para Clear All; conservar
el control separado de pasos, con su alcance de compás visible explícito.

Implementar `StemPresets.remove(id)` con los dos destinos actuales: transacción
de metadata/audio en IndexedDB o eliminación de la subcarpeta del preset por ID
validado. La eliminación en carpeta afecta la copia guardada de esa separación;
no toca la carpeta de samples. Serializar con guardado/actualizaciones usando
el mismo mecanismo de exclusión. Al eliminar la separación activa, terminar o
cancelar escrituras pendientes, desactivar autosave y conservar la sesión abierta
en memoria. Ante error, conservar fila y datos para reintentar.

## 4. Browser flotante

Agregar botón Browser con hotkey B a la barra (15 herramientas), ajustando el
layout adaptable. Conservar Importar archivo. Ventana no modal, movible y con
cierre por X/Escape: Playlist debe seguir aceptando arrastre e interacción.

Contenido inicial: elegir/cambiar carpeta raíz, volver a carpeta padre, ruta
relativa, carpetas/archivos, actualizar listado y visor inferior con waveform,
duración, play/stop y volumen de preview. Clic en archivo preescucha; arrastrar
lo importa. Abrir carpetas no importa ni decodifica todos sus archivos.

Usar `showDirectoryPicker({ mode: 'read' })` desde un gesto del usuario.
Guardar el handle en IndexedDB y consultar permiso al reabrir; reconectar con
otro gesto si corresponde. El permiso es independiente del destino `readwrite`
de separaciones. Cancelar el picker conserva la raíz anterior.
[Referencia de File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Enumeración perezosa, lista paginada/virtualizada para carpetas grandes y caché
acotada. Decodificar solo archivos seleccionados o importados; reutilizar buffer
de preview al soltar cuando siga siendo el mismo archivo. Cancelar resultados
obsoletos al cambiar de selección para que nunca arranque el sample anterior.

Preview con una voz activa y ganancia propia; salida fuera del transporte,
exportación y grabador del proyecto. No cambia BPM, playhead ni patrón. Detener
al cerrar, cambiar raíz o importar; primer acceso puede requerir carga/decodificación.
Waveform reducida a picos, sin dibujar cada muestra por frame.

Exponer una API de importación/colocación desde Playlist y reutilizarla para
File picker, drop externo y Browser. Resolver el handle y decodificar al soltar,
recordando pista/posición destino; no depender de construir un File de forma
asíncrona dentro de `dragstart`. Mantener snap, límites de clips, duración y
presupuesto de memoria existentes. Preview debe tener su propio presupuesto
pequeño y sumarse al consumo total de audio.

Módulos: `stem-sample-browser.mjs` (UI), `stem-sample-library.mjs`
(carpeta/handles), `stem-sample-preview.mjs` (audio/waveform).

**Implementado (2026-10-16).** Botón B en la barra (15 herramientas, 8 + 7).
`importSamples()` en `stem-playlist.mjs` es el importador único de File picker,
drop externo y Browser; el drop fija pista y posición al soltar y reutiliza el
buffer del preview si el archivo no cambió (clave ruta + tamaño + fecha).
Preview en su propio `AudioContext` (fuera de mezcla, exportación y grabador),
caché LRU de 32 MiB que suma al presupuesto de Playlist y se libera al importar.
Lista virtualizada (filas de 26 px), lectura de carpetas por bloques con caché
de 24 carpetas. Enter agrega en el cursor; Espacio reproduce/detiene; Retroceso
sube de carpeta; Escape o B cierran. La ventana se mueve desde la cabecera, se
redimensiona y recuerda posición, tamaño y volumen. Prueba:
`npm run test:e2e:sample-browser` (usa perfil persistente: Chromium incógnito
cierra la página al leer un handle desde IndexedDB). Los samples importados
siguen sin guardarse en el preset hasta la sección 5.

## 5. Guardado y compatibilidad

Guardar los samples efectivamente importados al proyecto, no toda la carpeta
explorada. Persistir sus bytes junto con metadata, IDs y enlaces de instrumento
en IndexedDB o en la carpeta de separación elegida. Un handle solo no garantiza
recuperar el audio si se mueve el original o se revocan permisos.

Versionar el formato de preset para admitir assets adicionales conservando la
lectura de v1 (cinco WAV). Publicar metadata al terminar de guardar el audio;
validar límites y reportar falta de espacio sin dejar un preset aparentemente
completo. Abrir, modificar y guardar un preset anterior mantiene su contenido.
El handle de navegación es una preferencia independiente del proyecto.

## Orden y criterios de aceptación

1. Desacoplar la fuente del instrumento y cubrir borrado/undo.
2. Clear All y persistencia del estado vaciado.
3. Dropdown compartido y eliminación real de separaciones.
4. Browser, preview y drag/drop sobre el importador unificado. **Hecho.**
5. Persistencia de assets importados y verificación integral antes de entrega.

- Importar un 808, Clear All, elegir su recorte en la waveform y quitar su último
  clip: el clip deja de sonar en SONG, pero el pad y los patrones siguen
  reproduciendo el 808.
- Quitar/reordenar clips en una pista con dos samples no reemplaza su instrumento.
- Clear All deja los ocho pads vacíos; el estado sobrevive cambiar de pista y
  reabrir preset sin que reaparezca Auto-slice. Los pasos permanecen y deshacer
  restaura las asignaciones. Una pista nueva sigue recibiendo Auto-slice inicial.
- Borrar patrón desde una fila sincroniza Rack, Piano Roll y Playlist sin cargarlo.
- Eliminar separación activa/inactiva funciona en ambos destinos con autosave
  pendiente, error de escritura o permiso revocado; no reaparece luego de borrar.
- Browser maneja cancelación/revocación, archivo faltante/no decodificable,
  selección rápida, carpetas grandes, cierre y drop con snap/límites.
- Guardar/reabrir conserva audio importado aun si se mueve su archivo original;
  los presets v1 siguen abriendo.
- Verificar layout y foco/atajos: B no se dispara al escribir; letras de pads
  y Espacio pertenecen al panel enfocado. Teclado puede importar sin arrastrar.

Extender las suites `test:stems`, `test:e2e:instruments`, `test:e2e:playlist`,
`test:e2e:stem-presets` y agregar cobertura del Browser. Actualizar de forma
intencional la expectativa actual de 14 botones;
verificar también el selector existente de Player Tools tras extraerlo.

## Estado de implementación (2026-10-17)

1. Fuente estable: `track.source` en pistas de usuario; quitar/mover clips no la
   cambia; «Usar como instrumento de la pista» la reemplaza; «Eliminar del
   proyecto» la suelta y deshacer recupera el sample (graveyard ligado al
   historial). Clip: «Quitar de la playlist».
2. Clear All: botón propio en el Rack; segundo clic restaura; `instrument.sliced`
   evita que vuelva el Auto-slice; se guarda en el preset.
3. `stem-row-menu.mjs`: menú tipo Player Tools para patrones (Rack y Piano Roll)
   y separaciones guardadas; `StemPresets.remove()` en IndexedDB y carpeta, con
   confirmación en dos pasos. El tacho externo de patrón se quitó.
4. Browser (F8/B), ahora botón naranja en la barra de transporte, maximizable;
   preview con clic (inicio) y clic derecho (desde ese punto), waveform espectral.
5. Samples importados guardados con la separación (`sample-<id>.wav` o
   `<id>#samples` en IndexedDB), audio antes que metadata; formato aditivo, los
   presets anteriores siguen abriendo.

Además, fuera del plan original: ventanas flotantes estilo FL para Channel Rack,
Piano Roll, EQ y Grabadora (F6/F7/F9/F10, acoplar, maximizar), EQ por canal con
Master, y motor de audio que reemplaza solo el clip editado (sin cortes al editar).

6. Channel Rack con dos vistas, como FL Studio (2026-10-17):
   - **Channel Rack**: una fila por cada sample cargado (stems, samples de pistas
     y samples importados aunque no tengan clips). Todos comparten el patrón
     elegido; cada fila tiene preview, modo (One-shot o Chops), nota raíz y tijera
     para abrir sus chops.
   - **Chops**: la vista Slicex anterior (ocho pads A–K, Auto-slice, Clear All)
     del canal elegido.
   - One-shot toca el sample completo, transpuesto desde la nota raíz, que se
     comparte con el Piano Roll. Los samples importados empiezan en One-shot; los
     stems en Chops.
   - Cambiar de modo no borra cortes ni pasos: One-shot y Chops guardan pasos
     separados. Todo se guarda con la separación.
   - Archivos: `stem-rack-overview.mjs` (vista nueva), `stem-pattern-core.mjs`
     (`mode`, `hits`, `channels` por patrón), `stem-instruments.mjs`.
     Prueba: `npm run test:e2e:rack-modes`.

## Decisiones de UX

Resueltas por el usuario (2026-10-16): se mantiene el Auto-slice inicial y
Clear All vacía todos los pads. No hay decisiones pendientes.
