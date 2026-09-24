# 05 — Guardar tu sonido y volver a él

> **PARCIAL / ABIERTO — revisión 24/09/2026 (`29d7946`).** Velocidades guardadas, persistencia de ajustes y presets FX de fábrica existen. CRUD con nombre de sonido completo y loops por track siguen pendientes; reutilizar el EQ paramétrico, no el boceto de tres bandas. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Objetivo: pasar de mover controles a recuperar una experiencia personal en un clic. Prioridad posterior a EQ para evitar rehacer el esquema; se puede diseñar el almacenamiento antes.

## Qué ya existe y qué falta

El panel tiene cuatro velocidades guardables y presets FX de fábrica. Eso no equivale a biblioteca de presets con nombre que guarde todos los parámetros ni a presets de loop por track.

Conservar los cuatro accesos rápidos de velocidad. Añadir `Guardar sonido actual` en FX con nombre, aplicar, renombrar, eliminar y restaurar fábrica. Ejemplo: **Late Night** con velocidad aproximada a 0,887x, Preserve Pitch off, reverb 21%, delay 8% y EQ. Guardar el valor efectivo soportado: si el slider cuantiza, no prometer precisión adicional al escribir 0,887.

## Hitos

### P1 — Estado durable y migración

Reutilizar normalización de [04](04-EQ-PRO-Y-EXPORTACION.md). Nuevo módulo propuesto de presets separado de la autoridad de licencias.

- Preset de sonido: ID estable, versión, nombre, rate, preservePitch, reverb/delay completos, EQ completo. Bypass no debería guardarse como sonido desactivado por accidente: proponer guardar ajustes y activar el preset explícitamente al aplicarlo.
- Preset de velocidad: conserva slots existentes y valor efectivo; no convertirlo en preset completo sin cambiar su etiqueta.
- Preset de loop: track ID/permalink canónico + A/B en milisegundos, nombre y opcional referencia a sonido. No aplicar A/B a otro track ni usar título como identidad.
- Preferencias de UI: colapsado/expandido aparte del sonido. No guardar permisos de reproducción ni gracia como preferencias.
- Migrar slots existentes; escritura fallida muestra error y conserva estado anterior. Dos pestañas: revisión/merge definido, no pérdida silenciosa.
- Límite de tamaño/cantidad propuesto y documentado al implementar; no almacenamiento infinito. Nombres tratados como texto y longitudes acotadas.

### P2 — Biblioteca compacta

El pedido mezcla “siempre verticales” con “scrollview horizontal”. Interpretación propuesta: tarjetas con contenido vertical, dispuestas en una sola fila con scroll horizontal. Mantiene la altura compacta y evita filas nuevas de botones. Verificar esa lectura al diseñar, sin bloquear el esquema de datos.

Permitir eliminar también defaults, tal como se pidió. Guardar una marca de oculto/eliminado para que una actualización no los reinstale; acción explícita `Restaurar presets de fábrica`. Fábrica y presets del usuario deben tener IDs distintos.

Preset “Slowed + Reverb”, “Nightcore”, “Space”, “Dub”, “Practice” o “Vinyl-ish” es un punto de partida, no un motor nuevo. No anunciar simulación de vinilo real. Comparar niveles al crear fábrica.

### P3 — Restaurar últimas preferencias

Restaurar sonido cuando el reproductor esté listo y haya capacidad vigente; nunca reproducir automáticamente por restauración. Con Free agotado, valores se conservan pero audio efectivo queda neutro. Al comprar, reaplicar sólo con estado reconciliado.

Loop guardado requiere mismo track y duración compatible. Si quedó fuera de rango por cambios de fuente, pedir seleccionar de nuevo; no recortar silenciosamente a otro fragmento. Cargar un loop nuevo durante trial conserva las reglas de consumo: un preset no evita cobrar una nueva sesión A/B.

### P4 — Acceso y QA

No endurecer los cuatro slots existentes durante trial: el plan previo eligió acceso conjunto. Propuesta comercial: presets completos de sonido y biblioteca de loops son Pro; defaults de demostración sin EQ pueden usarse mientras haya prueba. Esta diferencia es una propuesta pendiente, no una decisión ya confirmada.

Un preset con EQ no puede introducir EQ en Free a través de restauración, importación futura ni bypass. Al perder Pro, conservar registros y desactivar procesamiento pagado. No borrar la biblioteca.

Casos: crear “Late Night” → cambiar todos los controles → aplicar → exportar; cerrar y reabrir Chrome; renombrar/eliminar/defaults/restaurar fábrica; storage fallido/corrupto; dos tabs; viejo esquema; distinto track; Free→Pro→Free; UI larga en ruso/alemán y teclado.

Archivos a integrar: `tempo-control-main.js`, `audio-effects-core.js`, política/cliente y renderer. Pruebas de persistencia y ciclo real con audio/export, no sólo JSON guardado.

## Criterio de éxito

El sonido que vuelve debe coincidir con los valores guardados y con lo que se exporta. Medir usuarios Pro que guardan y reaplican en días distintos, no sólo cantidad de presets creados. Una mejora en retorno semanal es hipótesis a verificar.

Fuera de etapa: nube, cuentas nuevas, marketplace, presets públicos/importados y sincronización entre dispositivos.
