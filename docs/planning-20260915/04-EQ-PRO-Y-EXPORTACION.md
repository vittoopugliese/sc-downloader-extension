# 04 — EQ Pro para escuchar y exportar

**CERRADO en implementación local; ABIERTO QA real/candidato — 24/09/2026, `29d7946`.** [Estado general](../ESTADO-ACTUAL-20260924.md). Este plan no se archiva hasta completar los casos externos de audio y el artefacto que lo distribuya.

## Especificación implementada

El diseño fijo de tres bandas fue sustituido por un EQ paramétrico de hasta ocho puntos. El alcance inicial «sólo escuchar» fue ampliado: EQ y FX también viajan al render offline de loops y tracks. No reimplementar export ni un segundo EQ desde el boceto antiguo.

- Módulos: `scripts/parametric-eq.js`, `parametric-eq-ui.js`, `audio-effects-core.js`, `tempo-control-main.js` y pipeline de export.
- Rango 20 Hz–20 kHz, ±36 dB, Q 0,1–18. Doble clic agrega/elimina; drag cambia frecuencia/ganancia; rueda cambia Q. En los bordes se crean high-pass/low-pass, con drag vertical de Q.
- Teclado, bypass, reset, persistencia y espectro de salida. La curva conserva la respuesta configurada durante bypass.
- Hard clip opcional, apagado por defecto; sin compensación automática de ganancia. Los boosts cambian el nivel y pueden recortar: no prometer protección automática contra clipping.
- EQ exclusivamente PRO (`set-eq` / `parametricEq`). Pérdida de acceso o bypass global neutraliza la cadena conservando preferencias.
- Inserción en serie en las conexiones de fuente observadas desde `document_start`; mantener volumen/mute y limpieza de nodos propios.
- Snapshot validado e inmutable al exportar, normalización y efectos offline de `audio-effects-core.js` antes de codificar WAV. EQ activo a 1× también requiere PRO.
- El renderer offline `renderSample()` añade cola de reverb/delay acotada a doce segundos y usa compresor de salida; su presupuesto PCM de 64 MiB también afecta a las rutas de export que lo reutilizan. No describir exports con FX como duración exacta A/B sin cola ni como render ilimitado.
- Loop y track completo conservan tempo/Keep Tone y efectos efectivos. No prometer igualdad muestra a muestra con un grafo vivo de historia arbitraria ni mejor calidad de origen por convertir a WAV.

## Cierre local

- [x] Estado paramétrico, validación, persistencia y autorización.
- [x] Procesamiento vivo y editor, bypass/reset y neutralización por revocación.
- [x] Transporte/render offline EQ/FX para exports; el registro del 22/09 y los módulos actuales reemplazan el pendiente histórico E3.
- [x] Regresiones locales de settings, motor, routing y renderer: incluidas en `npm test`, aprobado el 24/09.
- [x] Header/reset y persistencia del panel: `npm run test:e2e:tempo`, aprobado el 24/09.
- [x] Gate de navegador EQ/FX registrado el 23/09 sobre fixtures; conservar su alcance histórico, sin presentarlo como ejecución nueva ni prueba del ZIP actual.

## Pendiente antes de certificar la entrega

- [ ] SoundCloud real: fuentes propias/compartidas, cambios SPA, volumen/mute, anuncios/reanudación, cortes sobre señal seca y renovación/revocación de PRO.
- [ ] Loop y track del ZIP candidato: WAV a 1× con sólo EQ y combinaciones tempo/Keep Tone/reverb/delay; duración, canales, bypass, clipping, cancelación y límites de memoria.
- [ ] Medición y escucha de audio autorizado; tonos sintéticos no demuestran fidelidad perceptual sobre toda música.
- [ ] Coherencia de ayuda, Store y capturas con el candidato publicado.

Verificadores disponibles: `test:e2e:eq`, `test:e2e:effects`, `test:e2e:tempo`, `test:e2e`, `verify-audio-effects-core.js`, `verify-pitched-loop-renderer.js` y `verify-loop-background-routing.js`. Ejecutar según cambios del candidato; registrar commit, entorno y resultado.

Presets completos como “Late Night” siguen en [05](05-PRESETS-Y-PERSISTENCIA.md). No anunciar una biblioteca con nombre por disponer de presets de fábrica o ajustes persistidos.
