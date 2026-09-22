# 10 — Cierre ejecutable de release y FREE/PRO

Fecha: 21/09/2026. Entrada: [00](00-LEER-PRIMERO.md). Operación del proveedor: [11](11-LEMON-SQUEEZY-TUTORIAL-20260921.md).

## Objetivo y alcance

Terminar la versión comercial existente: descargas gratuitas confiables, Likes Explorer incluido, prueba coherente, PRO de pago único sin vencimiento comercial, activación/restauración, funcionamiento offline definido, revocación y artefacto publicado verificable. «Terminar» exige evidencia de funcionamiento del cobro y de publicación; escribir estos planes no cierra ninguna implementación.

El usuario pidió conservar y hacer ejecutable toda la revisión previa. No se considera obligación de esta release implementar todos los proyectos históricos. EQ, presets completos, optimización profunda de Explorer, biblioteca avanzada de loops, SEO multipágina, experimentos de precio, crypto y analytics sofisticado quedan después del primer cierre comercial. Un fallo concreto de una función incluida sí debe corregirse antes de publicar.

## Arranque de una sesión en frío

1. Leer instrucciones aplicables, `git status --short` y HEAD; preservar cambios ajenos. La base de esta revisión es `6d5163a`, manifest/package `2026.10.5`; volver a inspeccionar si cambió.
2. Leer este plan, el 11, `services/player-tools-license/README.md`, el plan de cierre de confiabilidad del 21/09 y sus referencias necesarias. Los documentos viejos orientan; no sustituyen código ni pruebas.
3. Localizar evidencia del último bloque completado en el registro al final. Si falta, revisar implementación y ejecutar la prueba mínima que resuelva la incertidumbre antes de rehacerlo.
4. Ejecutar el primer bloque pendiente. No volver a pedir elegir etapa: el orden está dado. Alta comercial y recopilación de datos del proveedor pueden adelantarse mientras se trabaja en confiabilidad.
5. Si falta una credencial, dato de cuenta, decisión comercial o permiso externo, pedir sólo eso y continuar el trabajo independiente disponible. No guardar secretos en planes, logs, fixtures o chat.
6. Consultar Context7 para API/CLI/configuración actual siguiendo las instrucciones del repo; las fuentes de este plan fueron consultadas el 21/09/2026.

## Evidencia inicial y límites

- `npm run test:player-tools` pasó en la revisión: verificadores policy, access, client y commerce; dos tests del servicio (`validates commerce requests`, `accepts only the documented anonymous funnel shape`).
- Los tests del servicio existentes validan entradas. No cubren un flujo completo del Worker, D1 real ni transacciones de Lemon.
- Reproducción local sin red: importar el Worker, simular `fetch` con una activación válida, simular búsqueda D1 sin activación existente y llamar a `/api/player-tools/license/restore`. Resultado: HTTP 500, `internal_error`; log: `Lemon returned an incomplete license activation.`
- Estructura relevante de la respuesta oficial usada: `{ activated: true, license_key: { id, key, status, expires_at: null }, instance: { id, name }, meta: { store_id, product_id, variant_id, order_id, customer_id, customer_email } }`.
- `activate()` pasa sólo `result.license_key` a `recordActivation()`, que intenta leer `license.instance.id`, `license.order_id` y `license.customer_id`. El fallo de instancia ocurre antes de escribir D1.
- Hallazgos por inspección que aún requieren pruebas de comportamiento: evento marcado recibido antes de efectos, webhook sin filtro de producto/modo, eventos desordenados que pueden reactivar un reembolso, y concurrencia/repetición de activaciones.
- No se inspeccionaron cuentas privadas ni se verificó despliegue, compra sandbox, compra real, payouts o publicación. No se ejecutaron E2E de navegador en esta revisión.

## C1 — Cerrar confiabilidad restante

Fuente ejecutable: [RELIABILITY-CLOSURE-PLAN-20260921](../audits/RELIABILITY-CLOSURE-PLAN-20260921.md). Contexto de arreglos ya realizados: [FEEDBACK-FIX-PLAN-20260921](../audits/FEEDBACK-FIX-PLAN-20260921.md).

- [ ] Diagnosticar y resolver offscreen en Chromium: preservar etapa/código/causa, identificar cada operación e intento, reconciliar respuestas perdidas y no duplicar build/save.
- [ ] Unificar popup, inline y selección manual en paginación durable, con orden y límite exacto, incluido All.
- [ ] Recuperar enumeración sin depender de la pestaña original; conservar cursor, formato e identidad de colección y ofrecer recuperación visible.
- [ ] Congelar formato del job y contabilizar todas las pistas omitidas con causa; respetar `Retry-After` y evitar duplicaciones por timeout de UI.
- [ ] Completar fixtures HLS, audio y memoria definidos en el plan de cierre; registrar medición de ChromeOS o la limitación concreta aún no verificada.
- [ ] Completar diagnóstico y documentación de comportamiento real; mantener gratuitos los caminos de descarga normal.

No reabrir sin evidencia los fixes ya conservados por el plan: WAV de diez minutos (`98ee64b`), serialización de build, guardado ambiguo, límites HTTP, recuperación desde IndexedDB, contexto inmutable, retención, retries durables y accesibilidad. Registrar reproducción, regresión y prueba de navegador por bloque. La auditoría basada en `404fbd9` es anterior a varios de esos fixes.

Salida: checklist del plan de confiabilidad satisfecho con evidencia, sin fallos bloqueantes conocidos en funciones incluidas. No combinar estos arreglos con rediseños de UI o cambios de precio.

## C2 — Cerrar un único contrato FREE / prueba / PRO

Archivos principales: `scripts/player-tools-policy.js`, `player-tools-access.js`, `player-tools-commerce.js`, `player-tools-client.js`, `background.js`, popup, player, Explorer y locales.

| Estado | Contrato objetivo |
| --- | --- |
| FREE | Descargas normales de tracks y colecciones independientes de licencias, trial y disponibilidad del Worker comercial. |
| Prueba Player Tools | Siete días y hasta veinte loops globales; termina al primer límite con la gracia final existente. Exports exclusivos PRO bloqueados. |
| Prueba Likes Explorer | Siete días desde el inicio único de prueba; consumir veinte loops no acorta ese acceso. |
| PRO lifetime | Capacidades PRO implementadas y verificadas, sin vencimiento comercial; restauración y política de instalaciones explícitas. |

- [ ] Conservar onboarding de instalación a `https://soundcloud.com/you/likes` y comienzo único de prueba; actualizaciones no abren esa pestaña ni reinician/extienden el trial. Probar instalación con/sin sesión de SoundCloud y migración de perfiles existentes.
- [ ] Separar capacidad `likesExplorer` del contador de loops. Hoy usa `pro || trialAvailable`, donde `trialAvailable` exige `used < 20`. Este cambio cumple los siete días prometidos por el onboarding del 00 y la recomendación aceptada como trabajo a ejecutar.
- [ ] Mantener gracia del loop 20, permisos exclusivos de export, enforcement en handlers además de UI, cuota durable y preferencias al vencer/revocar.
- [ ] Verificar estado no iniciado, vigente, agotado por loops, vencido por tiempo, PRO, compra pendiente, error recuperable y revocado. Probar dos pestañas, reinicio de worker, actualización y storage inválido.
- [ ] Unificar copy y precio: USD 3,69, compra única; USD 6,79 sólo como referencia futura, nunca precio histórico ficticio. No experimentar con precio durante este cierre.
- [ ] Implementar y probar el límite ya confirmado de dos perfiles activados por licencia, con liberación por soporte. La decisión de producto está cerrada; faltan reserva atómica, conciliación con Lemon y administración.
- [ ] Implementar el comprobante firmado y la revalidación ya confirmada cada treinta días. La decisión de producto está cerrada; faltan firma/verificación, alarma one-shot, guard PRO y pruebas de vencimiento/offline/revocación.
- [ ] Verificar que activar/restaurar falla de forma recuperable ante respuestas incompletas del servicio; nunca conceder PRO por una respuesta vacía o por la URL de éxito.

Salida: matriz de capacidades implementada, copy consistente y pruebas de transiciones; las decisiones de dispositivos y offline quedan explícitas, no implícitas en constantes.

## C3 — Corregir y probar el Worker de licencias

Archivos: `services/player-tools-license/src/index.mjs`, `src/validation.mjs`, migraciones, tests y cliente commerce. Preservar compatibilidad de datos o documentar migración/rollback.

### C3.1 Activación y restauración

- [ ] Añadir regresión con respuesta fiel al proveedor que reproduzca el HTTP 500 descrito arriba.
- [ ] Mapear por separado `license_key`, `instance` y `meta`; persistir instancia, pedido, cliente y hash de clave correctos. Verificar producto, variante, tienda, email y estado válido antes de conceder acceso.
- [ ] Hacer idempotentes tanto activación como restauración para la misma instalación. Probar dos solicitudes concurrentes, timeout después de activar en Lemon y reintento posterior. Resolver instancias huérfanas y errores por límite sin consumir cupos repetidamente.
- [ ] Resolver compra recibida antes o después de activar. El webhook hoy usa un identificador provisional `order:<id>` como `lemon_license_id`: revisar claves foráneas y actualizaciones para no romper activaciones al asociar la licencia definitiva.
- [ ] Impedir que la restauración de una fila local obsoleta rehabilite una licencia revocada. Definir conciliación con el proveedor, también para cambios manuales y eventos perdidos.
- [ ] Cubrir reinstalación/equipo nuevo, licencia ajena, correo incorrecto y cupo agotado; dar recuperación concreta sin forzar otra compra.

### C3.2 Webhooks y conciliación

- [ ] Conservar HMAC SHA-256 sobre cuerpo original, comparación de firma y límite de tamaño. Añadir tests positivos/negativos del handler completo.
- [ ] Validar tienda, producto/variante, tipo de recurso, estado relevante y modo test/live antes de mutar licencias o registrar ventas. No aceptar como venta un evento de otro producto de la misma tienda.
- [ ] Corregir deduplicación: recepción durable y efectos deben ser transaccionales o disponer de estado recuperable. Un fallo después de guardar el evento debe poder completarse al reintentar; confirmar 200 sólo tras procesamiento o aceptación durable recuperable.
- [ ] Distinguir repetición de entrega de repetición semántica del mismo pedido. Evitar duplicar licencia/venta aunque cambie la serialización del payload.
- [ ] Probar eventos duplicados, tardíos y desordenados: compra→reembolso, reembolso→compra atrasada, webhook antes/después de activación. Un evento antiguo no puede reactivar una revocación.
- [ ] Definir reembolso total/parcial y deshabilitación manual; implementar sincronización de `license_key_updated` cuando corresponda y/o conciliación por API. Registrar qué eventos se soportan antes de seleccionarlos en el dashboard.
- [ ] Añadir reintento/reconciliación para eventos que agoten los reintentos del proveedor. El endpoint `/license/status` hoy sólo consulta D1: eso no demuestra estado actual en Lemon si se perdió un webhook.
- [ ] Mantener `purchase_confirmed` una vez por pedido válido; no registrar ventas de prueba en métricas de producción.

### C3.3 Offline, servicio y límites de confianza

- [ ] Implementar el comprobante de entitlement firmado pedido por el 00, con verificación de firma en el cliente y campos de instalación, licencia, capacidades, emisión y vigencia técnica. Clave privada sólo en servidor; la extensión puede incluir la pública. Documentar rotación/migración.
- [ ] Persistir únicamente los datos necesarios para restaurar el estado local; no persistir clave de licencia ni email en la extensión. Un comprobante firmado no vuelve invulnerable el perfil local: evitar promesas de antifraude absoluto.
- [ ] Aplicar política offline de C2; probar firma falsa, comprobante de otra instalación, vencimiento técnico, caída del servidor, revocación al reconectar y conservación de preferencias/trial.
- [ ] Revisar timeout y tamaño de respuestas del proveedor en el Worker, errores tipados y logs sin secretos. Mantener CORS de producción limitado a orígenes necesarios; quitar localhost de la configuración live.
- [ ] Separar secretos, D1, productos y endpoints/configuración de test/live. La comprobación `health: ready` sólo constata configuración, no reemplaza una compra.

Salida: pruebas del Worker con respuestas realistas y almacenamiento representativo, incluidas transacciones/constraints D1. Los mocks del cliente y los dos tests de validación actuales son insuficientes por sí solos. Actualizar README del servicio para describir lo probado y sus límites.

## C4 — Cloudflare y Test Mode de extremo a extremo

Seguir pasos operativos del [11](11-LEMON-SQUEEZY-TUTORIAL-20260921.md). Preparar configuración sin secretos, migraciones y dry run antes de deploy. Respetar permisos efectivos de la sesión; no asumir acceso a cuentas privadas.

- [ ] Worker de prueba desplegado, D1 migrada, health configurado, API key y secreto de webhook instalados; CORS incluye la extensión de prueba.
- [ ] Comprar desde el botón de la extensión: checkout con instalación correlacionada, precio y variante correctos; cancelar/rechazar no concede PRO.
- [ ] Compra de prueba exitosa y un único registro de venta; correlación pedido/licencia/instancia en Lemon, D1 y extensión.
- [ ] Email + clave activa; restaurar/repetir no crea compra ni instancia adicional. Reiniciar worker y popup conserva PRO.
- [ ] Probar webhook atrasado/duplicado, respuesta perdida y recuperación; comprobar que una compra confirmada pendiente de activación tiene instrucciones y soporte.
- [ ] Reembolso y cambio manual de licencia propagados según política; el entitlement se revoca sin borrar preferencias o trial.
- [ ] Probar red caída y casos negativos de firma, origin, producto/variante, modo, email y clave. FREE sigue funcionando.

Evidencia: fecha, commit, entorno, IDs de correlación mínimos no secretos, resultado visible, consultas D1 sanitizadas y resultados del proveedor. No pegar payloads completos con datos de compradores. Salida: checklist anterior completo; mock local no sustituye este gate.

## C5 — Aprobación comercial y Live Mode

- [ ] Presentar producto real a Lemon, obtener aprobación y completar identidad/formulario fiscal aplicable. Publicar términos, privacidad, reembolsos y soporte coherentes con la extensión.
- [ ] Configurar y comprobar disponibilidad del método de retiro elegido. Argentina está admitida en la documentación consultada; Wise específico no está confirmado.
- [ ] Copiar/crear producto live, verificar precio, moneda, licencia sin vencimiento, cupo y nuevos IDs. Configurar API key, secreto, webhook y D1 de producción independientes.
- [ ] Repetir compra/activación/restauración/reembolso en producción con una operación controlada permitida por el proveedor y autorizada para el gasto. Preparar todo antes de solicitar el dato o permiso externo que falte; no usar tarjetas reales en Test Mode.
- [ ] Documentar recuperación ante incidencia comercial: identificar pedido, reconciliar, reenviar recibo/restaurar o atender reembolso. Si se pausa checkout por una incidencia, conservar el acceso adquirido y las descargas FREE.

Salida: tienda habilitada y flujo live demostrado; no declarar un retiro bancario recibido si sólo está configurado. Registrar por separado primer payout cuando se alcance el umbral.

## C6 — Artefacto y publicación

- [ ] Ejecutar verificaciones apropiadas y resolver fallos: `npm test`, `npm run test:player-tools`, E2E de download, popup, tempo, loops y Likes según contratos afectados. Añadir los tests integrados del Worker de C3 al circuito habitual.
- [ ] Validar Explorer existente con login/logout, propias/públicas, vacías/grandes, selección, descarga, cambio de cuenta, fin de prueba y reinicio. No confundir mocks con prueba contra datos reales.
- [ ] Revisar `scripts/package-extension.js` y equivalencia del empaquetador alternativo si se usa. El código de desarrollo incluye `TEST_LOGIN`: el artefacto debe neutralizarlo y bloquear credenciales/estado `test-pro` heredado.
- [ ] Generar candidato con `npm run package:extension`; revisar secretos, fixtures, docs, tests y datos privados excluidos. Inspeccionar el ZIP extraído.
- [ ] Registrar versión única y coherente, commit, fecha y SHA-256. Ejecutar smoke sobre ese mismo ZIP: FREE, HLS, carpeta, sesión SoundCloud, prueba, PRO, restauración, reembolso y recuperación.
- [ ] Reutilizar [03](03-STORE-Y-LOCALIZACION.md), [07](07-GUIONES-Y-CAPTURAS.md) y [09](09-DESCRIPCIONES-STORE-5-IDIOMAS.md). Publicar sólo funciones verificadas; no prometer EQ ni export de FX que el motor no incluya.
- [ ] Revisar coherencia básica de landing, políticas, permisos, precio y oferta con Store. SEO multipágina y completar todos los videos no bloquean el release.
- [ ] Preparar entrega revisable y subir/publicar con autorización aplicable; registrar envío, revisión, aprobación y disponibilidad como estados distintos. Una espera de Chrome Web Store no equivale a publicación completada.

Salida: ZIP publicado idéntico al probado, versión identificable y evidencia de acceso comercial. Si una cuenta o revisión externa bloquea, terminar lo independiente y dejar el bloqueo exacto registrado.

## C7 — Medición y cierre del proyecto comercial inicial

- [ ] Comprobar embudo mínimo existente: apertura/valor, paywall, checkout, compra confirmada por servidor y activación; deduplicación e identificación de entorno correctas.
- [ ] Registrar baseline por versión y período: compras, activaciones exitosas, errores, devoluciones y señales de desinstalación. No usar respuestas de feedback como tasa de fallos de toda la base.
- [ ] Documentar comisiones y neto estimado; observar primer payout y registrar conciliación cuando el saldo elegible lo permita. No supeditar arreglos de producto a esperar ventas suficientes.
- [ ] No cambiar simultáneamente precio, cuota y oferta. Los experimentos 1E vienen después de datos de uso.
- [ ] Actualizar 00, 01, README y TESTING con estado demostrado y limitaciones. Quitar afirmaciones de cierre que contradigan evidencia.

Después: seleccionar por evidencia un siguiente proyecto entre EQ/export, presets, Looper, Explorer y SEO. La etapa 02 permanece cerrada; no rehacerla por aparecer en una tabla histórica.

## Seguimiento obligatorio entre sesiones

Los casilleros empiezan pendientes: este documento es un handoff, no una implementación. Marcar una tarea sólo después de verificar su criterio. Por cada bloque completar:

| Campo | Qué registrar |
| --- | --- |
| Base y resultado | Fecha, HEAD inicial/final, estado del árbol y bloque C1–C7. |
| Cambios | Archivos y comportamiento corregido; migraciones si existen. |
| Evidencia | Reproducción anterior, comandos/resultados, entorno y artefacto probado. |
| Límites | Mocks frente a proveedor real; pruebas de navegador/dispositivo pendientes. |
| Dependencias | Dato, decisión, credencial o permiso externo faltante, sin secretos. |
| Siguiente acción | Una tarea concreta del primer bloque pendiente. |

### Registro inicial — planificación del 21/09/2026

Se documentó el orden aceptado y la revisión de `6d5163a`. No se corrigió código, desplegó infraestructura ni procesó pagos en esta tarea documental. Evidencia técnica disponible: tests de Player Tools aprobados y reproducción local del HTTP 500 de activación descritos al inicio. Primera acción de implementación: contrastar HEAD y ejecutar el primer pendiente de C1; en paralelo operativo, iniciar alta y retiro de Lemon siguiendo el 11.

### Registro de implementación — 22/09/2026, árbol posterior a `b556464`

- C1-P0: se serializó el lifecycle del documento offscreen y se revalida el lease después de `getContexts()`. Una regresión determinista adquiere un segundo lease durante el cierre, comprueba que no se cierre el documento y que el último lease ejecute el cierre diferido.
- C2 audio: EQ/FX ahora viajan de la UI al worker y al renderer offscreen para loops y tracks completos. `offscreen.html` carga el motor paramétrico y el render offline aplica EQ antes del WAV. Un export con sólo EQ y velocidad 1× requiere PRO. Chromium demostró cambio de señal y bypass sin cambio. WAV se autoriza en el build: FREE rechaza un WAV detectado y Auto reintenta en MP3; un formato explícito no se sustituye silenciosamente.
- C3-P0: `0004_order_revocations.sql` agrega tombstones de reembolso total y claims con token propietario. Reembolso→pedido atrasado→activación no resucita la licencia; reembolso parcial queda para revisión manual. El filtro usa `first_order_item`, conforme al payload oficial actual. Entregas simultáneas reciben 503 para reintento y las ya procesadas son idempotentes.
- Evidencia local: migraciones 0001–0004 ejecutadas en SQLite real desde la suite del servicio; nueve tests del Worker aprobados. `verify-bulk-job-state-machine`, `verify-loop-background-routing`, `verify-tempo-browser` y `verify-parametric-eq-browser` aprobaron. La suite global encontró y se alineó con dos cambios previos de HEAD: Contact desactivado y 63 reseñas de landing.
- Artefacto diagnóstico (no candidato): `npm run package:extension` generó la versión `2026.10.5`; la inspección detectó y corrigió `.DS_Store` dentro de `assets/icons`. El ZIP regenerado no contiene metadata de SO, `repos/`, docs ni tests, y lleva `TEST_LOGIN = null`. SHA-256 local final: `94c2c4bd14aaaa00411e9b3d66213460d98b3a795c278bd7e7c87431c7095d35`. No publicar: todavía faltan los gates C3/C4 indicados abajo.
- E2E de navegador: `npm run test:e2e` aprobó el flujo de loops después de reemplazar un fixture `data:` sobredimensionado por una respuesta WAV interceptada sobre HTTPS. El fallo previo `invalid_build` pertenecía al fixture, no al renderer ni a la política FREE/PRO.
- Regresión local: aprobaron `npm test` (45 verificaciones), `npm run test:player-tools` (9 pruebas del Worker), tempo y EQ paramétrico en Chromium y las verificaciones específicas de descarga, política y máquina de estados. La suite se repitió antes de enmendar el commit.
- Límites: no se desplegó D1 ni Worker, no hubo payload/compras reales de Test Mode, no se probó ChromeOS y no se generó candidato. Siguen abiertos activación concurrente/huérfana, dos seats atómicos, conciliación de estado, comprobante firmado de treinta días y la autoridad/identidad verificable del trial.
- Siguiente acción concreta: cerrar activación concurrente y reconciliación de instancias con tests D1; después implementar dos seats y el comprobante firmado. C4 requiere credenciales/cuenta externas y no puede marcarse cerrado con mocks.
