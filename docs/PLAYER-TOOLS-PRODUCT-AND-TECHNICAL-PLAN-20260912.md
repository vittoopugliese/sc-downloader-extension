# Player Tools: plan de producto e implementación

Fecha: 2026-09-12. Estado: decisiones registradas; implementación parcial, no lista para release.
Base inspeccionada al escribir: `7f3187e8c777cc42942e6b20f44ccecad4774725`.
Este documento incorpora las respuestas explícitas del usuario del 12 de septiembre y reemplaza propuestas anteriores incompatibles sobre Free, precios, descargas y rediseño del panel.

## Base de código implementada — 2026-09-13

La instrucción posterior del usuario autorizó implementar las bases importantes y preparar la continuación. Por eso las pausas de las secciones 1 y 18 y la limitación a una entrega exclusivamente documental describen la sesión anterior; no obligan a volver a elegir una etapa para esta base autorizada.

Leer [el contrato y la guía de continuación](PLAYER-TOOLS-FOUNDATION-HANDOFF-20260913.md) antes de editar acceso o conectar el panel. Esta actualización corresponde al árbol de trabajo, no a un commit ni a un release.

- E2: política de capacidades corregida; persistencia estricta, revisión monotónica, inicialización única y almacenamiento inyectable para tests. Se retiró el escritor interno de entitlement de producción. **Sigue faltando el build/herramienta dev Free/Pro.**
- E3: núcleo de autorización implementado y probado con cola única, rangos válidos, identidad de documento, generación, recibos idempotentes, consumo global y gracia exclusiva del último propietario. **El panel y los otros consumidores de loops todavía no solicitan estos permisos antes de aplicar loops.** No es un trial integrado.
- Cliente ISOLATED: transporta request ID/generación, limita tamaño de mensajes, refresca ante cambios de storage, descarta snapshots atrasados también en respuestas correlacionadas y publica estado de error con capacidades cerradas.
- E5: pruebas de routing usan el servicio real de acceso para verificar rechazo Free de loop/track transformado antes de resolver/procesar y continuidad de originales/bulk agotado. No es QA completa de export ni validación de solicitudes malformadas.
- Verificación: `npm test` pasó con 37 verificadores locales, incluido el renderer Signalsmith empaquetado. El fallo del renderer descrito en la auditoría histórica de abajo ya no se reproduce en este árbol. No se ejecutó QA visual, E2E con extensión real ni empaquetado.

La decisión de fin de trial para uso exclusivo de tempo sigue pendiente. E1, E4, E6, la integración restante de E2/E3/E5 y las restricciones de producto conservan su alcance original.

## Actualización de implementación — 2026-09-13

Auditoría del árbol lineal desde la base del plan hasta `905943b` (`629b55f`, `817149b`, `c33963f`, `6352d2b`, `905943b`). Había cambios locales sin commit durante la auditoría; no se atribuyen a `HEAD` ni cambian esta lectura de los commits.

| Etapa | Estado real | Evidencia y trabajo que falta |
| --- | --- | --- |
| E1 — Promoción propia | Parcial | La franja existe en `popup.html`, muestra ícono y los importes aprobados, y `popup.js` abre una pestaña/panel. El copy está hardcodeado, dice `Tempo & looping tools` en vez del copy aprobado y no tiene claves en los cinco locales. La apertura no implementa handshake, espera de montaje, timeout de intención ni instrucción cuando no hay player. |
| E2 — Acceso y fixtures | Parcial | Existen `player-tools-policy.js`, `player-tools-access.js` y `player-tools-client.js`; background es el único escritor y serializa operaciones. Falta el tooling/build dev Free/Pro, adapter separado de release y todos los escenarios de fixture. También falta que las capacidades deriven realmente del estado: el snapshot hoy deja tempo, Keep Tone, presets y loops habilitados para Free incluso con `used=20`. |
| E3 — Trial global | No implementada de forma funcional | `begin-loop` está en las operaciones Free pero `canAuthorize` devuelve `consume: false`; por ello `authorize` nunca incrementa `used` ni crea una concesión. El panel tampoco pide autorización antes de `set-loop`. No están implementados el aviso 2→1, idempotencia por request ID, owner/generación, disputa entre pestañas, gracia del loop 20 ni su recuperación tras reiniciar el worker. |
| E4 — UI bloqueada | No implementada | Hay CSS y CTA para `.waveform-shell.is-locked`, pero `render()` siempre elimina esa clase y habilita slider, Keep Tone, presets y looper. La CTA abre la guía del looper/popup, no un flujo de disponibilidad Pro. Falta neutralizar el audio efectivo, colapsar el looper, retirar rutas de teclado y gestionar foco/`aria-live`. |
| E5 — Export Pro | Parcial | `background.js` rechaza `DOWNLOAD_LOOP` y track transformado cuando el acceso no es Pro; original/bulk siguen permitidos. Falta una activación/entitlement de producto integrada y pruebas de las rutas manipuladas, transformaciones efectivas, WAV real y comportamiento Free agotado. El estado Pro sólo puede ser escrito por la superficie interna actual; no existe el tooling dev definido por E2. |
| E6 — Locales e integración | No implementada | No hay claves Player Tools en los cinco locales ni diccionario MAIN. La ayuda todavía afirma seis presets, dos botones X, rango 0.1x–4x, exportes sin plan y loop gratuito. `npm test` falla en `verify-pitched-loop-renderer.js` porque depende de `repos/soundcloud-tempo-control-main/vendor/signalsmith/wasm-factory.mjs`, ausente del repo. Faltan las pruebas de política/lifecycle y la QA visual/accesible/paquete de la etapa. |

Dos cambios del árbol exceden este plan y deben mantenerse aislados hasta una decisión explícita: `audio-effects-core.js` introduce reverb/delay, aunque el plan difiere audio nuevo; `services/player-tools-license/` introduce checkout, Lemon Squeezy, D1 y webhooks, aunque E8 se asignó a otro chat y no debe integrarse ni publicarse como parte de E1–E6. Ninguno está conectado al flujo de compra de la extensión en `HEAD`.

El pendiente de producto de la sección 6 sigue abierto: el límite de veinte loops no hace finita la prueba para quien sólo usa tempo/Keep Tone/presets. Antes de cerrar E2–E4 hay que decidir la condición que termina esa vía de prueba. Hasta entonces no es correcto declarar listo el producto Free/Pro.

## 1. Cómo retomar en una sesión en frío

Leer este documento completo, revisar HEAD y el árbol de trabajo e inspeccionar los archivos afectados antes de implementar. El código puede haber cambiado desde esta base. Los hallazgos son una lectura del código, no una declaración de pruebas ejecutadas.

**La siguiente sesión debe preguntarle al usuario qué etapa de este plan quiere arrancar primero.** Usar la herramienta de preguntas de la aplicación/terminal cuando esté disponible. No iniciar automáticamente toda la implementación. Esta pausa es un pedido explícito del usuario, no una exigencia técnica de una skill.

La entrega de esta sesión es exclusivamente el plan guardado en `docs`. No se implementan ahora promoción, trial, gates, licencias, herramientas de desarrollo ni audio nuevo. Una vez elegida una etapa, avanzar dentro de su alcance; no volver a preguntar las decisiones ya cerradas aquí.

Distinguir tres clases de contenido:

- **Confirmado:** decisión del usuario; conservarla salvo nueva instrucción.
- **Diseño propuesto:** mecanismo técnico para concretarla; se puede ajustar con evidencia sin cambiar el producto.
- **Pendiente para su etapa:** ambigüedad real; no convertir una propuesta en una aprobación implícita.

## 2. Objetivo y restricciones confirmadas

Downloader seguirá siendo gratuito: tracks completos, colecciones, selección, carpetas y formatos disponibles. Player Tools tendrá una demostración limitada y luego requerirá Pro. El objetivo comercial es que Free permita conocer el producto sin convertirse en el plan permanente de sus herramientas musicales.

El usuario conserva la UI actual. Mantener nombre grande, logo, invitación a calificar, composición del panel, controles actuales y cuatro presets. No rediseñar en tres bloques Tempo/Pitch/Loop, no volver a ocho botones, no cambiar dimensiones generales por iniciativa propia. Las modificaciones permitidas son las necesarias para la promoción y estados de acceso acordados. Cualquier control musical futuro queda en su etapa diferida.

No se conceden licencias Founder ni derechos por instalaciones anteriores. Toda instalación de producción parte de Free. Esto no significa resetear el contador en cada actualización: sólo inicializarlo una vez cuando la nueva versión introduce el trial.

No publicidad de terceros. Sí autopromoción de Player Tools dentro de `popup.html`, usando el ícono existente. No agregar SDK publicitario ni analítica por este plan.

Pagos, checkout, Lemon Squeezy, backend de licencias, wallet y flujo manual se trabajan aparte. No bloquear la documentación ni el diseño local por su ausencia. No presentar una compra funcional antes de disponer de ella.

## 3. Registro de las 17 respuestas

| Tema | Decisión vigente |
| --- | --- |
| 1. CTA | Abrir/enfocar SoundCloud y abrir el panel Player Tools para probarlo. |
| 2. Promoción | Copy propuesto aprobado, precios exactos 6.79 y 3.69, lifetime, 46% OFF. |
| 3. Consumo | Un uso al completar y activar un A–B nuevo; ajustes del mismo loop no cobran otra vez. Clear seguido de otro rango sí. |
| 4. Persistencia | Local por ahora; backend futuro. |
| 5. Último uso | El loop 20 puede seguir funcionando hasta terminar su sesión; no cortarlo al concederlo. |
| 6. Avisos | Avisar recién cuando quede un único uso; ningún contador permanente ni aviso a cinco. |
| 7. Trial | Escucha A–B y edición visual básica; WAV, timestamps precisos y nudges avanzados Pro. |
| 8. Agotado | Looper colapsado, imposible maximizar; setters reemplazados por CTA. Sin texto 20/20. Veinte usos globales totales, nunca mensuales. |
| 9. Presets | Opción B: cuatro presets guardables durante acceso habilitado, evitando gates por slot. La respuesta 10 limita su disponibilidad posterior. |
| 10. Free final | Al cerrar la prueba, sólo queda gratis el módulo Downloader. No mantener tempo/presets como regalo permanente. |
| 11. Keep Tone | Conservar actual. Interés futuro en Vinyl Mode compacto y pitch como feature Pro. |
| 12. Pitch UI | Futuro: alternar el slider actual entre nomenclatura x y semitonos. Nada ahora. |
| 13. Pitch pasos | Semitonos enteros, paso 1 st; granularidad actual en x en el modo alternativo. |
| 14. Descargas | La corrección final prevalece: conservar descarga completa con efectos del panel porque ya existe. WAV/A–B sólo Pro; popup original. |
| 15. Dev | Diseñar tooling local para que el único desarrollador pruebe ambos planes. |
| 16. Idiomas | Inglés, español, pt_BR, alemán y ruso desde la implementación. |
| 17. Audio | No hacer ahora investigación/prototipo de procesamiento en vivo ni toggle de semitonos que lo requiera. |

## 4. Oferta y autopromoción

Configuración propuesta única, compartida por popup y panel:

```js
const playerToolsOffer = {
  currency: 'USD',
  referencePriceCents: 679,
  launchPriceCents: 369,
  discountPercentDisplay: 46,
  purchaseModel: 'lifetime',
  checkoutAvailable: false,
};
```

El descuento aritmético es `(679 - 369) / 679 * 100 = 45.655375...%`; redondear a 46%. Mantener importes enteros en centavos y evitar copias divergentes en locales y HTML. La oferta es de lanzamiento con referencia al precio futuro, no una afirmación de ventas anteriores a 6.79. No inventar fechas, stock de licencias ni cuenta regresiva.

Copy aprobado del popup:

> [ícono] Player Tools
> Tempo, loops & pitch tools
> ~~$6.79~~ $3.69 lifetime · 46% OFF
> Try Player Tools

Reutilizar `assets/icons/player-toolkit.png`. No generar otro bitmap. Usar `<del>` para el precio de referencia y texto accesible que explique ambos importes. Las traducciones conservan USD y los números; la coma decimal localizada puede cambiar la presentación, nunca el precio.

El término pitch del copy describe por ahora el efecto ligado a velocidad/Keep Tone ya existente; no anunciar pitch independiente, semitonos ni una transposición nueva como disponible.

Diseño propuesto: franja compacta propia al final del contenido principal del popup, conservando ubicación y operación de descargas. Validar también selección de tracks, progreso de jobs y ventanas pequeñas. No superponerla a botones ni alterar su foco. En ayuda puede haber explicación del producto, pero no duplicar indiscriminadamente la franja. Para Pro ocultar la oferta y conservar una entrada funcional a Player Tools.

Flujo de apertura propuesto:

1. Preferir pestaña activa de SoundCloud; en su defecto, una pestaña SoundCloud existente en la ventana actual y luego otra ventana.
2. Si falta, crear una pestaña de SoundCloud mediante gesto del usuario.
3. Enfocar ventana/pestaña y esperar un handshake del content script; no confiar sólo en `tabs.onUpdated`.
4. Enviar comando de abrir panel por el puente ISOLATED→MAIN, con request ID y respuesta de montaje/apertura.
5. Si todavía no existe reproductor, mostrar instrucción breve para reproducir un track; no autoplay ni seleccionar música por cuenta del usuario.
6. Expirar la intención pendiente con un timeout acotado; cancelar si la pestaña navega fuera de SoundCloud. Evitar abrir múltiples tabs por clics repetidos.

Abrir el panel no gasta un loop. Si el trial está agotado, el panel abre su estado bloqueado, no reinicia la prueba. La CTA del looper agotado muestra `Try Player Tools — $3.69 lifetime` con ícono; mientras no haya checkout, abrir una explicación de acceso/disponibilidad dentro del flujo existente. No simular activación ni conducir al mismo botón infinitamente.

## 5. Matriz de capacidades

`Free con prueba` no es otro plan comprado: es `plan=free` con trial disponible. Pro elimina límite y bloqueos de herramientas. La concesión del último loop es temporal y pertenece sólo a su sesión.

| Capacidad | Free con prueba | Free agotado | Pro |
| --- | --- | --- | --- |
| Downloader popup individual/colecciones | Sí, original | Sí, original | Sí, original |
| Descargar original desde entradas normales de página | Sí | Sí | Sí |
| Abrir panel para descubrir producto | Sí | Sí, bloqueado | Sí |
| Slider actual 0.1x–3x | Sí | No | Sí |
| Keep Tone actual | Sí | No | Sí |
| Cuatro presets aplicar/guardar | Sí | No | Sí |
| Nuevo loop A–B | Hasta 20 globales | No | Sin cuota |
| Escuchar/editar visualmente loop concedido | Sí | Sólo gracia de último loop | Sí |
| Maximizar looper | Sí | Sólo gracia vigente | Sí |
| Zoom y ajuste visual básico | Sí | Sólo gracia vigente | Sí |
| Timestamps editables/nudges precisos | No | No | Sí |
| WAV del rango A–B, con/sin efectos | No | No | Sí |
| Track completo con efectos desde panel | No | No | Sí, conservar pipeline |
| Track completo neutro desde panel | Propuesta: original permitido | Propuesta: original permitido | Sí |
| Semitonos independientes/Vinyl nuevo | Diferido | Diferido | Diferido |

La excepción propuesta para descarga neutra dentro del panel mantiene gratuito Downloader. Debe tratarse como `download original` sólo cuando la transformación efectiva sea identidad; nunca convertir silenciosamente una solicitud con efectos en otra distinta. Si el producto decide bloquear el botón blanco entero en Free, será un ajuste explícito de esa etapa; popup y botones originales siempre funcionan.

No restringir cada slot por separado: respuesta 9B simplifica el trial. Al agotarlo se bloquea todo el acceso musical por el mismo estado de capacidades. Conservar los valores guardados para recuperar al activar Pro; no borrarlos ni sobrescribirlos con defaults al bloquear.

## 6. Punto pendiente: qué hace finita la prueba de tempo

**Veinte loop sets limitan loops, pero no limitan a quien sólo usa velocidad/Keep Tone/presets y nunca crea un loop.** El usuario pidió acceso musical muy limitado y cierre posterior; no especificó minutos, días ni usos de velocidad. No fingir que el contador de loops resuelve esa vía de uso indefinido.

Base implementable confirmada: al agotarse los veinte loops, cerrar también tempo/Keep Tone/presets. Antes de cerrar la etapa del trial, resolver si el usuario acepta que las herramientas sigan disponibles mientras haya saldo o desea otra condición de fin. Preguntar mediante la herramienta de preguntas al iniciar esa etapa, no en esta entrega documental. No inventar un límite diario, temporal ni consumir un loop al mover el slider.

La arquitectura separa `trial status` de `remaining loops` para poder añadir una condición futura sin duplicar controles. No incorporar campos de expiración o reloj manipulable hasta existir una decisión de producto.

## 7. Semántica del contador y de la sesión

Límite total: 20 por instalación/perfil de Chrome, compartido entre pestañas, frames, tracks y entradas de UI. Sin renovación mensual ni diaria, sin sincronización entre dispositivos ahora. Recargar, actualizar extensión, navegar SoundCloud, cerrar popup o reiniciar el service worker no renueva saldo.

Un uso representa un nuevo loop lógico aceptado, no un click, repetición de audio ni cada comando `set-loop`. Capturar sólo A no consume. Un B válido que completa A–B y obtiene autorización consume uno. Crear un rango completo con drag desde estado vacío tiene la misma regla. Validación mínima común: identidad/generación vigentes y `0 <= A < B <= duration`, con separación mínima actualmente 250 ms.

Una sesión conserva un `loopSessionId` estable. Cambiar A/B, arrastrar selección, hacer zoom, pausar/reanudar, minimizar/abrir panel o activar/desactivar bypass no asigna otra sesión ni consume otra vez. Clear termina esa sesión; crear después otra consume incluso si el rango coincide con el anterior. Cambiar el track invalida el permiso viejo. Reproducir otra vez el mismo track tras Clear no resucita la concesión.

La autorización se obtiene después de validar el rango y antes de empezar el enforcement de repetición. La confirmación de UI espera persistencia aceptada. Un `play()` bloqueado por autoplay no debe cobrar otra vez al reintentar: conservar la concesión para ese mismo loop. Una solicitud inválida/stale no consume. Fallos posteriores a una concesión persistida requieren reconciliar su identidad, no refund automático de cada error que permitiría duplicar saldo.

### Último loop y concurrencia

Conceder el uso 20 establece `used=20`, pero permite continuar ese loop. `remaining=0` no equivale a bloquear instantáneamente a su propietario. Propuesta: la gracia mantiene las capacidades de escucha y ajuste del trial en el documento/sesión titular; no habilita nuevas sesiones en otras pestañas ni exportaciones Pro.

Mientras exista esa gracia el panel propietario puede seguir maximizado y sus A/B disponibles, conforme a la respuesta 5. Al terminarla se aplica el colapso de respuesta 8. La excepción debe estar escrita en tests para no implementar accidentalmente dos reglas contradictorias.

La gracia termina al hacer Clear, cambiar track, cerrar/reemplazar el documento o perder definitivamente el loop activo. Pausa, bypass y cierre visual del panel no la terminan. Navegación SPA que conserva track/documento/sesión no la termina; recarga completa crea documento nuevo y la termina. Reiniciar sólo el service worker no debe cortar el loop vigente: recuperar la concesión guardada y verificar propietario.

Al solicitar simultáneamente el último uso desde dos pestañas, sólo una gana. La otra recibe estado agotado. No leer/modificar/escribir el contador de forma independiente desde cada content script.

Aviso únicamente cuando quede 1: publicar una notificación discreta y localizada en el status existente después de la transición 2→1. No mostrar 19, 18, etc., ni toast repetido por polling o recarga. Registrar deduplicación. Al llegar a cero usar la UI de bloqueo; no mostrar `20/20 free used`. En información secundaria sí explicar que la demostración fue limitada y Pro desbloquea acceso permanente.

### Límite conocido del almacenamiento local

Desinstalar o borrar datos de la extensión puede reiniciar el trial. Un usuario que modifica el código también puede saltar controles. No prometer protección absoluta local, ni introducir fingerprinting. La migración futura al backend definirá cómo conciliar instalaciones y saldo; este documento no autoriza implementarla.

## 8. Máquina de estados y almacenamiento propuestos

Estados derivados:

| Estado | Entrada | Salida y efecto |
| --- | --- | --- |
| loading | Inicio sin snapshot | Downloader funciona; musical espera carga, no concede acceso optimista. |
| trial_available | Free, used < 20 | Capacidades trial; nueva sesión válida incrementa used. |
| trial_last_session | Free, used=20, concesión vigente para este owner | Sólo continuación de último loop; cero nuevas sesiones. |
| free_locked | Free, used=20 sin concesión propia | Audio nativo y CTA; looper colapsado. |
| pro | Entitlement Pro válido o fixture dev | Herramientas actuales completas, sin consumo. |
| access_error | Fallo de lectura/escritura/versión inválida | Error recuperable; Downloader sigue; no inventar saldo ni Pro. |

Persistencia propuesta `chrome.storage.local['scdl.playerTools.access.v1']`:

```js
{
  schemaVersion: 1,
  revision: 0,
  trial: {
    limit: 20,
    used: 0,
    warnedLastUse: false,
    grants: [] // sesión, owner verificado, identidad, generación, requestId
  }
}
```

`limit` en datos no es autoridad editable: validar contra la política de versión. `used` entero dentro de [0,20]. `remaining` se deriva; no almacenarlo aparte. No mezclar preferencias de audio con cuota. El plan de producción inicial lo determina el adapter de acceso, no un booleano Pro leído de `localStorage` de SoundCloud.

Guardar concesiones activas e idempotencia con límites de tamaño y limpieza por lifecycle. No truncar IDs necesarios para reintentos pendientes. Usar `chrome.storage.session` para datos efímeros sólo si la recuperación definida no requiere su supervivencia; el contador permanece en local. No persistir rangos de reproducción por track como nueva feature.

Migración inicial: clave ausente crea Free con veinte usos, sin mirar antigüedad de instalación ni badge previo. Clave presente se valida/migra y nunca reinicia por `onInstalled` update. Datos corruptos producen estado recuperable y logging local; no reset automático para regalar cuota. Reset existe exclusivamente en tooling dev. Al simular Pro y volver a Free, conservar contador salvo comando de fixture/reset explícito.

## 9. Módulos, interfaces y distribución de responsabilidades

Aplicar módulos profundos: la interfaz de acceso oculta política, persistencia, serialización, deduplicación y cálculo de capacidades. Evitar checks `isPro` dispersos sin semántica compartida.

Nombres propuestos, no archivos ya existentes:

| Módulo | Interfaz/responsabilidad | Ubicación propuesta |
| --- | --- | --- |
| Política pura | Derivar capacidades/estado desde plan, contador y owner | `scripts/player-tools-policy.js` |
| Acceso runtime | Snapshot, autorizar operación, terminar sesión, suscribirse | `scripts/player-tools-access.js`, dueño background |
| Adapter local | Leer/escribir estado validado; recuperar concesiones | Interno al acceso; storage inyectado en tests |
| Cliente aislado | Transportar operaciones MAIN↔runtime y respuestas | `scripts/player-tools-client.js` |
| Oferta | Importes/copy keys y destino según disponibilidad | `scripts/player-tools-offer.js` |
| Adapter dev | Estado simulado por fixtures sólo build local | Fuera de allow-list de release |

Superficie ilustrativa del runtime:

```js
getSnapshot(owner)
authorize({ operation, requestId, sessionId, expectedGeneration, payload }, owner)
endSession({ sessionId, reason }, owner)
subscribe(listener)
```

`owner` lo construye el background desde sender/tab/frame/document, no se confía en tabId enviado desde la página. `authorize` devuelve una decisión tipada, snapshot/revision y concesión si corresponde. Operaciones internas posibles: `begin-loop`, `edit-loop`, `export-loop`, `export-track-effects`, `set-rate`, `save-preset`. No es necesario publicar un método distinto por cada botón.

Errores estables: `access-loading`, `trial-exhausted`, `pro-required`, `storage-unavailable`, `stale-generation`, `invalid-range`, `owner-gone`, `unknown-operation`. Traducir en UI; no usar cadenas inglesas para lógica.

Una cola única en el background serializa concesiones y escribe el registro completo antes de responder. `chrome.storage.local` no proporciona compare-and-swap por sumar un número: la cola y un solo escritor son necesarios. Tras reinicio, leer estado durable antes de tramitar otra operación. Request IDs estables hacen idempotentes reintentos por respuestas perdidas.

Para resolver cambio de track durante autorización: preparar snapshot identidad/generación, autorizar y volver a validar antes de aplicar. Si quedó stale, cerrar la concesión que no se llegó a aplicar mediante operación idempotente y regla de compensación acotada. No atribuir el rango al nuevo track. Documentar el punto de commit y probar interrupciones antes/después; no afirmar transacción atómica entre storage y DOM.

## 10. Integración con MAIN, ISOLATED y frames

Actualmente `tempo-control-main.js` vive en MAIN y usa preferencias en `localStorage` de SoundCloud. `content.js`/`looper.js` viven en ISOLATED con acceso al runtime. `looper-main-bridge.js` controla media en MAIN y usa eventos DOM y BroadcastChannel. Estos transportes no son prueba de pago ni identidad confiable por sí mismos.

El cliente aislado recibe los snapshots del background y entrega a MAIN sólo capacidades y datos públicos mínimos. Validar tamaño, versión, operaciones y números. No permitir que un evento MAIN diga `plan: pro`, resetee cuota o haga persistencia arbitraria.

La interfaz actual `requestLoop` recibe respuesta sincrónica por atributo DOM. La autorización mediante background es asíncrona: no insertar un await oculto y continuar usando `?.state` como si respondiera inmediatamente. Propuesta: conservar lectura local de snapshots para render/polling y migrar comandos de mutación que necesitan permiso a Promise con correlación y timeout. Actualizar todos sus consumidores, incluidas waveforms, drag, teclado, setters y export.

En una sesión ya concedida, los movimientos de drag se validan contra su permiso cacheado y no generan escritura durable por pixel. Un inicio nuevo espera permiso. Las revisiones/snapshots atrasados no pueden restaurar acceso después de agotarse. Frames nuevos reciben snapshot antes de habilitar loop; nunca asumir Free con veinte desde MAIN.

Al bloquear, detener enforcement de loops no autorizados y aplicar reproducción efectiva neutral `1x`. Mantener preferencias guardadas separadas de estado efectivo. Sin motor independiente actual, a 1x no hay pitch desplazado por velocidad. Bypass no es un unlock: al quitarlo con acceso agotado se mantiene neutral. Activar Pro permite volver a usar preferencias sin resucitar rangos invalidados.

La protección local de MAIN no es anticopia inviolable frente a la página/DevTools. La exportación sí debe autorizarse en background antes de resolver/descargar/renderizar: ocultar WAV en UI no basta.

## 11. UI por estado y accesibilidad

Durante prueba preservar slider, checkbox, presets, visualización y setters. Eliminar acceso funcional a timestamps precisos y nudges Pro, incluida ruta por teclado. La edición con drag permanece disponible. Una opción accesible básica para ajustar marcadores debe conservarse: no dejar usuarios de teclado sin la edición que ofrece el mouse; distinguir navegación/ajuste básico de nudges avanzados antes de implementar ese gate.

WAV visible con estado bloqueado puede abrir oferta; usar botón accionable con semántica de función Pro, no `disabled` si debe responder al click. Evitar aria-disabled que contradiga su función real de abrir promoción.

Agotado y sin gracia: forzar looper colapsado, ocultar canvas/markers/setters/Clear/WAV/inputs, impedir maximización por mouse, teclado, preferencias restauradas o comandos. Colocar CTA en el área compacta del looper; no intentar ubicarla en setters que desaparecen al colapsar. Conservar encabezado Loop Region e ícono. Controles musicales del resto del panel reflejan bloqueo y ofrecen acceso a información Pro sin cambiar la composición global.

Pro: capacidades actuales completas, sin contador ni autopromoción de compra. El badge debe derivar del snapshot, sustituyendo cualquier FREE fijo. La herramienta dev marca claramente su condición local, sin presentar una compra real.

Gestionar foco al ocultar elementos: si estaba dentro de un setter/marker, moverlo a CTA o encabezado disponible. Status con `aria-live=polite` para aviso de un uso, denegaciones y errores sin spam por polling. Mantener Escape/cierre/detach existentes y no consumir quota por gestos visuales.

## 12. Descargas: conducta actual y cambios de acceso

Lectura del código que fundamenta la decisión:

- `popup.js` llama `downloadTrack`/`downloadCollection` sin `playbackTransform`.
- `download-intent.js` envía transform opcional para single track; bulk no recibe efectos de reproducción.
- `tempo-control-main.js::downloadCurrentTrack` captura `effectiveRate` y `preservePitch` y emite `scdl:download-current-track`.
- `inline-button.js::downloadCurrentPlayerTrack` envía la transformación al intent.
- `background.js` enruta `DOWNLOAD_SINGLE_TRACK` y `DOWNLOAD_LOOP` hacia `bulk-job-manager.js`, luego ejecución/offscreen.
- `download-core.js`/`loop-audio-renderer.js` producen WAV procesado cuando corresponde; A–B recorta y renderiza.

**Conservar esta descarga completa con efectos para Pro.** La sugerencia anterior de eliminarla fue revocada por la respuesta 14. No convertir el botón blanco en export parcial; naranja WAV sigue siendo A–B.

`Original` en este plan significa audio sin efectos de Player Tools. No equivale necesariamente al archivo original subido por el artista: ese formato depende de la disponibilidad ya existente. Tampoco se afirma que el popup tenga un slider de velocidad: actualmente los ajustes están en el panel del player.

Regla de ejecución propuesta en background:

1. Single track sin transformación efectiva: permitir Downloader normal para todos.
2. Single track con efectos: exigir Pro antes del trabajo costoso.
3. Cualquier trim/export A–B: exigir Pro aunque rate=1 y preservePitch=false.
4. Bulk: mantener siempre audio original; no heredar transformación global.
5. Requests manipulados, incompletos o legacy: validar y aplicar las mismas reglas, no confiar en etiqueta de origen enviada por MAIN.

Normalizar identidad de transformación sin confundir `preservePitch=true, rate=1` con efecto audible. Preservar todos los formatos originales, metadatos, destinos, cancelación, jobs y reintentos. Si se rechaza una exportación, responder `pro-required`; no descargar otro archivo silenciosamente.

Para Pro tomar snapshot de identidad/generación, rango y transformación al click; no mezclar estado posterior mientras se resuelve metadata. Bypass produce transformación neutral efectiva; al quitarlo se recupera preferencia autorizada. El loop neutro sigue siendo Pro.

Revisar cuantización: controller actual permite 0.0125 y cuatro decimales internos; el renderer normaliza a tres decimales y todavía acepta hasta 4x mientras UI llega a 3x. Son diferencias existentes a revisar al probar export, no autorización para cambiar nomenclatura, límites o motor ahora. Registrar resultados antes de ampliar ese alcance.

## 13. Tooling local Free/Pro

Requisito confirmado: el desarrollador con el repo en su PC necesita reproducir planes y extremos de cuota con facilidad. No exigir pagos ni introducir una key maestra en el bundle.

Propuesta: generador de build de desarrollo separado y página/herramienta local sólo incluida allí. Copiar runtime y sumar adapter dev mediante configuración generada; el paquete de release usa siempre adapter producción y excluye herramienta/config dev por allow-list. Usar otro perfil de Chrome y build de dev para evitar tocar el trial de la instalación publicada. No basta con esconder un botón por CSS o comprobar `unpacked`: otro usuario también puede cargar una extensión unpacked.

Escenarios mínimos seleccionables desde tooling:

- Free inicial, used=0.
- Free con used=18 (dos disponibles).
- Free con used=19 (uno disponible; controlar deduplicación de aviso).
- Free agotado, used=20 sin concesión.
- Último loop activo, used=20 con owner/generación reales de fixture.
- Pro, preservando contador previo.
- Fallos de storage/respuestas demoradas/reinicio para tests.
- Reset explícito sólo del estado Player Tools de desarrollo; no borrar carpetas de descargas ni otros datos.

Comandos npm propuestos, aún inexistentes: `dev:player-tools` para generar/abrir instrucciones del build local y `test:player-tools` para suite de política/integración. La interfaz de tooling muestra plan, used, remaining, estado derivado, revision y concesión, además de acciones de escenario. Simular último loop requiere un fixture de player activo, no fabricar una concesión de cualquier track de producción.

Garantías realistas: excluir override de release impide su activación por usuarios normales mediante el producto. Quien tenga código y capacidad de modificarlo puede alterar gates; no prometer identificación criptográfica del único dueño del repo sin infraestructura adicional.

## 14. Pitch/Vinyl: backlog explícitamente diferido

Ahora: conservar Keep Tone y nomenclatura x; no agregar checkbox Vinyl, toggle de unidades, slider semitonos, segundo banco de presets ni AudioWorklet. No investigar ni prototipar el motor en vivo en esta etapa.

Intención futura: usar la barra actual y un toggle para alternar entre representación/control granular en x (ejemplo 0.850x) y semitonos de -12 a +12 con paso 1 st. No es una aprobación de las opciones previas de una segunda fila con cuatro presets de pitch: el usuario las reemplazó con esta idea. Detalles de mapping de slots, modo y persistencia se decidirán al retomar.

Distinción técnica para la sesión futura: en modo ligado, una velocidad r desplaza pitch `12 * log2(r)` semitonos; inversa `r = 2^(st/12)`. Esto cambia también duración. Con Keep Tone, cambiar rate mantiene pitch y esa conversión no describe lo escuchado. Pitch independiente necesita procesamiento y no puede implementarse sólo cambiando la etiqueta del slider.

Signalsmith empaquetado se usa offline con factor de transposición fijado a 1 en el renderer actual. Tener WASM disponible no demuestra integración segura en vivo. Si se retoma pitch independiente, primero definir semántica entre modo ligado, Keep Tone y control independiente, luego validar viabilidad de audio; requiere nueva etapa elegida por el usuario. No venderlo como entregado.

## 15. Traducciones, ayuda y documentación de producto

Agregar keys a los cinco `_locales`: oferta, CTA, un uso restante, agotado, Pro requerido, estado cargando, errores recuperables y mensajes de apertura. Interpolar importes desde configuración en lugar de cinco precios hardcodeados.

MAIN no dispone directamente de `chrome.i18n`; entregar diccionario mínimo validado desde ISOLATED por el puente existente/ampliado. No colocar HTML arbitrario del diccionario en `innerHTML` para contenido de oferta; usar nodos/texto y atributos controlados.

Actualizar ayudas actualmente obsoletas: seis quick speeds/dos X, rango 4x, Looper gratis ilimitado y claims de export sin plan. Mantener instrucciones coherentes con cuatro presets, trial y WAV Pro. Describir por separado descarga del popup y descarga del player.

Revisar README/landing/listing text local cuando se elija etapa de publicación, sin editar listing remoto ni publicar por esta documentación. Informes históricos conservan su fecha y no se reescriben como si fueran auditorías actuales.

## 16. Mapa de impacto en el repo

| Archivo existente | Trabajo futuro previsto |
| --- | --- |
| `popup.html`, `scripts/popup.js` | Franja, estado de oferta, CTA y routing a pestaña/player. |
| `scripts/content.js` | Handshake, puente de acceso/copy, apertura y export. |
| `scripts/tempo-control-main.js` | Render por capacidades, concesión de loops, guard de controles, preservar UI. |
| `scripts/tempo-control-core.js` | Separar preferencias de aplicación efectiva cuando acceso está bloqueado. |
| `scripts/looper.js` | Gates equivalentes en waveform, export y comandos; nada de contador propio. |
| `scripts/looper-main-bridge.js` | Aplicar loop sólo con concesión, identidad/generación y lifecycle. |
| `scripts/loop-session.js`, `scripts/looper-core.js` | Mantener modelo/rango puro; no introducir chrome.storage aquí. |
| `scripts/background.js` | Dueño de acceso y autorización de export; routing validado. |
| `scripts/inline-button.js`, `scripts/download-intent.js` | Conservar diferencia original/efectos y responder rechazos. |
| `scripts/bulk-job-manager.js`, `scripts/track-download-execution.js` | Mantener pipeline; garantizar que autorización ocurra antes de procesar. |
| `scripts/download-core.js`, `scripts/loop-audio-renderer.js`, `scripts/offscreen.js` | Preservar render actual; modificaciones sólo necesarias a contrato de export. |
| `manifest.json` | Cargar módulos nuevos en orden correcto y worlds necesarios. |
| `scripts/package-extension.ps1` | Incluir runtime nuevo; excluir dev; validar targets antes de limpieza. |
| `_locales/*/messages.json` | Cinco traducciones y ayuda coherente. |
| Verificadores relevantes | Pruebas conductuales de cuota, rutas y UI; no snapshots sólo textuales. |

No añadir permisos para backend/checkout/captura de audio ahora. El packer usa allow-list y elimina staging/ZIP existentes: antes de ejecutarlo en otra etapa verificar que sus targets resueltos estén dentro del directorio de salida previsto. La entrega documental no ejecuta empaquetado.

## 17. Plan de verificación

Pruebas nuevas de alto valor sobre la interfaz de acceso:

1. Inicialización exactamente una vez; update/restart conservan used.
2. A aislado no consume; primer A–B válido consume uno.
3. Reintento con requestId estable no duplica uso ni permiso.
4. Cien eventos drag sobre mismo loop consumen uno en total.
5. Clear y nuevo A–B consume otro; bypass/pausa/panel no.
6. Dos pestañas disputando uso final producen un ganador.
7. Storage falla antes de commit: no hay loop autorizado ni UI de éxito.
8. Respuesta perdida tras commit: recuperar concesión sin volver a cobrar.
9. Cambio de track entre snapshot y respuesta: rango viejo no se aplica al nuevo.
10. Último loop continúa; Clear/cambio track/recarga terminan gracia; worker restart la recupera.
11. Free agotado neutraliza efectos aunque hubiera preferencias guardadas.
12. Quitar bypass o recibir snapshot atrasado no reactiva herramientas bloqueadas.
13. Aviso sólo 2→1, sin spam; no texto 20/20 ni contador permanente.
14. Pro no consume cuota; volver a Free conserva saldo previo en fixture.
15. Solicitud directa DOWNLOAD_LOOP en Free se rechaza antes de descargar audio.
16. Single transformado exige Pro; single/bulk original funciona agotado.

Integración navegador con extensión real y MAIN/ISOLATED/background: apertura de promoción con y sin pestaña/player, reload, SPA, frames nuevos, cambios de plan, mouse/teclado y loop ownership. Fixtures deben representar eventos asíncronos de permiso y no limitarse a regex de código.

Audio/export: usar muestras conocidas y validar duración/frecuencia de WAV real para track completo Pro y A–B Pro a rate=1 y rate distinto con Keep Tone on/off; bypass neutral. Confirmar que popup/bulk permanece sin transformación incluso con player alterado. Las pruebas actuales de renderer y routing son base, no evidencia de gates nuevos.

Visual: capturas de popup normal/selección/job, panel trial, un uso restante, último activo, agotado, Pro y tooling; cinco locales y navegación de teclado. Verificar precio tachado, foco, alturas y que no se reformó la UI sin autorización.

Paquete: inspeccionar ZIP/staging de release, presencia de nuevos runtime y notices, ausencia de dev adapter/página/flags/scripts de fixtures; cargar ese paquete y comprobar que no existe comando de activar Pro/reset. Repetir sólo pruebas afectadas después de cambios; ejecutar suite base como gate de integración.

## 18. Etapas elegibles y dependencias

| Etapa | Resultado concreto | Dependencias / cierre |
| --- | --- | --- |
| E1 — Promoción propia | Franja con ícono/precios y apertura player | Puede empezar sola. Copy no promete checkout disponible. |
| E2 — Acceso y fixtures | Política, storage, cliente y tooling dev Free/Pro | Base para gates; decisión pendiente del fin de prueba tempo. |
| E3 — Trial global | Consumo por sesión, concurrencia, aviso 1 y gracia 20 | E2; pruebas de lifecycle y reinicio. |
| E4 — UI bloqueada | Cierre musical, CTA y colapso; presets conservados | E2/E3; mantener composición actual. |
| E5 — Export Pro | WAV/A–B y full transformado autorizados; Downloader gratuito | E2; integración de rutas completas. |
| E6 — Locales e integración | Ayuda/copy, visual QA, suite y paquete sin dev | Acompaña E1–E5; gate antes de release. |
| E7 — Semitonos/Vinyl | Etapa futura a definir | No ejecutar ahora, ni su prototipo/investigación. |
| E8 — Backend/pagos | Trabajo de otro chat | No implementar como parte de E1–E6. |

Una etapa integrada puede necesitar partes de otra para ser demostrable, pero no ampliar silenciosamente el alcance elegido. Recomendación técnica para trabajo posterior: E2 habilita pruebas fiables de E3–E5; E1 puede entregarse visualmente primero. **La elección inicial es del usuario en la próxima sesión.**

## 19. Fuera de alcance y criterios finales

No hacer ahora: checkout, webhooks, D1/Worker, KYC, activación real, wallet BEP20, dirección de correo de cobro, generación manual de keys, licencias Founder, renovación mensual, límites de descarga original, publicidad de terceros, nuevo motor musical, cambio del nombre o rediseño global.

Futuro manual expresado por el usuario: listar su wallet BEP20, que le escriban un mail y generar key personalmente. Registrar sólo esta intención; dirección, correo de cobro y formato de key no fueron proporcionados para implementar aquí.

Criterio de producto terminado para E1–E6: oferta exacta y acceso real al panel; veinte concesiones globales persistentes sin doble consumo; último loop usable; resto de Player Tools cerrado al agotarse; exports protegidos en runtime; Downloader original operativo para todos; cinco idiomas; Pro dev reproducible y ausente del release. Resolver explícitamente el pendiente de prueba de tempo antes de declarar cumplido el objetivo de demo musical finita.

No declarar pruebas de runtime verdes por haber escrito este documento. No commit, push, merge ni publicación están incluidos en esta entrega. Este plan permite que una sesión nueva identifique qué está aprobado, qué sigue siendo diseño técnico y qué etapa debe elegir el usuario.
