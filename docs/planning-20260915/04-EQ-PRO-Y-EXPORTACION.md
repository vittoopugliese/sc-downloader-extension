# 04 — EQ Pro para escuchar y exportar

## Alcance vigente — EQ paramétrico en vivo, 21/09/2026

El usuario adelantó esta función y reemplazó la V1 fija de tres bandas por un EQ
paramétrico de hasta ocho puntos con espectro de frecuencias en vivo. Confirmó
explícitamente **sólo al escuchar por ahora**. Exportar EQ a WAV/pads queda pendiente;
las secciones E3 y los criterios históricos de exportación no bloquean esta V1.

Implementación local: `parametric-eq.js`, `parametric-eq-ui.js`, integración en
`audio-effects-core.js` y `tempo-control-main.js`. Doble clic agrega un punto;
arrastrar cambia frecuencia/ganancia; rueda sobre el punto cambia Q; doble clic
en un punto lo elimina. Incluye teclado, bypass, reset y persistencia local.
Rango 20 Hz–20 kHz, ±36 dB, Q 0,1–18. Doble clic junto al borde izquierdo
crea high-pass; junto al derecho crea low-pass. En estos filtros, arrastrar
horizontalmente ajusta frecuencia, verticalmente Q y la rueda también ajusta Q.
El botón de hard clip conmuta un WaveShaper después del EQ; por defecto queda
apagado, sin limitador propio del EQ. El corazón de bypass figura en la barra y
en el encabezado plegado, sincronizado. El encabezado usa `assets/icons/eq.svg`.
La curva muestra la respuesta de los filtros incluso en bypass. El usuario quitó
la compensación automática de ganancia; los boosts cambian el nivel real. El
espectro representa la salida del EQ.

Se conserva EQ exclusivamente Pro (`set-eq` / `parametricEq`). Al perder acceso o
activar bypass global, la cadena vuelve a respuesta neutra sin borrar los puntos.
Se observan las conexiones de la fuente desde `document_start` y se inserta la
cadena antes de sus destinos registrados, conservando controles de volumen/mute.
No requiere permisos nuevos. Recargar la extensión y la pestaña después de instalar.

Pruebas: `npm run test:e2e:eq` mide atenuación real con fuente propia, compartida y
constructor interceptado, bypass, revocación, reemplazo SPA y controles del editor.
`test:e2e:tempo` cubre integración y persistencia. Las pruebas usan Chromium con
fixtures; queda pendiente la comprobación manual contra SoundCloud real y en el
ZIP final. No declarar cerrada la release comercial por estas pruebas.

Después de esta V1 se retoma C1 del plan 10: confiabilidad de guardados, offscreen y
colecciones; luego contrato/licencias y gates comerciales. El alcance histórico
siguiente se conserva como referencia para la futura exportación del EQ.

Objetivo: completar el tercer FX básico con un ecualizador útil para escuchar SoundCloud y exportar loop/track con el mismo ajuste. EQ siempre Pro, como pidió el usuario.

## Alcance propuesto de V1

EQ de tres bandas: **graves, medios y agudos**, bypass propio y Reset. Suficiente para una experiencia musical clara y una UI compacta. No analizador espectral, EQ de diez bandas ni suite de mezcla en esta etapa.

Valores iniciales de diseño, ajustables tras escuchar: graves `lowshelf` 120 Hz; medios `peaking` 1.000 Hz, Q 0,7; agudos `highshelf` 8.000 Hz; ganancias −12 a +12 dB en pasos de 1 dB. Estado inicial 0/0/0 dB, identidad. Limitar frecuencias a valores válidos según sample rate. Los tipos y parámetros están definidos por [Web Audio](https://www.w3.org/TR/webaudio/#BiquadFilterNode); esas frecuencias concretas son una elección de producto.

UI: `FX` conserva reverb/delay y suma `EQ · Pro` colapsable. Durante Free se puede descubrir la explicación y CTA, sin modificar audio con EQ. No hacer pasar una muestra pregrabada por una prueba del track actual.

## Dependencia crítica: el audio original

`audio-effects-core.js` mantiene el dry path de SoundCloud cuando la página posee el `MediaElementAudioSourceNode`. Agrega retornos wet de reverb/delay; esto funciona para sumar ambiente, pero **un EQ que sólo afecta el retorno no ecualiza todo el track**. Además un corte de graves no se logra simplemente sumando una rama paralela de graves.

Por eso la primera tarea es una comprobación acotada de topología, antes de diseñar todos los sliders.

### E0 — Comprobación de compatibilidad, 0,5–1 día estimado

1. Reproducir los modos ya contemplados por `verify-effects-browser.js`: fuente propia, compartida y constructor de fuente interceptado. Agregar sesión real de SoundCloud como comprobación distinta.
2. Identificar si existe un punto controlado de inserción serial en la señal completa. El dueño del contexto no implica ser dueño de todas las conexiones.
3. Medir que una atenuación de graves modifica también señal seca y que no queda una copia seca paralela audible. Comprobar volumen nativo, mute, cambio de track, anuncios y reanudación de contexto.
4. No llamar `disconnect()` global sobre nodos ajenos ni cerrar un contexto compartido. Mantener ruta de recuperación neutra y liberación de nodos propios.

Salida: topología compatible y reproducible, o impedimento documentado con decisión concreta. Si sólo se puede exportar con EQ pero no escuchar, eso es alcance parcial y no satisface “EQ en el player”; no anunciarlo como completo. Captura de pestaña, permisos nuevos o un reproductor alternativo requieren evaluar un alcance diferente, no incorporarlos silenciosamente.

## E1 — Estado y contrato compartidos

Proponer un módulo puro nuevo `scripts/audio-effects-settings.js` para normalización y serialización, compartido entre vivo/export; no reutilizar directamente el módulo actual con hooks globales de AudioContext en el offscreen.

Esquema versionado: rate, preservePitch, reverb/delay con sus parámetros reales, EQ con enabled y tres ganancias, estado de bypass efectivo. Definir `isIdentity()` común: EQ plano y FX a cero/bypass no deben confundirse con transformación activa. No borrar parámetros guardados por hacer bypass.

Validar finitud, rango, versión y claves admitidas en background antes de trabajo costoso. Un payload desconocido/malformado no debe terminar renderizado como original sin aviso. Mismo snapshot inmutable de ajustes y track al pulsar export, aunque después el usuario mueva sliders.

Extender policy con capacidad/operación EQ exclusiva Pro; `set-effect` genérico hoy permite playback durante trial, por lo que no basta usarlo sin distinguir EQ. Gates en UI, setters y handler de export, no sólo candado visual. Mantener el modelo de autoridad existente.

## E2 — Procesamiento en vivo

Orden propuesto, a validar con el grafo compatible: señal con tempo/pitch → EQ → señal seca y envíos reverb/delay → mezcla → control de salida. Así EQ cambia también el material que entra a reverb/delay. Copiar ese orden al renderer; no colocar el EQ en otro punto al exportar.

Cambios suaves de AudioParam, bypass sin saltos bruscos, mantener estéreo y limpiar colas según cambio de track. No duplicar sources, contextos ni listeners al abrir/cerrar el panel.

Planificar margen de salida: el boost combinado puede recortar audio. Usar atenuación conservadora calculada a partir de la respuesta de la cadena, con margen y protección de salida si hace falta. Probar picos reales; no prometer que “−12 dB de preamp” basta para cualquier combinación. A EQ neutro no bajar permanentemente el volumen. Comparaciones de presets a nivel equivalente para que “mejor” no signifique sólo más fuerte.

## E3 — Exportación de loop y track completo

Archivos existentes a recorrer: `scripts/tempo-control-main.js`, `scripts/looper.js`, `scripts/background.js`, `scripts/download-intent.js`, `scripts/offscreen.js`, `scripts/loop-audio-renderer.js`; localizar el ejecutor concreto que invoque el renderer antes de editarlo.

El renderer actual sólo normaliza rate/preservePitch. Incorporar una etapa offline de FX después de la transformación temporal, con mismo orden y valores efectivos del vivo. Reverb/delay no se consideran ya exportados sólo porque exista el término “effects” en un mensaje.

1. Transportar parámetros completos desde ambas entradas de export.
2. Extender `hasEffectivePlaybackTransform`: EQ o reverb a 1x también requieren ruta transformada y Pro.
3. Autorizar antes de resolver/descargar/decodificar; revalidar estado cuando corresponda al contrato de acceso.
4. Renderizar tempo/pitch → EQ → reverb/delay → salida → WAV. No procesar EQ dos veces ni omitirlo cuando rate=1.
5. Loop: respetar A/B y duración transformada. Propuesta V1: longitud exacta del rango transformado, sin añadir cola; aclarar que la cola final de FX se corta. Probar precalentamiento determinista del grafo para aproximar el loop que ya está repitiéndose. No prometer igualdad muestra a muestra con una reproducción viva de historia arbitraria.
6. Track: WAV completo con parámetros congelados. Definir longitud exacta de track transformado como base; añadir colas opcionales queda fuera salvo necesidad validada.
7. Mantener cancelación, progreso, límites de PCM/memoria existentes y error accionable para tracks largos. No asumir que el límite de dos tracks en bulk resuelve memoria del WAV completo.
8. Descarga original/bulk conserva su ruta gratuita y sus formatos; exportar WAV desde un stream no mejora la calidad de origen.

El usuario espera loop **y** track: el cierre exige ambos. Si una ruta queda pendiente, marcar EQ/export como incompleto y no promocionar la promesa completa.

## E4 — Verificación que demuestra el efecto

Extender verificadores de efectos/renderer existentes; evitar aprobar sólo snapshots de UI.

- Tono grave/medio/agudo: medir ganancia esperada, por ejemplo tolerancia inicial de ±0,5 dB frente a respuesta teórica en la frecuencia probada. Incluir cortes y boosts.
- EQ neutro: respuesta plana y sin caída de nivel inesperada; bypass recupera señal base.
- Fuente compartida: demostrar que cortes afectan la señal seca; no sólo cola reverberada.
- Slowed y Preserve Pitch: combinaciones con EQ, duración correcta y frecuencia conforme a cada modo.
- WAV de loop y track: 1x con EQ activo debe salir transformado; EQ distinto produce PCM distinto donde corresponde.
- Mono/estéreo, sample rates soportados, boosts extremos, silencio, NaN/Infinity, clipping y cancelación.
- Preset, refresh/cambio SPA, track nuevo, bypass, pérdida de Pro, loading y reinicio de worker.
- Real SoundCloud: comprobar audio y export con track autorizado en Chrome; los mocks no certifican integración real.

Comandos a aprovechar: `npm run test:e2e:effects`, `node scripts/verify-audio-effects-core.js`, `node scripts/verify-pitched-loop-renderer.js`, `node scripts/verify-loop-background-routing.js`, `npm run test:e2e`, `npm run test:e2e:tempo`. Ejecutarlos al implementar, no se declaran corridos por este documento.

## Éxito comercial y orden

EQ se demuestra con un antes/después breve, se guarda en “Late Night” y da una razón concreta para Pro. Medir intentos EQ → paywall → compra y EQ aplicado por compradores. Si mucha gente intenta EQ y no compra, revisar explicación, precio y checkout antes de agregar otra banda.

Después del cierre comercial del plan 01, éste es mi siguiente desarrollo musical recomendado. Puede adelantarse E0 mientras se preparan textos de Store, porque responde a un riesgo técnico independiente.
