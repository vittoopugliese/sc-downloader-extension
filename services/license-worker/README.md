# Licencias de Looper — servicio Cloudflare

Este directorio es el inicio privado de E5B. No forma parte de la extensión y `npm run package:extension` nunca lo copia al ZIP de Chrome.

## Límite del módulo

La extensión sólo conoce este contrato: restaurar/refrescar una licencia y recibir un entitlement firmado con las capacidades `looper` y `loop_export`. El Worker es la autoridad que oculta D1, los secretos, el proveedor de pago y los eventos de webhook.

```text
extension ── contrato de licencia ──> Worker / D1 ── adapter ──> checkout + webhooks
```

El adapter inicial se diseñará para Lemon Squeezy exclusivamente en Test Mode y sólo tras obtener por escrito la aprobación del producto. `contract.mjs` no conoce a ningún proveedor: ese es el seam que evita que la UI, el motor de audio y el pago queden acoplados.

## Estado actual

- `src/contract.mjs`: datos y validaciones puras, testeables sin Cloudflare ni secretos.
- `migrations/0001_license_schema.sql`: modelo D1 sin email, key, ID de instalación ni payload de webhook en texto plano.
- `wrangler.example.jsonc`: plantilla intencionalmente no desplegable; se completa sólo después de crear D1 y configurar el proyecto Cloudflare.
- No hay checkout, endpoint público, proveedor, clave privada ni credencial de producción.

## Próximos pasos de E5B

1. El titular crea Lemon Squeezy únicamente en Test Mode y pide la aprobación explícita del producto real.
2. Crear D1 y copiar `wrangler.example.jsonc` a `wrangler.jsonc`, con el ID real de la base. Mantener `LEMON_*`, `ENTITLEMENT_*` y alertas como Worker Secrets, nunca en este archivo ni Git.
3. Implementar el adapter, el webhook HMAC idempotente y los endpoints de restore/refresh; probar compra, cancelación, evento repetido, reembolso y revocación.
4. Desplegar por separado de Pages. La URL de la API se permitirá explícitamente en `host_permissions` sólo cuando el endpoint esté funcionando. El ZIP de la extensión no cambia para contener el backend.

Para ejecutar las pruebas puras actuales:

```powershell
npm run test:license
```
