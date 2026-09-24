# Estado comprobado y guía para el siguiente agente

Fecha: 23/09/2026. Base inspeccionada: `73fceb8e7db004fb5cf535a3ee8b26692b6b4faf`, versión `2026.10.5`, árbol limpio al iniciar. Alcance acumulado: revisión documental, corrección de copy/SEO, reparación de fixtures E2E, gate local completo y preparación de infraestructura. No se publicó la extensión ni se desplegó todavía el Worker; sí se crearon y migraron las D1 remotas de test y producción.

## Veredicto y precedencia

**No está cerrado al 100% el plan 00.** Hay una base técnica extensa, trabajo local previamente cerrado, una regresión reproducida y corregida en este árbol, gates externos abiertos y planes de evolución que nunca equivalieron a una implementación.

Esta síntesis tiene precedencia para el **estado y orden de trabajo** sobre los encabezados históricos de 00, 01, 04, 10 y `docs/README.md`. Los planes detallados conservan sus criterios de aceptación. No volver a implementar un problema histórico sin comprobar primero HEAD. Tampoco convertir un addendum de cierre local en evidencia de lanzamiento.

El usuario informa que Lemon Squeezy no le permite cargar su cuenta Wise USD a su nombre y considera Paddle. Es una dependencia comercial reabierta, no una decisión definitiva de migración ni una aprobación del producto por Paddle.

### Actualización posterior — M17 corregido en el árbol de trabajo

La landing y sus cinco traducciones dejaron de mostrar `46% OFF`, el precio futuro USD 6.79 y la promesa ambigua de que el trial empieza una sola vez. El copy ahora describe una prueba limitada al perfil actual de Chrome, sin cuenta ni fingerprinting. También se actualizó el módulo opcional de Store en cinco idiomas para describir el EQ paramétrico implementado, en vez de un EQ de tres bandas.

Evidencia posterior: `npm test` pasa sus 48 verificadores (Chromium se ejecutó fuera del sandbox por la restricción de macOS), `npm run test:player-tools` pasa los cinco verificadores y los 27 tests del servicio, y `git diff --check` pasa. M17 queda corregido en el árbol de trabajo. Una comprobación HTTP confirmó que `https://sctd.vpugliese.online/` responde 200 y que `soundcloud-downloader.online` no resuelve; canonical, Open Graph, robots y sitemap se alinearon al dominio activo y el sitemap dejó de listar anclas como páginas. Siguen pendientes el QA de navegador del candidato completo, ZIP trazable, SoundCloud real, ChromeOS y C4–C7 externos.

### Actualización posterior — gate local completo y alcance real de M18

El gate `test:release-local` pasa completo después de reparar dos fixtures E2E desactualizados: el popup de layout ahora declara el stub de Contact que su handler necesita, y el looper usa un WAV seekable, un entitlement de desarrollo válido y un blob interno accesible por el documento offscreen. Pasan descarga, popup en cuatro escalas, looper con render Signalsmith y archivo final, tempo, tres variantes de FX, tres variantes y editor del EQ paramétrico, paquete y smoke del ZIP. `test:e2e:likes` también pasa y quedó incorporado al gate para ejecuciones futuras.

Se generó un **ZIP diagnóstico de Test Mode**, no publicable, con endpoint `https://sctd-test.vpugliese.online`, clave pública de fixture `test-p256-1` y SHA-256 `1d726e80321979d431de56ebd43723ed24f8157936b0f7180a3737b4500cab96`. Su procedencia y sus bytes pasaron el smoke. El candidato comercial todavía debe regenerarse con el Worker desplegado, la clave pública real y un árbol confirmado.

M18 no era un bug único: es el gate que agrupa C4 sandbox auténtico, C5 producción/comercial, C6 Store y C7 operación. La porción local queda cerrada. La porción externa no puede declararse cerrada sin cuenta aprobada, IDs/secretos reales, D1 remoto, deploy, compra/restore/refund observados, ZIP final, publicación y monitoreo. Esos resultados no se sustituyen con mocks ni con este ZIP diagnóstico.

Avance externo posterior: Wrangler `4.137.0` quedó instalado y autenticado en la cuenta Cloudflare del proyecto. Se crearon D1 separadas en ENAM —test `3a4733a3-6cc0-4fc3-9ba8-0ae165e6824d` y producción `e1ade631-ca28-4020-98b2-f30e198159a3`— y se aplicaron las seis migraciones a ambas; `wrangler d1 migrations list --remote` no informa pendientes. También se generaron pares ES256 independientes; los privados están en archivos `.dev.vars.*` ignorados con modo `0600` y los JWKS públicos no contienen `d`. `wrangler.jsonc` ya contiene rutas, D1, rate limits, orígenes y key IDs separados.

El deploy sigue deliberadamente bloqueado: no existen todavía los Workers `sctd-player-tools-license-test`/`sctd-player-tools-license`; el subdominio de test no resuelve y la ruta live cae en el 404 de GitHub Pages. Preflight y deploy real requieren los IDs numéricos Store/Product/Variant de Lemon y cuatro secretos por entorno (`LEMON_API_KEY`, `LEMON_WEBHOOK_SECRET`, `ENTITLEMENT_PRIVATE_JWK`, `ADMIN_TOKEN`). No instalar valores ficticios: harían que health pareciera configurado mientras checkout/webhook fallan.

## Evidencia obtenida en esta sesión

| Comprobación | Resultado y alcance |
| --- | --- |
| `npm test` | **Pasa los 48 verificadores** después de corregir M17. Chromium requirió ejecución fuera del sandbox por `bootstrap_check_in ... Permission denied`; ese bloqueo era del entorno. |
| Diagnóstico previo a la corrección | 47 de 48 verificadores pasaban al ejecutarlos individualmente; el único fallo de producto era el contrato comercial. Se conservó la aserción y se corrigió el copy. |
| `npm run test:player-tools` | Pasa policy/access/client/commerce/login y **27 tests** del servicio, sin skips. Son pruebas locales, con proveedor simulado; no certifican transacciones Lemon. |
| `npm run test:release-local` + Likes | Pasa descarga, popup, looper, tempo, FX, EQ, Likes, package y smoke del ZIP. Likes quedó incorporado al comando para futuras ejecuciones. |
| Código e infraestructura | Worker, migraciones, preflight y administración siguen acoplados a Lemon. D1 test/live están migradas y la configuración compila; no hay Worker desplegado ni integración Paddle. |
| SoundCloud real, ChromeOS, transacciones y Store | No certificados. Siguen siendo gates manuales/externos y no se sustituyen con el ZIP diagnóstico. |

Regresión corregida: `index.html` mostraba `46% OFF`, `Future price` y USD 6.79; `scripts/landing-i18n.js` conservaba esas cadenas y una promesa de trial incompatible en cinco idiomas. Contradecía M17 y disparaba la aserción de `scripts/verify-commercial-contract.js`. Se corrigieron las superficies y se conservó la prueba.

Los logs de diagnóstico se generaron en `/tmp/sc-doc-audit-*`; son temporales. Este documento conserva resultados y comandos, no depende de que esos archivos sigan presentes en otra sesión.

## Estado de las etapas de planning-20260915

| Documento / etapa | Estado real y siguiente trabajo |
| --- | --- |
| **00 — entrada general** | No cerrado. Acumula órdenes incompatibles y estados históricos. Usar esta síntesis y conservar los criterios detallados enlazados. |
| **01 — monetización, trial y medición** | Base implementada. Trial por perfil local, recibos firmados y dos perfiles tienen pruebas. Venta, recuperación y reembolso reales siguen pendientes; analítica implementada no equivale a embudo observado. |
| **02 — header y reseñas** | Cerrada por decisión registrada en 00. Conservar y verificar sobre candidato, sin reabrir un rediseño por el texto antiguo. El plan separado de header del 22/09 tiene código posterior; ver abajo. |
| **03 y 09 — Store y cinco idiomas** | Materiales preparados, no evidencia de publicación. El módulo opcional ya describe el EQ paramétrico implementado. Todavía hay que verificar traducciones, screenshots y ficha visible contra el candidato. |
| **04 — EQ Pro y export** | EQ paramétrico en vivo implementado. El registro del 22/09 en 10 y el código de audio también incluyen EQ/FX offline; el encabezado de 04 que deja export pendiente está atrasado. No reconstruir un EQ de tres bandas. Falta certificación del recorrido real y ZIP actual. |
| **05 — presets y persistencia** | Parcial: existen velocidades guardadas, ajustes persistidos y presets FX de fábrica. No equivalen a biblioteca completa con nombre, CRUD, migración y loops por track. Es la primera mejora de producto recomendada después del cierre comercial. |
| **06 — landing/SEO** | La inconsistencia de dominio y las anclas del sitemap se corrigieron tras comprobar el dominio activo. El SEO avanzado y la observación posterior al despliegue siguen pendientes. |
| **07 — guiones y capturas** | Briefs y guiones preparados. No hay evidencia suficiente en esta revisión para declarar grabadas/publicadas todas las piezas. Capturar la UI del candidato y separar demostración de prueba funcional. |
| **08 — backlog** | Ideas conservadas, no checklist de implementación completado. El cierre histórico de Explorer no cancela el plan de optimización reabierto el 20/09. Esa evolución no bloquea por sí sola la release actual. |
| **10 — release C1–C7** | C1–C3 y el gate local automatizado están verdes; existe un ZIP diagnóstico trazable de Test Mode. Falta el candidato con configuración real, SoundCloud/ChromeOS manual y C4–C7 externos. |
| **11 — tutorial Lemon** | Runbook de la integración existente. Su ejecución comercial queda condicionada a resolver proveedor/payout; no sirve como tutorial Paddle cambiando nombres. |

### Qué conservar del cierre M01–M18

- M02–M15: el addendum registra implementación y hay regresiones locales verdes para los recorridos correspondientes. No reabrirlos todos a partir de las reproducciones de `aebd76b`; comprobar sólo discrepancias actuales. M15 incluye ahora el gate completo de navegador/ZIP y Likes Explorer.
- M01: el contrato por perfil local sigue implementado y comunicado honestamente, pero el usuario reabrió el requisito para resistir reinstalación y múltiples perfiles. Eso exige una identidad de cuenta verificable por el servidor; no queda resuelto añadiendo otro UUID local.
- M16: cierre de higiene registrado; volver a comprobar el artefacto al publicar. No reproducir datos privados de feedback en informes nuevos.
- **M17 corregido en el árbol de trabajo:** se retiró precio/descuento futuro y se alineó el trial por perfil en la landing y sus cinco traducciones.
- **M18 local cerrado; C4–C7 externos abiertos:** sandbox auténtico, Live/comercial, Store y operación. Un health verde o un ZIP con fixtures no demuestra una compra.

## Mapa del resto de documentos

Se revisó el inventario documental, sus estados, actualizaciones y dependencias; el contraste de implementación fue dirigido a los puntos que cambian la prioridad. Esto no es una auditoría exhaustiva línea por línea de toda la extensión ni certifica cada checkbox histórico.

| Documentos | Cómo utilizarlos ahora |
| --- | --- |
| `audits/C1-C4-MITIGATION-PLAN-20260923.md`, `audits/C1-C4-HANDOFF-20260922.md` | Contratos y regresiones de licencias/release. Leer el addendum posterior a `33ce31f`, además del diagnóstico inicial. |
| `audits/RELIABILITY-CLOSURE-PLAN-20260921.md` | Criterios R0–R7: recovery, historial, cuotas, accesibilidad, audio, memoria y ZIP. Reconciliar con cambios posteriores; los pendientes viejos no prueban ausencia de código actual. |
| `audits/CODEBASE-AUDIT-20260921.md`, `audits/FEEDBACK-FIX-PLAN-20260921.md` | Evidencia y tareas de confiabilidad. Feedback de versiones anteriores no demuestra un fallo actual ni que un fix ya llegó a usuarios. |
| `audits/RELIABILITY-MITIGATION-PLAN-20260920.md`, `audits/RELIABILITY-IMPLEMENTATION-HANDOFF-20260920.md`, `audits/RELIABILITY-IMPLEMENTATION-PROGRESS-20260920.md` | Antecedentes y criterios todavía útiles; no reiniciar toda la mitigación M1–M8 del 20/09. No confundirla con M01–M18 del 23/09. |
| `audits/download-diagnosis-20260916.md`, `audits/uninstall-diagnosis-20260920.md` | Reproducciones históricas, causalidad limitada y matriz de medición real. Mantener QA de instalación, HLS, concurrencia, memoria y ChromeOS. |
| `FREE-DOWNLOAD-MANUAL-TEST-CHECKLIST.md` | Matriz manual del candidato; descargas gratis deben sobrevivir a caída/revocación del servicio de licencias. |
| `LIKES-EXPLORER-IMPLEMENTATION-PLAN-20260912.md`, `LIKES-EXPLORER-HANDOFF-20260916.md` | Explorer V1 ya existe. Conservar aislamiento, biblioteca, búsqueda y navegación; completar comprobaciones reales del candidato. |
| `LIKES-EXPLORER-OPTIMIZATION-PLAN-20260920.md` | Evolución: medir, reducir reconstrucción, portadas locales primero, consultas paginadas y colecciones de terceros. Parte de la confiabilidad se adelantó; contrastar cada etapa antes de editar. |
| `PLAYER-TOOLS-PRODUCT-AND-TECHNICAL-PLAN-20260912.md`, `PLAYER-TOOLS-FOUNDATION-HANDOFF-20260913.md` | Fundamentos y decisiones. Su modelo de autoridad evolucionó a D1/recibos; no restaurar accidentalmente cuotas o licencias puramente locales. |
| `PLAYER-TOOLS-HEADER-PLAN-20260922.md` | Encabezado desactualizado: dice «listo para implementar», pero HEAD contiene `resetPlayerTools`, `controlsHidden`, `cycleControlsVisibility` y handlers de papelera/visibilidad. Revisar el comportamiento final y QA, no duplicar los controles. El texto visible también difiere del boceto original. |
| `LOOPER-PRODUCT-IMPLEMENTATION-PLAN-20260920.md` | Backlog: biblioteca de loops, regiones, undo, práctica/BPM, export por lotes y rendimiento. Empezar por biblioteca local mínima, no por toda la lista. |
| `PLAYER-TOOLS-INSTRUMENT-FX-SAMPLER-PLAN-20260923.md` | Borrador de flanger/phaser/freeze/bitcrusher/saturación, teclado instrumental y slices. Los seis pads existentes no equivalen a este plan terminado. Decisiones de sección 3 pendientes. |
| `architecture-improvement-plan-20260905.md` | Refactor histórico parcialmente superado por módulos actuales. Extraer responsabilidades cuando desbloqueen una entrega concreta; no perseguir las metas antiguas de líneas. |
| `product-launch-plan-20260905.md`, `product-roadmap-20260905.md` | Antecedentes. Precio, cuota, seats y orden antiguos no prevalecen sobre el contrato actualizado. |
| `payment-options-20260905.md`, `payment-provider-research-20260907.md` | Investigación histórica. La candidatura exclusiva de Lemon se reabre por el problema Wise reportado; ver evidencia oficial actual abajo. |
| `COLD-AUDIT-HANDOFF-9dc9f1b.md`, `LOOPING-PLAYER-PANEL-AUDIT-6822c9.md`, `LOOPING-PLAYER-PANEL-RESEARCH-20260909.md`, `TEMPO-INTEGRATION-AUDIT.md`, `FEATURE-MAP-SOUNDCLOUD-EXTENSIONS.md` | Contexto técnico y auditorías de bases antiguas. No son el estado actual ni una orden de copiar funciones de otros productos. |
| `contact-content.md` | Contrato del contenido remoto de Contact; no confundir contenido JSON con código remoto ni con licencias. |
| `README.md`, `TESTING.md`, `services/player-tools-license/README.md`, `services/uninstall-feedback/README.md`, `THIRD_PARTY_LICENSES.md` | Operación, pruebas y distribución. Mantener separación feedback/licencias y notices de terceros. TESTING no reemplaza la matriz de release. |

## M01 reabierto — identidad resistente a reinstalación

El gating vigente ya protege el valor principal: EQ paramétrico, edición precisa y exportaciones son Pro; la prueba permite hasta veinte loops A–B durante siete días y después bloquea las herramientas musicales. D1 firma y cuenta los consumos por installation ID. Lo que no puede demostrar es que dos installation IDs pertenezcan a la misma persona.

Para cumplir el nuevo requisito sin fingerprinting, la opción recomendada es pedir inicio de sesión explícito para comenzar la prueba y hacer que el Worker verifique un token OAuth; el subject estable y hasheado pasa a ser la autoridad del trial. `chrome.identity.getProfileUserInfo()` por sí solo no alcanza porque el cliente podría declarar otro ID: el servidor debe verificar el token. Esto requiere elegir proveedor de identidad, registrar el cliente OAuth, añadir permisos y consentimiento, actualizar privacidad/Store, migrar D1 y decidir qué ocurre con perfiles sin sesión. Hasta esa decisión y configuración externa, M01 queda reabierto; el modelo local actual permanece seguro y honesto, pero evadible mediante otra cuenta o identidad.

No existe una solución técnica que garantice «una prueba por persona» contra alguien que use otra cuenta legítima sin recolectar identidad más fuerte. La meta razonable es una prueba por cuenta verificada, con rate limits y detección de abuso, sin fingerprinting.

## Payout — Lemon y Stripe directo

Lemon Squeezy publica que Argentina admite payout bancario y PayPal verificado. Su documentación no publica un formato especial de 19 o 21 dígitos; para una cuenta argentina, el CBU/CVU oficial tiene 22 dígitos. Una cuenta Wise USD entrega datos ACH estadounidenses distintos y puede ser rechazada si el formulario está configurado para país Argentina o si titularidad/país no coinciden. Antes de abrir otra cuenta Lemon, obtener el nombre exacto del campo y consultar soporte sobre esa cuenta Wise concreta; una cuenta duplicada repetiría KYC y no corrige el formato.

Stripe Payments directo no lista Argentina entre sus países soportados. Tener routing/account number de EE. UU. no convierte por sí solo a una persona residente en Argentina en un comercio estadounidense admitido. Usarlo directamente requeriría una entidad y onboarding válidos en un país soportado —por ejemplo una entidad de EE. UU.— y además deja impuestos, refunds y operación a cargo del vendedor, a diferencia del Merchant of Record. No crear una cuenta con país o entidad incorrectos.

Fuentes oficiales verificadas el 23/09/2026: [Lemon — países soportados](https://docs.lemonsqueezy.com/help/getting-started/supported-countries), [Lemon — payouts](https://docs.lemonsqueezy.com/help/getting-started/getting-paid), [Stripe — disponibilidad global](https://stripe.com/global), [BCRA — CBU de 22 dígitos](https://www.bcra.gob.ar/clave-bancaria-uniforme-cbu/).

## Paddle, Wise y la decisión del proveedor

Fuentes oficiales consultadas el 23/09/2026, incluida documentación técnica mediante Context7:

1. **Wise es plausible:** Paddle menciona TransferWise y permite usar datos bancarios que ese servicio proporcione. Publica retiros mensuales y umbral mínimo de USD 100. Esto no garantiza aceptar esta cuenta personal USD concreta, la titularidad o el circuito bancario elegido. [Payouts de Paddle](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid).
2. **El obstáculo principal es el producto:** su política enumera “streaming downloaders” dentro de categorías prohibidas vinculadas a infracción de derechos o condiciones de terceros. Dada la función de esta extensión, hay un riesgo directo de incompatibilidad. No asumir aprobación porque acepte Wise o porque lo cobrado se llame Player Tools. Presentar el producto completo y obtener respuesta expresa antes de invertir en la migración. [Política oficial](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle).
3. **Precio:** para productos por debajo de USD 10, Paddle pide contactar para pricing específico. No asumir un neto definitivo para USD 3,69 usando sólo la tarifa pública general. [Pricing](https://www.paddle.com/pricing).
4. **Licencias:** Paddle Billing deja el fulfillment de compras únicas a la aplicación; propone `transaction.completed` para generar/entregar accesos o claves propias. No trasplantar las APIs de claves/instancias de Lemon. [Migración y fulfillment](https://developer.paddle.com/migrate/start), [equivalencias de flujos](https://developer.paddle.com/migrate/plan/workflow-mapping).

**Recomendación:** primero resolver aceptación del producto + payout + condiciones para USD 3,69. Mientras llega esa respuesta, avanzar con regresiones, QA y preparación independiente del proveedor. No se contactó a Paddle ni a Lemon en esta sesión.

Si se consulta soporte, incluir: vendedor persona física residente en Argentina, cuenta Wise USD a su mismo nombre, tipo personal/Business real, extensión Chrome que descarga audio de SoundCloud y ofrece Looper/FX/export, enlaces de producto y compra única propuesta. Pedir confirmación de producto y circuito de retiro. No enviar números de cuenta o documentos sensibles en el repositorio.

### Si Paddle resulta viable: implementación acotada

1. Registrar decisión y aceptación; mantener Lemon como integración existente hasta tener el reemplazo probado. Si ya existen compradores/licencias reales, planificar compatibilidad antes de retirar nada; su existencia no fue comprobada en esta revisión.
2. Separar el adaptador de pagos del servicio de entitlements. Reutilizar FREE/trial/PRO, ES256, treinta días, dos perfiles, rate limits, anclas de reloj, grants y reglas de revocación.
3. Crear una migración aditiva con IDs internos de licencia/activación y referencias `provider`, entorno, compra, cliente, producto/precio. El esquema actual tiene `lemon_license_id`, `lemon_instance_id` y `lemon_order_id`: cambiar sólo URLs no alcanza. No editar migraciones ya aplicadas ni mezclar IDs sandbox/live.
4. Implementar checkout externo con producto/precio permitidos del lado servidor; definir la página de checkout requerida por la modalidad Paddle elegida. La pantalla de éxito jamás concede PRO.
5. Verificar webhooks sobre cuerpo crudo y `Paddle-Signature`, deduplicar por evento y aplicar efectos durables. Manejar entregas fuera de orden y reintentos sin doble licencia. [Firma oficial](https://developer.paddle.com/webhooks/signature-verification).
6. Emitir credencial propia segura y definir su entrega y recuperación. Conservar email + clave como interfaz si se desea minimizar cambios, guardar sólo hash y resolver cómo se entrega/reemite sin filtrar secretos. El email solo no autentica al comprador. Una compra sin camino de recuperación no está terminada.
7. Implementar en D1 reserva atómica de dos perfiles y release/reactivación propios. Reconciliar estado de compra y ajustes/reembolsos con Paddle; confirmar eventos y estados en documentación vigente antes de codificar. Refund total confirmado revoca; parcial queda para revisión conforme al contrato existente; error de API no revoca.
8. Adaptar preflight, health, variables, administración, fixtures y runbook. Repetir C4 completo en sandbox auténtico y luego C5–C7. Pruebas Lemon verdes no certifican el adaptador Paddle.

## Orden recomendado de implementación

### Entrega 1 — Recuperar una base local verificable

- Completado: corregir M17 en landing y cinco traducciones; alinear trial por perfil, precio y capacidad real conservando los tests del contrato.
- Completado para los puntos detectados: reconciliar EQ/export, header implementado, precio, ausencia de cierre externo y texto de EQ en 09.
- Completado: `npm test` y `npm run test:player-tools`; Contact pasó con Chromium fuera del sandbox.
- Completado: gate automatizado completo de navegador; `test:e2e:likes` también pasó y quedó agregado a `test:release-local`.
- Completado para diagnóstico: ZIP de Test Mode con procedencia, smoke y SHA registrados. Falta regenerar el candidato comercial con endpoint/JWK reales y árbol confirmado. SoundCloud real y ChromeOS permanecen en la matriz manual.

Salida: no quedan fallos locales conocidos sin explicar; cada límite pendiente está asociado a una prueba concreta, no a «revisar todo».

### Entrega 2 — Cobro recuperable y publicación

- Resolver proveedor/payout con los datos reales; integrar Paddle sólo si resulta viable.
- C4: checkout cancelado/exitoso, webhook, activación/restore, dos perfiles y tercero rechazado, release/reactivación, renovación online/offline, duplicados y refund. Correlacionar compra, D1 y extensión.
- C5: condiciones comerciales, soporte, privacidad/términos/refund e infraestructura live. Compra/reembolso reales requieren autorización del gasto.
- C6: smoke del ZIP exacto sin test login, Explorer autenticado/no autenticado, fuentes de audio, carpeta revocada, reinicio del worker y matriz de dispositivo/accesibilidad. Subir los mismos bytes probados sólo con autorización de publicación.
- C7: observar errores, activaciones, refunds, fees/payout y feedback por versión. Separar sandbox de producción y compras confirmadas de clics de checkout.

### Entrega 3 — Primera mejora de producto: guardar y recuperar trabajo

Priorizar **presets completos de sonido y biblioteca local mínima de loops**, combinando 05 con las primeras etapas del plan Looper. Motivo: aprovecha EQ/FX ya construidos y evita que el usuario pierda ajustes o tenga que volver a buscar un fragmento. El efecto en retención/ventas es una hipótesis, no una métrica ya observada.

Primera entrega pequeña: guardar con nombre, aplicar, renombrar y eliminar un sonido completo; esquema versionado, fallos de storage visibles y autorización al aplicar. Segunda: guardar A/B por track y restaurarlo sin autoplay. Conservar slots de velocidad y pads actuales; no meter sync, cuentas ni múltiples regiones simultáneas en esta primera entrega. Confirmar la propuesta de acceso Free/Pro de esos nuevos guardados antes de cambiar la oferta.

### Entregas posteriores, una por vez

1. **Explorer:** baseline con bibliotecas grandes, portadas locales primero, renders estables y lecturas paginadas. Después colecciones de terceros con migración segura. Priorizar según lentitud o uso observados.
2. **Looper:** undo/redo y edición cómoda; BPM manual/práctica progresiva y export por lotes cuando la biblioteca esté estable.
3. **Crecimiento:** primero claridad de Store/capturas del producto real y coherencia de dominio/sitemap; después páginas útiles de Likes y Looper y videos demostrables.
4. **Instrumento/FX:** ejecutar el plan del 23/09 en etapas después de confirmar sus decisiones. Evitar que teclado, 16 pads, slices y cinco FX entren como una sola ampliación antes de validar el cobro.
5. **Arquitectura:** extraer almacenamiento de presets, control de instrumento y adaptador de pagos a medida que sean necesarios. No reescribir el descargador estable ni adoptar un framework sólo para reducir el tamaño del archivo principal.

## Prompt listo para el siguiente agente

> Leé `docs/planning-20260915/12-ESTADO-Y-SIGUIENTE-AGENTE-20260923.md` y después los contratos de 00, 10 y el addendum de mitigación C1–C4. Comprobá HEAD y cambios locales. M17 ya está corregido: no restaures el descuento, el precio futuro ni la promesa de trial único resistente a reinstalación. Empezá por terminar el gate local, generar un ZIP trazable y registrar la evidencia exacta del candidato. No reconstruyas EQ, export FX, trial firmado, header ni Explorer existentes. Antes de cambiar Lemon por otro proveedor, resolvé por escrito viabilidad del producto, payout y precio. Conservá FREE independiente de licencias, EQ paramétrico Pro, el límite de veinte loops de prueba, dos perfiles Pro y recibos ES256. Para hacer el trial resistente a reinstalación o múltiples perfiles hace falta una identidad de cuenta verificada por el servidor; no confíes en otro ID declarado por el cliente ni en fingerprinting. No declares C4–C7 cerrados con mocks. Registrá cambios, comandos, resultados, límites externos y siguiente tarea. Después del cierre comercial, la primera mejora recomendada es presets completos y loops guardados; los nuevos FX/instrumento quedan para una entrega separada.
