# Auditoría de arquitectura y confiabilidad — 21/09/2026

> **DIAGNÓSTICO HISTÓRICO — revisión 24/09/2026 (`29d7946`).** Base `404fbd9`: recovery sin sesión, contexto, retención, retry y anuncios recibieron fixes posteriores. No repetirlos a partir de este veredicto. Matriz integral y selección manual a escala siguen en el plan de cierre. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

## Contenido histórico de la base indicada

Base: `404fbd9`. Rango: `HEAD~10..HEAD`. El árbol estaba limpio al comenzar.

## Resultado

La migración a IndexedDB y los límites de HTTP mejoran la base, pero la recuperación todavía no es durable de extremo a extremo. Los problemas principales están en los límites entre pestaña, worker, almacenamiento e interfaz. Conviene corregir esos contratos antes de seguir separando archivos.

Auditoría sin cambios funcionales. Se revisaron los diez diffs, el flujo de descarga y persistencia, la integración del popup y partes de Likes Explorer y servicios. No constituye una revisión exhaustiva de cada función del DSP/Looper, una prueba de pagos reales ni una prueba contra una cuenta real de SoundCloud.

Skill aplicada: `web-design-guidelines`, con las [reglas actuales](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Las skills de React no aplican: la extensión usa JavaScript y DOM nativo. No fue necesario consultar APIs externas para el análisis del código.

## Hallazgos priorizados

### 1. P1 — El trabajo durable queda inaccesible si desaparece la sesión

**Ubicación:** `scripts/bulk-job-manager.js:209`, `scripts/background.js:183`.

`loadJob()` retorna `null` si falta `chrome.storage.session.scdl_active_job`, antes de consultar IndexedDB. El arranque llama a recuperación, pero esa recuperación usa el mismo método. Persistir tracks no alcanza para recuperar el trabajo cuando se pierde el puntero de sesión, como al reiniciar el navegador. Los registros quedan guardados sin una vía de recuperación en la interfaz.

**Evidencia ejecutada:** usando el harness existente, crear un trabajo, borrar solamente el estado de sesión y consultar `getStatus()` produce `{"success":true,"job":null}` con **un trabajo todavía presente** en el almacenamiento simulado. Esto reproduce la dependencia del puntero; no es una prueba de reinicio real del navegador.

**Corrección:** almacenar la referencia activa junto con el trabajo en IndexedDB, o recuperar candidatos mediante el índice de estado. Al iniciar, reconciliar trabajos y destinos antes de continuar. La sesión debe ser una caché prescindible.

**Regresión asociada:** integración durable de `01398a3`; la dependencia de sesión era previa, pero ahora impide aprovechar la persistencia incorporada.

### 2. P1 — La enumeración usa un contexto mutable después de navegar

**Ubicación:** `scripts/page-intake.js:777`, especialmente `:795` y `:833`; `scripts/bulk-job-manager.js:783` y `:823`.

`bulkPage()` valida `bulkContext` antes de sus operaciones asíncronas, pero vuelve a leerlo después. `reset()` lo reemplaza por `null`. Además, el controlador de extracción normalmente ya fue retirado cuando comienza la enumeración del lote, de modo que no brinda cancelación a esas solicitudes.

**Evidencia ejecutada:** extraer un perfil, iniciar `bulkPage()`, detener la respuesta HTTP, ejecutar `reset()` y liberar la respuesta produce:

```text
TypeError Cannot read properties of null (reading 'clientId') code= undefined
```

Si durante la espera ya se extrajo otra colección, se pueden usar datos del nuevo contexto al procesar la respuesta anterior. La rama de playlists también calcula el siguiente cursor con la colección mutable.

**Impacto adicional confirmado por lectura:** el worker pide cada página a `enumerationTabId`; cerrar o cambiar la pestaña devuelve `stale_context`. `failEnumeration()` lo transforma en `failed` o `partial`. Esos tracks enumerados siguen pendientes, pero la UI no ofrece continuar la enumeración ni descargarlos. El worker coordina la enumeración; no es independiente de la pestaña.

**Corrección:** capturar un contexto inmutable y una generación, cancelar las solicitudes propias del lote y validar la generación al responder. Para independencia real, persistir el descriptor de colección y ejecutar la fuente paginada desde el worker. Si todavía se necesita la pestaña, ofrecer un estado recuperable y reconexión explícita.

**Commits:** `e953b8a`, `404fbd9`. La protección de `3849776` no cubre completamente el camino nuevo.

### 3. P2 — Los lotes se acumulan indefinidamente en IndexedDB

**Ubicación:** `scripts/bulk-library.js:436`; creación en `scripts/bulk-job-manager.js:1020` y siguientes.

Existe `deleteJob()`, pero no tiene consumidores de producción. Cada lote agrega registros a `jobs`, `tracks`, `seen` y `cursors`; al comenzar otro, solamente cambia el puntero de sesión. No hay retención, limpieza automática ni una interfaz de historial que permita borrarlos.

**Impacto:** repetir descargas grandes aumenta el almacenamiento de forma permanente y puede terminar en errores de cuota. Los trabajos huérfanos del hallazgo 1 agravan esto. No se provocó agotamiento de cuota en esta auditoría.

**Corrección:** una política acotada por antigüedad, cantidad o bytes para trabajos terminales, conservando los errores que requieran intervención. Borrar por rangos de claves: el borrado actual recorre todas las colecciones de registros, incluso las de otros trabajos.

**Commits:** `7ac67a1`, `01398a3`.

### 4. P2 — El botón de reintentar depende de una muestra truncada

**Ubicación:** `scripts/bulk-library.js:348`, `scripts/bulk-job-manager.js:257`, `scripts/popup.js:610`.

La biblioteca conserva solamente los últimos 100 fallos en `recentFailures`. El popup decide si mostrar Retry mediante `job.failed.some(failure => !failure.ambiguous)`, aunque ese array ya es una muestra.

**Escenario:** un fallo reintentable seguido de 100 guardados ambiguos deja el fallo reintentable en IndexedDB pero fuera del resumen. El botón desaparece aunque `retryFailed()` sí podría recuperarlo. No se ejecutó este escenario completo en navegador; la condición se deduce directamente del truncado y el predicado de UI.

**Corrección:** mantener `retryableFailedCount` y `ambiguousCount` como contadores transaccionales, y exportar `canRetry` o el contador al snapshot. Usar la muestra exclusivamente para presentar detalles. Ofrecer paginación para consultar todos los fallos.

**Commits:** `01398a3`, sobre la distinción de guardados ambiguos reforzada por `77dcccd`.

### 5. P2 — El progreso y el resultado principal no se anuncian de forma accesible

**Ubicación:** `popup.html:1434`.

`downloadStatus` recibe progreso, éxito y errores, pero carece de `role="status"`/`aria-live`. El listado de fallos sí tiene una región viva, pero no cubre la finalización exitosa ni el progreso general.

**Corrección:** una región de estado accesible que anuncie cambios significativos sin leer cada segmento de audio. Verificar con lector de pantalla y teclado. Hallazgo de inspección según la skill; no se ejecutó un lector de pantalla.

**Origen:** preexistente al rango revisado.

## Revisión de los últimos diez commits

| Commit | Evaluación |
| --- | --- |
| `404fbd9` Run bulk enumeration from worker | Coordina el lote fuera del popup, pero sigue dependiendo del content script. Hallazgo 2. No agrega pruebas propias en su diff. |
| `e953b8a` Connect paged bulk enumeration | Conecta el camino paginado y cambia el botón principal. Introduce lecturas de contexto mutable después de `await`. Hallazgo 2. |
| `01398a3` Move bulk runner state to IndexedDB | Mejora tamaño del snapshot y contadores. Faltan recuperación sin sesión, retención y capacidad de retry independiente de la muestra. Hallazgos 1, 3 y 4. |
| `7ac67a1` Add durable paged bulk storage | Buenas transacciones de página, deduplicación y detección de ciclos. La API de borrado queda sin integración. Hallazgo 3. |
| `3849776` Abort stale SoundCloud page requests | Mejora cancelación de extracción y navegación. Las pruebas pasan; el camino paginado agregado después requiere protección propia. |
| `da3af5d` Harden Likes and commerce HTTP handling | Límites y clasificación de errores en Likes/licencias. Verificadores relevantes pasan; sin otra regresión demostrada en el diff revisado. |
| `2833199` Bound SoundCloud request bodies and timeouts | Añade límites al JSON y timeout que incluye lectura de cuerpo. Las verificaciones de HTTP pasan. |
| `1b16710` Remove Likes Explorer saved places | Retiro coordinado de UI, mensajes y almacenamiento de bookmarks. Sin regresión demostrada; no se ejecutó el E2E de Likes en esta auditoría. |
| `77dcccd` Avoid duplicate fallback after uncertain folder writes | Mejora importante: no intentar automáticamente otro destino cuando pudo haberse escrito el archivo. Verificaciones de destino y directorio pasan. |
| `b71c000` Reconcile active Chrome downloads after bulk worker restart | Reconciliación mediante ID y suscripción antes de consulta. Verificador pasa. Recuperar un worker dentro de la misma sesión no cubre el hallazgo 1. |

## Arquitectura propuesta y efecto en el uso

1. **Repositorio durable como autoridad.** Trabajo, referencia activa, checkpoints y contadores en IndexedDB; sesión solamente como caché. Resultado: cerrar y abrir el navegador no vuelve invisible el lote.
2. **Fuente paginada independiente de la vista.** `CollectionSource.nextPage(descriptor, cursor, signal)` con descriptor inmutable. El content script descubre la colección y el worker maneja la continuidad. Resultado: navegar no rompe la descarga.
3. **Unificar las transiciones.** Hoy conviven `JOB_TRANSITIONS`, escrituras directas con `updateJob`, métodos `pause/resume/cancel` y `jobControl` en memoria. Centralizar comandos con estado esperado y revisión/generación; ningún callback viejo debe modificar un trabajo nuevo. Resultado: pausa, cancelación y recuperación consistentes.
4. **Snapshot explícito para UI.** Separar fase de enumeración/descarga, contadores completos, muestra de errores y capacidades (`canResume`, `canRetry`, `needsDestinationCheck`). Evitar deducir capacidades desde texto o listas truncadas. Resultado: acciones disponibles y mensajes correctos.
5. **Retención y recuperación visibles.** Historial acotado, limpieza segura y acceso a guardados ambiguos. Resultado: almacenamiento predecible y posibilidad de resolver errores sin repetir todo el lote.

Aplicar en ese orden, con pruebas de comportamiento antes de extraer más módulos. El tamaño de `bulk-job-manager.js` (1.304 líneas), `popup.js` (1.586) y `page-intake.js` (929) facilita mezclar responsabilidades, pero dividir archivos por sí solo no corrige los contratos anteriores.

## Verificación y brechas

- `npm test`: **41 verificaciones aprobadas**.
- `npm run test:e2e:bulk-store`: **aprobada**, 50.000 tracks en aproximadamente 4,7 segundos. Chromium necesitó ejecución fuera del sandbox porque el inicio fue bloqueado.
- `npm run test:player-tools`: verificadores cliente aprobados y **2 tests del servicio aprobados**. Estos dos tests son de validación; no prueban activación, webhooks o conciliación reales.
- `npm run test:feedback`: **8 tests aprobados**.
- Reproducciones adicionales en Node: acceso a contexto borrado durante `bulkPage()` y pérdida de visibilidad del trabajo tras borrar la sesión.

La prueba del manager reemplaza `SCBulkLibrary` por una implementación en memoria. Su `commitPage` no reproduce todas las validaciones de estado, epoch, replay y deduplicación de IndexedDB. El E2E de la biblioteca usa IndexedDB real, pero no conecta el manager y el content script. Que ambos pasen por separado no valida el flujo completo.

Agregar pruebas integradas de manager + IndexedDB + mensajes controlables: navegación durante una página, pérdida de sesión con trabajo persistido, reinicio mientras guarda, pausa/cancelación con respuesta pendiente, limpieza de trabajos terminales y retry con más de 100 fallos. También comprobar reconexión de pestaña/destino. No se hicieron descargas, pagos ni cambios de producción.
