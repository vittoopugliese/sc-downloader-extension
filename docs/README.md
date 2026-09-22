# Indice de documentacion y estado

**Entrada vigente — 21/09/2026:** empezar por [00 — Leer primero](planning-20260915/00-LEER-PRIMERO.md), [10 — Cierre ejecutable de release y FREE/PRO](planning-20260915/10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md) y [11 — Tutorial Lemon Squeezy](planning-20260915/11-LEMON-SQUEEZY-TUTORIAL-20260921.md). La prioridad es confiabilidad pendiente → contrato FREE/PRO y corrección de licencias → compra/refund de prueba → producción → ZIP y publicación → medición. La etapa comercial 1C se reabre por defectos encontrados en código; no falta solamente deploy. Los órdenes y estados anteriores que aparecen abajo quedan como contexto histórico y no obligan a volver a preguntar qué etapa iniciar.

Plan del Looper del 20/09/2026: [LOOPER-PRODUCT-IMPLEMENTATION-PLAN-20260920.md](LOOPER-PRODUCT-IMPLEMENTATION-PLAN-20260920.md). Incluye biblioteca local, múltiples regiones, gestos e historial, BPM/compases, práctica progresiva, exportación por lotes, precisión de audio, rendimiento, Free/Pro, métricas y sincronización posterior. Estado: pendiente de implementación; distingue la política vigente de las propuestas comerciales y define etapas, dependencias, pruebas y rollback.

Actualización del 20/09/2026: el trabajo de Likes Explorer fue reabierto por pedido del usuario. El plan vigente para optimización, almacenamiento y colecciones de terceros es [LIKES-EXPLORER-OPTIMIZATION-PLAN-20260920.md](LIKES-EXPLORER-OPTIMIZATION-PLAN-20260920.md), pendiente de implementación. Las exclusiones del 15/09 mencionadas abajo son históricas para este alcance.

Para la destilación de crecimiento, monetización y próximas implementaciones del 15/09/2026, empezar por [planning-20260915/00-LEER-PRIMERO.md](planning-20260915/00-LEER-PRIMERO.md). Incluye planes separados, EQ Pro, cinco descripciones de Store y guiones vinculados a testing. Likes Explorer queda fuera del trabajo pendiente por indicación actual del usuario. La entrada histórica de abajo conserva su fecha y contexto.

Actualizado: 2026-09-12

Para el trabajo actual de producto, empezar por [`PLAYER-TOOLS-PRODUCT-AND-TECHNICAL-PLAN-20260912.md`](PLAYER-TOOLS-PRODUCT-AND-TECHNICAL-PLAN-20260912.md). Registra decisiones confirmadas sobre oferta, prueba global de veinte loops, Free/Pro, descargas, tooling local y alcance diferido. La próxima sesión debe preguntar qué etapa quiere iniciar el usuario antes de implementar. Las instrucciones de auditoría de abajo pertenecen al contexto histórico de `9dc9f1b`.

Este indice evita confundir planes historicos con el estado del codigo.

| Documento | Rol actual |
| --- | --- |
| [`LIKES-EXPLORER-IMPLEMENTATION-PLAN-20260912.md`](LIKES-EXPLORER-IMPLEMENTATION-PLAN-20260912.md) | Plan de Likes Explorer Pro: selector rápido, galería, índice por usuario, fechas de likes, reproducción y localización nativa; incluye evidencia Playwright y gates pendientes |
| [`COLD-AUDIT-HANDOFF-9dc9f1b.md`](COLD-AUDIT-HANDOFF-9dc9f1b.md) | Fuente de contexto para auditar en frio toda la feature tempo/preserve/export de `9dc9f1b`; no es aprobacion |
| [`product-launch-plan-20260905.md`](product-launch-plan-20260905.md) | Fuente operativa del lanzamiento comercial, con addendum de `9dc9f1b` |
| [`product-roadmap-20260905.md`](product-roadmap-20260905.md) | Estrategia/backlog; varias secciones son historicas y el overlay marca la feature adelantada |
| [`architecture-improvement-plan-20260905.md`](architecture-improvement-plan-20260905.md) | Plan de refactor desde una base anterior; contiene overlay de impacto arquitectonico |
| [`FEATURE-MAP-SOUNDCLOUD-EXTENSIONS.md`](FEATURE-MAP-SOUNDCLOUD-EXTENSIONS.md) | Analisis pre-implementacion de repos fuente; no describe por si solo el estado actual |
| [`TEMPO-INTEGRATION-AUDIT.md`](TEMPO-INTEGRATION-AUDIT.md) | Registro de implementacion; no sustituye auditoria independiente y tiene correcciones al inicio |
| `payment-provider-research-20260907.md` | Evidencia comercial para proveedor de pago; no autoriza integracion o deploy |
| `payment-options-20260905.md`, `new-plan.txt`, review HTML | Antecedentes/historicos |

Orden sugerido para retomar sin contexto:

1. Ejecutar `git status --short` y confirmar HEAD.
2. Leer el handoff de `9dc9f1b` completo.
3. Leer el addendum y gates del plan de lanzamiento.
4. Inspeccionar el diff y el codigo actual; los documentos nunca reemplazan esa comprobacion.
5. Ejecutar cada verificador relevante aun si el runner general se detiene antes.

No asumir que una feature documentada esta lista para release. El estado y bloqueantes registrados el 2026-09-09 son históricos: contrastarlos con el código antes de tratarlos como vigentes. La inspección del 2026-09-12 confirma que el botón de descarga completa del panel sí envía efectos; el nuevo plan conserva esa funcionalidad para Pro.
