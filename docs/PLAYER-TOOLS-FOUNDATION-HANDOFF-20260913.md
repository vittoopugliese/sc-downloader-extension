# Player Tools: contrato del núcleo y continuación

Fecha: 2026-09-13. Base implementada en el árbol de trabajo; producto todavía no listo para release.
Decisiones de producto: [plan principal](PLAYER-TOOLS-PRODUCT-AND-TECHNICAL-PLAN-20260912.md).

## Qué queda resuelto

`scripts/player-tools-policy.js` es la fuente de capacidades. `scripts/player-tools-access.js` es el único escritor runtime y serializa también lecturas: un snapshot solicitado después de una autorización espera su commit. `create({ storage, randomUUID })` permite probar el mismo servicio de producción con almacenamiento controlado, sin exponer fixtures ni activación mediante mensajes. No crear un contador en MAIN/ISOLATED ni reintroducir `setEntitlement` como comando de página.

Una clave ausente inicializa Free una sola vez. Un registro v1 anterior válido sin revision migra en memoria a revision=0, sin cambiar cuota; la próxima mutación lo persiste. Datos corruptos/versiones desconocidas fallan con `access-state-invalid`, nunca se resetean. Los errores de I/O usan `storage-unavailable` y no autorizan. La cola continúa funcionando después de un rechazo.

El registro mantiene como máximo veinte recibos Free de toda la vida del trial en `trial.grants`. Un recibo con `active=false` no habilita herramientas, pero conserva su request ID para rechazar reintentos después de Clear. No borrar esos recibos al limpiar sesiones: permitiría que una respuesta perdida cobrara nuevamente o resucitara un loop. No se guardan rangos ni preferencias de audio allí.

Al consumir el uso 20 se desactivan las concesiones previas y se concede gracia sólo al nuevo propietario. Esto evita que otras pestañas con loops anteriores conserven acceso musical indefinidamente. Pausar/bypass/cerrar el panel no son llamadas a `endSession`. El cierre de pestaña ejecuta `endTab`; un documento recargado tiene otra identidad y no hereda gracia. Reiniciar sólo el worker conserva la concesión del mismo documento. Los recibos de documentos abandonados están acotados a veinte y no habilitan documentos nuevos.

## Contrato de mensajes

ISOLATED conserva la correlación de transporte `id`. El ID de negocio `requestId` debe permanecer estable mientras se reintenta **la misma creación lógica**, aunque cambie `id` por timeout. El cliente usa `id` como fallback por compatibilidad; el próximo controlador debe enviar ambos explícitamente. No generar otro request ID ante una respuesta perdida.

Mensaje runtime de creación (los tiempos son milisegundos):

```js
{
  type: "AUTHORIZE_PLAYER_TOOLS",
  operation: "begin-loop",
  requestId: "UUID-estable-para-esta-creacion",
  sessionId: null,
  expectedGeneration: 7,
  payload: {
    trackIdentity: "identidad-canonica-del-track",
    generation: 7,
    startMs: 1000,
    endMs: 4000,
    durationMs: 120000
  }
}
```

Para el evento DOM `scdl:player-tools-request`, enviar `version: 1`, `id`, `type: "authorize"` y los mismos campos de operación. Para terminar: `type: "end"`, `operation: "end-session"`, `sessionId` concedido. No enviar tabId/frameId/documentId como autoridad: background deriva owner de `sender`. Si faltan los datos de documento, las operaciones de loop devuelven `owner-gone`, sin fallback compartido entre recargas.

Una creación requiere `0 <= startMs`, `endMs - startMs >= 250`, `endMs <= durationMs`, números finitos, identidad no vacía y generación entera no negativa consistente. A aislado no debe solicitar autorización. `edit-loop` requiere el sessionId propio y rango/identidad/generación válidos; no consume ni escribe storage. Un `begin-loop` nuevo con otra sesión activa devuelve `session-active`: terminar explícitamente antes de crear otra. Repetir `begin-loop` con el sessionId activo permite continuidad sin cobrar; usar `edit-loop` para expresar mejor esa intención.

Respuesta de autorización: `{ allowed, code, snapshot, grant, notice }`, envuelta por background en `{ success: true, ... }`. **`success: true` sólo significa que se procesó el mensaje; comprobar además `allowed === true`.** Errores de storage/validación durable llegan como `success: false`. `snapshot.revision` ordena cambios; respuestas anteriores nunca deben reactivar capacidades. El cliente aislado filtra tanto publicación por evento como snapshots de respuestas correlacionadas.

`grant` contiene `sessionId`, `trackIdentity`, `generation`; no contiene owner privado. Para Pro se autoriza sin consumo y puede devolverse `grant: null`: no exigir concesión Free para reproducir como Pro. Tampoco interpretar `grant: null` como permiso por sí solo.

Operaciones reconocidas: `begin-loop`, `edit-loop`, `set-effect`, `set-rate`, `set-preserve-pitch`, `save-preset`, `edit-loop-precise`, `export-loop`, `export-track-effects`. Las tres últimas exigen Pro. Operaciones desconocidas se rechazan incluso para Pro. `set-effect` ya existía en el árbol: mantener su gate no amplía el alcance a implementar motores nuevos.

Códigos: `invalid-request`, `invalid-range`, `stale-generation`, `session-active`, `owner-gone`, `trial-exhausted`, `pro-required`, `unknown-operation`, `storage-unavailable`, `access-state-invalid`. Traducir por código; no parsear texto del error.

`notice: "last-loop-remaining"` se emite sólo al commit 18→19, con flag durable. Snapshots, polling y reintentos no vuelven a emitirlo. Semántica actual: como máximo una entrega; una respuesta perdida puede perder el aviso. Si se requiere entrega garantizada, diseñar ack durable antes de cambiar esto; no mostrar aviso a cada snapshot con remaining=1.

## Punto de commit y límite del contrato

No hay transacción atómica entre storage y audio. El uso se compromete cuando `storage.set` se completa, antes de devolver permiso. Ante respuesta perdida se reintenta el mismo request ID. Ante cambio de track/Clear mientras se autoriza, la UI debe descartar la respuesta y cerrar la concesión devuelta; no devolver cuota automáticamente.

El background compara generación/identidad con concesiones conocidas, pero no conoce por sí solo el track vivo de MAIN. No afirmar que ya resuelve la carrera entre autorización y cambio de track. El siguiente controlador debe capturar una generación local y volver a comprobarla **después** de esperar autorización y **antes** de aplicar el rango. Esto también aplica a Pro.

## Continuación en orden

1. **Controlador asíncrono de sesión, E3.** Inspeccionar `requestLoop` y todos los `set-loop` en `tempo-control-main.js`, `looper.js`, `looper-main-bridge.js`. Unificar preparación→autorización→revalidación→aplicación. No convertir una función síncrona a Promise dejando consumidores que leen `?.state`. Deduplicar inicios simultáneos de la misma UI. Mantener drag local durante una concesión válida, sin autorización/persistencia por píxel. Clear/cambio de track invalidan inmediatamente la generación local y terminan la sesión; una respuesta tardía no puede reactivarla. Tests obligatorios: timeout tras commit, Clear antes de respuesta, cambio de track antes de respuesta, autoplay rechazado y nuevo drag mientras hay autorización pendiente.
2. **Todos los puntos de entrada y frames, E3/E4.** El manifest hoy carga el cliente de acceso sólo en el documento principal, mientras looper funciona en todos los frames. Definir un único dueño por loop y conectar frames al mismo protocolo; no dar una cuota ni un permiso implícito por frame. Prueba de extensión real antes de afirmar enforcement completo. Los atributos/eventos MAIN no son una prueba criptográfica de pago.
3. **Aplicación efectiva y UI, E4.** Conectar capacidades a render, comandos, teclado, presets, maximización y bypass. Ahora el panel todavía habilita controles y aplica loops por rutas antiguas. Cerrar reproducción musical durante loading/error/agotado sin gracia, con rate efectivo 1x, conservando preferencias guardadas. Al cambiar track, eliminar la gracia anterior antes de aplicar preferencias al nuevo. Conservar composición y cuatro presets. Gestionar foco al colapsar y estado aria-live. MAIN también debe rechazar revisiones viejas en cualquier consumidor propio.
4. **Build y tooling local, resto de E2.** Generar build separado con adapter dev y selector de escenarios 0/18/19/20/Pro. Usar la factoría de acceso con storage inyectado para fallos/demoras en tests. Una concesión final de fixture necesita documento/player real; no inventar un owner de producción. Mantener fixtures/reset/activación fuera de la allow-list del paquete. Pro→Free conserva cuota; si una herramienta restaura escenarios, incrementar revisión para no ser descartada por los clientes. No implementar pagos ni una key maestra.
5. **E1/E5/E6.** Oferta única y cinco locales; handshake de apertura con timeout; validación de transformaciones malformadas en background; ayudas; QA visual/accesible y export WAV real. Las pruebas nuevas cubren casos normales de routing Free/Pro, no todos los payloads adversariales ni el pipeline completo de audio con entitlement. No declarar E5 completa por estos tests.

Antes de cerrar trial/producto, resolver la sección 6 del plan: quien no crea loops conserva hoy saldo y herramientas. No inventar días/minutos ni consumir cuota al mover tempo. La implementación actual sólo cierra música al agotarse los veinte loops.

## Verificación y protección del trabajo existente

- `npm run test:player-tools`: política, persistencia/lifecycle/concurrencia y cliente con transporte simulado.
- `node scripts/verify-loop-background-routing.js`: background real con servicio de acceso real y descarga simulada; Pro permite, Free rechaza efectos/loop antes de trabajo costoso, originales y bulk siguen disponibles agotado.
- `npm test`: 37 verificadores locales pasaron en esta sesión. No equivale a E2E/QA visual de Chrome; todavía no hay enforcement completo del trial en la UI.

Se preservaron los cambios previamente staged en `scripts/tempo-control-main.js`, `scripts/verify-effects-browser.js` y `scripts/verify-tempo-browser.js`. Inspeccionar diff antes de continuar; no sobrescribirlos. No se modificaron pagos/backend, motor de audio ni UI en esta base. No se ejecutó commit, push ni publicación.

No marcar E1–E6 terminadas hasta cumplir los criterios del plan principal. El siguiente cambio valioso es conectar el controlador asíncrono y probar sus carreras; no cambiar pruebas para volver a permitir música gratis con used=20.
