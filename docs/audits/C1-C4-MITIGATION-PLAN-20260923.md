# Plan integral de mitigación antes de C4 externo

> **PARCIAL; M02–M17 CERRADOS localmente — revisión 24/09/2026 (`29d7946`).** M01 por cuenta verificada sigue ABIERTO. M18 local tiene cierre histórico; compra, activación automática de PRO y salida del trial Test Mode están confirmadas el 24/09. Restore, perfiles adicionales y refund/revocación no fueron probados; Live/Store/operación siguen abiertos. Login `1/1` eliminado; el addendum inferior que lo conserva es histórico. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Fecha: 2026-09-23. Base observada: `aebd76b` (`fix: persist direct download operations`), árbol limpio al comenzar la auditoría documental. Este documento consolida los hallazgos descubiertos después del handoff C1–C4, los cinco problemas adicionales comunicados por el usuario y los gates transversales que todavía impiden considerar robustos FREE/PRO, el artefacto o la salida comercial.

## Autoridad y objetivo

Este plan pasa a ser la ruta inmediata antes de preparar Lemon Squeezy Test Mode o declarar C1–C4 cerrados. Complementa, pero no elimina, los gates R0–R7 de [RELIABILITY-CLOSURE-PLAN-20260921.md](RELIABILITY-CLOSURE-PLAN-20260921.md), el contrato de [C1-C4-HANDOFF-20260922.md](C1-C4-HANDOFF-20260922.md) y las tareas comerciales del plan 10.

Objetivo de la primera tanda de trabajo:

1. corregir los trece defectos principales enumerados en M01–M13;
2. convertir cada reproducción en una regresión automatizada;
3. cerrar los gates transversales M14–M18;
4. ejecutar nuevamente la suite completa y construir un ZIP inequívocamente ligado al código probado;
5. recién entonces continuar con C4 externo.

No usar `npm run test:player-tools` como sustituto del gate completo. Sus 22 escenarios pasan en esta base, pero no cubren los fallos de identidad, reloj, integración del artefacto ni todos los recorridos del navegador. Tampoco interpretar un smoke verde de un ZIP anterior como evidencia del HEAD actual.

## Resumen ejecutivo y prioridades

| ID | Prioridad | Problema | Bloque |
| --- | --- | --- | --- |
| M01 | P0 | El trial se reinicia cambiando la identidad declarada por el cliente | C2/C3 |
| M02 | P0 | `storage.sync` puede compartir una identidad entre perfiles/dispositivos | C2/C3 |
| M03 | P0 | Una activación idempotente existente puede ignorar un email incorrecto | C3 |
| M04 | P0 | Errores 401/403 del API de Lemon pueden revocar licencias válidas | C3 |
| M05 | P0 | Reactivar después de liberar un seat conserva el instance ID anterior en D1 | C3 |
| M06 | P0 | Un guard PRO vencido bloquea sin intentar revalidación online | C2/C3 |
| M07 | P0 | Atrasar el reloj vuelve a aceptar un recibo ya expirado | C2/C3 |
| M08 | P0 | La gracia del último loop aparece en snapshot pero la autorización la rechaza | C2 |
| M09 | P1 | El smoke acepta un ZIP obsoleto que sólo coincide en versión | C1/C6 |
| M10 | P1 | `npm test` falla porque el harness de routing no implementa operaciones durables | C1 |
| M11 | P2 | Trial expirado se informa como `trial-unavailable` | C2/UX |
| M12 | P2 | Descargas directas fallidas/ambiguas emiten analítica `saved` | C1/C7 |
| M13 | P2 | Recovery convierte prematuramente `resolving` y `building` en guardado ambiguo | C1 |
| M14 | P1 | Endpoints públicos carecen de una defensa de abuso/rate limit demostrada | C3/C4 |
| M15 | P1 | La suite y sus fixtures no forman todavía un gate completo y estable | C1/C2 |
| M16 | P1 | Un archivo privado de feedback continúa trackeado | C1/C6 |
| M17 | P2 | README, landing y locales contradicen el contrato actual | C2/C6 |
| M18 | Gate | C4 real y las etapas C5–C7 siguen sin evidencia externa | C4–C7 |

### Deduplicación aplicada

- El fallo de clasificación `trial-expired` de M11 no se fusiona con M08: M11 es transporte de un motivo y copy de upgrade; M08 es autorización de una concesión activa después del vencimiento general.
- M09 amplía G8/R7, pero se conserva como issue propio porque el smoke actual puede dar un falso positivo verificable.
- M10 y M15 se relacionan: M10 arregla el fixture concreto; M15 exige que las demás fallas y recorridos queden dentro de un único gate reproducible.
- M13 amplía R0, pero diferencia estados anteriores al save de un save realmente incierto. La política anterior de no repetir guardados ambiguos sigue vigente.
- M01 y M02 requieren identidades distintas: identidad verificable del sujeto del trial e identidad local de un perfil activado. Un solo `installationId` no satisface ambas responsabilidades.

## Contrato que no debe cambiar durante los fixes

- Las descargas normales de tracks y colecciones siguen siendo FREE y no dependen de que responda el servicio de licencias.
- PRO lifetime habilita WAV, exportaciones transformadas de track/loop, edición precisa, EQ y Likes Explorer después del trial.
- El trial dura hasta el primero entre siete días y veinte loops nuevos. Likes Explorer conserva siete días completos. La última concesión de loop ya iniciada puede finalizar, pero no iniciar otra.
- Una licencia admite dos perfiles activados. Varias ventanas/pestañas del mismo perfil cuentan como uno. Un tercero necesita liberar un seat.
- El recibo PRO firmado dura treinta días. Al vencer, una operación PRO debe intentar revalidar si hay red y bloquear solamente PRO si no puede renovarlo.
- Reembolso total revoca; parcial requiere tratamiento manual. FREE no se pierde al revocar PRO.
- No enviar cookies ni tokens de SoundCloud al servicio de licencias y no introducir fingerprinting silencioso.

## M01 — Trial reiniciable mediante un `installationId` nuevo

**Contexto y evidencia.** `/trial/start` usa como autoridad primaria un identificador sintácticamente válido provisto por el cliente. En `startTrial()` el `INSERT ... ON CONFLICT DO NOTHING` está ligado sólo a `installation_id`. Una reproducción creó un trial, consumió su cupo y recibió otro trial completo al cambiar el ID. Reinstalar o borrar/manipular storage puede producir el mismo efecto.

**Causa.** Se confundieron identidad local de instalación, útil para vincular un recibo a un perfil, con identidad antiabuso, que debe sobrevivir a reinstalaciones y no puede ser autoafirmada por el cliente.

**Mitigación propuesta.**

1. Separar `profileInstallationId` de `trialSubjectId` en contrato, storage, D1 y claims.
2. Para cumplir literalmente el requisito anti-reinstalación, vincular el trial a una identidad de cuenta verificada por el servidor. Ruta recomendada: login mínimo propio por enlace/código de email, con un identificador opaco; una alternativa con `chrome.identity` exige consentimiento, permisos y revisión de privacidad. No aceptar un SoundCloud user ID declarado sin prueba, IP ni fingerprint como identidad.
3. Guardar en D1 un único trial por `trial_subject_id`, con constraint único, estado y consumos idempotentes. El recibo debe incluir `trialSubjectId`, `profileInstallationId`, fechas, límite, uso, `kid` y versión.
4. El perfil puede regenerar su ID local, pero restaurar el mismo sujeto verificado nunca crea otro trial. Un nuevo perfil del mismo sujeto observa el trial ya usado/expirado.
5. Si se decide no introducir cuenta, cambiar explícitamente la promesa a trial “best effort”. No declarar cerrado el requisito actual con un UUID local.

**Pruebas obligatorias.** Cambio/borrado de storage, reinstalación simulada, dos perfiles del mismo sujeto, IDs arbitrarios, replay de request ID, concurrencia de dos inicios y cuenta distinta. Sólo una cuenta realmente distinta puede recibir un trial independiente.

**Cierre.** No existe un segundo trial para el mismo sujeto verificado y el paquete oficial falla cerrado cuando falta o se corrompe esa identidad.

## M02 — Identidad de seat compartida mediante `chrome.storage.sync`

**Contexto y evidencia.** `scripts/background.js` inyecta `chrome.storage.sync` como `identityStorage`. Chrome sincroniza esa área entre navegadores donde la misma cuenta tiene sync habilitado. La reproducción con tres perfiles que comparten ese backend obtuvo un solo ID, contradiciendo “cada perfil consume un seat”.

**Mitigación propuesta.**

1. Guardar `profileInstallationId` únicamente en `chrome.storage.local`; conservar el estado de commerce local y hacer `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` donde la API disponible lo permita.
2. Migrar una vez: leer el ID anterior, copiarlo a local para no perder activaciones existentes y dejar de usar sync. No generar uno nuevo durante una migración normal.
3. Separar claramente la identidad de seat de M02 y la identidad de trial de M01.
4. Al reinstalar, tratar el nuevo perfil como un seat nuevo o permitir restore/release mediante el flujo de soporte definido; no hacer que sync colapse seats silenciosamente.

**Pruebas obligatorias.** Dos ventanas del mismo perfil comparten ID; dos perfiles con el mismo mock de sync obtienen IDs locales distintos; migración preserva un perfil activo; corrupción falla a FREE sin conceder PRO; el tercer perfil es rechazado.

**Cierre.** El número de identidades coincide con perfiles locales y no con cuentas Chrome sincronizadas.

## M03 — Email omitido en el camino idempotente de activación

**Contexto y evidencia.** `acquireActivationOperation()` puede devolver `kind: active` por key hash + installation ID. `activate()` retorna ese resultado antes de que `validLicenseActivation()` compruebe el email. Una reserva existente respondió PRO aun enviando un email incorrecto.

**Mitigación propuesta.**

1. Normalizar email una sola vez y no emitir un resultado activo sin comprobar que la licencia local pertenece a ese email.
2. Incluir `licenses.customer_email` en la consulta idempotente y devolver una clase `credential_mismatch` cuando no coincida.
3. Como defensa adicional, hacer que restore/revalidación autoritativa confirme proveedor cuando el registro local sea incompleto o migrado; no guardar email plano en logs.
4. No revelar si falló email o key en la respuesta pública; usar un error genérico de credenciales y diagnóstico interno sin PII.

**Pruebas obligatorias.** Email correcto, mayúsculas/espacios normalizados, email incorrecto con reserva activa, key incorrecta, installation ID distinto y restore concurrente. Verificar que los casos inválidos no llaman innecesariamente a activate ni firman recibo.

**Cierre.** Ninguna rama de activate/restore devuelve recibo PRO sin key, email e instalación coherentes.

## M04 — Fallos de credenciales del proveedor tratados como revocación

**Contexto y evidencia.** `reconcileActivation()` sólo considera temporales 429 y 5xx. Un 401/403 deja `licenseActive=false`, cambia D1 a `revoked` y desactiva la instancia. Se reprodujo un 401 del API administrativo que devolvió `license_revoked` al cliente.

**Mitigación propuesta.**

1. Cambiar reconciliación a un resultado ternario: `active`, `definitively_inactive`, `unknown/provider_error`.
2. Sólo mutar a revocado ante evidencia de negocio válida: webhook total firmado y aplicable, o respuesta 2xx cuyo estado/disabled/expiry demuestre inactividad. Definir expresamente el tratamiento de 404 según el contrato real de Lemon.
3. Tratar 401, 403, 408, 409 inesperado, 422 de configuración, 429, 5xx, body inválido, timeout y fallo de paginación como error operativo. Conservar D1 y no emitir un nuevo recibo; devolver código reintentable.
4. Paginar completamente `license-key-instances`; no concluir que falta una instancia mirando sólo la primera página.
5. Añadir alerta/métrica sin secreto para errores de credencial o esquema.

**Pruebas obligatorias.** Matriz por status HTTP, timeout, JSON inválido, respuesta activa/inactiva, instancia en página 2, webhook previo y caída entre lecturas. Ningún error operativo altera filas de licencia/activación.

**Cierre.** Sólo una señal autoritativa de negocio revoca; problemas del Worker/proveedor nunca destruyen estado válido.

## M05 — Instance ID obsoleto tras liberar y reactivar

**Contexto y evidencia.** `recordActivation()` hace conflicto por `(lemon_license_id, installation_id)` pero sólo actualiza `last_validated_at` y `deactivated_at`. Después de liberar el seat, Lemon puede crear `instance-2`; el Worker firma ese ID mientras la fila conserva `instance-1`, y el siguiente status queda inactivo.

**Mitigación propuesta.**

1. En el upsert, reemplazar de manera atómica `lemon_instance_id` por `excluded.lemon_instance_id` y actualizar `activated_at`, `last_validated_at`, `deactivated_at=NULL`.
2. Alinear en el mismo batch `activation_operations`; no dejar una operación apuntando al ID anterior.
3. Validar constraints antes de mutar. Si el nuevo instance ID ya está asociado a otra instalación, detener y reconciliar en lugar de sobrescribir.
4. Registrar el ID anterior como liberado/auditado si el esquema administrativo lo necesita, sin mantenerlo como activación vigente.

**Pruebas obligatorias.** Activar → liberar → reactivar mismo perfil con ID nuevo → status/restore; reactivar otro perfil; conflicto de instance ID; fallo de D1 entre proveedor y persistencia; reintento posterior.

**Cierre.** El recibo, `activations`, `activation_operations` y Lemon terminan con el mismo instance ID vigente.

## M06 — Expiración PRO sin revalidación desde el guard

**Contexto y evidencia.** `validateEntitlement()` sólo valida localmente. `player-tools-access.verifyEntitlement()` baja a FREE cuando vence, pero no llama `/license/status`; la renovación ocurre sólo por alarma o `getState({revalidate:true})`. Si la alarma se perdió y el worker sigue vivo, la operación se bloquea sin intentar red.

**Mitigación propuesta.**

1. Exponer en commerce una operación `ensureEntitlement({ allowNetwork: true })` que valide el recibo y, si expiró, use una única revalidación compartida entre solicitudes concurrentes.
2. Hacer que el guard PRO la invoque antes de autorizar. Después de renovar, releer/actualizar el snapshot; después de revocación, bloquear; después de error de red, bloquear sólo PRO con `license-check-required` y dejar FREE intacto.
3. Validar también `capabilities` y versión de contrato del claim, no solamente `type: pro`. Mapear cada operación sensible a una capacidad requerida y fallar cerrado ante capacidades ausentes/desconocidas; hoy el plan puede emitir el conjunto PRO completo, pero no debe asumirlo para siempre.
4. Mantener la alarma como optimización, no como única vía correcta.
5. Evitar deadlocks entre las colas exclusivas de commerce/access y evitar múltiples requests al vencer simultáneamente.

**Pruebas obligatorias.** Recibo vigente sin red; vencido con renovación; vencido y revocado; vencido offline; alarma perdida; capability ausente/desconocida; diez operaciones simultáneas producen una consulta; reinicio del service worker.

**Cierre.** Toda operación PRO con lease vencido intenta exactamente una reconciliación online compartida antes de decidir.

## M07 — Rollback del reloj reactiva recibos expirados

**Contexto y evidencia.** Un recibo se observó expirado con el reloj avanzado; al atrasarlo volvió a ser aceptado sin red. ES256 protege los claims, no la fuente temporal del cliente.

**Mitigación propuesta.**

1. Persistir `serverTimeAtValidation`, `clientTimeAtValidation` y `maxObservedClientTime`; avanzar este último de forma monotónica en cada guard/arranque.
2. Si el reloj retrocede más que una tolerancia documentada o faltan anclas para una activación existente, no restaurar PRO offline: exigir revalidación online.
3. Validar `issuedAt <= serverTime <= expiresAt`, duración máxima del lease y diferencias absurdas al aceptar un recibo.
4. Firmar/incluir la hora de servidor en la respuesta y versionar el claim. Tratar storage corrupto como necesidad de revalidación, no como licencia revocada.
5. Documentar el límite técnico: un cliente totalmente modificado controla binario, reloj y storage. El objetivo comprobable es que el paquete oficial falle cerrado ante rollback/borrado normal; no prometer DRM absoluto durante treinta días offline.

**Pruebas obligatorias.** Adelanto/retroceso, DST/zona horaria, suspensión prolongada, borrar sólo anclas, migración de recibos anteriores, reloj normal y renovación online.

**Cierre.** Una vez observado un tiempo posterior a la expiración, el paquete oficial nunca vuelve a aceptar el mismo recibo por retroceder el reloj.

## M08 — Gracia del último loop no autorizada

**Contexto y evidencia.** El snapshot puede quedar en `trial_last_session`, pero `authorize()` llama primero a `verifyTrial()`. Como el recibo general expiró, retorna `trial-unavailable` antes de evaluar la concesión local del loop.

**Mitigación propuesta.**

1. Representar la concesión del loop consumido como grant firmado e idempotente, con `grantId/requestId`, sujeto, perfil, track, generación, `issuedAt` y un `graceExpiresAt` acotado.
2. En `authorize()`, distinguir `begin-loop` de operaciones sobre un grant ya activo. Nunca permitir un begin nuevo tras fecha/cupo; sí permitir terminar/editar el grant exacto mientras su firma y gracia sean válidas.
3. Cerrar el grant al cambiar de track, owner/document, pulsar Clear o superar el límite temporal. Un reload no debe inventar una nueva sesión.
4. Alinear snapshot, UI y backend en la misma máquina de estados.

**Pruebas obligatorias.** Loop 20 antes de expirar, tempo/FX después de expirar, loop 21 rechazado, cambio de track, Clear, reload, owner desaparecido, receipt manipulado y gracia vencida.

**Cierre.** La UI y el guard toman la misma decisión y la gracia sólo alcanza a la última concesión auténtica ya iniciada.

## M09 — Smoke de paquete acepta un ZIP obsoleto

**Contexto y evidencia.** `verify-package-browser.js` toma la versión del manifest fuente y sólo la compara con la versión dentro del ZIP. El ZIP existente, creado antes de los commits auditados y con hashes diferentes a HEAD, pasó `npm run test:package`.

**Mitigación propuesta.**

1. Hacer que packaging produzca un manifiesto de procedencia y un sidecar con commit completo, estado dirty, endpoint/modo no secreto, `kid`, hash SHA-256 de cada entrada y hash del ZIP.
2. En modo release, fallar si el worktree contiene cambios en archivos incluidos o si no se declaró el commit esperado.
3. Hacer que `test:package` compare todas las entradas contra un staging fresco construido desde la fuente actual, permitiendo sólo transformaciones explícitas: `TEST_LOGIN=null`, endpoint, permiso de host, JWK pública y metadata de build.
4. No seleccionar implícitamente un ZIP viejo por nombre de versión. El comando debe recibir el artefacto recién generado o verificar que su procedencia coincide con HEAD y el fingerprint actual.
5. Encadenar build → smoke estático → browser smoke → hash final en un único gate de release. No sobrescribir artefactos anteriores sin conservar su procedencia.

**Pruebas obligatorias.** ZIP actual pasa; modificar un JS sin cambiar versión falla; ZIP anterior falla; entry extra/faltante falla; transformación permitida pasa; private JWK/test login/archivo privado fallan.

**Cierre.** El SHA probado identifica exactamente bytes derivados del commit/fingerprint declarado y es el mismo que se subirá a Store.

## M10 — Harness de download routing incompatible con operaciones durables

**Contexto y evidencia.** `verify-download-routing.js` mockea sólo `SCBulkLibrary.getActiveJob`. El manager actual llama `beginOperation()` al iniciar y el test cae antes de verificar routing. Por ello `npm test` falla en HEAD.

**Mitigación propuesta.**

1. Sustituir el stub parcial por un fake contractual de `SCBulkLibrary` que implemente `beginOperation`, `updateOperation`, `getOperation`, consultas por estado y transiciones realmente utilizadas.
2. No devolver siempre éxito: conservar estados por operation ID y afirmar la secuencia `resolving → building → saving → completed/failed/ambiguous_save`.
3. Añadir casos para replay del mismo ID/signature, conflicto de signature, save por carpeta, `chrome.downloads`, fallo antes del save y respuesta perdida después de iniciarlo.
4. Si el fake vuelve a divergir, preferir un test integrado con IndexedDB real usado por `bulk-library.browser-test.js`.

**Pruebas obligatorias.** El verificador focalizado y `npm test` completo. El test debe fallar deliberadamente si se omite una transición durable obligatoria.

**Cierre.** El gate local termina verde y demuestra el nuevo contrato, no sólo evita el `TypeError`.

## M11 — Trial expirado clasificado como indisponible

**Contexto y evidencia.** `player-tools-commerce.validateTrial()` reduce cualquier recibo inválido/expirado a `false`; `player-tools-access.authorize()` lo transforma en `trial-unavailable`. La UI muestra reintento genérico en lugar de upgrade aunque la expiración sea conocida.

**Mitigación propuesta.**

1. Cambiar la validación a un resultado tipado: `valid`, `expired`, `invalid`, `unavailable`.
2. Verificar siempre firma/claims antes de clasificar como expirado; no confiar en fechas de un token sin firma.
3. Mapear `expired → trial-expired`, cupo agotado → `trial-exhausted`, error de red/servicio → `trial-unavailable` y corrupción/firma → `trial-invalid` interno con mensaje seguro.
4. Hacer que popup/player muestren upgrade para expired/exhausted y reintento sólo para indisponibilidad temporal.

**Pruebas obligatorias.** Recibo válido, expirado auténtico, firma alterada, servicio caído, límite consumido y M08 con grant activo.

**Cierre.** Código, snapshot y copy distinguen fin comercial de fallo temporal.

## M12 — Analítica de descarga directa reporta éxitos falsos

**Contexto y evidencia.** `executeDirectOperation()` puede resolver con `{ success:false }` para `failed`, `ambiguous_save` u operación en curso. `background.js` registra siempre `download_job_completed` con `result: saved` en la rama `.then()`.

**Mitigación propuesta.**

1. Emitir evento terminal sólo después de inspeccionar `result.success` y `result.code`.
2. Usar resultados acotados y documentados: `saved`, `failed`, `ambiguous`, `cancelled`; `operation_in_progress` no es terminal y no emite completion.
3. Persistir en la operación un marcador `analyticsTerminalEmittedAt/result` o usar una clave de evento determinista para no contar dos veces un retry/replay.
4. No enviar título, URL, license key ni información personal en propiedades.

**Pruebas obligatorias.** Success, throw, `{success:false}`, ambiguous, in-progress, replay y respuesta perdida. Comparar contador de eventos con estados terminales únicos.

**Cierre.** La métrica de completados guardados coincide con operaciones `completed` reales y no con promesas resueltas.

## M13 — Recovery marca como ambiguas etapas sin save iniciado

**Contexto y evidencia.** `recoverDirectOperations()` consulta `resolving`, `building` y `saving`, y convierte todas a `ambiguous_save`. En resolving/building todavía no necesariamente existió un efecto de guardado. Esto bloquea una recuperación segura y exagera ambigüedad.

**Mitigación propuesta.**

1. Refinar estados/checkpoints: `resolving`, `building`, `built`, `save_requested`, `download_started`, `save_confirmed` y terminales.
2. Tras restart, `resolving/building/built` son reanudables desde descriptor inmutable si no existe checkpoint de save. Reiniciar build es seguro; nunca reutilizar blob URLs del contexto muerto.
3. `download_started` con `downloadId` se reconcilia mediante `chrome.downloads.search`; complete → completed, interrupted → failed recuperable según evidencia, desconocido → ambiguous.
4. Guardado en carpeta después de `save_requested` y antes de ack permanece ambiguo porque no hay transacción distribuida con el filesystem. Exigir decisión explícita del usuario antes de repetir.
5. Conservar operation ID y signature durante toda recuperación; no crear otro save por timeout de UI.

**Pruebas obligatorias.** Reinicio en cada etapa, build abortado, blob perdido, respuesta perdida antes/después del save, downloadId complete/interrupted/ausente, carpeta y doble recovery idempotente.

**Cierre.** Sólo operaciones que pudieron producir bytes en destino quedan ambiguas; las etapas puramente preparatorias se reanudan sin duplicar guardados.

## M14 — Abuso de endpoints públicos y rate limiting

**Contexto.** Trial, checkout, events y partes de licencia son invocables por un cliente público. CORS limita navegadores cooperativos, no autentica callers. Con M01, IDs arbitrarios permiten multiplicar trials; aun resuelto M01, quedan spam, enumeración y costo operativo.

**Mitigación propuesta.**

1. Aplicar límites por ruta y sujeto verificado: ventanas separadas para trial, restore/activate, checkout y events. IP sólo como señal secundaria con privacidad/IPv6/NAT considerados.
2. Añadir challenge o sesión corta firmada para flujos de cuenta; proteger endpoints administrativos con autenticación fuerte independiente.
3. Respuestas uniformes para credenciales inválidas, límites de body ya antes de JSON, timeout y máximo de eventos. No reflejar secretos.
4. Definir retención de claves de rate limit y métricas de bloqueo. Test/live no comparten namespaces.
5. Probar que FREE local sigue funcionando aunque el servicio responda 429 o esté caído.

**Cierre.** Hay pruebas de límites, bypass básico, concurrencia y separación de entorno; CORS no aparece documentado como defensa de autenticación.

## M15 — Gate local incompleto y dos verificadores adicionales fallando

**Contexto.** Además de M10, la continuación individual de verificadores encontró fallos en `verify-loop-background-routing.js` y `verify-loop-click.js`. El primero falló una expectativa booleana y el segundo esperaba un mensaje runtime que no se emitió. Debe determinarse si son fixtures obsoletos o regresiones; hasta entonces son bloqueadores. La suite excluye deliberadamente browser/live/package, por lo que `npm test` verde tampoco cerrará por sí solo el release.

**Mitigación propuesta.**

1. Reproducir ambos tests sin modificar expectativas; comparar cada contrato con el flujo real y la decisión FREE/trial/PRO.
2. Si el producto cambió intencionalmente, actualizar fixture y añadir una aserción del comportamiento nuevo. Si no, corregir producción.
3. Crear un comando `test:release-local` que ejecute suite local, Player Tools/licencias, IndexedDB browser, browser download/popup/loop/effects/EQ y package recién construido. Mantener live y proveedor real como gates separados y explícitos.
4. Registrar skips por entorno como pendientes, no como aprobados. Guardar comando, commit, artefacto y resultado.

**Cierre.** Ninguno de los tres fallos queda silenciado y existe una tabla única de qué cubre cada gate.

## M16 — Archivo privado de feedback trackeado

**Contexto.** `repos/uninstall-feedback-emails-20260921.txt` está indexado por Git aunque contiene datos que el plan ordenaba mantener fuera del repositorio y del paquete.

**Mitigación propuesta.**

1. Preservar una copia local segura/ignorada si sigue siendo necesaria y retirarlo del índice en un cambio específico, sin imprimir su contenido.
2. Añadir regla de ignore y un verificador de rutas/patrones privados al packaging/CI.
3. Confirmar que nunca entró al ZIP. Auditar si el repositorio tuvo remotos o distribución.
4. Reescribir historia sólo con decisión coordinada: puede invalidar clones/commits y no garantiza borrar copias externas. Si hubo exposición, seguir el procedimiento de privacidad correspondiente.

**Cierre.** No está trackeado ni empaquetado, existe prevención de recurrencia y queda documentada la decisión sobre historial/remotos.

## M17 — Deriva de documentación y copy comercial

**Contexto.** README aún afirma que Looper es FREE y vive sólo en memoria, y describe jobs en `storage.session`. Landing/locales muestran `46% OFF` y un precio futuro USD 6.79 mientras notas más recientes ordenaron revisar/eliminar claims no sustentados. Hay referencias antiguas a “Pitcher” y promesas que deben coincidir con la implementación final.

**Mitigación propuesta.**

1. Crear una matriz única de capacidades FREE/trial/PRO y usarla para README, ayuda, landing, Store y cinco locales.
2. Confirmar por decisión comercial si se conserva el precio de referencia. Si no hay evidencia/decisión vigente para el descuento, retirar `46% OFF` y el tachado en todos los idiomas.
3. Actualizar persistencia, recuperación, límites de formato/audio, offline de treinta días, dos seats, trial y soporte real.
4. Buscar automáticamente strings prohibidos/obsoletos durante release.

**Cierre.** Ninguna superficie promete una capacidad, descuento, soporte o garantía que el ZIP exacto no tenga.

## M18 — Gates externos y trabajo posterior a C1–C4

No avanzar a C4 mientras M01–M15 no estén corregidos y el artefacto local no sea trazable. M16/M17 deben cerrarse antes del candidato de Store.

### C4 — Sandbox real

- Crear Worker/D1, migraciones, secretos, claves y producto de Test Mode separados de Live.
- Probar checkout cancelado/exitoso, webhook auténtico, activación/restore, dos seats/tercero rechazado, release/reactivación, treinta días simulados, refund total/parcial, duplicados y eventos fuera de orden.
- Comparar filas D1, instancias Lemon y recibos. Registrar fecha, commit, entorno y evidencia; no guardar secretos.

### C5 — Preparación comercial/live

- Aprobación del producto real, KYC, fiscalidad, payout, términos, privacidad, refund y canal de soporte operativo.
- Producto lifetime USD 3.69 y activation limit alineado con D1.
- Infraestructura Live separada y una compra/reembolso controlados con autorización para el gasto.

### C6 — Artefacto y Chrome Web Store

- Ejecutar matriz real autenticada/no autenticada, Likes Explorer, audio/HLS, memoria ChromeOS y accesibilidad.
- Generar claves finales, eliminar `TEST_LOGIN`, construir e inspeccionar el ZIP exacto, registrar SHA/version/commit y subir esos mismos bytes.
- Completar assets/descripciones/locales/disclosures y verificar URL/email de soporte.

### C7 — Operación y medición

- Eventos deduplicados y separados por entorno; embudo por versión; errores, activaciones, refunds y desinstalaciones.
- Conciliación de fees/payouts, alertas, runbook de incidentes, soporte y seguimiento posterior al lanzamiento.

Las mejoras grandes de Looper, biblioteca de presets, optimización profunda de Likes Explorer, SEO y videos siguen siendo backlog posterior y no deben mezclarse con esta mitigación.

## Secuencia ejecutable para la próxima sesión

### Tanda A — P0 de licencias y contrato

1. M03: cerrar bypass de email con test rojo primero.
2. M04: resultado ternario de reconciliación y paginación; ningún error operativo muta D1.
3. M05: reactivación y consistencia de instance ID.
4. M06: revalidación desde guard con single-flight.
5. M08/M11: máquina de estados y motivos del trial.
6. M02: identidad local de perfil y migración desde sync.
7. M07: anclas temporales y revalidación por rollback.
8. M01: resolver el diseño de identidad verificada del trial; implementar el camino elegido o dejar el requisito explícitamente bloqueado, nunca simular cierre con UUID.

### Tanda B — Confiabilidad y gates locales

1. M10 y los dos fallos de M15 hasta dejar `npm test` verde.
2. M13: recovery por etapa con test integrado de IndexedDB/restart.
3. M12: analítica terminal exacta e idempotente.
4. M09: procedencia/fingerprint y un único comando de release local.
5. M14: límites y contratos de abuso.

### Tanda C — Higiene y candidato

1. M16 sin exponer datos ni reescribir historia automáticamente.
2. M17 en todas las superficies/locales.
3. Ejecutar R0–R7/G1–G8 todavía pendientes del plan de confiabilidad.
4. Construir un nuevo ZIP y verificarlo; no reutilizar el ZIP preexistente.
5. Sólo con evidencia verde, comenzar C4 Test Mode.

## Matriz mínima de evidencia para cerrar el plan

| Gate | Evidencia requerida |
| --- | --- |
| Licencia SQL | Migraciones reales + concurrencia + M03/M04/M05 + refund/replay |
| Identidad/trial | M01/M02/M07/M08/M11 con reloj y storage controlados |
| Guard PRO | Lease vigente/vencido, online/offline, revocado, alarma perdida y single-flight |
| Descarga durable | Reinicio en cada etapa, downloadId/carpeta, respuesta perdida y cero saves duplicados |
| Analítica | Estado terminal único = evento terminal único y resultado correcto |
| Suite | `npm test`, `test:player-tools` y browser afectados verdes, sin skips ocultos |
| Artefacto | Build nuevo, fingerprint/commit, comparación de entries, SHA, browser smoke del mismo ZIP |
| Privacidad/copy | Sin datos privados/test login/secreto; matriz FREE/PRO coherente en cinco locales |
| Externo | C4 documentado aparte con payloads auténticos y Test/Live inequívocos |

Para cada issue registrar: test rojo previo, cambio, migración si corresponde, comandos ejecutados, resultado, commit, limitación y rollback. No cerrar por inspección estática, por un mock parcial o porque la UI parezca correcta.

## Definición de terminado

Este plan termina únicamente cuando:

- M01–M17 tienen implementación y regresión o, para la identidad anti-reinstalación, una decisión explícita que cambie honestamente el contrato;
- la suite completa y el gate local de release están verdes;
- el ZIP nuevo falla si no corresponde al código actual y pasa contra los bytes exactos candidatos;
- FREE continúa funcionando durante toda caída/revocación del servicio;
- ninguna rama concede PRO/trial sin autoridad verificable;
- C4 puede comenzar sin arrastrar un gate local conocido.

Hasta entonces, el veredicto sigue siendo: base técnica avanzada, pero no robusta todavía para cobrar ni publicar.

## Addendum de cierre local — base `33ce31f7d4243bdd3d1119d5c59e14ad360c95c6`

Se cerró todo lo implementable sin cuentas, secretos o transacciones externas:

- M02 quedó en `chrome.storage.local`, con migración desde el identificador legado de `sync` y acceso restringido a contextos confiables.
- M03–M08 y M11 tienen implementación y regresiones en el cliente y en las migraciones/D1 reales: email idempotente, errores del proveedor no revocatorios, reactivación con instancia nueva, guard PRO con single-flight, anclas de reloj, gracia firmada del loop final y clasificación de expiración.
- M09–M13 quedaron cubiertos por procedencia/fingerprint del ZIP, harness durable, recovery por etapa, analítica terminal idempotente y pruebas de los recorridos afectados.
- M14 tiene límites por ruta/IP hasheada, namespaces separados Test/Live y regresión de respuesta uniforme; CORS sigue documentado sólo como restricción de origen, no autenticación.
- M15 quedó integrado en `npm test`, `npm run test:player-tools` y el gate `test:release-local`; el login local de desarrollo tiene regresión de concurrencia/reinicio y el empaquetador lo elimina.
- M16 quedó fuera del índice y del paquete; M17 ya no muestra descuento/precio futuro no sustentado y el copy declara honestamente que el trial es por perfil local, sin cuenta ni fingerprinting.

M01 no se “simula” como cerrado: el contrato vigente es explícitamente un trial por perfil/installation ID, protegido contra replay normal mientras ese ID exista, pero no resistente a reinstalación. Hacerlo resistente requeriría una identidad de cuenta verificable y un cambio de producto/privacidad. M18 sigue abierto: faltan configuración real, migración remota, deploy, claves/secretos, Test Mode y evidencia Lemon/Cloudflare. También quedan fuera los gates físicos/dispositivo como ChromeOS y cualquier compra o reembolso real.

Evidencia local nueva: `npm test` (48 verificaciones), `npm run test:player-tools` (incluye login integrado y suite D1/Worker), y `git diff --check`. El gate de navegador/ZIP debe ejecutarse con claves públicas de entorno y Chromium disponible; no se declara C4 externo por mocks.
