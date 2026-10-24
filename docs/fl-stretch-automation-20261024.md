# FL Studio: edición temporal, automatización y consolidado

Fecha: 2026-10-24. Investigación de referencia para el editor de stems. Las decisiones propuestas abajo son propias; no describen una copia de algoritmos de FL.

## Referencia documentada

El [manual de Sampler](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/chansettings_sampler.htm) distingue el algoritmo del vínculo al tempo. Resample relaciona velocidad y pitch; Stretch conserva el pitch al variar duración. Time=None deja la duración independiente del BPM. Project tempo conserva la duración original al BPM actual y establece el vínculo para cambios posteriores. MUL modifica la longitud. Seleccionar Stretch inicialmente fija Time al tempo actual. Normalize procesa la amplitud del sample sin clipping; no equivale a ajustar loudness perceptual.

En el [manual de Playlist](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm), Draw coloca y mueve clips; recortar cambia su ventana sobre el audio. Slip desplaza esa ventana sin mover los límites temporales. Stretch de Playlist cambia la duración al arrastrar un borde, usando el algoritmo configurado en el sample. Son decisiones independientes. Consolidar desde la cabecera renderiza los clips del canal, incluye sus insert FX y automatización contextual, y excluye master FX por defecto para evitar aplicarlos dos veces. Los originales quedan silenciados en FL.

El [manual de Automation Clips](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist_automationclip.htm) documenta creación desde el menú contextual de un control. El clip ocupa el rango seleccionado o la canción. La curva se edita dentro de Playlist: agregar, mover y borrar puntos, ajustar tensión y elegir interpolación. La cabecera mueve/recorta el clip; el cuerpo edita puntos. Los puntos usan snap con Alt como excepción. Los valores internos van de 0 a 1. Automatización admite enlaces a controles y su inicialización conserva el valor base.

## Evidencia del FL instalado y límites

Inspección read-only del FL solicitado: `C:\Program Files\Image-Line\FL Studio 2025\FL64.exe`, FileVersion `25.2.4.5242`, 1.099.256 bytes. El Help local no contiene las páginas completas del manual; `Help/WhatsNew.htm` sí incluye entradas sobre variants, stretching y edición de automation.

Se usó el launcher existente REA 6.4.0:

`C:\Users\torib\AppData\Local\npm-cache\_npx\9b9809298fe40d2c\node_modules\.bin\rea.cmd`

Operación ejecutada: `inspect-pe-resources` sobre `FLEngine_x64.dll`. SHA-256 del archivo: `b74993c5b6f3e8caa7c82dc279e48218271d7722f32cd9b862a50afd3fe143dc`. Evidence ID: `ev_52c4dd0d601e42a72a557b1c7d954ca342495912a23798f191d3cb2c22d6e149`. El inventario completo quedó en `.tmp/fl-reference-20261024/flengine-pe-resources.json` para esta sesión; se puede regenerar con el comando indicado. Coincide con la identidad de la inspección del 16 de octubre.

| Recurso PE | Índice | Offset | Bytes | Qué prueba |
| --- | ---: | ---: | ---: | --- |
| `TPLCLIPPROPFORM` | 214 | 55985136 | 12821 | Recurso de propiedades de clip |
| `TPARAMCTRLFORM` | 213 | 55980608 | 4521 | Recurso de control de parámetros |
| `TMEEVENTSTOAUTOTOOL` | 191 | 55590320 | 2841 | Recurso de conversión de eventos |
| `EEPEN` | 274 | 56801568 | 20 | Referencia a cursor de lápiz |
| `EESEL` | 276 | 56801616 | 20 | Referencia a cursor de selección |
| `EESLIP` | 278 | 56801664 | 20 | Referencia a cursor Slip |
| `ADDPOINT` | 263 | 56801304 | 20 | Referencia a cursor de agregar punto |
| `MOVETENSION` | 290 | 56801952 | 20 | Referencia a cursor de tensión |

Una lectura posterior de los rangos RCDATA con PowerShell, separada de REA, encontró firma `TPF0`. `TPLCLIPPROPFORM` contiene `PitchWheel`, `TimeBox`, `TimeSelect`, `ResetStretchBox` y `Reset clip stretch`; `TMEEVENTSTOAUTOTOOL` contiene `Convert to automation`. Son cadenas y recursos estáticos, no observación de comportamiento ni reconstrucción del DSP.

REA no está conectado como herramienta MCP en esta sesión. `doctor --client codex --json` detectó registro alineado en Claude, ausencia de registro Codex reconocido y ningún Ghidra/IDA configurado. Se continuó con el CLI sin modificar configuraciones. El provider de captura nativa incluido (`dist/native/NativeMacOSProviderMetadata.js`) declara disponibilidad únicamente en macOS; su helper usa Swift/xcrun. No se ejecutó ni automatizó la UI de FL en Windows. Algoritmos internos y fidelidad de comportamiento en vivo quedan sin verificar. Las reglas de interacción proceden del manual oficial, no de las cadenas PE.

## Propuesta para este editor

Los cinco nombres actuales se reducen a tres herramientas y dos ajustes de procesamiento:

| Elemento | Alcance | Comportamiento propuesto |
| --- | --- | --- |
| Lápiz | Herramienta | Seleccionar/mover en el cuerpo; recortar en los bordes; dibujar en vacío. Activarlo restaura siempre mover/recortar. |
| Deslizar audio | Herramienta independiente | Cambiar `in/out` juntos, conservando `at`, duración, speed y algoritmo. |
| Estirar borde | Herramienta independiente junto al selector Stretch | Arrastrar borde modifica speed, con snap, y fija `tempoLock`. El cuerpo sigue permitiendo mover. |
| Stretch / Resample | Ajuste del clip seleccionado | Decide si el cambio de velocidad conserva pitch o lo arrastra. Permanece visible junto a los knobs. |
| Seguir tempo | Ajuste del clip seleccionado | Decide si cambios de BPM conservan la longitud en beats. Independiente de herramienta y algoritmo. |

Seleccionar rango y cortar conservan su acción propia. Grid se ubica junto al zoom. El inspector expandible puede agrupar volumen, pitch/fine, velocidad, fades, algoritmo, vínculo al tempo y normalización; las herramientas no deben funcionar como otro estado oculto del sample.

`speed=1` no identifica Stretch ni Resample: con pitch neutro ambos reproducen igual. Un mismo sample puede necesitar conservar pitch o comportarse como cinta en el próximo cambio. El algoritmo debe persistir explícitamente, aunque a 1× el motor evite trabajo innecesario.

Para los stems de la separación, el comportamiento pedido puede usar `tempoLock=true` desde su creación, con velocidad inicial 1× y el BPM del proyecto como referencia. Samples importados sin BPM conocido necesitan una política explícita: anclarlos al BPM de importación mantiene su duración en ese momento, pero no demuestra que sus beats estén alineados. No inventar detección de BPM.

## Encaje con el modelo existente

`scripts/stem-playlist-core.mjs` ya contiene las tres piezas necesarias: `keepLength` elige Stretch/Resample; `speed` modifica velocidad; `tempoLock` decide seguimiento del BPM. No hace falta deducirlas entre sí.

Con ventana fuente `L = out - in`, factor de pitch `P = keepLength ? 1 : 2 ** (pitch / 12)`, y duración elegida `D`:

`speed = L / (D * P)`

Usar pitch total incluyendo cents. Estirar mantiene la ventana fuente, ajusta speed y activa tempoLock. Recortar cambia la ventana sin cambiar speed; deslizar desplaza la ventana. Para Stretch, pitch adicional no cambia duración; en Resample sí interviene en el factor anterior. Al restablecer velocidad a 1× se conserva algoritmo y vínculo al BPM. Etiquetar claramente si “original” significa velocidad fuente o longitud correspondiente al BPM original.

Riesgo existente: `retimeClips` limita speed silenciosamente a `.25..4`; un cambio extremo de BPM puede dejar de preservar el largo musical. Validar el resultado completo antes de aplicarlo o informar el límite. Agregar cobertura de bordes izquierdo/derecho, reverse, recortes, snap y velocidad con pitch en Resample.

## Automatización y consolidado propuestos

Crear clips desde el menú contextual de volumen/pan y parámetros FX. Deben tener destino estable por ID de pista y parámetro, posición, duración, puntos e interpolación persistentes. Dibujar curva y puntos en una lane asociada al canal, con edición directa, snap, mover/recortar desde cabecera y deshacer por gesto. Empezar con lineal, hold y curva ajustable; no afirmar compatibilidad con todas las curvas de FL.

El motor y el exportador necesitan el mismo evaluador de curvas. Resolver valores al comenzar en mitad del arreglo, buscar/loop, silencio del clip y eliminar automatización; restaurar el valor base para no dejar knobs pegados al último valor. Definir prioridad determinista cuando dos clips controlan el mismo parámetro. No automatizar únicamente la UI mediante animation frames: el render offline también debe recibir las curvas.

Consolidar desde la cabecera incluye clips, huecos, fades, pitch/stretch, mezcla y FX del canal, además de sus curvas. Renderizar antes de mutar el proyecto. Después ofrecer conservar originales en un nuevo canal o reemplazarlos, como pidió el usuario. La copia renderizada debe tener controles neutros y ninguna automatización ya horneada, para evitar duplicar procesamiento. Master FX quedan fuera del consolidado interno; se mantienen en la mezcla final. Conservar originales requiere decidir explícitamente qué canal queda audible para no duplicar volumen. Mantener o recortar colas de reverb/delay también debe ser una decisión declarada.

## Cobertura

- Identidad del FL instalado y recursos correspondientes: verificados estáticamente con REA.
- Semántica pública de Stretch/Resample, Draw/Slip, tempo, automation y consolidado: respondida mediante manuales oficiales.
- Mapeo al modelo actual: verificado leyendo el código del editor.
- Interacción en vivo y algoritmo nativo de FL: sin verificar por falta de provider nativo Windows/motor de decompilación.
- UX y reglas nuevas de este editor: propuestas de implementación, no observaciones atribuidas a FL.
