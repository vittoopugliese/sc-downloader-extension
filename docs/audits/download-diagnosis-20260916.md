# Diagnóstico de descargas y desinstalaciones — 2026-09-16

> **DIAGNÓSTICO HISTÓRICO — revisión 24/09/2026 (`29d7946`).** Primera instalación, serialización y HLS recibieron mitigaciones posteriores. Reportes de usuarios y reproducciones son de su fecha; no atribuir impacto a la release actual sin versión/artefacto distribuido. Estado y pendientes: [registro vigente](../ESTADO-ACTUAL-20260924.md).

## Contenido histórico de la base indicada

Se encontraron dos fallos reproducidos en Chromium con SoundCloud real y una debilidad de recuperación reproducida mediante errores de red simulados. No hay evidencia de una caída general del descargador: las descargas normales MP3 y AAC/M4A funcionaron. Los reportes no permiten asignar cada desinstalación a uno de estos problemas.

## Datos recibidos

Fuente: `C:\Users\torib\Desktop\extension_uninstalls.txt`, registros 21–47.

| Motivo | Respuestas |
| --- | ---: |
| downloads_did_not_work | 16 (59,3%) |
| confusing_to_use | 2 |
| other | 6 |
| no_longer_needed | 2 |
| missing_feature | 1 |

Son 27 respuestas del 14 de septiembre, 03:51 UTC, al 15 de septiembre, 23:53 UTC, todas con versión declarada `2026.9.10`. No constituyen una tasa de desinstalación: falta el total de instalaciones/usuarios y de desinstalaciones sin respuesta.

Hay 26 hashes de IP distintos; dos respuestas por descargas fallidas comparten hash y están separadas por aproximadamente 127 segundos. No puede deducirse que correspondan a personas distintas ni que sean necesariamente duplicadas. Los fallos aparecen en siete locales; el idioma no prueba la ubicación geográfica.

No hay URL de canción, error técnico, navegador, estado de sesión ni flujo de descarga. El único comentario en los casos de fallo es `hj`, sin información diagnóstica. No se copiaron identificadores personales ni tokens a este informe.

## 1. Prioridad alta: primera instalación con SoundCloud ya abierto

Reproducción: cargar completamente `https://soundcloud.com/forss/flickermood`, instalar la extensión en ese navegador y abrir el popup apuntando a la pestaña de SoundCloud.

Resultado del mensaje a la pestaña:

```text
Could not establish connection. Receiving end does not exist.
```

Después de 16 segundos, el popup muestra `Todavía se están cargando los datos del track…`, ofrece `Reintentar` y mantiene oculto Descargar. Al recargar SoundCloud, el mismo track pasa a `status: loaded` y se descarga.

Causa: `scripts/background.js:138` registra feedback y recupera jobs al instalar, pero no conecta las pestañas previamente cargadas. `scripts/popup.js:662` convierte el error de conexión en estado `loading`. `scripts/popup.js:756` muestra más espera y Reintentar. Repetir el mensaje no instala el content script que falta.

La primera prueba con una página todavía cargándose sí respondió: fue necesario esperar el evento `load` antes de instalar para aislar este escenario. El caso de página completamente cargada falló en el código actual y en el ZIP local.

Corrección recomendada: distinguir explícitamente la ausencia del receptor y ofrecer recargar SoundCloud; si se decide inicializar las pestañas existentes, hacerlo de forma idempotente y considerando los scripts MAIN que deben engancharse temprano. Evitar un indicador de carga sin posibilidad real de completar.

Este caso es especialmente relevante para alguien que instala el descargador mientras ya escucha una canción. Es una explicación plausible de abandono inmediato, pero el archivo no prueba cuántos usuarios lo sufrieron.

## 2. Prioridad alta: dos descargas simultáneas compiten por el procesador de audio

Reproducción: con el procesador de audio cerrado, enviar dos solicitudes `DOWNLOAD_SINGLE_TRACK` simultáneas. Una guarda el archivo y la otra devuelve:

```text
Only a single offscreen document may be created.
code: unknown_error
```

Causa: `scripts/bulk-job-manager.js:272` consulta si existe el documento offscreen y luego lo crea, sin compartir una promesa de creación. Dos llamadas pueden observar cero documentos y ambas intentar crearlo. El contador de descargas en `:637` permite descargas individuales concurrentes; la inicialización en `:645` queda fuera de la exclusión del estado del job.

Reproducido con Chromium y solicitudes reales, tanto en el código actual como en el ZIP. La prueba utiliza dos mensajes simultáneos; representa, por ejemplo, solicitudes desde dos pestañas/superficies. No implica que dos clics sobre un mismo botón atraviesen necesariamente sus bloqueos de interfaz.

Corrección recomendada: compartir y esperar una única promesa de inicialización offscreen, limpiándola al terminar o fallar, y verificar dos consumidores concurrentes.

## 3. Prioridad alta de robustez: un fallo transitorio de un segmento cancela todo

Reproducción aislada con el código real `download-core.js` y `track-download-execution.js`: playlist HLS mínima de un segmento; ese segmento falla una vez y respondería correctamente al siguiente intento.

```text
CONTROL: segmentCalls=1, saved=1
HTTP 503: segmentCalls=1, saved=0, Segment 1 failed with status 503
HTTP 429: segmentCalls=1, saved=0, Segment 1 failed with status 429
HTTP 403: segmentCalls=1, saved=0, Segment 1 failed with status 403
```

La prueba termina con código 1 porque espera recuperar y guardar el archivo. Los HTTP son inyectados, no respuestas observadas de SoundCloud en esta sesión. El 403 simulado confirma ausencia de recuperación, no que un 403 real deba reintentarse indiscriminadamente.

Causa: `scripts/download-core.js:154` lanza una excepción ante el primer HTTP no exitoso. La descarga concurrente de segmentos en `:180` no tiene reintento. `scripts/track-download-execution.js` propaga el fallo de construcción sin volver a resolver la fuente. El refresh de `download-source.js` cubre el endpoint de resolución, pero no el fallo posterior del servidor de audio.

Además, los errores de audio pierden status/code al convertirse en mensajes y no hay un timeout propio en esos fetch. Son limitaciones observadas en el código; no se midió un cuelgue real de red durante esta sesión.

Corrección recomendada: reintentos acotados con espera para errores recuperables, respeto de Retry-After, timeout y cancelación; para enlaces de audio vencidos, renovar la fuente una vez cuando corresponda. Conservar la causa estructurada del error. Una denegación permanente debe seguir informándose como tal.

## Verificación y límites

- `node scripts/verify-live-player-download.js`: pasó, archivo de 3.463.767 bytes sin login.
- La URL `/comments` redirigió/terminó resolviéndose en la prueba real y descargó; no se considera un fallo confirmado de navegación.
- `node scripts/verify-download-browser.js`: pasaron guardado en Descargas, carpeta recordada y fallback por carpeta vencida, con respuestas de red simuladas y APIs reales del navegador.
- Auditoría real adicional: MP3 progressive de 3.463.767 bytes y AAC/M4A HLS de 4.357.377 bytes; ambos guardados. Esto comprueba el archivo y tamaño, no una escucha completa.
- `node scripts/run-verifications.js`: 31 verificaciones pasaron antes del fallo en `verify-popup-avatar.js:19`, por el contrato del fallback del avatar. Es un fallo adicional de la suite, no evidencia de la causa de las descargas.
- `npm test` no pudo iniciarse directamente por la política de PowerShell para `npm.ps1`; se ejecutó su comando Node equivalente.

El ZIP `dist/soundcloud-track-downloader-2026.9.10.zip` y el checkout comparten versión pero difieren en nueve archivos: background, player-tools-commerce, popup.js, popup.html y cinco locales. Los módulos centrales de fuente, descarga, destino, intake y bulk manager comparados son iguales. Se probó el ZIP local extraído; no se verificó que sea exactamente el artefacto actualmente publicado en Chrome Web Store.

No se probaron cuentas autenticadas, pistas privadas/Go+, otras regiones, otras extensiones instaladas ni el historial de cada usuario.

## Reproducir

```powershell
# Chromium real, instalación sobre pestaña cargada, MP3/M4A y concurrencia.
# Usa un perfil temporal y elimina sus archivos descargados al terminar.
node docs/audits/download-diagnosis-20260916.cjs

# Sin red: control exitoso y fallos transitorios por segmento.
node docs/audits/download-failures-20260916.cjs

# Opcional: apuntar ambos scripts a un ZIP previamente extraído.
$env:SCDL_AUDIT_ROOT='C:\ruta\al\paquete-extraido'
```

Los scripts quedan intencionalmente en rojo mientras subsistan los fallos. El de navegador depende del servicio real; el de inyección es determinista. La instalación tardía utiliza el dominio Extensions del [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/), en un perfil de prueba.

Se agregaron únicamente este informe y los dos scripts de diagnóstico. No se corrigió ni publicó la extensión. El siguiente trabajo recomendado es corregir primero el bloqueo inicial, después la creación concurrente del procesador y la recuperación de red, y añadir diagnóstico local exportable para que un reporte futuro incluya etapa y causa sin tokens ni cookies.
