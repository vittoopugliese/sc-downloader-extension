# Popup reproductor, modo cine y carta pública de reconsideración

Fecha: 28/09/2026. Investigación de fuentes primarias y del checkout local. Propuesta editorial; no se editó ni envió el documento externo.

## Documento efectivamente leído

Se leyó completo el [Google Doc público](https://docs.google.com/document/d/1Th7yi7TtsrfAuLwYa_gNw0jQHA4uacCu4e5rrheRO-4/edit?tab=t.0) mediante su exportación TXT. El lector web no pudo abrirlo; la lectura HTTP requirió ejecución autorizada fuera del entorno restringido. Es una carta de reconsideración por una denuncia de elusión del 23/09/2026, no una política de privacidad. No se obtuvo la denuncia original ni una respuesta de Google, y no se verificó la configuración remota de producción.

La carta tiene una base útil: explica el filtro de elegibilidad, declara que la configuración es remota, promete mantener la restricción y presenta Player Tools y Likes Explorer. También dedica bastante espacio a otros downloaders y a la autorización de la persona denunciante. El pedido final ofrece documentación y una demostración, pero no identifica un candidato exacto ni aporta resultados reproducibles.

## Orientación recomendada

Convertir el popup en una superficie de escucha real: portada, pista actual, controles y acceso al modo cine. Conservar una acción visible de descarga y sus condiciones. Así el producto deja de sentirse limitado a descargar gracias a funciones concretas y comprobables.

El [SoundCloud Player de referencia](https://chromewebstore.google.com/detail/soundcloud-player/oackhlcggjandamnkggpfhfjbnecefej) se presenta como un controlador no oficial en una ventana emergente. El [Aesthetic Player](https://chromewebstore.google.com/detail/soundcloud-aesthetic-play/kpnhiinnhghgjmcpfoinmcojpkdmggee) concentra su propuesta en abrir una vista de escucha desde la portada y cerrarla con Escape. Conviene adoptar esa claridad de interacción, sin copiar sus afirmaciones de privacidad ni dar por implementadas todas sus funciones.

Nombre de trabajo: **Player Tools for SoundCloud**. Propósito propuesto: **mejorar la escucha y el trabajo con pistas de SoundCloud mediante controles de reproducción, herramientas de audio, navegación de Likes y descarga de pistas elegibles**. Es una propuesta editorial; Google exige un propósito acotado y comprensible, y puede evaluar si estas funciones son suficientemente complementarias. [Directrices de calidad](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines).

La interfaz puede priorizar la escucha, pero la ficha, los permisos y la carta deben seguir explicando las descargas. Google exige representar directamente las funciones reales en títulos, descripciones y capturas. Agregar un reproductor no resuelve por sí solo el comportamiento señalado por una denuncia. [Comportamiento engañoso o inesperado](https://developer.chrome.com/docs/webstore/program-policies/unexpected-behavior).

## Cambios concretos a la carta

1. **Abrir con la corrección verificable.** Identificar ID, versión, archivo, hash y configuración revisada. Enlazar una demostración corta con una pista elegible, otra inelegible y una colección mixta.
2. **Describir el nuevo producto con evidencia.** Añadir popup y modo cine únicamente cuando estén incluidos en el paquete enviado y probados en SoundCloud. Mantener Tools y Explorer en un párrafo breve, con capturas.
3. **Precisar el alcance de la restricción.** Distinguir elegibilidad de pistas, origen del audio, exportación de loops y grabación. No afirmar que todo se descarga exclusivamente desde el endpoint del archivo original si el paquete conserva fallback a streams.
4. **Sacar las comparaciones del argumento principal.** La existencia de otros productos no demuestra que este candidato cumpla. Si se conserva una consulta sobre aplicación uniforme, moverla a un anexo de dos o tres líneas, sin acusaciones no documentadas.
5. **Separar la autorización del denunciante.** Pedir verificación procesal en una sola frase opcional. Un empleo público diferente no prueba falta de representación. Google enumera quién puede denunciar, pero esa página no determina la autorización en este caso. [Guía de Google sobre elusión](https://support.google.com/legal/answer/3463369?hl=en).
6. **Cerrar con una pregunta técnica precisa.** Solicitar qué comportamiento concreto del candidato sigue siendo objetable y qué evidencia falta para evaluar la corrección.

## Límites que el código obliga a reconocer

| Afirmación | Evidencia local y consecuencia editorial |
|---|---|
| Se filtran pistas no habilitadas para descargar | `originalAvailable()` comprueba `downloadable === true` y `hasDownloadsLeft !== false`; la enumeración masiva también filtra. Escribir que se excluyen valores explícitamente negativos; no presentar un valor desconocido como confirmación positiva. [download-source.js](../scripts/download-source.js) |
| La restricción se mantiene siempre | Hay un flag remoto `allDownloadsActivated`; `true` omite el filtro y se conserva hasta siete días. El estado restringido se conserva cinco minutos. Sin caché válida, los errores devuelven restringido. Mantenerla para uso público es un compromiso operativo, no una imposibilidad técnica de desactivarla. [download-policy.js](../scripts/download-policy.js) |
| Solo se guarda el original autorizado | El resolvedor puede usar transcodificaciones; incluso si intenta el original, conserva un fallback al stream. La restricción de metadatos no equivale a un flujo exclusivo por el endpoint original. [download-source.js](../scripts/download-source.js), [stream-selector.js](../scripts/stream-selector.js) |
| Todas las salidas de audio tienen el mismo filtro | `resolveForPlayback` omite esa política para renderizadores en memoria. El proyecto también ofrece exportaciones y grabación; hace falta evidencia específica de sus rutas antes de extender la afirmación del módulo de descarga a cualquier archivo generado. [download-source.js](../scripts/download-source.js), [README](../README.md) |
| No se usan cookies ni servicios externos | El worker lee `oauth_token` de SoundCloud como fallback y consulta la política remota de descarga. Existe infraestructura de licencia sobre Cloudflare y Lemon Squeezy, pero el candidato actual tiene `FREE_PRO_ENABLED=true`: el comercio está desactivado y las herramientas Pro son gratuitas. No presentar los flujos comerciales implementados como activos en este candidato, ni copiar la promesa de «nada sale del navegador» del competidor. [background.js](../scripts/background.js), [configuración efectiva](../scripts/release-config.js), [acceso efectivo](../scripts/player-tools-access.js), [servicio de licencia](../services/player-tools-license/README.md) |
| El nuevo aspecto ya está publicado | El checkout y la Store son estados distintos. La carta debe describir exactamente el candidato enviado; esta investigación no prueba publicación ni QA real del modo cine. [README](../README.md) |

Estas observaciones no determinan una conclusión jurídica ni predicen una decisión de Google. Señalan qué puede sostenerse con el material disponible. La política de privacidad deberá reflejar los datos y destinatarios efectivos si cambia el producto. [Política de privacidad de Chrome Web Store](https://developer.chrome.com/docs/webstore/program-policies/privacy).

También conviene reorientar `current_description.txt`, que abre casi exclusivamente con descargas. Su afirmación de gratuidad no contradice el acceso actual: `FREE_PRO_ENABLED=true` habilita gratuitamente las herramientas Pro y desactiva el comercio. El README conserva explicaciones del modelo comercial que no describen ese estado efectivo. La ficha final debe coincidir con la configuración del paquete enviado, sin anunciar barreras de pago que están desactivadas. [Descripción actual](../current_description.txt), [configuración efectiva](../scripts/release-config.js), [política de acceso](../scripts/player-tools-policy.js), [README](../README.md).

### Estado de la implementación local en esta tarea

El checkout incorpora un mini-reproductor de la pista actualmente en reproducción, con anterior, reproducir/pausar, siguiente y progreso de solo lectura. La portada abre el modo cine con fondo de carátula desenfocada; Escape y la cruz lo cierran. Todavía no se añadieron controles de volumen ni desplazamiento de reproducción desde esa barra de progreso. Esta implementación local no acredita publicación ni QA en SoundCloud real; la carta debe describir el candidato efectivamente enviado y su evidencia de prueba.

## Texto sugerido de reemplazo — inglés para el destinatario actual

**Borrador para completar con evidencia del candidato. No enviarlo con campos pendientes.** El párrafo de popup/cine es condicional hasta que figure en el paquete revisado. El compromiso de mantener restricciones reproduce la intención que ya expresa el documento público; no certifica la configuración remota.

> Request for reconsideration — extension ekmbbjdpakacalghjkikfppebgdpoebb
>
> Hello Google Legal / Chrome Web Store Review Team,
>
> I request review of the revised build of extension ekmbbjdpakacalghjkikfppebgdpoebb following the circumvention complaint dated September 23, 2026.
>
> **Build submitted for review:** [version, package filename and SHA-256]. **Configuration and demonstration:** [dated evidence link].
>
> **Download eligibility changes**
>
> The revised download module checks SoundCloud metadata. Under the restricted configuration, a track must be marked downloadable, and tracks explicitly reported as having no downloads remaining are excluded. Collection downloads apply the same eligibility filter when building the queue. The attached demonstration shows an eligible track, an ineligible track and a mixed collection, with expected and actual results.
>
> This is a track-eligibility restriction. Depending on the selected format and available source, the implementation may use a streamed transcode; it is not limited exclusively to the original-file download endpoint. I disclose this distinction so the behavior can be evaluated directly.
>
> The restriction is remotely configured and enforced by the extension. The current code can also accept an unrestricted setting and cache it for up to seven days. I am submitting the restricted configuration and commit to maintaining it for public use after reinstatement. [Attach evidence of the reviewed configuration and how previously cached settings are handled in this candidate.]
>
> **Product purpose and listening features**
>
> The product provides tools for listening to and working with SoundCloud tracks. Existing areas include Player Tools for looping, sample playback and audio controls, and Likes Explorer for navigating larger Likes collections. Downloads remain an explicitly disclosed feature, subject to the eligibility configuration described above.
>
> [Include only after candidate verification: The revised popup also provides controls for the currently playing track. Clicking its artwork opens a cinema listening view, with a hover hint explaining the action. Escape or the close button returns to the previous view. These controls operate the SoundCloud player.]
>
> These listening features do not grant rights to recordings and are not offered as a substitute for addressing the download complaint. [Attach a separate description of loop exports and recording, identifying which restrictions apply to each output route.]
>
> **Request**
>
> Please review this specific build and configuration. If a behavior remains unacceptable, please identify the affected action or output route and the additional change or evidence required for reconsideration.
>
> Thank you for reviewing the revised implementation.

Frase procesal opcional, separada del argumento técnico: “Separately, I respectfully request verification that the complainant was authorized to submit the notice under Google's circumvention reporting requirements.”

## Secuencia de evidencia antes de usar el borrador

- Fijar candidato, hash y configuración; demostrar qué sucede con una caché previa sin restricciones.
- Mostrar reproducción desde el popup y modo cine en SoundCloud real; verificar pista actual frente a la página navegada, Escape, cruz y foco de teclado.
- Mostrar descargas permitidas y rechazadas, colección mixta y formatos efectivos; describir por separado loops y grabación.
- Adjuntar capturas reales de ese mismo paquete y una descripción coherente con su configuración de acceso; en el candidato actual, las herramientas Pro son gratuitas y el comercio está desactivado.

No se modificó ningún flag remoto, política de descarga, nombre comercial ni documento externo como parte de esta investigación.

## Validación de la implementación local

- `npm.cmd test`: 59 verificaciones existentes aprobadas.
- `npm.cmd run test:e2e:listening`: aprobada sobre una página simulada; apertura por portada y teclado, Escape/cruz, conservación de reproducción, siguiente pista, reemplazo del player por navegación SPA, separación entre pista actual y destino de descarga, y alturas del popup.
- La comprobación visual existente del popup pasó a escalas 1, 1.25, 1.5 y 2; la prueba de carga de ofertas también pasó.
- `verify-popup-unsupported-page.js` falla esperando que se abra el panel Pro: su expectativa contradice el interruptor actual `FREE_PRO_ENABLED=true`, por el cual `openCommercePanel()` retorna sin abrirlo. No se cambiaron esas condiciones comerciales.
- Pendiente: reproducción y selectores contra SoundCloud real, incluida interacción con otras extensiones. No se generó ni publicó un candidato de Store.

Para probarlo manualmente: recargar la extensión y la pestaña de SoundCloud, iniciar una pista y tocar la portada de la barra inferior o la del bloque «Sonando ahora» del popup. El modo cine ocupa la pestaña y cierra con Escape o la cruz. No usa la API de pantalla completa del navegador.
