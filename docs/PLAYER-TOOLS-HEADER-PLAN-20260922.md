# Plan técnico: minimizar controles y reset global

Estado: listo para implementar. Este documento no implementa cambios de producto.

## 1. Objetivo y contrato de comportamiento

Agregar dos botones al header de Player Tools:

- Papelera: reset completo de los controles de reproducción, Loop, FX y EQ, conservando íntegramente Sampler y datos guardados.
- Control de visibilidad inmediatamente a la izquierda de la cruz: ciclo `_` → `-` → `+` → `_`.

Orden final del grupo: descarga, ayuda, fijar panel, papelera, visibilidad, cerrar. Usar iconos SVG coherentes con los existentes; `_` debe ser una línea baja y `-` una línea centrada.

Los cuatro dropdowns son Sampler, Looper, Audio effects y Parametric EQ.

| Estado | Icono | Acción del siguiente clic |
| --- | --- | --- |
| Normal: uno o más dropdowns abiertos | `_` | Colapsar los cuatro, conservando sus cabeceras |
| Todos colapsados | `-` | Ocultar los cuatro completos con `display: none` |
| Todos ocultos | `+` | Mostrar y expandir los cuatro |

Decisión propuesta para completar el requerimiento: `+` expande todos, sin recuperar la combinación anterior. Ejemplo solicitado: EQ y Loop abiertos → cuatro colapsados → cuatro ocultos → cuatro abiertos.

Si al inicio ya están todos colapsados, mostrar `-`: el siguiente clic oculta. La apertura/cierre individual actualiza el icono según el estado real. No implementar un contador de clics independiente del estado de los dropdowns.

En modo oculto, reemplazar únicamente el área de los cuatro dropdowns por el texto exacto:

> press maximize button again to appear all controls again

Texto discreto (10px, interlineado legible, contraste suficiente). Header, controles de velocidad y avisos necesarios siguen visibles: el alcance son los cuatro dropdowns. Ocultar/colapsar no modifica audio, loop, bypass, samples ni ajustes. Los nodos permanecen montados.

La papelera ejecuta directamente el reset, sin confirmación. Mantiene el estado visual actual: normal, colapsado u oculto. El botón debe estar disponible aun con los controles ocultos. Tooltip: `Reset playback, Loop, FX and EQ. Samples are kept.`

## 2. Mapa del código actual

- `scripts/tempo-control-main.js`: HTML/CSS del Shadow DOM, `.panel-header`, `.panel-tools`, `resetPlayerTools()`, `setPanelOpen()`, `render()`, `renderEffects()`, `setSamplerCollapsed()`, `setWaveformCollapsed()`, `clearLoop()` y montaje de EQ.
- Sampler: `.drum-section`, `samplerCollapsed`; Loop: `.waveform-shell`, `waveformCollapsed`; FX: `.effects-shell`, `effectsCollapsed`.
- `scripts/parametric-eq-ui.js`: EQ es un `<details class="peq">`; su API pública solo expone `setVisible()` y `sync()`. Mantiene estado local, selección, drag y commits asíncronos.
- `scripts/audio-effects-core.js`: `SCTempoEffects.DEFAULTS`, setters, grafo de audio y limpieza de colas. No hay reset completo público.
- `scripts/loop-session.js` y `scripts/looper-main-bridge.js`: estado autoritativo del loop y comando `clear-loop`.
- `scripts/tempo-control-core.js`: valores iniciales de reproducción.

Existe `resetPlayerTools()`, invocado por `ui.clearRate`: restablece rate/pitch/bypass, pone wet de reverb y delay a 0, normaliza EQ y llama a `clearLoop()`. Es incompleto para esta función: conserva parámetros internos de FX y `effectWetMemory`, y comienza solicitando autorización `set-rate`. Reutilizar una única operación mejorada para ambos accesos al reset.

## 3. Implementación de visibilidad

1. Centralizar setters para colapso de Sampler, Loop y FX. Agregar a EQ métodos explícitos `setCollapsed(value)` e `isCollapsed()`, y un callback de cambio para el evento nativo `toggle`.
2. Incorporar `controlsHidden` como estado efímero de la instancia. Derivar el estado normal/colapsado de los cuatro paneles. Conservarlo al cerrar/reabrir el panel; no agregar persistencia global entre recargas. Mantener la persistencia existente del colapso de waveform.
3. Crear `cycleControlsVisibility()` y `renderControlsVisibility()`. La primera realiza las transiciones; la segunda actualiza clase/atributo de ocultamiento, icono, texto y accesibilidad sin alterar el audio.
4. Aplicar una clase de panel con reglas explícitas `display: none` para las cuatro secciones, incluida `.peq`. No usar `opacity`, altura cero ni desmontar nodos. Evitar ocultar `.tempo-row` y `.status`.
5. Al mostrar, quitar el ocultamiento y expandir los cuatro mediante setters. Agrupar actualización visual y `positionPanel()`; evitar renders recursivos por los eventos `toggle` de EQ.
6. Hacer que visibilidad efectiva de EQ sea `panel abierto && !controlsHidden`; actualizar tanto `setPanelOpen()` como el nuevo controlador para no reactivar el canvas al reabrir un panel con controles ocultos. Redibujar waveform/EQ cuando tengan dimensiones válidas.
7. Si una operación existente expande Sampler automáticamente (por ejemplo, cargar un loop en un pad), no quitar `controlsHidden`: la acción de mostrar pertenece al botón global.
8. `aria-label`/`title` por acción: `Collapse all controls`, `Hide all controls`, `Show and expand all controls`. Usar botones nativos, iconos decorativos y `aria-controls` con IDs de las cuatro secciones. Mantener el foco en el botón; si un cierre programático afecta al elemento enfocado, trasladarlo al control global.
9. Revisar el espacio horizontal del header, especialmente las reglas existentes para pantallas angostas. La cruz y los nuevos botones deben permanecer visibles y accionables.

## 4. Contrato exacto del reset

“Volver a 0” significa estado neutro de audio y valores iniciales válidos; velocidad 0 o delayTime 0 no son los valores correctos.

| Área | Resultado |
| --- | --- |
| Reproducción | Rate `DEFAULTS.rate` (1x), preservePitch a su default, bypass global apagado |
| Loop | Sin marcadores A/B, sin loop activo/habilitado, sin bypass de loop; limpiar selección/drag/zoom/borradores locales asociados |
| FX | Wet reverb/delay 0; todos los parámetros de carácter a `SCTempoEffects.DEFAULTS`; preset `custom`; bypass apagado; sin colas anteriores audibles |
| Memoria de FX | `effectWetMemory` vuelve a `DEFAULT_EFFECT_TOGGLE_WET`, para no recuperar valores anteriores al reactivar R/D |
| EQ | `SCParametricEQ.normalize(null)`: sin bandas ni hard clip, estado inicial del módulo; limpiar selección, drag y cambios pendientes |
| Sampler | Conservar buffers, archivos, nombres, asignaciones, flags y samples guardados; no detener ni recrear sus voces como parte del reset |
| Datos guardados | Conservar presets personalizados de velocidad y bibliotecas/samples; escribir solo ajustes activos que corresponda restablecer |
| Panel y pista | Conservar visibilidad, fijación, pista, posición de reproducción y play/pause |

No usar `localStorage.clear()`, borrar bases de datos ni reutilizar una limpieza global del Sampler.

## 5. Implementación del reset

1. Agregar `effectsController.reset()` dentro de `audio-effects-core.js`, usando sus defaults como fuente única. Silenciar y limpiar colas antes de restaurar parámetros; asegurar que buffers/timers anteriores no reaparezcan al reactivar un efecto. Actualizar los grafos existentes pertinentes sin crear un AudioContext solo por resetear. Reutilizar la lógica de rampas para evitar clics.
2. Exponer en EQ una operación para cancelar edición pendiente y sincronizar el estado reseteado. `sync()` por sí sola no basta: actualmente evita sincronizar durante `pending` o `dragging`.
3. Fortalecer `resetPlayerTools()` como coordinador único. Invalidar primero intenciones de rate, loop, FX y EQ; luego aplicar defaults, persistir rate/pitch/EQ, limpiar el loop mediante `clearLoop()` y sincronizar toda la UI.
4. Usar una generación/token de operación para que autorizaciones tardías, commits de EQ, drags o cambios de FX iniciados antes del reset no vuelvan a aplicar valores viejos. Agregar un guard de reset en curso para clics repetidos. Preservar la cancelación de loop ya implementada con `loopIntentVersion`.
5. Resetear a estado neutro no debe iniciar un trial ni exigir acceso Pro. Revisar y retirar la autorización `set-rate` del camino de limpieza; mantener las comprobaciones normales en operaciones que activan efectos. El reset debe funcionar con trial agotado, EQ bloqueado o sin audio disponible.
6. Mantener `clearLoop()` y su cierre de sesión de uso; no cambiar solamente el estado visual ni omitir `finishLoopSession()`. Si falla una parte, completar las limpiezas independientes, mostrar el error y permitir reintentar. Liberar siempre el guard en `finally`.
7. Conectar `.reset-tools-button` al coordinador y conservar el acceso existente `ui.clearRate`. Revisar su condición de visibilidad: actualmente no contempla todos los parámetros FX ni hardClip. La nueva papelera puede permanecer siempre visible/habilitada salvo durante el propio reset.
8. No simular clics en los resets internos ni implementar el reset como bypass. Verificar que apagar/encender bypass tras reset no restaura configuraciones antiguas.

## 6. Secuencia de trabajo desde cero

1. Leer este documento, las instrucciones aplicables y `git status`. Hay cambios ajenos en el workspace al redactar este plan; preservarlos. Revisar las funciones citadas antes de editar, porque pueden haber evolucionado.
2. Implementar API de colapso de EQ y setters centralizados; agregar botón/ciclo visual/mensaje y ajuste responsive.
3. Implementar reset de FX, cancelación de operaciones pendientes y coordinador de reset; agregar papelera y accesibilidad.
4. Extender pruebas existentes para verificar transiciones, audio neutro y conservación del Sampler.
5. Ejecutar verificaciones focalizadas, luego suite local y navegador. Corregir regresiones y revisar el diff final sin modificar archivos ajenos.

## 7. Validación y criterios de aceptación

Extender `scripts/verify-tempo-browser.js` para el comportamiento del header y `scripts/verify-audio-effects-core.js` para el reset del motor. Usar las pruebas existentes de EQ y efectos para cubrir las carreras asíncronas y las colas de audio.

- EQ y Loop abiertos, Sampler y FX cerrados: `_` → todos cerrados y `-` → cuatro secciones con computed display `none`, mensaje visible y `+` → cuatro abiertas y `_`.
- Inicio con todos cerrados; apertura/cierre individual; varios ciclos; cerrar/reabrir panel; modo fijado; navegación de pista; viewport angosto. Verificar coherencia de iconos y ausencia de solapamientos.
- Ocultar durante reproducción conserva loop, velocidad, FX y samples. Ningún descendiente oculto puede recibir foco por Tab.
- Modificar todos los parámetros FX, bandas/hardClip de EQ, velocidad/pitch y A/B; activar bypass; resetear y verificar snapshots, UI, almacenamiento y audio neutro. Repetir con controles ocultos, sin pista y con acceso Pro no disponible.
- Cubrir loop incompleto (solo A o B), drag en curso y autorizaciones diferidas: al resolverse, los valores viejos no deben regresar.
- Cargar samples personalizados y guardar samples/presets antes del reset. Comparar contenido/asignaciones y almacenamiento después, y tras recargar. El reset debe ser idempotente.
- Reactivar R/D tras reset utiliza parámetros iniciales y no revive colas previas. Alternar bypass no recupera el estado anterior.
- El reset no mueve el playhead, no inicia ni pausa la pista y no cambia el modo de visibilidad.

Comandos del proyecto para la fase de ejecución:

```sh
node scripts/verify-tempo-control.js
node scripts/verify-audio-effects-core.js
node scripts/verify-parametric-eq.js
node scripts/verify-loop-session.js
npm test
npm run test:e2e:tempo
npm run test:e2e:effects
npm run test:e2e:eq
npm run test:e2e
```

Leer los fixtures/requisitos de navegador antes de ejecutarlos. Registrar resultados y limitaciones reales; no dar por validado el audio solo por comprobar clases CSS.

Terminado cuando ambos botones cumplen el contrato, las verificaciones relevantes pasan y ningún dato del Sampler o preset guardado cambia por el reset.
