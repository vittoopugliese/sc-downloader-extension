# Presets locales de Stems — 2026-10-04

> Actualización 17/10/2026: el Channel Rack, el Piano Roll, el EQ por canal, el Browser de samples y el guardado de samples importados cambiaron. Ver [stem-workspace-fl-20261017.md](stem-workspace-fl-20261017.md).

Implementado en el checkout. Este alcance reemplaza la exclusión anterior de
persistencia en `stems-roadmap.md`. No convierte Stems en una web independiente.

## Uso

- Cada extracción nueva empieza con **Guardar localmente** apagado. Al activarlo
  se abre un diálogo con nombre y destino; cancelar o Escape no activa el guardado.
- Se puede activar antes de separar (guardará al terminar) o después. Se guarda
  el original y los cuatro stems como WAV originales, estéreo float32 de 44,1 kHz.
- El selector bajo Experimental abre una separación sin cargar el modelo ni
  volver a ejecutar inferencia. También funciona abriendo `stems.html` sin `job`.
- Volumen, mute/solo, modo original/mezcla, repetición, velocidad y Keep Tone se
  guardan automáticamente en los presets activos. Apagar el toggle detiene las
  actualizaciones; no elimina el preset. Abrir un preset activa su autoguardado.
- El destino inicial es IndexedDB de la extensión, en el perfil del navegador.
  El botón de carpeta permite elegir otra biblioteca y recuerda su handle. La
  cruz, como en el popup, restablece el destino del navegador. Cambiar de destino
  no mueve ni elimina presets: se puede volver a elegir la carpeta para abrirlos.
- Las carpetas contienen `PlayerTools-Stems/stem-<uuid>/`, cinco WAV y
  `preset.json`. El nombre visible está en el JSON; los identificadores evitan
  colisiones entre nombres iguales. No se descarga una copia adicional a Descargas.
- Si Chrome revoca el permiso de la carpeta se ofrece reconectarla. No se usa un
  destino alternativo silenciosamente ante un fallo. Los errores de espacio,
  permisos o archivos faltantes se muestran sin borrar la separación abierta.

## Audio

### Samples de batería

El botón **Sampler** abre los ocho pads A S D F G H J K. Elegí un pad y hacé
clic en la waveform de batería para colocar un sample de **154 ms**, con
entrada de 3 ms y salida de 30 ms. Cada pad tiene su propio final, aunque sea
el único o el último marcador del stem. Cerca del final del audio, el recorte
y los fades se acortan para caber en las muestras disponibles.

**Editar sample** acerca las waveforms al recorte seleccionado. Arrastrá la
letra para ajustar el inicio, el borde inferior derecho para cambiar el final,
y los dos puntos de la envolvente para editar los fades. Los controles también
aceptan flechas (1 ms), Shift + flechas (10 ms), Home y End. La rueda mantiene
el zoom habitual; ↔ vuelve a mostrar todo el audio. Los fades son una envolvente
de entrada/salida para disparos de una sola vez, sin sustain dependiente de
mantener la tecla. Repetir una tecla apaga suavemente su voz anterior.

Con **Guardar localmente** activo, los recortes y fades se guardan junto con
el preset, tanto en navegador como en carpeta. Los presets anteriores, que
solo guardaban posiciones de inicio, se abren con el recorte de 154 ms. Los
WAV originales no cambian.

### Piano roll melódico

El stem **Otros** (instrumentos) tiene un botón **Piano roll**. Usa el mismo
tempo, primer tiempo y cantidad de compases que el secuenciador de pads. Las
ediciones de grilla en cualquiera de los dos se reflejan en el otro; el BPM de
reproducción sigue al slider global y **Keep Tone** conserva la altura.

1. Abrí Piano roll y hacé clic o arrastrá sobre la waveform de instrumentos para
   elegir su sample. Este recorte es independiente de A–B y de los pads de batería.
   Un clic crea un recorte de 500 ms; sus bordes y fades se editan en la waveform.
   El botón de selección permite elegir otra muestra; la lupa acerca el recorte.
2. Asigná la **nota raíz** del sonido original (C4 por defecto, MIDI 60). No se
   detecta su afinación: la asignación es manual. Las demás notas transponen el
   sample por semitonos, como el sampler de Player Tools.
3. Dibujá notas o acordes con clic. Arrastrá para moverlos y usá el borde derecho
   para cambiar su duración. La grilla ofrece 1/4, 1/8, 1/16 y 1/32, de 1 a 4
   compases. Las teclas de la izquierda permiten escuchar cada altura.
4. Elegí **Agregar piano**, **Reemplazar instrumentos** o **Instrumentos
   originales**. Play/Pausa controla el transporte común. El piano responde al
   volumen, mute y solo de Otros, pasa por el EQ y llega al grabador de la mezcla.
5. **Repetir sample durante la nota** sostiene el recorte hasta el final de cada
   nota; sin esa opción, el sonido termina al agotarse el sample o al terminar
   la nota. Las transposiciones también cambian la duración natural del sample.

Supr o clic derecho elimina una nota; las flechas la mueven. Shift + Izq./Der.
cambia su duración y Shift + Arriba/Abajo la transpone una octava. Hay intensidad
por nota, duplicación y deshacer/rehacer (Ctrl/Cmd + Z, Shift + Z o Y). Los
patrones admiten hasta 512 notas. Al reducir los compases, las notas de los
compases ocultos se conservan.

El guardado existente conserva el recorte, fades, nota raíz, notas, intensidad,
modo y repetición del sample en navegador o carpeta. Los WAV separados no se
modifican. Cambiar A–B a un rango distinto del patrón desactiva su reproducción;
ajustá la grilla al nuevo loop y volvé a activarla. Plegar el stem o cerrar el
editor conserva el patrón y su reproducción.

Implementación: `stem-piano.mjs` y `stem-piano-core.mjs`. El patrón se renderiza
en un buffer derivado con `OfflineAudioContext`, incluyendo las colas que cruzan
la vuelta del loop. Comparte el reloj, playbackRate y procesador Keep Tone con
los stems; no depende de timers para disparar notas. Se verificaron las
[reglas de duración y playbackRate de Web Audio](https://webaudio.github.io/web-audio-api/#AudioBufferSourceNode).

Pruebas: `npm run test:stems` valida normalización y empaquetado;
`npm run test:e2e:stems-ui` incluye `stem-piano.browser-check.cjs` para edición,
recorte independiente, presets, sincronización, frecuencia real del audio,
duración, colas del loop, Keep Tone y layout de escritorio/390/320 px.

### Archivos del equipo (importación)

**Cargar audio del equipo** abre el selector de archivos en Stems, incluso al
entrar a `stems.html` sin un job de SoundCloud. La importación muestra nombre,
duración, canales y tamaño; permite editar el título y elegir inicio/fin en
segundos. Los archivos largos requieren un fragmento de hasta 30 segundos:
no se separa ni se guarda la canción completa silenciosamente.

Se aceptan los formatos que Chrome pueda decodificar, con un límite de 256 MiB
por archivo. Se decodifica el archivo completo para seleccionar el fragmento,
por lo que archivos largos pueden consumir bastante memoria. El audio se
remuestrea a 44,1 kHz; mono se duplica a estéreo y, en archivos multicanal, se
usan los dos primeros canales. El título inicial viene del nombre del archivo;
esta importación no lee etiquetas de artista/álbum ni portadas incrustadas.

Confirmar carga el fragmento para escucharlo y usar **Separar loop**. El mismo
**Guardar localmente** conserva el fragmento original, sus cuatro stems, los
datos del archivo de origen y los ajustes de mezcla, velocidad y Keep Tone.
Cancelar el diálogo o elegir un archivo inválido mantiene la sesión anterior.
Importar un nuevo fragmento reinicia los ajustes y desactiva el guardado, sin
sobrescribir presets anteriores. El archivo fuente permanece intacto.

`npm.cmd run test:e2e:stem-local-audio` verifica decodificación real de WAV mono
de 48 kHz, remuestreo, recorte, rechazo de rangos/archivos inválidos, cancelación,
guardado, recuperación sin inferencia, reproducción y vistas de 320–1200 px.
La inferencia se sustituye por stems deterministas en esta prueba; la prueba
`test:e2e:stems` también importa un archivo local y separa con HTDemucs real
dentro de la extensión MV3 antes de guardar y reabrir el preset.

Tone & Velocity usa el rango y paso actuales de Player Tools: 0,1–3×,
paso 0,0125×, doble clic para 1× y edición numérica. Keep Tone está apagado
inicialmente. El botón de reset restablece 1× y desactiva Keep Tone.

Las cinco fuentes siguen compartiendo el mismo AudioContext y hora de inicio.
Sin Keep Tone se modifica playbackRate, cambiando duración y tono juntos.
Con Keep Tone, un único AudioWorklet después de la mezcla usa el Signalsmith
empaquetado para compensar la transposición mediante el factor inverso de la
velocidad. No se vuelve a separar ni se crean cinco renders al arrastrar.
El DSP introduce su latencia de procesamiento; el final sin repetición deja
drenar esa cola. Los WAV guardados y descargados permanecen originales:
los ajustes se aplican a la escucha y se almacenan aparte.

## Persistencia y fallos

`stem-presets.mjs` separa almacenamiento de audio, metadatos y preferencias.
IndexedDB guarda audio y preset en una transacción. En carpeta, los WAV se
escriben primero y `preset.json` al final como marcador de guardado completo.
Un guardado interrumpido puede dejar una carpeta parcial, que no se lista como
preset. Las actualizaciones de ajustes solo escriben metadatos; se agrupan
cambios mientras hay una escritura en curso. Un cierre durante una escritura
pendiente utiliza la protección nativa de cambios sin guardar del navegador.

Se solicita almacenamiento persistente al guardar en navegador, sin asumir que
Chrome lo conceda. Borrar datos del perfil o desinstalar la extensión puede
eliminar su IndexedDB; las carpetas elegidas son archivos del usuario. No hay
sincronización en la nube ni migración automática entre destinos.

## Validación

- `npm.cmd test`: 60 verificaciones locales.
- `npm.cmd run test:e2e:stems-ui`: interfaz, waveforms, reproducción y cinco idiomas.
- `npm.cmd run test:e2e:stem-presets`: IndexedDB y filesystem reales, reload,
  ajustes, reset, guardados parciales, WAV corrupto y ausencia de re-inferencia.
  La prueba sustituye el selector del sistema por un handle OPFS; el selector
  nativo requiere una interacción del usuario.
- Medición del AudioWorklet real con señal de 440 Hz: sin Keep Tone, 220,7 Hz a
  0,5× y 880,2 Hz a 2×; con Keep Tone, aproximadamente 436–441 Hz entre 0,1× y 3×.
  Verifica semántica de tono, no calidad perceptual universal sobre música.
- `npm.cmd run test:e2e:stems`: modelo HTDemucs real, cuatro WAV, guardado,
  recuperación en otra página MV3 sin job y reproducción con Keep Tone bajo CSP.
- Capturas de 1200, 390 y 320 px en `test-results/stem-presets/`.

No se publicó una release. La web independiente, 60 segundos y pitch separado
de la velocidad siguen fuera de este cambio.
