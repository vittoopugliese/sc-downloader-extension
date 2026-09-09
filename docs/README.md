# Indice de documentacion y estado

Actualizado: 2026-09-09

Este indice evita confundir planes historicos con el estado del codigo.

| Documento | Rol actual |
| --- | --- |
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

No asumir que una feature documentada esta lista para release. En particular, el estado registrado el 2026-09-09 tiene bloqueantes de licencia/package y reproducibilidad, y la descarga normal del player todavia ignora pitch/rate.
