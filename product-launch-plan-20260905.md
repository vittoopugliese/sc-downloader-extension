# Plan de lanzamiento: ayuda, prueba de Looper, compra única y web

Fecha: 2026-09-05. Estado: borrador para responder decisiones; NO autoriza implementación ni despliegue.

Complementa `product-roadmap-20260905.md` y reemplaza sus propuestas de demo sin prueba, precio sin confirmar y cierre del export como próximo trabajo. Conserva los IDs P/A/M del roadmap para evitar dos listas inconexas.

## Base y decisiones confirmadas

- El usuario da por cerrado el export de loops. HEAD observado: `7acc576 fix descargas en looper`. No reabrir ese trabajo ni pitch/velocidad en este paquete.
- El working tree sigue activo: al cerrar la inspección hay cambios ajenos en `scripts/looper-core.js` y `scripts/verify-looper.js`. Preservarlos. Releer estado antes de implementar cualquier entrega.
- Tracks completos, playlists, likes, uploads de perfiles, player/inline, selección, formatos y carpetas siguen gratis, sin cuenta ni dependencia del servidor comercial.
- Looper será un extra de USD 2,99, compra única, con UNA exportación real gratis. La prueba no equivale a una animación ni a un enlace al checkout.
- Pendiente precisar si, agotada la prueba, se bloquean reproducción A–B y exportación o solamente nuevas exportaciones.
- El popup conserva sus controles actuales, jerarquía y centrado. No crear un segundo panel permanente de ajustes.
- Landing corta que explica el producto completo; reviews auténticas; feedback voluntario al desinstalar.
- Idioma de la interfaz según el navegador, no según la página de SoundCloud. Analytics de comportamiento después.

## Entregas implementables, en orden

Cada entrega termina con diff acotado, verificadores relevantes y prueba manual. No commitear cambios ajenos ni publicar automáticamente. Los tamaños son relativos, no estimaciones horarias.

### E1 — P02 + base de P09: ayuda y ajustes pequeños (M)

**Alcance:** `popup.html`, `scripts/popup.js`, mensajes locales y manifest si corresponde.

- Mantener barra de metadata/cantidad/calidad/carpeta; en selección conservar Back, opciones y All/Clear. No duplicar estos controles dentro de una nueva barra.
- Agregar acceso discreto a Ayuda en el pie centrado. Ayuda abre una vista interna breve y vuelve al estado anterior, sin perder selección, scroll, destino ni el job activo.
- Contenido: descargar desde popup/player; seleccionar playlist/perfil; elegir carpeta; significado de Auto/original/formatos; estado de tareas y errores; soporte y reseña; explicación de Looper. Sin prometer calidad original que el stream no tenga.
- Reutilizar controles existentes de carpeta. Propuesta de único ajuste nuevo: activar/desactivar notificaciones, si el usuario lo quiere. Licencia/restauración se incorporan en E6; no mostrar controles sin funcionalidad.
- Fuera de SoundCloud: explicación y enlace útil, sin promocionar el pago como arreglo de una página incompatible.
- Guía inicial descartable al abrir por primera vez; no abrir pestañas en cada actualización.
- Preparar `chrome.i18n`/`_locales`, fallback inglés. Propuesta: EN/ES/RU para las superficies nuevas, luego completar strings existentes en E7. Revisar traducciones rusas y longitud antes de publicarlas; pt-BR siguiente según demanda.

**Aceptación:** download continúa centrado y dominante; ayuda accesible por teclado en track/colección/selección/error; volver no reinicia descargas ni preferencias; sin recortes en textos largos o estados de progreso.

### E2 — P03: entrada comercial y estados de UI (S/M)

**Ubicación propuesta, pendiente de aprobación:** debajo de download y su cantidad/status, dentro del mismo ancho con márgenes laterales iguales. Nada en el espacio reservado para mensajes de error o progreso.

```text
             [ Download ]
           24 tracks selected
    Try Looper · 1 free export    [?]
```

El conjunto inferior se centra como grupo; el icono de ayuda no desplaza el centro del botón principal. En traducciones largas, envolver el texto sin ampliar el popup ni tapar la lista.

- Antes de probar: `Try Looper · 1 free export`.
- Prueba agotada: `Unlock Looper · $2.99 once`.
- Comprador: `Open Looper`, con restauración/estado en ayuda.
- Vista explicativa: `Loop a section. Download just that part.` + `One free loop export. Then $2.99, one-time. Full-track downloads stay free.`
- Mostrar precio y límite ANTES de iniciar la prueba. No abrir checkout automáticamente cuando termina la exportación gratis.
- Si no hay una página individual compatible, guiar a ella preservando intención. No insinuar que todo el listado se puede loopear simultáneamente.
- Durante construcción se prueban todos los estados, pero no se publica una oferta que no pueda cumplirse. Activación pública del CTA de prueba y compra junto con E5–E6.

**Aceptación:** CTA no roba foco ni ocupa el lugar de Download; textos localizados; pagados no ven promoción de compra; la acción gratuita nunca abre un paywall.

### E3 — P04/P07: landing completa y reseñas auténticas (M)

**Alcance:** `index.html`, datos de reviews versionados y pequeño importador local, sin dependencia en producción del Desktop del desarrollador.

- Mantener hero + UI representada. Añadir estado Looper a la demo sin convertir la landing en una página larga.
- Explicar en pocos bloques: tracks/colecciones/perfiles gratis; selección, carpeta, background y metadata; Looper A–B + export WAV, una prueba y USD 2,99 una vez.
- Reemplazar `All features are free` por una promesa específica sobre descargas completas. No prometer pitch, grabación en vivo, WAV que restaura calidad perdida ni loops sin cortes.
- Mostrar 3–4 reseñas curadas con autor, fecha y enlace al Store. La landing ya contiene una reseña real de Dimitri; ampliar esa base, no inventar prueba social.
- Importar `C:\Users\torib\Desktop\reviews.txt` como UTF-8, separar reseñas de respuestas del desarrollador, deduplicar y conservar texto original. Repetir importación cuando se agreguen reseñas y revisar diff antes de publicar.
- Dataset con autor, fecha, texto original, idioma, fuente y selección editorial. El texto copiado no siempre contiene estrellas: no inventarlas. Traducción etiquetada, con original disponible; no recortar una crítica de forma engañosa.
- Estas reseñas corresponden al downloader, NO a compras de Looper. No llamarlas compras verificadas. Cifras agregadas de usuarios/estrellas solo con fuente y fecha; instalaciones no equivalen a usuarios activos.
- FAQ breve: qué sigue gratis, una exportación de prueba, compra única, restaurar acceso y uso con contenido propio/autorizado. Privacidad y soporte accesibles sin agregar bloques comerciales extensos.

**Aceptación:** reseñas rastreables al archivo fuente, cirílico intacto, mobile/teclado correctos; la demo no descarga audio ajeno; no hay botones de compra activos antes del checkout listo.

### E4 — P04 ampliado: feedback de desinstalación (M)

- Preparar vista web `?view=goodbye`, por ejemplo en el dominio de `CNAME`, una vez verificado despliegue/HTTPS. Registro mediante `chrome.runtime.setUninstallURL` al instalar/actualizar, cubriendo instalaciones existentes.
- No se ejecuta código de la extensión después de borrarla: Chrome abre una URL registrada previamente. La página debe funcionar sola.
- Modal propuesto: `Sorry to see you go.` / `What could we do better?`.
- Motivos: downloads did not work, confusing to use, missing feature, pricing, no longer needed, other. Comentario opcional y email opcional solo si desea respuesta. No exigir datos para cerrar.
- Botón `Send feedback`, agradecimiento únicamente tras recepción confirmada; reintento si falla; Escape, foco y cierre accesibles.
- API/formulario con validación, límites de texto, control de abuso y salida segura. Destino pendiente: email o tabla privada exportable. No exponer comentarios ni datos de contacto en web pública.
- Query solo de ruta/idioma/versión cuando haga falta; nunca email, clave ni ID persistente de usuario. Un hit a esa URL NO prueba una desinstalación: puede ser una visita manual.
- Sin tracking de apertura del modal en esta fase. Documentar acceso web/logs operativos y retención, no prometer que no se transmite nada al abrir el sitio.
- Desinstalar no elimina una compra ni inicia un reembolso; la licencia se puede restaurar.

**Dependencia:** confirmar hosting y canal donde recibir feedback. Un HTML estático puede mostrar el modal, pero no guardar respuestas ni procesar pagos por sí solo.

**Aceptación:** desinstalar en Chrome real abre la vista correcta; una respuesta llega al destino; spam/reintentos no duplican sin límite; una visita normal conserva landing normal.

### E5 — P05: cobro y licencia recuperable (L)

Elegir proveedor después de responder país/entidad, cuentas, prioridad de comisiones y aceptación del producto. Ver `payment-options-20260905.md`; no integrar un procesador sobre supuestos de elegibilidad.

Flujo propuesto:

```text
Extensión/web → orden en backend → checkout alojado
→ confirmación autenticada → compra/licencia en DB
→ extensión obtiene comprobante firmado → habilita Looper
```

- Una compra única; sin suscripción ni renovaciones comerciales. Falta fijar impuestos/precio final, reembolsos, dispositivos y alcance de futuras actualizaciones.
- Backend pequeño: órdenes, compras, licencias y activaciones; feedback separado. Si se exige prueba por cuenta, también registro de prueba. No requiere una plataforma de analytics.
- El servidor determina importe/producto, verifica webhook o confirmación de red y procesa idempotentemente. Nunca confiar en `success=true`, precio enviado por cliente ni `paid: true` en storage.
- Compra desde extensión: asociar la orden mediante token temporal opaco de emparejamiento. Compra desde web: entrega de recuperación y posterior activación. No asumir que el comprador conserva el popup abierto.
- Volver a abrir popup consulta resultado; incluir `Restore purchase`/`Check purchase`. Si se añade comunicación web→extensión, limitar origen y aceptar solo solicitud de refresco, nunca una orden de dar acceso premium.
- Comprobante firmado verificable localmente; clave privada solo en servidor, clave pública en extensión. Caché minimiza consultas; propuesta a decidir: revalidación diaria cuando online y 30 días offline desde última validación. Expirar comprobante no equivale a expirar la compra.
- Restauración por email verificado/enlace de un uso o licencia con proceso seguro; secretos fuera de URLs persistentes/logs. Propuesta inicial a aprobar: 3 instalaciones activas y forma de reemplazar una anterior, sin fingerprint.
- Checkout cancelado/pago pendiente/reembolso/licencia revocada/servidor caído tienen mensajes distintos. No pedir recomprar por un simple fallo de verificación.
- Descargas gratuitas y audio permanecen locales: no enviar SoundCloud cookies, URLs firmadas ni archivos al sistema comercial.

**Aceptación:** checkout de pruebas, retorno sin popup, webhooks duplicados/falsos, compra desde web, restauración en otro perfil, offline y devolución. Nada premium público hasta superar estas pruebas y validar condiciones del proveedor.

### E6 — P06: una exportación gratis y acceso de pago (M/L)

El código actual permite contar éxito tras `saveOutput`: la ruta del navegador espera `chrome.downloads` en `complete` y la carpeta elegida espera el guardado. No hay todavía cuota ni licencia. Esto identifica el punto de integración, no certifica una prueba ya implementada.

- Estado de prueba: `available → reserved → consumed`; error/cancelación confirmados liberan reserva. No consumir al marcar A/B, reproducir, hacer click o empezar a decodificar.
- Reservar antes de exportar y serializar en background para que dos pestañas no obtengan dos exportaciones simultáneas. Persistir intento y reconciliar tras reinicio del service worker.
- Consumir solo después de guardado confirmado. Distinguir reintento del mismo intento de una nueva exportación; no redescargar por un timeout de confirmación comercial.
- Hay una ventana de fallo entre guardar un archivo local y registrar consumo. No existe transacción atómica archivo/servidor: diseñar recuperación e idempotencia y decidir trato de casos ambiguos, favoreciendo no quitar la prueba por un fallo técnico.
- **Opción A propuesta:** prueba local sin registro; compra/restauración con email. Menor fricción, pero reinstalación/otro perfil pueden resetearla: `storage.local` se elimina al desinstalar. No prometer una prueba por persona.
- **Opción B:** email verificado antes del primer export y registro servidor. Resiste reinstalación de la misma cuenta, agrega fricción y dependencia online; no impide múltiples emails. Sin fingerprint invasivo.
- Pendiente: después del primer éxito, bloquear nuevas activaciones A–B + export, o solo export. Si se bloquea todo, no cortar abruptamente el audio en reproducción: dejar cerrar la sesión actual y bloquear el siguiente uso/exportación.
- Capacidades comerciales centralizadas, separadas del motor de audio. Comprobar activación y `DOWNLOAD_LOOP` en background; no aceptar `trimRange` por comandos gratuitos como atajo de export premium. Bridge MAIN no decide la licencia.
- Protección proporcional a USD 2,99: código cliente inspeccionable, sin DRM invulnerable. Servidor asegura autenticidad de compras, no hace inmodificable una extensión local.

**Aceptación:** primer guardado consume exactamente una vez en el flujo normal; error/cancel no consumen; doble click/dos pestañas/reinicio/reintento no duplican concesiones; segundo export requiere compra; comprador exporta sin cuota; tracks/bulk siguen gratis incluso sin internet comercial.

### E7 — P08/P09: calidad gratuita y completar idiomas (M)

- Resumen de éxitos/fallos; reintentar solo tracks fallidos preservando orden, formato y destino, sin duplicar éxitos.
- Mostrar destino real. Para `chrome.downloads.show`, propagar ID guardado; con carpeta File System Access mostrar nombre/gestión disponible, no prometer abrir Explorer arbitrariamente.
- Completar traducciones de popup, looper, errores, ayuda, trial, compra y restauración. Browser locale con fallback inglés; en web usar locale del navegador, con inglés disponible. La vista goodbye tiene copy inglés pulido y puede reutilizar traducciones.
- Probar jobs con popup cerrado, carpeta revocada, nombres Unicode y límites de texto en ruso.

### E8 — A01/A02, P10–P12 y marketing: después

- Analytics separado: exposiciones/clicks CTA por superficie, aperturas popup, jobs y archivos guardados, trial iniciado/consumido, checkout/compra/activación. No confundir una playlist de 100 archivos con 100 usuarios.
- Conservar el ratio solicitado clicks CTA / (aperturas + jobs completados) como índice de actividad, no conversión de personas. Añadir CTR real clicks/exposiciones y compra/checkouts deduplicados.
- Definir consentimiento, minimización y retención antes de transmitir comportamiento. Recibos/licencias y feedback voluntario sí existen antes y no se presentan como analytics anónimo.
- Luego: historial local opcional para evitar duplicados y selección por rango (gratis), otros contextos por demanda; pitch/velocidad como trabajo separado, sin prometerlos en venta inicial.
- Mantener tareas manuales M01–M08 del roadmap: video de 60 s y corte Looper de 20 s, capturas de UI real, ficha/privacidad, respuestas a reviews y difusión. Guion muestra primero descargas gratuitas y después prueba/compra única; producir al estabilizar UI, no antes.

## Decisiones que faltan para cerrar el plan

Ya consultadas al usuario; no interpretar las opciones preseleccionadas como respuestas:

1. País/entidad de venta y cuentas habilitadas. Sin pedir credenciales.
2. Tras prueba: bloquear Looper entero o solo nuevas exportaciones.
3. Prueba local sin registro vs cuenta/email antes de exportar.
4. Prioridad: facilidad de compra con tarjeta o 95% neto estricto; USDT adicional o principal.
5. Hosting/backend/DB/email existentes. `CNAME` no demuestra despliegue ni backend.
6. Ubicación final del CTA/ayuda y nuevos ajustes realmente deseados.
7. Feedback a email vs tabla privada/CSV.
8. Si Looper ya llegó al Store o solo a testers; decidir transición antes de quitar acceso existente.

También decidir antes de E5: dispositivos (propuesta 3), recuperación, ventana offline (propuesta 30 días), actualizaciones incluidas, reembolsos, precio final o más impuestos, y qué significa 95% neto (wallet, banco, después de qué costos). Si USDT: redes admitidas y wallet/exchange de recepción, sin claves privadas. No hace falta resolver todo para implementar E1 después de aprobar el plan.

## Fuentes y límites de la investigación

- [Pagos y obligaciones de publicación del Chrome Web Store](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment).
- [Registro de URL de desinstalación](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-setUninstallURL).
- [Storage local y eliminación al desinstalar](https://developer.chrome.com/docs/extensions/reference/api/storage).
- [Localización de extensiones](https://developer.chrome.com/docs/extensions/reference/api/i18n).
- [Mensajes entre sitio y extensión](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
- Comparación económica y condiciones específicas: `payment-options-20260905.md`, con fuentes oficiales. Revalidar al contratar; no garantiza aprobación, cobertura mundial ni asesoramiento fiscal.

La investigación separada requerida por la skill permitió detectar comisiones fijas y restricciones de categoría/geografía antes de elegir proveedor. Solo se escribieron documentos de planificación/investigación; no se implementó ayuda, landing, feedback, checkout ni paywall en esta etapa.
