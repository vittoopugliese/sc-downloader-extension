import { MAX_SECONDS, SAMPLE_RATE } from './stem-audio.mjs';
// A library is either IndexedDB or a user-selected directory. A project holds the original
// WAV, plus the four stem WAVs once separated (`stems: false` marks one without them).
// Saving settings never rewrites audio that did not change.
const AUDIO = ['original', 'drums', 'bass', 'other', 'vocals'];
const audioCount = record => record.stems === false ? 1 : AUDIO.length;
const validAudio = blobs => Array.isArray(blobs) && (blobs.length === 1 || blobs.length === AUDIO.length) && blobs.every(blob => blob instanceof Blob && blob.size);
const validId = id => /^stem-[a-f0-9-]{36}$/.test(id);
// Imported samples of a separation's playlist: stored next to its five WAVs, as
// `sample-<id>.wav` in a preset folder or under `<preset id>#samples` in IndexedDB.
const validSample = id => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
const MAX_SAMPLES = 64, MAX_SAMPLE_BYTES = 128 * 1024 * 1024;
const samplesKey = id => `${id}#samples`;
function checkSamples(samples) {
  const entries = Object.entries(samples);
  if (entries.length > MAX_SAMPLES || entries.some(([key, blob]) => !validSample(key) || !(blob instanceof Blob) || blob.size > MAX_SAMPLE_BYTES)) throw new Error('Invalid sample');
  return samples;
}
let database;
function db() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('scdl-stem-presets', 1);
    request.onupgradeneeded = () => {
      for (const name of ['presets', 'audio', 'preferences']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(stores, mode, run) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
    try { result = run(tx); } catch (error) { tx.abort(); reject(error); }
  });
}
function validate(record) {
  if (!record || record.version !== 1 || !validId(record.id) || typeof record.title !== 'string' ||
      typeof record.info?.title !== 'string' || !Number.isFinite(record.createdAt) ||
      !Number.isFinite(record.info.trimRange?.startMs) || !Number.isFinite(record.info.trimRange?.endMs) ||
      record.info.trimRange.startMs < 0 || record.info.trimRange.endMs <= record.info.trimRange.startMs ||
      record.info.trimRange.endMs - record.info.trimRange.startMs > MAX_SECONDS * 1000 + 1) throw new Error('Invalid stem preset');
  return record;
}
async function write(directory, name, contents) {
  const file = await directory.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(contents); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}
async function readRecord(directory) {
  const file = await (await directory.getFileHandle('preset.json')).getFile();
  if (file.size > 1024 * 1024) throw new Error('Invalid preset metadata');
  return validate(JSON.parse(await file.text()));
}
export class StemPresets {
  constructor(directory = null) { this.directory = directory; }
  static async current() {
    return new StemPresets(await transaction(['preferences'], 'readonly', tx => tx.objectStore('preferences').get('directory')) || null);
  }
  static async choose() {
    // Must stay directly in the click's user activation.
    const directory = await window.showDirectoryPicker({ id: 'stem-presets', mode: 'readwrite' });
    await transaction(['preferences'], 'readwrite', tx => tx.objectStore('preferences').put(directory, 'directory'));
    return new StemPresets(directory);
  }
  static async reset() {
    await transaction(['preferences'], 'readwrite', tx => tx.objectStore('preferences').delete('directory'));
    return new StemPresets();
  }
  async authorize(request = false) {
    if (!this.directory) return;
    let permission = await this.directory.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && request) permission = await this.directory.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Folder permission required');
  }
  async root(create = false) {
    await this.authorize();
    return this.directory.getDirectoryHandle('PlayerTools-Stems', { create });
  }
  async list() {
    if (!this.directory) return (await transaction(['presets'], 'readonly', tx => tx.objectStore('presets').getAll()))
      .sort((a, b) => b.createdAt - a.createdAt);
    const records = [];
    let root;
    try { root = await this.root(); } catch (error) { if (error.name === 'NotFoundError') return records; throw error; }
    for await (const [id, directory] of root.entries()) {
      if (directory.kind !== 'directory' || !validId(id)) continue;
      try { const record = await readRecord(directory); if (record.id === id) records.push(record); }
      catch (error) { if (error.name === 'NotAllowedError') throw error; /* Ignore interrupted or foreign folders. */ }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }
  // `blobs`: [original] or [original, drums, bass, other, vocals]; `samples`: { sampleId: Blob }.
  async save(info, settings, blobs, samples = {}) {
    if (!validAudio(blobs)) throw new Error('Missing WAV audio');
    checkSamples(samples);
    const record = validate({ version: 1, id: `stem-${crypto.randomUUID()}`, title: info.title || 'Loop', info, settings, createdAt: Date.now(),
      ...(blobs.length === 1 ? { stems: false } : {}) });
    if (!this.directory) {
      await transaction(['presets', 'audio'], 'readwrite', tx => {
        tx.objectStore('presets').put(record, record.id);
        tx.objectStore('audio').put(blobs, record.id);
        if (Object.keys(samples).length) tx.objectStore('audio').put(samples, samplesKey(record.id));
      });
    } else {
      const root = await this.root(true);
      const directory = await root.getDirectoryHandle(record.id, { create: true });
      // Commit marker last: an interrupted save cannot appear as a loadable preset.
      for (let i = 0; i < blobs.length; i++) await write(directory, `${AUDIO[i]}.wav`, blobs[i]);
      for (const [key, blob] of Object.entries(samples)) await write(directory, `sample-${key}.wav`, blob);
      await write(directory, 'preset.json', JSON.stringify(record));
    }
    return record;
  }
  async load(id) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    let record, blobs, samples = {};
    if (!this.directory) {
      let stored;
      [record, blobs, stored] = await Promise.all([
        transaction(['presets'], 'readonly', tx => tx.objectStore('presets').get(id)),
        transaction(['audio'], 'readonly', tx => tx.objectStore('audio').get(id)),
        transaction(['audio'], 'readonly', tx => tx.objectStore('audio').get(samplesKey(id))),
      ]);
      samples = stored && typeof stored === 'object' ? stored : {};
    } else {
      const directory = await (await this.root()).getDirectoryHandle(id);
      record = await readRecord(directory);
      blobs = await Promise.all(AUDIO.slice(0, audioCount(record)).map(async name => (await directory.getFileHandle(`${name}.wav`)).getFile()));
      for await (const [name, handle] of directory.entries()) {
        const match = /^sample-(.+)\.wav$/.exec(name);
        if (match && handle.kind === 'file' && validSample(match[1])) samples[match[1]] = await handle.getFile();
      }
    }
    validate(record);
    const maxWavBytes = 44 + MAX_SECONDS * SAMPLE_RATE * 2 * 4;
    if (record.id !== id || blobs?.length !== audioCount(record) || blobs.some(blob => !(blob instanceof Blob) || blob.size > maxWavBytes || blob.size < 44)) throw new Error('Invalid preset audio');
    // Unusable sample files are skipped; their clips are left out on restore.
    samples = Object.fromEntries(Object.entries(samples).filter(([key, blob]) => validSample(key) && blob instanceof Blob && blob.size >= 44 && blob.size <= MAX_SAMPLE_BYTES).slice(0, MAX_SAMPLES));
    return { record, blobs, samples };
  }
  // Deletes the saved copy of a separation: its IndexedDB records, or its preset folder
  // inside PlayerTools-Stems. Nothing else in the chosen folder is touched.
  async remove(id) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    if (!this.directory) {
      await transaction(['presets', 'audio'], 'readwrite', tx => {
        tx.objectStore('presets').delete(id); tx.objectStore('audio').delete(id); tx.objectStore('audio').delete(samplesKey(id));
      });
      return;
    }
    await navigator.locks.request(`scdl-stem-preset-${id}`, async () => {
      const root = await this.root();
      // The commit marker goes first: an interrupted removal no longer lists the preset.
      try { await (await root.getDirectoryHandle(id)).removeEntry('preset.json'); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
      try { await root.removeEntry(id, { recursive: true }); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
    });
  }
  // Adds imported samples ({ sampleId: Blob }) to a saved separation. Write these before
  // settings that refer to them, so metadata never points at missing audio.
  async saveSamples(id, samples) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    const entries = Object.entries(checkSamples(samples));
    if (!entries.length) return;
    if (!this.directory) {
      await transaction(['audio'], 'readwrite', tx => {
        const store = tx.objectStore('audio'), request = store.get(samplesKey(id));
        request.onsuccess = () => {
          const merged = { ...(request.result || {}), ...samples };
          if (Object.keys(merged).length > MAX_SAMPLES) { tx.abort(); return; }
          store.put(merged, samplesKey(id));
        };
      });
      return;
    }
    await navigator.locks.request(`scdl-stem-preset-${id}`, async () => {
      const directory = await (await this.root()).getDirectoryHandle(id);
      for (const [key, blob] of entries) await write(directory, `sample-${key}.wav`, blob);
    });
  }
  // Drops samples the playlist no longer uses. Run after the settings stop naming them.
  async removeSamples(id, ids) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    const keys = ids.filter(validSample);
    if (!keys.length) return;
    if (!this.directory) {
      await transaction(['audio'], 'readwrite', tx => {
        const store = tx.objectStore('audio'), request = store.get(samplesKey(id));
        request.onsuccess = () => {
          if (!request.result) return;
          const rest = { ...request.result }; for (const key of keys) delete rest[key];
          store.put(rest, samplesKey(id));
        };
      });
      return;
    }
    await navigator.locks.request(`scdl-stem-preset-${id}`, async () => {
      const directory = await (await this.root()).getDirectoryHandle(id);
      for (const key of keys) {
        try { await directory.removeEntry(`sample-${key}.wav`); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
    });
  }
  // New settings; `blobs` (optional) replaces the audio, as when the original gets its stems.
  async update(id, settings, blobs = null) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    if (blobs && !validAudio(blobs)) throw new Error('Missing WAV audio');
    const next = record => {
      const value = { ...record, settings };
      if (blobs) { delete value.stems; if (blobs.length === 1) value.stems = false; }
      return value;
    };
    if (!this.directory) {
      await transaction(['presets', 'audio'], 'readwrite', tx => {
        const store = tx.objectStore('presets'), request = store.get(id);
        request.onsuccess = () => {
          if (!request.result) return;
          store.put(next(request.result), id);
          if (blobs) tx.objectStore('audio').put(blobs, id);
        };
      });
    } else {
      await navigator.locks.request(`scdl-stem-preset-${id}`, async () => {
        const directory = await (await this.root()).getDirectoryHandle(id);
        const record = await readRecord(directory);
        // Audio first: preset.json never names WAVs that are not written yet.
        if (blobs) for (let i = 0; i < blobs.length; i++) await write(directory, `${AUDIO[i]}.wav`, blobs[i]);
        await write(directory, 'preset.json', JSON.stringify(next(record)));
      });
    }
  }
}
