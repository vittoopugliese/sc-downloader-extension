# Plan de mejora arquitectónica

Fecha: 2026-09-05
Base: `e63fbba`

## Objetivo

Reducir repetición y complejidad en los archivos principales sin eliminar ni alterar features actuales. La medida de éxito no será cuántos archivos se crean, sino cuánto comportamiento queda detrás de una interface pequeña, cuánto bajan los callers y cuánta lógica vieja se elimina.

Prioridades:

1. Facilitar nuevos puntos de descarga y nuevos tipos de página de SoundCloud.
2. Reducir de forma visible `content.js`, `background.js` y `bulk-job-manager.js`.
3. Mantener Track, playlist, likes, user tracks, player global, popup, inline, formatos y destinos actuales.
4. Aumentar locality y leverage sin introducir modules shallow.

## Situación actual

| Archivo | Líneas | Fricción principal |
|---|---:|---|
| `scripts/content.js` | 1.534 | Routing, hydration, client ID, cuatro intake paths, paginación, retries, freshness, cache y mensajería. |
| `scripts/background.js` | 628 | Routing, auth, requests, errores, refresh y normalización parcial de Track. |
| `scripts/bulk-job-manager.js` | 834 | Estado durable, loop, persistencia, efectos y transiciones repetidas. |
| `scripts/stream-selector.js` | 363 | Interface amplia con callbacks y detalles del transporte. |
| `scripts/popup.js` | 1.290 | Presentación y construcción de comandos de descarga. |
| `scripts/inline-button.js` | 790 | Presentación y construcción de comandos de descarga repetida. |

Los dos refactors anteriores quitaron 179 líneas de `bulk-job-manager.js`, pero agregaron 257 líneas productivas en `track-download-execution.js` y `download-destination.js`: saldo aproximado de `+80` líneas productivas. Esos seams tienen depth porque evitan que la secuencia y los dos adapters de destino vuelvan a los callers, pero la etapa de reemplazar y borrar quedó incompleta.

## Reglas de ejecución

### Replace, don't layer

Una fase no se considera terminada si sólo agrega un module nuevo.

Para cerrar cada fase deben cumplirse las cuatro condiciones:

- El nuevo module reemplaza los paths anteriores.
- Los callers principales pierden ramas y conocimiento.
- El código productivo neto baja según la meta de la fase.
- Los tests validan la interface nueva y se eliminan tests que sólo inspeccionen la implementation anterior.

### Deletion test

Antes de crear un seam se pregunta: si borramos el module, ¿la complejidad reaparece en varios callers?

- Si reaparece, el module aporta depth, leverage y locality.
- Si sólo devuelve unas pocas funciones auxiliares a un caller, sería shallow y no se crea.

### Protección de features

No se elimina un path por parecer obsoleto. Primero se buscan todos sus callers, se cubre el comportamiento observable y recién después se borra.

## Fase 0 — Safety net de comportamiento

Objetivo: poder reemplazar implementation sin depender de inspecciones internas.

### Trabajo

- Inventariar los comportamientos actuales por punto de descarga:
  - página Track;
  - playlist;
  - likes públicas;
  - `/you/likes` con OAuth;
  - user tracks;
  - player global desde una página no-Track;
  - botón inline;
  - popup;
  - selección manual y límites bulk;
  - Downloads y directorio elegido;
  - progressive, HLS y original.
- Agregar fixtures de hydration y respuestas de SoundCloud para cada tipo de página.
- Agregar escenarios de navegación SPA rápida, retry y descarte de resultados stale.
- Agregar una matriz de fuente: public/OAuth × progressive/HLS/original × 401/403/404.
- Agregar escenarios del job: complete, partial failure, pause/resume, cancel con dos descargas activas y recovery tras reiniciar el worker.

### Gate

- Todos los checks actuales continúan pasando.
- Los nuevos tests fallan si se rompe cualquiera de los comportamientos inventariados.
- No hay cambios productivos en esta fase.

## Fase 1 — Download Track canónico

Objetivo: que todo punto de descarga consuma la misma representación de Track.

### Problema

Track se proyecta de forma distinta en:

- `content.js` al leer hydration;
- `background.js` al hacer refresh;
- `bulk-job-manager.js` al persistir un job;
- `popup.js` e `inline-button.js` al construir comandos.

Los callers conocen simultáneamente `artwork_url`, `coverUrl`, campos de stream, `clientId`, `trackAuthorization`, disponibilidad y metadata. La interface informal es amplia y shallow.

### Deepening

- Crear un deep module dueño de la normalización, invariantes y proyección durable del Download Track.
- Mantener hydration, refresh y colecciones como entradas detrás del seam.
- Migrar un caller por vez y borrar inmediatamente su mapping anterior.
- Conservar lectura de snapshots de jobs previos durante una ventana de migración.
- Eliminar la dualidad `artwork_url`/`coverUrl` fuera del module cuando todos los callers hayan migrado.

### Deletion target

- Borrar los mappings duplicados de `content.js` y `background.js`.
- Borrar la selección manual de campos de `bulk-job-manager.js`.
- Borrar payloads repetidos de collection metadata en popup e inline.
- Reducción neta esperada: 100–160 líneas productivas.

### Gate

- Equivalencia entre Track creado desde hydration y desde refresh.
- Persistencia y recovery de jobs anteriores.
- Metadata ID3/M4A, artwork, formatos y original download sin cambios.
- El deletion test confirma que las invariantes reaparecerían en varios callers sin este module.

## Fase 2 — SoundCloud Page Intake

Objetivo: reducir `content.js` a lifecycle SPA, adaptación DOM/Chrome y muy poca coordinación.

### Problema

Actualmente se repiten:

- cuatro esqueletos de extracción;
- tres schedulers de retry;
- tres ladders de routing por tipo de página;
- checks de `activeExtractionId`, URL actual e `isExtracting`;
- fetch, hydration, publicación y limpieza;
- buena parte de la paginación de likes y user tracks.

Agregar un nuevo tipo como reposts, albums o sets de otra vista obliga a tocar varias zonas no locales.

### Deepening

- Crear un deep Page Intake module que posea identidad, hydration, client ID, preview/full collection, paginación, retry y freshness.
- Mantener la knowledge de Track, playlist, likes y user tracks dentro de su implementation.
- Hacer que listener, navegación SPA, inicialización, popup y player consuman el mismo resultado normalizado.
- Migrar verticalmente, preservando un tipo de página por vez.
- Una vez migrado el último tipo, borrar los extractores, schedulers y ladders viejos en el mismo cambio.

### Orden seguro de migración

1. Track page.
2. Playlist.
3. Likes públicas.
4. Likes personales con OAuth.
5. User tracks.
6. Player global.
7. Lifecycle SPA y mensajería.

### Deletion target

- `content.js`: 1.534 → 250–400 líneas.
- Nuevo Page Intake module: estimado 850–1.050 líneas.
- Reducción neta esperada: 180–300 líneas productivas.
- Cero `if/else` repetidos por tipo de página fuera del module.

### Gate

- Todos los fixtures de la fase 0 producen los mismos resultados normalizados.
- Se preservan orden, deduplicación, preview de 50 y progreso bulk.
- Un resultado de una URL anterior nunca reemplaza el estado actual.
- Un nuevo tipo de página requiere cambiar una sola implementation local.
- El deletion test confirma que routing, retry, freshness y paginación reaparecerían en todos los tipos sin este module.

## Fase 3 — Download Source profundo

Objetivo: concentrar elección de formato, original, autenticación, refresh y significado de errores.

### Problema

`stream-selector.js` expone callbacks, `urlKey` y detalles que los callers deben coordinar. `background.js` repite loops public/OAuth, headers y traducción de 401/403/404 para stream, original y refresh. `bulk-job-manager.js` adapta manualmente varios campos hacia ese flujo.

### Deepening

- Profundizar Download Source para que posea:
  - preferencia de formato;
  - original versus transcode;
  - fallback public/OAuth;
  - refresh de streams vencidos;
  - errores con significado estable.
- Mantener el acceso HTTP de SoundCloud como adapter productivo y un mock adapter para tests.
- Absorber la coreografía que hoy vive entre `stream-selector.js`, `background.js` y `bulk-job-manager.js`.
- Borrar mensajes internos legacy sólo después de demostrar que no tienen caller.

### Deletion target

- Eliminar `setStreamDependencies` y `resolveStreamForTrack`.
- Eliminar callback choreography y `urlKey` de la interface.
- Eliminar loops de auth y headers repetidos.
- `background.js`: reducción esperada de 250–350 líneas.
- `bulk-job-manager.js`: reducción esperada de 30–50 líneas.
- Reducción neta esperada: 100–200 líneas productivas.

### Gate

- La matriz completa de fuentes y errores pasa.
- Se conserva el orden exacto de intentos public/OAuth.
- Refresh sólo ocurre en errores retryable.
- Los mensajes de error visibles mantienen su significado.
- El deletion test confirma que auth, fallback, refresh y errores reaparecerían en cada fuente sin este module.

## Fase 4 — BulkJobManager como durable state machine

Objetivo: profundizar el module dentro del archivo existente, sin agregar otro archivo productivo.

### Problema

Success, failure, finalize, pause, resume y cancel repiten:

`load → validate → mutate → save → badge → notify/broadcast`

Además, la interface pública expone helpers que ningún caller productivo necesita: carga, guardado, snapshot, sanitización, badge y estado interno del loop.

### Deepening

- Concentrar las transiciones legales y sus efectos en un mutation pipeline privado.
- Mantener storage, badge, notifications y offscreen como adapters internos sólo donde realmente varían.
- Reducir la interface pública a comportamiento de negocio.
- Mantener `track-download-execution.js` y `download-destination.js` como collaborators internos; superan el deletion test y no deben recibir otra fachada encima.
- Unificar cleanup de finalize y cancel sin cambiar su semántica.

### Deletion target

- `bulk-job-manager.js`: 834 → 630–710 líneas.
- Eliminar los seis helpers innecesarios de la interface pública.
- No crear otro module público para el state machine.

### Gate

- `MAX_IN_FLIGHT = 2` se conserva.
- Pause no cancela descargas activas.
- Cancel aborta builds y no guarda resultados posteriores.
- Recovery no inicia loops duplicados.
- Partial failure termina correctamente cuando al menos una pista se guarda.
- Badge, notification y cierre offscreen ocurren exactamente una vez.

## Fase 5 — Intención de descarga compartida por las UIs

Objetivo: que agregar otro botón o punto de descarga no copie reglas de negocio.

### Problema

Popup, inline, collection inline y player global repiten elegibilidad, preferencia, payload, inicio de job y traducción de errores. Cada UI debe conocer demasiado de la interface de background.

### Deepening

- Crear un deep module compartido que concentre intención de descarga y comando normalizado.
- Mantener en cada UI únicamente confirmación, texto y estados visuales.
- Ocultar el seam de transporte con un runtime adapter productivo y un mock adapter para tests.
- No mover DOM ni estilos al module compartido.

### Deletion target

- Reducción neta esperada: 100–180 líneas entre `popup.js` e `inline-button.js`.
- Un futuro punto de descarga reutiliza el module sin copiar validación ni payload.

### Gate

- Destino elegido, formatos, límites, selección manual, timeout del player y mensajes de job activo se conservan.
- Los tests del module no requieren DOM completo.
- El deletion test confirma que las reglas reaparecerían en al menos cinco callers sin este module.

## Modules que no se deben crear

- `page-routes.js` con sólo predicados: sería shallow.
- Un router genérico de mensajes que sólo reenvíe handlers: interface grande y poca depth.
- Un archivo separado por cada fetch, cache o scheduler.
- Otra fachada encima de Track Execution o Download Destination.
- Un adapter de offscreen aislado mientras exista una sola implementation real.

## Verificación al cerrar cada fase

1. Ejecutar todos los `scripts/verify-*.js` disponibles.
2. Ejecutar `node --check` sobre todos los JavaScript.
3. Ejecutar los dos escenarios Playwright cuando la dependencia esté instalada.
4. Cargar la extensión sin empaquetar y recorrer manualmente la matriz de features de la fase 0.
5. Ejecutar `git diff --check`.
6. Comparar líneas productivas antes/después.
7. Buscar que no coexistan el path nuevo y el path anterior.
8. Confirmar que el working tree sólo contiene cambios de la fase.

## Metas finales

| Archivo | Actual | Meta |
|---|---:|---:|
| `scripts/content.js` | 1.534 | 250–400 |
| `scripts/background.js` | 628 | 180–280 |
| `scripts/bulk-job-manager.js` | 834 | 630–710 |
| `scripts/stream-selector.js` | 363 | absorbido o ≤120 |
| `scripts/popup.js` + `scripts/inline-button.js` | 2.080 | −100/180 netas |

Meta global conservadora: eliminar 500–800 líneas productivas netas, aumentar test coverage sobre interfaces profundas y hacer que un nuevo punto de descarga toque una sola ruta de intake y reutilice Download Track, Download Source y la intención de descarga.

## Próximo paso recomendado

Comenzar por la fase 0 y luego ejecutar la fase 1. El Download Track canónico reduce el riesgo de mover mappings inconsistentes durante Page Intake. Después, la fase 2 produce la contracción visible más grande: `content.js` deja de ser el lugar donde se implementa cada tipo de página completo.
