# 06 — Mejorar la landing existente para búsqueda

> **PARCIAL — revisión 24/09/2026 (`29d7946`).** SEO-0 de archivos CERRADO en `6fe3dca`: canonical/OG/robots/sitemap alineados y anclas retiradas. Verificación del sitio/Search Console, páginas por intención e idiomas indexables y medición siguen abiertos. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

Objetivo: captar búsquedas específicas con páginas que resuelvan una tarea y conduzcan a la extensión. La landing ya existe: mejorar `index.html`, no rehacer la marca o migrar de stack por defecto.

## SEO-0 — CERRADO en archivos; comprobar despliegue

`6fe3dca` corrigió canonical, Open Graph, guía, robots y sitemap a `sctd.vpugliese.online`, coherente con CNAME, y retiró las anclas del sitemap. La comprobación HTTP del 23/09 está registrada; no se repitió en esta revisión. Search Console y la observación posterior al despliegue siguen pendientes. Los criterios siguientes sirven para mantener esa coherencia, no para repetir un cambio ya aplicado.

Elegir como dominio canónico el efectivamente configurado y autorizado para el sitio. Alinear canonical, Open Graph, enlaces, sitemap, robots y propiedades verificadas. Redireccionar el alternativo si el hosting permite y corresponde; no cambiar DNS sólo porque un archivo difiere.

Sacar `/#features`, `/#reviews`, `/#faq` del sitemap como supuestas páginas independientes. Conservar anclas de navegación en la home. Sitemap con URLs finales absolutas y canónicas; `lastmod` refleja cambios reales. [Guía de sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## SEO-1 — Páginas por intención

Implementación sugerida para hosting estático: carpetas con `index.html`, URLs con slash final, si el servidor actual las soporta. Si requiere `.html`, usarlo consistentemente; probar navegación directa y refresh, no depender de rutas de SPA que devuelven 404.

| Ruta conceptual del texto original | Contenido propio | Demo |
| --- | --- | --- |
| `/` | Entrada a Downloader y herramientas adicionales; oferta clara | Resumen y enlaces |
| `/soundcloud-downloader` | Qué se puede descargar, formatos/fuentes y permisos | Track individual |
| `/download-soundcloud-likes` | Likes propios/ajenos compatibles, selección, carpeta y progreso | Bulk Likes |
| `/soundcloud-looper` | Definir A/B, ajustar y exportar; límites Free/Pro | Loop repetido |
| `/soundcloud-pitch-changer` | Qué hace Keep Tone y qué cambia al apagarlo | Comparación a misma velocidad |
| `/soundcloud-speed-controller` | Cambiar velocidad para escuchar/practicar, guardar valores | Slider y preset |
| `/soundcloud-slowed-reverb` | Escucha con reverb, parámetros y Pro según release | Antes/después audible |
| `/find-old-soundcloud-likes` | Explorer existente y flujo real de búsqueda por época | Galería real |

Home y `/soundcloud-downloader` pueden competir por la misma intención. Si no hay contenido sustancialmente diferente, usar home para esa búsqueda y redirigir la ruta equivalente; no producir dos copias. Mantener en el inventario el deseo original, sin inventar una página redundante para cumplir un número.

Primera tanda: Likes y looper; resto cuando haya material específico. La página de pitch no debe prometer transposición independiente si sólo hay pitch ligado a velocidad/Keep Tone. EQ merece página propia únicamente después de release y si hay intención diferenciada, no por completar una lista.

Por página: title/H1 únicos, explicación corta, pasos, captura real, clip breve, condiciones Free/Pro y CTA `Add to Chrome`; incluir FAQ específica y enlace a dos tareas relacionadas. No páginas clonadas cambiando una keyword.

## SEO-2 — Idiomas y descubrimiento

`scripts/landing-i18n.js` traduce contenido del sitio; el selector por sí solo no crea URLs indexables separadas. Mantenerlo mientras se desarrollan páginas EN; después elegir URLs estables por idioma sólo cuando exista contenido traducido completo.

Al publicar variantes: `lang` correcto, canonical propio por traducción y `hreflang` recíproco, incluyendo el propio idioma y `x-default` si corresponde. No canonicalizar todas las traducciones al inglés. No crear variantes vacías. [Documentación de versiones localizadas](https://developers.google.com/search/docs/specialty/international/localized-versions).

No redirigir obligatoriamente por idioma del navegador. Conservar enlaces rastreables para que usuario y buscador descubran las versiones.

## SEO-3 — Publicación y medición

Reutilizar componentes visuales existentes; HTML con contenido útil sin esperar interacciones. Assets optimizados, tamaño reservado para imágenes/video, poster ligero y video sin autoplay pesado. Datos estructurados sólo con información cierta; no copiar ratings/20K históricos como métricas actuales verificadas.

Actualizar mensajes de privacidad si se incorpora analytics. UTMs por página/video en enlaces de campaña; no garantizar atribución individual instalación→compra. Medir en Search Console impresiones, clics, consultas e indexación; en landing, clic al Store si se instrumenta; en CWS, visitas/installs cuando sean comparables.

Validación: `node scripts/verify-landing.js` y ampliar comprobaciones de URLs/meta/enlaces; revisar 200/redirect/404 del sitio desplegado, mobile, teclado, sin JS, canonical, sitemap y variantes de idioma. Solicitar indexación desde Search Console después de publicar páginas reales.

Cierre técnico: páginas accesibles y coherentes, sin duplicados vacíos ni claims adelantados. Evaluar búsquedas durante 4–8 semanas como ventana de observación sugerida; indexación y ranking no están garantizados ni dependen sólo del sitemap.
