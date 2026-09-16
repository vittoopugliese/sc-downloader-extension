# Plan destilado: crecimiento e ingresos

Fecha: 2026-09-15. Fuente completa: `C:\Users\torib\Desktop\plan_final_destilar_por_etapas.txt`.
Entrega: planes separados, decisiones, materiales de Store y guiones. No es una implementación ni una publicación.

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
