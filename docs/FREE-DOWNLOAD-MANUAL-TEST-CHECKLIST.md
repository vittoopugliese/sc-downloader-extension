# Checklist manual — módulo de descargas gratuitas

> **ABIERTO / checklist del candidato — revisión 24/09/2026 (`29d7946`).** No hay ejecución completa registrada para los bytes actuales. Compra PRO test no valida descargas FREE, carpetas, HLS, restart ni dispositivos. Completar por escenario/versión. Estado y pendientes: [registro vigente](ESTADO-ACTUAL-20260924.md).

Usar una carpeta vacía de pruebas y contenido propio o para el que se tenga permiso. Registrar los fallos con URL, método de descarga, estado de sesión, destino elegido y mensaje de error exacto.

## Preparación

- [ ] Instalar/cargar la versión candidata de la extensión en Chrome.
- [ ] Crear una carpeta vacía para las descargas de prueba.
- [ ] Preparar una sesión sin login y otra con login de SoundCloud.
- [ ] Tener a mano: un track público, una playlist pequeña, Likes y un perfil público con tracks.

## Descargas individuales

- [ ] **Track público desde popup:** abrir un track público y descargar desde el popup. Debe guardarse un archivo reproducible con nombre `Artista - Título`.
- [ ] **Botón inline:** descargar el mismo track desde el botón junto a Like/Repost/Share. Debe dar el mismo resultado que el popup.
- [ ] **Player fijo:** reproducir un track y descargar desde Player Tools sin velocidad ni efectos activos. Debe iniciar una descarga gratuita normal.
- [ ] **Formato automático:** probar tracks con fuentes distintas. La extensión debe usar un stream disponible y la extensión del archivo debe coincidir con su contenedor real.
- [ ] **Metadatos:** abrir el archivo descargado. Título, artista y portada deben estar presentes cuando la fuente lo permita.
- [ ] **Nombres complejos:** probar cirílico, chino, emoji y caracteres no válidos para nombres de archivo (`/`, `\\`, `:`, `*`, `?`). La descarga no debe fallar y el nombre debe ser seguro.
- [ ] **Sin login:** en incógnito o sesión cerrada, descargar un track público. Debe funcionar cuando SoundCloud lo permita; de lo contrario, debe mostrar un error entendible.
- [ ] **Con login:** descargar un track accesible con la cuenta actual. Debe completar correctamente.
- [ ] **Metadata/link vencido:** dejar una página abierta un rato y descargar. La extensión debe refrescar/reintentar o informar un error útil, nunca quedar cargando indefinidamente.
- [ ] **Track no disponible:** probar privado, eliminado, bloqueado por región o sin stream. Debe mostrar una causa clara y la extensión debe seguir usable.

## Destino de archivos

- [ ] **Downloads del navegador:** elegir `Downloads` y descargar. El archivo debe aparecer en la carpeta estándar de Chrome.
- [ ] **Carpeta elegida:** seleccionar una carpeta personalizada y descargar. El archivo debe guardarse ahí.
- [ ] **Permiso de carpeta vencido:** elegir una carpeta, revocar/cambiar el acceso si es posible y descargar. Debe pedir elegirla otra vez o caer a Downloads; nunca perder el archivo silenciosamente.

## Colecciones y descargas en segundo plano

- [ ] **Playlist pequeña:** descargar una playlist de 3 a 10 tracks. Todos los archivos deben llegar, numerados y dentro de su carpeta de colección.
- [ ] **Selección parcial:** en el popup de una playlist, elegir algunos tracks. Deben descargarse exactamente esos tracks.
- [ ] **Likes:** con sesión iniciada, abrir `/you/likes`. Debe detectar y descargar los tracks disponibles.
- [ ] **Perfil:** abrir `soundcloud.com/usuario/tracks`. Debe detectar uploads públicos y permitir iniciar la descarga.
- [ ] **Pausar/reanudar:** iniciar un lote, pausarlo y reanudarlo. No deben comenzar tracks nuevos mientras esté pausado y debe continuar después.
- [ ] **Cancelar:** iniciar un lote y cancelarlo. Los pendientes se detienen y los archivos ya guardados se conservan.
- [ ] **Fallo parcial:** usar un lote con al menos un track no disponible. Los demás deben continuar y al final deben mostrarse los fallidos con su motivo.
- [ ] **Reintentar fallidos:** ejecutar `Retry` tras un fallo parcial. Debe reintentar sólo los tracks fallidos.
- [ ] **Cerrar popup:** iniciar un lote y cerrar el popup. Debe continuar en segundo plano, actualizar el badge y notificar al terminar.

## Robustez y UX

- [ ] **Cambiar de pestaña:** descargar mientras se navega en SoundCloud. No debe romperse ni crear duplicados.
- [ ] **Doble clic:** hacer doble clic rápido sobre Download. No debe crear dos descargas ni dos jobs.
- [ ] **Navegar durante descarga:** comenzar un download y cambiar de track o página. El trabajo debe terminar o fallar con un mensaje claro, sin congelar la interfaz.
- [ ] **Reiniciar Chrome:** iniciar un lote, cerrar y reabrir Chrome cuando sea seguro hacerlo. No debe quedar un job fantasma ni estado bloqueado.
- [ ] **Idiomas:** probar inglés, español, ruso y alemán. Botones, progreso y errores deben estar traducidos y no cortarse.

## Registro de incidentes

Completar una entrada por cada fallo:

```text
Fecha y versión:
URL:
Flujo: popup / inline / Player Tools / playlist / Likes / perfil
Sesión: sin login / con login
Destino: Downloads / carpeta personalizada
Resultado esperado:
Resultado real:
Mensaje de error exacto:
¿Se creó algún archivo?:
Captura o consola del service worker:
```

## Criterio de publicación

No publicar si falla alguno de estos casos críticos: track público sin login, track público con login, carpeta personalizada, playlist, pausar/reanudar, cerrar popup durante un lote o fallo parcial con reintento.
