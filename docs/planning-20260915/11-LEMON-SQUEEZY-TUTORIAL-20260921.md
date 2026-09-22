# 11 — Lemon Squeezy: alta, cobro lifetime y operación

Fecha de consulta: 21/09/2026. Dependencias: [00](00-LEER-PRIMERO.md) y [10, especialmente C2–C5](10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md). Fuentes: documentación oficial consultada mediante Context7 y web. Antes de ejecutar, verificar cambios de interfaz/API/comisiones en documentación actual.

## Qué estamos construyendo

El comprador paga una vez en el checkout alojado de Lemon. Lemon genera una licencia sin vencimiento y notifica al Worker mediante webhook. El comprador introduce email y clave en Activar/Restaurar de la extensión; nuestro servidor valida la compra y habilita PRO en esa instalación. Reinstalar o cambiar de equipo debe ofrecer restauración conforme al límite acordado.

```text
Extensión: Comprar PRO → Worker: crear checkout → Checkout Lemon → Pago
                                                                 ↓
                                               Webhook firmado → Worker → D1

Recibo con licencia → Extensión: Activar/Restaurar → Worker ↔ API de licencias
                                                       ↓
                                          Comprobante PRO → Extensión

Reembolso/cambio de licencia → Worker + conciliación → Revocación al revalidar
```

Webhook significa aviso de servidor a servidor. No reemplaza la vinculación con la instalación. La URL de éxito sólo informa y orienta; no concede PRO. La activación automática sin introducir clave no está implementada ni forma parte del flujo comprometido para esta primera versión.

El Worker existente tiene el fallo de activación y las brechas del plan 10: corregirlos antes de permitir cobro al público. La firma del webhook existente tampoco equivale a la firma del comprobante offline, pendiente en C3.

## 1. Crear tienda y solicitar aprobación

1. Crear cuenta/tienda en [Lemon Squeezy](https://app.lemonsqueezy.com/). La tienda empieza en Test Mode.
2. Preparar nombre comercial, landing, descripción del producto real, soporte, términos, privacidad y política de reembolso coherentes con lo vendido.
3. Desde **Activate your store**, completar cuestionario del negocio/clientes y verificación de identidad. Explicar la extensión completa, incluidas descargas gratuitas y herramientas pagas; el plan del repo exige aprobación del producto real.
4. Guardar estado y respuesta de aprobación sin exponer documentación de identidad. La documentación indica plazos típicos de 2–3 días hábiles; no prometer una fecha.

El usuario realiza identidad/datos privados de cuenta; el agente puede preparar textos/configuración y continuar código mientras llega la aprobación. No contactar al proveedor en nombre del usuario sin autorización aplicable.

Fuente: [activar tienda](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store).

## 2. Configurar el retiro del dinero

1. Abrir **Settings → Payout** y vincular cuenta bancaria o PayPal de titularidad válida para la cuenta.
2. Argentina aparece en la lista oficial de retiros bancarios. Confirmar que el onboarding admite la cuenta específica; no inferir que cualquier cuenta Wise sirve.
3. Completar verificación solicitada y formulario fiscal correspondiente. Para vendedores no estadounidenses Lemon exige W-8; registrar el estado de aceptación, no copiar datos fiscales al repo.
4. Confirmar método, moneda y comisiones mostradas para la cuenta. El cobro del comprador y el payout al vendedor son etapas diferentes.

Fuentes: [países admitidos](https://docs.lemonsqueezy.com/help/getting-started/supported-countries), [retiros](https://docs.lemonsqueezy.com/help/getting-started/getting-paid), [W-8/W-9](https://docs.lemonsqueezy.com/help/tax-forms/w8-w9-forms).

Condiciones consultadas: mínimo de payout USD 50; ciclos dos veces al mes y retención de trece días antes de elegibilidad. El calendario documenta creación los días 1/15 y disponibilidad de pago 14/28; transferencia bancaria puede tardar 1–5 días. Confirmar calendario efectivo en la cuenta. Configurar el retiro no demuestra que haya llegado un payout: registrar ese hito cuando haya saldo suficiente.

La referencia de comisión base es 5% + USD 0,50. Ejemplo aritmético sin impuestos ni extras: `3,69 - (3,69 × 0,05 + 0,50) = 3,0055`, aproximadamente USD 3,01. Hay recargos por transacciones internacionales/PayPal y gastos de retiro según región/método. Conservar USD 3,69 como oferta actual; no cambiar precio por este ejemplo. Fuente: [comisiones](https://docs.lemonsqueezy.com/help/getting-started/fees).

## 3. Crear producto de prueba

Con Test Mode visible en el dashboard, crear/publicar producto de prueba:

| Configuración | Valor objetivo |
| --- | --- |
| Nombre | Player Tools PRO — Lifetime |
| Modelo | Single payment / pago único |
| Moneda y precio | USD 3,69 |
| Generate License Keys | Activado |
| License length | Sin vencimiento/unlimited; verificar `expires_at: null` en la licencia emitida. |
| Activation limit | Valor acordado en C2; no confundir duración ilimitada con instalaciones ilimitadas. |
| Confirmación/recibo | Instrucciones para volver a la extensión y usar Activar/Restaurar con el email de compra y la clave. |

Lemon muestra la clave en el recibo y en My Orders. No incluirla en analytics, URLs de tracking o logs. El trial de siete días lo administra la extensión: no convertir este producto en suscripción con trial de cobro.

Verificar que descripción y precio coinciden con `OFFER` en `scripts/player-tools-commerce.js`. La referencia USD 6,79 no debe presentarse como precio anterior efectivamente cobrado si no lo fue.

Fuentes: [licencias](https://docs.lemonsqueezy.com/help/licensing/generating-license-keys), [atributos de variante](https://docs.lemonsqueezy.com/api/variants).

## 4. Preparar Cloudflare sin secretos en el repo

Responsabilidad técnica del agente, una vez corregido C3:

1. Revisar `services/player-tools-license/wrangler.example.jsonc`, migraciones y contrato del cliente. Preparar configuración específica de prueba y de producción, sin copiar credenciales al archivo.
2. Crear/vincular D1 con binding `LICENSE_DB`; aplicar migraciones al entorno correspondiente. Mantener feedback/uninstall separado de licencias.
3. Obtener Store ID, Product ID y Variant ID del producto correcto. Son identificadores de configuración, no credenciales.
4. En Settings de Lemon crear API key de prueba, con nombre reconocible; guardarla de inmediato, pues sólo se muestra una vez. Instalar como secreto `LEMON_API_KEY` del Worker de prueba.
5. Generar secreto aleatorio de webhook y guardarlo como `LEMON_WEBHOOK_SECRET`. Ese mismo valor se configura en Lemon.
6. Configurar la clave privada de firma de comprobantes introducida por C3 y publicar únicamente la clave pública correspondiente al cliente. No inventar un nombre de secreto antes de acordar el contrato implementado.
7. Configurar orígenes permitidos; desarrollo puede requerir un ID de extensión distinto al publicado. Live debe excluir localhost y orígenes innecesarios.
8. Validar configuración/migraciones y dry run antes de desplegar. Usar Context7 para comandos actuales de Cloudflare/Wrangler; el README del servicio contiene comandos de referencia, no prueba de que se hayan ejecutado.
9. Comprobar `GET /api/player-tools/health`. `ready` sólo comprueba presencia de configuración: también hay que verificar acceso a D1 y comunicación real con Lemon mediante el flujo completo.

Preparar material revisable antes de pedir cualquier permiso externo que falte. No pegar secretos en comandos registrados, conversación o documentos; usar entrada interactiva/gestión de secretos del proveedor.

Fuente: [API keys](https://docs.lemonsqueezy.com/guides/developer-guide/getting-started). Guía local: [README del servicio](../../services/player-tools-license/README.md).

## 5. Registrar webhook de prueba

1. En la configuración de Webhooks de Lemon, crear webhook en Test Mode.
2. Pegar la URL HTTPS del Worker de prueba realmente desplegado. La URL prevista por el repo para producción es:

   ```text
   https://sctd.vpugliese.online/api/player-tools/webhooks/lemon
   ```

   No asumir que esa ruta ya existe o que sirve como sandbox. Definir endpoint/entorno de prueba separado antes de usarlo.
3. Seleccionar `order_created` y `order_refunded`. Agregar `license_key_updated` una vez implementado y probado su handler/conciliación en C3. No seleccionar eventos esperando efectos que el código ignora.
4. Configurar el secreto de firma idéntico al instalado en ese Worker.
5. Simular eventos para diagnóstico y después realizar una compra completa. Comprobar firma inválida rechazada, entrega válida procesada una sola vez y estado coherente en D1.

Lemon envía `X-Signature`; nuestro servidor valida HMAC SHA-256 sobre bytes originales. Debe devolver 200 cuando el evento haya sido procesado o aceptado de manera durable y recuperable. La documentación indica tres reintentos adicionales, aproximadamente a 5/25/125 segundos: una recuperación fiable no puede depender de reintentos infinitos del proveedor.

Fuentes: [solicitudes webhook](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests), [firma](https://docs.lemonsqueezy.com/help/webhooks/signing-requests), [sincronización](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks).

## 6. Hacer compra de prueba y reconciliar

1. Confirmar Test Mode y producto publicado en ese modo. Abrir checkout desde el botón de la extensión, para probar también la correlación con instalación.
2. Usar tarjeta de prueba de la documentación oficial, fecha futura y CVC de prueba; no usar tarjeta real en Test Mode.
3. Confirmar pedido, webhook, licencia y registro de compra en D1. En test, los recibos llegan al propietario/equipo, aunque se haya escrito otro email de comprador: activar usando el email asociado al pedido, no inferirlo del destinatario del recibo.
4. Activar con email + clave y comprobar PRO efectivo en controles y exports. Cerrar/abrir popup y reiniciar worker.
5. Restaurar varias veces y desde solicitudes simultáneas: misma instalación/instancia, sin otra venta ni cupo adicional. Probar cambio de equipo según C2.
6. Probar cancelación, rechazo, webhook duplicado/atrasado, error de red y respuesta perdida. La URL de éxito por sí sola nunca concede acceso.
7. Reembolsar en sandbox y comprobar revocación al revalidar dentro del plazo definido; conservar preferencias y trial, y mantener descargas FREE.
8. Registrar la matriz completa de C4, incluidos producto/modo/origin/firma/email/clave incorrectos. Sólo cerrar cuando coincidan proveedor, D1 y extensión.

Fuentes: [Test Mode y tarjetas](https://docs.lemonsqueezy.com/help/getting-started/test-mode), [respuesta de activación](https://docs.lemonsqueezy.com/api/license-api/activate-license-key).

## 7. Pasar a producción y atender compradores

1. Confirmar aprobación de tienda, verificación y retiro; terminar C1–C4 antes de abrir cobro al público.
2. Copiar producto con **Copy to Live Mode** o crearlo en live. Los productos de prueba no se vuelven live automáticamente. Revisar precio, licencia, cupos y los IDs resultantes.
3. Instalar credenciales/secreto y configurar webhook live separados del sandbox; comprobar rutas y CORS. Rechazar eventos de test en producción aunque la firma sea válida.
4. Apuntar el candidato de extensión a producción; preparar una compra controlada permitida por el proveedor y contar con autorización para el gasto real. Verificar activación/restauración/reembolso y registrar evidencia sanitizada.
5. Ejecutar C6 sobre el ZIP exacto, publicar con autorización aplicable y seguir estado de revisión/ disponibilidad en Store.
6. Dejar soporte accesible: dónde encontrar licencia, cómo restaurar, qué hacer si se agotaron instalaciones y cómo solicitar reembolso. Una caída transitoria no debe obligar al comprador a pagar de nuevo.
7. Revisar ventas, activaciones, errores y reembolsos por versión; conciliar el primer payout cuando ocurra. Mantener un procedimiento para reprocesar/reconciliar webhooks fallidos.

Fuente: [paso a Live Mode](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store).

## Datos que deben quedar registrados para otra sesión

Mantener únicamente estado de aprobación, entorno, IDs no secretos de tienda/producto/variante, endpoint, nombre del binding/base, commit desplegado, eventos configurados, política de instalaciones/offline, pruebas realizadas y siguiente pendiente. Referenciar dónde se gestionan los secretos sin copiar valores. Si no se tiene acceso al dashboard, escribir «no verificado», nunca «configurado» por inferencia.
