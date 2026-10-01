# Viabilidad de separación de stems en Chrome

**Actualización de implementación:** la alternativa StemSplitio se integró y pasó inferencia real en la extensión. Ver [milestone y resultados](loop-stems.md). Este informe conserva la investigación previa; sus menciones de candidatos sin validar describen el estado al investigarlos, no el cierre de la integración.

Consulta de fuentes primarias: 2026-09-30. Este informe evalúa una ruta técnica; no acredita que el modelo instalado de Image-Line se haya convertido o ejecutado en el navegador.

## Conclusión

Es viable construir una aplicación JavaScript que ejecute un **modelo ONNX compatible** mediante ONNX Runtime Web y WebGPU o WebAssembly. Esto requiere el grafo y los pesos del modelo, además del procesamiento de audio. No equivale a traducir un ejecutable Windows a JavaScript. La documentación ofrece inferencia ONNX desde JavaScript; la compatibilidad del archivo local concreto debe demostrarse por separado. [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)

## Conversión y validación

- PyTorch documenta `torch.onnx.export` y acepta módulos PyTorch, programas exportados y TorchScript en su API. El exportador moderno usa `torch.export`; la selección de exportador, entradas de ejemplo y opset depende del artefacto. La existencia de esta API no demuestra que cualquier TorchScript sea exportable. [Exportación ONNX](https://docs.pytorch.org/docs/2.14/onnx.html)
- WebGPU implementa un subconjunto de operadores ONNX. Hay que comparar los operadores, tipos y versiones del grafo convertido contra la versión de runtime elegida, y ejecutar una inferencia real. [Operadores WebGPU](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md)
- Plan de ingeniería propuesto: identificar tensores de entrada/salida; reproducir frecuencia de muestreo, normalización, segmentación y reconstrucción; comparar una misma señal en el motor original y el convertido; medir error numérico, continuidad entre segmentos, memoria y tiempo. Si el grafo contiene operaciones espectrales o complejas incompatibles, evaluar su descomposición o moverlas a procesamiento de audio externo al grafo. Esta última opción es una hipótesis de implementación, no una conversión verificada.

## Integración en Manifest V3

- Empaquetar JavaScript y WASM del runtime en la extensión: Chrome considera ambos código y restringe el código alojado remotamente. No seguir los ejemplos de CDN de una aplicación web sin adaptarlos al paquete MV3. [Código remoto](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- Habilitar WebAssembly mediante `content_security_policy.extension_pages` con `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`. La política predeterminada no permite WASM. [CSP de extensiones](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- Mantener los archivos JS y WASM de la misma compilación. Para una primera prueba reproducible, usar WASM con un hilo; el modo multihilo requiere soporte del navegador y `crossOriginIsolated`. El proxy WASM incorporado no funciona con WebGPU y puede ser bloqueado por CSP; un worker empaquetado explícitamente es la alternativa a evaluar. [Configuración del runtime](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- Propuesta: ejecutar la separación en una página de extensión abierta por el usuario, con un worker dedicado, progreso y cancelación. Evitar depender exclusivamente de variables del service worker: Chrome puede terminarlo y descartar su estado. [Ciclo de vida](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- El tamaño del archivo no representa toda la memoria necesaria. La documentación de ORT describe límites del protobuf, buffers del navegador y memoria WASM de 32 bits; los pesos externos necesitan configuración explícita en el navegador. Medir también activaciones, audio y copias intermedias. [Modelos grandes](https://onnxruntime.ai/docs/tutorials/web/large-models.html)

## Identidad y licencia del modelo

Image-Line confirma separación en voz, música, bajo y batería en FL Studio. La publicación consultada no identifica el archivo de pesos instalado ni concede explícitamente su redistribución en otra extensión. No se encontró en estas fuentes una licencia específica de redistribución de ese artefacto; esto queda pendiente de los avisos incluidos en la instalación y de su procedencia. [Anuncio oficial](https://www.image-line.com/fl-studio-news/fl-studio-21-2-whats-new)

El repositorio oficial de Demucs publica arquitectura, modelos y una licencia MIT, pero eso no demuestra que un archivo distribuido por Image-Line sea idéntico ni que sus modificaciones tengan esos mismos términos. Si se elige Demucs como base alternativa, registrar el origen y la licencia del artefacto exacto y conservar sus avisos. El repositorio también describe audio estéreo a 44,1 kHz, separación por segmentos y solapamiento, detalles útiles para construir una referencia reproducible. [Demucs oficial](https://github.com/facebookresearch/demucs)

## Criterio de finalización

Un adaptador JS que admite un modelo aún no constituye un separador terminado. Se considerará integración funcional cuando el modelo identificado y convertido genere stems válidos en Chrome, con una prueba de audio real, comparación con la referencia, empaquetado MV3 probado y consumo de recursos medido. Este informe no incluye esos resultados experimentales.

## Candidatos existentes para ejecución totalmente en Chrome

Segunda investigación: fuentes de los propios mantenedores, sin descargar pesos ni ejecutar sus modelos. Los contratos siguientes están documentados por esos proyectos; no son contratos del extractor de Image-Line.

| Candidato | Tamaño publicado | Contrato y runtime | Evidencia de licencia |
| --- | --- | --- | --- |
| StemSplitio `htdemucs_fp16weights.onnx` | ~166 MB; versión fp32 ~316 MB | `mix` float32 `[1,2,343980]` a 44.100 Hz; `stems` float32 `[1,4,2,343980]`, orden batería, bajo, resto, voz. La tarjeta muestra ONNX Runtime Web WASM. | La tarjeta del distribuidor declara MIT. [Modelo y contrato](https://huggingface.co/StemSplitio/htdemucs-onnx) |
| timcsy `htdemucs_embedded.onnx` | 181 MB en el listado de archivos; README indica ~172 MB | ONNX Runtime Web WebGPU/WASM; requiere forma de onda y espectrograma, con STFT/iSTFT en JavaScript. | Código con MIT; el repositorio de pesos consultado carece de tarjeta. [Proyecto](https://github.com/timcsy/demucs-web), [licencia del código](https://raw.githubusercontent.com/timcsy/demucs-web/main/LICENSE), [pesos y tamaño](https://huggingface.co/timcsy/demucs-web-onnx/tree/main) |
| monteslu `htdemucs-web-onnx` | ~126 MB totales según tarjeta | 21 grafos encadenados, precisión mixta y WebGPU; requiere normalización seleccionada en CPU y STFT externa. | La tarjeta declara MIT y procedencia de HTDemucs oficial. [Modelo](https://huggingface.co/monteslu/htdemucs-web-onnx) |
| bakkot `demucs-js` | 166 MB en [Git LFS](https://github.com/bakkot/demucs-js/blob/main/htdemucs.onnx) | Port JavaScript/ONNX con demo web y WebGPU; extrae operaciones del grafo para ejecutarlas en el wrapper. | Su licencia distingue código MIT de pesos para uso personal/investigación; no tratar el paquete completo como MIT. [Proyecto](https://github.com/bakkot/demucs-js), [aviso específico](https://raw.githubusercontent.com/bakkot/demucs-js/main/LICENSE.md) |

**Primera opción técnica a ensayar: StemSplitio de cuatro stems**, por ofrecer un único grafo con entrada y salida de audio, sin implementar STFT externa. Su variante de pesos fp16 sigue calculando en fp32; el menor archivo no implica menor memoria de inferencia. La exportación incorpora operaciones espectrales mediante convoluciones. Son declaraciones del mantenedor, pendientes de reproducción local. [Tarjeta del modelo](https://huggingface.co/StemSplitio/htdemucs-onnx)

Su demo procesa segmentos fijos de 7,8 segundos mediante solapamiento y suma ponderada. Para la extensión habría que empaquetar el runtime en lugar de usar su CDN y comprobar extremos del audio, silencio y cancelación. El ejemplo de ventana comienza en cero; conviene probar expresamente la primera muestra para no perderla por peso nulo. Esto es una observación del ejemplo, no un ensayo de calidad del modelo. [Implementación de navegador](https://stemsplit.github.io/demucs-onnx/browser/)

**Contrato espectral de timcsy**, confirmado en su código: forma de onda `[1,2,343980]`, espectrograma `[1,4,2048,336]`; los cuatro canales espectrales son real izquierdo, imaginario izquierdo, real derecho e imaginario derecho. FFT 4096, salto 1024 y solapamiento 25 %. El wrapper asigna entradas por orden de `session.inputNames` y detecta salidas por rango/dimensiones; para una integración robusta convendría fijar nombres y validar dimensiones del archivo seleccionado. La salida temporal se suma a la iSTFT de la rama espectral. [Procesador](https://raw.githubusercontent.com/timcsy/demucs-web/main/src/processor.js), [constantes](https://raw.githubusercontent.com/timcsy/demucs-web/main/src/constants.js)

En monteslu, las entradas iniciales se llaman `mix` y `mag` con esas mismas dimensiones; las salidas finales son `x` `[1,4,4,2048,336]` y `xt` `[1,4,2,343980]`. Su propuesta distribuye el trabajo entre 21 sesiones para reducir bloqueos visuales. La tarjeta exige seleccionar nodos de normalización en CPU y administrar tensores GPU; supone más complejidad que el grafo único. Sus cifras de rendimiento son del autor y de su GPU, no de esta extensión. [Contrato y requisitos](https://huggingface.co/monteslu/htdemucs-web-onnx)

**Diferencia documental pendiente sobre pesos:** los distribuidores anteriores no describen todos los términos de la misma manera. Meta publica MIT en su repositorio, StemSplitio y monteslu etiquetan sus conversiones MIT, mientras bakkot excluye explícitamente los pesos de su MIT. Registrar esa discrepancia evita afirmar que la licencia del código cubre automáticamente cualquier descarga de pesos; no prueba por sí sola una restricción universal de Demucs. [Licencia original publicada](https://raw.githubusercontent.com/facebookresearch/demucs/main/LICENSE), [aviso de bakkot](https://raw.githubusercontent.com/bakkot/demucs-js/main/LICENSE.md)
