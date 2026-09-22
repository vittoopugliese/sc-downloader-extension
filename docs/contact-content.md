# Contenido remoto de Contact

La extensión consulta `https://sctd.vpugliese.online/extension-content/contact.json` al entrar en **Help → Contact**. Primero muestra la última versión válida guardada en `chrome.storage.local`; después consulta el sitio. Si la consulta falla, conserva lo guardado. Un `enabled: false` válido se guarda y oculta el bloque incluso sin conexión en la siguiente apertura.

El bloque se muestra arriba de la card de contacto y del crédito. La extensión sólo interpreta los campos descritos aquí y nunca ejecuta código del JSON.

## Publicar un cambio

1. Editá [`extension-content/contact.json`](../extension-content/contact.json). Cambiá `revision` en cada publicación.
2. Si cambiás la imagen, agregá un archivo nuevo en `extension-content/images/` con nombre versionado, como `promo-v2.png`, y actualizá `image.url`. Conservá las imágenes anteriores para usuarios que todavía tengan el JSON viejo en caché.
3. Ejecutá `npm run test:contact-content`.
4. Hacé push a la rama de publicación. El check `Validate Contact content` verifica el contrato en cada push y pull request.
5. Verificá que `https://sctd.vpugliese.online/extension-content/contact.json` y la imagen respondan por HTTPS. Abrí Contact en una extensión con esta versión instalada para confirmar la nueva revisión.

El JSON admite `schemaVersion: 1`, `revision` (texto obligatorio), `enabled` (booleano) y, cuando está habilitado, `title` (texto obligatorio). `description`, `link: { label, url }` e `image: { url, alt }` son opcionales. El link exige HTTPS. La imagen debe estar en `https://sctd.vpugliese.online/extension-content/images/`. Los campos opcionales incompletos se omiten. El JSON no puede superar 16 KiB. La extensión limita la longitud de los textos y muestra todo como texto plano.

Para desactivar el bloque, publicá otro `revision` con `"enabled": false`; `title`, `description`, `link` e `image` pueden omitirse. Para volver a una publicación anterior, restaurá sus campos desde Git, asigná una revisión nueva y publicá de nuevo.

## Deploy

El sitio ya se publica como GitHub Pages con el `CNAME` `sctd.vpugliese.online`. `extension-content/` queda en la raíz publicada junto a la landing; al hacer push a la rama configurada como fuente de Pages, GitHub publica el JSON y las imágenes. Si se usa una fuente distinta en el futuro, incluí esa carpeta en su directorio publicado.

La extensión usa `cache: "no-cache"` al consultar el JSON y un timeout de cinco segundos. No hay polling: el siguiente ingreso a Contact consulta de nuevo. El contenido nuevo requiere que el usuario tenga instalada una versión de la extensión que incluya esta función; después no requiere actualizar la extensión.
