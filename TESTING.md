# Browser testing

Install the repository dependencies and Playwright's Chromium build:

```powershell
npm install
npx playwright install chromium
```

Run the local verification suite (includes a Chromium Contact layout check):

```powershell
npm test
```

This suite discovers `verify-*.js` files except the explicit exclusions in
`scripts/run-verifications.js`; do not freeze its count to an older report.
It includes the loop renderer contract, an integrity check for the
pinned Signalsmith factory, and a real WASM render that verifies a slowed test
tone keeps its original pitch.

Run `node scripts/verify-icons.js` for build subsetting, deduplication and package
selection. Run `npm run test:e2e:icons` for the shared icon catalog, global 80%
scale, color inheritance, visibility, state changes, shadow roots and Chrome's
MAIN/ISOLATED registration.
It also writes `test-results/icons-catalog.png`. After changing icon mappings,
run `npm run build:icons` first. Packaging rejects stale generated icons.
See [the icon guide](docs/icon-system.md).

Run `npm run test:e2e:workspace` for the header, round shared knobs, toast lifecycle
(including modal dialogs), and extraction from sample-library entries without an
Original track. It checks selected outputs, source muting, undo, cancellation and
mobile layout with deterministic audio. Screenshots go to `test-results/workspace`.
The toasts use the local Toastify module; no CDN or network connection is required.

Run the deterministic looper browser test. It loads the unpacked extension in
Chromium, selects A-B, exports WAV, and verifies the downloaded samples. The
separate download browser test covers both Downloads and a remembered folder:

```powershell
npm run test:e2e
npm run test:e2e:download
npm run test:e2e:popup
npm run test:e2e:tempo
npm run test:e2e:sampler-time
npm run test:e2e:sampler-persistence
npm run test:e2e:pad-editor
npm run test:e2e:slices
npm run test:e2e:stems-ui
npm run test:e2e:stem-presets
npm run test:e2e:stems
npm run test:e2e:eq
npm run test:feedback
```

`test:e2e:popup` checks that the popup background covers the bottom and right
edges when the viewport is slightly larger than the content, at display scales
of 100%, 125%, 150%, and 200%.

`test:e2e:sampler-time` loads the working-tree extension and exercises the full
sampler message bridge and packaged Signalsmith engine. It measures duration
and stereo pitch at 25–400%, checks default and uploaded samples, independent
PITCH, cache reuse, reset, obsolete renders and invalid input. Sampler persistence
also verifies that named presets restore each pad's TIME setting.

`test:e2e:pad-editor` covers right-click editing, immediate playback of changed
bounds, reload persistence, cancellation during loading, external trim revisions,
shared source transfers, control updates and the shared 64 MiB PCM cache budget.
Its timing measurements describe audio scheduling, not audible latency or total
browser memory. `test:e2e:slices` also verifies metadata-only reads and concurrent
trim rejection against the real offscreen handler and IndexedDB.

`test:e2e:eq` measures the live parametric EQ with a generated tone in the
owned and shared player graphs, and checks the spectrum, editor controls,
bypass, Pro revocation and player replacement. `test:e2e:tempo` also checks
that EQ points and bypass survive a page reload. These fixtures do not replace
a manual check with a real SoundCloud session.

`test:e2e:stem-presets` exercises real IndexedDB and filesystem handles (OPFS
stands in for the OS folder picker), atomic WAV saves, metadata-only autosave,
reload without inference, folder/reset, incomplete and corrupt presets, and
responsive layout. It measures a real Signalsmith AudioWorklet with a 440 Hz
tone at 0.1–3x, with and without Keep Tone. It uses a persistent Chromium profile:
the Windows incognito build crashes when restoring OPFS handles from IndexedDB.
`test:e2e:stems` additionally saves real model outputs and restores/plays them
from another extension page, under MV3 CSP, without an active job or re-inference.

`test:feedback` covers the local validation, Turnstile gate, duplicate handling,
rate limit and retention cleanup for the optional uninstall-feedback Worker. It
does not send data to a production service.

Run against a real public SoundCloud track:

```powershell
npm run test:live
npm run test:live:folder
```

Override the target or show the automated browser when needed:

```powershell
$env:SCDL_LIVE_TRACK_URL="https://soundcloud.com/artist/track"
$env:SCDL_HEADED="1"
npm run test:live
```

SoundCloud may require a signed-in session before it allows playback. To reuse
the persistent profile created by the interactive browser, sign in there once,
close it, then run the smoke test with that profile:

```powershell
npm run browser:live -- "https://soundcloud.com/artist/track"
# Sign in in the opened browser, then close it.
$env:SCDL_LIVE_PROFILE=".playwright-profile"
npm run test:live
```

Failures from the live test keep a screenshot, diagnostics, and a Playwright
trace under `test-results/live-looper/`. Open the trace with:

```powershell
npx playwright show-trace test-results/live-looper/trace.zip
```

For interactive debugging, open a persistent browser profile with the extension
loaded:

```powershell
npm run browser:live -- "https://soundcloud.com/artist/track"
```

The terminal prints a CDP command that can inspect the live page. The profile is
stored in `.playwright-profile/`, so a SoundCloud login survives browser restarts.

Create a test or release-candidate ZIP after the automated checks pass. Supply
the matching HTTPS Worker endpoint and public entitlement JWK/JWKS; packaging
fails if either is missing, the local test login remains, a runtime script is
omitted, or development-only paths enter the ZIP:

```sh
PLAYER_TOOLS_API_BASE_URL=https://sctd-test.example.com/api/player-tools \
ENTITLEMENT_PUBLIC_JWK='{"keys":[...]}' npm run package:extension
```

Then smoke-test that exact ZIP as an extracted MV3 extension, rather than the
source tree:

```sh
npm run test:package -- dist/soundcloud-track-downloader-<version>.zip
```

## Evidence and release scope — 2026-09-24

At `29d7946`, `npm test` passed 48 verifications, `test:player-tools` passed four
client verifiers and 29 service tests, and `test:e2e:tempo` passed. Chromium for
Contact needed execution outside the macOS sandbox. The landing verifier skipped
comparison against the absent external `reviews.txt`; it does not freshly
validate the authenticity of Store reviews.

`verify-popup-selection.js` covers the current complete-list selector: confirmation,
actual selectable count, continuous numbering, local virtual scrolling and failure
recovery. This is not evidence of bounded-memory pagination for 50,000 selections.

The service tests use a simulated provider and local SQLite. The user's successful
Test Mode purchase, automatic Pro activation, and exit from the seven-day trial
are separate external evidence confirmed by the project owner. Refund/restore/seat
scenarios, Live, the current complete `test:release-local` gate and exact production
ZIP remain in the [release checklist](docs/planning-20260915/10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md).
Do not promote the diagnostic ZIP from September 23 to a current release candidate.

## Audio local en Stems

- `npm.cmd run test:e2e:stem-local-audio`: selector de archivos, decodificación,
  recorte de hasta 120 s, mono/estéreo, presets, velocidad/Keep Tone y recuperación sin
  inferencia; capturas en `test-results/stem-local-audio/`.
- `npm.cmd run test:e2e:stems`: incluye importación local, separación con modelo
  real y reapertura del preset bajo CSP de la extensión MV3.

La regresión `verify-stem-loop-preparation.js` simula una pista HLS de 25 minutos
y confirma que loops de 20 y 120 segundos sólo descarga/decodifica los segmentos
seleccionados. `npm.cmd test` la ejecuta junto con las verificaciones locales.

La regresión incluye una variante `abr_sq` con MIME `audio/mpegurl` que devuelve
404 antes del MP3 HLS válido: el selector debe distinguir playlists de MP3.
`test:e2e:stems-ui` verifica que un error de preparación muestre el motivo y permita
reintentar, sin exponer URLs firmadas.

Diagnóstico opcional con red y decodificación real de Chrome:
`node scripts/inspect-live-stem-preparation.cjs`. Requiere `SC_CLIENT_ID` y
`SC_TRACK_ID`; acepta `SC_START_MS` (por defecto 1205000) y `SC_LOOP_SECONDS`
(por defecto 20). No usa cookies ni guarda audio, tokens o URLs. El 2026-10-05,
la pista 2137202109 reprodujo el 404 antes del arreglo y preparó correctamente
loops de 20 y 120 segundos después de distinguir los MIME.
