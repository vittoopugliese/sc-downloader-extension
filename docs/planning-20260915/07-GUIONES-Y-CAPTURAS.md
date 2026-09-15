# 07 — Guiones de videos y capturas, ligados a testing

Objetivo: producir contenido que muestre problema, acción y resultado verificable. Hay **18 guiones**, cinco capturas y cinco tutoriales largos. No es necesario producirlos todos juntos.

## Preparación común

Usar contenido propio o autorizado y un perfil de demo sin información privada. Preparar un track con voz, otro con graves/agudos claros, una playlist corta, Likes y perfil público. Mostrar cantidades reales; no poner “11.000 Likes” o “500 descargados” sobre otra biblioteca.

Formato social sugerido: vertical 1080×1920, 20–40 segundos, interfaz ampliada para leerla, cursor visible y subtítulos. Grabar un master limpio para TikTok, Reels y Shorts; adaptar cierre y enlace por plataforma. Capturar audio del navegador y comprobarlo: grabar el micrófono solo no demuestra reverb ni pitch. Nivelar antes/después y no sumar FX en el editor como si los hubiese generado la extensión.

Guardar por pieza: versión/commit del candidato, plan Free/Pro, locale, caso QA, resultado y archivo del master. Las comprobaciones de este documento son **previas a grabar**, no resultados ya ejecutados.

## Mapa de testing

Fuente principal: [checklist manual de descargas](../FREE-DOWNLOAD-MANUAL-TEST-CHECKLIST.md). [TESTING.md](../../TESTING.md) aporta automatización. No confundir un script E2E con guía manual de todas las herramientas; por eso se añaden verificaciones manuales PT/FX/LE.

| Código editorial | Comprobación antes de grabar |
| --- | --- |
| D1 | Checklist: track desde popup, inline y player neutro; archivo reproducible |
| D2 | Colecciones: selección parcial, Likes, perfil y numeración |
| D3 | Carpeta elegida/Downloads, permisos y destino final |
| D4 | Pausa/reanuda/cancela, cerrar popup, cambiar tab, badge y finalización |
| D5 | Formato, metadatos, nombres complejos, original disponible y sin login |
| D6 | Fallo parcial y retry sólo de fallidos; mensajes claros |
| PT1 | Manual adicional: speed, Keep Tone, reset y cuatro presets con audio audible; `test:e2e:tempo` |
| PT2 | Manual adicional: A/B válido, zoom, edición, bypass y Clear; `test:e2e` |
| PT3 | Manual adicional: export WAV loop/track con duración y transformación reales, acceso Pro |
| FX1 | Manual adicional: reverb/delay, presets fábrica, bypass, track nuevo; `test:e2e:effects` |
| FX2 | Manual adicional futuro: EQ afecta señal completa y export; criterios del plan 04 |
| P1 | Manual adicional futuro: guardar/restaurar sonido completo y loops; plan 05 |
| LE1 | Verificación de captura del Explorer ya resuelto: abrir, navegar y reproducir según la versión disponible |
| C1 | Manual adicional: explicación Free/Pro, checkout de prueba y activación sin secretos; plan 01 |

## Cinco capturas de Chrome Web Store

Briefs para screenshots 1280×800, hasta cinco según [guía oficial](https://developer.chrome.com/docs/webstore/cws-dashboard-listing). No generar imágenes ficticias del producto ni un collage de diecisiete funciones.

| Pieza | Titular sugerido EN | Composición | QA y condición |
| --- | --- | --- | --- |
| S1, ya hecha según usuario | Your SoundCloud Likes. On your computer. Free. | Lista seleccionada y carpeta con resultado; una flecha discreta | D2/D3, revisar vigencia |
| S2 | Slow it. Keep the tone. Loop it. | Panel abierto con velocidad y A/B claramente legibles | PT1/PT2, aclarar prueba/Pro |
| S3 | Rediscover years of Likes. | Explorer real, época seleccionada y portadas | LE1, no mock de función futura |
| S4 | Download your library. Keep browsing. | Progreso de lote mientras otra vista de SoundCloud sigue disponible | D4, cantidades reales |
| S5 | Make your listening your own. | FX abiertos y una decisión visible; EQ/guardar sólo cuando estén publicados | FX1; luego FX2/P1 |

Cada titular se adapta a EN/RU/DE/PT-BR/ES; los controles grabados deben corresponder al locale mostrado cuando sea posible. En S5 no poner “EQ export” antes de comprobar ambos exports. Distinguir las capturas de las tiles promocionales del Store.

## Guiones verticales

### V01 — Todos tus Likes, sin descargarlos uno por uno

Estado: flujo existente, comprobar candidato. QA: D2, D3, D4.

- 0–3 s: mostrar Likes y texto “¿Descargar tus favoritos uno por uno?”.
- 3–9 s: abrir selector, elegir All sobre una colección pequeña real y mostrar destino.
- 9–16 s: iniciar descarga; enfocar progreso. Si se acelera la grabación, indicarlo.
- 16–24 s: mostrar carpeta y reproducir un archivo.
- Cierre: “Descargas gratuitas. SoundCloud Track Downloader.” CTA a ficha.

Plano imprescindible: resultado en disco, no sólo botón. En descripción enlazar tutorial de Likes.

### V02 — Seguí escuchando mientras se descarga la colección

Estado: existente. QA: D4.

- 0–3 s: “¿Tengo que dejar el popup abierto?”.
- 3–8 s: iniciar lote y mostrar cantidad.
- 8–16 s: cerrar popup y navegar a otro track; acercar badge de progreso.
- 16–24 s: mostrar notificación real o reabrir progreso terminado y carpeta.
- Cierre: “Tu descarga sigue en segundo plano.”

No cerrar Chrome en la demo: continuar con el navegador abierto es una promesa distinta de sobrevivir al cierre completo.

### V03 — Elegí sólo las canciones que querés

Estado: existente. QA: D2.

- 0–3 s: playlist con algunas canciones marcadas: “No siempre querés toda la playlist”.
- 3–12 s: abrir selector; elegir tres títulos, comprobar contador; mostrar brevemente cantidad predefinida frente a selección individual.
- 12–22 s: descargar y mostrar exactamente esos tres archivos numerados.
- Cierre: “Vos elegís qué guardar.”

Puede reutilizarse con set/álbum, manteniendo etiquetas reales y sin llamar álbum a cualquier lista.

### V04 — La carpeta que elegiste, también mañana

Estado: existente. QA: D3.

- 0–3 s: “Ordená las descargas desde el principio”.
- 3–10 s: abrir Folder y elegir carpeta de demo en diálogo nativo.
- 10–18 s: descargar, abrir destino y verificar el archivo.
- 18–27 s: cerrar/reabrir popup y mostrar carpeta recordada.
- Cierre: “Elegí la carpeta una vez. Cambiala cuando quieras.”

Ocultar datos personales del diálogo. Verificar si la carpeta elegida es destino final para no dibujar subcarpetas inexistentes.

### V05 — Guardar desde el track, sin buscar el popup

Estado: existente. QA: D1.

- 0–3 s: “El botón está junto al track”.
- 3–10 s: enfocar barra Like/Repost/Share y pulsar descarga inline.
- 10–18 s: mostrar archivo y reproducirlo.
- 18–25 s: pequeña toma alternativa desde popup; no hacer una lista de todas las entradas.
- Cierre: “Un track, un clic para iniciar la descarga.”

No decir “instantáneo”: la descarga puede tardar según fuente/red.

### V06 — Guardar los uploads públicos de un artista

Estado: existente. QA: D2/D4.

- 0–3 s: perfil propio/autorizado: “¿Querés guardar estos uploads?”.
- 3–11 s: abrir `/usuario/tracks`, pulsar Download tracks y elegir selección.
- 11–21 s: iniciar y mostrar carpeta numerada.
- Cierre: “También funciona con los tracks públicos del perfil.”

Usar tres o cuatro archivos reales; no prometer acceso a privados ni descargas de todo el catálogo sin excepciones.

### V07 — Un fallo no tiene que arruinar todo el lote

Estado: existente, sujeto a caso manual. QA: D6.

- 0–3 s: “Una canción falla. ¿Y las demás?”.
- 3–12 s: lote de prueba controlado termina con archivos guardados y un fallo.
- 12–21 s: mostrar resumen, motivo y Retry; resolver condición del fallo en demo preparada.
- 21–30 s: demostrar reintento sólo de pendientes fallidos, sin duplicar éxitos.
- Cierre: “Reintentá lo que faltó.”

Si no se reproduce de forma estable en candidato, no grabar errores ficticios. Variante breve adicional: pausa/reanuda/cancela y mostrar que los archivos ya guardados permanecen.

### V08 — Slowed sin salir de SoundCloud

Estado: playback existente; verificar trial y release. QA: PT1.

- 0–4 s: escuchar voz/melodía a 1x, texto “Así suena normalmente”.
- 4–13 s: mover slider a un valor disponible próximo a 0,8x con Keep Tone off.
- 13–22 s: dejar oír diferencia real; enseñar valor efectivo.
- Cierre: “Cambiá cómo lo escuchás con Player Tools.” Añadir etiqueta de prueba limitada/Pro según versión.

No decir “pitch independiente”: en este ejemplo tono y velocidad cambian juntos.

### V09 — Más lento, conservando el tono

Estado: existente donde sea compatible. QA: PT1.

- 0–4 s: “Dos formas de escuchar más lento”.
- 4–12 s: fragmento a velocidad reducida con Keep Tone off.
- 12–23 s: mismo fragmento y misma velocidad con Keep Tone on.
- 23–30 s: reset a 1x, etiqueta “Velocidad ≠ tono”.
- Cierre: “Elegí el modo que te sirva para escuchar o practicar.”

Verificar que captura de audio refleja el procesamiento y que UI no indica modo no soportado. Tutorial complementario para búsquedas de pitch changer, explicando su alcance real.

### V10 — Repetí esos ocho segundos

Estado: looper existente, comprobar acceso. QA: PT2.

- 0–3 s: “Ese fragmento que querés volver a escuchar”.
- 3–12 s: abrir looper; colocar A y B en un rango de ocho segundos.
- 12–25 s: dejar repetir al menos dos ciclos, con indicador de rango visible.
- 25–32 s: acercamiento a zoom/ajuste; Clear al terminar.
- Cierre: “A marca inicio. B marca final.”

Probar que la selección no arranca audio si estaba pausado. No gastar tiempo del video explicando arquitectura.

### V11 — Del loop al archivo WAV

Estado: exportación existente de tempo/pitch; requiere Pro y QA del candidato. QA: PT2/PT3.

- 0–3 s: “Guardá sólo este fragmento”.
- 3–11 s: seleccionar A/B y elegir velocidad/Keep Tone.
- 11–20 s: pulsar Download loop, mostrar progreso y nombre WAV.
- 20–30 s: abrir WAV y reproducir; duración concordante con rango y velocidad.
- Cierre: “Exportación de loops con Player Tools Pro.”

Esta versión no anuncia reverb/delay/EQ exportados. Tras plan 04, producir variante que sí los demuestre. No usar “sampler completo”.

### V12 — Slowed + Reverb para escuchar de otra manera

Estado: FX vivos existentes. QA: PT1/FX1.

- 0–4 s: escuchar sonido neutro.
- 4–12 s: bajar velocidad y expandir FX; aplicar reverb moderada.
- 12–23 s: dejar escuchar; alternar bypass para que se entienda la diferencia.
- Cierre: “Tu sesión de SoundCloud, con otro ambiente.”

Grabar mismo pasaje a volumen comparable. No mostrar un WAV como resultado de esos FX hasta implementar y validar la exportación correspondiente.

### V13 — De Subtle a Dub: qué cambia realmente

Estado: presets FX fábrica existentes. QA: FX1.

- 0–3 s: “Un track, dos ambientes”.
- 3–11 s: aplicar Subtle y dejar sonar un fragmento.
- 11–21 s: aplicar Dub sobre el mismo fragmento; mostrar cambio de delay/reverb.
- 21–28 s: bypass y volver. Opcional mini toma de Studio/Wide al final.
- Cierre: “Partí de un preset y ajustalo a tu gusto.”

No afirmar guardado personalizado: los presets de fábrica y “Guardar sonido” son funciones distintas.

### V14 — EQ: ajustá lo que escuchás y guardá el resultado

Estado: **futuro, bloqueado hasta completar plan 04**. QA: FX2/PT3.

- 0–4 s: “Me gusta el track, pero quiero menos graves”.
- 4–13 s: abrir EQ Pro y reducir graves; dejar oír señal completa.
- 13–21 s: bypass/restaurar al mismo volumen aproximado.
- 21–32 s: exportar un loop corto; abrir WAV y escuchar la misma diferencia.
- Cierre: “EQ Pro: escuchar y exportar con tu ajuste.”

Variante tutorial para track completo. Si sólo el audio vivo cambia, no publicar este guion como terminado.

### V15 — Guardá tu sonido “Late Night”

Estado: **futuro, hasta plan 05**. QA: P1/FX2 si incluye EQ.

- 0–3 s: “No vuelvas a ajustar todo cada noche”.
- 3–12 s: velocidad, reverb, delay y EQ; pulsar guardar y escribir Late Night.
- 12–20 s: cambiar a sonido neutro; cerrar/reabrir panel.
- 20–29 s: aplicar Late Night y dejar oír; valores vuelven.
- Cierre: “Tu sonido, en un clic.”

Mostrar también eliminar/restaurar presets de fábrica en tutorial largo, no comprimir todas las acciones en este clip.

### V16 — Volvé a tus Likes de hace años

Estado: **Explorer declarado resuelto por usuario**; grabar versión implementada. QA: LE1.

- 0–4 s: “¿Te acordás de lo que escuchabas hace años?”.
- 4–12 s: abrir Explorer y navegar a un año realmente presente.
- 12–23 s: enfocar portadas, elegir una y ejecutar el flujo real de escucha.
- 23–30 s: mostrar canción encontrada.
- Cierre: “Reencontrá tus Likes con Likes Explorer.”

No ocultar indexación inicial como si nunca existiera: usar subtítulo “biblioteca ya indexada” si corresponde. No afirmar año del like si sólo se conoce año de publicación del track. No cambiar Free/Pro de Explorer para grabar.

### V17 — Que el aleatorio recorra toda la biblioteca

Estado: sólo si está incluido en lo que el usuario ya resolvió; de lo contrario **diferido, sin implementación asignada**. QA: LE1 más verificación de random global de 08.

- 0–4 s: “¿El aleatorio te devuelve a los mismos temas cercanos?”. Presentarlo como experiencia, no algoritmo interno confirmado.
- 4–11 s: mostrar biblioteca completa indexada y botón de redescubrimiento.
- 11–23 s: tres pulsaciones llevan a épocas/posiciones lejanas reales.
- Cierre: “Elegí entre toda tu biblioteca indexada.”

No simular una cola automática si sólo hay botón para elegir uno. No prometer selección global si sólo se indexó una parte.

### V18 — Gratis para descargar. Pro para tu forma de escuchar

Estado: tras cerrar oferta y activación, plan 01. QA: D1/C1.

- 0–4 s: “¿Qué es gratis y qué incluye Pro?”.
- 4–12 s: una descarga normal completada, etiqueta “Downloader: gratis”.
- 12–22 s: demo breve de herramienta Pro publicada, etiqueta de prueba/Pro correcta.
- 22–30 s: pantalla real de oferta con pago único y modo de activar.
- Cierre: “Probá las herramientas y elegí si son para vos.”

No mostrar datos de pago/licencia. No poner USD 2,99 si el checkout real cobra 3,69. No mostrar confirmación fabricada. EQ/presets sólo si el release los incluye.

## Cobertura adicional para que no queden funciones invisibles

No toda capacidad merece un video separado. Grabar estas tomas para tutoriales largos, carruseles o cortes extra:

| Feature | Pieza/toma |
| --- | --- |
| Descarga desde player fijo sin transformación | V05 variante, QA D1 y comprobar que conserva ruta gratuita |
| Pause/resume/cancel | V02/V07 variante: pausa detiene nuevos tracks; cancel conserva guardados |
| Set y álbum | V03 con colecciones reales |
| Original del artista, formato automático y contenedor real | Tutorial T1: abrir propiedades del archivo y explicar fuente |
| Nombres cirílicos/CJK/emoji y metadatos/cover | V04 variante, QA D5, usar nombres reales de demo |
| Mayoría de públicos sin login | T1 con sesión cerrada; no afirmar acceso universal |
| Cuatro velocidades guardables | V08 variante, guardar/reaplicar un slot según UI actual |
| Panel fijado abierto/detach | V12 variante: navegar/click fuera y panel sigue según función real; no llamarlo ventana separada si no lo es |
| Bypass de herramientas y reset | V09/V12, explicar diferencia: bypass conserva ajustes; reset vuelve neutro |
| Nudges/timestamps/zoom preciso | T3, con plan Pro cuando corresponda |
| Export track completo a velocidad modificada | T5 y variante V11; comprobar archivo completo y precio |
| Preset de loop por track y restaurar última sesión | T3/T5 futuro, después de plan 05 |
| Búsqueda, minimapa y entradas player/perfil de Explorer | T2, exclusivamente lo implementado |
| Share year / oldest Like | Corte extra sólo si existe; nueve portadas, copia local, sin publicación automática |
| Idiomas de UI | Carrusel EN/RU/DE/PT-BR/ES tras validar traducciones y layout |

## Cinco tutoriales YouTube para intención de búsqueda

Formato sugerido 2–4 minutos: pregunta en primeros segundos → demo corta del resultado → pasos sin cortes confusos → limitaciones y Free/Pro → enlace a ficha y página específica. Capítulos con nombres de tareas, no componentes del código.

1. **T1 — How to download all SoundCloud Likes at once.** Abrir Likes, seleccionar, carpeta, descarga, pausa/reanuda, seguir navegando, resultado y qué hacer con fallidos. Explicar fuentes/calidad y sin login donde corresponde. QA D1–D6. Landing de Likes.
2. **T2 — How to find your oldest SoundCloud Likes.** Abrir Explorer ya implementado, indexación si la hay, fechas, buscar, navegar por época y escuchar. Distinguir “sin fecha”. QA LE1. Landing de Likes antiguos.
3. **T3 — How to loop part of a SoundCloud song.** A/B, zoom, edición básica/precisa, escucha, Clear, export Pro y duración del WAV. Guardar loop sólo tras plan 05. QA PT2/PT3. Landing looper.
4. **T4 — How to slow + reverb SoundCloud in real time.** Comparar 1x/slowed, Keep Tone, reverb/delay, bypass y límites de acceso. EQ al publicar. QA PT1/FX1. Landing slowed/reverb.
5. **T5 — How to change SoundCloud playback speed and pitch.** Contrastar velocidad con tono ligado y Keep Tone; enseñar cuatro presets y export completo. Aclarar si no hay pitch independiente. Preset Late Night después de plan 05. QA PT1/PT3/P1 cuando aplique. Landing velocidad/pitch.

## Primera tanda y evaluación

Empezar con V01, V08 y V16 si la versión de Explorer está a mano. Si no, V02. Segunda tanda V10, V12 y T1. Dejar V14/V15 escritos hasta que funcionen sus features; así cada desarrollo nuevo tiene una demo preparada.

Ritmo sugerido del texto: tres a cinco clips semanales reutilizados, siempre que no desplace la corrección del producto. Publicar también en comunidades pertinentes con contexto útil y conforme a sus reglas; no spam de enlaces. Ninguna publicación ni mensaje se envía en esta entrega.

Evaluar: retención inicial/completitud de video, clic al enlace, visitas de Store atribuibles y, donde sea medible, activación de herramientas y compras. Un millón de vistas sin visitas cualificadas no valida una campaña. Comparar ganchos antes de aumentar volumen o gastar en publicidad.
