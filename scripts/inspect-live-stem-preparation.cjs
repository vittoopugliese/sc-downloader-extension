// Opt-in live diagnostic. Credentials and signed media URLs are never logged or saved.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const clientId = process.env.SC_CLIENT_ID;
  const trackId = process.env.SC_TRACK_ID;
  if (!clientId || !/^\d+$/.test(trackId || '')) throw new Error('Set SC_CLIENT_ID and SC_TRACK_ID.');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let requests = 0;
    await page.exposeFunction('network', async url => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['api-v2.soundcloud.com', 'sndcdn.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) throw new Error('Unexpected media host');
      const response = await fetch(url);
      requests++;
      return { status: response.status, headers: Object.fromEntries(response.headers), bytes: Buffer.from(await response.arrayBuffer()).toString('base64') };
    });
    await page.evaluate(() => {
      window.fetch = async url => {
        const result = await network(String(url));
        return new Response(Uint8Array.from(atob(result.bytes), c => c.charCodeAt(0)), { status: result.status, headers: result.headers });
      };
    });
    for (const file of ['format-utils.js', 'loop-audio-renderer.js', 'download-core.js', 'stream-selector.js', 'download-track.js', 'soundcloud-http.js', 'download-source.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, file), 'utf8') });
    }
    const result = await page.evaluate(async ({ clientId, trackId, startMs, seconds }) => {
      const source = SCDownloadSource.create({ request: fetch, getOAuthToken: async () => null });
      const initial = await source.refresh(trackId, clientId);
      const resolved = await source.resolveForPlayback(initial, 'auto', { preferHls: true });
      const { blob } = await SCDownload.buildTrackBlob(resolved.streamUrl, resolved.trackData, undefined, undefined,
        { startMs, endMs: startMs + seconds * 1000 }, { rate: 1, preservePitch: false }, {}, true);
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        if (Math.abs(audio.duration - seconds) > .05) throw new Error('Prepared audio does not match selected duration');
        return { protocol: resolved.trackData.streamProtocol, duration: audio.duration, sourceDuration: initial.durationMs / 1000 };
      } finally { await context.close(); }
    }, { clientId, trackId, startMs: Number(process.env.SC_START_MS || 1205000), seconds: Number(process.env.SC_LOOP_SECONDS || 20) });
    console.log(JSON.stringify({ ...result, requests }));
  } finally { await browser.close(); }
})().catch(error => { console.error(String(error.message).replace(/https?:\/\/[^\s)]+/g, '<URL>')); process.exitCode = 1; });
