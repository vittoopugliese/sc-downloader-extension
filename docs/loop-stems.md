# Milestone: separación local de loops en Chrome

Fecha: 2026-09-30. Usuario: quiere separar y escuchar loops A–B de su extensión, completamente dentro de Chrome. Aceptó usar un Demucs público distinto del extractor de Image-Line. Pidió cerrar esta milestone y dejar instrucciones para una sesión en frío.

## Estado final

**Milestone completada como versión experimental funcional en el checkout.** Chrome ejecutó el modelo real, recortó un loop A–B mediante el renderizador existente y generó los cuatro WAV. También pasaron controles de escucha, cancelación y layout. Falta evaluar calidad musical con los loops reales del usuario; no bloquea esta milestone de integración y prueba funcional.

Configuración verificada: WASM con un hilo, `graphOptimizationLevel: 'disabled'`, `enableCpuMemArena: false` y `enableMemPattern: false`. Con optimización `all`, ONNX Runtime devolvió `std::bad_alloc` al crear la sesión. **No reactivar esa optimización sin repetir la prueba real de Chrome.** El tamaño de descarga no representa la memoria de ejecución.

No es el extractor de FL Studio reconstruido. La ingeniería inversa del binario original está documentada en [stem-extractor-local-analysis.md](stem-extractor-local-analysis.md). La nueva función usa HTDemucs público, no los pesos ni las DLL de Image-Line. No se ha comparado calidad contra FL Studio.

## Alcance y decisiones

- Botón **Stems** junto a WAV en Player Tools → Loop Region.
- Selección A–B capturada al pulsarlo. Hasta 30 segundos a velocidad original, sin efectos: primero se evalúa separación, no transformaciones de tempo/pitch/FX.
- Pestaña propia de la extensión, procesamiento en un worker local y permiso de exportación existente (`export-loop`). El checkout actual tiene `FREE_PRO_ENABLED = true`; no se cambió la política.
- Cuatro fuentes: batería, bajo, otros y voz; mezcla sincronizada, mute, solo, volumen, comparación con original, posición y reproducción repetida.
- Descarga individual WAV estéreo 44,1 kHz / 32-bit float para no recortar el margen de amplitud de cada stem.
- Cancelar termina el worker; cerrar la pestaña libera audio y cancela preparación. Un lock del navegador impide dos inferencias simultáneas en pestañas distintas.
- Abrir Stems pausa el audio de la pista de origen si sigue siendo la misma, para no superponer SoundCloud con la escucha de los stems.
- Modelo descargado por primera vez y guardado en CacheStorage. No se sube audio. Hay botón para eliminar la caché. Runtime JS/WASM empaquetado, sin CDN de código.
- Interfaz en español e inglés. Resultados temporales: descargar antes de cerrar la pestaña.

## Archivos principales

| Archivo | Responsabilidad |
| --- | --- |
| `scripts/stem-jobs.js` | Sesiones por pestaña, validación de remitente/rango/permiso y reutilización del render de loops |
| `scripts/stem-audio.mjs` | Validación PCM, segmentos solapados, reconstrucción y WAV |
| `scripts/stem-model.mjs` | URL fija, tamaño, SHA-256, descarga y caché del modelo |
| `scripts/stem-worker.mjs` | Inferencia ONNX en worker con WASM |
| `scripts/stems-page.mjs` | Preparación, progreso, cancelación y escucha sincronizada |
| `stems.html`, `assets/stems.css` | Interfaz de evaluación |
| `scripts/tempo-control-main.js`, `scripts/content.js`, `scripts/background.js` | Botón y puente desde la selección A–B |
| `scripts/vendor/onnxruntime/` | ONNX Runtime Web 1.30.0: módulo JS, loader y WASM, licencia |
| `scripts/vendor-stem-runtime.cjs` | Copia reproducible de los assets desde la dependencia fijada |
| `scripts/stems.test.mjs` | Pruebas numéricas y de sesiones/autorización/cancelación |
| `scripts/stems.browser-test.cjs` | Prueba de extensión MV3 con modelo real y fuente de audio controlada |

También se actualizaron manifest, dependencias, lista de empaquetado y avisos de terceros. No se creó commit, release ni publicación.

## Modelo fijado

- Distribuidor: [StemSplitio/htdemucs-onnx](https://huggingface.co/StemSplitio/htdemucs-onnx).
- Revisión: `d54ed9eb60e258ea82131c6ee14578628816456a`.
- Archivo: `htdemucs_fp16weights.onnx`.
- Tamaño: `165612636` bytes.
- SHA-256: `d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`.
- Entrada `mix`: float32 `[1,2,343980]`, estéreo 44.100 Hz; salida `stems`: `[1,4,2,343980]`.
- Orden: `drums`, `bass`, `other`, `vocals`.
- La tarjeta declara MIT. Se registraron procedencia y atribuciones en `THIRD_PARTY_LICENSES.md`.
- Los pesos fp16 ahorran transferencia, pero el grafo calcula en fp32. No confundir tamaño de descarga con memoria de ejecución.

## Retomar en frío

Workspace: `C:\Users\torib\Desktop\Program\sc-downloader-extension`.

1. Leer este documento y `git status --short`. Hay cambios sin commit, incluidos los informes y scripts del análisis original; conservarlos.
2. Ejecutar `npm.cmd ci` si faltan dependencias. En este Windows, `npm` resuelve un `.ps1` bloqueado por la política de PowerShell; usar `npm.cmd`.
3. Ejecutar `npm.cmd run vendor:stems` sólo si hay que regenerar los assets empaquetados. La versión exigida es 1.30.0.
4. Ejecutar `npm.cmd run test:stems` y `npm.cmd test`.
5. El modelo de prueba está en `test-results/stems/htdemucs_fp16weights.onnx` (ignorado por Git). Si falta, descargar la URL de `scripts/stem-model.mjs` allí. Alternativamente definir `STEM_MODEL_PATH` con su ruta absoluta.
6. Ejecutar `npm.cmd run test:e2e:stems`. Usa Chromium instalado por Playwright; si falta, `npx.cmd playwright install chromium`.
7. Leer el resultado real. La prueba no sustituye inferencia ni render de audio: carga pesos verificados en el worker real y utiliza el renderizador offscreen existente. Sólo sustituye metadatos/red de SoundCloud con una fuente controlada de nueve segundos. El intervalo 3–5 s contiene batería/bajo/acordes; fuera hay otro tono. Comprueba que el recorte coincide con la música, genera cuatro WAV y verifica longitud/canales/valores finitos y señal no nula en batería/bajo. También prueba controles/cancelación/layout. Todavía hace falta audición manual con loops reales de SoundCloud.
8. Si la inferencia pasa, inspeccionar `test-results/stems/stems-desktop.png`, `stems-mobile.png`, `verification.json` y los WAV. No afirmar calidad equivalente a FL por estas pruebas.

La prueba transmite el modelo mediante un servidor HTTP local. No usar `route.fulfill({path: modelo})` para los 166 MB: serializarlo entero a través de CDP hizo que se cerrara la conexión con Chromium. También filtra la pestaña nueva por `stems.html`: la instalación de la extensión abre otra pestaña `/you/likes` y no debe confundirse con el analizador.

## Validación final y artefactos

- `npm.cmd test`: **60 verificaciones locales**, incluida `verify-stems.js` con las cinco pruebas específicas.
- `npm.cmd run test:stems`: **5 pruebas**: extremos/solapamiento/alineación estéreo; muestras inválidas/salidas incorrectas; WAV float sin clipping; assets en lista de empaquetado; autorización/propiedad/rango/cancelación/limpieza.
- `node scripts/verify-tempo-browser.js`: pasó la regresión de interfaz. El botón Stems usa su propia clase; no reutilizar `.clear-loop`, porque otros controles y pruebas identifican con ella el botón de borrar.
- `npm.cmd run test:e2e:stems`: **pasó con inferencia real**, renderizador offscreen real y modelo con SHA-256 verificado.
- Última inferencia: **20,0 s** para el loop de 2 s. HTDemucs procesa un segmento fijo de 7,8 s incluso cuando el loop es más corto. No es un benchmark general ni incluye descarga/carga del modelo.
- Salida: 88.199 muestras por canal a 44.100 Hz, frente a las 88.200 teóricas. El remuestreo del renderizador existente redondeó una muestra (~23 µs). Las cuatro fuentes conservan exactamente la longitud del audio recibido.
- RMSE del recorte frente al fragmento esperado: **0,0000211**. Verifica A–B, no la calidad de separación.
- RMS por stem en la señal controlada: batería `0,06434`, bajo `0,09184`, otros `0,03867`, voz `0,000109`. La señal no contiene voz; esa energía baja es coherente, pero no demuestra calidad sobre voces reales.
- Capturas de escritorio y 390 px inspeccionadas visualmente; sin desbordamiento horizontal.

Artefactos en `test-results/stems/` (ignorados por Git): modelo de prueba, `input.wav`, cuatro archivos `Drums + bass + chord_*.wav`, `verification.json`, `stems-desktop.png`, `stems-mobile.png`. Si se retoma en otra máquina, recrearlos con el test. El resumen numérico queda preservado arriba.

## Cómo probarlo ahora

1. En `chrome://extensions`, recargar la extensión que apunta a este workspace y recargar la pestaña de SoundCloud.
2. Abrir Player Tools → Loop Region y seleccionar A–B de hasta 30 segundos.
3. Pulsar **Stems**; en la pestaña nueva pulsar **Separar loop**.
4. Esperar la descarga inicial de 166 MB y el procesamiento. Comparar **Original** con **Mezcla de stems**, escuchar con **Solo/Mute** y descargar los WAV.
5. Mantener abierta la pestaña hasta descargar lo necesario. Para otra selección, volver a SoundCloud y abrir Stems de nuevo.

## Pendientes para la siguiente milestone

- Audición con loops reales de SoundCloud: voz, batería compleja, bajos distorsionados y música densa. Comparar mismas selecciones contra FL Studio; aún no existe medición de equivalencia.
- Medir memoria máxima y rendimiento en distintos equipos. La verificación real usó CPU/WASM de un hilo; WebGPU y multihilo no están implementados ni prometidos.
- Probar inferencia real de un loop largo de 30 s (varios segmentos); el solapamiento ya está probado numéricamente, pero el ensayo con pesos reales fue de un segmento.
- Evaluar contexto antes/después de A–B para mejorar bordes de loops muy cortos; hoy el modelo sólo recibe la selección con padding.
- Valorar guardar stems en pads del sampler o persistir sesiones, si el usuario lo pide. Hoy hay escucha y descarga individual; no hay envío directo al sampler, ZIP ni persistencia de resultados.
- Para tienda: ejecutar el empaquetado completo con su configuración de release y probar el ZIP. Se validó la lista de assets y se amplió el smoke check, pero no se generó ni publicó un build de tienda.

No queda un error funcional conocido que impida probar esta milestone en el checkout. La ingeniería inversa del modelo específico de Image-Line sigue pendiente y separada de esta integración.
