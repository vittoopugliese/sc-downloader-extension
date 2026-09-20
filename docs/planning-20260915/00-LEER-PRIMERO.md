# Plan destilado: crecimiento e ingresos

Fecha: 2026-09-15. Fuente completa: `C:\Users\torib\Desktop\plan_final_destilar_por_etapas.txt`.
Entrega: planes separados, decisiones, materiales de Store y guiones. No es una implementación ni una publicación.

## Nueva dirección operativa — release completa, pagos y producción

Esta sección conserva literalmente la conclusión operativa de la revisión más reciente y pasa a ser la guía inmediata para retomar el proyecto.

Analicé los documentos de `docs/`, incluidos los más recientes. La conclusión es:

- La etapa 02 puede considerarse cerrada, según tu indicación y la nota del 20/09.
- No conviene empezar ahora EQ, presets, Likes Explorer ni SEO avanzado.
- El bloqueo real para publicar y cobrar es operativo: confiabilidad del descargador, paquete final sin login de prueba, despliegue del Worker y aprobación del proveedor de pagos.
- La autenticación post pago ya tiene una base técnica: checkout alojado, webhook, activación, restauración, revalidación offline y revocación. Falta probarla con infraestructura y credenciales reales.

### Qué documentos mandan

`docs/planning-20260915/00-LEER-PRIMERO.md` y `01-MONETIZACION-Y-MEDICION.md` son la mejor referencia para monetización. Declaran cerradas en código las etapas 1A–1D, pero dejan pendiente:

1. desplegar el Worker;
2. configurar secretos reales;
3. completar una compra sandbox;
4. reconciliar webhook, activación, restauración y reembolso;
5. obtener aprobación del proveedor para el producto real.

Los documentos anteriores de `product-launch-plan`, `product-roadmap` y `payment-options` contienen decisiones históricas. Su orden viejo ya no debería dirigir el trabajo.

Los documentos del 20/09 cambian la prioridad:

- `RELIABILITY-IMPLEMENTATION-HANDOFF-20260920.md`: contiene P0 que bloquean un release confiable.
- `uninstall-diagnosis-20260920.md`: confirma fallos reales de primera instalación, carreras, HLS, reintentos y memoria.
- `LOOPER-PRODUCT-IMPLEMENTATION-PLAN-20260920.md`: es evolución futura del producto.
- `LIKES-EXPLORER-OPTIMIZATION-PLAN-20260920.md`: también es posterior al primer release comercial.

### Orden que te recomiendo ahora

#### 0. Ejecutar primero el plan de mitigación de confiabilidad

Antes de pagos, Likes Explorer o cualquier publicación, ejecutar completo `docs/audits/RELIABILITY-MITIGATION-PLAN-20260920.md`.

Este plan corrige los problemas detectados en los últimos diagnósticos de desinstalación y confiabilidad. Son problemas que afectan directamente la posibilidad de publicar una release nueva:

- guardados repetidos o ambiguos después de perder una respuesta;
- consumo excesivo de memoria antes de aplicar los límites;
- cuerpos HTTP, portadas y segmentos sin lectura acotada;
- timeouts y códigos de error que terminan en loading indefinido;
- bulk sin checkpoint durable o con truncamiento silencioso;
- borrado, migración y carreras de Likes Explorer;
- cancelación, cola y ciclo de vida de offscreen;
- seguridad residual y validación del artefacto final.

El orden interno obligatorio es el del plan de mitigación:

1. M1 — guardado repetible y estados ambiguos;
2. M2 — límites de memoria antes de reservar memoria;
3. M3 — HTTP, timeout y errores correctos;
4. M4 — bulk, checkpoints y All completo;
5. M5 — borrado, migración y carreras de Explorer;
6. M6 — rendimiento real de Explorer;
7. M7 — cancelación, cola y ciclo de vida de offscreen;
8. M8 — HLS, seguridad residual y artefacto de release.

La salida del Paso 0 exige reproducción antes de cada corrección, prueba de regresión después, ejecución sobre el ZIP cuando corresponda y un informe de lo que quedó demostrado. No se debe declarar lista la release sólo porque pasen las verificaciones sintéticas existentes.

#### 1. Cerrar el release técnico

Primero resolver los P0 de confiabilidad:

- exactamente 50 tracks;
- estados de login y extracción sin loading infinito;
- token de SoundCloud aislado del content script;
- reintentos de segmentos y URLs vencidas;
- carreras del documento offscreen;
- serialización y límites de memoria;
- cancelación y estados terminales;
- prueba del ZIP extraído, no solamente del código fuente.

El handoff dice explícitamente `do not ship` hasta demostrar estos puntos.

#### 2. Preparar el cobro real en paralelo

Usar Lemon Squeezy como candidato, condicionado a:

- aprobación escrita del producto real;
- KYC y W-8;
- confirmación del payout a Argentina/Wise;
- términos, privacidad, reembolsos y soporte publicados.

El checkout debe seguir alojado fuera de la extensión. El flujo correcto es:

```text
Usuario pulsa Comprar
        ↓
Worker crea checkout
        ↓
Lemon Squeezy confirma el pago
        ↓
Webhook firmado llega al Worker
        ↓
Worker crea o actualiza entitlement
        ↓
Usuario introduce email + license key
        ↓
Worker activa la instalación
        ↓
La extensión recibe Pro y lo persiste firmado
```

La URL de éxito nunca debe activar Pro por sí sola.

#### 3. Verificar la autenticación después del pago

El criterio mínimo de aceptación debería ser:

- compra cancelada: no concede Pro;
- compra exitosa: webhook único y deduplicado;
- activación con email y licencia: concede Pro;
- repetir activación: no duplica la licencia;
- reiniciar el service worker: Pro sigue activo;
- cerrar y abrir el popup: Pro sigue activo;
- restaurar en la misma instalación: recupera el entitlement;
- licencia revocada o reembolsada: Pro se desactiva;
- preferencias de audio y trial no se borran al revocar;
- caída del Worker: no bloquea las descargas completas gratuitas;
- datos inválidos, origin inválido y producto incorrecto: fallan cerrados.

Esto es exactamente lo que ya pide `services/player-tools-license/README.md`; falta ejecutar el gate con sandbox real y luego con producción.

#### 4. Sacar el test login al final

El login de prueba debe quedar como último paso del candidato:

1. terminar código y pruebas;
2. ejecutar pruebas con fixtures separadas;
3. desactivar `TEST_LOGIN`;
4. generar el ZIP;
5. extraer el ZIP;
6. comprobar que no contiene login, secretos, documentación ni código de test;
7. ejecutar smoke tests sobre ese ZIP exacto;
8. registrar versión y SHA-256;
9. recién después subirlo a Chrome Web Store.

No conviene eliminarlo antes porque todavía sirve para las pruebas locales, pero sí debe estar completamente desactivado en el artefacto publicable.

#### 5. Publicar con el alcance actual

Para la primera publicación comercial, el copy debería prometer únicamente:

- descargas completas gratuitas;
- Player Tools/Looper según lo realmente habilitado;
- prueba limitada;
- compra única;
- activación y restauración;
- límites concretos del export.

No anunciar todavía EQ, presets avanzados, exportación completa de FX, mejoras de Likes Explorer ni funciones del plan Looper 20/09 si no están implementadas y verificadas.

### Qué queda fuera por ahora

Deben pasar a después de publicar y cobrar la primera versión:

- EQ;
- presets persistentes completos;
- optimización profunda de Likes Explorer;
- biblioteca avanzada de loops;
- SEO por múltiples páginas;
- experimentos de precio;
- crypto/USDT;
- analytics más sofisticado;
- nuevas funciones de marketing.

La ruta correcta queda así:

**confiabilidad → Worker y proveedor → sandbox de compra → autenticación post pago → quitar test login → ZIP exacto → publicación → medición → mejoras posteriores.**

El mayor riesgo actual no es de diseño de producto. Es publicar una extensión que funciona en pruebas locales pero cuya compra, activación o descarga falla en condiciones reales.

## Ampliación solicitada — release nueva con Likes Explorer y cobro en Cloudflare

### Objetivo inmediato

Preparar una nueva release de producción con todo lo que ya existe funcionando de forma verificable, incluyendo Likes Explorer, y con el sistema de pagos y autenticación listo para cobrar sin depender de una activación falsa o de un login de prueba.

Likes Explorer se considera listo para incluir en la release por decisión actual del usuario. Los planes de optimización del 20/09 no deben bloquear esta salida; cualquier mejora que todavía no tenga evidencia de release queda registrada como trabajo posterior.

### Alcance de esta release

- Descargas gratuitas de tracks, playlists, perfiles y likes públicos.
- Likes Explorer incluido y probado sobre el artefacto final.
- Player Tools/Looper según el entitlement real.
- Checkout alojado y creado por el Worker.
- Activación y restauración posterior al pago.
- Revalidación offline y revocación por reembolso.
- Feedback existente en Cloudflare conservado.
- Sin `TEST_LOGIN` en el ZIP final.
- Sin secretos de Cloudflare, Lemon Squeezy ni claves de licencia en la extensión.

### Arquitectura Cloudflare para pagos

Cloudflare es la capa operativa principal del producto comercial:

```text
Chrome extension
    ↓ HTTPS + CORS de origen publicado
Cloudflare Worker de Player Tools
    ├── checkout
    ├── activation
    ├── restore
    ├── license status
    ├── signed Lemon webhook
    ├── refund/revocation
    └── product events allow-listed
              ↓
           Cloudflare D1
              ↓
       Lemon Squeezy API
```

El formulario de desinstalación continúa separado, con su propio Worker/D1 y sus propias políticas de validación. Compartir Cloudflare no significa mezclar tablas, secretos ni contratos entre feedback y licencias.

### Entidades mínimas de pago

El Worker debe mantener como mínimo:

- `licenses`: compra, producto, order, customer, estado y hash de licencia;
- `activations`: instancia, instalación, fechas de activación y última validación;
- `webhook_events`: hash/idempotencia, evento, fecha y payload necesario para auditoría;
- `events`: únicamente eventos comerciales permitidos y sin títulos, URLs musicales, cookies, tokens ni credenciales.

La extensión no debe persistir la clave de licencia. Puede conservar únicamente el comprobante o entitlement firmado que necesita para operar offline, junto con el identificador de instalación seudónimo.

### Orden de implementación del pago

1. Leer y validar el Worker existente, sus migraciones y el contrato de la extensión.
2. Confirmar el producto, variante, moneda, precio y URL de retorno configurados.
3. Crear la configuración real de Cloudflare sin subir secretos al repositorio.
4. Crear o verificar D1 y aplicar migraciones.
5. Configurar secretos del Worker de forma interactiva.
6. Publicar primero un endpoint de salud que confirme configuración sin revelar secretos.
7. Configurar Lemon Squeezy en Test Mode y registrar el webhook firmado.
8. Ejecutar la reconciliación completa de compra, activación, restauración, reinicio y reembolso.
9. Revisar CORS, origin, producto, variante, firma, email y license key con casos negativos.
10. Obtener aprobación comercial y completar KYC/payout.
11. Repetir el flujo en Live Mode con una compra controlada.
12. Cambiar la extensión al endpoint de producción y ejecutar pruebas sobre el ZIP.

### Gate de autenticación post pago

No se considera terminado hasta que una compra real o de sandbox produzca evidencia correlacionada en tres lugares:

1. respuesta visible de checkout/licencia;
2. filas coherentes en D1;
3. entitlement activo observado por la extensión.

Debe existir evidencia también para cancelación, reintento, webhook duplicado, activación repetida, reinicio del Worker, restauración, pérdida temporal de red y reembolso.

### Gate de Likes Explorer

Antes de publicar el ZIP:

- verificar que sus recursos están incluidos en el paquete;
- probar login y logout;
- probar likes propios y likes de perfiles públicos;
- probar colecciones vacías, pequeñas y grandes;
- probar paginación, selección y descarga;
- probar aislamiento entre dos cuentas;
- probar cierre y reinicio del popup/Worker;
- comprobar que el entitlement de Likes Explorer no bloquea las descargas gratuitas que deben seguir siendo gratis;
- ejecutar el E2E de Likes sobre el artefacto final, diferenciando mocks de datos reales.

El plan de optimización de Likes Explorer queda después del release salvo que una prueba del candidato revele un bloqueante de publicación.

### Gate del paquete final

El candidato final debe registrar:

- versión única en manifest, package, landing y ficha;
- ZIP generado desde el código final;
- SHA-256 del ZIP;
- ZIP extraído y cargado temporalmente;
- `TEST_LOGIN` desactivado;
- ausencia de secretos, documentación y tests en el ZIP;
- smoke tests de descarga, Player Tools, Likes Explorer y restauración;
- resultado de las pruebas negativas del Worker;
- limitaciones conocidas de ChromeOS, red, memoria o fuentes de SoundCloud.

### Estado de decisión

La prioridad vigente queda fijada como:

**Paso 0: mitigación de confiabilidad → release confiable + Likes Explorer → pagos Cloudflare/Lemon Squeezy → autenticación post pago → quitar test login → paquete final → publicación.**

No iniciar EQ, nuevos efectos, optimización profunda de Likes Explorer ni nuevas campañas hasta cerrar esta release y observar sus primeros resultados.

## Estado de ejecución al 15/09/2026

Las etapas de repositorio **00 y 01 están implementadas y verificadas**. El
trial, el acceso, el checkout, la activación/recuperación, la revocación y el
embudo mínimo comparten un único entitlement. La extensión no persiste email ni
clave y los eventos rechazan títulos, URLs musicales y credenciales.

Queda un gate operativo externo, no trabajo de producto: desplegar el Worker y
hacer una compra de prueba reconciliada. Este checkout no contiene
`wrangler.jsonc`, autenticación de Cloudflare ni secretos de Lemon Squeezy, por
lo que no se declara falsamente esa transacción. El procedimiento está en
`services/player-tools-license/README.md`. Esto no bloquea comenzar la etapa 02;
sí bloquea publicar la versión comercial.

## Mi recomendación

Sí al EQ como próxima mejora musical. Para generar dinero, primero cerrar el recorrido **descubrir Player Tools → probar → entender Pro → comprar → activar**. Una perilla nueva no arregla una compra desconectada o una prueba que no termina.

Para crecimiento, empezar ya con descripciones localizadas, capturas y reseñas contextuales. Aprovechar Likes Explorer en las demos del producto existente. No volver a construirlo ni cambiar su monetización en esta tanda.

Recomiendo conservar Downloader gratuito y concentrar el valor de pago en Player Tools, EQ, exportación transformada y personalización. No haría reverb/delay gratuitos permanentes al mismo tiempo que se endurece velocidad: cambiaría varias variables y regalaría una parte importante de la experiencia slowed + reverb antes de medirla. Es una recomendación, no una decisión del usuario.

## Orden y planes independientes

Esfuerzo orientativo para un desarrollador, sin revisión de Store ni esperas de servicios. Son rangos de planificación, no compromisos.

| Orden | Plan | Resultado | Esfuerzo | Condición de salida |
| --- | --- | --- | --- | --- |
| 1A | [01 — Monetización y medición](01-MONETIZACION-Y-MEDICION.md) | Trial efectivo, compra/activación y embudo verificable | 4–8 días, según integración existente | Free/Pro reales y compra de prueba reconciliada |
| 1B | [03 — Store y localización](03-STORE-Y-LOCALIZACION.md) | Cinco descripciones y ficha que explica la oferta | 1–2 días + capturas | Claims coinciden con la versión publicada |
| 2 | [02 — Header y reseñas](02-HEADER-Y-RESENAS.md) | Panel reconocible y solicitud de reseña después de una descarga | 1–2 días | Prompt deduplicado y exclusión persistente |
| 3 | [04 — EQ Pro y exportación FX](04-EQ-PRO-Y-EXPORTACION.md) | Ecualizar al escuchar y conservarlo en WAV | Comprobación 0,5–1 día; implementación 3–6+ | Señal completa y WAV medidos, no sólo sliders |
| 4 | [05 — Presets personales](05-PRESETS-Y-PERSISTENCIA.md) | Guardar “Late Night” y recuperar el sonido completo | 2–4 días | Restauración consistente y por track cuando corresponde |
| 5 | [06 — Landing SEO](06-LANDING-SEO.md) | Páginas por intención con URL propia | 2–4 días iniciales | URLs, canonical y sitemap coherentes |
| Continuo | [07 — Guiones y capturas](07-GUIONES-Y-CAPTURAS.md) | 18 videos y cinco capturas vinculados a QA | Primera tanda 1–2 días | Flujo grabado funciona en candidato publicable |
| Posterior | [08 — Backlog y Likes cerrado](08-BACKLOG-Y-LIKES-CERRADO.md) | Ideas preservadas sin duplicar trabajo | Sin asignación ahora | Elegir sólo después de revisar resultados |

1A y 1B son frentes independientes, no una exigencia de trabajar simultáneamente. Si hoy hay que elegir una sola tarea de código: integrar el trial y sus controles. Si eso ya está resuelto en otra rama, comprobarlo y avanzar a EQ sin rehacerlo.

## Qué encontré en este checkout

Base inspeccionada: `5393a84`, con cambios locales previos en `popup.html`, `scripts/looper.js` y `scripts/tempo-control-main.js`. Se preservan. Inspección estática; no ejecuté pruebas funcionales ni consulté métricas privadas de producción.

Al cerrar la entrega, HEAD avanzó externamente a `0537e00` (`font improvements`), incorporando cambios en esos tres archivos. Esta tarea no hizo commits ni los editó. Se volvió a comprobar que el render sigue habilitando controles y que el detector de transformación sigue en background; los hallazgos principales conservan vigencia. Revisar nuevamente el checkout al iniciar cada implementación.

| Evidencia | Consecuencia para los planes |
| --- | --- |
| `player-tools-policy.js`: veinte loops y capacidades según cuota/gracia | Existe la base; no crear otro contador |
| `tempo-control-main.js`, `render()`: habilita slider/presets y elimina `is-locked` | No considerar terminado el bloqueo por existir policy |
| `PLAYER-TOOLS-FOUNDATION-HANDOFF-20260913.md` | Hay protocolo de autorización/idempotencia; completar consumidores |
| `audio-effects-core.js`: reverb/delay vivos y presets Subtle/Studio/Wide/Dub | Conservar estos FX; EQ requiere tratamiento de señal principal |
| `loop-audio-renderer.js`: normaliza `rate` y `preservePitch` | “Efectos” históricos puede significar tempo/pitch; no prueba export de reverb/delay |
| `background.js`, `hasEffectivePlaybackTransform`: evalúa diferencia de rate respecto de 1 | Extender detector para EQ/FX antes de habilitar nuevas exportaciones |
| `services/player-tools-license/` existe; no encontré cliente checkout conectado en popup/background | Plan de integrar y verificar, no de rehacer proveedor ni asumir ventas activas |
| `current_description.txt`: dice que toda descarga de track completo es gratis | Precisar originales gratuitos frente a exportación transformada Pro |
| Header Player Tools conserva invitación a calificar | Cambio de marca y traslado de reseñas siguen siendo pertinentes |
| Cinco carpetas `_locales`: en, ru, de, pt_BR, es | Base disponible para localización de Store |
| `CNAME` dice `sctd.vpugliese.online`; canonical/sitemap dicen `soundcloud-downloader.online` | Resolver dominio efectivo antes de multiplicar páginas |
| Sitemap incluye `#features`, `#reviews`, `#faq` | Esas anclas no sustituyen páginas indexables por intención |
| Landing declara que no usa analytics | Instrumentación exige actualizar el texto cuando se incorpore |
| Plan local de Likes dice “todavía no implementado”; pedido actual dice mitigado | Prevalece el pedido actual: cerrado para este planning, sin afirmar QA local |

No encontré `NEW_PLAYER_HEADER.png` como imagen en las rutas examinadas; sí un `NEW_PLAYER_HEADER.png.txt` vacío en Desktop. El ícono `assets/LooperPlayerToolkit.png` existe. El plan del header puede ejecutarse con el texto pedido; fidelidad a un boceto requiere el archivo real.

## Decisiones y contradicciones resueltas

1. **Likes Explorer:** fuera de implementación y de discusión Free/Pro en esta entrega. El antecedente local propone Pro lifetime; no se adopta el “FREE” del consejo viejo.
2. **Header:** prevalece tu anotación “Player Tools [Free]”, ícono propio y sin invitación a calificar en el panel. Pro muestra Pro; Free puede aclarar “prueba limitada”. No adoptar SCTD como título compacto.
3. **EQ:** pago, como pediste. Reverb/delay Free era una posibilidad planteada, no una aprobación cerrada.
4. **Trial:** Free tiene una prueba global de siete días que comienza al abrir por primera vez el popup de descarga o Player Tools tras instalar o actualizar a la versión de la oferta. Los veinte loops siguen siendo un segundo límite: vence por plazo o al usar el loop 20, lo que ocurra primero. La gracia del loop 20 conserva su sesión ya concedida.
5. **Precio:** el plan explícito del 12/09 registra USD 3,69 lanzamiento / USD 6,79 referencia futura, lifetime y 46% redondeado. La conversación vieja sugiere USD 2,99, luego 4,99 y 7,99–9,99. No reemplazo una decisión explícita por ese consejo genérico; cambios de precio serán experimentos futuros.
6. **FX exportados:** distinguir tempo/pitch ya contemplados del procesamiento de reverb/delay/EQ que falta verificar e incorporar.
7. **Capturas:** la conversación dice “4” pero enumera cinco. Se entregan cinco briefs; el primero está declarado hecho y sólo requiere revisión de vigencia.

## Cómo pensar crecimiento y dinero

Los 20.000 usuarios, 3,8 estrellas/47 reseñas, 1.893 visitas y 1.126 instalaciones son datos de la conversación; no métricas actuales verificadas. El 59,5% sólo sería conversión válida con ventanas, unidades y atribución compatibles. El 75% de Organic Search es una señal histórica para priorizar búsqueda, no garantía futura.

Instalaciones acumuladas no equivalen a usuarios activos. Llegar a 100K activos exige altas y reactivaciones superiores a pérdidas de actividad. Los “450 diarios por 180 días” del texto son unas 81.000 altas brutas hipotéticas, no un pronóstico de activos. Los aportes por canal pueden solaparse; no sumarlos como si fueran independientes.

Para lifetime, medir **compradores nuevos × ingreso neto por compra**. No es MRR: una licencia vendida no vuelve a facturar cada mes. Restar comisiones, devoluciones y costes efectivamente observados antes de llamarlo beneficio.

Ejemplo exclusivamente aritmético: 5.000 usuarios únicos elegibles que abren Player Tools en una cohorte, al 1% → 50 compras; al 3% → 150. A USD 3,69 son USD 184,50–553,50 brutos. No promete esas tasas. Mejorar aperturas y conversión suele importar más que perseguir un total grande de installs.

Google anunció el 20/08/2026 más peso de reseñas recientes en la calificación. Esto sí pude verificar; no demuestra por sí solo una fórmula de ranking ni un aumento de installs. [Anuncio oficial](https://developer.chrome.com/blog/cws-review-updates-2026).

## Cadencia sugerida

- Primera semana: comprobar compra/activación y trial; dejar Store EN/RU/DE/PT-BR/ES lista; grabar tres flujos que ya funcionen.
- Segunda: publicar candidato comercial cuando pase QA; header/reseñas; iniciar comprobación técnica del EQ.
- Tercera: EQ + export, si pasa compatibilidad; dos páginas SEO y tres videos.
- Cuarta: presets completos; revisar embudo y causas de abandono; ampliar SEO sólo si las primeras páginas aportan información útil.
- Cada semana: visitas Store → installs; usuarios activos medidos → aperturas → intención Pro → checkout → compras confirmadas → activaciones. Además fallos, devoluciones y desinstalaciones agregadas.

No cambiar precio, cuota, oferta de FX y screenshots simultáneamente si se quiere entender qué funcionó. Registrar versión, fecha, hipótesis, denominador y resultado; con poco volumen, reconocer incertidumbre.

## Cobertura de TODO el texto original

| Tema original | Destino |
| --- | --- |
| Analytics, 20K→100K, países/canales y crecimiento compuesto | Este índice + 01 |
| Cinco descripciones actuales y tutorial CWS | 03 + [textos completos](09-DESCRIPCIONES-STORE-5-IDIOMAS.md) |
| Downloader free; Library / Player / FX; trial y ventas | 01 |
| Límites speed/Keep Tone/loops y excepción loop 20 | 01 |
| Header, ícono, Free/Pro, retirar rating | 02 |
| Reseña post-descarga, cada 1–2 éxitos y no volver a mostrar | 02, distinguiendo petición de frecuencia y alternativa recomendada |
| Reverb/delay, EQ pago, WAV de loop y track | 04 |
| Presets de sonido, velocidad, loops, defaults eliminables, restaurar | 05 |
| A/B rápido, timestamps/URL, atajos, pitch futuro | 08 |
| Explorer, búsqueda, años, galería, perfiles, minimapa | Cerrado por tu indicación; 08 registra antecedentes |
| Random viejo frente al random web; cola global | 08, dos alcances distintos y diferidos |
| Share year / oldest Like / collage de nueve portadas | 08, cerrado para esta tanda |
| Cinco screenshots, TikTok/Reels/Shorts, diez o más videos y testing manual | 07 |
| YouTube de búsqueda y reutilización semanal | 07 |
| Landing existente, siete rutas por intención, SEO externo | 06 |
| Precio fundador 2,99→4,99→7,99/9,99; conversión 1–3% | 01 como antecedentes/hipótesis, no precio aprobado |
| Responder reseñas, soporte y desinstalaciones | 02 + 01; sin enviar respuestas en esta entrega |
| Evitar móvil, Firefox ahora, muchos FX, red social, IA, suscripción, backend enorme y extensiones duplicadas | 08 |

Los planes antiguos siguen como antecedentes. Este índice es el punto de entrada para la destilación del 15/09; no certifica que una feature ya esté publicada.
