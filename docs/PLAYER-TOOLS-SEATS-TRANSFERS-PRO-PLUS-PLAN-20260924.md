# Player Tools Pro: asientos, transferencias y upgrade Pro Plus

Fecha: **24/09/2026**. Estado: **plan de producto y diseño técnico; no implementado**.
Base inspeccionada al escribir: **`343474e`**, versión `2026.10.5`, más los cambios locales de corrección del enrutamiento offscreen todavía no consolidados en un commit.

Este documento registra la dirección acordada después de probar en Lemon Squeezy Test Mode la restauración de una compra, la persistencia de PRO, dos perfiles activos y el rechazo correcto de un tercer perfil. No autoriza por sí solo cambios de precios en Live, nuevos productos en Lemon, migraciones D1 ni despliegues.

## 1. Objetivo

Resolver correctamente el reemplazo de instalaciones perdidas o desinstaladas sin convertir una licencia lifetime económica en una licencia compartible de manera indefinida.

El sistema debe distinguir dos conceptos:

- **Asiento:** instalación que puede mantener PRO activo simultáneamente.
- **Transferencia:** liberación de un asiento anterior para permitir otra instalación.

Una reinstalación de la extensión no puede reconocerse de forma confiable como el mismo perfil anterior. `chrome.storage.local` se elimina al desinstalar y la nueva instalación genera otro `installationId`. El servidor debe tratarla como otra instalación y permitir la sustitución sólo mediante una transferencia explícita.

## 2. Decisiones confirmadas por el propietario

Las siguientes decisiones son vigentes y no deben reinterpretarse durante la implementación:

1. **Pro Personal conserva el precio lifetime de USD 3.69.**
2. **Pro Personal conserva dos asientos activos simultáneos.**
3. La licencia Personal incluye **una única transferencia de cortesía** para corregir una desinstalación, pérdida o equivocación.
4. Las transferencias no serán gratuitas e ilimitadas.
5. Una vez consumida la cortesía, el usuario debe pagar para ampliar su licencia o recurrir a soporte según la política final.
6. Existirá un upgrade **Pro Plus de USD 2.49 adicionales**, para un total lifetime acumulado de USD 6.18 antes de impuestos.
7. No se ofrecerá un plan Team.
8. No se ofrecerá una licencia Unlimited.
9. Cinco perfiles simultáneos se consideran excesivos y fáciles de compartir entre varias personas.
10. La gestión de instalaciones aparecerá en el contexto del límite de asientos, no como una promoción principal permanente.

## 3. Propuesta recomendada pendiente de confirmación final

Esta tabla completa los puntos que todavía no fueron decididos expresamente. Es la recomendación de producto para implementar, pero debe aprobarse antes de crear productos Live o migraciones irreversibles.

| Característica | Pro Personal | Pro Plus |
| --- | ---: | ---: |
| Pago | USD 3.69 | Upgrade único de USD 2.49 |
| Total lifetime acumulado | USD 3.69 | USD 6.18 |
| Asientos simultáneos | 2 | **3 propuestos** |
| Transferencias lifetime | 1 | **3 totales propuestas** |
| Después de agotar transferencias | Upgrade o soporte | Soporte inicialmente |
| Unlimited | No | No |

Las tres transferencias propuestas para Plus serían el límite total histórico de la licencia, no tres transferencias adicionales. Si una licencia Personal ya consumió su cortesía y luego se actualiza a Plus, quedarían dos transferencias disponibles.

No crear inicialmente una microcompra repetible de resets. Primero medir cuántos compradores legítimos agotan la cortesía y cuántos casos requieren soporte. Una compra repetible de transferencias podría facilitar compartir la licencia y complicaría reembolsos, conciliación e impuestos sin evidencia de demanda.

## 4. Semántica exacta de una transferencia

Una transferencia libera **un solo asiento**. Nunca debe revocar todas las instalaciones sin una confirmación diferente y explícita.

Consumirían un crédito:

- liberar remotamente una instalación perdida;
- desactivar voluntariamente el dispositivo actual para utilizar otro;
- reemplazar una instalación después de desinstalar y reinstalar la extensión;
- liberar un asiento desde la interfaz de gestión aunque pertenezca al mismo perfil físico.

No consumirían un crédito:

- una corrección administrativa realizada por soporte;
- una reserva de activación que nunca llegó al estado activo;
- reconciliar una instancia que Lemon ya informa como inexistente;
- revertir una operación fallida antes de que Lemon confirme la desactivación;
- corregir un incidente atribuible al servicio.

El crédito se consume sólo después de que Lemon confirma `deactivated: true` y D1 registra la liberación. Un timeout, un `5xx` o una respuesta ambigua no deben descontarlo definitivamente.

## 5. Por qué desinstalar no puede liberar automáticamente

La identidad actual se guarda como `scdl.playerTools.installation.v1` en `chrome.storage.local`. Chrome elimina ese almacenamiento cuando se quita la extensión. La reinstalación no conserva una prueba confiable de que se trata del mismo perfil.

`chrome.runtime.setUninstallURL()` únicamente solicita abrir una URL después de desinstalar. No ofrece una transacción autenticada y garantizada antes de borrar la extensión. Puede no abrirse, puede no completar una petición y ya no dispone de la identidad local como autoridad segura.

Por eso no se debe:

- liberar automáticamente por visitar la página de despedida;
- confiar en cookies de SoundCloud o en la cuenta de Google del perfil;
- usar fingerprinting del equipo para intentar reconocer reinstalaciones;
- considerar cerrar Chrome, cerrar sesión o dejar de usar la extensión como liberación de un asiento.

El mecanismo soportado será la transferencia autenticada mediante email y licencia.

## 6. Experiencia de usuario propuesta

### 6.1 Límite con una transferencia disponible

Después de validar correctamente email y licencia, una respuesta `seat_limit` puede abrir dentro del mismo diálogo una sección compacta:

```text
This license already has two active Chrome profiles.

Chrome installation …7487
Activated Sep 24 · Last checked Sep 24                       ×

Chrome installation …a03a
Activated Sep 22 · Last checked Sep 24                       ×

1 complimentary profile transfer available.
```

Chrome no expone de manera confiable el nombre humano del perfil, como “B” o “Trabajo”. Se pueden mostrar únicamente:

- plataforma general enviada por el cliente, por ejemplo `Chrome on macOS`;
- fecha de activación;
- última validación;
- cuatro caracteres finales de un identificador público derivado.

No mostrar IP, ubicación precisa, email completo adicional, `installationId`, `instanceId` de Lemon ni hashes internos.

### 6.2 Confirmación de liberación

Al pulsar la cruz:

```text
Release this Chrome profile?

This will use your only complimentary profile transfer.
The released profile will lose Pro after its next license check.

[Cancel] [Release profile]
```

Tras la confirmación:

1. bloquear temporalmente las cruces y el botón de activación;
2. ejecutar una solicitud idempotente de liberación;
3. mostrar `Profile released` sólo después de confirmación remota;
4. volver a ejecutar el restore de la instalación actual;
5. conservar un botón de retry si la liberación terminó pero la nueva activación sufrió un error transitorio.

No encadenar operaciones de forma que una respuesta perdida pueda consumir dos transferencias o dos asientos.

### 6.3 Transferencias agotadas

Cuando Personal ya consumió la cortesía:

```text
You have used your complimentary profile transfer.

Upgrade to Pro Plus
• One more simultaneous Chrome profile
• More lifetime profile transfers
• Pay $2.49 once

[Upgrade to Pro Plus] [Contact support]
```

La cantidad exacta de transferencias Plus sólo debe aparecer cuando se confirme la propuesta de tres totales.

La promoción puede estar oculta en el flujo normal y aparecer al alcanzar el límite, en Help/License y eventualmente en una pantalla de administración. No convertirla en una interrupción frecuente para usuarios sin problemas de asientos.

### 6.4 Accesibilidad y localización

- La cruz debe ser un `<button>` con nombre accesible como `Release Chrome installation …7487`.
- Debe poder operarse por teclado y mantener foco después de actualizar la lista.
- Estado y errores deben anunciarse mediante la región `aria-live` existente.
- Confirmación, créditos restantes, upgrade, estados pendientes y fallos requieren claves en los cinco locales actuales.
- No usar sólo color para distinguir una instalación activa, pendiente o liberada.

## 7. Modelo de datos propuesto

Los nombres siguientes son diseño, no una migración lista para ejecutar.

### 7.1 Ampliación de `licenses`

```sql
plan TEXT NOT NULL DEFAULT 'personal'
  CHECK (plan IN ('personal', 'plus')),
seat_limit INTEGER NOT NULL DEFAULT 2
  CHECK (seat_limit BETWEEN 1 AND 3),
transfer_limit INTEGER NOT NULL DEFAULT 1
  CHECK (transfer_limit BETWEEN 0 AND 3),
transfer_used INTEGER NOT NULL DEFAULT 0
  CHECK (transfer_used >= 0 AND transfer_used <= transfer_limit),
upgraded_at INTEGER,
upgrade_order_id TEXT
```

Los límites deben quedar persistidos por licencia. No derivarlos siempre de variables globales porque una modificación futura del producto no debe alterar retroactivamente compras existentes sin una migración deliberada.

### 7.2 Nueva tabla `seat_transfers`

```sql
CREATE TABLE seat_transfers (
  transfer_id TEXT PRIMARY KEY,
  lemon_license_id TEXT NOT NULL REFERENCES licenses(lemon_license_id),
  source_instance_id TEXT NOT NULL,
  requesting_installation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('courtesy', 'plus', 'support')),
  state TEXT NOT NULL CHECK(state IN ('pending', 'provider_confirmed', 'completed', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  provider_confirmed_at INTEGER,
  completed_at INTEGER,
  failure_code TEXT
);
```

Una restricción o reserva transaccional debe impedir dos transferencias `pending` simultáneas para la misma licencia cuando sólo queda un crédito.

### 7.3 Ampliación de `activations`

Campos propuestos:

```text
device_label
released_reason
released_by_installation_id
release_transfer_id
```

`last_validated_at` ya proporciona la última comprobación. No agregar tracking de uso detallado para esta función.

### 7.4 Upgrade idempotente

Crear `license_upgrades` o una tabla equivalente:

```text
upgrade_claim_id
lemon_order_id UNIQUE
lemon_license_id
target_plan
state
created_at
completed_at
refunded_at
```

Un mismo webhook o pedido no debe aplicar el upgrade dos veces ni regalar créditos adicionales.

## 8. Cambios del Worker

### 8.1 Límite dinámico

El código actual usa `MAX_ACTIVE_PROFILES = 2`. `acquireActivationOperation()` debe leer la licencia y utilizar `licenses.seat_limit` dentro de la reserva D1.

La operación continúa necesitando una reserva atómica antes de llamar a Lemon. Tres restores simultáneos de Personal deben seguir produciendo exactamente dos activaciones y un `seat_limit`.

### 8.2 Endpoints propuestos

```text
POST /api/player-tools/license/restore
POST /api/player-tools/license/seats
POST /api/player-tools/license/seats/release
POST /api/player-tools/license/upgrade/checkout
POST /api/player-tools/license/status
```

Se prefieren solicitudes `POST` porque email/licencia y tokens de gestión no deben quedar en URLs, historial o logs de proxies.

### 8.3 Respuesta enriquecida de `seat_limit`

Sólo después de validar correctamente email, licencia, producto, variante, modo y estado:

```json
{
  "active": false,
  "error": "seat_limit",
  "plan": "personal",
  "seatLimit": 2,
  "transferLimit": 1,
  "transferUsed": 0,
  "seats": [
    {
      "label": "Chrome installation …7487",
      "activatedAt": 1790289960377,
      "lastCheckedAt": 1790290620936,
      "seatToken": "signed-short-lived-token"
    }
  ],
  "upgrade": {
    "available": true,
    "priceCents": 249,
    "currency": "USD",
    "targetPlan": "plus"
  }
}
```

Una clave o email incorrectos deben continuar devolviendo `activation_failed` sin revelar si la licencia existe ni qué instalaciones tiene.

### 8.4 Token de asiento

`seatToken` debe:

- estar firmado por el servidor;
- identificar licencia e instancia sin exponerlas como autoridad editable;
- expirar en aproximadamente diez minutos;
- estar ligado al intento/instalación solicitante;
- incluir versión de esquema y propósito `release-seat`;
- ser de un solo uso lógico mediante `requestId`/idempotencia.

### 8.5 Liberación durable

Flujo del servidor:

1. Validar cuerpo, origen y rate limit.
2. Validar email y hash de licencia.
3. Verificar `seatToken`, expiración y pertenencia.
4. Confirmar que la activación continúa activa.
5. Reservar un crédito mediante una fila `pending` idempotente.
6. Llamar a Lemon `POST /v1/licenses/deactivate` con licencia e `instance_id`.
7. Si Lemon confirma, marcar la activación con `deactivated_at`.
8. Eliminar la fila activa correspondiente de `activation_operations`.
9. Incrementar `transfer_used` una sola vez.
10. Completar `seat_transfers` y devolver el estado.

Si la respuesta de Lemon se pierde después de ejecutar la desactivación, el retry debe consultar/reconciliar la instancia antes de decidir si consume o libera la reserva. No repetir ciegamente una operación remota ambigua.

La herramienta administrativa existente conserva su vía separada con `ADMIN_TOKEN` y `kind='support'`; una corrección de soporte no consume el cupo comercial salvo decisión manual explícita.

## 9. Cambios del cliente de extensión

### 9.1 Estado comercial

La API pública del módulo de comercio debe incorporar de manera acotada:

```text
plan
seatLimit
transferLimit
transferUsed
upgradeAvailable
```

No persistir email ni licencia. La lista de asientos y sus tokens debe vivir únicamente durante el diálogo de gestión y descartarse al cerrarlo o al expirar.

### 9.2 Métodos nuevos

```js
listSeats({ email, licenseKey })
releaseSeat({ email, licenseKey, seatToken, requestId })
startUpgrade({ email, licenseKey })
```

Todos pasan por el service worker. Popup, content scripts y MAIN no reciben autoridad directa para cambiar D1 ni llamar a Lemon.

### 9.3 Estados de UI

La interfaz debe contemplar:

- lista cargando;
- transferencia disponible;
- transferencia agotada;
- liberación pendiente;
- liberación confirmada;
- proveedor temporalmente inaccesible;
- token expirado y refresh de lista;
- upgrade pendiente;
- upgrade confirmado;
- licencia base o upgrade reembolsados.

Evitar nuevamente errores genéricos: mostrar mensajes por códigos estables y conservar un fallback sólo para respuestas verdaderamente desconocidas.

## 10. Revalidación y límite simultáneo real

Esta corrección es requisito previo para ofrecer transferencias al cliente.

Hoy un recibo PRO válido puede evitar la consulta online aunque se solicite `getState({ revalidate: true })`. Una instalación liberada podría conservar acceso local hasta vencer el recibo. Eso contradice un límite estricto de instalaciones simultáneas.

Diseño recomendado:

1. Consultar `/license/status` al abrir el popup, iniciar el service worker o usar una función PRO si pasaron al menos 24 horas desde la última comprobación online.
2. Deduplicar solicitudes concurrentes y aplicar un intervalo mínimo.
3. Ante `license_revoked` o instancia liberada confirmada, retirar PRO inmediatamente.
4. Ante timeout o `5xx`, conservar temporalmente un recibo todavía válido.
5. Reducir el TTL futuro del recibo offline de 30 a 7 días si se prioriza evitar uso compartido.

Decisión pendiente: confirmar **7 días de acceso offline máximo** y **24 horas entre revalidaciones online**. Cuanto mayor sea el período offline, mayor será el tiempo durante el cual un asiento liberado puede seguir utilizándose bloqueando deliberadamente el servicio.

## 11. Producto y checkout Pro Plus

### 11.1 Oferta

Crear en Lemon Test Mode antes de Live:

```text
Player Tools Pro Plus Upgrade
USD 2.49
One-time
```

Inicialmente será un upgrade contextual, no un producto principal ni un plan Team. La UI debe comunicar:

```text
You already own Pro Personal.
Pay $2.49 once to upgrade to Pro Plus.
Total lifetime price paid: $6.18 before tax.
```

### 11.2 No emitir una licencia independiente

El upgrade no debe crear una segunda licencia utilizable por separado. La autoridad continúa siendo la licencia Personal original.

Flujo propuesto:

1. La extensión valida email/licencia con el servicio.
2. El servicio crea un `upgrade_claim_id` aleatorio, corto y de un solo uso.
3. El servidor crea el checkout de la variante Upgrade e incluye sólo el claim en `custom_data`.
4. Nunca incluir la licencia o su hash en la URL o el checkout.
5. `order_created` valida tienda, producto, variante, modo y claim.
6. El webhook cambia la licencia original a Plus de forma idempotente.
7. La extensión reclama el nuevo estado y recibe un recibo actualizado.

El Worker actual permite un solo `LEMON_VARIANT_ID`. La implementación futura necesita allowlists separadas para:

- compra base Personal;
- upgrade Pro Plus;
- entornos test y live.

El producto de upgrade puede desactivar la generación de claves si Lemon lo permite en su configuración, porque la compra no debe entregar otra licencia independiente.

### 11.3 Capacidad de Lemon

La licencia Lemon subyacente debe permitir al menos el máximo técnico de Pro Plus. D1 seguirá siendo la autoridad comercial para distinguir Personal de Plus.

Una opción segura es configurar el límite proveedor en tres para nuevas licencias y hacer cumplir dos para Personal en D1. Así un upgrade existente puede usar el tercer asiento sin depender de modificar retroactivamente la licencia del proveedor. Una activación directa contra Lemon no concede PRO en la extensión porque falta el recibo ES256 emitido por este servicio.

## 12. Refunds y downgrade

Política recomendada pendiente de confirmación:

- **Reembolso total de Personal:** revocar la licencia completa, todos los asientos y cualquier Plus asociado.
- **Reembolso de Plus:** volver a Personal, restaurar `seat_limit=2` y `transfer_limit=1` sin reducir `transfer_used` histórico.
- Si al volver a Personal hay tres asientos activos, conservar los dos más antiguos y liberar el más reciente.
- Un webhook antiguo de upgrade no debe rehabilitar Plus después de su reembolso.
- Un reembolso parcial queda para revisión manual, como en el servicio actual.

La regla de conservar los dos asientos más antiguos es determinista, pero puede no coincidir con la preferencia del cliente. Alternativa pendiente: poner la licencia en `downgrade_pending` y pedir que el usuario elija cuál liberar.

## 13. Seguridad y privacidad

- No almacenar licencia en texto plano.
- No registrar cuerpos con email/licencia en logs.
- No exponer instalaciones antes de validar ambas credenciales.
- Rate limit separado para listar, liberar y crear upgrades.
- Tokens firmados de propósito único y corta duración.
- `requestId` obligatorio para idempotencia.
- Reserva D1 antes de llamadas remotas.
- Comparar producto, variante, tienda y modo en checkout/webhooks.
- Rechazar upgrade de una licencia revocada.
- No usar fingerprinting, IP ni cuenta de SoundCloud como identidad de licencia.
- Auditar soporte y transferencias sin conservar secretos.
- Redactar email y licencia en capturas y documentación compartida.

La protección busca limitar el uso casual compartido y las filtraciones. No puede impedir que un usuario modifique localmente una extensión unpacked, pero la publicación oficial sólo acepta recibos firmados por el servidor.

## 14. Observabilidad y soporte

Eventos propuestos, sin PII:

```text
seat_limit_seen
seat_manager_opened
seat_release_started
seat_release_completed
seat_release_failed
seat_transfer_exhausted
plus_upgrade_started
plus_upgrade_completed
plus_upgrade_refunded
```

Propiedades permitidas:

```text
plan
seatLimit
transferUsed
result
failureCode
surface
version
```

No enviar IDs de Lemon, `installationId`, licencia, email ni token de asiento a analítica.

La herramienta administrativa debe poder:

- inspeccionar plan, límites y uso de transferencias;
- ver activaciones y transferencias con timestamps;
- reconciliar una instancia con Lemon;
- liberar por soporte sin consumir crédito;
- corregir manualmente un crédito sólo con preview y confirmación explícita.

## 15. Migración y rollout

### Fase A — corrección previa

1. Corregir revalidación online de recibos válidos.
2. Definir TTL offline e intervalo de consulta.
3. Agregar tests de revocación de una instancia liberada.
4. Mantener la liberación únicamente administrativa.

### Fase B — datos y API en Test Mode

1. Migrar licencias existentes a `personal`, dos asientos y una transferencia.
2. Crear tablas de transferencias/upgrades.
3. Implementar listado seguro y liberación durable.
4. Extender herramientas administrativas.
5. Desplegar sólo en el Worker test.

No otorgar automáticamente la cortesía más de una vez al repetir migraciones.

### Fase C — UI de gestión

1. Mostrar instalaciones después de un `seat_limit` válido.
2. Implementar confirmación y estados accesibles.
3. Reintentar restore después de liberar.
4. Localizar los cinco idiomas.
5. Probar popup con documento offscreen activo para evitar otra carrera de respuestas.

### Fase D — Pro Plus Test Mode

1. Crear producto/variante test por USD 2.49.
2. Implementar claim y checkout de upgrade.
3. Procesar webhook idempotente.
4. Verificar tercer asiento y transferencias Plus.
5. Probar reembolso y downgrade.

### Fase E — decisión Live

Sólo después de evidencia Test Mode:

1. confirmar los puntos pendientes de la sección 17;
2. crear producto/variante Live;
3. instalar IDs y allowlists Live;
4. probar compra, restore, upgrade, refund y soporte controlados;
5. actualizar términos, soporte, copy y materiales Store si corresponde.

## 16. Matriz de pruebas futura

### Personal

- Dos instalaciones distintas activan.
- Tercera recibe `seat_limit` y lista segura.
- Email incorrecto no obtiene lista.
- Licencia incorrecta no obtiene lista.
- Primera transferencia libera exactamente un asiento.
- Nueva instalación activa y `transfer_used=1`.
- Segunda transferencia queda bloqueada.
- Doble clic consume un solo crédito.
- Dos pestañas simultáneas consumen un solo crédito.
- Respuesta perdida se recupera sin repetir la liberación.
- Error proveedor no consume crédito confirmado.
- Soporte puede liberar sin consumir crédito.

### Pro Plus

- Checkout de USD 2.49 se vincula a la licencia correcta.
- Webhook repetido no repite upgrade ni créditos.
- Tercer asiento activa.
- Cuarto asiento queda bloqueado si se confirma el límite propuesto de tres.
- Upgrade después de una transferencia Personal conserva uso histórico.
- Transferencias Plus nunca superan el límite total.
- Reembolso Plus aplica downgrade determinista.
- Reembolso Personal revoca todo.

### Seguridad

- Token de otra licencia falla.
- Token de otra instalación solicitante falla.
- Token vencido falla y permite refrescar lista.
- Firma alterada falla.
- Producto, variante o modo incorrectos no mutan D1.
- Licencia revocada no puede comprar/aplicar upgrade.
- Rate limits no permiten consumir dos créditos por carreras.

### Cliente y offline

- Perfil liberado pierde PRO en la siguiente consulta confirmada.
- Caída transitoria conserva recibo válido.
- Recibo expirado sin red no concede acceso indefinido.
- FREE y descargas gratuitas siguen funcionando.
- Preferencias, trial e historial no se eliminan al perder PRO.
- Offscreen no intercepta mensajes del popup.

## 17. Decisiones pendientes antes de implementar

Estas decisiones requieren aprobación expresa:

1. Confirmar **tres asientos simultáneos** para Pro Plus.
2. Confirmar **tres transferencias lifetime totales** para Pro Plus.
3. Confirmar que una transferencia usada en Personal cuenta dentro del total Plus.
4. Definir si, agotado Plus, sólo existe soporte o se ofrecerá un reset pago futuro.
5. Confirmar recibo offline de siete días y revalidación cada 24 horas.
6. Confirmar comportamiento del downgrade si hay tres asientos activos.
7. Confirmar si Pro Plus será únicamente upgrade oculto o también compra directa.
8. Confirmar si el precio USD 2.49 se mantendrá después del lanzamiento o será promocional.
9. Definir copy legal/comercial sobre impuestos y precio total acumulado.

No crear la variante Live ni publicar copy definitivo hasta cerrar estos nueve puntos.

## 18. Próxima prueba del sistema actual

Antes de implementar este plan, continuar el QA del sistema existente. El escenario actual tiene A y la instalación antigua de B ocupando los dos asientos; la nueva instalación de B y C son rechazadas.

Prueba inmediata:

1. Inspeccionar la licencia mediante la herramienta administrativa apuntando explícitamente al endpoint test.
2. Identificar la instalación antigua de B por sus timestamps/identificador.
3. Ejecutar `release-seat` en preview.
4. Confirmar el objetivo y ejecutar apply.
5. Restaurar en la instalación nueva de B: debe activar PRO.
6. Intentar restaurar en C: debe rechazar el tercer perfil.
7. Confirmar que A y B están PRO y C sigue FREE.
8. Ejecutar una descarga FREE en C.
9. Registrar pedido, IDs no secretos, timestamps y capturas redactadas.

Después continuar, en este orden:

1. cancelación de checkout y tarjetas rechazadas;
2. recuperación de una compra pendiente después de cerrar Chrome;
3. webhooks, deduplicación y respuestas perdidas;
4. reembolso total y revocación;
5. trial, FREE y PRO;
6. QA de descargas/audio/Explorer con SoundCloud real;
7. `npm run test:release-local`;
8. smoke del ZIP exacto cargado como unpacked.

## 19. Criterios de cierre de este plan futuro

La función de asientos/transferencias/Plus sólo estará cerrada cuando:

- las decisiones de la sección 17 estén registradas;
- migraciones test y live sean idempotentes;
- Personal nunca supere dos asientos activos;
- Plus nunca supere su límite aprobado;
- cada liberación consuma como máximo un crédito;
- errores remotos no pierdan créditos ni creen asientos fantasma;
- una instalación liberada pierda PRO según la política de revalidación;
- upgrade y refunds sean deduplicados;
- credenciales inválidas no revelen instalaciones;
- soporte pueda inspeccionar, reconciliar y corregir con auditoría;
- los cinco locales y la accesibilidad del popup estén verificados;
- QA de Test Mode, gate local y smoke del ZIP estén aprobados;
- una compra/upgrade/refund Live controlados estén documentados antes de Store.

## 20. Fuera de alcance

- plan Team;
- activaciones ilimitadas;
- fingerprinting del equipo;
- reconocimiento automático garantizado después de desinstalar;
- login con cuenta de Google o SoundCloud como identidad comercial;
- marketplace de asientos;
- renovaciones o suscripción obligatoria;
- reset mensual automático;
- múltiples licencias independientes creadas por el upgrade;
- implementación o despliegue por el solo hecho de aprobar este documento.

## 21. Referencias

- Lemon License API — activate: <https://docs.lemonsqueezy.com/api/license-api/activate-license-key>
- Lemon License API — deactivate: <https://docs.lemonsqueezy.com/api/license-api/deactivate-license-key>
- Lemon License API — validate: <https://docs.lemonsqueezy.com/api/license-api/validate-license-key>
- Lemon — create checkout: <https://docs.lemonsqueezy.com/api/checkouts/create-checkout>
- Lemon — variant object: <https://docs.lemonsqueezy.com/api/variants/the-variant-object>
- Chrome extension storage: <https://developer.chrome.com/docs/extensions/reference/api/storage>
- Chrome runtime/uninstall URL: <https://developer.chrome.com/docs/extensions/reference/api/runtime#method-setUninstallURL>
- Operación actual del servicio: [`services/player-tools-license/README.md`](../services/player-tools-license/README.md)
- Checklist vigente de release: [`planning-20260915/10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md`](planning-20260915/10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md)

