# Presets locales de Stems — 2026-10-04

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
