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

Run the deterministic looper browser test. It loads the unpacked extension in
Chromium, selects A-B, exports WAV, and verifies the downloaded samples. The
separate download browser test covers both Downloads and a remembered folder:

```powershell
npm run test:e2e
npm run test:e2e:download
npm run test:e2e:popup
npm run test:feedback
```

`test:e2e:popup` checks that the popup background covers the bottom and right
edges when the viewport is slightly larger than the content, at display scales
of 100%, 125%, 150%, and 200%.

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

Create the Store-ready extension ZIP after the automated checks pass:

```powershell
npm run package:extension
```
