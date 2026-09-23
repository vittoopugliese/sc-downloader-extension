# Browser testing

Install the repository dependencies and Playwright's Chromium build:

```powershell
npm install
npx playwright install chromium
```

Run the fast, DOM-free verification suite:

```powershell
npm test
```

This suite includes the loop renderer contract, an integrity check for the
pinned Signalsmith factory, and a real WASM render that verifies a slowed test
tone keeps its original pitch.

Run the deterministic looper browser test. It loads the unpacked extension in
Chromium, selects A-B, exports WAV, and verifies the downloaded samples. The
separate download browser test covers both Downloads and a remembered folder:

```powershell
npm run test:e2e
npm run test:e2e:download
npm run test:e2e:popup
npm run test:e2e:tempo
npm run test:e2e:eq
npm run test:feedback
```

`test:e2e:popup` checks that the popup background covers the bottom and right
edges when the viewport is slightly larger than the content, at display scales
of 100%, 125%, 150%, and 200%.

`test:e2e:eq` measures the live parametric EQ with a generated tone in the
owned and shared player graphs, and checks the spectrum, editor controls,
bypass, Pro revocation and player replacement. `test:e2e:tempo` also checks
that EQ points and bypass survive a page reload. These fixtures do not replace
a manual check with a real SoundCloud session.

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
