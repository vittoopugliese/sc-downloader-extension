const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

// Exercise actual IndexedDB transactions and OPFS files without loading the editor UI.
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Preset storage</title>'); return; }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const results = await page.evaluate(async () => {
      const { StemPresets } = await import('./scripts/stem-presets.mjs');
      const { encodeWav } = await import('./scripts/stem-audio.mjs');
      const completed = [];
      const equal = (actual, expected, label) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
      };
      const rejects = async (run, label) => { try { await run(); } catch { return; } throw new Error(`Expected failure: ${label}`); };
      const info = { title: 'Sparse sources', trimRange: { startMs: 0, endMs: 1000 } };
      const wav = new Blob([encodeWav([new Float32Array(4410), new Float32Array(4410)])], { type: 'audio/wav' });
      const all = Array(5).fill(wav), sparse = [null, wav, null, wav, null];
      const settings = { playlist: { deletedSources: ['original', 'bass', 'vocals'] } };
      const library = new StemPresets();
      const saved = await library.save(info, {}, all, { imported: wav });
      equal(saved.audio, undefined, 'Legacy full records need no new metadata');
      equal((await library.load(saved.id)).blobs.map(blob => blob.size), all.map(blob => blob.size), 'Legacy full record loads');
      await library.update(saved.id, settings, sparse);
      let loaded = await library.load(saved.id);
      equal(loaded.record.audio, ['drums', 'other'], 'Names identify retained slots');
      equal(loaded.blobs.map(blob => blob?.size ?? null), sparse.map(blob => blob?.size ?? null), 'Sparse IDB positions survive');
      equal(Object.keys(loaded.samples), ['imported'], 'Deleting originals preserves imported samples');
      await library.update(saved.id, { ...settings, marker: 7 });
      equal((await library.load(saved.id)).record.audio, ['drums', 'other'], 'Settings-only save retains deletion mask');
      await library.update(saved.id, settings, all);
      equal((await library.load(saved.id)).record.audio, undefined, 'Undo can restore every source');
      for (const count of [1, 5]) {
        const empty = await library.save(info, { playlist: { deletedSources: ['original', 'drums', 'bass', 'other', 'vocals'] } }, Array(count).fill(null));
        const reloaded = await library.load(empty.id);
        equal(reloaded.blobs, Array(count).fill(null), 'Empty projects preserve source shape');
        equal(reloaded.record.stems === false, count === 1, 'Source shape is independent of deletion');
        equal(reloaded.record.audio, [], 'No retained source is explicit');
      }
      await rejects(() => library.save(info, {}, Array(5)), 'Holes are not deleted slots');
      await rejects(() => library.update(saved.id, {}, [undefined]), 'Undefined is not a deleted slot');
      completed.push('legacy, sparse and all-deleted IndexedDB round trips');

      const before = await library.load(saved.id);
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === 'audio' && key === saved.id) throw new DOMException('Injected quota failure', 'QuotaExceededError');
        return put.call(this, value, key);
      };
      try { await rejects(() => library.update(saved.id, { marker: 'must roll back' }, sparse), 'Audio write aborts metadata transaction'); }
      finally { IDBObjectStore.prototype.put = put; }
      loaded = await library.load(saved.id);
      equal(loaded.record, before.record, 'Failed IDB update rolls back metadata');
      equal(loaded.blobs.map(blob => blob?.size), before.blobs.map(blob => blob?.size), 'Failed IDB update retains audio');
      completed.push('IndexedDB atomic update failure');

      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('scdl-stem-presets', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const putRaw = (store, value, key = saved.id) => new Promise((resolve, reject) => {
        const tx = database.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key);
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      });
      try {
        for (const audio of [['drums', 'drums'], ['../other'], ['missing'], null, {}]) {
          await putRaw('presets', { ...before.record, audio });
          await rejects(() => library.load(saved.id), 'Invalid retained audio metadata');
        }
        await putRaw('presets', { ...before.record, stems: false, audio: ['vocals'] });
        await rejects(() => library.load(saved.id), 'One-slot records cannot refer to stem slots');
        await putRaw('presets', before.record);
        await putRaw('audio', sparse);
        await rejects(() => library.load(saved.id), 'Legacy records cannot contain undeclared missing audio');
        await putRaw('presets', { ...before.record, audio: ['drums', 'other'] });
        await putRaw('audio', all);
        await rejects(() => library.load(saved.id), 'Deleted IDB slots must be null');
        await putRaw('audio', [null, new Blob(['broken']), null, wav, null]);
        await rejects(() => library.load(saved.id), 'Retained corrupt WAV still fails validation');
      } finally {
        await putRaw('presets', before.record); await putRaw('audio', before.blobs); database.close();
      }
      completed.push('malformed metadata and inconsistent audio rejected');

      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('sparse-storage-test', { create: true });
      const folder = new StemPresets(directory);
      // OPFS has no user permission prompt; the files and writable streams remain real.
      folder.authorize = async () => {};
      const folderSaved = await folder.save(info, {}, all, { imported: wav });
      const project = await (await folder.root()).getDirectoryHandle(folderSaved.id);
      const writeText = async (name, text) => {
        const stream = await (await project.getFileHandle(name, { create: true })).createWritable();
        await stream.write(text); await stream.close();
      };
      const names = async () => { const entries = []; for await (const name of project.keys()) entries.push(name); return entries.sort(); };
      await writeText('notes.wav', 'Unrelated file');
      await folder.update(folderSaved.id, settings, sparse);
      loaded = await folder.load(folderSaved.id);
      equal(loaded.blobs.map(blob => blob?.size ?? null), sparse.map(blob => blob?.size ?? null), 'Folder returns fixed sparse shape');
      equal(await names(), ['drums.wav', 'notes.wav', 'other.wav', 'preset.json', 'sample-imported.wav'], 'Cleanup deletes only removed known sources');
      await folder.update(folderSaved.id, settings, all);
      const actualRoot = await folder.root();
      const failing = new StemPresets(directory); failing.authorize = async () => {};
      failing.root = async () => ({ getDirectoryHandle: async (...args) => {
        const child = await actualRoot.getDirectoryHandle(...args);
        return { getFileHandle: (...args) => child.getFileHandle(...args), removeEntry: async name => {
          if (name === 'original.wav') throw new DOMException('Injected cleanup failure', 'NotAllowedError');
          return child.removeEntry(name);
        } };
      } });
      await rejects(() => failing.update(folderSaved.id, settings, sparse), 'Cleanup failure is reported after commit');
      loaded = await folder.load(folderSaved.id);
      equal(loaded.record.audio, ['drums', 'other'], 'Deletion mask commits before cleanup');
      equal(loaded.blobs.map(blob => blob?.size ?? null), sparse.map(blob => blob?.size ?? null), 'Failed cleanup never resurrects removed audio');
      equal((await names()).includes('original.wav'), true, 'Injected failure leaves an ignored orphan');
      await folder.update(folderSaved.id, settings, sparse);
      equal((await names()).includes('original.wav'), false, 'Retry removes orphan after committing again');
      completed.push('directory sparse round trip, bounded cleanup and post-commit failure');

      await folder.update(folderSaved.id, settings, all);
      const originalRecord = (await folder.load(folderSaved.id)).record;
      failing.root = async () => ({ getDirectoryHandle: async (...args) => {
        const child = await actualRoot.getDirectoryHandle(...args);
        return { getFileHandle: async (name, options) => {
          if (name === 'preset.json' && options?.create) throw new DOMException('Injected commit failure', 'QuotaExceededError');
          return child.getFileHandle(name, options);
        }, removeEntry: name => child.removeEntry(name) };
      } });
      await rejects(() => failing.update(folderSaved.id, settings, Array(5).fill(null)), 'Failed metadata commit cannot delete files');
      equal((await folder.load(folderSaved.id)).record, originalRecord, 'Metadata failure preserves prior project');
      equal((await names()).filter(name => /^(original|drums|bass|other|vocals)\.wav$/.test(name)).length, 5, 'Metadata failure retains all source WAVs');
      await folder.update(folderSaved.id, settings, Array(5).fill(null));
      equal((await folder.load(folderSaved.id)).blobs, Array(5).fill(null), 'All-deleted folder project remains loadable');
      equal(await names(), ['notes.wav', 'preset.json', 'sample-imported.wav'], 'All-deleted cleanup preserves imported and unrelated files');
      completed.push('directory metadata failure preserves originals and all-deleted project loads');
      return completed;
    });
    assert.equal(results.length, 5);
    for (const result of results) console.log(`PASS ${result}`);
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
