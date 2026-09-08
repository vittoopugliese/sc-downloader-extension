# Feedback de desinstalación

Worker privado para `POST /api/uninstall-feedback`. Almacena respuestas en D1, exige Turnstile, limita cinco envíos por IP/hora y elimina datos a los 180 días mediante cron. No expone una lista ni una API de lectura pública.

La suite local cubre validación, verificación humana rechazada, límite, inserción
idempotente y limpieza programada:

```powershell
npm run test:feedback
```

No envía datos reales ni necesita secretos para ejecutarse.

## Arquitectura publicada

La landing puede seguir en GitHub Pages. El Worker sólo toma las rutas bajo
`sctd.vpugliese.online/api/uninstall-feedback*`; `/`, imágenes y scripts siguen
siendo servidos por GitHub Pages. La llamada del formulario es same-origin, así
que no necesita CORS ni una migración de la página.

## Despliegue

Desde `services/uninstall-feedback`:

```powershell
npx wrangler@latest d1 create sctd-feedback
Copy-Item wrangler.example.jsonc wrangler.jsonc
# Copiar el database_id devuelto a wrangler.jsonc.
npx wrangler@latest d1 migrations apply sctd-feedback --remote
npx wrangler@latest secret put TURNSTILE_SECRET
npx wrangler@latest secret put RATE_LIMIT_SALT
npx wrangler@latest deploy
```

Antes de `deploy`, reemplazar `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID` y
`REPLACE_WITH_TURNSTILE_SITE_KEY` en `wrangler.jsonc`. Crear el widget Turnstile
en el dashboard con modo **Managed**, dominio permitido
`sctd.vpugliese.online` y acción `uninstall_feedback`; la site key es pública,
el secret siempre va con `wrangler secret put`.

Probar después del deploy:

```powershell
Invoke-RestMethod https://sctd.vpugliese.online/api/uninstall-feedback/health
Invoke-RestMethod https://sctd.vpugliese.online/api/uninstall-feedback/config
npx wrangler@latest d1 export sctd-feedback --remote --output feedback-schema.sql --no-data
```

El primer endpoint debe devolver `status: ready`; el segundo, la site key. El
formulario sólo acepta un envío real después de completar Turnstile.

La extensión de este repositorio ya registra, en cada instalación, actualización
e inicio del service worker, esta URL:

```text
https://sctd.vpugliese.online/?view=goodbye&locale=<chrome-ui-language>&version=<extension-version>
```

La landing muestra esta vista sólo con `view=goodbye`; una visita normal conserva la landing. El formulario no pone email ni otros datos personales en la URL.

No se guardan identificadores persistentes de instalación. `submission_id` existe únicamente para que un reintento del mismo formulario no duplique la respuesta.

## `it@vpugliese.online`

Ese correo no es necesario para que el formulario funcione: es sólo el canal de
soporte de la landing. Para activarlo en Cloudflare, abrir **Email > Email
Routing**, verificar una dirección de destino que controles, crear la ruta
`it@vpugliese.online` hacia ese destino y confirmar el correo de verificación.
No pongas una dirección de destino ni un secreto en el repositorio. Mientras no
lo configures, el formulario seguirá operativo y el fallback no promete ese
canal.
