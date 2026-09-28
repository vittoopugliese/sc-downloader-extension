# Editor de curvas para samples y FX: factibilidad

Investigación del 27/09/2026. Es una propuesta; no implementa funcionalidades ni cambia el alcance de entregas anteriores.

## Referencias y funcionamiento

- **Gross Beat:** procesa audio entrante con un buffer móvil de dos compases, 36 envelopes de tiempo y 36 de volumen. Las curvas permiten repetir, hacer stutter, scratch, reverse y gating. Su eje vertical Time representa un desplazamiento respecto de la lectura normal: un tramo horizontal conserva la velocidad; un salto cambia la posición; la pendiente modifica velocidad y dirección. No equivale a dibujar directamente la amplitud de la onda. [Manual oficial](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Gross%20Beat.htm).
- **ShaperBox:** combina módulos con curvas de modulación editables, sincronización y procesamiento multibanda. La página actual incluye Time, Volume, Filter, Pan, Width, Drive, Crush, Noise, Liquid, Reverb y Pitch. En la segunda referencia del usuario está seleccionado Liquid: la curva controla el efecto de flanger/phaser, no el tiempo del sample. [Producto oficial](https://www.cableguys.com/shaperbox).
- **TimeShaper:** usa curvas para alterar el tiempo del audio y crear repeticiones, cambios de velocidad, reverse y scratch. [Descripción oficial](https://www.cableguys.com/timeshaper).

## Base encontrada en este checkout

- `scripts/audio-effects-core.js`: grafo compartido de efectos en vivo/offline; reverb, delay, flanger, phaser, bitcrusher y saturación, integración del EQ y carga de Worklet.
- `scripts/loop-audio-renderer.js`: render de loops y Signalsmith/WASM para preservar tono al cambiar velocidad. Eso no demuestra soporte de curvas arbitrarias de tiempo en vivo.
- `scripts/sampler-core.js`: helpers del sampler y división de WAV en ocho slices con microfades.
- `README.md`: documenta TIME por pad, PITCH independiente y grabación de la mezcla final a WAV. Son capacidades descritas en el checkout, no una validación audible nueva.

## Evaluación de ingeniería

Es viable construir un módulo propio con esta interacción. El editor visual es compartible entre efectos; cada destino requiere su propio procesamiento y escala. La dificultad principal es la lectura temporal del audio y la sincronización, no dibujar puntos.

Propuesta inicial: seleccionar un sample o loop ya cargado, fijar BPM y comienzo de compás, dibujar curvas, escuchar y renderizar el resultado a un pad nuevo o WAV. Empezar con Volume, Filter y Pan; después Time con repeat, reverse y tape stop. Conservar el original y guardar curvas/presets para editar sin acumular renders destructivos.

Editor: agregar/mover/borrar puntos; segmentos rectos, escalonados y curvos con tensión; ajuste a rejilla musical; longitud en compases; deshacer/rehacer; bypass, mezcla y presets. Cada módulo tiene su curva y unidad vertical. Usar un mismo reloj de audio para todos; la animación de pantalla solamente representa ese reloj.

Web Audio ofrece automatización mediante `AudioParam`, procesamiento personalizado en `AudioWorklet` y render a buffer mediante `OfflineAudioContext`. Son bases para la arquitectura propuesta, no una implementación incorporada de Gross Beat/ShaperBox. [AudioParam](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam), [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet), [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext).

Para Time sobre samples cargados, implementar un lector de buffer con interpolación, control de posición y suavizado/crossfade en saltos. Para el stream en vivo, además hace falta un buffer circular: no se puede leer audio futuro que todavía no llegó. Acelerar/acercarse al presente exige límites o latencia deliberada. La lectura variable cambia también la afinación; conservar tono bajo curvas rápidas/arbitrarias requiere procesamiento adicional y pruebas de calidad. El soporte actual de estiramiento a velocidad fija no resuelve ese problema automáticamente.

Antes de extender al stream de SoundCloud o a muchos módulos simultáneos, comprobar sincronía al pausar/seek/cambiar velocidad, clics en saltos y bordes, equivalencia entre preview y exportación, CPU/memoria y ejecución bajo la CSP real. Para la primera versión, BPM y fase manuales evitan convertir la detección automática de ritmo en requisito.

Conclusión: un editor de curvas con resampling a pads/WAV es una evolución razonable del proyecto. La paridad completa con ShaperBox (todos los módulos, multibanda, triggers y calidad del procesamiento) sería un proyecto considerablemente mayor y necesita prototipos y mediciones antes de estimar plazos.
