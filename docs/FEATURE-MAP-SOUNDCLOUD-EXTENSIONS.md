# Mapa de features: Segment Looper + Playback Speed

## Actualizacion posterior al commit `9dc9f1b` (2026-09-09)

Este mapa fue escrito **antes** de implementar la feature y debe conservarse como analisis de fuentes, no como estado actual. El commit `9dc9f1b1d07ec773207cff72dd362e60e035cbc5` adelanto parte de las fases que abajo figuran como futuras:

- ya existe velocidad live `0.5x`-`2x`, step `0.05`, persistencia global y preserve pitch nativo;
- ya existe export WAV del A-B actual con rate natural o Signalsmith preserve;
- la descarga normal del boton del player todavia ignora ese estado; el usuario lo reporta como gap y espera que respete pitch;
- no existen pitch independiente, perfiles por track, timeline, biblioteca, hotkeys, rango configurable ni panel draggable;
- Signalsmith se usa solo offline; no se implemento el grafo AudioWorklet live propuesto en la fase avanzada;
- el estado exacto del commit tiene bloqueantes de licencia, packaging y reproducibilidad de tests.

Para la auditoria en frio, usar como documento rector [`COLD-AUDIT-HANDOFF-9dc9f1b.md`](COLD-AUDIT-HANDOFF-9dc9f1b.md). La matriz y el roadmap que siguen son la fotografia pre-implementacion y no deben usarse para afirmar que la extension actual carece de velocidad/preserve.

Fecha del análisis: 2026-09-08

Fuentes primarias:

- Repos locales: `repos/soundcloud-looper-extension-main` y `repos/soundcloud-tempo-control-main`

## Resumen ejecutivo

La extensión actual ya contiene la mayor parte del producto downloader: tracks individuales, player persistente, playlists/sets/albums, likes, perfiles, selección masiva, descargas en background, formatos reales/streaming, destino de carpeta y un A-B looper experimental.

El repo `soundcloud-looper-extension-main` aporta principalmente estas diferencias:

1. Panel flotante independiente del popup.
2. Marcado de A/B desde la posición actual del reproductor.
3. Edición de tiempos con `M:SS`, `M:SS.cc` o segundos.
4. Persistencia por track con `chrome.storage.sync`.
5. Export/import de la librería de loops.
6. Arranque automático de un loop guardado.

El repo `soundcloud-tempo-control-main` aporta una feature simple y varias features avanzadas:

1. Velocidad ajustable, valor exacto y stepper.
2. Persistencia de velocidad por track.
3. Modo Natural: el pitch cambia con la velocidad.
4. Modo Preserve key: procesamiento Web Audio/WASM.
5. Timeline de velocidad con puntos, ramps y curvas.
6. Editor, aplicación temporal, activar/desactivar perfiles y biblioteca.
7. Links/códigos compartibles y backup/import con validación.
8. Rango extendido de 0.025x a 4x en la implementación avanzada.

## Matriz de capacidades


| Área               | Segment Looper        | Playback Speed / Tempo                        | Extensión actual                     | Decisión recomendada                                        |
| ------------------ | --------------------- | --------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| A/B en vivo        | Set Start / Set End   | No                                            | Sí, con waveform y bridge propio     | Unificar en un solo modelo de reproducción                  |
| Edición precisa    | `M:SS`, centésimas    | tiempos con milisegundos                      | Parcial                              | Usar milisegundos internamente y formatear según contexto   |
| Loop automático    | Sí                    | No                                            | Sí                                   | Mantener, pero validar track y límites                      |
| Guardado por track | `chrome.storage.sync` | `localStorage`                                | sesión/estado de loop actual         | Migrar a esquema común versionado                           |
| Export/import      | JSON simple           | backup versionado, preview y rollback         | Descargas generales, no loop library | Implementar backup combinado loop + tempo + preferencias    |
| Velocidad básica   | No                    | 0.5x–2x en la ficha de Web Store              | No                                   | Fase 1: 0.5x–2x con `playbackRate`                          |
| Preserve pitch     | No                    | Sí, Web Audio + Signalsmith WASM              | No                                   | Fase 3, detrás de fallback y telemetría local de errores    |
| Speed timeline     | No                    | Puntos, ramps, instant/linear/ease/smooth     | No                                   | Fase 2, después de estabilizar velocidad fija               |
| Compartir ajustes  | No                    | hash `#sct=...` y código `SCT1`               | No                                   | Fase 2; incluir solo track + settings, nunca datos privados |
| Biblioteca         | Loops por URL         | speeds/timelines por URL, filtro y undo       | Parcial para descargas               | Vista “Mis herramientas” unificada                          |
| Hotkeys            | No                    | stepper y controles documentados              | No                                   | Añadir configurable, evitando conflictos con SoundCloud     |
| UI                 | Panel draggable       | controles integrados en footer + editor modal | popup + controles inline             | Preferir integración en player y panel compacto opcional    |
| Rango extremo      | No                    | 0.025x–4x                                     | No                                   | No publicitar hasta completar pruebas reales                |


## Mapeo técnico del looper

### Lo que hace

- `content.js` crea un panel flotante, observa navegación SPA cada 700 ms y habla con el mundo principal mediante `window.postMessage`.
- `inject.js` parchea `HTMLMediaElement.prototype.play` para capturar el elemento de audio desacoplado que usa SoundCloud.
- La frontera de loop se revisa cada 100 ms y rebobina a A cuando el tiempo llega a B menos `EDGE = 0.05` segundos.
- Los registros se guardan como `loop:<pathname>` en `chrome.storage.sync`.
- Export/import opera sobre todos los registros que empiezan con `loop:`.

### Limitaciones que hay que corregir al integrarlo

- La clave por `location.pathname` puede cambiar si SoundCloud modifica URLs o resuelve slugs; conviene guardar `trackId` y conservar pathname como fallback.
- El polling de 100 ms es suficiente para práctica general, pero no para límites muy cortos; usar eventos `timeupdate`/`seeking` y un scheduler de menor jitter donde sea posible.
- La implementación no valida que `start < end`, que ambos estén dentro de la duración ni que pertenezcan al track actualmente activo.
- `postMessage` usa `"*"`; al integrar, validar `event.source`, origen y un namespace/version de protocolo.
- El repo no contiene `LICENSE`; no copiar código automáticamente sin aclarar permiso. Usar el comportamiento como referencia o pedir autorización al autor.
- El looper actual del producto ya dibuja waveform y descarga el rango; debe reutilizarse esa lógica en lugar de instalar dos bridges que compitan por el mismo `HTMLMediaElement`.

## Mapeo técnico de Playback Speed / Tempo

### Velocidad fija

- Control de número exacto, slider y botones de incremento/decremento.
- La implementación avanzada valida `0.025 <= rate <= 4`, redondea a tres decimales y mantiene estado `enabled` separado del valor.
- Guarda velocidad por track y permite desactivarla sin borrarla.
- La feature de la ficha de Chrome Web Store anuncia 0.5x–2x y “Preserve Pitch”; esa ficha corresponde a la extensión `hkkfpmdpkbiolhfahjfoiangljpmhndm`, mientras que el repo local `soundcloud-tempo-control-main` es una implementación más amplia y separada.

### Natural vs Preserve key

- Natural puede delegarse al `HTMLMediaElement.playbackRate`.
- Preserve key requiere crear/conservar un `MediaElementAudioSourceNode`, enrutar audio seco/procesado, y apagar/restaurar rutas sin doble audio.
- Para bajas velocidades, el repo avanzado decodifica HLS a PCM con Mediabunny/WebCodecs, mantiene una caché acotada y programa buffers en AudioWorklet.
- El modo preserve usa Signalsmith Stretch compilado/WASM. Tiene fallback al comportamiento nativo si Web Audio, el worklet o el host adapter fallan.
- La propia documentación local declara límites de compatibilidad y pruebas pendientes; por tanto, no debe entrar en la primera versión de producción junto al downloader.

### Timeline

Cada punto contiene conceptualmente:

```text
{ t: tiempo, r: velocidad, d: duración del ramp, c: instant|linear|ease-in|ease-out|smooth }
```

Reglas observadas:

- El primer punto debe comenzar en `t = 0` y no tener duración de ramp.
- Los puntos deben estar ordenados y los ramps no pueden solaparse.
- El editor soporta zoom, selección de puntos, agregar/quitar, cambiar curva, cambiar pitch y aplicar una vez.
- Los timelines se guardan por track, pueden activarse/desactivarse y pueden compartirse mediante un código `SCT1` en el hash.

### Persistencia y backup

- La biblioteca avanzada separa claves de speed y timeline.
- Valida track, límites, versión, cantidad de puntos y tamaño máximo del backup.
- El import hace preview de conflictos y commit con rollback si falla una escritura.
- La extensión integrada debería conservar este patrón: `format`, `version`, validación, preview y rollback.

## Arquitectura de integración propuesta

```text
SoundCloud DOM / SPA
        |
        v
Track identity + player bridge (único)
        |
        +--> Playback controller: native rate / loop / seek
        |
        +--> Optional audio engine: preserve pitch / buffered PCM
        |
        +--> Unified settings store: loops + speed + timelines
        |
        +--> Player UI + popup + library + import/export
        |
        +--> Existing downloader and A-B WAV/export pipeline
```

Regla clave: debe existir un solo dueño del audio por elemento. El loop, speed controller y downloader tienen que consumir el mismo `track identity` y el mismo bridge; instalar por separado `inject.js`, `looper-main-bridge.js` y otro interceptor puede producir carreras, doble seek o audio duplicado.

## Roadmap por fases

### Fase 0 — Contrato y consolidación

- Definir `trackId`, URL canónica, duración y lifecycle de navegación SPA.
- Crear un protocolo interno versionado para `getState`, `setRate`, `setLoop`, `seek`, `subscribe` y `dispose`.
- Unificar las claves de storage bajo un namespace propio y migrar datos viejos del looper.
- Prohibir estados inválidos: A/B fuera de duración, A &gt;= B, rate fuera de rango.

### Fase 1 — Feature vendible rápida

- Velocidad fija 0.5x–2x, valor exacto, reset 1x y preserve pitch nativo del navegador opcional.
- Guardado por track y preferencia global “aplicar automáticamente”.
- Hotkeys para A, B, loop on/off, reset speed y ±0.05x.
- Mostrar speed y loop activos en la UI del player, popup y estado del downloader.

### Fase 2 — Producto diferencial

- Named loops: varios segmentos por track en vez de uno solo.
- Contador de repeticiones, nudge de A/B, loop relativo y crossfade corto.
- Speed timeline Natural con editor visual, preview, enable/disable y backup combinado.
- Links compartibles para loop + velocidad, con confirmación antes de aplicar.
- Biblioteca filtrable con abrir track, aplicar, renombrar, exportar y borrar/undo.

### Fase 3 — Audio profesional

- Preserve pitch con AudioWorklet/WASM empaquetado localmente.
- Ruta buffered para velocidades inferiores al límite nativo del navegador.
- Ownership, cancellation, restoration y fallback robustos al cambiar track, pausar, buscar o cerrar la página.
- Pruebas de 10–15 minutos, CPU/memoria, cambios rápidos de track, HLS AAC, progressive streams y recuperación de errores.

### Fase 4 — Downloader orientado a práctica

- “Download loop at current rate” como render offline explícito; no asumir que `playbackRate` modifica el archivo descargado.
- Exportar clip A-B con nombre, artista, track ID, timestamps y velocidad aplicada en metadata.
- Batch practice packs: varios loops seleccionados de una playlist, con manifest JSON.
- Reanudar sesiones de práctica y recordar último loop/rate por track.

## Features adicionales que la extensión podría ofrecer

Las oportunidades más coherentes con downloader + looper + tempo son:

- Múltiples loops nombrados por track: Intro, verso, chorus, solo.
- Hotkeys y nudge de 10/50/100 ms.
- Contador de repeticiones y modo “infinite”.
- Reverse/ABAB o salto automático entre segmentos, si la ruta de audio lo soporta.
- Fade-in/fade-out corto para evitar clicks en cortes.
- Exportación de loops como WAV y, separadamente, exportación de un pack de práctica.
- Marcadores visibles sobre el waveform y navegación entre marcadores.
- Modo transcripción: velocidad, loop, timestamps y notas del usuario.
- Comparación A/B de dos velocidades o dos rangos.
- Detección asistida de silencios, beats o cambios de sección; siempre como sugerencia editable.
- Compartir un enlace que abra SoundCloud y preseleccione loop/rate, sin subir audio.
- Presets globales: práctica vocal, transcripción, DJ, idioma, slow listening.
- Dashboard de biblioteca: tracks descargados, loops guardados, última práctica y storage utilizado.

## Preguntas de producto para continuar

1. ¿Quieres que la primera entrega priorice velocidad fija estable o que incluya Preserve Pitch aunque retrase la integración?
  - Quiero que CALQUE identicamente como esta hecho el selector de velocidades. Ya es una extension. COPIALO e implementalo por modulos. Verificar integridad de la copia de el codigo del repo de tempo control. Es simplemente implementar la featurea tal cual. Solo que al lado de mi boton de download actual en mi player. Revisa la implementacion de control de audio de LAS TRES extensiones. la mia y las dos de los repos.
2. ¿El loop debe seguir siendo uno por track o quieres varios loops nombrados desde el inicio?  
No, uno por track. SOLO loopeamos el track reproduciendose actualemente desde el looper actual (desde la waveform) y la nueva ventana de loop del proyecto de looper, podria SOLO ser un analisis del repo y NO copiar esta parte, ya que no me convence una ventana siempre en la pagina. Me gusta mi implementacion de tocar y hacer zoom en la waveform.
3. ¿Los ajustes deben aplicarse automáticamente al abrir cada track o solo al pulsar “activar”?  
Automaticamente, como lo hace la extension actual de pitch. 
4. ¿Qué rango quieres prometer públicamente: 0.5x–2x, 0.25x–2x o 0.025x–4x?  
con los actuales estamos bien. 
5. ¿Quieres que velocidad y loop afecten solo la reproducción, o también el render/export del WAV descargado?  
LA IDEA GANADORA de nuestra extension es la posibilidad de poder descargar un track loopeado o todo entero, la idea seria que agreguemos que LOS CONTROLES DE PITCH y TEMPO DEL PLAYER afectando al LOOP ACTUAL  (el que esta mirando desde waveform looper)  al contenido del WAV que se descargfa. o sea, si modifico y loopeo un sample y desde el player le bajo la velocidad y le pongo que preserve el pitch, HAGAMOS que se descargue eso mismo que el user eligio.
6. ¿El backup combinado debe migrar automáticamente los JSON del looper existente y aceptar los formatos del repo tempo?  
NO quiero backupn ni nada de esa  implementacion de looper. Por ahora SOLO enfoquemosnos en la extension de pitch y su descarga. 
7. ¿Los links compartibles deben incluir solo A/B y speed o también nombre de loop, timeline y preferencias?  
NO quiero links compartibles. 
8. ¿Tu público principal es práctica musical/transcripción, escucha casual, DJs/edición o descarga masiva?  

9. ¿Aceptas agregar WASM/AudioWorklet localmente y el coste de memoria/CPU de Preserve Pitch?  
FIJATE si beneficia o perjudica a mis implementaciones de audio manipulating actuales. 
10. ¿Quieres que la UI principal viva en el footer de SoundCloud, en un panel flotante, en el popup, o en los tres?  
por ahora SOLO en la waveform de current track.

## Riesgos y criterios de aceptación

- No mezclar dos capturas del reproductor ni dos dueños del grafo de audio.
- No afirmar Preserve Pitch universal: debe existir indicador de fallback y restauración nativa.
- No llamar “descarga a velocidad” a cambiar la velocidad del reproductor; renderizar un archivo nuevo si se desea esa función.
- Verificar licencias antes de copiar código: el repo Tempo declara MIT y Signalsmith/Mediabunny tienen avisos propios; el repo Segment Looper no contiene licencia.
- Mantener privacidad local: loops, rates, timelines y backups no necesitan servidor.
- Probar SPA, HLS AAC, reproductor persistente, pestañas múltiples, pause/resume, cambio rápido de track, popup cerrado y reinicio del service worker.
