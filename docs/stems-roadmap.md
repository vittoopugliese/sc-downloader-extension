# Stem Extractor · PlayerTools: mejoras y decisiones futuras

Fecha: 2026-10-01. Documento de continuidad; no autoriza implementar las fases futuras.

Actualización 2026-10-04: el usuario autorizó presets locales, carpeta/reset y
Tone & Velocity global con Keep Tone. Implementación y validación en
[stem-presets.md](stem-presets.md). Esto reemplaza la exclusión de persistencia
de resultados al final de este documento. Pitch independiente sigue aplazado.

## Alcance aprobado ahora

Embellecer la página existente: eliminar el encabezado promocional grande, mostrar portada y metadatos del track, unificar preparación y escucha en una tarjeta, compactar controles y tarjetas de stems, agrupar Mute/Solo/WAV a la derecha y reemplazar el slider de volumen por un knob visualmente igual al de PlayerTools, junto a la waveform. Agregar el ícono de capas al botón Stems del looper.

Conservar volumen 0–100 %, separación máxima de 30 segundos, modelo y procesamiento actuales, descargas individuales del stem original y reproducción sincronizada. Pitch aplazado. El usuario probó alrededor de 15 canciones de música compleja y está satisfecho con la calidad: conservar HTDemucs.

## Ampliar a un minuto (pendiente)

- Elevar el límite a 60 segundos en UI, sesiones, validación PCM y textos; mantener independientes los límites del sampler.
- Mantener CPU/WASM de un hilo y las opciones de ONNX verificadas. Sin WebGPU en esta etapa.
- El algoritmo actual requiere 5 bloques para 30 segundos y 10 para 60 segundos. El tiempo aumenta; no garantizar rendimiento universal.
- Un minuto estéreo float32 ocupa unos 21 MB por señal; original y cuatro stems suman unos 106 MB, sin modelo ni copias.
- Evaluar creación de WAV bajo demanda y reducción de copias para controlar memoria.
- Verificar inferencia real de 60 segundos, cancelación, alineación, extremos y memoria. Conservar prueba de loops cortos.

## Contexto alrededor de A–B (pendiente)

Evaluar algunos segundos anteriores/posteriores para mejorar bordes, procesar localmente y recortar el resultado exactamente a A–B. Comparar audiblemente antes de adoptar. Separar una canción completa no equivale a darle contexto global al modelo: el motor actual usa ventanas de 7,8 segundos. No agregar por ahora separación de tracks completos ni otro selector de contexto.

## Pitch por stem (aplazado explícitamente)

Propuesta: knob de −12 a +12 semitonos conservando duración y sincronización. El knob del sampler modifica playbackRate y por tanto velocidad; no copiar esa semántica para stems sincronizados.

Signalsmith Stretch ya está empaquetado y expone transposición, pero el renderizador actual necesita ampliar su interfaz y verificar latencias, extremos y calidad. Dos alternativas a decidir:

1. Procesar el stem en un worker al terminar el gesto; descartar resultados obsoletos y reemplazar el buffer en la posición común con transición. Siempre partir del original y volver directamente a él con pitch cero. Medir demora: no prometer respuesta inmediata.
2. Pitch durante el arrastre mediante procesamiento en tiempo real: evaluar AudioWorklet, latencia, consumo y sincronización antes de comprometer la experiencia.

Volumen continúa siendo inmediato. Decidir si WAV sigue siendo siempre original o se añade una descarga individual «WAV con ajustes» para pitch/volumen. Mute/Solo serían solo escucha. No crear ZIP ni exportación conjunta.

## Página independiente (alcance por confirmar)

La conversación de referencia `C:/Users/torib/Desktop/sell_stemsep_apart.txt`, especialmente sus últimas 20 líneas, plantea ofrecer una web independiente. Mantener identidad Stem Extractor · PlayerTools y compartir motor/mezclador, no mantener dos implementaciones divergentes.

- Separar adquisición de audio de la lógica común: adaptador de extensión con chrome.runtime y adaptador web con archivos locales.
- Web inicial: abrir/arrastrar archivo, mostrar waveform, elegir A–B y separar hasta el límite aprobado. Poner límites razonables también a la decodificación del archivo completo.
- Servir aplicación, worker, JS y WASM por HTTPS. Conservar modelo fijado, hash y descarga con caché; verificar acceso CORS desde el dominio web. Alojar el modelo propio es opcional.
- Caché web y caché de extensión son distintas; no prometer reutilización entre orígenes.
- Procesamiento local: no subir audio ni contratar inferencia remota.
- Cobro/acceso y publicación requieren decisiones posteriores. No basar el acceso comercial únicamente en un bloqueo local ni prometer secreto del código/pesos que recibe el navegador. Conservar avisos de terceros y revisar términos de los artefactos antes de publicar.

Buscador de tracks queda como idea posterior: estudiar acceso a SoundCloud y obtención de audio en el contexto web antes de diseñarlo. No es parte de la mejora visual actual.

## Exclusiones y criterios de revisión

Sin persistencia de resultados, envío al sampler ni descarga conjunta por pedido del usuario. Sin cambio de modelo ni nueva investigación de FL Studio. Para las mejoras visuales verificar escritorio y móviles de 390/320 px, teclado y arrastre del knob, portada ausente/fallida, reproducción/seek, Solo/Mute, comparación y descarga original. No confundir pruebas UI con una nueva validación de inferencia ONNX.
