# Diagnóstico de desinstalaciones — 2026-09-20

> **DIAGNÓSTICO HISTÓRICO — revisión 24/09/2026 (`29d7946`).** Conservar denominadores y límites causales del formulario. Los fixes registrados no prueban que el caso de Chromebook se resolvió ni que llegaron a usuarios; memoria/dispositivo y feedback por versión siguen abiertos. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

## Contenido histórico de la base indicada

## Alcance de los datos

Se revisaron 97 respuestas entre el 12/09/2026 20:22 UTC y el 20/09/2026 07:35 UTC. Se excluyeron los registros 2 y 20 porque el desarrollador confirmó que eran pruebas propias. Quedan 95 respuestas y 91 `ip_hash` distintos.

Un mismo hash no identifica necesariamente a una persona, pero cuatro pares merecen deduplicación al contar orígenes: 9/10, 22/23, 50/51 y 87/88. Los pares 9/10 y 50/51 cambiaron entre `other` y `downloads_did_not_work`; 22/23 y 87/88 repitieron fallo de descarga.

| Motivo | Envíos válidos | Porcentaje |
| --- | ---: | ---: |
| `downloads_did_not_work` | 61 | 64,2% |
| `other` | 15 | 15,8% |
| `no_longer_needed` | 12 | 12,6% |
| `confusing_to_use` | 4 | 4,2% |
| `missing_feature` | 2 | 2,1% |
| `pricing` | 1 | 1,1% |

En hashes únicos, 59 de 91 orígenes reportaron al menos un fallo de descarga. Entre los 79 orígenes con un motivo accionable distinto de `no_longer_needed`, 59 (74,7%) incluyeron fallo de descarga.

Estos valores describen a quienes enviaron el formulario, no una tasa de desinstalación. Para calcular tasa y tendencia faltan instalaciones activas, desinstalaciones totales, tasa de respuesta y corte por versión/OS. Todos los registros declaran `2026.9.10`, pero distintos artefactos locales conservaron ese mismo número; la versión no permite atribución inequívoca a un commit.

## Hallazgos reproducidos

1. Una pestaña de SoundCloud abierta antes de instalar no recibe los content scripts. El popup recibía `Could not establish connection. Receiving end does not exist`, pero lo convertía en un loading indefinido. Después de recargar SoundCloud, MP3 y M4A reales funcionaron.
2. Dos descargas simultáneas podían observar que no existía el documento offscreen e intentar crearlo a la vez. Una fallaba con `Only a single offscreen document may be created.`
3. Un único fallo temporal de un segmento (`429` o `5xx`) cancelaba el archivo completo sin reintento. Un `401/403/404` posterior a resolver la fuente tampoco renovaba la URL firmada.
4. El pipeline permitía dos tracks bulk y múltiples descargas individuales en procesamiento simultáneo. Además, el renderer aceptaba hasta 512 MiB solamente para el PCM Float32 de salida. El pico real también incluye audio comprimido, PCM decodificado, buffers del renderer, WAV y Blob.

Las descargas públicas normales no están caídas globalmente: la prueba real actual guardó MP3 progressive de 3.463.767 bytes y AAC/M4A HLS de 4.357.377 bytes. El problema es una combinación de primera instalación engañosa, carreras, fragilidad de red y picos de recursos.

## Registro 61

`i think ur tryna token log me go eat a frank` significa aproximadamente: “creo que estás intentando robar/registrar mi token de sesión; andate al diablo”. `Token logger` es jerga para malware que roba tokens de autenticación y permite secuestrar sesiones.

La sospecha es comprensible porque el manifest pide `cookies` y el worker lee la cookie `oauth_token` de SoundCloud para acceder a likes o contenido que requiere la sesión. La revisión del código no encontró envío de ese token al dominio propio: se usa como cabecera `Authorization: OAuth ...` sólo hacia la API de SoundCloud. Los eventos propios usan un `installationId` aleatorio y propiedades permitidas; no incluyen cookie, título ni URL musical. Esto no prueba qué artefacto exacto vio esa persona, pero sí describe el código revisado.

Acción de producto recomendada: explicar el permiso en Store/onboarding y evaluar convertir `cookies` en permiso opcional solicitado al usar funciones autenticadas. Esa migración requiere diseño y pruebas; no debe improvisarse dentro de la corrección de descargas.

## Registro 86 — Chromebook Plus

`Froze the browser each time on a chromebook plus` indica congelamiento de Chrome o del equipo cada vez que intentaba usar la descarga, no sólo un mensaje de error.

No se puede saber si usó una descarga normal, bulk, loop o export completo con velocidad/Keep Tone. Sin embargo, el código tenía riesgos concretos compatibles con el reporte:

- dos tracks bulk podían ensamblarse a la vez;
- dos descargas individuales podían procesarse en paralelo;
- HLS conserva todos los segmentos y luego crea un segundo buffer combinado;
- los exports transformados decodifican el track completo a PCM y crean salida PCM + WAV + Blob;
- el límite anterior de 512 MiB sólo medía uno de esos buffers, por lo que el pico podía superar ampliamente 1 GiB.

Por eso el comentario debe tratarse como un reporte técnico creíble de presión de memoria/CPU, no como una rareza del formulario. No prueba cuál de los mecanismos fue el responsable exacto.

## Correcciones implementadas

- abrir onboarding localizado sólo en instalación nueva, con la recarga de pestañas existentes como paso principal;
- detectar inmediatamente el error de receptor ausente en el popup y pedir recarga;
- compartir la promesa de creación del offscreen document;
- serializar descargas individuales y reducir bulk a un track procesado por vez;
- reintentar `408/425/429/5xx` con espera acotada;
- volver a resolver una vez la fuente ante `401/403/404` durante el build;
- reducir el límite PCM de salida a 128 MiB;
- mantener pruebas deterministas y de Chromium para onboarding, concurrencia y recuperación.

## Pendientes de medición

- publicar con un número de versión nuevo y guardar el SHA-256 del ZIP realmente enviado al Store;
- exportar métricas del Store por fecha, OS, país y versión para obtener una tasa, no sólo respuestas;
- agregar al formulario etapa (`resolve/build/save`), código de error y clase de dispositivo sin enviar URL, título, cookie ni token;
- medir memoria real en Chromebook o ChromeOS con descarga normal, HLS, bulk y export transformado de 3/10/30 minutos;
- decidir un límite de duración previo a decodificar cuando haya transformación, basado en esas mediciones.
