# Likes Explorer: almacenamiento, virtualización y colecciones de terceros

Fecha: 2026-09-20. Estado: plan pendiente de implementación.

Este documento responde al pedido de planificar todas las mejoras identificadas en la revisión del 20/09. Esa petición reabre el trabajo de Likes Explorer que documentos del 15/09 daban por cerrado. No implica que las etapas descritas ya estén implementadas.

## Objetivo y alcance

Mantener la vista compacta de seis tracks por fila, el buscador y el diseño actual de Likes Map; reducir trabajo de renderizado, tráfico y almacenamiento; permitir guardar y explorar colecciones de likes propios y ajenos, y preparar su conexión con las descargas existentes.

El usuario identifica un beneficio especialmente fuerte en perfiles ajenos, cuya vista nativa observa como un track por fila. Verificar ambas variantes reales de SoundCloud durante la implementación: no codificar como invariable una disposición externa de la página.

No cambiar la oferta Free/Pro, descargar audio automáticamente, ni reintroducir encabezados, controles de densidad o el slider inferior retirados. Guardar una colección y descargar su audio son acciones diferentes.

## Evidencia y límites de la revisión

| Área | Estado observado | Trabajo pendiente |
| --- | --- | --- |
| Disco | 810.950 bytes en el directorio IndexedDB del origen de esta extensión en Chrome Default | Separar datos de Likes Explorer, otras bases y sobrecarga física; la cifra no es una medición lógica de 1.600 tracks |
| Portadas nuevas | WebP 48×48, calidad 0,55, un Blob por URL y cuenta | Medir tamaños reales; migrar copias antiguas; no confundir calidad con porcentaje de ahorro |
| Portadas antiguas | El cambio de encoder no transforma registros existentes de 48/160 px | Migración reanudable y medición antes/después |
| Lista | Ventana visible con margen y tope de 200 tracks | Evitar reconstrucciones completas y trabajo por desplazamientos dentro de la misma fila |
| Mapa | Ventana con margen y tope de 600 tiles | Reutilizar tiles y agrupar eventos/consultas |
| Imágenes | Fallback remoto antes de terminar la consulta local; caché de 320 entradas | Local primero, peticiones compartidas, caché proporcional a ventanas activas |
| Lectura | `records()` carga todos los tracks y filtra en memoria | Consultas paginadas e índices para orden, búsqueda y navegación |
| Actualización | Se conservan generación nueva y anterior | Retención acotada y limpieza posterior verificable |
| Colecciones | `ownerId` vincula identidad autenticada y biblioteca | Separar sesión, perfil fuente y colección |

No se midieron FPS, percentiles de latencia ni promedio real de bytes por portada. La prueba funcional con 50.000 tracks no demuestra por sí sola rendimiento sostenido. Los ejemplos anteriores de 1–2 KB por imagen eran escenarios matemáticos, no resultados medidos.

## Diseño de módulos

Aplicar módulos profundos: una interface pequeña concentra las invariantes, transacciones y cachés; los consumidores no coordinan manualmente sus detalles. Evitar capas que sólo reenvíen llamadas y adapters hipotéticos.

- **Biblioteca de colecciones:** interface para consultar ventanas, resolver posiciones, sincronizar, medir almacenamiento y eliminar colecciones. Oculta esquema, generaciones, búsqueda y limpieza.
- **Portadas:** interface para resolver lotes visibles, solicitar guardado persistente y liberar consumidores. Oculta lectura local, peticiones compartidas, compresión, migración y presupuesto de memoria.
- **Ventana virtual:** cálculo de rango y reconciliación por identidad. Lista y mapa son consumidores concretos con geometría distinta; compartir sólo lógica que realmente comparten.
- **Fuente de likes:** resolver el perfil objetivo y obtener páginas. Separar la autorización de sesión del perfil cuya colección se consulta.

Conservar funciones puras para geometría y cálculo de rangos. Inyectar reloj, lectura y red cuando resulte necesario para verificar cancelación y carreras; probar resultados observables a través de la interface.

## Etapa 0 — Línea base y medición verificable

Archivos iniciales: `scripts/likes-library.js`, `scripts/likes-jobs.js`, `scripts/likes-explorer.js`, `scripts/likes-explorer.browser-test.js`.

- [ ] Medir por separado cantidad de tracks, entradas por colección/generación, portadas únicas, bytes de Blobs y distribución de tamaño (mínimo, mediana, p95 y máximo).
- [ ] Calcular bytes lógicos de metadatos mediante una serialización documentada; etiquetar esa cifra como estimación, no ocupación física de IndexedDB.
- [ ] Mostrar en Almacenamiento el total lógico estimado, bytes exactos de portadas, promedio y número de portadas pendientes. Separar uso estimado del origen si se usa `navigator.storage.estimate()`.
- [ ] No usar sólo `artworkJobs.bytes` como verdad: contrastarlo con registros persistidos y evitar doble conteo de imágenes compartidas.
- [ ] Instrumentar una sesión con 1.600, 10.000 y 50.000 tracks: nodos montados, consultas, lecturas de imágenes, peticiones remotas, latencia p50/p95, tareas largas y memoria retenida tras cerrar.
- [ ] Registrar navegador, resolución, escala, hardware, duración, caché fría/caliente y muestras. Usar portadas representativas, no únicamente imágenes vacías o de color sólido.

Aceptación: un informe reproducible distingue medición, estimación y límite de alcance. Medir la biblioteca real sólo con acceso disponible; las fixtures nunca se presentan como datos del usuario.

## Etapa 1 — Virtualización de lista y mapa

- [ ] Reconciliar nodos por `trackId`/identidad de entrada; conservar nodos y sus imágenes mientras permanezcan en la ventana. Retirar sólo los que salen.
- [ ] Calcular rangos con margen de filas y presupuesto máximo. Un scroll que no cambie el rango no debe reconstruir nodos ni consultar la biblioteca.
- [ ] Agrupar eventos con `requestAnimationFrame`; sustituir el debounce final de la lista por actualizaciones continuas acotadas que no dejen una ventana vacía durante un scroll sostenido.
- [ ] Compartir consultas en curso para el mismo rango/revisión. Descartar respuestas obsoletas por colección, generación y secuencia; impedir que consultas repetidas pendientes crezcan sin límite.
- [ ] Separar movimiento del indicador y actualización de datos del mapa; evitar el ciclo desplazamiento → reconstrucción → reposicionamiento → nueva consulta redundante.
- [ ] Mantener el ancla por track y desplazamiento relativo al cambiar ancho, filtrar, volver a resultados o recibir una nueva generación.
- [ ] Conservar foco y navegación con teclado cuando un nodo sale de la ventana. Probar Home/End, arrastre, búsqueda sin resultados y última fila incompleta.
- [ ] Mantener seis columnas y al menos cuatro filas completas en las resoluciones de escritorio acordadas, también al seleccionar un track; documentar límites en ventanas pequeñas.

Aceptación: nodos acotados independientemente del total; cero reconstrucciones completas en scroll incremental; cero consultas adicionales al repetir eventos dentro del mismo rango estable. Sin huecos visibles ni saltos de ancla en scroll rápido. Comparar p95 y tareas largas con etapa 0; no afirmar 60 FPS sin medirlos.

## Etapa 2 — Portadas locales primero y caché compartida

- [ ] Resolver la caché local antes de asignar una URL remota. Usar placeholder durante la lectura; fallback remoto sólo tras confirmar ausencia o fallo local recuperable.
- [ ] Deduplicar peticiones en curso por identidad de portada entre lista, detalle y mapa. Registrar ausencias con caducidad/invalidez por revisión para evitar lecturas repetidas sin ocultar imágenes recién guardadas.
- [ ] Proteger las imágenes visibles contra expulsión y aplicar LRU al resto; presupuestar bytes y entradas según ambas ventanas y su margen. El límite fijo actual de 320 no debe causar expulsión de imágenes todavía visibles.
- [ ] Cancelar o invalidar lotes que ya no tienen consumidores; liberar referencias al cerrar, cambiar de colección, borrar portadas o cambiar de cuenta.
- [ ] Evitar buscar todos los `img` del shadow DOM por cada imagen recibida; registrar consumidores por clave de portada.
- [ ] Medir el costo de base64 en mensajería y memoria. Conservarlo si es lo más simple y suficiente; cualquier alternativa con Blob URL debe verificar su acceso entre contextos y revocación.
- [ ] Mantener el consentimiento de guardado persistente; mostrar estado, pausa, errores y reintento en Almacenamiento. Explorar no debe iniciar silenciosamente el guardado de todas las portadas.

Aceptación: con portadas guardadas y caché de memoria fría, ninguna petición de imagen a SoundCloud para esos registros; una resolución en curso por portada; funcionamiento offline con placeholder para ausentes; sin crecimiento sostenido de memoria en recorridos repetidos.

## Etapa 3 — Esquema para múltiples colecciones y migración

Separar `accountId` (identidad autenticada), `sourceUserId` (perfil fuente) y `collectionId` (colección guardada). Toda operación debe validar acceso a la colección independientemente del perfil fuente. No eliminar las comprobaciones de propietario para habilitar terceros.

Modelo propuesto, a concretar con índices y pruebas de consultas antes de migrar:

| Registro | Identidad y contenido |
| --- | --- |
| Colección | `accountId + collectionId`; tipo likes, `sourceUserId`, URL, nombre, fechas de sincronización y generación activa |
| Track | `accountId + trackId`; metadatos compartidos entre las colecciones de esa cuenta |
| Entrada | `accountId + collectionId + generation + trackId`; orden y fecha del like propios de esa colección |
| Portada | `accountId + artworkKey`; URL validada, versión de formato, dimensiones, Blob y bytes |
| Vista / marcador | Colección y track ancla, búsqueda, filtro y desplazamiento; sin modo/densidad obsoletos |
| Trabajo | Cuenta, colección, generación, cursor, progreso y token de validez/reanudación |

Deduplicar dentro de cada cuenta inicialmente. No compartir datos entre cuentas autenticadas sin definir su aislamiento. No colapsar URLs arbitrariamente: parámetros o rutas distintos pueden identificar imágenes diferentes. Un track presente en varias colecciones debe conservar fechas y posiciones distintas en cada una.

- [ ] Crear stores e índices nuevos mediante upgrade breve y copiar registros por lotes fuera de una transacción larga de upgrade.
- [ ] Migrar la biblioteca propia existente a una colección conservando anclas, bookmarks, filtros y progreso válido.
- [ ] Hacer la copia idempotente con checkpoints y validación de conteos, referencias y orden. Marcar la nueva representación activa sólo al completar la verificación.
- [ ] Definir qué versión puede abrir la base migrada; rollback de aplicación no equivale a poder reducir la versión de IndexedDB. Mantener una ruta documentada de recuperación antes de retirar datos heredados.
- [ ] Ante cierre, interrupción o cuota insuficiente, reanudar o conservar la representación anterior legible; nunca presentar una biblioteca parcial como completa.

Aceptación: fixtures de biblioteca antigua, vacía, incompleta y con varias generaciones migran sin perder orden, anclas o portadas. Dos colecciones con tracks compartidos almacenan una copia de sus metadatos y portadas por cuenta. El cambio de cuenta no expone colecciones ajenas.

## Etapa 4 — Lecturas paginadas y búsqueda acotada

- [ ] Sustituir `tracks().getAll()` en rutas interactivas por ventanas de lectura sobre índices de colección/generación/ordinal.
- [ ] Resolver posición por track mediante índice, sin `find()` o `findIndex()` sobre toda la biblioteca para cada portada o salto.
- [ ] Mantener totales y períodos por generación sin reconstruirlos en cada consulta de ventana. Enviar períodos sólo cuando cambien o se soliciten.
- [ ] Separar la consulta sin filtro, que debe usar índices directos, de la búsqueda textual. Preservar la semántica actual de coincidencias en título/artista.
- [ ] Implementar búsqueda cancelable por lotes, con normalización reutilizable y caché limitada por colección/revisión; indexar términos sólo si las mediciones lo justifican. Evitar que un índice de tokens cambie accidentalmente la búsqueda por fragmentos.
- [ ] Acotar cachés por bytes/colecciones activas e invalidarlas al publicar una nueva generación. Documentar consistencia y orden de resultados durante una búsqueda.

Aceptación: consultar el final de 50.000 tracks sin filtro no carga todos sus metadatos; búsqueda devuelve los mismos resultados esperados y se cancela al cambiar de consulta; navegar múltiples colecciones no mantiene todas en memoria.

## Etapa 5 — Compresión heredada y limpieza segura

- [ ] Versionar el formato de portada. Migrar imágenes antiguas por lotes reanudables; reutilizar la miniatura de 48 px y retirar la variante de 160 px cuando la pequeña esté validada.
- [ ] No recomprimir repetidamente WebP con pérdida. Comparar ahorro y legibilidad antes de convertir una miniatura antigua a calidad 0,55; priorizar eliminar la copia grande redundante.
- [ ] Medir la legibilidad de 48 px tanto en mapa como en tarjetas mayores y pantallas de alta densidad. Si no alcanza, comparar una variante única alternativa con su costo real antes de decidir.
- [ ] Publicar la nueva generación de la colección de forma atómica y retirar la anterior después de que las lecturas en curso terminen o sean invalidadas. Definir una retención explícita, no indefinida.
- [ ] Limpiar generaciones abandonadas y trabajos obsoletos por lotes; nunca borrar la generación activa ni una sincronización vigente.
- [ ] Recoger tracks y portadas huérfanos sólo tras comprobar referencias de todas las colecciones de esa cuenta, incluidos trabajos en curso. Coordinar limpieza con escrituras concurrentes.
- [ ] Recalcular contadores tras migración y limpieza. Diferenciar ahorro lógico inmediato de liberación física de archivos que Chrome puede compactar más tarde.
- [ ] Aplicar presupuesto de almacenamiento a la cuenta completa y no 200 MB independientes por cada colección nueva; pausar y reanudar con estado claro al alcanzar cuota.

Aceptación: actualizar o eliminar una colección no rompe las portadas de otra; cortes de proceso durante migración/limpieza no pierden datos activos; el espacio lógico no crece sin límite después de sincronizaciones repetidas sin cambios.

## Etapa 6 — Explorer en likes de terceros

Archivos de integración: `scripts/likes-explorer.js`, `scripts/likes-jobs.js`, `scripts/soundcloud-likes-source.js`, `scripts/page-intake.js`, `scripts/soundcloud-likes-locator.js`, `scripts/likes-popup.js` y entradas existentes del popup/player.

- [ ] Resolver el perfil desde la ruta/hidratación existente; habilitar `/you/likes` y `/<perfil>/likes`, incluidas transiciones SPA y apertura desde popup/player sobre la colección actual.
- [ ] Reutilizar la extracción de perfiles y likes ajenos existente en `page-intake.js`; verificar comportamiento y acceso reales antes de depender de endpoints o datos de hidratación.
- [ ] Pasar el perfil fuente explícitamente al trabajo: revisar el orden de propagación de campos para que `accountId`/contexto no sobrescriban `sourceUserId`.
- [ ] Hacer visible de quién es la colección en un selector compacto que también permita volver a colecciones guardadas, sin restaurar el encabezado grande eliminado.
- [ ] Guardar, actualizar, pausar, reanudar y eliminar cada colección independientemente. Conservar su último lugar y estado de búsqueda.
- [ ] Limitar concurrencia y respetar errores de red/rate limit; una colección fallida no debe bloquear las demás. No explorar perfiles adicionales automáticamente.
- [ ] Gestionar perfiles renombrados por ID estable, cuentas no disponibles y likes inaccesibles; informar el estado sin borrar silenciosamente la copia local.
- [ ] Adaptar localización del track y selección a las variantes nativas de lista/grilla. No asumir exclusivamente `a.soundTitle__title` ni confundir fecha del like con publicación del track.

Aceptación: alternar likes propios y de dos terceros conserva identidad, contenido, fechas y ancla correctos; cambio de cuenta o ruta durante una respuesta no mezcla registros; abrir una colección ya guardada permite consultar su índice local sin reindexarla completa.

## Etapa 7 — Conectar colecciones guardadas con descargas

Archivos a evaluar: `scripts/page-intake.js`, `scripts/download-intent.js`, `scripts/download-track.js`, `scripts/bulk-job-manager.js` y rutas de mensajes existentes.

- [ ] Definir una interface de selección que entregue IDs y orden de la colección o resultados filtrados; diferenciar explícitamente descargar selección, resultados o colección completa.
- [ ] Fijar la generación/selección del trabajo para que una actualización simultánea no cambie qué canciones se descargarán. Leer selección grande por lotes, sin un mensaje gigante.
- [ ] Entregar la selección al flujo de descarga existente y obtener datos reproducibles vigentes al ejecutar; el índice no guarda tokens, URLs firmadas, streams ni audio.
- [ ] Reutilizar cola, destino, nombres, metadata, cancelación y reanudación. Las miniaturas de Explorer no sustituyen automáticamente las portadas destinadas al archivo de audio.
- [ ] Tratar tracks borrados, no disponibles o repetidos entre colecciones con resultados explícitos y política de duplicados coherente con las descargas actuales.

Aceptación: una selección de likes de terceros genera un trabajo con el orden y cantidad esperados; se reanuda sin duplicar completados; cambios en la colección no alteran el trabajo; no se descarga nada por guardar o abrir una colección.

## Orden de ejecución y verificación

1. Medir etapa 0 y guardar evidencia antes/después en `test-results/` o un informe referenciado.
2. Implementar etapas 1 y 2 sobre el esquema actual, validando navegación y portadas locales.
3. Definir y migrar el esquema de etapa 3; implementar consultas y limpieza de etapas 4 y 5 sobre ese esquema para evitar dos migraciones incompatibles.
4. Habilitar terceros en etapa 6; integrar descargas en etapa 7 como entrega diferenciada.
5. Actualizar documentación, traducciones necesarias y empaquetado sólo cuando las nuevas rutas y módulos estén incorporados y verificados.

Usar `npm.cmd run test:e2e:likes` para regresión de Explorer y verificaciones específicas de persistencia, migración y descargas según cada etapa. Ejecutar `npm.cmd test` en la integración final, registrando fallos externos por separado. El fallo de avatar del popup observado el 20/09 es un antecedente que debe volver a comprobarse, no una excepción permanente.

Ampliar pruebas sólo para riesgos concretos: migraciones interrumpidas, colisiones de cuentas/colecciones, red redundante, nodos acotados, búsquedas obsoletas, GC con referencias compartidas y reanudación. Una fixture visual sin portadas no valida la ruta de caché ni el peso real.

El plan se considera completado cuando las siete etapas tienen evidencia, las métricas están publicadas con su contexto, la biblioteca heredada se conserva o migra correctamente, y colecciones propias y ajenas pueden explorarse y alimentar las descargas sin duplicar innecesariamente datos.
