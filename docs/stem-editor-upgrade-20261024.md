# Stem editor — 2026-10-24

Estado: implementado en el checkout y verificado en Chromium de Playwright. No publicado.

- [x] FX independientes por canal, guardados y aplicados a clips, auditions, patrones, salida de grabación y exportación.
- [x] Normalización reversible y panel ampliable del clip.
- [x] Borrado de originales/stems con confirmación destructiva, deshacer y persistencia.
- [x] Consolidación desde el canal: reemplazar originales o conservarlos y agregar un canal nuevo.
- [x] Automation clips editables: volumen y Mix de los seis FX, puntos lineales/escalón, mover/estirar, duplicar/borrar, deshacer, guardado y render.
- [x] Lápiz = mover/recortar; Deslizar y Estirar borde como herramientas independientes.
- [x] Stretch/Resample por clip, Seguir tempo independiente; Estirar junto a Stretch y Grid junto al zoom.
- [x] Referencia de FL mediante REA y manuales oficiales, con límites documentados.
- [x] Pruebas de audio, guardado e interfaz; revisión visual en escritorio, 390 y 320 px.

Fuera de alcance: variantes/comparación A–B y biblioteca de escucha.

La normalización lleva el pico fuente a −1 dBFS sin modificar sus bytes; volumen y efectos se aplican después. La consolidación excluye los inserts master para que se apliquen una sola vez durante la reproducción. Reemplazar fuentes requiere una elección explícita y un render exitoso. Los archivos fuente externos al proyecto guardado se conservan.

## Uso

- **FX por stem:** menú ⋮ del canal → FX del canal, o F4 y elegir canal arriba. Cada uno conserva todos los parámetros, preset y bypass. Los patrones de varios canales incluyen los FX de sus fuentes; sus colas se pliegan sobre la vuelta siguiente del patrón.
- **Normalizar:** seleccionar clip → botón Normalizar junto a Stretch; también desde el menú de la cabecera del clip. La waveform del clip en la playlist se redibuja con el nuevo nivel (también refleja volumen y fades del clip). Normaliza el pico del sample fuente completo a −1 dBFS, con el mismo multiplicador en ambos canales. Segundo clic lo desactiva. No es normalización LUFS ni garantiza picos finales bajo cero después de sumar clips/FX. El exportador mantiene su protección de picos final.
- **Eliminar:** menú del sample → Eliminar del proyecto, o menú del canal → Eliminar canal. Confirmación, Escape para cancelar y Ctrl+Z para deshacer durante la sesión. Al guardar se eliminan los WAV correspondientes de esa copia del proyecto. El formato conserva slots nulos y nombres de audio retenido, compatibles con proyectos anteriores. Los audios compartidos por otro canal se conservan al eliminar/consolidar un canal.
- **Consolidar:** menú ⋮ → Consolidar canal. Incluye silencios desde cero, recortes, normalización, pitch/stretch, FX con colas, EQ, fader y automatización del canal. Conservar originales los silencia y agrega un canal nuevo. Reemplazar elimina el canal anterior y fuentes no compartidas solo después de terminar el render; se puede deshacer. El canal nuevo tiene ajustes neutros. Si se edita durante el render, la operación se rechaza para evitar reemplazar cambios recientes.
- **Automatizar:** clic derecho en volumen del canal o en Mix de un FX → Crear clip de automatización. Se usa el rango temporal seleccionado o la duración del arreglo. Doble clic agrega puntos; arrastre/flechas los modifican; clic derecho ofrece Lineal/Escalón/Eliminar. Los extremos se conservan. Arrastrar cabecera mueve el clip; arrastrar bordes escala la curva. Ctrl+D duplica, Supr borra, Ctrl+Z deshace. Mute del carril/clip desactiva su automatización. Al salir de la curva vuelve el valor manual; en superposiciones gana el clip que comienza más tarde, y a igual comienzo el último de la lista.
- **Herramientas:** P/1 restaura lápiz y mover/recortar; 2 activa Deslizar; 3/E activa Estirar borde, válido en ambos bordes; 6 activa Fades (entre Deslizar y Cortar): arrastrar el inicio o el final hacia adentro aplica fade in/out a los clips seleccionados, las marcas ajustan el fade (flechas también), doble clic lo resetea y Escape cancela el arrastre. Normalizar, Seguir tempo y Pitch fino quedan junto a Stretch; no hay panel inferior. H alterna Stretch/Resample del clip; 4 activa Stretch y 5 Resample. A 1× ambos pueden sonar igual: la elección sigue siendo explícita. Estirar activa Seguir tempo; los stems nuevos también lo traen activo. Samples importados conservan su velocidad hasta activar ese vínculo. G cambia la grilla junto al zoom; Alt omite snap.

## Alcance y referencia

La automatización implementada cubre volumen del canal y Mix de Reverb, Echo, Flanger, Phaser, Saturation y Bitcrusher. Los seis controles Mix también se pueden automatizar en Master; su volumen no. No incluye tensión Bézier, automatización de todos los parámetros de carácter, ni importación de proyectos FL. Los carriles de automatización comparten el límite existente de 16 pistas; el arreglo sigue limitado a cinco minutos.

Evidencia y explicación de Stretch/Resample: [fl-stretch-automation-20261024.md](fl-stretch-automation-20261024.md). La inspección de FL instalado fue estática; no se automatizó su interfaz de Windows ni se copiaron algoritmos internos.

## Validación

- `npm.cmd test`: 64 verificaciones locales.
- `npm.cmd run test:stems`: 30 pruebas de modelo, audio, automatización y empaquetado.
- `npm.cmd run test:e2e:stem-editor-upgrade`: FX aislados y patrones multicanal con PCM real; automatización live/offline; normalización; guardado sparse en IndexedDB/carpeta con fallos; consolidación cancelar/conservar/reemplazar/deshacer; borrado de todos los stems y reapertura; layout de 1440/390/320 px.
- Suites existentes: Playlist, edición, workspace, instrumentos, presets, FX Master, EQ por canal y efectos compartidos de Player Tools.
- Live stretch pasó ejecutado por separado; una ejecución simultánea con otras suites no alcanzó audio en su espera fija inicial de 300 ms.
- Cierre (2026-10-24): 24 suites pasaron ejecutadas en serie: `test`, `test:stems`, `stem-editor-upgrade`, `stems-ui`, `workspace`, `instruments`, `note-workflow`, `rack-modes`, `stems-levels`, `stems` (MV3 con inferencia WASM real), `playlist`, `playlist-editing`, `playlist-live-stretch`, `sample-browser`, `module-windows`, `channel-eq`, `stem-fx`, `stem-presets`, `stem-local-audio`, `output-monitor`, `drag-number`, `effects`, `i18n` e `icons`.
- Ajustes de pruebas en el cierre: `stems-ui` desplaza la Playlist a la vista después de usar el zoom de la cabecera fija (el canvas solo pinta lo visible); `stems` elige Descargar WAV por nombre (el menú del canal ahora tiene más opciones) y cierra la ventana de extracción después de cancelar antes de guardar.
- Pendiente ajeno a esta entrega: `package:extension` falla porque `package-extension.ps1` exige `assets/images/default_avatar.png`, borrado en el commit `52433f7`.

Capturas en `test-results/stem-editor-upgrade/` y `test-results/channel-fx.png`. Nuevos módulos y CSS incluidos en la lista de empaquetado.
