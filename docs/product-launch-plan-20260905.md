# Plan de lanzamiento: ayuda, prueba de Looper, compra única y web

Fecha inicial: 2026-09-05. Última consolidación: 2026-09-07.

Estado: fuente de verdad para retomar el trabajo en una sesión sin contexto. E1 y E2 están cerradas en código; E3 está parcialmente cerrada; E4 no se implementó ni desplegó. E5A/E5B se pueden preparar de forma privada, pero no habrá cobro, checkout público ni paywall hasta que esté terminado el producto v1. Esta sesión no autoriza publicación, creación de cuentas ni contacto con proveedores.

Este archivo es autocontenido y prevalece para el lanzamiento comercial. `product-roadmap-20260905.md`, `.cursor/plans/soundcloud_looper_v1.plan.md` y `payment-options-20260905.md` son antecedentes históricos; `payment-provider-research-20260907.md` es la evidencia comercial vigente de E5A. No hace falta leer los antecedentes para saber qué hacer. En particular, quedan superadas la propuesta de demo sin prueba, la duda sobre compra única y el cierre del export como siguiente tarea.

## Resultado buscado

Convertir la extensión actual en el mejor producto gratuito posible para descargar desde SoundCloud y vender solamente el extra creativo Looper:

- Todas las descargas de tracks completos y colecciones permanecen gratis.
- La prueba permite experimentar con un loop y completar una exportación WAV gratis. Inmediatamente después de ese guardado exitoso se bloquea Looper completo.
- Después se ofrece Looper por USD 2,99 para early users, compra única, con compra y restauración confiables. El precio podrá subir a USD 3,99 más adelante sin convertir compras anteriores en suscripciones.
- El popup conserva su simplicidad; la landing explica gratis + premium y usa reseñas reales.
- Al desinstalar se abre una encuesta web voluntaria.
- Analytics de comportamiento se implementa más adelante; pagos, licencias y feedback conservan solamente los datos operativos necesarios.

El producto NO se presenta como afiliado, aprobado o mantenido por SoundCloud. El copy debe orientar a descargar contenido propio o para el cual la persona tenga permiso. La publicación y cada proveedor externo se revisan contra sus políticas vigentes antes de activarse.

## Estado operativo y estrategia acordada (2026-09-07)

La estrategia cambió: primero se termina el producto v1; recién al final se activa el cobro y el acceso de pago. Esto no impide construir E5A/E5B en privado: permite dejar la integración lista, probada en sandbox y aislada, sin exponer un checkout ni limitar Looper hasta el gate final.

| Entrega | Estado actual | Pendiente concreto antes de release público |
| --- | --- | --- |
| E1 — Help/i18n | Cerrada en código y validada manualmente en Chrome el 2026-09-06. | Reemplazar el aviso temporal por `mailto:it@vpugliese.online` antes del release. Revisión visual final de locales largos queda dentro de la matriz de release. |
| E2 — vista visual de Looper | Cerrada en código: CTA, explicación con `promos/four.png`, estilo y Back existente; no hay trial, checkout ni cambio de acceso. | Smoke test final en Chrome de popup/selector después de los últimos ajustes de altura/estilo. |
| E3 — landing/reseñas | Cerrado: landing, 39 reseñas originales, tres iniciales, `Show all`, badges `ALREADY IMPLEMENTED`, CTA al Store y soporte en landing. | Localizar **todo** el copy de landing para EN/ES/RU/PT-BR/DE (hoy sólo el CTA de reseña tiene cobertura parcial) y revisar teclado/mobile con esos locales. No desplegarla hasta poder validar dominio/HTTPS. |
| E4 — feedback de desinstalación | Decisiones y arquitectura Cloudflare cerradas. | Crear la vista goodbye, Function, D1/migración, Turnstile, alertas, limpieza y pruebas; desplegar en `sctd.vpugliese.online`; recién entonces registrar `setUninstallURL` y probar una desinstalación real. |
| E5A — decisión comercial | En curso: candidato de tarjeta definido, pendiente de aprobación y onboarding. | Confirmar que Lemon Squeezy acepta **por escrito** el producto real; KYC/payout y sandbox. Resolver prueba, recuperación, reembolsos y gracia offline. |
| E5B — licencia/pago | En curso sólo como infraestructura privada. | Worker/D1, contrato de entitlement, checkout sandbox, webhook idempotente, restauración, firma y pruebas. Ningún secreto ni backend viaja en el ZIP. |
| E6 — trial/paywall | No iniciado deliberadamente. | Sólo después del gate de producto y E5B probado: aplicar límite de prueba y gate de Looper, sin tocar descargas completas. |
| E7 — calidad/reintentos/i18n comercial | No iniciado. | Resumen de resultados, retry de fallidas, destino real y todos los textos de E2–E6 localizados. Forma parte del “producto v1 terminado”. |
| E8 — analytics y backlog evolutivo | Diferido. | No bloquea v1 ni el primer cobro. P10–P12 (historial/rangos, nuevos contextos, pitch/velocidad) son mejoras futuras, no promesas de v1. |

**Gate “producto v1 terminado”:** E3 localizado y validado, E4 desplegado/probado, E7 terminado, regresiones de descarga/Looper en Chrome real y documentación/privacidad coherentes. En ese punto se podrá activar E6 sobre una E5B ya probada. E8 y las mejoras de backlog no retrasan indefinidamente el primer release comercial.

### Límite de paquetes y estructura futura

Mientras la extensión conserve sus fuentes en la raíz, `npm run package:extension` genera `dist/soundcloud-track-downloader-<versión>.zip` con una allow-list explícita. El ZIP deja `manifest.json` en su raíz e incluye sólo popup, offscreen, assets, locales y scripts de runtime; excluye `node_modules`, pruebas, herramientas, documentación, landing y cualquier servicio. Antes de subir, cargar ese ZIP descomprimido como extensión temporal y revisar que el manifest no muestre archivos faltantes.

No moveremos ahora las fuentes ya estables: sería un refactor transversal sin beneficio para el release actual. Al añadir los componentes externos, el destino será este monorepo, con límites de despliegue claros:

```text
extension/                 # futura raíz del ZIP MV3; nunca secretos ni node_modules
web/                       # Cloudflare Pages: landing y functions de feedback
services/license-worker/   # Cloudflare Worker + D1 para licencias/webhooks
scripts/                   # verificadores y empaquetado, nunca se sube al Store
dist/                      # ZIP generado e ignorado por Git
```

`web/` y `services/license-worker/` se despliegan a Cloudflare por separado; no se empaquetan para Chrome. Las claves de proveedor, el secreto HMAC de webhooks y la clave privada de los comprobantes viven como Worker Secrets, nunca en Git, `manifest.json`, storage de la extensión ni el ZIP. Esta separación es el seam: la extensión conoce un contrato de licencia pequeño y el Worker oculta D1, correos y el proveedor de pago detrás de un adapter.

## Arranque en frío: procedimiento obligatorio

1. Leer este archivo completo y registrar las respuestas nuevas del usuario en la tabla de decisiones. **Terminado:** todas las respuestas recibidas figuran como `cerrada`, sin inferir opciones que el usuario no eligió.
2. Ejecutar `git status --short`, `git log -3 --oneline` y revisar el diff de cada archivo modificado. El working tree puede cambiar entre sesiones. Tratar todo cambio previo como trabajo del usuario. **Terminado:** cada modificación existente tiene dueño supuesto y no se mezcla con la entrega nueva.
3. Inspeccionar los archivos indicados en el mapa de código para la entrega elegida. El código es la fuente del estado actual; hashes, líneas y snapshots de este documento son contexto histórico. **Terminado:** la implementación propuesta encaja con las interfaces actuales.
4. Trabajar una entrega E1–E8 por vez, comenzando por la primera no terminada. Crear verificadores junto a cambios de comportamiento. **Terminado:** criterios de aceptación de esa entrega cubiertos y regresiones relevantes ejecutadas.
5. Mostrar diff y resultados. Commitear únicamente los archivos de esa entrega si el usuario lo pide; nunca incluir archivos ajenos con `git add .`. Publicar/deployar solamente con autorización explícita. **Terminado:** handoff identifica archivos propios, pruebas y cualquier validación manual pendiente.

Snapshot al cerrar esta consolidación: rama `main`, HEAD `ad9f4d7 new images and readme`; estaban modificados `product-launch-plan-20260905.md`, `scripts/directory-storage.js`, `scripts/popup.js`, `scripts/verify-directory-storage.js` y `scripts/verify-popup-ux.js`. Solo el plan pertenece a esta tarea; los cuatro scripts son trabajo concurrente del usuario y se preservan. Este snapshot puede quedar viejo: siempre ejecutar el paso 2.

## Base y decisiones confirmadas

- Datos informados por el usuario: 21.270 instalaciones/usuarios mostrados por el dashboard y calificación 3,83 con 47 valoraciones. Son una foto declarada del panel, no una medición de usuarios activos ni conversión.
- Chrome Web Store ID: `ekmbbjdpakacalghjkikfppebgdpoebb`. Dominio previsto por `CNAME`: `sctd.vpugliese.online`; verificar DNS, HTTPS y deploy real antes de usarlo en producción.
- Tracks completos, playlists, likes, uploads de perfiles, player/inline, selección, formatos y carpetas siguen gratis, sin cuenta ni dependencia del servidor comercial.
- Looper será un extra de USD 2,99 para early users, compra única, con UNA exportación WAV real gratis. La prueba no equivale a una animación ni a un enlace al checkout.
- Después del primer loop WAV guardado correctamente se bloquea **todo Looper**: activación, repetición A–B y nuevas exportaciones. Usar el loop para escuchar varias veces una sección también es parte del valor premium.
- La compra desbloquea Looper completo sin cuota comercial de uso. Tracks completos y colecciones siguen gratis aunque nunca se compre.
- El popup conserva sus controles actuales, jerarquía y centrado. No crear un segundo panel permanente de ajustes.
- El CTA de Looper aparece a la derecha del Download tanto en la vista principal como en el selector. El botón Download conserva su centro geométrico; el CTA no lo empuja.
- Landing corta que explica el producto completo, contiene todas las reseñas originales disponibles y ofrece dejar una reseña en el Chrome Web Store.
- Feedback voluntario al desinstalar mediante la vista web `?view=goodbye`, confirmado como dirección de producto.
- Idioma de la interfaz según el navegador, no según la página de SoundCloud. Todo texto inglés actual se extrae y traduce; los copys quedan centralizados en archivos de locale, no dispersos en handlers. Analytics de comportamiento después.

### Lo que ya existe y no se vuelve a planificar

- Ingesta y descarga de tracks individuales, playlists y páginas `/user/tracks`; selección granular; botones del player e inline; jobs bulk en background; formatos, metadata, portada y carpeta elegida.
- Sanitización de nombres internacionales, incluido cirílico. Conservar sus regresiones.
- Looper A–B en páginas individuales y export del rango a WAV. El usuario dio por cerrado ese export; pitch y velocidad quedan para después.
- Landing estática `index.html`, ya con representación interactiva de track/playlist/profile. Hoy todavía contiene `All features are free`, texto que E3 debe corregir.
- `reviews.txt` externo contiene reseñas reales en inglés, portugués, ruso, alemán y otros idiomas, además de respuestas del desarrollador y comentarios negativos. Debe importarse como UTF-8; una lectura sin encoding correcto produce mojibake, no texto corrupto en origen.

### Mapa actual de código


| Responsabilidad           | Archivos principales                                                                                     | Regla para esta iniciativa                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Popup y selector          | `popup.html`, `scripts/popup.js`                                                                         | Conservar selección virtualizada, estado/scroll, controles movidos entre vista principal y selección, jobs y acción Download centrada |
| Entrada de páginas/player | `scripts/page-intake.js`, `scripts/content.js`, `scripts/inline-button.js`, `scripts/download-intent.js` | Todas las rutas de track completo son gratuitas                                                                                       |
| Router background         | `scripts/background.js`                                                                                  | Hoy enruta `START_BULK_JOB`, `DOWNLOAD_SINGLE_TRACK` y `DOWNLOAD_LOOP`; el gate premium se aplica solo a Looper/export                |
| Jobs y ejecución          | `scripts/bulk-job-manager.js`, `scripts/track-download-execution.js`                                     | `execute()` resuelve, construye y guarda; éxito se devuelve después de `saveOutput()`                                                 |
| Destinos                  | `scripts/download-destination.js`, `scripts/directory-storage.js`, `scripts/offscreen.js`                | Browser downloads espera estado `complete`; carpeta elegida espera respuesta exitosa del offscreen                                    |
| Looper                    | `scripts/looper-core.js`, `scripts/looper.js`, `scripts/looper-main-bridge.js`                           | Core/DOM/bridge separados; MAIN es entrada no confiable, nunca autoridad de licencia                                                  |
| Landing                   | `index.html`, `CNAME`, `assets/`                                                                         | Sitio estático actual; pago y feedback requieren endpoint externo                                                                     |
| Verificación              | `scripts/verify-*.js`                                                                                    | No hay runner de paquete: ejecutar con Node los verificadores dirigidos y, antes del release, todos los aplicables                    |


Verificadores mínimos por riesgo:

- Popup/ayuda/CTA: `verify-popup-ux.js`, `verify-directory-storage.js` y verificadores nuevos de estados/locales.
- Gate/trial/export: `verify-loop-click.js`, `verify-loop-download.js`, `verify-loop-background-routing.js`, `verify-track-download-execution.js`, `verify-download-destination.js`, más pruebas nuevas de entitlement y concurrencia.
- Regresión gratuita: `verify-download-intent.js`, `verify-player-download.js`, `verify-live-player-download.js`, `verify-profile-support.js`, `verify-bulk-job-state-machine.js`, `verify-background-progress.js`, `verify-filenames.js`.
- Looper: `verify-looper.js`, `verify-looper-playback.js`, `verify-looper-mount.js`, `verify-looper-main-bridge.js`.

Los verificadores actuales son mayormente mocks de Node. Antes de publicar hacen falta pruebas manuales en Chrome real: track, playlist, perfil, popup cerrado durante bulk, carpeta recordada/revocada, looper y WAV audible. No afirmar que pasar mocks certifica codecs, RAM o SoundCloud real.

### Estados de producto que toda superficie debe representar


| Estado                  | CTA                        | Looper/export                              | Descargas completas |
| ----------------------- | -------------------------- | ------------------------------------------ | ------------------- |
| `trial_available`       | Try Looper                 | Probar A–B y guardar un WAV gratis         | Gratis              |
| `trial_reserved`        | Exporting free loop…       | Evitar una segunda exportación concurrente | Gratis              |
| `trial_consumed`        | Unlock Looper · $2.99 once | Looper A–B y exportación bloqueados        | Gratis              |
| `purchase_pending`      | Checking payment…          | No conceder por la URL de retorno          | Gratis              |
| `active`                | Open Looper                | Sin cuota comercial                        | Gratis              |
| `offline_grace`         | Open Looper                | Permitido hasta el límite decidido         | Gratis              |
| `verification_required` | Restore / Check purchase   | No asumir revocación                       | Gratis              |
| `revoked`               | Contact support / Buy      | Premium bloqueado con motivo claro         | Gratis              |


Una falla del servidor comercial jamás debe bloquear `DOWNLOAD_SINGLE_TRACK` ni `START_BULK_JOB`.

## Entregas implementables, en orden

Cada entrega termina con diff acotado, verificadores relevantes y prueba manual. No commitear cambios ajenos ni publicar automáticamente. Los tamaños son relativos, no estimaciones horarias.

### E1 — P02 + base de P09: ayuda, ajustes pequeños e i18n completa (M) — CERRADA

**Alcance:** `popup.html`, `scripts/popup.js`, mensajes locales y manifest si corresponde.

- Mantener barra de metadata/cantidad/calidad/carpeta; en selección conservar Back, opciones y All/Clear. No duplicar estos controles dentro de una nueva barra.
- Convertir el área inferior en tres zonas independientes: Help discreto a la izquierda, Download en centro absoluto y slot reservado para Looper a la derecha. E1 crea la geometría y Help; E2 llena el slot derecho. El slot vacío de E1 no es enfocable ni visible.
- Ayuda abre una vista interna breve y vuelve al estado anterior, sin perder selección, scroll, destino ni el job activo. No navegar el popup a otro HTML.
- Contenido: explicación de descargar desde popup/player; seleccionar playlist/perfil; elegir carpeta; significado de Auto/original/formatos; estado de tareas y errores; soporte y reseña; explicación de Looper. Sin prometer calidad original que el stream no tenga.
- Reutilizar controles existentes de carpeta. Licencia/restauración se incorporan en E6; no mostrar controles sin funcionalidad.
- Fuera de SoundCloud: explicación y enlace útil, sin promocionar el pago como arreglo de una página incompatible.
- No mostrar guía inicial: el flujo existente se considera suficientemente intuitivo. La explicación equivalente vive solamente en Help, accesible desde el engranaje; no abrir pestañas en actualizaciones.
- Extraer **todos** los textos visibles existentes: títulos, labels accesibles, tooltips, estados, errores, selección, jobs, formatos explicados y textos del looper. No dejar una migración parcial donde solo lo nuevo se traduzca.
- Usar el mecanismo estándar `chrome.i18n` con `_locales/<locale>/messages.json`: un archivo central por idioma y claves semánticas compartidas por popup/content/looper. `default_locale` inglés en manifest. No duplicar diccionarios dentro de cada handler.
- Resolver idioma automáticamente desde Chrome; fallback inglés para clave o locale desconocidos. No agregar selector manual de idioma en E1.
- Set inicial propuesto para confirmar al comenzar E1: `en`, `es`, `ru`, `pt_BR` y `de`, motivado por las reseñas disponibles. Las traducciones deben ser naturales y fieles; “literales” significa cobertura completa del copy actual, no traducción palabra por palabra que suene mecánica.
- HTML puede conservar fallback inglés útil, pero JS hidrata `textContent`, `title`, `aria-label` y placeholders desde claves centralizadas. El texto dinámico usa placeholders de `messages.json`, sin concatenar fragmentos en orden inglés.
- Agregar verificador de cobertura: toda clave usada existe en inglés y en cada locale publicado; ninguna string visible nueva queda hardcodeada en JS salvo contenido proveniente de SoundCloud.
- E1 prepara el contenedor visual de acciones para que E2 pueda poner el CTA a la derecha sin mover Download; no implementa licencia, checkout ni bloqueo.

Orden interno de E1:

1. Inventariar strings visibles con `rg` en `popup.html`, `popup.js`, `content.js`, `inline-button.js`, `looper.js`, `background.js` y módulos que produzcan errores mostrados. Separar copy de UI de mensajes diagnósticos internos. **Terminado:** listado de claves cubre text nodes, `title`, `aria-label`, placeholders y estados dinámicos.
2. Crear adapter de traducción testeable y `_locales`; añadir `default_locale`. Mantener las dependencias CSP-safe, sin librerías remotas ni `innerHTML` para traducciones. **Terminado:** inglés reproduce el sentido actual y el verificador detecta claves faltantes/placeholders inválidos.
3. Migrar popup y errores dinámicos; después botones inline y Looper. Los iconos conservan label accesible localizado. **Terminado:** búsqueda manual no encuentra copy visible inglés hardcodeado fuera de fallbacks declarados.
4. Introducir action row de tres zonas sin alterar el estado del job. Probar track y selector a 100%/125% zoom y locales largos. **Terminado:** centro de Download medido igual antes/después y no hay overlap.
5. Crear Help view y un pequeño controlador de vistas (`main`, `selection`, `help`) que guarde vista previa, `selectionViewport.scrollTop` y elemento de foco. Los listeners de progreso siguen vivos. **Terminado:** abrir/cerrar Help durante un job actualiza el estado y devuelve exactamente al contexto previo.
6. Ejecutar verificadores dirigidos y matriz manual. **Terminado:** criterios de E1 completos y diff limitado a i18n/help/layout/tests; sin CTA comercial funcional ni código de licencia.

**Aceptación:** Download continúa centrado y dominante; ayuda accesible por teclado en track/colección/selección/error; volver no reinicia descargas ni preferencias; el selector conserva scroll y checks; todas las strings visibles tienen clave/locale/fallback; sin recortes en ruso, alemán o estados de progreso. **Validación manual realizada por el usuario el 2026-09-06:** Chrome real, comportamiento correcto. Queda fuera del código configurar el buzón de soporte antes de convertir su aviso temporal en un enlace `mailto:`.

### E2 — P03: entrada comercial y explicación visual (S/M) — CERRADA

**Ubicación confirmada:** CTA llamativo pero compacto a la derecha del botón Download, visible tanto en el popup principal como en el selector de tracks. Download permanece en el centro geométrico de la ventana.

```text
                         ┌──────────────┐
             [ Download ]│ ↻ Try Looper │
                         └──────────────┘
              24 tracks selected
```

Implementación visual sugerida: action row de ancho completo, Download posicionado en el eje central y CTA anclado a la derecha. No usar una fila flex que centre la suma de ambos botones. Reservar separación suficiente para foco/hover y textos localizados; en ancho insuficiente, conservar icono + copy corto y tooltip/`aria-label` completo, sin superposición.

- El CTA lleva icono de loop + `Try Looper`; por ahora solo abre una explicación visual interna. No activa el Looper actual, no crea una prueba ni modifica descargas.
- Click abre una sección interna de presentación, no checkout directo. Debe sentirse parte del popup y tener Back, foco inicial correcto y restauración del estado anterior.
- Jerarquía propuesta para esa sección:
  1. `Loop the part you need.`
  2. `Repeat any section while you listen, then save only that loop as WAV.`
  3. Usar `assets/promos/four.png` como explicación visual de A–B y WAV, reducido dentro de la vista sin deformarlo ni prometer funciones fuera del producto.
  4. Sello: `Early access · $2.99 one-time`.
  5. Garantía central: `Every full-track download feature is free — and always will be. You only pay for Looper Pro.`
  6. CTA visual `Unlock Looper · $2.99 once`; al pulsarlo informa claramente que el checkout estará disponible en una actualización futura. No pedir datos, abrir URL ni simular una compra.
- Localizar el copy, preservando el énfasis semántico en que todas las funcionalidades de descarga completa son y seguirán siendo gratuitas. Evitar “all downloads” porque exportar el fragmento sí es premium después de la prueba.
- Mostrar WAV explícitamente. Explicar que exporta el rango seleccionado; no prometer calidad superior a la fuente, edición destructiva del track completo, pitch, velocidad, live recording ni seamless looping.
- Mostrar el precio y que es compra única, junto con que el checkout todavía no está disponible. No mostrar un límite de prueba hasta que E5A–E6 lo definan e implementen.
- La misma vista se abre desde track, playlist, perfil o selector; no intenta elegir ni abrir automáticamente un track de una colección.
- Durante construcción se verifica la geometría y accesibilidad de la entrada. El trial real, estados de licencia y checkout se activan junto con E5–E6.

**Aceptación:** centro de Download no cambia entre vista principal y selector; CTA no invade cantidad/status/errores; Back recupera scroll/selección; textos localizados; la imagen explica A–B/WAV sin alegaciones de calidad no comprobadas; el precio es visible, pero no hay checkout, trial ni cambio de acceso; cualquier descarga de track completo ignora el estado comercial.

### E3 — P04/P07: landing completa y reseñas auténticas (M) — PARCIAL

**Alcance:** `index.html` y sus assets. La fuente humana es `C:\Users\torib\Desktop\reviews.txt`; producción no depende de esa ruta.

- Mantener hero + UI representada. Añadir estado Looper a la demo sin convertir la landing en una página larga.
- Explicar en pocos bloques: tracks/colecciones/perfiles gratis; selección, carpeta, background y metadata; Looper A–B + export WAV y USD 2,99 una vez. Hasta E5–E6, informar que checkout y prueba funcional no están disponibles; no sugerir que una función visual ya se puede usar.
- Reemplazar `All features are free` por una promesa específica sobre descargas completas. No prometer pitch, grabación en vivo, WAV que restaura calidad perdida ni loops sin cortes.
- Mostrar **todas** las reseñas originales disponibles, incluidos elogios, pedidos de funciones y críticas. Mantener la landing corta mediante carrusel/lista compacta y `Show all reviews`, no mediante selección editorial que oculte opiniones.
- Guardar los datos como JSON válido dentro de una única variable del script de `index.html`, por ejemplo `const webStoreReviews = [...]`. No cargar en runtime el archivo del Desktop ni crear una base de datos pública para esto.
- Importar `C:\Users\torib\Desktop\reviews.txt` como UTF-8, separar reseñas de las respuestas del desarrollador, deduplicar y conservar autor, fecha y texto **sin traducir**. Repetir la importación cuando el usuario amplíe el archivo y revisar el diff antes de publicar.
- Cada objeto necesita al menos `author`, `date`, `text`, `source: "Chrome Web Store"` y, si se determina con seguridad, `language`. Guardar saltos de línea. No guardar frases de interfaz de Web Store (`Imagen de perfil`, `¿Te ha resultado útil?`) como parte de la review.
- El texto copiado no siempre contiene estrellas: no inventarlas. No corregir gramática, transliterar, resumir ni traducir. Renderizar siempre en idioma original y permitir al navegador aplicar dirección/escritura correctamente.
- Estas reseñas corresponden al downloader, NO a compras de Looper. No llamarlas compras verificadas. Cifras agregadas de usuarios/estrellas solo con fuente y fecha; instalaciones no equivalen a usuarios activos.
- Debajo de la sección, botón localizado `Write a Chrome Web Store review` que abre la superficie oficial adecuada de la ficha. Resolver y probar el enlace real antes de publicar; no enviar una review automáticamente ni sugerir cinco estrellas.
- Localizar todo el copy de landing para EN, ES rioplatense, RU, PT-BR y DE según el idioma del navegador, con fallback inglés y sin selector manual. Las reseñas se conservan literalmente en su idioma original.
- Mostrar tres reseñas al inicio y revelar las demás con `Show all reviews`. Añadir badge visual `ALREADY IMPLEMENTED` solo a solicitudes de funciones comprobablemente resueltas, sin marcar críticas de calidad, errores o contextos que sigan sin soporte.
- Usar `assets/promos/four.png` para explicar Looper; no reutilizar imágenes que prometan calidad superior a la fuente.
- FAQ breve: qué sigue gratis, una exportación de prueba, compra única, restaurar acceso y uso con contenido propio/autorizado. Privacidad y soporte accesibles sin agregar bloques comerciales extensos.

**Aceptación:** cantidad renderizada coincide con las reseñas (no respuestas) de la fuente; orden y texto coinciden; cirílico intacto; todas son alcanzables por teclado/mobile; botón de review abre el Store; la demo no descarga audio ajeno; no hay compra activa antes del checkout listo.

### E4 — P04 ampliado: feedback de desinstalación (M) — PENDIENTE DE IMPLEMENTACIÓN/DEPLOY

- Dirección de producto confirmada por el usuario: implementar encuesta de desinstalación, motivos + comentario opcional + email opcional, y entregar las respuestas a un destino privado. Cloudflare Pages/Functions + D1 es la tecnología elegida; E4 no depende del proveedor de cobro.
- Preparar vista web `?view=goodbye`, por ejemplo en el dominio de `CNAME`, una vez verificado despliegue/HTTPS. Registro mediante `chrome.runtime.setUninstallURL` al instalar/actualizar, cubriendo instalaciones existentes.
- No se ejecuta código de la extensión después de borrarla: Chrome abre una URL registrada previamente. La página debe funcionar sola.
- Modal propuesto: `Sorry to see you go.` / `What could we do better?`.
- Motivos: downloads did not work, confusing to use, missing feature, pricing, no longer needed, other. Comentario opcional y email opcional solo si desea respuesta. No exigir datos para cerrar.
- Botón `Send feedback`, agradecimiento únicamente tras recepción confirmada; reintento si falla; Escape, foco y cierre accesibles.
- API/formulario con validación, límites de texto, control de abuso y salida segura. Destino pendiente: email o tabla privada exportable. No exponer comentarios ni datos de contacto en web pública.
- Query solo de ruta/idioma/versión cuando haga falta; nunca email, clave ni ID persistente de usuario. Un hit a esa URL NO prueba una desinstalación: puede ser una visita manual.
- Sin tracking de apertura del modal en esta fase. Documentar acceso web/logs operativos y retención, no prometer que no se transmite nada al abrir el sitio.
- Desinstalar no elimina una compra ni inicia un reembolso; la licencia se puede restaurar.

**Dependencia resuelta:** Cloudflare alojará Pages, la Function de feedback, D1, Turnstile, cron de limpieza y el envío de alertas. El sitio y endpoint usarán `sctd.vpugliese.online`; las alertas llegan a `it@vpugliese.online`. Una cuenta/dominio de correo configurado no prueba que Pages o la Function estén desplegados: no registrar `setUninstallURL` hasta probar en producción el formulario, Turnstile, D1 y una alerta. La tabla privada D1 será exportable a CSV; un HTML estático por sí solo no guarda respuestas.

**Aceptación:** desinstalar en Chrome real abre la vista correcta; una respuesta llega al destino; spam/reintentos no duplican sin límite; una visita normal conserva landing normal.

### E5 — P05: decisión y licencia recuperable, privada hasta el final (L)

E5 puede avanzar en paralelo al cierre de producto, pero se mantiene en **test/private mode**. No abre checkout público, no cobra, no registra una licencia de producción y no conecta E6 hasta superar el gate “producto v1 terminado”. Se divide en dos hitos:

- **E5A — decisión técnica/comercial:** el candidato es Lemon Squeezy como Merchant of Record para una persona física argentina, tarjetas y posible payout Wise USD. No necesita una LLC estadounidense; Wise sirve como destino potencial de payout, no como elegibilidad para Stripe. Stripe directo queda descartado mientras el vendedor resida en Argentina sin entidad elegible. Paddle y Dodo quedan descartados por políticas expresas contra streaming downloaders/descargas; Gumroad sólo sería plan B si se acepta payout ARS a banco argentino, no Wise.
- **Condición no negociable de E5A:** antes de crear un checkout real, pedir a Lemon Squeezy aprobación expresa y veraz del producto concreto: downloader de SoundCloud, Looper/export WAV, contenido propio o autorizado y manejo de reclamos. No ocultar la naturaleza del producto ni intentar sortear una política. Si no aprueba, no se activa venta con tarjeta; se rediseña el producto o se pausa el cobro.
- **Economía conocida:** la tarifa publicada de Lemon Squeezy es 5% + USD 0,50, más 1% de payout bancario no estadounidense y posibles extras para tarjetas internacionales. En USD 2,99, el neto base aproximado es USD 2,3405 y USD 2,3171 con ese payout, antes de impuestos, conversión o cargos de Wise. No es compatible con “retener 95%” en cada microventa. Revalidar tarifas y condiciones al abrir la cuenta.
- **E5A pendiente:** completar honestamente KYC/W-8 y probar que acepta los datos específicos de Wise; fijar reembolso, actualizaciones incluidas, 3 dispositivos con reemplazo self-service, 30 días de gracia offline, recuperación por email/licencia y modelo de prueba. Resultado: ADR/contrato de integración aprobado, sin checkout productivo.
- **E5B — implementación privada:** Worker de Cloudflare, D1, contratos de entitlement, checkout **sandbox**, webhook HMAC idempotente, restauración, comprobante firmado y pruebas de refund/revocación/offline. El Worker contiene un adapter de proveedor; `entitlement-core` no conoce Lemon Squeezy. Resultado: flujo de prueba completo antes de conectar E6, sin secretos en la extensión.

El informe con evidencia primaria y enlaces vigentes está en `payment-provider-research-20260907.md`. No sustituye asesoramiento fiscal argentino ni una aprobación del proveedor.

Flujo de implementación propuesto:

```text
Extensión/web → orden en backend → checkout alojado
→ confirmación autenticada → compra/licencia en DB
→ extensión obtiene comprobante firmado → habilita Looper
```

- Una compra única; sin suscripción ni renovaciones comerciales. Falta fijar impuestos/precio final, reembolsos, dispositivos y alcance de futuras actualizaciones.
- Versionar ofertas por precio: `looper_early_299` concede la misma capacidad permanente que un futuro `looper_standard_399`. Subir el precio no revoca, vence ni vuelve recurrentes las compras early. Backend valida el precio vigente; la extensión nunca envía un importe confiable. El mecanismo para mostrar precio actualizado (release o configuración firmada de datos) se decide en E5A.
- Backend pequeño: órdenes, compras, licencias y activaciones; feedback separado. Si se exige prueba por cuenta, también registro de prueba. No requiere una plataforma de analytics.
- El servidor determina importe/producto, verifica webhook o confirmación de red y procesa idempotentemente. Nunca confiar en `success=true`, precio enviado por cliente ni `paid: true` en storage.
- Compra desde extensión: asociar la orden mediante token temporal opaco de emparejamiento. Compra desde web: entrega de recuperación y posterior activación. No asumir que el comprador conserva el popup abierto.
- Volver a abrir popup consulta resultado; incluir `Restore purchase`/`Check purchase`. Si se añade comunicación web→extensión, limitar origen y aceptar solo solicitud de refresco, nunca una orden de dar acceso premium.
- Comprobante firmado verificable localmente; clave privada solo en servidor, clave pública en extensión. Caché minimiza consultas; propuesta a decidir: revalidación diaria cuando online y 30 días offline desde última validación. Expirar comprobante no equivale a expirar la compra.
- Restauración por email verificado/enlace de un uso o licencia con proceso seguro; secretos fuera de URLs persistentes/logs. Propuesta inicial a aprobar: 3 instalaciones activas y forma de reemplazar una anterior, sin fingerprint.
- Checkout cancelado/pago pendiente/reembolso/licencia revocada/servidor caído tienen mensajes distintos. No pedir recomprar por un simple fallo de verificación.
- Descargas gratuitas y audio permanecen locales: no enviar SoundCloud cookies, URLs firmadas ni archivos al sistema comercial.

Modelo mínimo que E5A debe aprobar antes de escribir backend:


| Entidad       | Campos conceptuales mínimos                                                           |
| ------------- | ------------------------------------------------------------------------------------- |
| `order`       | ID opaco, producto, precio/versionado, moneda, estado, expiración, provider reference |
| `purchase`    | order, confirmación idempotente, comprador recuperable, momento, refund/revocation    |
| `license`     | purchase, capacidades (`looper`), estado, política de updates                         |
| `activation`  | license, instalación opaca, alta/último uso/reemplazo; sin fingerprint invasivo       |
| `entitlement` | capacidades, licencia, expiración técnica, issued-at y firma del servidor             |
| `trial`       | solo si se elige enforcement servidor; sujeto, estado, intento y consumo confirmado   |


API conceptual: crear orden; recibir/verificar webhook o pago on-chain; consultar orden con token de emparejamiento; activar/restaurar licencia; refrescar entitlement; desactivar instalación; enviar feedback. Nombres/stack se deciden al conocer hosting. Rate limiting, validación, logs sin secretos, backups y borrado/retención forman parte de E5B.

### Diseño de paywall que E5A debe evaluar

El objetivo no es esconder un botón: es que todas las rutas premium consulten una única autoridad de capacidades. Diseño candidato, todavía no implementación:

- `entitlement-core`: máquina de estados pura y testeable; responde `canActivateLooper`, `canExportLoop` y motivo/UI state sin conocer Stripe/USDT.
- `entitlement-storage`: guarda trial/intentos y caché del comprobante en extensión storage con acceso restringido al service worker cuando sea posible.
- `license-client`: crea/consulta emparejamiento, restaura y refresca comprobantes. Solo habla con el backend autorizado.
- Background expone mensajes explícitos como `GET_LOOPER_ACCESS`, `BEGIN_LOOP_EXPORT`, `COMPLETE_LOOP_EXPORT`, `RESTORE_LICENSE`; valida sender/payload y serializa reservas.
- `looper.js` consulta acceso antes de montar A–B. La UI refleja el resultado pero no concede acceso por sí misma.
- `background.js` vuelve a comprobar capacidad antes de `DOWNLOAD_LOOP`. Esta segunda barrera evita que ocultar/modificar el botón sea suficiente.
- `DOWNLOAD_SINGLE_TRACK` y `START_BULK_JOB` no pasan por entitlement. `trimRange` solo entra por la ruta premium validada.
- El comprobante de compra está firmado por servidor y se verifica con clave pública embebida. Un boolean local `paid` o la página `checkout-success` nunca son autoridad.
- El trial local puede ser editado o reiniciarse; el JavaScript de una extensión puede modificarse. Un backend mejora compras/restauración y un trial con cuenta mejora el límite, pero no crea DRM invulnerable. Para USD 2,99 se elige fricción y soporte razonables, con amenaza documentada.

Secuencia candidata de acceso:

```text
click botón Looper en SoundCloud
→ background consulta entitlement
→ active/offline_grace: monta Looper
→ trial_available: crea/continúa prueba permitida y monta Looper
→ trial_consumed: no monta; muestra unlock localizado

click Export WAV
→ background reserva intento idempotente
→ genera y guarda archivo
→ guardado confirmado: consume trial
→ error/cancel confirmado: libera reserva
```

E5A también decide la experiencia del botón Looper sobre SoundCloud cuando está bloqueado: mini upsell accesible en la página o abrir la vista comercial de extensión/landing. Debe ser coherente con el CTA del popup, no una tercera oferta distinta.

**Aceptación:** checkout de pruebas, retorno sin popup, webhooks duplicados/falsos, compra desde web, restauración en otro perfil, offline y devolución. Nada premium público hasta superar estas pruebas y validar condiciones del proveedor.

### E6 — P06: una exportación gratis y acceso de pago (M/L) — BLOQUEADA HASTA EL GATE FINAL

El código actual permite contar éxito tras `saveOutput`: la ruta del navegador espera `chrome.downloads` en `complete` y la carpeta elegida espera el guardado. No hay todavía cuota ni licencia. Esto identifica el punto de integración, no certifica una prueba ya implementada.

- Estado de prueba: `available → reserved → consumed`; error/cancelación confirmados liberan reserva. No consumir al marcar A/B, reproducir, hacer click o empezar a decodificar.
- Reservar antes de exportar y serializar en background para que dos pestañas no obtengan dos exportaciones simultáneas. Persistir intento y reconciliar tras reinicio del service worker.
- Consumir solo después de guardado confirmado. Distinguir reintento del mismo intento de una nueva exportación; no redescargar por un timeout de confirmación comercial.
- Hay una ventana de fallo entre guardar un archivo local y registrar consumo. No existe transacción atómica archivo/servidor: diseñar recuperación e idempotencia y decidir trato de casos ambiguos, favoreciendo no quitar la prueba por un fallo técnico.
- **Opción A propuesta:** prueba local sin registro; compra/restauración con email. Menor fricción, pero reinstalación/otro perfil pueden resetearla: `storage.local` se elimina al desinstalar. No prometer una prueba por persona.
- **Opción B:** email verificado antes del primer export y registro servidor. Resiste reinstalación de la misma cuenta, agrega fricción y dependencia online; no impide múltiples emails. Sin fingerprint invasivo.
- Decisión cerrada: después del primer guardado exitoso bloquear activación, repetición A–B y exportación; el unlock comprado habilita las tres sin cuota. Si el archivo termina de guardarse mientras el loop suena, no cortar audio de forma abrupta: desmontar/finalizar la sesión de prueba con mensaje claro y pasar a `trial_consumed`.
- Decisión a tomar en E5A: qué limita la prueba **antes** del export. Si se permite abrir/cambiar tracks indefinidamente hasta guardar, la persona puede usar el valor auditivo premium sin pagar. Recomendación: una prueba ligada a un único track desde la primera activación; puede mover A/B, escuchar varias repeticiones y exportar una vez. Si cierra/navega, definir si puede volver a ese mismo track o si la sesión termina. No agregar timer oculto.
- Capacidades comerciales centralizadas, separadas del motor de audio. Comprobar activación y `DOWNLOAD_LOOP` en background; no aceptar `trimRange` por comandos gratuitos como atajo de export premium. Bridge MAIN no decide la licencia.
- Protección proporcional a USD 2,99: código cliente inspeccionable, sin DRM invulnerable. Servidor asegura autenticidad de compras, no hace inmodificable una extensión local.

**Aceptación:** primera sesión respeta el límite elegido; primer guardado consume exactamente una vez en el flujo normal; error/cancel no consumen; doble click/dos pestañas/reinicio/reintento no duplican concesiones; después se bloquea Looper entero; comprador lo usa/exporta sin cuota; tracks/bulk siguen gratis incluso sin internet comercial.

### E7 — P08/P09: calidad gratuita y completar idiomas (M) — PENDIENTE

- Resumen de éxitos/fallos; reintentar solo tracks fallidos preservando orden, formato y destino, sin duplicar éxitos.
- Mostrar destino real. Para `chrome.downloads.show`, propagar ID guardado; con carpeta File System Access mostrar nombre/gestión disponible, no prometer abrir Explorer arbitrariamente.
- E1 traduce toda la superficie actual; E7 agrega y audita los textos nacidos en E2–E6: trial, compra, restauración, feedback y errores del backend. Browser locale con fallback inglés; en web usar locale del navegador, con inglés disponible. La vista goodbye tiene copy inglés pulido y reutiliza el mismo glosario.
- Probar jobs con popup cerrado, carpeta revocada, nombres Unicode y límites de texto en ruso.

### E8 — A01/A02, P10–P12 y marketing: después — BACKLOG

- Analytics separado: exposiciones/clicks CTA por superficie, aperturas popup, jobs y archivos guardados, trial iniciado/consumido, checkout/compra/activación. No confundir una playlist de 100 archivos con 100 usuarios.
- Conservar el ratio solicitado clicks CTA / (aperturas + jobs completados) como índice de actividad, no conversión de personas. Añadir CTR real clicks/exposiciones y compra/checkouts deduplicados.
- Definir consentimiento, minimización y retención antes de transmitir comportamiento. Recibos/licencias y feedback voluntario sí existen antes y no se presentan como analytics anónimo.
- Luego: historial local opcional para evitar duplicados y selección por rango (gratis), otros contextos por demanda; pitch/velocidad como trabajo separado, sin prometerlos en venta inicial.
- Mantener tareas manuales M01–M08 del roadmap: las cuatro piezas promocionales ya existen; queda grabar el video de 60 s y el corte Looper de 20 s al estabilizar UI. Antes de subir, verificar requisitos del Store para esas imágenes, además de ficha/privacidad, respuestas a reviews y difusión. El guion muestra primero descargas gratuitas y después prueba/compra única.

## Auditoría de estado y trabajo restante — 2026-09-07

Esta sección registra el estado observado en el repositorio después de revisar todos los `.md`, `.txt` y `.html` propios del proyecto, el código actual, el working tree y los verificadores disponibles. Es el resumen operativo para continuar el trabajo; los planes de `.cursor/plans/` y el apéndice histórico de este archivo no deben interpretarse como checklists actuales.

### Estado confirmado

- **E1 implementada:** Help interno, action row con Download centrado, preservación de selección/scroll/job y localización Chrome con `en`, `es`, `ru`, `pt_BR` y `de`. Hay 138 claves y las cinco locales tienen cobertura completa.
- **E2 implementada:** CTA de Looper en popup principal y selector, vista explicativa, imagen A–B/WAV, precio de compra única y garantía de que las descargas completas siguen gratis. No activa trial, checkout ni paywall.
- **E3 implementada localmente:** landing corta, demo interactiva, FAQ, CTA de reviews, soporte y 39 reviews inline originales. La fuente externa `reviews.txt` no está disponible en el repo ni en la ruta Desktop documentada; la verificación de landing pasa, pero omite la comparación contra esa fuente.
- **Descargas gratuitas existentes:** tracks, playlists, likes, perfiles `/tracks`, selección, player/inline, formatos, metadata, artwork, carpetas elegidas, jobs en background y recuperación local.
- **Looper existente:** A–B, reproducción y exportación WAV están implementados y cubiertos por verificadores. El E2E usa datos deterministas; todavía no certifica todos los codecs, fuentes ni el audio real de SoundCloud.

### Pendientes bloqueantes o de release

1. **E4 — feedback de desinstalación:** crear la vista `?view=goodbye`, Function de Cloudflare, D1 privado, Turnstile, límites antiabuso, cron de limpieza, alertas y pruebas de recepción. Agregar `chrome.runtime.setUninstallURL()` solo después de probar el deploy real con HTTPS, formulario, D1 y alerta. Reemplazar también el texto temporal `Support email is being set up` por el enlace `mailto:it@vpugliese.online`.
2. **Cierre real del export WAV:** probar progressive, HLS y original; mono/estéreo; tracks cortos y mixes largos; duración audible; errores de decodificación; cancelación; navegación; carpeta revocada; concurrencia con bulk; tiempo y memoria. Documentar límites reales.
3. **E5 — pago/licencia:** queda fuera de esta auditoría de implementación porque otro agente lo está trabajando. Al recibirlo, revisar por separado E5A (decisiones/ADR) y E5B (checkout sandbox, webhooks idempotentes, licencia firmada, restauración, privacidad y soporte).
4. **E6 — trial y paywall:** después de E5, implementar `trial_available → reserved → consumed`; reservar y serializar en background; consumir solo después de confirmar el guardado WAV; bloquear activación, reproducción A–B y nuevas exportaciones tras consumir; conservar intactas todas las descargas completas.
5. **Release:** revisar versión/manifest, generar el ZIP, excluir helpers de desarrollo del paquete, validar DNS/HTTPS/deploy, actualizar privacidad y ficha del Store, probar enlaces, ejecutar Chrome real y recién entonces publicar.

### Verificación ejecutada en esta auditoría

- `npm test`: 27 verificaciones locales pasadas.
- `npm run test:e2e`: exportación WAV determinista pasada.
- `npm run test:e2e:download`: Downloads, carpeta recordada, fallback de carpeta revocada y geometría del botón pasados.
- `node --check`: todos los JavaScript del directorio `scripts/` pasan sintaxis.
- Pendiente: `test:live` contra un track público real y la matriz manual completa de SoundCloud.

### Deuda documental que debe cerrarse

- Actualizar README para describir que el export WAV de Looper ya existe, manteniendo claro que velocidad, pitch, loops guardados y audio sin cortes siguen fuera de alcance.
- Actualizar las frases históricas de este documento que todavía dicen que Help o landing no estaban implementados.
- Cambiar los estados `pending` de los planes históricos o marcarlos explícitamente como archivados; no usarlos para decidir el trabajo actual.
- Mantener la procedencia de las 39 reviews: si aparece nuevamente `reviews.txt`, ejecutar la comparación UTF-8 y revisar el diff antes de modificar la landing.

### Backlog arquitectónico no bloqueante

- **Ya encaminado:** Track canónico, ejecución de una pista, destinos y Page Intake separado (`content.js` ya quedó pequeño y `page-intake.js` concentra la extracción).
- **Pendiente parcial:** todavía conviven `download-source.js` y `stream-selector.js`; terminar la migración del seam de streams y eliminar solo la implementación legacy cuando no queden callers.
- **Pendiente:** profundizar `bulk-job-manager.js` como state machine durable; conserva más líneas y API pública de las metas del plan.
- **Pendiente parcial:** reducir duplicación restante entre popup e inline mediante la intención de descarga compartida, sin mover DOM ni estilos al módulo común.
- **Safety net pendiente:** agregar fixtures y escenarios reales para todos los tipos de página, fuentes public/OAuth, progressive/HLS/original, errores 401/403/404, SPA rápida y recovery del job. No confundir los mocks actuales con certificación de SoundCloud real.

### Marketing y operación después de estabilizar el producto

- Grabar el video principal de 55–60 segundos y el corte de Looper de 15–20 segundos.
- Preparar cinco capturas actuales de la ficha; las cuatro promos existentes sirven como assets de apoyo, pero no sustituyen necesariamente las capturas del Store.
- Exportar el CSV del dashboard, responder reviews con versión concreta, actualizar ficha/privacidad/soporte y verificar identidad del publisher.
- Evaluar Edge Add-ons después de probar carpeta, offscreen y restauración.
- Dejar analytics, historial, selección por rangos 51–100, reposts, `/user/albums`, velocidad/pitch y mejoras de audio para después del primer release estable.

### Orden operativo recomendado

Mientras E5 continúa en paralelo: cerrar E4, ejecutar la validación real del WAV y limpiar README/planes. Luego revisar E5A/E5B, implementar E6, completar textos comerciales y hacer el release. No iniciar el refactor arquitectónico completo antes de superar estos gates, salvo que una regresión lo exija.

## Registro de decisiones

La siguiente tabla es la frontera entre lo decidido y lo que se difiere. Una sesión nueva actualiza esta tabla antes de cambiar comportamiento comercial.


| ID  | Estado                         | Decisión                                                                                                                                              |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | cerrada                        | Tracks completos, playlists/perfiles, selección, formatos, carpeta, metadata, player/inline y mejoras gratuitas permanecen gratis para siempre        |
| D02 | cerrada                        | Looper Pro cuesta USD 2,99 para early users, compra única; podrá subir a USD 3,99 para compradores nuevos                                             |
| D03 | cerrada                        | La prueba incluye experimentar con un loop y un guardado WAV exitoso; después se bloquea Looper completo, no solo export                              |
| D04 | cerrada                        | CTA con icono + `Try Looper` a la derecha de Download en principal y selector; Download no se mueve del centro; abre vista persuasiva interna         |
| D05 | cerrada                        | Vista comercial declara que solo Looper Pro se vende y que todas las funcionalidades de descarga completa son y siempre serán gratis                  |
| D06 | cerrada                        | Landing muestra todas las reseñas originales de `reviews.txt`, sin traducir, en JSON inline dentro del script, y CTA para dejar review en Web Store   |
| D07 | cerrada                        | Encuesta web voluntaria al desinstalar con motivos, comentario/email opcionales y recepción privada                                                   |
| D08 | cerrada                        | Idioma automático del navegador; cobertura de todo copy actual y nuevo; archivos de locale centralizados con fallback inglés                          |
| D09 | cerrada                        | Locales de lanzamiento: EN, ES rioplatense, RU, PT-BR y DE; idioma automático de Chrome con fallback inglés                                           |
| D10 | diferida a E5A                 | Prueba local sin cuenta o prueba registrada por email/backend                                                                                         |
| D11 | diferida a E5A                 | Antes del primer export: limitar prueba a un track/sesión o permitir Looper hasta que se guarde el WAV. Default propuesto: un track, sin timer oculto |
| D12 | condicionada a aprobación E5A  | Vendedor: persona física argentina sin LLC. Candidato: Lemon Squeezy MoR + payout Wise USD; falta aprobación expresa del producto y KYC/payout real |
| D13 | cerrada para v1                | Tarjeta es el medio principal buscado. No ofrecer USDT/crypto en v1; 95% neto no es requisito compatible con microventas por tarjeta                  |
| D14 | cerrada para E4                | Cloudflare: Pages + Function + D1 + Turnstile + cron; `sctd.vpugliese.online` y alertas a `it@vpugliese.online`                                      |
| D15 | diferida a E5A                 | Recuperación, dispositivos (default: 3), reemplazo de activaciones, gracia offline (default: 30 días), refunds y updates incluidos                    |
| D16 | diferida fuera de v1           | No evaluar USDT/crypto hasta después del release comercial; guardar únicamente nombres/redes, nunca claves/seed                                      |
| D17 | cerrada                        | Looper nunca fue enviado a Chrome Web Store; la versión pública previa no lo incluye y no requiere transición de acceso                            |
| D18 | cerrada                        | Buzón de soporte disponible: `it@vpugliese.online`; reemplazar el aviso temporal de Help por su enlace `mailto:` antes de publicar                 |
| D19 | cerrada                        | Primero terminar v1 (E3/E4/E7 y regresiones); E5A/E5B se desarrollan sólo en privado/sandbox; E6/checkout público se activan al final               |


### Decisiones que quedan para cerrar E5A

No bloquean el código provider-neutral de E5B, pero sí el onboarding, sandbox con proveedor y cualquier activación pública:

1. Autorizar crear una cuenta Lemon Squeezy **sólo en Test Mode** y pedir su confirmación explícita del caso de uso antes de Live Mode. Es una acción externa y sólo la realiza el titular.
2. Confirmar si la cuenta Wise USD es personal o Business y si se puede completar KYC/W-8 con los datos reales. No usar datos de residencia, empresa o Stripe de un país que no corresponda.
3. Elegir prueba local reiniciable tras reinstalar o prueba vinculada a email; y confirmar la propuesta de un único track por prueba, sin timer oculto.
4. Confirmar 3 instalaciones activas, reemplazo self-service y 30 días de gracia offline.
5. Definir reembolsos y qué futuras actualizaciones incluye la compra única. No publicar antes términos, privacidad y soporte.

E1 no incluye onboarding. Usar EN/ES/RU/PT-BR/DE, con español rioplatense, y dejar las traducciones listas para revisión humana antes de publicación.

## Orden de commits y gates de publicación

El orden de producto es E1 → E2 → E3 → E4 → E7 → E6, con E5A/E5B preparados en privado en paralelo a E3–E7. E8 queda posterior. Mantener commits separados:

1. `help and extension localization foundation` — E1.
2. `add Looper entry and sales explainer` — E2, todavía sin trial ni venta pública.
3. `update landing and import Web Store reviews` — E3.
4. `add uninstall feedback flow` — E4, incluyendo endpoint elegido.
5. Documento/decisión E5A; después commits propios del Worker/licencias E5B, exclusivamente sandbox.
6. Calidad, retries y traducciones comerciales finales — E7.
7. `gate Looper after free trial export` — E6, únicamente cuando el producto v1 y compra/restauración ya funcionan.

Gate 1: E1–E3 pueden probarse localmente sin sistema de pago. Gate 2: E4 requiere endpoint real antes de publicar la URL de desinstalación. Gate 3: E5B puede operar sólo con sandbox y secretos de desarrollo en Cloudflare; ningún checkout/URL de Live Mode se agrega a la extensión. Gate 4: antes de bloquear Looper, completar E3/E4/E7, probar restore/refund/offline y obtener la aprobación escrita del proveedor. Gate 5: antes de Store, actualizar landing, README, privacidad, términos y ficha con el mismo límite/precio/copy.

## Fuentes y límites de la investigación

- [Pagos y obligaciones de publicación del Chrome Web Store](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment).
- [Registro de URL de desinstalación](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-setUninstallURL).
- [Storage local y eliminación al desinstalar](https://developer.chrome.com/docs/extensions/reference/api/storage).
- [Localización de extensiones](https://developer.chrome.com/docs/extensions/reference/api/i18n).
- [Mensajes entre sitio y extensión](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
- Investigación comercial vigente: `payment-provider-research-20260907.md`. `payment-options-20260905.md` conserva cálculos históricos; revalidar tarifas y condiciones al contratar. Ninguno garantiza aprobación, cobertura mundial ni asesoramiento fiscal.

La investigación separada detectó comisiones fijas y restricciones de categoría/geografía. Este párrafo sustituye una nota de estado anterior: ahora E1/E2 y parte de E3 ya están implementados; E4 y el resto de E5–E8 conservan el estado de la tabla al inicio del documento.

## Anexo histórico no normativo

El material siguiente es una conversación/estrategia anterior que el usuario quiso conservar. No es un plan ejecutable, no describe el estado actual, no autoriza cambios y no reemplaza las decisiones/gates de este documento.

Una respuesta que me habia gustado mucho y tengo como principal roadmap para que me recuerde de hacer otro tipo de tareas, ya hice 4 imgs promocionales ahora me faltaria solo terminar la app y hacer un video.  
&gt; Download entire SoundCloud libraries—not one track at a time.

  No intentes ganarle a Enhanced Pro agregando un reproductor, centro de notificaciones y veinte pantallas. Tu ventaja es otra: descargas masivas, gratis, sin redirecciones y

  que siguen funcionando en segundo plano.

  ## Panorama competitivo — 4 de septiembre de 2026

  Busqué soundcloud download, soundcloud downloader, soundcloud to mp3, download soundcloud, soundcloud playlist downloader y sc downloader. El orden exacto varía por país,

  idioma y usuario.

   Extensión                                                                           Usuarios         Rating    Lectura

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   SoundCloud Track Downloader (https://                          21.270 internos / 20K público      3,83 · 47    Líder por usuarios y bulk

   chromewebstore.google.com/detail/soundcloud-track-download/

   ekmbbjdpakacalghjkikfppebgdpoebb)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   SCDownloader ([https://chromewebstore.google.com/detail/](https://chromewebstore.google.com/detail/)                                  10K       3,1 · 19    47 idiomas, pero reviews de fallos y redirecciones

   scdownloader-soundcloud-t/imaiognajobkkjnnndmgaofhfjjgkgao)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   SoundCloud Enhanced Pro ([https://chromewebstore.google.com/](https://chromewebstore.google.com/)                               9K       4,1 · 43    Rival principal en presentación; limita playlists a 10 en

   detail/soundcloud-enhanced-pro/                                                                                free

   ggplcohodggmdfpopelnpplhgfjclomi)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   SoundCloud DL ([https://chromewebstore.google.com/detail/](https://chromewebstore.google.com/detail/)                                 852        3,8 · 5    Búsqueda, historial y descarga individual

   soundcloud-dl/feohgdpkelnncobnnlopjanlcgdjkklb)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   SoundCloud to MP3 ([https://chromewebstore.google.com/](https://chromewebstore.google.com/)                                    560        3,0 · 2    Solo redirige a una web

   detail/soundcloud-downloader-sou/

   pghggikpidbkmbjniblhcnpmoefneglp)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   Downloader + Playback Speed (https://                                                    260        5,0 · 8    Buen rating con muestra diminuta; no tiene bulk

   chromewebstore.google.com/detail/soundcloud-downloader-and/

   fobbgbjggnhhfkibdgajbpcnmphafplf)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   SoundCloud Downloader pago (https://                                                     240    Sin ratings    Paywall total de USD 4,99/mes

   chromewebstore.google.com/detail/soundcloud-downloader/

   onoggejnnoikokkpfdmjbikllhjpajkp)

  ─────────────────────────────────────────────────────────────  ───────────────────────────────  ─────────────  ─────────────────────────────────────────────────────────────

   SoundCloud Downloader MP3/WAV (https://                                                   16    Sin ratings    Nuevo, requiere pegar links

   chromewebstore.google.com/detail/soundcloud-downloader/

   hhaegeloplimpcglgabcjomenoibgdkb)

  También aparecen falsos positivos y herramientas generales —SoundCloud players, audio recorders, SF Helper, OTLICHNIK— pero todavía no representan competencia directa.

  Chrome confirma que el ranking combina ratings, descargas frente a desinstalaciones, metadata, diseño, onboarding y facilidad de uso. No alcanza con sumar features.

  Discovery del Chrome Web Store ([https://developer.chrome.com/docs/webstore/discovery/](https://developer.chrome.com/docs/webstore/discovery/)).

  ## Lo urgente: publicá el arreglo de cirílico por separado

  El fix está en tu working tree pero la ficha pública continúa en 2026.06.18, actualizada el 16 de junio. Corrí tus verificaciones locales:

  - Filename verification passed

  - Metadata verification passed

  No esperaría las otras dos features. Haría un release 2026.09.04 o superior y respondería las reseñas afectadas así:

  &gt; Thanks for reporting this. Cyrillic, accented, CJK and emoji filenames are fixed in version 2026.09.04. Chrome updates automatically; you can verify the installed version

  &gt; at chrome://extensions. If you still see a problem, please contact me through the support link with one example.

  Tus respuestas actuales son simpáticas, pero algunas se ven improvisadas o defensivas. En la tienda conviene siempre: reconocer, dar número de versión, explicar cómo

  verificar y ofrecer soporte.

  Con 47 ratings y promedio 3,83, aproximadamente necesitás:

  - 8 ratings nuevas de 5 estrellas para llegar a 4,0.

  - 15 para 4,1.

  - 22 para 4,2.

  - 32 para 4,3.

  Solo 0,221% de tus usuarios dejaron rating. Agregaría una invitación discreta después de, por ejemplo, tres descargas exitosas o una playlist completada:

  &gt; “Saved successfully. Enjoying the extension? Leave an honest review.”

  Al lado: Report a problem. Sin premios ni bloquear funciones; Google prohíbe ratings incentivados o manipulados. Política de reviews del Store

  ([https://developer.chrome.com/docs/webstore/spam-faq/](https://developer.chrome.com/docs/webstore/spam-faq/)).

  ## Sí: cambiá ahora mismo el video y las imágenes

  Tu video viejo ocupa la primera posición visual y muestra una versión inferior del producto. Las capturas actuales dejan demasiado espacio negro, muestran la UI muy chica y

  no explican por qué sos distinto.

  Google recomienda cinco capturas actualizadas, idealmente de 1280×800, centradas en la experiencia real. Además, el video aparece antes que las capturas. Guía oficial del

  listing ([https://developer.chrome.com/docs/webstore/best-listing/](https://developer.chrome.com/docs/webstore/best-listing/)).

  Usaría estas cinco:

  1. “Download an entire playlist”

     Playlist real, selector All, botón grande y popup visible.

  2. “One click, without leaving SoundCloud”

     Zoom al botón inline al lado de Like/Repost/Share.

  3. “Close the popup. Downloads keep going.”

     Badge 30/500, progreso y controles pause/resume/cancel.

  4. “Clean files, ready for your library”

     Explorer/Finder mostrando portada, artista, álbum y nombres cirílicos correctos.

  5. “Playlists, albums and likes”

     Tres casos visuales sencillos. Más adelante, reemplazar por perfiles completos.

  Video de 45–60 segundos:

  - 0–5 s: resultado final, no introducción.

  - 5–15 s: bajar un track inline.

  - 15–30 s: descargar una playlist completa y cerrar el popup.

  - 30–40 s: likes/perfil.

  - 40–50 s: archivos con portada, tags y nombres correctos.

  - Final: “Free. No redirects. Runs locally.”

  Si el video nuevo demora, preferiría temporalmente quitar el viejo antes que mantener una demo obsoleta.

  ## Copy recomendado

  Tu frase actual —“On any supported SoundCloud page…”— es correcta pero genérica y queda truncada. También tiene el error logging in And.

  Resumen corto actualizable:

  &gt; Download SoundCloud tracks, playlists, albums and likes in one click—with cover art, metadata and background bulk downloads.

  Cuando salga profiles:

  &gt; Download SoundCloud tracks, playlists, likes and complete artist profiles—with cover art, metadata and background downloads.

  Primer párrafo:

  &gt; Save individual SoundCloud tracks or entire playlists, albums and likes without leaving SoundCloud. Choose the best available format, keep cover art and metadata, and let

  &gt; large downloads continue after closing the popup.

  Tu listing tampoco destaca suficientemente que ya tenés ID3/M4A metadata y artwork, cosas que Enhanced Pro presenta como features premium.

  ## Orden de features

  1. Descargar /user/tracks completo.

     Es coherente con tu ventaja bulk, responde a varias reviews y abre un caso defensible: artistas respaldando sus propias subidas.

  2. Botones inline en perfiles, feed y resultados.

     Una review concreta se queja de tener que abrir cada track en una pestaña. Resolver eso probablemente aumente más el uso diario que agregar estadísticas o un player.

  3. Organización de carpeta + “Open folder”.

     Importante: chrome.downloads solamente permite rutas relativas dentro de la carpeta de descargas predeterminada. No puede escribir silenciosamente en cualquier carpeta

     absoluta. saveAs abre un selector para cada descarga, pésimo para bulk. API oficial de downloads ([https://developer.chrome.com/docs/extensions/reference/api/downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)).

     Haría estas opciones:

      - Downloads/

      - Downloads/SoundCloud/

      - Subcarpeta personalizada

      - Organizar por artista/playlist

      - Ask where to save solo para tracks individuales

      - Botón Open downloaded folder al terminar

  4. Skip duplicates / download range.

     Más valioso que historial decorativo: “download tracks 51–100” o “skip already downloaded”.

  No priorizaría reproductor integrado, guía offline, notification center, artwork separado ni playback speed. Son features vistosas de Enhanced Pro, pero te alejan de “el

  downloader masivo que funciona”.

  ## Crecimiento fuera del código

  - Localizá según tus datos del dashboard, no 47 idiomas a ciegas. Por tus reviews empezaría evaluando ruso, portugués brasileño, alemán y español. El Store permite

    descripciones, screenshots y videos localizados. Documentación de localización ([https://developer.chrome.com/docs/webstore/cws-dashboard-listing/](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)).

  - Creá una landing mínima con un único CTA: Add to Chrome. Ahí sí podés incluir comparación competitiva y testimonios como “Fast and downloads playlists like crazy”. Google

    desaconseja mencionar competidores en el propio listing.

  - Verificá identidad y una URL oficial para construir confianza y aspirar al badge de publisher establecido.

  - Publicá también en Microsoft Edge Add-ons: ya tenés una review confirmando que funciona en Edge.

  - Medí semanalmente page views, installs, uninstalls, país, idioma, OS y versión. Chrome permite exportar esos datos y atribuir campañas con UTM. Métricas del Store

    ([https://developer.chrome.com/docs/webstore/metrics](https://developer.chrome.com/docs/webstore/metrics)).

  Tu ritmo histórico es unos 1.162 usuarios netos/mes; una captura externa te ubicaba cerca de 10K hace cinco meses, lo que sugiere que recientemente aceleraste a

  aproximadamente 2.200/mes. Para alcanzar 100K en 18 meses necesitás 4.374 netos/mes: alrededor de 2× tu ritmo reciente, no una fantasía imposible.

  ## Sobre los “32 principios”

  Aplicaría: una promesa, producto antes que explicación, números concretos, copy de usuarios, founder/voz humana, un CTA, screenshots fuertes y una descripción recordable.

  Ignoraría: eliminar lo gratuito, hard paywall, pricing y “ser más caro”. Tu objetivo declarado es alcance y utilidad, y la arquitectura local sin servidor te permite

  sostener un producto gratuito. Si algún día querés monetizar, empezaría con donaciones o patrocinio discreto, no degradando el producto.

  Finalmente, tu riesgo más grande no es Enhanced Pro: es la plataforma. Los términos actuales de SoundCloud prohíben copiar o capturar contenido salvo cuando el uploader

  habilitó la descarga u otorgó derechos. Un disclaimer por sí solo no elimina ese riesgo. Para construir algo duradero, orientaría cada vez más el producto a contenido

  autorizado, Creative Commons y backups de los propios artistas. Términos de SoundCloud ([https://soundcloud.com/terms-of-use](https://soundcloud.com/terms-of-use)).

  Mi orden concreto sería: release de cirílico esta semana → listing/video/capturas → review prompt → perfiles completos → carpetas → localización. Eso tiene mucha más

  probabilidad de llevarte de 21K a 100K que copiar la lista de features de Enhanced Pro.

› quiero que hagamos TODO. las descargas de user/tracks ya funcionan. los botones inline del player ya funciona, sigue con working tree actual. lo que si quiero es que ahora

    me hagas la landing que me dijiste. NO interfieras con el working tree actual, solo crea el index.html con el estilado que prefieras, pero la landing que me sirva para

    maximizar clientes. creo que hoy en dia lo que esta de moda es mostrar la UI de la extension dentro de la misma landing, analiza lo que mejor quieras hacer. que sea una

    landing corta, al grano con las features, y aclarando que es GRATIS.

  entonces por ahora solo quiero una landing, nada mas, respeta el working tree y cuando termines comitea s

