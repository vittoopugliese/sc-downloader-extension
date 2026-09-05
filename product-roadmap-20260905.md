# Roadmap de producto: descargas gratis + Looper de pago

Fecha: 2026-09-05. Base inspeccionada: `e37d50f` más el working tree local.

Este documento consolida la conversación de crecimiento, los dos planes de `.cursor/plans/` y el código actual. Es un plan de ejecución: no habilita pagos ni modifica la extensión. Los planes anteriores conservan valor histórico, pero sus casillas pendientes no describen el estado actual.

## 1. Decisiones y límites del producto

- **Gratis para todos:** tracks completos, playlists, álbumes individuales, likes, uploads públicos de perfiles, selección de tracks, botones inline/player, formatos disponibles, metadata, carpeta elegida y descargas en segundo plano. Sin cupos comerciales ni cuenta obligatoria de la extensión. Se mantienen los requisitos de acceso propios de SoundCloud cuando correspondan.
- **Extra de pago:** repetir un rango A–B mientras se escucha y exportar solamente ese rango.
- **Precio objetivo:** USD 2,99. Este plan toma como hipótesis una compra única, de acuerdo con el plan del looper anterior; confirmar modalidad, impuestos mostrados y condiciones antes de integrar checkout. No asumir suscripción.
- Una extensión y una ficha del Store. Mantener el nombre actual inicialmente; presentar el extra como **Looper** dentro del producto.
- Pitch, velocidad, cuantización por BPM, loops guardados y motor sin cortes no bloquean la primera versión comercial.
- Métricas de comportamiento: etapa posterior. Sin SDK, transmisión de eventos ni nuevos identificadores analíticos en los primeros paquetes de producto.

## 2. Qué ya está hecho y qué falta comprobar

| Área | Evidencia local | Estado para este roadmap |
| --- | --- | --- |
| Nombres internacionales | Sanitización y `verify-filenames.js` | Implementado; verificar versión publicada al hacer release |
| Perfil `/user/tracks` | `page-intake.js`, selector y verificador de perfiles | Implementado |
| Botón del player global e inline | `inline-button.js`, intención compartida | Implementado; conservar en regresiones |
| Carpeta elegida y recordada | `directory-storage.js`, `download-destination.js`, popup | Implementado; no rehacer como simple subcarpeta de Downloads |
| Selección granular | Checkbox, All/Clear y selección por ID en popup | Implementado; un rango de índices sería mejora adicional |
| Bulk en background | Job manager, offscreen, pausa/reanudación y recuperación | Implementado |
| Tags y portada | Pipeline de metadata existente | Implementado; no prometer tags en todos los formatos |
| Landing | `index.html` versionado y `CNAME` presente | Creada; despliegue, DNS y HTTPS no comprobados en esta revisión |
| Looper A–B | `looper-core.js`, `looper.js`, bridge MAIN y verificadores | Implementado; no equivale a certificación de audio real |
| Exportar loop | `DOWNLOAD_LOOP` → ejecución → offscreen → recorte WAV | Implementado en cambios locales; pendiente de cierre de release |
| Velocidad y pitch | No se encontró control de `playbackRate` ni pitch en el looper | Ambos pendientes, no solo pitch |
| Pago, licencia y demo comercial | No se encontró implementación | Pendiente |
| Reviews, onboarding e idiomas | Sin flujo de solicitud de reseñas ni `_locales` en lo inspeccionado | Pendiente |
| Analytics de uso | Sin instrumentación localizada | Diferido expresamente |

Verificación realizada: pasaron 12 scripts de looper/core, playback simulado, montaje, bridge MAIN, export de loop, ejecución de descarga, perfiles, filenames, destino, intención de descarga, estado bulk y UX del popup. El test de export utiliza un decoder simulado: no valida codecs reales, consumo de memoria o resultado audible en SoundCloud.

Limitaciones relevantes del export actual: obtiene y decodifica el audio completo antes de recortar; produce WAV PCM de 16 bits, hasta dos canales. No graba el audio que está sonando en vivo ni exporta efectos de pitch/velocidad. No anunciar export instantáneo de mixes largos, calidad original recuperada desde un stream o loops sin cortes.

Documentación atrasada: el plan V1 marca todas las fases pendientes; el README todavía reserva las descargas de loops para después; la landing dice `All features are free`. El viejo roadmap también menciona ZIP en el popup, ya superado por el flujo actual. No reintroducir esa arquitectura.

## 3. Paquetes de código, en orden de ejecución

Tamaños relativos: S = cambio acotado; M = varios componentes; L = integración con servicio externo o varias situaciones de recuperación. No son compromisos de calendario.

### R0 — Cerrar la base actual

**P01 · Cierre de export y regresiones · M · sin dependencias**

- Revisar los cambios locales del export sin mezclarlos con cambios comerciales.
- Probar audio real progressive/HLS, estéreo, rango inicial/final, un track corto y un mix largo; medir tiempo y RAM antes de decidir límites de duración.
- Comprobar error de decodificación, cancelación soportada, navegación durante export, carpeta revocada y colisión con un bulk activo. Documentar la conducta real donde no exista cancelación de export.
- Validar duración audible del WAV y correspondencia con A–B; indicar formato y tiempo seleccionado antes de exportar.
- Ejecutar regresiones de tracks, playlists, likes, perfiles, player global, carpetas y SPA. Actualizar README/plan V1 para reflejar lo confirmado.
- **Aceptación:** WAV correcto en Chrome real, errores comprensibles, límites explícitos si fueran necesarios, y todas las descargas gratuitas conservadas. Confirmar cambios por separado y nueva versión del manifest si corresponde.
- **Archivos:** los siete archivos productivos/de pruebas modificados del export, `verify-loop-download.js`, README y plan V1. No ampliar ahora el motor de audio.

### R1 — Mejorar la experiencia gratuita y mostrar Looper

**P02 · Ayuda, ajustes y primera experiencia · M · después de P01**

- Crear una pantalla pequeña de ajustes/ayuda accesible desde el popup: carpeta actual/cambiar/restablecer, notificaciones, ayuda, soporte y acceso futuro a licencia.
- En primera instalación, mostrar una guía corta al abrir el popup: abrir SoundCloud, usar botón del player o popup, seleccionar una colección. No abrir pestañas en cada actualización.
- Si se abre fuera de SoundCloud, ofrecer un enlace útil y explicar dónde funcionan descargas y looper. No presentar una compra como solución a una página incompatible.
- Explicar Auto, formatos disponibles y original habilitado por artista, sin prometer 320 kbps universal.
- **Aceptación:** desde cualquier estado del popup se puede encontrar ayuda; la guía se descarta y no reaparece; actualizar no cambia preferencias. Reusar el selector de carpeta actual.
- **Archivos:** `popup.html`, `scripts/popup.js`, página de ajustes y su script, manifest; eventos de instalación solo si fueran necesarios.

**P03 · Entrada comercial sutil y demo · M · después de P02**

- Agregar bajo los controles principales un enlace secundario: **“Explore Looper · $2.99”**. Alternativa en español: **“Conocé Looper · USD 2,99”**.
- Texto breve de apoyo: “Repeat a section. Save just that loop. Handy for preparing mixes and auditioning tracks.”
- Abrir una vista compacta con demo A–B, explicación del WAV, precio/modalidad y “Las descargas completas siguen siendo gratis”.
- Reutilizar la demo en la landing. Permitir ocultar la promoción; conservar acceso desde ajustes. Para compradores mostrar “Abrir Looper”.
- Distinguir **Ver demo** de **Probar gratis**. Recomendación V1: demo con audio de ejemplo propio o autorizado, sin trial de licencia todavía. Si se elige “Probar gratis”, definir e implementar antes una prueba real, con límites y vencimiento visibles.
- Hasta terminar P05–P06, mostrar demo y disponibilidad futura; no publicar un checkout falso ni pedir datos como si se vendiera un producto listo.
- **Aceptación:** descargar gratis sigue siendo la acción principal; nada interrumpe descargas, añade notificaciones publicitarias o abre checkout automáticamente. La demo se puede cerrar con teclado.
- **Archivos:** popup, vista de Looper/compra, landing; conectar el botón del looper a esta vista al integrar permisos de uso.

**P04 · Feedback y reputación · S/M · después de P02**

- Accesos permanentes “Dejar una reseña” y “Reportar un problema”.
- Una invitación neutral y descartable después de uso repetido, sin filtrar por opinión positiva ni pedir cinco estrellas. Nunca al instalar ni durante una descarga.
- Guardar solo preferencias/contadores locales de UX; esto no implementa analytics remoto.
- Reporte con versión, tipo de página y código de error; el usuario revisa y envía. Excluir cookies, tokens, URLs firmadas y datos de licencia. URL de track solamente si la persona decide compartirla.
- **Aceptación:** no reaparece después de “No volver a mostrar”; soporte no exige GitHub ni pagar; un fallo no bloquea el acceso a reseñar.
- **Archivos:** ajustes/ayuda, popup, errores normalizados y storage local.

### R2 — Vender el extra sin afectar descargas gratuitas

**P05 · Compra y licencia recuperable · L · depende de decisión comercial D01**

- Elegir proveedor tras validar disponibilidad para cobrar desde Argentina, comisiones fijas/porcentuales a USD 2,99, monedas, reembolsos, webhooks y mecanismo de licencia.
- Usar checkout alojado. No guardar secretos de pago ni recibir tarjetas en la extensión.
- Backend mínimo: crear/verificar compra, procesar webhook autenticado e idempotente, entregar entitlement y restaurar acceso.
- No activar por una redirección `success=true`: confirmar pago en servidor.
- Cachear una concesión firmada con validación periódica y tolerancia offline definida. Estados explícitos: free, active, offline grace, verification required, revoked. La compra única no expira solo porque deba renovarse su comprobación.
- Reinstalación/cambio de computadora: recuperar licencia. Definir política de dispositivos razonable; evitar fingerprint invasivo. Reembolsos/revocaciones se aplican al extra.
- **Aceptación:** compra y restauración verificadas en entorno de pruebas, webhook repetido sin duplicaciones, checkout cancelado sin cobro aparente, y caída de red manejada. El backend nunca es dependencia de una descarga completa.
- **Archivos:** servicio nuevo de licencias y backend, almacenamiento y UI de activación; manifest únicamente con permisos requeridos por esta integración.

**P06 · Aplicar el acceso a Looper · M · depende de P03 y P05**

- Mantener política central de capacidades, por ejemplo `canUse('looper')` y `canUse('loop_export')`, ambas otorgadas por el mismo extra.
- Verificar al activar looper y antes de ejecutar `DOWNLOAD_LOOP` en background. El código de audio no conoce proveedor de pagos.
- Validar mensajes y rangos; impedir que un comando gratuito acepte un `trimRange` premium por otra ruta. Tratar los mensajes del bridge MAIN como entradas no confiables, nunca como autoridad de licencia.
- Los comandos `DOWNLOAD_SINGLE_TRACK` y `START_BULK_JOB` funcionan sin licencia ni red de pagos. No meter cupos premium en la selección, formatos, destinos o metadata existentes.
- Si una verificación falla, explicar el problema solo donde corresponde a Looper. Prever gracia offline para compradores.
- Protección proporcional al precio: el JavaScript instalado es inspeccionable/modificable. No prometer DRM invulnerable ni agregar un sistema invasivo para dificultar ese caso.
- **Aceptación:** matriz free/active/offline/revoked cubriendo popup, player, inline, bulk y export. Un mensaje directo de export sin autorización es rechazado; las descargas completas siguen funcionando.
- **Archivos:** licencias, `looper.js`, `background.js`, comandos de descarga y verificadores de acceso/regresión.

**P07 · Landing y documentación coherentes con el precio · S/M · depende de P03; venta pública después de P05–P06**

- Mantener CTA principal “Add to Chrome — free downloads”. Cambiar `All features are free` por “Full-track downloads are free”.
- Sección breve: descargas completas gratuitas / Looper + export de fragmentos USD 2,99, modalidad visible y enlace al checkout real cuando esté listo.
- Añadir demo del rango A–B y aclarar formato WAV. Evitar “live recording” o “seamless” si el producto no lo hace.
- Publicar ayuda y política de privacidad accesibles desde sitio y extensión, coherentes con proveedores y datos de compra. Aún no declarar analytics de uso inexistente.
- **Aceptación:** ninguna pantalla insinúa que hay que pagar para descargar un track completo; ninguna promete que Looper es gratis; mobile dirige a instalación de escritorio.
- **Archivos:** `index.html`, páginas de ayuda/privacidad, README y copy reutilizado en popup.

### R3 — Calidad y alcance después del primer lanzamiento comercial

**P08 · Final de descarga útil y reintento de fallidas · M**

- Resumen de guardadas/fallidas con motivo y botón para reintentar solo IDs fallidos; no repetir las ya guardadas.
- Mostrar el destino real. En descargas del navegador, considerar “Mostrar archivo”; con File System Access no prometer abrir una carpeta arbitraria en el explorador: mostrar su nombre y acciones realmente disponibles.
- **Aceptación:** reintentos conservan orden, destino y formato; un batch parcialmente exitoso no parece un fracaso total. También aplica a la versión gratuita.
- **Archivos:** job manager, destino, popup/estado y verificadores bulk.

**P09 · Idiomas y textos consistentes · M**

- Extraer strings visibles a `_locales`/`chrome.i18n`, comenzando por inglés y español. El looper actualmente tiene texto español junto a una UI inglesa.
- Priorizar ruso y portugués brasileño, y después alemán, según países/idiomas del dashboard; las reseñas son una señal, no una medición de toda la audiencia.
- Localizar también errores, compra, restauración y metadatos de ficha; no declarar idiomas sin traducir.
- **Aceptación:** sin claves vacías ni desbordes del popup; fallback inglés; cambio de locale sin perder licencia o carpeta.

**P10 · Evitar duplicados y seleccionar rangos · M · después de P08**

- Historial local mínimo por ID de track, formato y resultado confirmado; distinguir track completo de cada rango exportado.
- “Omitir ya descargadas” optativo, con posibilidad de volver a descargar. Aclarar que un registro local no prueba que el archivo siga existiendo.
- Rango de selección 51–100 complementario a los checkboxes, sin rehacer el selector.
- **Aceptación:** no se omite otro formato ni una descarga fallida; sin sincronización/telemetría implícita. Funciones de organización gratuitas.

**P11 · Más puntos de descarga · M · backlog por demanda**

- Revisar si los botones actuales cubren cada tarjeta en feed/búsqueda; el botón del player global ya resuelve el track sonando.
- Reposts y listado `/user/albums` solo si hay demanda repetida. No confundir álbum individual `/sets/` ya soportado con exportar todo el listado de álbumes de un usuario.
- **Aceptación:** agregar un contexto reutiliza intake e intención de descarga; no duplica reglas ni cambia el precio del downloader.

**P12 · Mejoras musicales · L · deliberadamente después**

- Velocidad dentro del loop, restaurando estado previo al salir.
- Pitch independiente y decisión explícita sobre export con/sin efectos.
- Evaluar precisión, crossfade o procesamiento por fragmentos si los datos de uso y problemas reales lo justifican.
- No incluir estas promesas en la primera venta. La mejora del procesamiento para mixes largos puede adelantarse si P01 demuestra que el export actual no es viable para el caso anunciado.

## 4. Métricas de comportamiento — etapa posterior

**A01 · Especificación y privacidad · M · después de tener el flujo comercial estable**

La relación `clicks Pro / (popups abiertos + descargas ejecutadas)` puede servir como índice de actividad, pero no como conversión: mezcla eventos distintos y puede contar varias veces a la misma persona. Guardar los componentes y calcular ratios por superficie.

| Evento propuesto | Momento preciso | Campos acotados |
| --- | --- | --- |
| `popup_opened` | Una vez por apertura, no por rerender | versión, plataforma, sesión |
| `pro_entry_viewed` | Promoción efectivamente visible | superficie popup/player/track/landing |
| `pro_entry_clicked` | Click humano en la promoción | misma superficie |
| `pro_demo_started` | Inicia la demo | superficie |
| `download_requested` | Intención de descargar | origen popup/player/inline, tipo single/bulk/loop |
| `download_job_completed` | Operación de usuario terminada | cantidades exitosas/fallidas, tipo/origen |
| `download_file_saved` | Archivo confirmado guardado | tipo/origen, sin título ni URL |
| `checkout_opened` | Abre checkout | producto y moneda |
| `purchase_confirmed` | Webhook del servidor confirmado | producto; deduplicación interna |
| `license_activated` | Entitlement válido | versión de extensión |
| `looper_used` / `loop_export_saved` | Uso real / archivo confirmado | resultado, no datos del audio |

**A02 · Instrumentación y dashboard · M/L · depende de A01**

- Propagar `origin` desde el botón hasta el resultado, para atribuir descargas que terminan con popup cerrado.
- Deduplicar eventos, retries de envío y webhooks. Una playlist de 100 tracks es 1 job y hasta 100 archivos, no 100 oportunidades de compra equivalentes.
- Separar datos mínimos operativos de compra/licencia de analytics opcional. No posponer recibos o restauración hasta esta fase.
- Propuesta de privacidad: estadísticas opcionales con consentimiento explícito, cola acotada y borrable; no URL/título/artista/audio, cookies OAuth, email ni licencia en eventos analíticos. Definir retención y limpieza de logs del servidor.
- Si se necesita un identificador de instalación para deduplicar personas aproximadas, describirlo como seudónimo, no anónimo; separar el identificador de la licencia y explicar sesgos por reinstalación/dispositivos.
- Analizar cohortes observadas/consentidas; no extrapolar automáticamente al total de instalaciones.
- Conservar el índice solicitado como `clicks Pro / (popup_opened + download_job_completed)`, etiquetado **interacciones Pro por actividad**, con ventana fija y sin llamarlo porcentaje de usuarios convertidos.
- Ratios principales: CTR por superficie = clicks / exposiciones; compra = compras confirmadas / checkouts únicos; activación = licencias activadas / compras; valor real = compradores que usaron Looper/exportaron.
- Para saber el porcentaje de usuarios interesados, deduplicar instalaciones expuestas que hacen click en la misma ventana. Las sumas de aperturas/descargas no sirven como denominador de usuarios.
- **Aceptación:** un flujo conocido produce conteos esperados; reinstalar/reintentar/popup cerrado no infla compras; desactivar estadísticas deja de transmitir y no afecta descargas ni licencia.

## 5. Tareas manuales y de promoción

| ID | Acción concreta | Cuándo / definición de terminado |
| --- | --- | --- |
| M01 | Exportar CSV del dashboard: usuarios, vistas, instalaciones/desinstalaciones, países, idiomas, OS y versiones de los últimos 90 días | Antes de priorizar locales y comparar releases. No requieren instrumentar la extensión |
| M02 | Responder reseñas sobre bugs resueltos con versión y soporte específicos | Después de confirmar que esa versión está publicada; no afirmar “todo resuelto” genéricamente |
| M03 | Grabar video nuevo con el guion inferior | Cuando P01 y la UI comercial estén estables; usar música propia/autorizada |
| M04 | Crear cinco capturas y promo tile | Mostrar UI real, texto legible a tamaño reducido; especificaciones verificadas al subir |
| M05 | Actualizar ficha y detalles de publicación | Resumen, descripción, idiomas, extra pago, privacidad, soporte; no cambiar el nombre solo para meter keywords |
| M06 | Verificar sitio/dominio, identidad de publisher, HTTPS y enlaces | `CNAME` no demuestra por sí solo despliegue correcto; no contar el badge como garantizado |
| M07 | Evaluar publicación en Edge Add-ons | Tras estabilizar release comercial; probar carpeta, offscreen y restauración antes de prometer compatibilidad |
| M08 | Difusión dirigida y seguimiento | Demo útil en comunidades que lo permitan, autoría explícita, sin spam. UTM por canal. Newsletter/donaciones/patrocinio no son prioridades de este lanzamiento |

### Video principal: 55–60 segundos

1. **0–5 s:** enseñar el resultado, una carpeta con tracks completos. Texto: “SoundCloud downloads. Free.”
2. **5–14 s:** descargar desde el player; mostrar que no hay que abandonar la página.
3. **14–27 s:** playlist o perfil, elegir tracks/carpeta, comenzar batch y cerrar popup; mostrar progreso/resultados.
4. **27–35 s:** archivo con nombre internacional, tags y portada; indicar original solo cuando está disponible.
5. **35–49 s:** “Optional Looper · $2.99 one-time”, si se confirma compra única. Mover A/B, oír repetición, exportar WAV y comprobar su duración.
6. **49–60 s:** “Full tracks & playlists stay free. Add to Chrome.” CTA e identidad del desarrollador.

Grabar también un corte de 15–20 segundos solo de Looper para su vista comercial: marcar → escuchar → exportar → precio. No incluir pitch/velocidad no implementados. La demo debe demostrar que se ahorra abrir un editor para una selección sencilla.

### Cinco capturas

1. Track + player: “Download right from SoundCloud — free”.
2. Playlist/perfil + selector: “Choose a few. Download them all.”
3. Background + carpeta final: “Close the popup. Downloads keep going.”
4. Archivos/tags/destino: “Your music, organized.”
5. Looper con A/B + botón WAV: “Loop & export a section — optional $2.99 add-on”.

## 6. Decisiones antes de cobrar

- **D01:** confirmar compra única USD 2,99, proveedor, precio final/impuestos y condiciones de reembolso/dispositivos. Bloquea P05, no P01–P04.
- **D02:** demo o trial real. Recomendación: demo en V1; prueba con licencia posteriormente si hace falta. No usar “Probar gratis” para un botón que solo lleva a pagar.
- **D03:** comprobar si usuarios públicos ya recibieron el looper gratis. Si fue beta distribuida, comunicar transición y decidir acceso para testers; no asumir que solo existe localmente.
- **D04:** condiciones operativas de caché/gracia offline, restauración y soporte, documentadas antes de activar el paywall.

## 7. Próximo trabajo recomendado

**Primer paquete ejecutable:** P01 → P02 → P03. Permite cerrar lo existente, mejorar ayuda y mostrar la propuesta comercial sin esperar pitch o analytics.

Después: P04; resolver D01 y completar P05–P06; cerrar P07 y M03–M06 para publicar la venta. P08–P09 siguen por impacto en uso y reputación. A01–A02 quedan explícitamente después; P10–P12 se priorizan con señales reales.

Cada paquete debe tener un diff separado y una validación de comportamiento. No mezclar el working tree del export con refactors generales, ni ejecutar automáticamente todo el antiguo plan arquitectónico como requisito para monetizar.

## Fuentes operativas consultadas

- [Chrome Web Store: publicación gratuita o de pago con sistema de pago externo](https://developer.chrome.com/docs/webstore/about).
- [Requisitos al aceptar pagos](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment).
- [Políticas del Store: datos, permisos y disclosures](https://developer.chrome.com/docs/webstore/program-policies/policies?hl=en).
- [Actualización de políticas de privacidad de 2026](https://developer.chrome.com/blog/cws-policy-updates-2026?hl=en).
- [Métricas del dashboard](https://developer.chrome.com/docs/webstore/metrics).
- [Guía de imágenes y texto del listing](https://developer.chrome.com/docs/webstore/best-listing).

Las condiciones específicas del proveedor de pagos y el detalle de disclosures se deben verificar al implementarlos; este documento no elige proveedor ni estima ingresos netos.
