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
```

Run against a real public SoundCloud track:

```powershell
npm run test:live
```

Override the target or show the automated browser when needed:

```powershell
$env:SCDL_LIVE_TRACK_URL="https://soundcloud.com/artist/track"
$env:SCDL_HEADED="1"
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
