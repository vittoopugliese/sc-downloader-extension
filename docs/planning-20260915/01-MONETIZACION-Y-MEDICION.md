# 01 — Trial, compra y medición

**PARCIAL — 24/09/2026, `29d7946`.** Implementación comercial cerrada; compra, activación automática de PRO y salida del trial de siete días en Test Mode confirmadas por el usuario. Live, matriz externa restante y medición de producción siguen abiertos. [Estado completo](../ESTADO-ACTUAL-20260924.md).

## Contrato vigente

| Área | Contrato implementado |
| --- | --- |
| FREE | Descargas normales de tracks/colecciones independientes del servicio comercial; WAV y exports transformados requieren PRO. Auto puede recurrir a MP3 cuando un WAV requiere PRO; no sustituir silenciosamente un formato explícito. |
| Trial musical | Siete días por perfil Chrome y hasta veinte loops nuevos; termina al primer límite, salvo la gracia firmada del último loop concedido. |
| Likes Explorer | Prueba durante siete días, independiente de agotar los veinte loops; luego PRO. |
| PRO | USD 3,69, pago único lifetime, dos perfiles Chrome activados. Recibo ES256 con vigencia técnica de treinta días y renovación online. |
| Identidad | Installation ID en storage local; D1 conserva plazo/consumos. No garantiza resistencia a reinstalación ni una prueba por persona. |
| EQ/export | EQ paramétrico PRO, WAV y exportaciones de loop/track con transformaciones PRO. |

La instalación abre Likes e inicia el onboarding; popup/Player Tools usan el mismo inicio idempotente. Una actualización no debe abrir de nuevo Likes ni reiniciar/extender una prueba ya registrada. Mantener QA de instalación, actualización y perfiles existentes en C2/C6 del plan 10.

## Estado de cada etapa

- [x] **1A — CERRADO local:** capacidades compartidas, cuota durable, sesiones/gracia, handlers de export y carreras de autorización. FREE no depende de la licencia.
- [x] **1B — CERRADO para el contrato por perfil:** prueba D1 de siete días/veinte loops; acceso temporal separado de Explorer. El nuevo requisito por cuenta es M01, abierto.
- [x] **1C — CERRADO técnico:** checkout correlacionado, webhook firmado, activación automática, claim con recibo firmado, restauración email/clave, dos perfiles, administración, revalidación y revocación.
- [x] **1C — CERRADO recorrido principal Test Mode:** compra, activación automática de PRO y salida del trial de siete días confirmadas por el usuario el 24/09; implementación en `670d4ee`.
- [ ] **1C — Cierre externo restante:** el usuario no probó restore con email/clave, segundo y tercer perfil ni refund/revocación. También faltan duplicados/fallos observados según C4 y Live según C5.
- [x] **1D — CERRADO implementación:** eventos mínimos y compra confirmada desde servidor, con allow-list y correlación seudónima. Verificadores de commerce/analytics disponibles.
- [ ] **1D — Observación:** baseline por versión/cohorte, conciliación de ventas/activaciones/refunds y separación test/live comprobada en operación.
- [ ] **1E — DIFERIDO:** experimentos después de datos suficientes; no cambiar a la vez precio, cuota y oferta.

## Compra y recuperación

Comprar desde la extensión crea un checkout con installation ID y modo explícito. El webhook valida el pedido, obtiene la licencia generada y activa esa instalación. Al volver a SoundCloud o revalidar una compra pendiente, la extensión pide `/checkout/claim` y verifica el comprobante ES256. La URL de regreso no concede acceso por sí sola.

Restaurar con email y clave sigue disponible para otra instalación o compra externa. Conservar errores recuperables, reserva atómica de dos perfiles y liberación por soporte; no obligar a comprar de nuevo ante un fallo transitorio. Una revocación no elimina preferencias ni historial de trial.

## Medición y experimentos pendientes

Conservar eventos de apertura, valor, intento PRO, paywall, checkout, compra, activación y descarga terminal. Compra confirmada significa pedido validado en servidor, no clic ni página de éxito. No transmitir títulos, bibliotecas, URLs musicales, emails ni claves en analytics.

Comparar instalaciones elegibles únicas por cohorte y ventana fija, diferenciando recorridos por origen. Retención D1/D7, compra/apertura, neto por 1.000 elegibles, errores, refunds y soporte requieren datos observados. No equiparar conteos de eventos con personas ni el formulario de desinstalación con tasa global de fallos.

Precios anteriores y la hipótesis de conversión 1–3% son antecedentes, no oferta ni benchmark. No mostrar USD 6,79 como precio anterior, descuentos ficticios ni urgencia inventada. No bloquear el lanzamiento por un dashboard sofisticado.

## Cierre

La evidencia local actual es `npm run test:player-tools` (cuatro verificadores y 29 tests del servicio) y `npm test` (48 verificadores). El registro de casos externos y los gates Live/Store/operación viven en [10](10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md). Este documento no se archiva mientras esas partes sigan pendientes.
