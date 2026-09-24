# Cobro con tarjeta para Looper: investigación de E5A

> **INVESTIGACIÓN HISTÓRICA — revisión 24/09/2026 (`29d7946`).** Lemon está integrado; compra, activación automática de PRO y salida del trial test están confirmadas. Restore, perfiles adicionales y refund/revocación no fueron probados. Ya no falta construir E5B desde cero. Aprobación live/payout no se infieren de test. Conservar fuentes fechadas, sin abrir una migración de proveedor. Estado y pendientes: [registro vigente](ESTADO-ACTUAL-20260924.md).

## Contenido histórico de la base indicada

Consultado el 2026-09-07. Alcance: una persona física residente en Argentina, sin LLC, que quiere vender una licencia única de Looper por USD 2,99 con tarjeta y ya posee datos bancarios USD de Wise. Este documento es una investigación de producto/técnica, no asesoramiento legal, fiscal ni una aprobación de ningún procesador.

## Decisión recomendada

**Usar Lemon Squeezy como candidato de E5B, pero sólo después de obtener su aprobación expresa y veraz del producto concreto.** Es el candidato con la combinación mejor documentada de: alta de persona no estadounidense, payout para Argentina, checkout de tarjeta, Merchant of Record (MoR), webhooks firmados y licencias. No requiere que el autor cree una LLC estadounidense.

Esto no autoriza a activar ventas. La extensión es un downloader de SoundCloud y Looper puede exportar un rango de audio de esa plataforma. La política de Lemon Squeezy prohíbe productos para los que el vendedor no tenga derechos suficientes, además de las categorías vetadas por sus procesadores; su propia documentación pide contactar a soporte antes de vender si hay dudas. Por eso hay que describir a Lemon Squeezy con precisión qué hace el producto, a qué contenido se aplica y qué derechos/autorización se exige al usuario. Nunca ocultar el downloader ni presentar Looper como otra categoría para sortear la revisión. [Productos prohibidos de Lemon Squeezy](https://docs.lemonsqueezy.com/help/getting-started/prohibited-products)

Mientras esa aprobación no exista, se puede construir y probar la integración en modo de prueba, pero no publicar checkout real, no activar una licencia paga y no afirmar que el proveedor aceptó el producto.

## Qué significa tener Wise USD

La cuenta/datos USD de Wise sirven potencialmente **como destino de un payout**, no como prueba de residencia comercial estadounidense ni como forma de abrir Stripe Payments desde Argentina. Wise dice que se puede asociar una cuenta Wise a un dashboard de Stripe ya elegible y recibir USD mediante sus datos correspondientes; esto presupone una cuenta Stripe válida. [Wise: recibir de Stripe](https://wise.com/help/articles/2977935/how-do-i-receive-money-from-stripe-with-wise) Stripe no incluye Argentina en su lista de países/regiones donde Payments está disponible; su página aclara que Payments no está soportado fuera de la lista. [Disponibilidad global de Stripe](https://stripe.com/global)

Wise ofrece datos para recibir USD por ACH/wire y SWIFT, pero otros bancos/intermediarios pueden aplicar cargos; sólo recibe USD por esos datos. [Wise: datos USD](https://wise.com/help/articles/2827506/how-do-i-receive-money-with-my-usd-account-details)

Conclusión: no crear una cuenta Stripe de otro país ni declarar una residencia/entidad falsa. Wise **no cambia** la elegibilidad de Stripe. Para Lemon Squeezy, Wise aparece explícitamente como opción de payout en su documentación fiscal, pero hay que comprobar que el onboarding acepte los datos concretos antes de comprometerse a depender de ella. [Formularios fiscales de Lemon Squeezy](https://docs.lemonsqueezy.com/help/tax-forms)

## Evaluación de proveedores

| Opción | Persona argentina sin LLC / cobro | Tarjetas y operación | Licencia / webhooks | Veredicto |
| --- | --- | --- | --- | --- |
| **Lemon Squeezy** | Argentina figura para payout bancario. Los individuos no estadounidenses completan un W-8; no hay requisito publicado de LLC. Payouts bancarios en USD, mínimo USD 50. | MoR; tarjetas Visa, Mastercard, AmEx, Discover, Diners, JCB y UnionPay, más métodos locales según comprador. | Licencias nativas con límite de activaciones y API; webhooks con firma. | **Primera opción condicional**, pendiente de aprobación del caso de uso y de aceptar Wise. |
| **Stripe directo** | Argentina no está en su disponibilidad de Payments. Wise es sólo posible cuenta de payout de una cuenta Stripe que ya sea válida. | Checkout técnico excelente, pero no resuelve elegibilidad. | Webhooks/Checkout sólidos, pero no corresponde abrirlo desde Argentina con datos ficticios. | **Descartado hoy.** |
| **Dodo Payments** | Documenta cuenta `Individual`, KYC con ID argentino y payout a banco; no exige empresa registrada. | MoR y tarjetas. | Webhooks/licencias nativos. | **Descartado por política:** prohíbe descargas de medios no autorizadas y herramientas que den acceso a streaming de terceros. |
| **Paddle** | Admite verificación como individual, pero no se confirmó en documentación pública el alta/payout de un vendedor argentino ni Wise. | MoR y checkout. | API/webhooks. | **Descartado por política:** enumera literalmente `streaming downloaders` como prohibido. |
| **Gumroad** | Permite payout en Argentina, pero en ARS a banco local. Rechaza expresamente Wise/TransferWise como método de payout. | MoR y acepta tarjetas. | API/Ping y licencia disponibles, pero el webhook Ping no ofrece en sus docs el mismo contrato de firma que Lemon. | **Plan B sólo si se acepta banco argentino/ARS** y la revisión de producto lo permite. |
| **PayPro Global** | Tiene MoR, checkout, webhook y soporte de licencia, pero la documentación pública revisada no confirma alta de individuo argentino ni Wise. | Más de 70 métodos declarados. | Webhook `OrderCharged` y generador de licencia externo. | **Sólo consulta comercial; no elegir ni construir contra esto aún.** |

### Evidencia principal

- Lemon Squeezy lista Argentina para payouts bancarios; sus pagos se crean dos veces al mes y requieren saldo mínimo de USD 50. [Países admitidos](https://docs.lemonsqueezy.com/help/getting-started/supported-countries), [cómo paga](https://docs.lemonsqueezy.com/help/getting-started/getting-paid)
- Lemon Squeezy exige W-8 a individuos y entidades no estadounidenses; esa es evidencia directa de que el modelo contempla una persona física fuera de EE.UU. [Formularios fiscales](https://docs.lemonsqueezy.com/help/tax-forms)
- Su checkout alojado acepta tarjetas internacionales y muestra los métodos disponibles según comprador. [Métodos de pago](https://docs.lemonsqueezy.com/help/checkout/payment-methods)
- Como MoR, Lemon Squeezy asume cobro de impuesto de venta, reembolsos, contracargos y cumplimiento PCI de la transacción. Esto **no** elimina las obligaciones argentinas sobre el ingreso que recibe el autor. [Qué es MoR](https://docs.lemonsqueezy.com/help/payments/merchant-of-record), [impuesto sobre ventas/VAT](https://docs.lemonsqueezy.com/help/payments/sales-tax-vat)
- Dodo admite formalmente una cuenta individual y Argentina en la lista de IDs/KYC aceptados, pero su política prohíbe expresamente `unauthorized media downloads` y herramientas que provean acceso a contenido de streaming de terceros. [Verificación de Dodo](https://docs.dodopayments.com/miscellaneous/verification-process), [países aceptados](https://docs.dodopayments.com/miscellaneous/accepted-countries-and-territories), [política de aceptación](https://docs.dodopayments.com/miscellaneous/merchant-acceptance)
- Paddle prohíbe expresamente los `streaming downloaders`. [AUP de Paddle](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)
- Gumroad separa el método de pago del cliente de su payout, acepta tarjetas, pero no admite Wise/TransferWise para pagar al creador y paga Argentina en ARS. [Payouts de Gumroad](https://gumroad.com/help/article/13-getting-paid.html), [pagos de clientes](https://gumroad.com/help/article/282-how-do-purchases-work-for-my-customers.html)
- PayPro Global documenta MoR, webhook de orden cobrada y generador de licencias, pero no evidencia suficiente para la elegibilidad concreta de este autor. [MoR](https://payproglobal.com/products/merchant-of-record/), [licencia y acceso posterior a compra](https://developers.payproglobal.com/docs/one-time-fee-product/licensing-and-post-purchase-product-accessing-options/)

## Economía conocida de Lemon Squeezy

La tarifa publicada es 5% + USD 0,50 sobre el total de la orden; suma 1,5% para pagos internacionales y otro 1,5% si usa PayPal. El payout bancario fuera de EE.UU. figura con 1% adicional. Para una venta de USD 2,99 sin impuestos: USD 2,3405 tras la tarifa base; aproximadamente USD 2,3171 tras el payout bancario de 1%. Una venta internacional con tarjeta reduce más el resultado. Son cálculos de tarifas publicadas, antes de impuestos, conversiones/cargos de Wise o bancos y reembolsos. [Tarifas de Lemon Squeezy](https://docs.lemonsqueezy.com/help/getting-started/fees)

No es compatible con conservar 95% de cada microventa. Lemon dice que puede cotizar precio personalizado para productos de menos de USD 10; pedirlo sólo después de la aprobación de producto. [Tarifas de Lemon Squeezy](https://docs.lemonsqueezy.com/help/getting-started/fees)

## Arquitectura correcta para E5B

El repositorio de la extensión debe seguir siendo distribuible como un ZIP MV3 autónomo. El ZIP no lleva `node_modules`, backend, tokens de API, secretos de webhook ni claves privadas.

```text
ZIP de la extensión (Chrome)              Cloudflare, fuera del ZIP
--------------------------------          ---------------------------------
UI Looper / restaurar licencia      -->   Worker: API de licencia
abre checkout alojado                -->   D1: entitlements + eventos recibidos
guarda sólo estado firmado/cache     <--   Worker valida/restaura licencia
                                           /webhooks/lemon: valida HMAC
                                           secretos: Worker Secrets, nunca Git
```

Flujo mínimo seguro para compra única:

1. La extensión abre el checkout alojado de Lemon Squeezy; no recoge ni ve datos de tarjeta.
2. El pago confirmado genera licencia. Lemon puede emitir una clave por compra y permite configurar expiración y límite de activaciones. [Licencias](https://docs.lemonsqueezy.com/help/licensing/generating-license-keys)
3. El usuario pega la clave y su email de compra en **Restaurar licencia**. La extensión manda esa solicitud al Worker; el Worker, no la extensión, llama a la API de Lemon y comprueba que store/product/variant sean exactamente los esperados antes de conceder el entitlement. La guía oficial requiere guardar el `instance.id` y validar periódicamente. [Validación de licencias](https://docs.lemonsqueezy.com/guides/tutorials/license-keys)
4. El Worker valida la firma del webhook sobre el cuerpo original, persiste `event_id`/orden de forma idempotente y concede/revoca el entitlement sólo por eventos válidos. Lemon reintenta una entrega fallida hasta tres veces y exige comprobar `X-Signature`; una URL de éxito del navegador **no** concede acceso. [Webhooks de Lemon Squeezy](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks)
5. La extensión recibe una concesión de corta vida firmada por el Worker y usa una gracia offline explícita; una licencia única no debe caducar sólo porque estaba sin red. El control es razonable, no DRM: el JavaScript instalado puede inspeccionarse o modificarse.

Lemon indica que las API keys no deben entrar en código de cliente ni en GitHub. Este límite también descarta hacer el backend dentro de la extensión. [Seguridad de API keys](https://docs.lemonsqueezy.com/api/getting-started/requests)

## Pasos manuales antes de activar dinero real

1. Crear store **sólo en Test Mode**; no publicar checkout. Lemon permite probar checkout, licencias y webhooks con tarjetas de prueba. [Modo de prueba](https://docs.lemonsqueezy.com/help/getting-started/test-mode)
2. Escribir a soporte/compliance con URL de la landing y una descripción completa: descarga de contenido de SoundCloud, alcance de Looper, export WAV, requisitos de derechos/autorización del usuario y cómo se manejan reclamos. Pedir confirmación escrita de que ese producto puede venderse. Si no aprueban, no buscar un proveedor "por detrás": rediseñar el producto para que no tenga ese riesgo o no cobrar con tarjeta.
3. Completar honestamente KYC, W-8 y la configuración de payout. Probar con Wise USD, pero preparar cuenta bancaria argentina/PayPal sólo si Lemon lo requiere y después de comprender la conversión/cargos.
4. Publicar antes de cobrar: términos de venta, política de reembolso, privacidad y soporte `it@vpugliese.online`; Chrome exige describir honestamente qué se vende, políticas de venta visibles y dejar claro que el vendedor es el desarrollador, no Google. [Política de pagos de Chrome Web Store](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment)
5. Recién tras aprobar producto y payout: habilitar Live Mode, ejecutar pruebas de compra, cancelación, webhook repetido, restauración, dispositivo adicional, devolución/revocación y caída de red.

## Cloudflare Email Sending (alcance limitado)

No reemplaza al procesador de pago. Sirve para alertas operativas del Worker (pago confirmado, webhook inválido, refund/revocación) hacia `it@vpugliese.online`. El servicio requiere DNS en Cloudflare y dar de alta el dominio emisor; el binding del Worker puede restringirse a un destinatario fijo. El envío saliente está actualmente en Workers Paid plan. [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), [configurar dominio y envío](https://developers.cloudflare.com/email-service/get-started/send-emails/), [restringir bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)

No usar correo como fuente de verdad de licencia: D1 + webhook validado son la fuente de verdad; el email es sólo una notificación.
