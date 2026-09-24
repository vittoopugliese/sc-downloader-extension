# 10 — Cierre de release y FREE/PRO

**PARCIAL — actualizado 24/09/2026, base `29d7946`.** Entrada: [00](00-LEER-PRIMERO.md). Evidencia e inventario: [estado actual](../ESTADO-ACTUAL-20260924.md). Operación: [11](11-LEMON-SQUEEZY-TUTORIAL-20260921.md).

Un casillero marcado cierra sólo el criterio escrito. Código probado localmente, compra Test Mode confirmada, operación live y publicación son evidencias distintas. Las implementaciones anteriores no vuelven a cero por conservar pendientes de QA.

## C1 — Confiabilidad: implementación avanzada, cierre integral ABIERTO

- [x] Operaciones durables bulk/single/loop, checkpoints y reconciliación por etapa; guardado incierto visible sin retry automático que duplique archivos. `aebd76b`, `6153701` y verificadores de download/operaciones.
- [x] Enumeración de jobs desde worker con descriptor persistido, cursor, formato y contexto; recuperación sin depender de mantener abierta la pestaña de origen.
- [x] Límites de lectura, errores tipados, cancelación, `Retry-After`, contadores y recuperación cubiertos por las regresiones locales existentes.
- [x] Selector manual actual: confirmación, carga completa, conteo real, numeración continua y scroll local virtualizado (`29d7946`, `verify-popup-selection.js`).
- [ ] **R2a/G2 de selección manual a escala:** el popup volvió a `GET_BULK_SELECTION_LIST` → `selectionList()` → lista/cache completas. Ya no satisface el criterio de «sin array completo ni mensaje gigante». Medir bibliotecas grandes y decidir paginación o aceptar explícitamente un alcance acotado, conservando numeración/selección actuales. Los jobs bulk siguen paginados.
- [ ] Completar la matriz [R0–R7/G1–G8](../audits/RELIABILITY-CLOSURE-PLAN-20260921.md) sobre el candidato: reinicio real, fuentes/HLS, resultados omitidos/fallback, cuota, memoria/ChromeOS, teclado/lector y diagnóstico. Los tests existentes no certifican cada criterio manual.

## C2 — Contrato FREE/prueba/PRO: CERRADO local para perfil; M01 ABIERTO

- [x] FREE independiente de licencia y caída del servicio; WAV/exports transformados y EQ exclusivos PRO.
- [x] Trial D1 siete días/veinte loops; gracia final firmada y acotada, sin nuevo loop/export; Explorer conserva sus siete días al agotar loops.
- [x] USD 3,69 lifetime, dos perfiles, comprobante ES256 de treinta días, guard de vencimiento/renovación y preservación de preferencias.
- [x] Installation ID local, sin compartir seat por sync; respuestas vacías, falsificadas o de otra instalación no conceden PRO.
- [x] Onboarding e inicio idempotente implementados; precio/copy corregidos, promociones ocultas con PRO (`b07f328`).
- [ ] QA de instalación limpia/actualización, con/sin sesión SoundCloud, múltiples pestañas y perfiles existentes sobre el candidato.
- [ ] **M01:** identidad de cuenta verificada por servidor para resistir reinstalación/múltiples perfiles, o decisión explícita del usuario de diferir/cambiar ese requisito. No cerrar por otro UUID local. Implica proveedor de identidad, consentimiento, migración y privacidad; no forma parte del cierre ya demostrado del trial por perfil.

## C3 — Worker y cliente de licencias: CERRADO técnico local

- [x] Activación/restauración con `license_key`, `instance` y `meta` separados, email y producto/modo validados; reserva atómica de seats, concurrencia, retry e instancias huérfanas.
- [x] Webhook HMAC sobre cuerpo original, límites, claims recuperables, deduplicación de entrega/pedido y filtros antes de mutación.
- [x] Reembolso total con tombstone; parcial a revisión manual; eventos atrasados no rehabilitan PRO; `license_key_updated` y reconciliación por API.
- [x] Errores temporales/credenciales del proveedor no revocan una compra válida; instancia ausente afecta sólo al perfil; soporte puede inspeccionar, conciliar y liberar.
- [x] Recibos ES256, rotación por `keyId`, expiración/alarma/guard, sin guardar email/clave en la extensión.
- [x] Límites HTTP/rate limit, secretos/D1/rutas test/live separados en la configuración. Los valores live pendientes no cuentan como servicio productivo desplegado.
- [x] Checkout automático: pedido correlacionado → licencia generada → activación → `/checkout/claim` → recibo validado. Restauración manual conservada para compra externa/otra instalación.
- [x] Login local `1/1` y mensajes asociados eliminados del runtime en `670d4ee`; los tests usan fixtures aislados.

Evidencia del 24/09: cuatro verificadores de cliente y 29 tests del servicio aprobados, con SQLite real local y proveedor simulado. Esto cierra implementación/regresiones, no sustituye la matriz externa.

## C4 — Test Mode: compra, PRO y salida del trial CERRADOS; casos restantes ABIERTOS

- [x] Configuración test concreta, D1 y Worker de test operativos: deploy/health y checkout registrados en `670d4ee`; compra funcional confirmada por el usuario.
- [x] Compra de prueba, activación automática de PRO y salida del trial de siete días: confirmación explícita del usuario el 24/09. No repetir como si nunca se hubiera probado.
- [ ] Registrar correlación sanitizada pedido/licencia/instancia/D1 y comprobar una sola venta/evento por pedido. No se copian claves ni datos del comprador al repo.
- [ ] Cancelar/rechazar checkout no concede acceso; compra pendiente se recupera con webhook tardío y tras cerrar popup/reiniciar worker.
- [ ] Restaurar con email/clave, repetir/concurrencia sin cupos extra, dos perfiles activos, tercero rechazado y liberar/reactivar con soporte. El usuario confirmó que no probó estos escenarios.
- [ ] Reembolso test y cambio manual de licencia revocan al revalidar; conservan preferencias/trial y descargas FREE.
- [ ] Casos negativos de firma/origin/producto/variante/modo/email/clave y caída de red; confirmar el comportamiento externo correspondiente, sin confundirlo con mocks verdes.

La evidencia del usuario cierra exactamente comprar PRO, activarlo automáticamente y salir del trial de siete días. El usuario confirmó que no probó restore, segundo/tercer perfil ni refund/revocación. Los demás casos quedan sin evidencia individual; no implica que hayan fallado.

## C5 — Live/comercial: ABIERTO

- [ ] Registrar aprobación de tienda/producto, identidad/fiscal y método de retiro aceptado; la discusión histórica de Wise no demuestra un bloqueo actual ni su resolución.
- [ ] Términos, privacidad, alcance de lifetime/actualizaciones, soporte y política de refunds coherentes y publicados.
- [ ] Reemplazar `REPLACE_WITH_LIVE_LEMON_*` en `wrangler.jsonc` por IDs reales; verificar producto USD 3,69, licencia sin vencimiento y cupo.
- [ ] Instalar/verificar secretos, webhook, CORS y Worker live con su D1/JWK independientes. La creación/migración previa de D1 no demuestra deploy live.
- [ ] Compra/activación/restore/refund de producción controlados, con autorización aplicable para gasto real; procedimiento de recuperación probado.

## C6 — Candidato y Store: ABIERTO

- [x] `npm test`: 48 verificadores aprobados el 24/09. Contact requiere Chromium fuera del sandbox de macOS; comparación de fuente externa de reseñas omitida por archivo ausente.
- [x] `npm run test:player-tools`: cuatro verificadores y 29 tests aprobados el 24/09.
- [x] `npm run test:e2e:tempo`: aprobado el 24/09; header/visibilidad/reset, conservación del sampler, carreras y layout estrecho incluidos.
- [x] Procedencia/fingerprint y smoke del paquete implementados; gate completo y ZIP **diagnóstico** registrados el 23/09. No certifican un ZIP actual.
- [ ] Ejecutar gate completo del candidato actual con endpoint/JWK live; revisar equivalencia del empaquetador alternativo cuando se use.
- [ ] QA real de FREE/HLS/carpeta/recovery y Explorer (login/logout, cambio de cuenta, grandes/vacías, fin de trial), EQ/export y matriz de dispositivos/accesibilidad.
- [ ] Generar versión única, ZIP sin secretos/fixtures/docs/datos privados y sin bypass PRO; registrar commit, fecha, SHA-256 y smoke de esos mismos bytes.
- [ ] Actualizar Store/capturas/locales desde [03](03-STORE-Y-LOCALIZACION.md), [07](07-GUIONES-Y-CAPTURAS.md), [09](09-DESCRIPCIONES-STORE-5-IDIOMAS.md), políticas y landing según capacidades verificadas.
- [ ] Enviar/publicar con autorización aplicable y registrar por separado envío, revisión, aprobación y disponibilidad. No hay evidencia de publicación de este candidato.

## C7 — Operación y medición: ABIERTO

- [x] Documentación reconciliada con HEAD y compra test confirmada; inventario y cierres explícitos del 24/09.
- [ ] Conciliar embudo mínimo real: compra deduplicada por servidor, activación, errores y refunds; excluir test de métricas productivas.
- [ ] Baseline por versión/período con denominadores; feedback de una versión antigua no certifica impacto de fixes nuevos.
- [ ] Registrar comisiones/neto efectivos y primer payout cuando haya saldo elegible; no afirmar que un retiro se recibió por haberlo configurado.
- [ ] Soporte/reconciliación operativos. Experimentos 1E sólo después de datos, una variable comercial por vez.

## Registro de continuidad

Base limpia al iniciar: `29d7946`, versión `2026.10.5`. Revisión documental, código y últimos commits; sin deploy, pagos, acceso a cuentas privadas ni publicación en esta sesión. La confirmación externa es del usuario. Los registros extensos de los días 21–23 están en Git; [12](12-ESTADO-Y-SIGUIENTE-AGENTE-20260923.md) conserva la evidencia histórica útil.

Siguiente acción: registrar los escenarios de C4 todavía no confirmados y resolverlos; en paralelo preparar C5 con sus valores reales. Para cada cierre guardar fecha, commit/entorno, escenario, resultado y límites. No reimplementar C3, EQ/export o header desde planes antiguos.
