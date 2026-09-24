# 08 — Ideas preservadas y alcance cerrado

> **BACKLOG ABIERTO; cierre histórico acotado — revisión 24/09/2026 (`29d7946`).** La exclusión de Explorer del 15/09 no cancela el plan de optimización reabierto el 20/09. V1 y A/B ya existen; random/compartir y otras ideas no se declaran implementadas. El nombre del archivo conserva el antecedente, no un cierre global. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Este archivo evita perder partes de la conversación. **Todo lo de Likes Explorer queda mitigado/cerrado para esta entrega por instrucción actual del usuario.** Los apartados de random/share no son trabajo nuevo asignado, ni cuestionan qué ya implementó el usuario en otra rama.

## Likes Explorer: registro de lo mencionado

Galería por años y meses, fecha del like distinta de fecha del track, lista virtualizada, caché de imágenes, búsqueda de likes viejos, favoritos propios/ajenos y entradas desde player/perfil/popup: no reconstruir ni rediseñar ahora. Mantener el acceso comercial existente; el consejo antiguo de hacerlo Free no se adopta.

Si al ejecutar un video o publicación no aparece en este checkout, localizar la versión implementada. Eso bloquea únicamente esa grabación o claim, no obliga a reiniciar todo el proyecto.

### Random: explicación sencilla que pidió el usuario

“En tu experiencia con SoundCloud web, el aleatorio salta entre canciones cercanas que la página ya cargó. Un aleatorio de toda tu biblioteca puede elegir cualquiera de tus 1.500 Likes, incluso uno de hace años.”

La ventana de aproximadamente diez tracks es una observación del usuario, no un algoritmo interno de SoundCloud verificado. Si el índice está incompleto, decir “aleatorio entre los Likes indexados”, no “toda tu biblioteca”.

Dos productos distintos del texto:

- **Redescubrir uno:** pulsar un botón y elegir un track de todo el índice/contexto seleccionado. Es simple, demostrable y no controla toda la cola.
- **Shuffle continuo:** mantener una permutación/bolsa sin reemplazo y avanzar automáticamente al terminar cada canción, con tratamiento de anuncios, autoplay, loops, skips, tracks eliminados, cambio manual y renovación de biblioteca. Es mucho más trabajo; no prometerlo porque exista el primer botón.

Si alguna vez se reabre: distribución aproximadamente uniforme, historial acotado para evitar repetición inmediata, sin reconstruir el índice por click y sin descargar audio para elegir. Probar también biblioteca pequeña/vacía y contextos filtrados.

### Compartir años o el Like más antiguo

Idea original preservada: imagen local con nueve covers, año, cantidad de Likes y marca discreta; `Copiar imagen` o guardar archivo. Alternativa “Mi Like más antiguo: 2012”. No publicar automáticamente.

Reabrir sólo si no está ya resuelto y el usuario lo prioriza. Habría que contemplar portadas que no cargan, canvas/CORS, permisos de clipboard, fallback a guardar y conteo/fecha desconocidos. No filtrar datos de perfiles privados ni incluir un año inventado. El click de compartir no demuestra que se publicó ni que atrajo installs.

## Herramientas futuras fuera de Likes

### A/B rápido desde el player

A marca el inicio en el momento actual; B marca el final unos segundos después y activa la repetición. Ejemplo: A en 00:42 y B en 00:50 → repetir esos ocho segundos. No es comparar “audio A versus audio B”; es el rango del loop. Si ya existe, sólo mejorar descubrimiento, no duplicar botones.

Hito futuro: entradas conectadas al mismo controlador de sesiones, con A solo sin consumo y B válido consumiendo una nueva sesión según trial. Casos: B antes de A, duración inválida, cambio de track entre marcas y respuesta tardía.

### Copiar timestamps / URL del loop

Versión simple: copiar `Artista — Track, 00:42–00:50` y el enlace normal del track. Sirve para compartir dónde está el fragmento, pero **no reconstruye el loop automáticamente**.

Un enlace que reconstruya A/B requiere un formato propio, parser y una extensión receptora compatible. No agregar parámetros arbitrarios y asegurar que SoundCloud los entiende. No transportar entitlement ni autoplay. Priorizar copiar texto antes de crear infraestructura de enlaces compartidos.

### Atajos de teclado

Entera pero futura, como se pidió. Definir acciones, foco, conflictos con SoundCloud, entradas de texto y accesibilidad. Atajos llaman las mismas capacidades; jamás una ruta alternativa para saltar gates. Probar layout internacional y permitir desactivarlos.

### Pitch / Vinyl Mode

Antecedente del plan del 12/09: slider alternable entre x y semitonos enteros, posible Vinyl Mode compacto. Diferir hasta separar con claridad pitch ligado a velocidad de pitch independiente y verificar procesamiento vivo/export. No vender ahora una transposición que el motor no hace.

## Qué no priorizar ahora

- Más FX como compressor, flanger, chorus o una suite DAW. La protección interna de salida no es una nueva feature comercial.
- Móvil o Firefox antes de validar venta y retención en Chrome.
- Red social, recomendaciones IA, backend enorme o sync de biblioteca.
- Suscripción para reemplazar el lifetime sin una razón nueva de producto.
- Extensiones separadas por feature ni duplicados para ocupar resultados de Store.
- Marketing de “sampler completo” si sólo se ofrecen loops y exportación.

Motivo común: cada uno añade coste, soporte y distribución antes de haber medido el recorrido comercial actual. Mantener foco en SoundCloud y sus tareas reales.

## Regla para reabrir backlog

Elegir una idea con evidencia concreta: petición repetida, uso observado o oportunidad de contenido medible. Definir un resultado mínimo y coste, comparar con mejoras del checkout/retención y cerrar esa entrega antes de abrir varias nuevas. No convertir este archivo en una obligación de implementar todo.
