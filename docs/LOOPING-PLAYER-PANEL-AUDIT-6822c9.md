# Auditoría y plan técnico — Looping player panel

> **HISTÓRICO; cierre integral no certificado — revisión 24/09/2026 (`29d7946`).** Hallazgos y líneas pertenecen a `6822c9`. Sesión, identidad, controles y export tienen código/regresiones posteriores; no declarar todos los F01–F12/M01–M06 abiertos o cerrados en HEAD sin reproducir su criterio. QA actual en C6. Estado y pendientes: [registro vigente](ESTADO-ACTUAL-20260924.md).

## Contenido histórico de la base indicada

Fecha: 2026-09-09. Commit auditado: `6822c92093ab26fe09b46d9d5579c91d2aeb0a09`.
Base: `1acb039fb9ab1280dd763eed642be8f389329841`, su padre inmediato.
Comparación: `git diff 6822c9^ 6822c9`; HEAD coincide con el commit solicitado.

**Resultado: no recomiendo dar por cerrada la feature todavía.** Los caminos
habituales funcionan y los verificadores existentes de loop y panel pasan, pero
hay regresiones reproducidas de identidad, sincronización y lifecycle. La sesión
compartida es una extracción parcial: la waveform todavía posee un rango mutable,
decide identidad y escribe `currentTime`; cada frame MAIN tiene su propia sesión.
Esto incumple la intención de un solo loop asociado al track del player.

Este archivo es un informe y un plan para otro agente. No se modificó código de
producción. Las tareas siguientes no están implementadas. Los números de línea
referencian el commit auditado y pueden desplazarse al aplicar las correcciones.

## Alcance, autoridad y método

- Se revisaron los 18 archivos del commit: sesión, bridge, looper, panel,
  manifest, empaquetado, cinco locales, popup de ayuda, cuatro verificadores
  modificados más el nuevo verificador de sesión y el PNG añadido.
- Se siguieron también los consumidores relevantes fuera del diff: core de
  rangos, core de tempo, descarga desde player, intent, background, ejecución y
  render de audio, y las fixtures de integración.
- Especificación: [investigación y respuestas del usuario](LOOPING-PLAYER-PANEL-RESEARCH-20260909.md).
  Las respuestas tienen prioridad sobre las recomendaciones previas. El resumen
  posterior entregado en la conversación fija vista única, slider doble y bypass
  global. No se propone volver a tabs ni separar bypasses por seguir párrafos
  antiguos del documento.
- Se usaron `code-review` y `codebase-design`: revisión independiente de Spec y
  Standards, y evaluación de profundidad de módulos, interface, seam y ownership.
  No se encontraron `AGENTS.md`, `CONTRIBUTING`, estándares de código ni
  `docs/agents/issue-tracker.md` aplicables en el repositorio inspeccionado. El
  documento proporcionado permitió revisar Spec sin un issue tracker; no hace
  falta instalar otra skill para ejecutar este plan.
- Evidencia: lectura del diff y consumidores, 31 verificadores locales ejecutados
  individualmente para no detenerse en el primer fallo, tres E2E existentes y
  [reproductor específico de auditoría](audits/6822c9-repro.cjs).

El reproductor ejecuta `assert` sobre **el defecto observado**, no sobre el
comportamiento deseado. `REPRODUCED` confirma un problema; no significa que la
feature pase una prueba de regresión. Usa fixtures VM existentes y páginas
sintéticas de Chromium con los scripts reales. Las pruebas de UI de este archivo
cargan los scripts en el mismo world y simulan propiedades del media; no sustituyen
la validación de aislamiento MAIN/ISOLATED de la extensión. El control final usa
un WAV real de 500 ms. No se hizo una sesión manual autenticada en SoundCloud,
ni se verificaron ads reales, crossfade real o suspensión de pestaña en producción.

## Standards

No se encontraron violaciones duras de una norma local documentada. Hay cuatro
hallazgos de diseño; son juicios técnicos, no infracciones automáticas de estilo.

1. **Runtime duplicado.** `looper.js:1943` sincroniza cada 250 ms pero `:1964` y
   `:1889` siguen haciendo seeks. `looper-main-bridge.js:70` hace enforcement
   inmediato con el estado autoritativo. Se reprodujo un seek a A 16 ms después
   de desactivar la sesión. El bridge debe poseer enforcement y la waveform
   conservar render y comandos. Véase F01.
2. **Validación de pertenencia dependiente del camino de montaje.**
   `looper.js:2107` activa una sesión antes del guard de permalink en `:2119`.
   Se confirmó una sesión B sobre una waveform A ya montada. Véase F02.
3. **Reglas de rango duplicadas.** `loop-session.js:6,33` redefine el mínimo y
   normalización de `looper-core.js:2,20,68`, con políticas diferentes para una
   entrada invertida. Compartir las operaciones puras, conservando los estados
   parciales que necesita Set A/Set B. Véase F12.
4. **Panel con demasiadas responsabilidades y transporte duplicado.**
   `tempo-control-main.js:190–268` duplica transporte/descubrimiento presentes en
   `looper.js:272–400` y decide el documento propietario de otra manera. Extraer
   un cliente común y dejar presentación/interacción en los adapters. Véase M01.

Total Standards: **4**; el problema más importante dentro de este eje es el
enforcement duplicado con estado diferido.

## Spec

La revisión independiente encontró cuatro gaps. El bypass único y la vista única
se trataron como decisiones aceptadas por el resumen posterior.

1. **Cerrar el panel con Escape elimina el loop si existe adapter waveform.**
   Requisito: «¿El loop debe continuar al cerrar el panel? […] SI».
   `tempo-control-main.js:1004` cierra el panel, y `looper.js:2028` procesa el mismo
   evento y limpia la sesión mediante `reset`. Véase F07.
2. **No existen inputs precisos editables A/B.** Respuesta #6: «Set A/Set B +
   inputs […] SI, acepto la recomendación». `tempo-control-main.js:715,739` sólo
   contiene botones y sliders; el timestamp es texto. Véase F10.
3. **No existe Clear desde el panel.** El documento propone «clear/reset»; el
   helper soporta `clear-loop`, pero ningún control del panel lo llama. Sin
   waveform sólo se puede conservar el rango bajo bypass o cambiar de track.
   Es un gap respecto del diseño propuesto, no una regresión del looper previo.
   Véase F09.
4. **A–B no se exporta desde el player.** Respuesta #10: «que la descarga siempre
   sea desde el player. que el popup solo edite values». El player llama
   `downloadTrack` (`inline-button.js:614`); `DOWNLOAD_LOOP` sigue saliendo de la
   waveform (`looper.js:1583`). La ayuda nueva declara explícitamente export junto
   a waveform. Hay una divergencia de alcance documentada, no un fallo del render
   de WAV. Véase F11.

Total Spec: **4**; el problema más importante dentro de este eje es perder el loop
al cerrar el panel. Los hallazgos adicionales del análisis integrado están
detallados debajo, sin alterar los resultados independientes de estos dos ejes.

## Estado funcional por área

| Área | Resultado y límite de evidencia |
| --- | --- |
| Layout único, seis presets, dos personalizados, logo y review link | Implementados; verificador de panel pasa. El enlace coincide con el usado en el popup; no se comprobó la página remota. No se afirma igualdad píxel a píxel con la referencia. |
| Long press y persistencia | Camino de mouse y escritura de localStorage pasan; falta guardado por teclado. El test no recarga la página para comprobar restauración entre sesiones. |
| Set A/B y timestamps | Captura de 12.345/20.678 s comprobada. Horas se muestran sin milisegundos, acorde al resumen «milisegundos u horas». No hay edición textual. |
| Rango doble y waveform | Cableado bidireccional presente; cache local y doble enforcement impiden considerarlo consistente bajo todas las transiciones. |
| Loop sin waveform | Funciona en MAIN; no existe Clear ni export A–B desde ese contexto. |
| Cierre y navegación | Click externo deja correr el motor. Escape con waveform falla. La eliminación del reset por URL favorece navegación, pero quedan identidad de source, metadata y montaje inconsistentes. |
| Cambio de track | Pasa el caso simple de otro media reproduciéndose en el mismo documento. Falla en casos reproducidos de metadata y varios frames. |
| Bypass global | Caso estable de un frame pasa. Hay seeks tardíos, restauración contra source viejo y falta de herencia en frames nuevos. |
| Tempo/pitch y export | Descarga completa del player ya transporta transformación; no se agregó ese flujo en este commit. A–B + 0.5x + Keep Tone produjo WAV real en el E2E existente. |
| Waveform: drag, teclado, zoom, descarga | Verificadores locales y E2E existentes pasan. No implican que el nuevo panel y la waveform estén cubiertos juntos en todas las transiciones. |
| Ayuda/locales | Siete mensajes actualizados en cada uno de los cinco locales y fallbacks HTML. Quedan textos heredados contradictorios y UI nueva en inglés. |
| Distribución | `loop-session.js` está tanto en manifest antes del bridge como en allow-list. El PNG de referencia está versionado y entra en `assets`; licencias siguen pendientes. |

## Arquitectura objetivo y reglas de implementación

```text
Identidad del player + media propietario + generación del track
                           |
              Coordinador único de sesión
       rango parcial/completo, enabled deseado, bypass
                  /                    \
    Runtime del media propietario     Cliente de sesión
     único escritor de currentTime     /            \
                                    Panel         Waveform
                               captura/inputs    drag/zoom
                                         \
                                Snapshot para export
```

El coordinador puede vivir en MAIN del top frame y usar adapters de runtime por
frame. No hace falta reescribir el pipeline de tempo ni el renderer offline. La
interface debe ocultar selección de documento, transporte, generación, invalidación
y retry. Un contrato concreto para orientar las tareas:

```js
client.command({ type, expectedGeneration, ...payload });
client.snapshot();
client.subscribe(listener); // retorna unsubscribe
// snapshot: trackIdentity, generation, available, durationMs,
// startMs/endMs (nullable), active, enabled, bypassed, effectiveEnabled, error
```

`enabled` debe representar intención y `effectiveEnabled` la aplicación después
del bypass. La waveform puede tener estado de gesto/zoom y una proyección del
snapshot, pero no un segundo estado autoritativo ni un motor de audio. Cada
comando relativo a un track debe verificarse contra su generación antes de tocar
el media. Los comandos se responden con snapshot confirmado o error tipado.
El protocolo DOM sigue siendo un transporte de página, no una frontera de
seguridad ni una autorización para capacidades privilegiadas de extensión.

## Plan técnico, tarea por tarea

Prioridades: P1 = resolver antes de cerrar la feature; P2 = defecto localizado o
gap funcional que debe resolverse para completar el alcance; P3 = mejora de
producto/mantenibilidad. La prioridad no implica que exista pérdida de datos.

### F01 — P2 — Un solo motor de enforcement

**Contexto/evidencia.** `looper.js:1850–1969` conserva `range`, `loopEnabled`,
`seekToStart`, `seekIfOutsideRange`, listeners de media y rAF. El bridge también
modifica `currentTime` en `looper-main-bridge.js:54–82`. La sesión se consulta cada
250 ms. El reproductor demuestra: loop 1–3 s sincronizado a t=1000 ms; bypass en
sesión; frame t=1016 ms, posición 3.5 s → la waveform escribe 1 s igualmente.
También puede empujar hacia el rango antiguo al editar desde el panel.

**Implementación.** Quitar enforcement del adapter waveform, incluidos seeks
desde eventos de media y teclado que intenten mantener el rango. Traducir gestos
a comandos y renderizar el snapshot confirmado. Conservar rAF sólo para playhead
si es necesario. Si hay un fallback sin bridge, que sea una elección exclusiva
del runtime, explícita y observable, nunca dos escritores simultáneos.

**Aceptación.** Con ambos adapters montados, activar bypass no permite ningún
seek posterior originado por waveform; mover A/B desde panel respeta el nuevo
rango en el siguiente enforcement. Repetir con drag activo, pause, rate 0.1/4x y
respuesta fallida del bridge. Depende del contrato M01; puede hacerse junto a él.

### F02 — P1 — Validar identidad antes de reutilizar una waveform

**Contexto/evidencia.** El fast path de `ensureMounted` (`looper.js:2092–2110`)
evita el guard de `:2119–2125`. Reproducción Chromium: waveform A montada sin loop,
el badge cambia a B manteniendo página A, se crea una sesión B desde panel y se
llama `ensureMounted`; aparece overlay sobre A con `trackIdentity` B.

**Implementación.** Obtener identidad canónica del snapshot y validar pertenencia
antes de ambos caminos de montaje y de `activate`. Si la waveform no corresponde,
desmontar sólo la vista; no limpiar el loop del player. No usar coincidencia de
duración como prueba de identidad. En el remount no renormalizar el rango semántico
usando la duración de otra waveform.

**Aceptación.** Con tracks A/B de igual duración, nunca dibujar ni permitir editar
el rango B sobre A. Volver a la página B debe reconstruir markers/zoom válidos
sin reactivar ni reinicializar el loop. Verificar también badge que llega tarde.
Puede introducirse el guard inmediato antes de completar F03.

### F03 — P1 — Identidad estable del track, distinta del source

**Contexto/evidencia.** `updateLoop` guarda `trackIdentity: loopMediaSource`
(`looper-main-bridge.js:94–104`); rAF/playing/remember invalidan por objeto o source.
La waveform usa otra política (`looper.js:509–518`), incluyendo URL visible como
fallback. Se reprodujo que cambiar sólo el source borra la sesión: el bridge no
tiene información para distinguir renovación de URL del mismo track de otro track.
El documento exige identidad del player, no URL de página ni transporte de audio.

**Implementación.** Resolver track ID/permalink del player en un solo lugar y
asignar generación monotónica al cambio confirmado de track. Source y elemento
identifican el adapter de reproducción, no el track semántico. Una renovación de
source del mismo track debe reemplazar/revalidar el adapter conservando el rango.
Si la identidad aún es desconocida, exponer waiting y evitar aplicar rangos viejos
a un candidato; no inventar equivalencia a partir de duración.

**Aceptación.** Mismo track con nueva URL/source conserva rango; track distinto
con igual duración o source reutilizado lo limpia. Probar badge antes/después del
evento de media y navegación feed/perfil. Verificar ads/previews reales en sesión
manual antes de afirmar soporte. Base necesaria para F04–F06 y F11.

### F04 — P1 — Impedir que metadata reasocie el rango viejo al track nuevo

**Contexto/evidencia.** `handlePlayerEvent` (`looper.js:1916–1932`) publica el rango
local al recibir `loadedmetadata`/`durationchange`. `updateLoop` reemplaza
`loopMediaSource` sin verificar generación. Reproducción Chromium: loop A=1–3 s,
cambio de source a B, `loadedmetadata`, `playing` → sesión activa 1–3 s con source
B. La invalidación de `playing` ya no detecta el cambio porque el handler previo
lo adoptó. Un cambio posterior del badge puede limpiarlo, pero el rango viejo ya
fue transferido y puede haber afectado reproducción.

**Implementación.** Metadata debe alimentar al runtime/coordinador, no producir
`set-loop` desde la waveform. Revalidar duración dentro de la generación actual;
descartar comandos de adapters con generación anterior. Si el track cambia,
vaciar rango antes de procesar eventos de disponibilidad del media nuevo.

**Aceptación.** Todas las permutaciones relevantes de `emptied`, `loadedmetadata`,
`durationchange`, badge y `playing` preservan la regla: un track nuevo no hereda
A/B. Probar con el mismo elemento de audio y con reemplazo. Depende de F03 y F01.

### F05 — P2 — Bypass idempotente y restauración validada

**Contexto/evidencia.** `looper-main-bridge.js:263–301` usa
`restoreLoopWhenUnbypassed` fuera de la sesión. Se reprodujo: bypass activo,
media pausado cambia de source; `state` conserva loop viejo; quitar bypass primero
hace seek/play del nuevo audio y sólo después `playing` lo limpia. Además enviar
`set-global-bypass(false)` cuando ya está en false deshabilita un loop activo.
`set-loop-enabled` durante bypass tampoco actualiza coherentemente la intención
que se restaurará. La UI actual alterna el valor, por lo que la no idempotencia
es un defecto del contrato especialmente relevante para sincronización/retry.

**Implementación.** Guardar intención enabled y bypass en el modelo, derivar
effectiveEnabled y eliminar el booleano auxiliar de restauración. Antes de cualquier
seek/play validar propietario y generación, incluso al reanudar desde bypass.
Cambios repetidos al mismo valor no deben producir efectos nuevos. Una desactivación
explícita bajo bypass debe permanecer desactivada al quitarlo.

**Aceptación.** Dos comandos idénticos tienen el mismo resultado; cambio de track
pausado bajo bypass jamás produce un seek o play del rango viejo. Clear bajo bypass
no resucita el rango. Tests sobre transición completa, no sólo valor final.

### F06 — P1 — Coordinar sesión y bypass entre frames

**Contexto/evidencia.** El manifest instala bridge en todos los frames; cada uno
ejecuta `SCLoopSession.create()` y arranca `globallyBypassed=false`
(`looper-main-bridge.js:18–20`). `tempo-control-main.js:238–258` sólo difunde bypass
a documentos existentes y prioriza respuestas con loop activo. Reproducciones:
un iframe creado después del bypass acepta un loop enabled; `playing` en otro
frame no limpia el loop anterior y quedan dos sesiones activas.

**Implementación.** Un coordinador por player/top window debe registrar adapters
por frame y asignar un único propietario de generación. Un frame nuevo solicita
snapshot completo antes de aceptar comandos; recibe bypass vigente. Transferir
ownership invalida el adapter anterior y limpia su enforcement. El cliente no
debe elegir propietario priorizando simplemente «ya tiene loop» sobre «está
reproduciendo el track actual».

**Aceptación.** Top/iframe y dos iframes, cambio A→B, frame creado/eliminado bajo
bypass, audio detached y pause: a lo sumo una sesión semántica y un escritor activo.
Verificar también tempo efectivo en audio de frame nuevo; el controller de tempo
se instala sólo en top actualmente. Evitar expandir esto a frames de otro origen
sin una necesidad demostrada. Depende de F03, F05 y M01.

### F07 — P2 — Escape debe tener un único destinatario

**Contexto/evidencia.** Ambos listeners de `document` están en captura:
`tempo-control-main.js:1002–1009` y `looper.js:2028–2034`. Chromium confirma que
Escape cierra el diálogo y elimina el loop cuando waveform está activa. Sin ella,
Escape sólo cierra: la semántica depende del montaje.

**Implementación.** Definir que el diálogo abierto consume Escape al cerrarse.
Coordinar mediante estado/evento accesible entre worlds y comprobar en el handler
de waveform si el gesto ya se consumió. No depender exclusivamente del orden de
registro ni de `preventDefault` si el otro handler no lo respeta. Preservar Escape
para borrar loop fuera del panel si ésa sigue siendo la UX de waveform.

**Aceptación.** Panel abierto + foco en slider, preset, botón o trigger: Escape
cierra, devuelve foco y conserva sesión. Panel cerrado: Escape mantiene semántica
previa. Repetir en extensión real con MAIN/ISOLATED y con navegación fuera de
waveform. Corrección local independiente del refactor mayor.

### F08 — P2 — Conservar acceso al media detached pausado

**Contexto/evidencia.** `findMedia` (`looper-main-bridge.js:192–215`) elimina del
registro audios detached pausados y borra `lastPlayingMedia`; además excluye todos
los detached si existe cualquier media conectado. Es lógica heredada, no nueva
en este commit, pero ahora afecta captura y edición desde el panel. La reproducción
de auditoría elimina los candidatos históricos y pausa el media detached dueño:
`state.available=false` aunque `state.loop.active=true`.

**Implementación.** Mantener referencia explícita al media propietario de la sesión
mientras el track sea vigente, aunque esté pausado/detached. Separar limpieza de
históricos de resolución del player actual. Un video conectado ajeno no debe
desplazar al audio del player sin evidencia de cambio de ownership.

**Aceptación.** Pausar permite Set A/B, editar y reactivar; un media conectado
secundario no captura comandos del player. Al cambiar realmente de track se liberan
las referencias/listeners obsoletos. Depende del registro/identidad F03/F06.

### F09 — P2, gap de diseño — Clear accesible sin waveform

**Contexto.** El documento propone clear/reset. El bridge lo implementa y el panel
lo contempla en routing, pero ninguna acción de panel lo invoca. Bypass conserva
el rango y afecta también tempo, por lo que no sirve como Clear.

**Implementación.** Agregar acción pequeña de borrar rango, accesible por teclado,
que envíe `clear` al propietario. No alterar presets, rate, Keep Tone ni bypass.
Restablecer A/B a null y sliders al estado vacío. Limpiar también un único punto
capturado; diferenciar rango incompleto de loop efectivo.

**Aceptación.** Crear A/B en feed, borrar sin navegar ni montar waveform; no hay
enforcement ni restauración automática al quitar bypass. Al volver a waveform
no reaparece el rango. No agregar persistencia. Depende del cliente común M01.

### F10 — P2, gap de alcance — Edición temporal precisa

**Contexto.** La respuesta #6 acepta inputs; los únicos inputs A/B reales son
sliders de ms. El resumen posterior describe timestamps, pero no revoca de forma
explícita la edición precisa. Se registra como alcance pendiente, no como bug de
los botones Set A/Set B.

**Implementación.** Incorporar inputs de tiempo con formatos definidos, por ejemplo
`mm:ss.SSS` y `h:mm:ss.SSS`; parser y formatter puros; validación contra duración
y separación mínima compartida. Mantener borrador durante edición, commit en Enter
o blur y cancelación definida. El polling/snapshot no debe pisar texto en foco.
Cambios inválidos no escriben sesión ni audio y muestran motivo accesible.

**Aceptación.** Milisegundos, horas, vacío, NaN/texto, negativos, A≥B y límites del
track; sin pérdida de precisión al renderizar otra vez. Ambos adapters reciben
el mismo valor normalizado. Mantener panel único. Depende de F12 y M01.

### F11 — P2, divergencia de alcance — Export A–B desde el player

**Contexto.** Respuesta #10 pide descarga desde player; ayuda implementada mantiene
WAV junto a waveform. La descarga completa sí recibe transformación en
`inline-button.js:614–617`, ya antes del commit. No confundir esta divergencia
con falta de tempo en descarga completa.

**Implementación propuesta.** Ofrecer una acción explícita «Download loop» desde
el player cuando hay rango completo. Mantener descarga completa distinguible;
no convertir silenciosamente su botón actual en export parcial. Extraer la
orquestación A–B de `looper.js:1536–1591` para que ambas entradas consuman un
snapshot atómico `{trackIdentity, generation, trimRange, playbackTransform}`.
Resolver metadata de esa identidad, no de URL visible; preservar routing/render
offline existente. El panel sigue editando valores, sin pipeline de descarga propio.

**Aceptación.** Loop creado en feed exporta exactamente ese A–B del track del
player; tempo efectivo y bypass correctos; cambio de track durante resolución no
mezcla rango, metadata o transformación de generaciones. Mantener descarga completa
disponible. Antes de implementarlo, considerar esta descripción el alcance
propuesto que reconcilia los documentos, no una funcionalidad ya entregada.

### F12 — P2 — Consolidar normalización y sus invariantes

**Contexto/evidencia.** `loop-session.js:6–57` duplica el core y no reclampa endpoints
omitidos cuando cambia duración. Repro: rango 8000–9000, duración 10000; comando
sólo `durationMs:5000` → el snapshot sigue 8000–9000. No se afirma que el panel
actual emita ese comando; es un defecto de su interface pública. Para entrada
invertida 1000–0, sesión produce 1000–1250 y core.normalizeRange 0–1000: hay dos
políticas. Una diferencia contextual puede ser deliberada, pero debe ser explícita.

**Implementación.** Compartir reglas puras de clamp, mínimo y movimiento. La sesión
añade estado parcial sin que normalización complete B automáticamente. Normalizar
también valores heredados; definir política por operación (`move-marker`, `set-range`,
`capture`) y no por consumidor. Evitar emisiones idénticas que causen render extra.
Si el core debe estar en MAIN, actualizar orden de manifest y fixtures.

**Aceptación.** Todas las salidas completas cumplen `0≤A<B≤duration` y mínimo
250 ms; duración inválida y entrada parcial tienen respuesta explícita. Las mismas
operaciones del panel y waveform devuelven exactamente el mismo snapshot. Depende
del diseño de interface, no de una librería nueva.

### M01 — P2 — Cliente de sesión y adapters de UI con responsabilidades acotadas

**Contexto.** Panel tiene transporte, ranking de documentos, cache, storage, template,
render y montaje. Waveform conserva transporte, ranking, identidad, audio y descarga.
`SCLoopSession` sólo es un contenedor de estado de 84 líneas; no oculta lifecycle,
disponibilidad o selección como proponía el plan. El problema no es el tamaño del
archivo por sí mismo: cambiar ownership exige cambiar consumidores distintos.

**Implementación.** Extraer cliente de sesión/protocolo reutilizable en MAIN e
ISOLATED, con request ID, versión, generación, errores y suscripción. Separar el
modelo puro del coordinador runtime; no introducir wrappers que sólo reenvíen
funciones sin ocultar reglas. Waveform conserva drag/zoom/render, panel controles,
preferencias y render. Mantener snapshot consumible por export sin leer estructura
interna del Shadow DOM. Retirar `initialUrl` y métodos de adapter sin consumidores
sólo después de migrar las pruebas; no hacer limpieza general ajena al alcance.

**Aceptación.** Cambiar selección de media o semántica de bypass modifica el
coordinador y sus tests, no ambos adapters. Panel y waveform usan la misma interface.
No quedan selección/normalización/enforcement paralelos. Verificar manifest y
allow-list en el mismo cambio. No es obligatorio unificar ahora los wrappers de
`Audio/play` de tempo si su convivencia sigue cubierta.

### M02 — P2 — Disponibilidad, errores y confirmación de comandos

**Contexto.** `setLoopPoint`/`setLoopFromSliders` ignoran el resultado del comando
(`tempo-control-main.js:317–347`). El bridge silencia rechazo de `play` y hace
asignaciones de `currentTime` sin reportar error. Botones Set A/B sólo se deshabilitan
por `available`, no por duración válida; el bridge puede devolver false o incluso
true sin cambiar sesión si duración no alcanza el mínimo. El estado visual puede
parecer confirmado aunque el audio no arrancó.

**Implementación.** Respuesta tipada para unavailable, waiting-metadata,
stale-generation, invalid-range y playback-failed. Capturar seek/play fallidos y
publicar estado confirmado. Presentar mensaje breve y recuperable en el status
existente; permitir interacción de usuario que reintente play si corresponde.
Leer el tiempo para captura dentro del runtime al ejecutar el comando, evitando
que un cambio de propietario entre la lectura y escritura use el tiempo de otro audio.

**Aceptación.** Sin audio, duration NaN/Infinity/<250ms, `play()` rechazado, seek que
lanza e iframe que desaparece: no hay falso enabled efectivo ni errores sin manejar;
se conserva o limpia el rango según una regla explícita. No bloquear controles de
tempo si sólo falta loop. Depende de M01 y F03.

### M03 — P3 — Presets personalizados accesibles y verificables

**Contexto.** Guardar sólo está conectado a `pointerdown`+650 ms (`:827–839`).
Enter/Espacio generan click para restaurar, pero no pueden guardar. No se comprueba
botón primario del pointer. El test usa eventos sintéticos y comprueba storage sin
recarga; no cubre segundo preset, cancelación ni error de persistencia.

**Implementación.** Dar mecanismo de guardar por teclado con instrucción accesible,
o soporte explícito de pulsación mantenida con keyup/cancel. Filtrar pointer primario,
cancelar en blur/desmontaje y evitar guardar por menú contextual. Distinguir guardado
en memoria de persistencia fallida. Si se desea sincronizar pestañas, incluir las
dos claves custom en `storage`; eso es mejora adicional, no requisito demostrado.

**Aceptación.** Mouse/touch/teclado, pulsación corta/larga/cancelada, segundo slot,
recarga y storage fallido. Un long press real no restaura además un valor viejo.
Sin convertir presets transitorios del loop en persistencia por track.

### M04 — P3 — Reconciliar ayuda y lenguaje del panel

**Contexto.** Los cinco locales recibieron siete strings y el popup sus fallbacks.
Persisten instrucciones de abrir track individual (`looper_intro`,
`looper_step_open`) pese a loop en feed; `help_speed_slider` dice step 0.025 aunque
core usa 0.0125 (deuda previa). El panel MAIN incorpora copy inglesa nueva sin
pasar por i18n. No es correcto afirmar que toda la nueva UI está traducida.

**Implementación.** Actualizar textos cuando se resuelvan F09–F11 y conservar una
única descripción de alcance. Si se internacionaliza el panel, pasar diccionario
validado desde ISOLATED por el mecanismo de assets/estado ya existente, sin depender
de `chrome.i18n` desde MAIN. Etiquetas, ayuda y errores usan las mismas keys.

**Aceptación.** Cinco locales con claves coherentes; instrucciones reales para
feed y waveform, bypass/Clear distinguibles, step correcto y sin claims sobre
export A–B desde player antes de implementarlo. Revisar layout con textos largos.

### M05 — P1 como gate de cierre — Cobertura integrada y suite base

**Contexto.** Los verificadores nuevos no prueban panel+waveform+bridge juntos en
las transiciones descubiertas. `verify-tempo-browser.js` no carga `looper.js`;
`verify-loop-browser.js` prueba waveform/export, no interacción completa del panel.
`verify-looper-playback.js` sigue reemplazando texto para exponer funciones internas.

**Implementación.** Convertir los escenarios del reproductor de auditoría en tests
de comportamiento esperado a medida que se corrijan. Usar la interface compartida
para tests de estado; E2E con extensión real para mundos/eventos, y WAV real para
reproducción/export. Evitar que el refactor tenga que conservar funciones internas
sólo porque las fixtures buscan su texto. Reparar los cuatro bloqueos previos en
tareas separadas, con assertions del comportamiento nuevo en lugar de simplemente
eliminar expectativas. No incluir el reproductor de defectos como test positivo
en `npm test`.

**Aceptación.** Suite local verde y E2E relevantes verdes; matriz explícita de
identidad, bypass, metadata, frames, pausa, navegación y montaje. Registro de prueba
manual para casos reales no reproducibles en fixture; ningún «todo pasó» basado
exclusivamente en regex o una captura visual. Esta tarea acompaña F01–F12, no va
enteramente al final.

### M06 — P3; deuda de licencias bloquea release — Auditar paquete final

**Contexto.** `loop-session.js` se incluyó correctamente en manifest y allow-list.
El commit **sí versiona** `assets/images/Sin título.png` (76,127 bytes); contradice
la nota previa que lo describía como no versionado. No se encontró referencia
runtime al PNG y el packer copia `assets` completo. Además falta
`THIRD_PARTY_LICENSES.md`, y la allow-list actual tampoco lo incluye.

**Implementación.** Mantener el PNG del usuario y excluir material de referencia
del paquete, o reubicarlo de forma explícita en documentación, sin borrarlo. Resolver
la deuda de avisos/licencias con las fuentes del vendor y añadir los archivos
requeridos al paquete. Verificar que todos los scripts nuevos del refactor estén
listados y ordenados correctamente; no publicar como parte de esta auditoría.

**Aceptación.** Inspección del ZIP: runtime completo, notices incluidos, sin
fixtures/informe/PNG de diseño innecesario; carga de extensión empaquetada exitosa.
La falta del notice es previa a este commit; no se imputa como regresión de looping.

## Secuencia de ejecución sugerida

1. F07 y guard inmediato F02, con tests integrados: correcciones acotadas que
   pueden aterrizar sin reescribir el runtime.
2. Definir interface y generación (M01/F03), consolidar normalización (F12).
   Migrar con pruebas incrementales, manteniendo el renderer y las descargas.
3. F01/F04/F05: retirar motor de waveform, centralizar metadata y bypass.
4. F06/F08/M02: coordinación entre frames, media pausado y errores.
5. F09/F10/F11: completar controles y export pendiente sobre el contrato estable.
6. M03/M04/M06: accesibilidad, copy y paquete. M05 acompaña todos los pasos.

Cada entrega debe describir qué escenario corrige y añadir la prueba que falla
antes y pasa después. No combinar reescritura visual, unificación de tempo y
pipeline de descarga en un único cambio: no son necesarios para cerrar las
regresiones compartidas detectadas.

## Verificación realizada y límites

**31 verificadores locales: 27 PASS y 4 FAIL.** Se ejecutaron individualmente los
`scripts/verify-*.js` excluyendo `browser` y `live`, para observar todos los fallos.

| Falla | Evidencia y atribución |
| --- | --- |
| `verify-i18n.js` | Espera `id="looperActionSlot"` en HTML; falla en línea 64. Ese elemento ya faltaba en el padre. |
| `verify-popup-ux.js` | Espera entrada legacy/centrado del popup. Esos controles no cambian en este diff; deuda previa. |
| `verify-profile-support.js` | Stub de document sin `addEventListener`; content.js:20 lo usa. Ambos archivos son idénticos al padre. |
| `verify-tempo-control.js` | Falta `THIRD_PARTY_LICENSES.md`; tampoco existe en el árbol padre. |

Pasaron, entre otros: sesión, bridge, playback/mount/current DOM de looper,
normalización, click, descarga A–B, routing de loop, renderer con pitch, player
download, track-download-execution, download-intent/routing/track y metadata.

E2E ejecutados:

- `node scripts/verify-tempo-browser.js`: PASS; recreó `test-results/tempo-control.png`.
- `node scripts/verify-loop-browser.js`: PASS; loop A–B a 0.5x con Keep Tone,
  render Signalsmith y WAV descargado.
- `node scripts/verify-download-browser.js`: PASS; player→resolver→offscreen→archivo,
  directorio recordado y fallback a Downloads. Este E2E por sí solo no demuestra
  todas las combinaciones de tempo/pitch en descarga completa.
- `node docs/audits/6822c9-repro.cjs`: doce observaciones de defectos/contrato
  reproducidas y un control positivo con WAV real. No valida comportamiento
  deseado de esos doce casos; documenta exactamente lo que hay que cambiar.

No se ejecutó empaquetado destructivo ni publicación, ni tests `live` con cuenta.
No se crearon fixes ni commits. Los E2E pueden generar `debug.log` y capturas
locales; son artefactos de prueba, no cambios de implementación.

## Criterio para declarar terminada la implementación posterior

La feature estará lista para una nueva revisión cuando haya un único propietario
del rango y del media, todas las transiciones F01–F08 respeten identidad/bypass,
los gaps de alcance tengan implementación o resolución explícita en el documento,
y las verificaciones se ejecuten sobre esa integración completa. Conservar las
fortalezas actuales: control del audio nativo, zoom de waveform, transformación
offline y rango temporal sin persistencia por track.
