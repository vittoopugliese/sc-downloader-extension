# Orientación del popup hacia reproducción

Consulta: 28 de septiembre de 2026. Alcance: políticas oficiales de Chrome Web Store; esta nota no evalúa el Google Doc ni certifica el comportamiento actual de la extensión.

## Hechos comprobados

- La tienda exige un propósito único, acotado y comprensible. Las funciones claramente independientes deben distribuirse como extensiones separadas. Esto no equivale a exigir un único botón o una única función. [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines).
- Título, descripción, capturas e información de publicación deben ser exactos, completos y actuales. Las declaraciones de privacidad deben coincidir con la política y con el comportamiento efectivo. [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements).
- No se permite engañar mediante la presentación ni incorporar funcionalidad no evidente que no sirva al propósito principal. [Program policies, Misleading or Unexpected Behavior](https://developer.chrome.com/docs/webstore/program-policies/policies).
- El acuerdo de desarrolladores prohíbe facilitar descargas no autorizadas de contenido en streaming, infringir propiedad intelectual y violar deliberadamente condiciones de terceros (apartado 4.4.1). Google puede revisar tanto el producto como su código (7.2). [Developer Agreement](https://developer.chrome.com/docs/webstore/program-policies/terms).
- No debe sugerirse autorización, producción o respaldo de SoundCloud si no existe, ni infringir marcas o derechos de terceros. [Impersonation & Intellectual Property](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property).

## Recomendación e inferencias

Convertir el popup en un reproductor útil es una dirección de producto razonable si la reproducción funciona de verdad. Una portada, metadatos, controles, progreso y volumen pueden estructurar su interfaz. Las descargas que continúen disponibles deben seguir siendo identificables en la interfaz y estar explicadas en la ficha y en el documento para revisión.

Es una inferencia de las políticas, no una aprobación de Google: reproducción y descargas autorizadas podrían presentarse como partes relacionadas de una experiencia musical acotada. Agregar un player no resuelve por sí mismo un problema de autorización de las descargas. Que otra extensión esté publicada tampoco demuestra que este producto vaya a ser aprobado.

Para el documento, describir por separado: propósito; funciones realmente implementadas; flujo reproducible para probar cada función; alcance y condiciones efectivas de descarga; permisos y datos usados; servicios externos; limitaciones. No afirmar que solo se descargan pistas autorizadas, que no se usan cookies o que todo es local sin verificarlo en el código y en ejecución.

La condición de pista pública o reproducible no demuestra, por sí sola, permiso para descargarla: esta es una inferencia práctica del requisito de autorización del acuerdo. La disponibilidad técnica de un archivo tampoco sustituye esa comprobación. Elegir una interfaz orientada a reproducción debe acompañar un cambio real de producto y documentación fiel, no depender de que los revisores no detecten las descargas.

## Contraste con la documentación del repositorio

[download-policy.md](./download-policy.md) documenta dos cuestiones distintas:

- **Elegibilidad:** el modo restringido exige `downloadable: true` y que `has_downloads_left` no sea `false`. Un flag remoto permite habilitar todas las pistas y el resultado irrestricto puede quedar cacheado siete días.
- **Vía de descarga:** incluso en modo restringido se conserva conversión de streams y fallback de original a stream. Seleccionar MP3 descarga el stream de una pista elegible; no obliga a obtener el archivo original habilitado por el artista.

Por tanto, comprobar elegibilidad no demuestra que todas las descargas usen el mecanismo oficial ni que la autorización abarque cualquier representación del audio. Esto identifica una diferencia técnica que el documento de revisión debe explicar; no establece un dictamen jurídico sobre cada pista. Tampoco puede describirse la restricción como permanente mientras exista la activación remota documentada. Esta observación se basa en la documentación local leída; no verifica el valor actual del servicio desplegado.
