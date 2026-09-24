# Plan integral del Looper: experiencia, rendimiento y monetización

> **ABIERTO / evolución posterior — revisión 24/09/2026 (`29d7946`).** Loop A–B, edición precisa, sampler básico, EQ y export actuales son la base. Biblioteca con nombre, múltiples regiones, undo/redo, BPM/práctica y batch de regiones no están cerrados. E9 reutiliza el contrato comercial vigente, no redefine la oferta por inferencia. Estado y pendientes: [registro vigente](ESTADO-ACTUAL-20260924.md).

Fecha: 20 de septiembre de 2026. Estado: planificación; las etapas de este documento están pendientes de implementación. Pedido: desarrollar todas las mejoras propuestas en la conversación y dejar una guía detallada para ejecutarlas en el repositorio.

## 1. Objetivo y límites

Convertir el looper en una herramienta recurrente para practicar música, preparar regiones y exportar fragmentos, con una biblioteca que conserve el trabajo del usuario. Mejorar ingresos mediante valor útil y medir el resultado, sin asumir que más funciones implican más ventas.

Este documento cubre guardar loops, múltiples regiones con nombres, selección musical por compases, práctica progresiva, exportación por lotes, precisión de reproducción, rendimiento del waveform, doble clic, deshacer, atajos, duplicación, oferta Free/Pro contextual, métricas y experimentos. También describe sincronización entre dispositivos como etapa posterior. No incluye desarrollar un DAW, separar stems, descargar contenido inaccesible ni sustituir el reproductor de SoundCloud por defecto.

La autorización de esta tarea es escribir el plan. Este archivo no significa que las funciones, cambios de precio, telemetría remota o despliegues estén implementados o publicados. Los valores comerciales que siguen son propuestas de trabajo; deben contrastarse con datos antes de lanzar un cambio de oferta.

## 2. Base inspeccionada y fuentes del repositorio

Las observaciones corresponden al árbol de trabajo actual, que contiene cambios sin commit de distintos temas. Al comenzar cada etapa, registrar HEAD, estado y diff para no confundir este diagnóstico con una auditoría de una versión publicada.

| Área | Archivos actuales | Implicación para el plan |
| --- | --- | --- |
| A/B, límites y zoom | `scripts/looper-core.js` | Reutilizar lógica pura; mínimo actual de 250 ms |
| Estado del loop vivo | `scripts/loop-session.js` | Existe una sola región activa; biblioteca y sesión son responsabilidades distintas |
| Propietario de reproducción | `scripts/looper-main-bridge.js` | Escribe `currentTime`; evitar un segundo controlador independiente |
| UI sobre SoundCloud | `scripts/looper.js` | Overlay, marcadores, movimiento de región, zoom y exportación |
| Panel persistente | `scripts/tempo-control-main.js` | Waveform, A/B, velocidad, Keep Tone, efectos y permisos asíncronos |
| Acceso | `scripts/player-tools-policy.js`, `player-tools-access.js`, `player-tools-client.js` | Política compartida, autoridad en background, concesiones y generaciones |
| Audio/exportación | `scripts/loop-audio-renderer.js`, `offscreen.js`, `background.js`, `track-download-execution.js` | Reutilizar render WAV y transformaciones; inspeccionar su contrato antes de ampliarlo |
| Venta y eventos | `scripts/player-tools-commerce.js`, `services/player-tools-license/` | Ya hay checkout, licencia y allowlist de eventos; no crear otro sistema paralelo |
| Empaquetado | `manifest.json`, `scripts/package-extension.js` | Nuevos módulos necesitan orden de carga y revisión del paquete |
| Pruebas | `scripts/verify-looper*.js`, `verify-loop-*.js`, `verify-tempo-browser.js`, `verify-player-tools-*.js` | Extender fixtures y pruebas existentes |

La política inspeccionada establece 20 usos y 7 días de trial; exportación de loop, exportación con efectos y edición precisa son Pro. `player-tools-commerce.js` declara USD 3,69 como precio local; no se verificó el precio efectivo del proveedor. No tratar ese valor como evidencia del checkout en producción.

El puente de reproducción comprueba límites mediante eventos y `requestAnimationFrame`, y vuelve a A mediante `currentTime`. Esto no demuestra precisión a nivel de sample ni continuidad sin cortes. El renderer de exportación y la reproducción en vivo tienen límites diferentes.

El trabajo de selección por arrastre ya añadió `createRangeFromSelection` y gestos en ambos waveforms. Revisar antes de extender: en SoundCloud la superficie se monta con el overlay del loop; el arrastre dentro de una región y sus zonas de agarre no es idéntico en ambas UI. No afirmar que se puede iniciar una selección desde cualquier sitio sin probarlo.

Antecedentes: [plan de Player Tools](PLAYER-TOOLS-PRODUCT-AND-TECHNICAL-PLAN-20260912.md), [handoff del núcleo](PLAYER-TOOLS-FOUNDATION-HANDOFF-20260913.md), [investigación de panel](LOOPING-PLAYER-PANEL-RESEARCH-20260909.md), [planes comerciales](planning-20260915/00-LEER-PRIMERO.md). Son contexto histórico; el código actual prevalece para describir lo implementado. Este plan complementa esos documentos y no cambia Likes Explorer.

## 3. Resultado de producto y recorrido

Recorrido objetivo:

1. Abrir Player Tools, arrastrar sobre el waveform y escuchar una región A/B.
2. Ajustar el rango con marcadores, teclado o una cuadrícula musical opcional.
3. Pulsar Guardar, nombrar la región y conservar velocidad, Keep Tone y efectos elegidos.
4. Volver otro día y encontrar las regiones de esa canción; elegir una sin reconstruir A/B.
5. Alternar entre Intro, Drop, Vocal o Parte difícil; practicar una sección con progresión de velocidad.
6. Exportar una región o varias como WAV, con resumen de transformaciones y progreso.
7. Descubrir Pro cuando intenta una acción que necesita mayor capacidad, con una explicación concreta.

Panel principal: mantener waveform y controles de reproducción visibles. Añadir Guardar y acceso a Biblioteca con contador; desplegar la lista debajo o en una vista secundaria. Cuadrícula y Práctica deben expandirse bajo demanda. Evitar cargar todos los controles en la vista inicial.

La biblioteca global permite filtrar por canción/nombre y abrir la página asociada. La biblioteca de canción muestra nombre, A/B, duración, configuración y estado de cambios sin guardar. Elegir otra región aplica un solo cambio lógico; no reproduce automáticamente audio pausado. Abrir un enlace de otra canción no aplica su región hasta confirmar identidad y metadatos del nuevo player.

## 4. Invariantes técnicas

- Una sola autoridad escribe el estado musical vivo y la posición del medio. Las UI emiten intenciones.
- La biblioteca persistida no es una concesión de pago ni una sesión de reproducción. Restaurar un registro requiere permisos actuales.
- Tiempos persistidos en milisegundos finitos; rangos normalizados y mínimo de 250 ms. La cuadrícula usa precisión completa durante el cálculo y redondea al aplicar.
- Todo comando asíncrono captura identidad y generación; después de cada espera debe comprobar que sigue siendo válido.
- Una previsualización de arrastre es local. Un gesto terminado es un commit, una entrada de historial y como máximo una acción persistida si el usuario guarda.
- Clear, cambio de canción, cierre de documento o cancelación invalidan operaciones pendientes. Una respuesta tardía no resucita un loop.
- El background valida mensajes y deriva propietario desde el sender. MAIN y los atributos DOM no acreditan una compra.
- Pro vencido o degradado no borra biblioteca. Leer, renombrar, borrar y recuperar datos no deben quedar atrapados detrás del pago.
- La reproducción no depende de abrir el panel ni de dibujar canvas. Las descargas largas no dependen de que siga abierto el popup.
- No persistir audio completo en storage de preferencias ni solicitar recursos de todas las canciones al abrir la biblioteca.

## 5. Modelo propuesto y almacenamiento

### 5.1 Registros

Crear `scripts/loop-library-core.js` para validación y operaciones puras, y `scripts/loop-library-store.js` para persistencia y concurrencia. Los nombres son propuestos, no archivos existentes.

Registro `SavedLoop` v1:

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "trackKey": "soundcloud:123456",
  "trackUrl": "https://soundcloud.com/artist/track",
  "trackTitle": "Track",
  "artistName": "Artist",
  "name": "Drop 1",
  "startMs": 42000,
  "endMs": 58000,
  "durationMsAtSave": 180000,
  "playback": { "rate": 0.8, "preservePitch": true },
  "effects": { "schemaVersion": 1, "bypassed": false, "values": {} },
  "grid": { "bpm": 120, "beatsPerBar": 4, "originMs": 0, "source": "manual" },
  "createdAt": 0,
  "updatedAt": 0,
  "revision": 1
}
```

`effects.values` debe adoptar un esquema explícito derivado de `audio-effects-core.js`, con límites por parámetro; no aceptar un objeto arbitrario por reproducir este ejemplo. Grid es opcional; práctica se guarda como preset opcional versionado, no como contadores de una ejecución anterior. No guardar claves de licencia, URLs temporales de stream, cookies, waveform completo ni recibos de autorización en un loop.

Identidad: preferir ID estable de SoundCloud. Usar URL canónica como fallback identificado como tal. Si luego aparece ID estable, crear alias y migrar sin duplicar registros. No unir canciones por título/artista. Si la duración cambió, validar y mostrar que el rango requiere revisión; nunca recortar y sobrescribir silenciosamente el original.

Nombres: longitud propuesta de 1–80 caracteres tras trim, texto plano y fallback “Loop 1”. Permitir nombres repetidos porque el ID distingue registros. Escapar para DOM y sanear por separado para nombre de archivo.

### 5.2 Persistencia y contratos

Primera versión local con un escritor en background y almacenamiento inyectable. Evaluar `chrome.storage.local` para metadatos y mantener un documento versionado acotado; medir tamaño y latencia con miles de registros. Si el volumen requiere IndexedDB, migrar mediante el adapter sin cambiar las UI. No prometer infinitud física: “sin límite comercial” sigue sujeto a capacidad local.

API propuesta: `list({trackKey,cursor,limit})`, `get(id)`, `save({record,expectedRevision,requestId})`, `rename`, `delete`, `restoreDeleted`, `exportBackup`, `importBackup`. Validar payloads, tamaños y capacidad comercial en background. Serializar mutaciones y mantener request IDs idempotentes para reintentos. Dos pestañas editando la misma revisión deben producir conflicto explícito, no sobrescritura silenciosa.

Para operaciones de varios registros, confirmar un único documento o usar transacción. Evitar índice y registros que se comprometen por separado sin recuperación. Emitir una revisión de biblioteca después del commit; las UI descartan snapshots anteriores. Lectura paginada; índice por canción derivable, no nueva fuente de verdad.

Migraciones: validar versión antes de escribir, conservar respaldo previo hasta verificar, rechazar versiones futuras sin reset y recuperar registros válidos sin borrar el resto. Probar fallo de storage y reinicio entre pasos. La biblioteca inicial vacía no debe migrar ni alterar contadores de trial.

Backup JSON local con vista previa de importación, conteo, conflictos y tamaño máximo. Importar conserva IDs válidos o los remapea de forma determinista; nunca interpreta una licencia del archivo. El backup es recuperación de datos, no exportación musical Pro. Eliminación recuperable con Deshacer; una papelera local acotada puede añadirse si mejora la recuperación sin complicar el MVP.

## 6. Etapas de implementación

### E0. Contratos, baseline y observabilidad local

Objetivo: establecer una base reproducible y cerrar ambigüedades antes de desarrollar biblioteca.

Tareas:

1. Registrar HEAD/diff, ejecutar verificaciones relevantes y clasificar fallos sin atribuirlos automáticamente a cambios nuevos.
2. Inventariar todas las entradas de set-loop, restore, clear, seek, export y autorización, incluidos frames.
3. Documentar la matriz de gestos actual en ambas UI: clic, doble clic, arrastre vacío, arrastre de región, marcador, wheel, Escape y pérdida de captura.
4. Cubrir creación desde estado vacío, ambos sentidos, salida del waveform, right click, `pointercancel`, cambio de canción durante autorización y drag superpuesto a un permiso lento.
5. Registrar baseline de dibujo y reproducción con fixtures descritas en la sección 8. Contadores de diagnóstico locales y desactivados en producción por defecto.
6. Diseñar un coordinador de acciones de loop con transporte inyectable; no refactorizar todo el panel para comenzar.

Salida: matriz de comportamiento, reporte de baseline y pruebas de carreras. El arrastre debe previsualizar sin consumir una creación por movimiento. Cancelar no confirma la previsualización. El comportamiento de entrada desde SoundCloud sin overlay debe quedar explícito y probado.

### E1. Guardar y restaurar loops por canción

Implementar el modelo y adapter de la sección 5. Añadir Guardar, editor de nombre, lista de canción, estado vacío, carga, fallo recuperable y confirmación accesible. Primera capacidad vertical: crear A/B → guardar → recargar → encontrar → restaurar A/B y configuración.

Separar “guardar cambios” y “guardar como nuevo”. La región activa puede ser borrador o derivar de un ID guardado. Editar A/B marca cambios pendientes; no sobrescribir automáticamente el registro. Cambiar de región conserva borrador de la sesión y permite recuperarlo mediante historial, sin modal en cada clic.

Restaurar toma un snapshot de la configuración, valida capacidades y generación, prepara el cambio y aplica de forma coordinada rango/rate/Keep Tone/efectos. Si un ajuste guardado ya no está disponible, explicar cuál no se aplica; no simular restauración completa. Audio pausado permanece pausado. Bypass global es estado de sesión y no se desactiva por restaurar una región.

Archivos: módulos nuevos de biblioteca, background, cliente aislado, panel, política y locales. Incluir módulos nuevos en carga/empaquetado, con código exclusivo de background fuera de MAIN.

Aceptación: persistencia tras reinicio; misma canción reconocida con URL normalizada; ninguna restauración sobre canción incorrecta; conflicto entre pestañas visible; error de escritura no muestra “guardado”; registros conservados tras cambio Pro→Free; migración y backup recuperables.

### E2. Múltiples regiones, organización y acceso rápido

Ampliar E1 con lista ordenable, renombrar, duplicar, eliminar con deshacer, filtro y biblioteca global. Mantener una sola región activa. Las regiones inactivas se dibujan discretamente; seleccionar por lista es siempre posible cuando se superponen. No añadir reproducción encadenada en esta etapa.

Duplicar crea un ID nuevo y propone nombre “Drop 1 — copia”. “Duplicar a continuación” copia longitud y ajustes empezando en B; si no cabe al final de la canción, deshabilitar esa acción y explicar el motivo. La duplicación normal conserva el rango y permite moverlo luego.

La lista debe navegarse con teclado y exponer selección activa y cambios sin guardar. Ventanas de biblioteca se cierran sin borrar estado. Cargar metadatos visibles; no bloquear la lista por una carátula o canción eliminada.

Aceptación: múltiples regiones por canción, coincidencia entre ambas superficies, 1.000 registros navegables sin renderizar 1.000 filas cuando no es necesario, nombres largos/Unicode, superposición, duplicado al borde y preservación al navegar.

### E3. Selección cómoda, historial y atajos

Definir contrato uniforme:

- Clic simple en zona libre: buscar posición sin crear loop.
- Arrastre principal: seleccionar nuevo rango; A es el extremo anterior temporalmente, aunque se arrastre hacia la izquierda.
- Marcadores: modificar un extremo; agarre dedicado de región: mover A/B conservando longitud.
- Doble clic en zona libre: seleccionar el compás bajo el cursor si la cuadrícula está activa; sin cuadrícula, seleccionar una ventana de duración predeterminada de 4 s alrededor del punto, limitada por la canción. Ese valor es propuesta de UX, no detección automática de estructura.
- Como doble clic hoy resetea zoom en el panel, mover “Restablecer zoom” a control explícito y actualizar ayuda/pruebas. No disparar las dos acciones con el mismo gesto.
- Escape durante drag cancela; fuera de drag conserva el orden de prioridad del panel y del loop existente.

Historial por sesión/canción, máximo propuesto de 50 acciones. Guardar before/after de cambios musicales lógicos: rango, mover, duplicar en sesión y restaurar. Un drag produce una entrada, no cientos. Deshacer no devuelve cuota ni deshace compras, exportaciones iniciadas o borrados remotos. Separar historial de edición y operaciones persistidas para no resucitar registros eliminados por otra pestaña.

Atajos con foco dentro del looper: flechas en marcador conservan 100 ms y Shift 1 s; Ctrl/Cmd+Z y Shift+Ctrl/Cmd+Z para historial; botones accesibles equivalentes para mover una región por su longitud, duplicar y seleccionar anterior/siguiente. Elegir combinaciones adicionales después de comprobar conflictos con navegador y SoundCloud. No capturar teclas en campos de texto. Publicar tabla de ayuda y aria-keyshortcuts para combinaciones efectivas.

Aceptación: clic no crea; doble clic no confirma además una selección accidental; undo/redo después de drag y restore; cancelación revierte; accesible sin mouse; wheel/zoom no cambia el rango; prueba con selección que ocupa toda la canción.

### E4. BPM, cuadrícula y selección por compases

Entregar primero BPM manual y tap tempo, luego detección automática opcional. Definir BPM como pulsos de negra por minuto; `beatsPerBar` representa pulsos de negra por compás en la primera versión. Ofrecer inicialmente 3 y 4; no presentar un número de pulsos como soporte completo de compases compuestos.

Cálculo: `beatMs = 60000 / bpm`; `barMs = beatMs * beatsPerBar`; línea n = `originMs + n * beatMs`. El origen es ajustable con “Marcar primer pulso aquí”. Sin origen correcto, un BPM correcto no garantiza selección musical alineada.

Añadir selección de 1/2/4/8 compases, snap apagado/pulso/compás y mover región un compás. Snap usa la cuadrícula temporal de la canción original, independiente de velocidad de reproducción. Mostrar duración resultante y desactivar longitud que exceda la canción; en extremos no acortar silenciosamente una selección presentada como compás completo. Conservar mínimo de 250 ms y explicar incompatibilidades.

Persistir BPM, origen y métrica por canción, con fuente manual/tap/estimated y confianza opcional. Cambiar BPM no mueve automáticamente loops guardados en milisegundos; “Realinear esta región” es una acción explícita con undo.

Detección automática: prueba técnica con audio accesible y límites de duración/memoria; seleccionar algoritmo y dependencia sólo después de revisar licencia y compatibilidad. Ejecutar fuera del hilo de UI, cancelar al cambiar track, guardar resultado pequeño por identidad/fuente. Ofrecer corrección mitad/doble y origen manual. Waveform de amplitud remoto no garantiza resolución ni información suficiente para un beatgrid fiable. Música con tempo variable queda en modo manual o sin snap; no prometer beatgrid adaptativo en v1.

Aceptación: fixtures a 90/120/174 BPM, origen desplazado, mitad/doble, zoom, reproducción 0,5x/1,25x, selección inversa y límites. Medir tasa de corrección manual en uso consentido, no sólo si el algoritmo devuelve un número.

### E5. Práctica con velocidad progresiva

Crear motor puro propuesto `scripts/loop-practice-core.js`. Configuración: velocidad inicial/final, incremento por etapa, repeticiones por etapa y acción final (mantener velocidad final o detener práctica). Ejemplo: 0,60x → 1,00x, +0,05x cada 4 vueltas completas. Respetar límites del motor de tempo existente y clamp exacto al objetivo.

Estados: idle, running, paused, completed, cancelled. Emitir evento de vuelta desde el dueño de reproducción cuando cruza B naturalmente. Seek manual, restauración, cambio de rango, rebuffering y vuelta artificial por activar fuera de rango no cuentan como repetición. Deduplicar por generation + lapId.

Al terminar una vuelta, incrementar contador y aplicar rate a través del controlador actual sin saltar nuevamente a A. Una nueva velocidad entra una sola vez aunque lleguen varios eventos. Pausa del audio pausa práctica; bypass pausa su progresión; cambio de canción o región la cancela con explicación. Cambio manual de rate detiene la progresión antes de aplicar el nuevo valor. No restaurar velocidad por una respuesta vieja después de una acción manual.

UI: sección expandible, vista de progreso “Vuelta 2/4 · 0,75x · objetivo 1,00x”, iniciar/pausar/reiniciar y ajuste Keep Tone. Mostrar velocidad de fuente y efectiva donde pueda confundirse. Guardar presets como configuración, no como sesión en curso que empieza sola al abrir.

Aceptación: conteo exacto, velocidades decimales, pausa/reanudar, pestaña oculta, bypass, cambio de track, fallo de seek y rechazo de reproducción. Al parar, aplicar una política visible: conservar rate alcanzado por defecto; botón separado para volver al rate inicial.

### E6. Exportar varias regiones

Añadir selección múltiple en biblioteca y resumen antes de exportar: cantidad, duración estimada, nombres, formato WAV y transformaciones. Valor predeterminado: configuración guardada de cada región; ofrecer “usar ajustes actuales para todas” explícitamente. Definir tratamiento de bypass según el contrato existente y reflejar la transformación efectiva en el resumen.

Snapshot inmutable por job. Cambiar A/B, borrar un registro o cerrar panel después de iniciar no modifica lo que se exporta. Autorizar lote y elementos en background antes de descargar/decodificar; validar el alcance de licencia siguiendo política vigente durante un job ya autorizado.

Primera versión: archivos separados usando infraestructura de descargas existente. ZIP opcional posterior sólo si se justifica por volumen y memoria; no es requisito para entregar batch. Nombre: artista - canción - región - A-B.wav, saneado y con sufijo contra colisiones.

Crear coordinador de jobs específico o reutilizar uno existente tras revisar compatibilidad. No acoplar sin más el modelo de bulk de tracks a regiones. Estados por elemento: queued, preparing, rendering, downloading, completed, failed, cancelled. Concurrencia inicial de render 1. Para varias regiones de una canción, reutilizar fuente decodificada dentro de presupuesto; liberar al cambiar grupo. Reintentar sólo fallidos con IDs estables.

Cancelar impide comenzar nuevas unidades y cancela trabajo activo donde el renderer lo permita. Una descarga ya completada no se borra. Tras reinicio del worker, recuperar estado durable y marcar fases no recuperables como interrumpidas; no prometer continuación de un buffer perdido ni descargar duplicados automáticamente.

Aceptación: 1/10/50 regiones, varias canciones, nombres duplicados, Pro/Free, cierre de UI, error de red, cuota de disco, cancelación y audio transformado. Verificar duración, sample rate, canales y contenido WAV real; no basta con comprobar que aparece un archivo.

### E7. Precisión del loop y continuidad audible

Ejecutar medición básica en E0 y trabajo de mejora después de aislar estado/controlador. Medir error de cruce de B, latencia de seek a A, intervalos de silencio y discontinuidad de amplitud en audio sintético. No inferir calidad audible sólo de `currentTime`.

Primera ruta: optimizar el puente nativo, eliminar escritores duplicados, distinguir seek solicitado/completado y evitar tormentas de seek. Medir visible/oculto y CPU limitada. `requestAnimationFrame` puede reducir actividad en background; un timer no constituye por sí mismo solución de audio preciso.

Segunda ruta, condicionada al experimento: motor de loop local con buffer accesible, dueño exclusivo y handoff explícito al reproductor nativo. Evaluar CORS, memoria, cambios de canción, volumen, efectos, Keep Tone y suspensión de contexto antes de comprometer implementación. Nunca reproducir ambos motores simultáneamente. Si no puede darse continuidad, conservar fallback nativo y explicarlo en la UI.

Evaluar microfade/crossfade como opción, con duración acotada por la región, señal de prueba y comparación auditiva. Puede reducir clics pero alterar transientes; mantener opción de corte exacto. No cambiar exportaciones existentes automáticamente. Para un modo buffer, objetivos iniciales de laboratorio: discontinuidad temporal ≤10 ms y ausencia de silencio insertado detectable en fixtures; validar viabilidad antes de prometer “sin cortes”. Para nativo, publicar resultados de baseline y mejora, sin etiquetarlo sample-accurate.

Aceptación: informe reproducible y comparación ciega con señales sostenidas y percusivas; 100 vueltas; rate normal/lento/rápido, efectos y Keep Tone, navegación, audio pausado y fallback. Si no se alcanza la calidad, entregar correcciones medibles y dejar el motor alternativo como no apto para release.

### E8. Waveform y rendimiento

Separar capas: waveform estático dependiente de samples/zoom/tamaño/DPR, regiones dependientes de A/B y playhead dependiente de tiempo. El playhead no debe reconstruir todos los samples por frame. Cachear geometría y máximos de amplitud; invalidar por fuente/zoom/resize, no por render general del panel.

Agrupar pointermove/wheel en un frame; mantener último evento, no cola completa. Leer geometría una vez por interacción o invalidación y agrupar escrituras para evitar layout repetido. No guardar ni autorizar cada pixel; commit por gesto y respuesta de UI inmediata. Limitar caché por bytes con descarte LRU.

Panel colapsado: conservar datos mínimos, detener dibujo y carga innecesaria; reproducción continúa. Pestaña oculta: detener trabajo visual, no confundirlo con detener audio. Revisar observers, intervalos, listeners y buffers al cambiar canción/desmontar. Decimar waveform según pixels visibles y reutilizar datos de una misma fuente.

Sólo llevar análisis pesado a Worker/OffscreenCanvas si el perfil demuestra coste y la compatibilidad lo permite. Medir mejoras individualmente; evitar introducir cachés sin límites o complejidad sin evidencia.

Aceptación: presupuestos de sección 8, ausencia de crecimiento de listeners/buffers después de 50 cambios de canción y ausencia de flashes de controles durante arrastre. El resultado incluye trazas antes/después en las mismas fixtures.

### E9. Free/Pro, límites y oferta contextual

Propuesta a evaluar: loop manual básico permanente en Free; hasta 3 loops guardados en total; biblioteca sin límite comercial, múltiples regiones avanzadas, snap musical, práctica y exportación musical en Pro. Cantidad gratis y distribución exacta se validan con producto. Los 3 registros pueden pertenecer a una o varias canciones; no crear un límite distinto por cada superficie.

Hay un conflicto deliberado con trial actual. Implementar política versionada y matriz explícita, no cambiar sólo el texto de UI. Mantener trial histórico y recibos; no resetear contadores para usuarios actuales. Pro comprado conserva derechos. Usuarios existentes con más de 3 registros conservan datos y lectura; bloquear únicamente creación adicional cuando corresponda. Backup, borrar y recuperación siguen disponibles.

Matriz candidata:

| Acción | Free candidato | Pro candidato |
| --- | --- | --- |
| Selección manual, reproducción A/B, zoom, undo y teclado básico | Sí | Sí |
| Guardado local | 3 registros globales | Sin límite comercial |
| Lectura y gestión de datos ya guardados | Sí | Sí |
| Snap y selección por compases | Vista de valor o trial definido | Sí |
| Práctica progresiva | Vista de valor o trial definido | Sí |
| Exportar WAV individual/lote | No | Sí |
| Tempo, Keep Tone, efectos | Conservar política actual hasta decidir experimento separado | Sí |
| Sincronización futura | Decisión posterior | Posible complemento, no promesa actual |

Paywall al intentar cuarta creación: “Ya guardaste 3 loops. Con Pro puedes guardar más y volver a tus regiones cuando quieras”. Conservar borrador y reanudar la intención una vez activada la licencia, con nueva comprobación de identidad y generación. Cancelar compra devuelve al trabajo. No abrir checkout por cambiar un slider ni mostrar el mismo aviso por cada movimiento.

Centralizar capacidades nuevas en política, no dispersar conteos en UI. Operaciones propuestas: save-loop, duplicate-loop, apply-grid, start-practice y export-loop-batch. Auditar restauración: un registro guardado no permite saltarse gates de efectos/rate. Actualizar locales disponibles, ayuda, popup, landing y copy de tienda sólo para capacidades listas.

No fijar otro precio por intuición. Primero medir adquisición y uso de biblioteca. Si se experimenta precio, definir población, duración, coherencia con checkout y tratamiento de compradores previos. No reutilizar un único variant de cobro con dos precios anunciados incongruentes.

### E10. Métricas, embudo y experimentos

Reutilizar comercio/eventos existentes y extender allowlists en cliente y servicio. Mantener un modo local de diagnóstico separado de métricas remotas. Antes de habilitar envío, definir consentimiento/configuración y documentación de datos. No transmitir nombres de regiones, títulos, URLs, IDs de canciones, audio ni historial de escucha.

Eventos propuestos con esquema mínimo:

| Evento | Disparo | Propiedades permitidas |
| --- | --- | --- |
| loop_created | Primer commit válido, no pointermove | source, policyVersion |
| loop_saved | Escritura confirmada | countBucket, isFirstSave |
| loop_restored | Aplicación confirmada | settingsRestored, source |
| loop_feature_attempted | Acción explícita avanzada | feature, allowed, policyVersion |
| practice_started/completed | Transición del motor | presetBucket, outcome |
| loop_export_completed/failed | Fin de elemento o lote, definido sin doble conteo | mode, countBucket, errorCode |
| paywall_seen | Impresión visible real | feature, experimentVariant |
| checkout_started/license_activated | Reutilizar eventos existentes | origen y variante correlacionables permitidos |

Usar eventId idempotente, versión de esquema, timestamp y cola acotada con TTL/backoff. Registrar pérdida de eventos agregada; no retener indefinidamente. La identidad de instalación usada para medir retorno es pseudónima, no anónima: minimizar acceso y retención; propuesta inicial 30 días de eventos detallados y agregados después, sujeta a diseño del servicio. No registrar por vuelta ni por frame.

Métricas con denominadores definidos:

- Activación: instalaciones elegibles que confirman primer loop / instalaciones elegibles que abren Player Tools.
- Guardado: usuarios con escritura confirmada / usuarios con loop creado.
- Restauración: usuarios que restauran en otro día / usuarios que guardaron y tuvieron ventana completa de observación.
- Retención D7 del looper: usuarios activados que vuelven entre días 7–13 / cohorte activada con 14 días observables. No confundir con abrir la extensión.
- Conversión contextual: compras atribuidas dentro de 7 días / usuarios únicos con intento premium; separar impresiones, clicks y activaciones.
- Ingreso neto por instalación elegible: ingresos menos reembolsos, comisiones y costes variables / instalaciones expuestas. Separar compras brutas y licencias activadas.
- Guardrails: error de reproducción/export, abandono tras paywall, reembolsos, fallos de guardado y rendimiento.

Orden de experimentos: instrumentación validada → guardar/restaurar → paywall contextual → política Free básica vs actual → cantidad gratis → precio. Una variable comercial principal por experimento. Asignación estable por instalación y versión, sin cambiar derechos dentro de una sesión. Definir efecto mínimo útil y tamaño muestral desde baseline; no declarar ganador por unos pocos compradores o antes de madurar cohortes.

Si no hay tráfico suficiente, entregar cohortes descriptivas y entrevistas/pruebas de uso, con incertidumbre explícita. No inventar crecimiento esperado. Las decisiones deben valorar ingreso neto y retorno, no únicamente clicks de checkout.

### E11. Sincronización entre dispositivos, posterior a biblioteca local

Dependencias: E1/E2 estables, demanda observable y coste de soporte evaluado. Separar cuenta de biblioteca y licencia por instalación: una compra actual no implica automáticamente derecho multidispositivo.

Diseñar autenticación, relación cuenta/licencia, límites de dispositivos y coste antes del backend. Sincronizar sólo metadatos de regiones/configuración, no audio ni cookies. API con revisión, control de acceso por usuario, tombstones y operaciones idempotentes. Mantener uso offline y cola local de cambios.

Conflicto simultáneo: conservar ambas versiones o presentar resolución; no usar reloj del cliente como autoridad única. Borrados se propagan mediante tombstones con retención definida. Cerrar sesión no elimina datos locales sin acción explícita. Importación inicial identifica duplicados por ID y revisión, no sólo nombre.

Pruebas: dos dispositivos offline, ediciones concurrentes, revocación, reintento, eliminación, cuenta equivocada, límites y recuperación de backup. Entregar sincronización sólo si identidad y permisos están resueltos; no bloquear el lanzamiento local por esta fase.

## 7. Orden, dependencias y entregables

| Hito | Etapas | Entregable revisable | Condición para avanzar |
| --- | --- | --- | --- |
| M0 | E0 | Contratos, baseline y carreras cubiertas | Autoridad y gestos definidos |
| M1 | E1 + parte de E10 | Guardar/restaurar, eventos confirmados y backup | Datos recuperables y restore seguro |
| M2 | E2 + E3 | Biblioteca útil, múltiples regiones e historial | Flujo completo con teclado y varias pestañas |
| M3 | E8 + medición E7 | Waveform optimizado y reporte de audio | Mejoras medibles sin regresiones |
| M4 | E4 manual | BPM/origen, compases y snap | Grid coherente con tiempos originales |
| M5 | E5 | Práctica progresiva | Vueltas fiables desde dueño de audio |
| M6 | E6 | Batch WAV | Jobs recuperables y audio validado |
| M7 | E9 + E10 | Oferta y experimento comercial | Matriz de derechos y eventos auditados |
| M8 | E4 automática + E7 avanzada | Estimación BPM y continuidad mejorada | Experimentos técnicos cumplen calidad |
| M9 | E11 | Sync opcional | Demanda y modelo de cuenta resueltos |

La medición empieza antes de cada optimización. Los gates existentes permiten desarrollar funciones premium sin esperar una nueva política Free; el lanzamiento de esa política es una decisión separada y medible. El orden recomendado prioriza biblioteca porque conserva trabajo con menor incertidumbre que un motor de audio nuevo.

Estimaciones orientativas de ingeniería, no compromisos: E0 1–3 días; E1 4–7; E2 3–5; E3 2–4; E4 manual 3–5 y automática 5–10 adicionales; E5 4–7; E6 4–7; E7 medición/correcciones 3–5 y motor alternativo 10–20 si viable; E8 3–6; E9 3–5; E10 3–6 más tiempo real de observación; E11 10–20 después del diseño de identidad. Considerar integración y QA entre etapas; no sumar como fecha de entrega garantizada.

Cada entrega debe incluir problema, comportamiento final, archivos tocados, pruebas, evidencia visual cuando cambie layout y riesgos abiertos. No mezclar optimización de Likes Explorer con estos commits. Preferir incrementos que se puedan desactivar sin revertir datos persistidos.

## 8. Plan de verificación y presupuestos

### 8.1 Casos comunes

Matriz de medios: 30 s, 5 min y 2 h; mono/estéreo; silencios, transientes y señales continuas. Rangos de 250 ms, 1 s y 16 s, inicio/final, zoom extremo, velocidad normal/lenta/rápida y Keep Tone activo/inactivo.

Matriz de lifecycle: pestaña visible/oculta, panel abierto/cerrado, navegación SPA, cambio de player, frames, dos pestañas, worker reiniciado, permiso tardío, desconexión y reproducción pausada. Matriz comercial: trial no iniciado, disponible, último uso, vencido, Free y Pro; mantener nombres reales de estados de política.

Matriz de biblioteca: vacía, 1, 3, 4 y 1.000 registros; nombre Unicode; canción eliminada; URL alias; duración cambiada; storage lleno; migración antigua/futura/corrupta; conflicto entre pestañas; backup e importación parcial.

### 8.2 Presupuestos iniciales

En máquina de referencia registrada, Chrome y dimensiones fijas, medir al menos 5 corridas y reportar mediana/p95. Los siguientes son objetivos de ingeniería a calibrar en E0, no resultados actuales:

- Respuesta visual al arrastre p95 ≤50 ms; trabajo de JS/dibujo del frame p95 <8 ms para una pantalla de 60 Hz.
- Cero long tasks >50 ms atribuibles al arrastre en fixture habitual; analizar por separado decodificación/exportación.
- Guardado local p95 <200 ms y primera lista de canción <150 ms con 1.000 registros en la referencia.
- Cero redibujos continuos del canvas colapsado; no volver a descargar el mismo waveform por abrir/cerrar repetidamente.
- Exportación secuencial sin crecimiento sostenido de buffers; presupuesto de memoria decidido a partir de tamaño real decodificado: duración × sampleRate × canales × 4 bytes, más copias/transformaciones.
- Después de 50 cambios de canción y limpieza, conteo de listeners/observers estable y memoria retenida sin tendencia creciente; no exigir una cifra de heap exacta dependiente del GC.
- Calidad audible medida según E7; reloj de UI y duración de WAV no sustituyen análisis del audio en vivo.

### 8.3 Pruebas por capa

Core: normalización, cuadrícula, historial, límites Free y práctica con reloj/eventos inyectados. Persistencia: atomicidad, revisions, reintentos, fallos y migración. Browser: gestos reales con mouse/teclado, foco y sincronía entre superficies. Extensión real: worlds/frames, worker, permisos y entitlement. Audio: archivos verificables y escucha guiada con fixtures; comercial: checkout de prueba y coherencia de precio/capacidades.

Comandos existentes de referencia en PowerShell: `npm.cmd test`, `npm.cmd run test:e2e`, `npm.cmd run test:e2e:tempo`, `npm.cmd run test:e2e:effects`, `npm.cmd run test:player-tools`. Añadir verificadores de biblioteca/grid/práctica/batch al runner cuando se implementen. Revisar recursos y entorno antes de pruebas live. Un fallo previo del runner puede impedir que ejecute suites posteriores: ejecutar las relevantes individualmente y registrar resultados actuales.

En la sesión anterior se reportaron tests específicos del looper/tempo aprobados y un fallo en avatar del popup dentro del runner general. No se reejecutaron al redactar este plan; no asumir que ese fallo persiste ni que demuestra una regresión de looper.

## 9. Riesgos y decisiones que deben quedar resueltas

| Riesgo/decisión | Respuesta prevista | Etapa |
| --- | --- | --- |
| Cambiar Free reduce ingresos de trial actual | Cohortes, variante estable e ingreso neto como métrica | E9/E10 |
| Más UI dificulta primer loop | Biblioteca y opciones avanzadas progresivas | E1–E5 |
| Autorización lenta aplica intención vieja | Generación + ID de intención y commit único | E0/E1 |
| Persistencia pierde cambios entre pestañas | Escritor único y expectedRevision | E1 |
| Guardado permite evadir capacidades | Revalidar al aplicar cada ajuste | E1/E9 |
| Snap detecta mal beat o downbeat | BPM/origen manual, confianza y corrección | E4 |
| Background degrada loops/práctica | Medir audio y contabilizar vueltas en dueño real | E5/E7 |
| Batch consume RAM o duplica descargas | Concurrencia 1, presupuestos y jobs idempotentes | E6 |
| Claim “sin cortes” excede evidencia | Gates auditivos y fallback explicado | E7 |
| Sync modifica licencia por instalación | Diseñar derechos/cuenta antes del backend | E11 |
| Experimento usa datos de escucha | Esquema mínimo y prohibición de metadatos musicales | E10 |

Decisiones predeterminadas del plan: almacenamiento local primero; 3 guardados Free como variante candidata; motor nativo como fallback; BPM manual antes que estimado; WAV separado antes de ZIP; una sola región activa; audio pausado permanece pausado; no reproducir automáticamente por abrir biblioteca; no cambiar precio en la primera entrega.

## 10. Lanzamiento, compatibilidad y rollback

Publicar por hitos pequeños después de pruebas de paquete real. Incluir feature flags internas para biblioteca avanzada, grid, práctica, batch y motor alternativo. Defaults definidos en código; no depender de configuración remota para abrir herramientas o leer datos.

Antes de ampliar audiencia: paquete sin fixtures/keys de prueba, contratos de mensajes verificados, locales actualizados, ayuda consistente, versionado de datos, capturas de UI y notas de release. Verificar manifest/allowlist de empaquetado y versiones del backend cuando se incorporen eventos/capacidades nuevas.

Rollback de una función apaga nuevas acciones pero conserva lectura de registros existentes. No bajar schema ni resetear trial/licencias. Si una versión vieja no entiende datos nuevos, debe ignorar extensiones opcionales o declarar incompatibilidad sin borrar. Para batch, detener nuevas unidades y preservar resultados. Para audio alternativo, entregar control al nativo sin superposición. Para experimento comercial, respetar oferta ya aceptada y compras previas.

Revisar tras lanzamiento errores, restauración de loops guardados, rendimiento y funnel por cohorte. No usar ausencia de reportes como evidencia suficiente de precisión o integridad de datos.

## 11. Checklist global de finalización

- [ ] Guardar, nombrar y restaurar A/B, velocidad, Keep Tone y efectos por canción.
- [ ] Múltiples regiones, lista global, filtros, duplicación y recuperación de datos.
- [ ] Arrastre coherente, doble clic definido, reset de zoom accesible, undo/redo y teclado.
- [ ] BPM manual/tap, origen, compases y snap; estimación automática evaluada y corregible.
- [ ] Práctica progresiva con vueltas reales, pausas y cancelación robusta.
- [ ] Batch WAV con snapshots, permisos, progreso, cancelación y recuperación.
- [ ] Baseline de audio y mejora de continuidad respaldada por medición.
- [ ] Waveform por capas, caché acotada, inactividad visual y cleanup verificados.
- [ ] Política comercial versionada, paywalls contextuales y borradores preservados.
- [ ] Métricas con denominadores, datos mínimos y experimentos interpretables.
- [ ] Sync implementado si supera gate de identidad/demanda; en caso contrario, decisión y backlog explícitos.
- [ ] Locales, ayuda, empaquetado, migración y rollback probados.

Primer trabajo ejecutable recomendado: E0 y luego el corte vertical de E1 — crear una región, guardarla con nombre, recargar la canción y restaurarla con sus ajustes. Esto entrega valor observable antes de incorporar detección musical, un motor alternativo de audio o servicios de sincronización.
