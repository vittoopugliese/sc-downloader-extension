# Feedback de desinstalación

Worker privado para `POST /api/uninstall-feedback`. Almacena respuestas en D1, exige Turnstile, limita cinco envíos por IP/hora y elimina datos a los 180 días mediante cron. No expone una lista ni una API de lectura pública.

La suite local cubre validación, verificación humana rechazada, límite, inserción
idempotente y limpieza programada:

```powershell
npm run test:feedback
```

No envía datos reales ni necesita secretos para ejecutarse.

## Despliegue manual requerido

1. Crear D1 y copiar `wrangler.example.jsonc` a `wrangler.jsonc` con su ID real.
2. Configurar `TURNSTILE_SECRET` como Worker Secret y crear el widget para `sctd.vpugliese.online`.
3. Aplicar migraciones y desplegar el Worker en la ruta `sctd.vpugliese.online/api/uninstall-feedback`.
4. Probar `GET /health`, un envío real y la exportación privada de D1. Sólo entonces registrar la URL de desinstalación en la extensión.

No activar `setUninstallURL` con una URL provisional: sin el deploy verificado,
la extensión debe permanecer sin servicio de feedback externo.

Al superar ese smoke test, la URL que debe registrar el service worker es:

```text
https://sctd.vpugliese.online/?view=goodbye&locale=<chrome-ui-language>&version=<extension-version>
```

La landing muestra esta vista sólo con `view=goodbye`; una visita normal conserva la landing. El formulario no pone email ni otros datos personales en la URL.

No se guardan identificadores persistentes de instalación. `submission_id` existe únicamente para que un reintento del mismo formulario no duplique la respuesta.
