# Opciones de cobro para Looper — 2026-09-05

Investigación para planificación, consultada el 5 de septiembre de 2026. No se creó ninguna cuenta, checkout ni integración. Hipótesis: vendedor residente en Argentina, extra de software de USD 2,99, compra única; objetivo deseado de conservar al menos el 95% de las ventas. Residencia fiscal, entidad, cuenta bancaria y países compradores siguen pendientes de confirmar.

## Resultado que afecta el plan

Con las tarifas públicas verificadas, no hay una opción confirmada que combine USD 2,99 por licencia, tarjetas con poca fricción, vendedor argentino y 95% neto. Las comisiones fijas por venta impiden ese porcentaje incluso antes de retiros e impuestos. USDT podría reducir el costo porcentual, pero no elimina gas, mínimos, restricciones geográficas ni fricción del comprador. La aceptación del producto también requiere atención: Paddle menciona expresamente los streaming downloaders entre sus categorías prohibidas.

## Comparación de comisiones conocidas

Neto aquí significa precio menos comisión de procesamiento publicada. Excluye impuestos, reembolsos, contracargos, infraestructura, retiros, bancos y conversiones no indicadas. Cálculos aproximados antes del redondeo que aplique cada proveedor.

| Opción / escenario | Tarifa aplicada a una venta | Neto sobre USD 2,99 | Neto sobre 34 ventas: USD 101,66 bruto | Elegibilidad / lectura |
| --- | --- | ---: | ---: | --- |
| Stripe US, tarjeta doméstica | 2,9% + USD 0,30 | USD 2,6033 / 87,07% | USD 88,51 | Ejemplo condicional de cuenta estadounidense elegible; no tarifa argentina. |
| Stripe US, tarjeta internacional | 4,4% + USD 0,30 | USD 2,5584 / 85,57% | USD 86,99 | Si además requiere FX: USD 2,5285 por venta. |
| Lemon Squeezy, base | 5% + USD 0,50 | USD 2,3405 / 78,28% | USD 79,58 | Argentina aparece en países de payout; producto sujeto a aprobación. |
| Lemon Squeezy, compra internacional fuera de US | 6,5% + USD 0,50 | USD 2,2957 / 76,78% | USD 78,05 | Antes de comisión de payout argentino. |
| Paddle, base | 5% + USD 0,50 | USD 2,3405 / 78,28% | USD 79,58 | La AUP hace que no sea candidato predeterminado para esta extensión. |
| NOWPayments, misma criptomoneda | 1% + costos de red | USD 2,9601 menos red | USD 100,64 menos red | No equivale a 99% recibido final; cobertura geográfica pendiente. |

Tarifas base: [Stripe](https://stripe.com/pricing), [Lemon Squeezy](https://www.lemonsqueezy.com/pricing), [recargos de Lemon Squeezy](https://docs.lemonsqueezy.com/help/getting-started/fees), [Paddle](https://www.paddle.com/pricing), [NOWPayments](https://nowpayments.io/help/about-nowpayments/about/what-are-your-fees).

### Por qué cobrar USD 100 no equivale a vender USD 100

Modelo: `neto_por_venta = precio × (1 − porcentaje) − fijo`; para N ventas se cobra N veces el fijo. Una sola operación de USD 100 al 2,9% + 0,30 deja USD 96,80. Pero 34 licencias de USD 2,99 dejan aproximadamente USD 88,51 sobre USD 101,66. Agrupar el retiro bancario no agrupa los cobros al cliente ni elimina sus comisiones fijas.

Para conservar 95% con 2,9% + 0,30, el precio doméstico tendría que ser al menos `0,30 / (0,05 − 0,029) = USD 14,29`, sin otros costos. Una tarifa 5% + fijo positivo nunca llega a 95% a ningún precio finito. Son resultados matemáticos de las tarifas citadas, no propuestas de cambiar el precio acordado.

## Stripe

Argentina no figura en la [lista oficial de países con Stripe Payments](https://stripe.com/global). Recibir un payout de una plataforma que usa Stripe no significa poder abrir una cuenta comercial directa de Stripe en Argentina. Si ya existe una entidad legítima en un país admitido, habría que evaluar esa configuración; esta investigación no presupone ni propone crear una empresa extranjera.

El ejemplo US cobra +1,5% por tarjeta internacional y +1% si necesita conversión. Payout estándar elegible: sin cargo; instantáneo: 1,5%, mínimo USD 0,50. Eso no cubre traer dinero desde una cuenta exterior a Argentina. Banco, cambio y situación de la entidad determinan ese costo. [Tarifas US](https://stripe.com/pricing).

Su política prohíbe productos que infringen propiedad intelectual y trata ciertas actividades de intercambio de archivos como restringidas. No se encontró aprobación específica para esta extensión. [Negocios prohibidos/restringidos](https://stripe.com/legal/restricted-businesses).

## Lemon Squeezy

Permite payouts bancarios a Argentina; no acepta compras de clientes ubicados en Russian Federation. Idioma ruso no identifica país, por lo que no permite cuantificar cuántos usuarios quedarían sin compra. [Países soportados](https://docs.lemonsqueezy.com/help/getting-started/supported-countries).

Además de la tabla: +1,5% por PayPal. Payout bancario fuera de US: 1%; payout PayPal fuera de US: 3%, tope USD 30. El fee se calcula sobre el total de la orden, incluidos impuestos. Ofrece consultar precio personalizado para productos menores de USD 10, sin prometer aprobación ni tarifa. [Detalle de comisiones](https://docs.lemonsqueezy.com/help/getting-started/fees).

Ejemplo sin impuestos: los USD 78,05 del escenario internacional quedarían aproximadamente en USD 77,27 tras un payout bancario al 1%, antes del banco o FX. El umbral es USD 50; hay retención y calendario quincenal. Verificar moneda concreta de liquidación en onboarding: su página describe conversión y opciones de moneda; PayPal paga USD pero puede cobrar retiro/conversión después. [Getting Paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid).

Es merchant of record: puede encargarse del cobro y obligaciones de impuesto sobre la venta que asume como vendedor formal, no de todos los impuestos personales del desarrollador. [Servicio y precios](https://www.lemonsqueezy.com/pricing).

Admite software en general, pero prohíbe productos sin derechos apropiados y categorías restringidas por sus socios. Su documentación pide consultar soporte si hay dudas sobre el producto. La decisión de compra debe esperar aprobación explícita del caso real SoundCloud downloader/looper; no basta renombrarlo. [Productos prohibidos](https://docs.lemonsqueezy.com/help/getting-started/prohibited-products).

## Paddle

Su AUP, actualizada el 13 de abril de 2026, incluye literalmente “streaming downloaders” dentro de productos que infringen o habilitan infracción de derechos o términos de terceros. Esto es un impedimento específico para tomarlo como solución predeterminada del proyecto. [AUP oficial](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle).

La comparación económica se conserva como referencia: tarifa 5% + USD 0,50 y posibilidad de cotización para productos debajo de USD 10. Maneja impuestos sobre ventas como merchant of record. [Precios](https://www.paddle.com/pricing).

Argentina no figura en su lista de proveedores excluidos; Rusia sí está excluida y restringe compras de regiones no soportadas. [Países](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle). Payout mínimo USD 100, normalmente mensual. Transferencia/Payoneer; algunos destinos pueden generar USD 15 de SWIFT y cargos bancarios. Con solo 34 ventas al escenario base, el saldo neto USD 79,58 no alcanza el umbral. [Payouts](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid).

## USDT / NOWPayments

La información actual publica 1% para misma moneda y 1,5% para intercambio, tasa fija o fee pagado por el comprador. No usar el 0,5% histórico como tarifa estándar. En flujo no custodial, el cliente paga la transferencia de entrada y existen cargos de red en procesamiento/salida. Custodia cambia el recorrido de las transferencias pero no elimina todos los cargos. [Fees oficiales](https://nowpayments.io/help/about-nowpayments/about/what-are-your-fees).

Para conservar 95% con un servicio al 1%, todos los demás costos absorbidos por venta deben sumar como máximo USD 0,1196. Pasarle gas al comprador protege margen pero eleva su costo real de compra. Esto es aritmética, no garantía de una red o wallet concreta.

Los mínimos cambian según par y red. Antes de elegir USDT/TRON, Ethereum u otra red, obtener cotización y mínimo del par real y comprobar que USD 2,99 pueda cobrarse. [Mínimos](https://nowpayments.io/help/payments/common/what-is-the-minimum-payment-amount), [API oficial: endpoint min-amount](https://nowpayments.zendesk.com/hc/en-us/articles/21345824322717-API-and-endpoint-description). Sus materiales actuales indican retiros estándar sin comisión de servicio pero con red, y conversiones custodiales al 0,5%; faltaría sumar exchange/retiro final si el objetivo es USD bancarios o pesos. [Guía oficial de integración](https://nowpayments.io/blog/integration-guide).

Hay una restricción geográfica relevante: los términos que hoy enlaza el footer, actualizados el 31 de agosto de 2026, sección 15.1, excluyen residentes/ciudadanos de UE, Reino Unido, USA, UAE y personas ubicadas/residentes en Rusia. Argentina no aparece en esa cláusula; sigue sujeta a leyes y elegibilidad. El alcance operativo merchant/comprador requiere aclaración del proveedor antes de tratarlo como checkout mundial. También restringe usos que violan leyes o derechos de terceros. No ofrece una aprobación particular del downloader. [Términos vigentes enlazados por NOWPayments](https://nowpayments.io/doc/fd-tos.pdf?v=1.4.2).

Inferencia de producto: crypto-only introduce selección de red, wallet, gas y espera de confirmación, especialmente para quien no tiene USDT. No se midió conversión. No hay evidencia para prometer que conserva más ingresos totales que tarjetas: un porcentaje menor de comisión puede ir acompañado de menos compras.

## USDT directo a wallet, sin procesador

Es técnicamente factible recibir el token directamente y asociar el pago a una orden, usando una red/contrato oficial verificado. Tether publica los contratos y pautas por protocolo. [Integraciones oficiales de Tether](https://tether.to/en/supported-protocols/). Sin gateway no existe su comisión comercial, pero eso no demuestra 95% neto: siguen red, adquisición/retiro del comprador, posible consolidación de wallets, RPC/indexador y conversión/retiro del vendedor. Los mínimos concretos de las wallets/exchanges elegidas deben verificarse antes de prometer un checkout de USD 2,99.

Propuesta de alcance si se elige esta vía: backend crea orden y referencia inequívoca de pago; observa la red; verifica token, red, destinatario, importe y finalización; impide acreditar dos licencias por la misma transferencia; resuelve pagos tardíos/incompletos y devoluciones. No basta que alguien pegue un hash público: también hay que vincular de forma segura ese pago al comprador/orden. La estrategia podría usar una dirección por orden u otro mecanismo explícito de vinculación, con costos y custodia a evaluar.

Como ejemplo técnico EVM, recibos/logs se consultan por RPC y deben combinarse con una política de confirmación/finalidad. [JSON-RPC Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/), [finalidad](https://ethereum.org/developers/docs/consensus-mechanisms/pos/). Cada red exige su política. La wallet de cobro y sus claves privadas nunca van en la extensión. Esta vía agrega desarrollo y operación propios; no incorpora automáticamente merchant of record ni resuelve obligaciones o restricciones por usar crypto. Es una alternativa de arquitectura a evaluar, no una implementación ni promesa de menor costo total.

## Decisiones pendientes antes de implementar cobros

1. Confirmar residencia/entidad y cuentas de cobro existentes, sin compartir credenciales.
2. Decidir si 95% es requisito estricto o aspiración y si USD 2,99 será precio final al cliente o base antes de impuestos.
3. Confirmar si se aceptaría tarjeta como principal y crypto opcional, y en qué redes se desea recibir USDT.
4. Verificar aceptación del producto con el proveedor que se elija y pedir tarifa concreta de microtransacción, payout y moneda. No enviar solicitudes sin autorización del usuario.
5. Revisar países reales del dashboard para no confundir idioma de reviews con país comprador.
6. Definir reembolsos, recuperación de compra, cantidad de dispositivos y qué actualizaciones cubre la compra única; son decisiones de licencia independientes del procesador.

Se puede planificar la interfaz, prueba y contrato interno de licencias sin elegir aún proveedor. El diseño debería registrar una orden, aceptar una confirmación autenticada del proveedor y conceder acceso por esa orden; una URL de éxito por sí sola no debe marcar un usuario como pago. Este último párrafo es una propuesta de arquitectura, no una integración implementada.
