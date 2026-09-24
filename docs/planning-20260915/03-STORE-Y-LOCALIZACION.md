# 03 — Store y cinco idiomas

> **PARCIAL — revisión 24/09/2026 (`29d7946`).** Textos EN/RU/DE/PT-BR/ES preparados; no se demuestra su publicación ni capturas finales. EQ/export implementados localmente; comunicar según el candidato efectivamente distribuido. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Objetivo: mejorar comprensión y conversión del tráfico de búsqueda existente. No requiere un cambio de nombre ni esperar una feature nueva.

## Entregables

- [Cinco descripciones completas](09-DESCRIPCIONES-STORE-5-IDIOMAS.md), adaptadas desde `current_description.txt`.
- Cinco capturas descritas en [07](07-GUIONES-Y-CAPTURAS.md), con una idea por imagen.
- Registro de versión publicada, fecha, texto anterior/nuevo y métricas por idioma cuando estén disponibles.

Orden basado en los datos históricos del usuario: EN → RU → DE → PT-BR → ES. Localizar no significa restringir países de distribución. La región del usuario y el idioma de la ficha son dimensiones distintas.

## Antes de publicar

El texto original promete “Every full-track download feature is free”. Corregir la distinción: **descargas originales gratuitas; exportaciones transformadas y de loops Pro según la versión lanzada**. No presentar pitch independiente, EQ o FX exportados como existentes antes de validarlos.

Los borradores de 09 describen Downloader disponible y una explicación prudente de Player Tools. Para la versión comercial, agregar sólo los párrafos de funciones que efectivamente se publiquen. Likes Explorer está cerrado según el usuario, pero su disponibilidad en el paquete de Store debe comprobarse antes de anunciarlo. No confundir checkout local con producto desplegado.

Mantener `SoundCloud Track Downloader` como nombre. Apertura de descripción orientada a descargar Likes/playlists/tracks, seguida del valor adicional. El inglés ya tiene términos de búsqueda naturales; no repetir listas de keywords ni prometer 320 kbps o calidad lossless desde un stream.

## Tutorial para cargar los cinco idiomas

1. Comprobar que el ZIP candidato contiene `_locales/en`, `ru`, `de`, `pt_BR`, `es` con `messages.json` válidos y `default_locale` en el manifiesto. El checkout ya tiene esas carpetas; verificar también el paquete que se sube.
2. Entrar al Developer Dashboard de Chrome Web Store y seleccionar la extensión existente. Si faltan idiomas, subir primero un paquete que los incluya como borrador.
3. Abrir **Store listing**. En el selector de idioma superior elegir English y pegar su descripción larga de 09.
4. Repetir para ruso, alemán, portugués de Brasil y español. Guardar cada traducción. No crear cinco extensiones ni editar sólo la descripción corta del manifiesto.
5. En cada idioma añadir screenshots con textos traducidos y, cuando exista, el video promocional localizado. Revisar vista previa y consistencia de funciones/precio entre idiomas.
6. Guardar cambios, comprobar la versión candidata y enviarlos mediante el flujo de revisión/publicación que muestre el dashboard. Registrar fecha; verificar la ficha visible en cada locale cuando se publique.

La documentación oficial vincula las opciones de idioma a las carpetas `_locales`, admite descripción/screenshots/video por locale y no permite localizar las pequeñas tiles y marquee. Describe hasta cinco screenshots de 1280×800. [Guía oficial del formulario](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).

La traducción de título/descripcion corta de la extensión depende del manifiesto y mensajes, no de pegar otra descripción larga. No hace falta cambiar el nombre para completar este trabajo. Los campos y controles exactos del dashboard pueden evolucionar; verificar el borrador antes de enviar.

## Qué comunicar en imágenes

1. Likes a tu computadora: gratis. Ya hecha según la conversación; revisar que siga siendo fiel.
2. Player Tools: velocidad, tono ligado a velocidad/Keep Tone y loops. Etiquetar prueba/Pro conforme a release.
3. Likes Explorer: reencontrar música; sólo captura de la versión real existente.
4. Bulk en background: progreso y archivos guardados al navegar.
5. FX: sonido personalizado; EQ/export FX sólo cuando estén disponibles.

Evitar mezclar “Free” del downloader con export WAV/FX pagas. Mantener textos legibles a tamaño reducido. Google recomienda descripciones claras y capturas que representen la experiencia. [Buenas prácticas de listing](https://developer.chrome.com/docs/webstore/best-listing).

## Medición y criterio de éxito

Guardar baseline de 14 días si existe: visitas de ficha, instalaciones y desinstalaciones, por idioma/país cuando el dashboard permita. Comparar periodos equivalentes y anotar nuevos releases/campañas. No atribuir automáticamente una mejora a la traducción si también cambió el producto.

Indicador principal: installs / visitas comparables de ficha. Secundarios: instalaciones por mercado, retención y consultas por malentendidos Free/Pro. Objetivo inicial: mejorar claridad y detectar tendencia; no inventar un porcentaje garantizado de SEO.

Cierre: cinco textos guardados y revisados, imágenes concordantes, ninguna promesa futura presentada como actual y tutorial listo. Publicar en CWS es una etapa posterior a la documentación.
