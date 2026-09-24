# 02 — Header de Player Tools y reseñas contextuales

> **CERRADO por decisión de alcance; ARCHIVADO — revisión 24/09/2026 (`29d7946`).** La etapa 02 fue dada por cerrada por el usuario según el registro previo de 00/10. Header y composición existen. Esto NO certifica que el prompt de reseñas post-descarga propuesto abajo esté implementado: no se encontró ese flujo en background/popup. La propuesta se conserva como antecedente fuera del alcance cerrado, sin obligación activa. Soporte semanal sigue en C7. Estado y pendientes: [registro vigente](../../ESTADO-ACTUAL-20260924.md).

Objetivo: reconocer el producto de pago y pedir una reseña en un momento donde el downloader ya entregó valor. Dos cambios pequeños que pueden publicarse sin esperar EQ.

## Header

Archivos de implementación: `scripts/tempo-control-main.js`, `popup.html`, `scripts/popup.js`, `_locales/*/messages.json` y manifiesto si el recurso necesita exposición.

1. Sustituir el título largo por `Player Tools`, con `assets/LooperPlayerToolkit.png`.
2. Estado visual: `[Free]` para Free, `[Pro]` para comprado; durante loading no afirmar Pro. En la explicación de acceso, decir “prueba limitada” para que Free no sugiera herramientas ilimitadas.
3. Retirar `Please consider rating the app!` del panel musical. Mantener una composición compacta, cuatro presets y secciones Loop/FX colapsables.
4. Conservar el ícono al tamaño adecuado para el panel. Un archivo de 128 px futuro es una mejora de asset, no requisito para documentar la funcionalidad. No reemplazar automáticamente el ícono global del Downloader.
5. Traducir estados, título accesible e invitación a comprar en EN/RU/DE/PT-BR/ES.

El boceto real `NEW_PLAYER_HEADER.png` no apareció: se encontró un `.png.txt` vacío. Implementar con el texto y asset existentes es posible; no afirmar haber copiado un boceto que no se vio.

### Nota de UI posterior (20/09/2026)

La composición actual del popup fue revisada y aprobada visualmente; no rediseñarla al retomar este plan. Como único ajuste pendiente de esta tarjeta, mover el logo de Player Tools para que quede **encima** del botón `Acceso de prueba`/`Get Pro`, dentro de la columna de acciones. Así se libera ancho para el texto, el detalle y el precio. Conservar el mismo logo, CTA, jerarquía, estados y comportamiento; este apunte no autoriza otros cambios de `popup.html` sin una nueva revisión de la UI actual.

QA: Free, prueba, agotado y Pro; título largo ruso/alemán; zoom 100/125/150/200%; foco y lector de pantalla; panel anclado y fijado abierto. Captura de antes/después, sin rediseño general.

## Reseñas después de una descarga

Petición original: popup cada una o dos descargas exitosas con casilla para no volver a mostrar. Propuesta recomendada: primera invitación tras **dos trabajos exitosos**; posteriores sólo tras dos éxitos nuevos y siete días desde la última invitación. El cooldown es una recomendación para reducir interrupciones y necesita elegirse al implementar; no se presenta como frecuencia ya aprobada.

Un trabajo de 136 archivos cuenta como un éxito, no 136 oportunidades de pedir reseña. Basar el éxito en guardado confirmado, no en resolución del stream ni inicio de download.

Flujo propuesto:

1. Background registra elegibilidad al terminar trabajo con éxito total y al menos un archivo guardado. Un retry puede volver elegible el trabajo al completar; no duplicar su identidad.
2. Si el popup Downloader está visible y sin interacción crítica, mostrar una tarjeta no modal: `Descarga completada. ¿Querés dejar una reseña?`.
3. Si está cerrado, guardar intención y mostrar al volver al Downloader cuando corresponda. No abrir ventanas ni robar foco al escuchar música.
4. Acciones: `Dejar reseña`, `Ahora no`, casilla `No volver a mostrar`. Persistir la casilla inmediatamente, aunque luego cierre el popup.
5. Abrir ficha/reseñas oficial al pulsar. No afirmar que publicó una reseña: la extensión sólo conoce el clic. Propuesta: suprimir próximas invitaciones tras ese clic.

Estado mínimo propuesto en `chrome.storage.local`: versión de esquema, supresión, fecha del último prompt, contador de trabajos exitosos desde el prompt y marcador de elegibilidad. Usar transición terminal de jobs y deduplicación acotada; no guardar historial ilimitado de archivos. El background decide y persiste; varios popups no muestran el mismo prompt.

No condicionar la reseña a una respuesta previa “¿te gustó?” ni dirigir sólo las opiniones positivas a Store. No ofrecer Pro, descuentos ni usos extra por reseñar. Las políticas prohíben manipular valoraciones con incentivos. [Políticas oficiales](https://developer.chrome.com/docs/webstore/program-policies/policies).

Casos de prueba: download individual, bulk, popup cerrado, dos popups, fallo parcial, cancelado, doble evento de finalización, retry, casilla persistente tras reinicio y actualizaciones, `Ahora no` y cooldown. Nunca presentar un trabajo fallido como éxito. Soporte permanece accesible para todos.

Medir exposición, clic y supresión; incremento de reseñas sólo desde datos agregados de CWS. La calificación ponderada por reseñas recientes anunciada en agosto refuerza la importancia de arreglar causas actuales de queja, no sólo aumentar prompts. [Anuncio de Google](https://developer.chrome.com/blog/cws-review-updates-2026).

## Operación semanal de soporte

Revisar reseñas y feedback de desinstalación; agrupar problemas reproducibles, corregirlos y preparar respuestas concretas con versión/solución. Priorizar fallos de download, confusión de formatos, carpetas, acceso y cobro. No pedir cinco estrellas ni asegurar que un problema está corregido sin verificarlo. Responder públicamente es una tarea posterior del lanzamiento; esta entrega no envía mensajes.

Cierre: header correcto en cinco idiomas, prompt no intrusivo y deduplicado, opt-out duradero y descarga original sin regresiones. Usar checklist manual existente y verificadores de popup relevantes.
