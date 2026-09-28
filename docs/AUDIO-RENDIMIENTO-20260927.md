# Audio: implementación y límites — 2026-09-27

TIME está integrado: 25–400% de duración conservando el tono, próximo golpe,
caché por pad, presets antiguos a 100%, invalidación de resultados obsoletos.

## Mejoras implementadas

- FX conserva el impulso de reverb mientras no cambien room/size/decay/sample rate.
  Las curvas de distorsión también se reutilizan si sus parámetros no cambian.
  La causa del costo era regenerar el impulso en cada llamada a `setCharacter`,
  incluso al ajustar delay con reverb apagada.
- La caché PCM de pads tiene 64 MiB por pestaña y expulsa los menos usados.
  Las voces en reproducción conservan su buffer: expulsar caché no corta audio.
- Cerrar el panel libera también el piano después de 60 segundos de inactividad.
- El preview de Record reemplaza los chunks capturados por vistas del PCM del
  AudioBuffer. Exportación y waveform siguen usando la misma interfaz, sin retener
  además las matrices originales. La conversión todavía tiene un pico transitorio.
- TIME admite hasta ocho preparaciones pendientes en offscreen, ejecutadas de a
  una. Una cola llena devuelve un error recuperable; todos los contextos se cierran.

## Medición reproducible

`node scripts/measure-audio-effects.js --baseline` mide HEAD; sin ese argumento
mide el checkout. Treinta cambios de delay, reverb apagada con decay configurado
a 12 segundos, Chromium headless en este equipo:

| Versión | Media por cambio | Buffers creados | Asignación PCM acumulada |
| --- | ---: | ---: | ---: |
| Antes | 122,99 ms | 30 | 131,84 MiB |
| Después | 0,11 ms | 0 | 0 MiB |

No son mediciones de memoria total de Chrome ni certificación de hardware modesto.

## Compatibilidad y alcance

El manifest declara Chrome 116 como piso de instalación: se usa
[`runtime.getContexts`, disponible desde 116](https://developer.chrome.com/docs/extensions/reference/api/offscreen).
Los presets usan [Popover, incorporado en Chromium 114](https://developer.chrome.com/blog/introducing-popover-api).
Ese piso se basa en las APIs; falta ejecutar la matriz completa sobre Chrome 116.
Las pruebas locales usan el Chromium instalado con Playwright.

No hay garantía para todos los Chrome ni para todos los equipos. Los 64 MiB son
solo caché de pads por pestaña, no un límite global: voces activas, grabación,
piano, SoundCloud y otras pestañas suman memoria. TIME y exportación aún tienen
colas separadas; el render obsoleto se descarta pero no se cancela en offscreen.
La carga de archivos comprimidos comprueba el PCM después del decode. Para
certificar equipos de 4 GB faltan pruebas reales de simultaneidad, RAM de proceso,
sesiones largas, CPU inactiva y cortes de audio. Estas limitaciones no se resuelven
simplemente por empaquetar el producto como extensión.

## Verificación

- `node scripts/verify-audio-memory.js`: LRU, bytes, voces, cola, cierre y errores.
- `node scripts/verify-audio-effects-core.js`: regresión de impulso reutilizado.
- `npm run test:e2e:sampler-time` y `test:e2e:sampler-persistence`.
- `npm run test:e2e:effects` y `test:e2e:record`.
- `node scripts/verify-piano-mode.js`.

La suite general y tempo deben informarse por separado: sus fixtures arrastran
expectativas de permisos y layout y stubs incompletos; no equivalen a fallos de TIME.
