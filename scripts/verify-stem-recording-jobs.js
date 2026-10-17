const assert = require("node:assert/strict");
require("./record-core.js");
require("./stem-recording-jobs.js");

// Likes Explorer recording upload -> Cache Storage -> stems.html?recording=<id>.
(async () => {
  const { inspectWav, create, audioKey } = globalThis.SCStemRecordingJobs;
  const wav = async (seconds, rate = 48000) => {
    const frames = Math.round(seconds * rate), channels = [new Float32Array(frames).fill(.1), new Float32Array(frames).fill(-.1)];
    return new Uint8Array(await SCRecord.encodeWav([channels], frames, rate).arrayBuffer());
  };
  const short = await wav(.5);
  assert.equal(Math.round(inspectWav(short).durationMs), 500);
  assert.equal(inspectWav(await wav(121, 8000)), null, "Recordings longer than two minutes are rejected");
  const broken = short.slice(); broken[22] = 1;
  assert.equal(inspectWav(broken), null, "Only stereo PCM is accepted");
  assert.equal(inspectWav(short.slice(0, short.length - 4)), null, "A truncated upload is rejected");

  const session = {}, tabs = [], cacheEntries = new Map();
  let allowed = true;
  const chrome = {
    runtime: { id: "ext", getURL: path => `chrome-extension://ext/${path}` },
    storage: { session: {
      async get(name) { return name === null ? { ...session } : { [name]: session[name] }; },
      async set(values) { Object.assign(session, values); },
      async remove(name) { delete session[name]; },
    } },
    tabs: {
      async create({ url }) { const tab = { id: tabs.length + 10, url }; tabs.push(tab); return tab; },
      async update(id, { url }) { tabs.find(tab => tab.id === id).url = url; },
      async remove(id) { tabs.splice(tabs.findIndex(tab => tab.id === id), 1); },
    },
  };
  const caches = { async open() { return {
    async put(url, response) { cacheEntries.set(url, new Uint8Array(await response.arrayBuffer())); },
    async delete(request) { return cacheEntries.delete(typeof request === "string" ? request : request.url); },
    async keys() { return [...cacheEntries.keys()].map(url => ({ url })); },
  }; } };
  const jobs = create({ chrome, caches, authorize: async () => ({ allowed }) });
  const sender = { id: "ext", url: "https://soundcloud.com/you/likes", tab: { id: 3 } };
  const upload = (bytes, options = {}) => new Promise(resolve => {
    const listeners = { message: [], disconnect: [] };
    const port = { name: "stem-recording-upload", sender: options.sender || sender,
      postMessage: resolve, onMessage: { addListener: fn => listeners.message.push(fn) }, onDisconnect: { addListener: fn => listeners.disconnect.push(fn) } };
    assert.equal(jobs.acceptsPort(port.name), true);
    jobs.connect(port);
    const send = message => listeners.message.forEach(fn => fn(message));
    send({ type: "begin", size: options.size ?? bytes.length, title: "Track (recording)", artist: "Artist",
      artworkUrl: "https://i1.sndcdn.com/a.jpg", trackUrl: options.trackUrl ?? "https://soundcloud.com/artist/track" });
    for (let i = 0; i < bytes.length; i += 7000) send({ type: "chunk", data: Buffer.from(bytes.subarray(i, i + 7000)).toString("base64") });
    send({ type: "end" });
  });

  assert.deepEqual(await upload(short), { success: true });
  const id = tabs[0].url.match(/recording=([a-f0-9-]{36})$/)?.[1];
  assert.ok(id, "The stems tab opens with the recording id");
  assert.deepEqual(cacheEntries.get(audioKey(id)), short, "The WAV is stored byte for byte");
  const info = await jobs.handle({ type: "STEM_RECORDING_INFO", recordingId: id },
    { id: "ext", url: `chrome-extension://ext/stems.html?recording=${id}`, tab: { id: tabs[0].id } });
  assert.equal(info.title, "Track (recording)"); assert.equal(info.audioUrl, audioKey(id)); assert.equal(Math.round(info.durationMs), 500);
  await assert.rejects(jobs.handle({ type: "STEM_RECORDING_INFO", recordingId: id },
    { id: "ext", url: `chrome-extension://ext/stems.html?recording=${id}`, tab: { id: 99 } }), /expired/, "Another tab cannot read the take");

  assert.equal((await upload(short, { size: short.length + 1 })).success, false, "Size mismatch is rejected");
  assert.equal((await upload(short, { trackUrl: "https://evil.test/x" })).success, false, "Only SoundCloud permalinks are kept");
  assert.equal((await upload(short, { sender: { ...sender, url: "https://evil.test/" } })).success, false, "Only SoundCloud pages can upload");
  allowed = false;
  assert.match((await upload(short)).error, /Pro/);
  allowed = true;
  assert.equal(tabs.length, 1, "Failed uploads never open a tab");
  assert.equal(cacheEntries.size, 1, "Failed uploads leave nothing in the cache");

  cacheEntries.set(audioKey("00000000-0000-0000-0000-000000000000"), short);
  await jobs.sweep();
  assert.deepEqual([...cacheEntries.keys()], [audioKey(id)], "Orphaned cache entries are swept");
  await jobs.removeTab(tabs[0].id);
  assert.equal(cacheEntries.size, 0); assert.equal(Object.keys(session).length, 0, "Closing the stems tab drops the take");
  console.log("Stem recording jobs passed: WAV validation, chunked upload, ownership, Pro gate, failures and cleanup.");
})().catch(error => { console.error(error); process.exitCode = 1; });
