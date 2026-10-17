import { MAX_SECONDS, SAMPLE_RATE } from './stem-audio.mjs';
// A library is either IndexedDB or a user-selected directory. Audio is immutable;
// small settings writes never re-encode or copy the WAVs.
const AUDIO = ['original', 'drums', 'bass', 'other', 'vocals'];
const validId = id => /^stem-[a-f0-9-]{36}$/.test(id);
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
  async save(info, settings, blobs) {
    if (blobs.length !== 5 || blobs.some(blob => !(blob instanceof Blob) || !blob.size)) throw new Error('Missing WAV audio');
    const record = validate({ version: 1, id: `stem-${crypto.randomUUID()}`, title: info.title || 'Loop', info, settings, createdAt: Date.now() });
    if (!this.directory) {
      await transaction(['presets', 'audio'], 'readwrite', tx => {
        tx.objectStore('presets').put(record, record.id);
        tx.objectStore('audio').put(blobs, record.id);
      });
    } else {
      const root = await this.root(true);
      const directory = await root.getDirectoryHandle(record.id, { create: true });
      // Commit marker last: an interrupted save cannot appear as a loadable preset.
      for (let i = 0; i < AUDIO.length; i++) await write(directory, `${AUDIO[i]}.wav`, blobs[i]);
      await write(directory, 'preset.json', JSON.stringify(record));
    }
    return record;
  }
  async load(id) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    let record, blobs;
    if (!this.directory) {
      [record, blobs] = await Promise.all([
        transaction(['presets'], 'readonly', tx => tx.objectStore('presets').get(id)),
        transaction(['audio'], 'readonly', tx => tx.objectStore('audio').get(id)),
      ]);
    } else {
      const directory = await (await this.root()).getDirectoryHandle(id);
      record = await readRecord(directory);
      blobs = await Promise.all(AUDIO.map(async name => (await directory.getFileHandle(`${name}.wav`)).getFile()));
    }
    validate(record);
    const maxWavBytes = 44 + MAX_SECONDS * SAMPLE_RATE * 2 * 4;
    if (record.id !== id || blobs?.length !== 5 || blobs.some(blob => !(blob instanceof Blob) || blob.size > maxWavBytes || blob.size < 44)) throw new Error('Invalid preset audio');
    return { record, blobs };
  }
  // Deletes the saved copy of a separation: its IndexedDB records, or its preset folder
  // inside PlayerTools-Stems. Nothing else in the chosen folder is touched.
  async remove(id) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    if (!this.directory) {
      await transaction(['presets', 'audio'], 'readwrite', tx => {
        tx.objectStore('presets').delete(id); tx.objectStore('audio').delete(id);
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
  async update(id, settings) {
    if (!validId(id)) throw new Error('Invalid preset ID');
    if (!this.directory) {
      await transaction(['presets'], 'readwrite', tx => {
        const store = tx.objectStore('presets'), request = store.get(id);
        request.onsuccess = () => { if (request.result) store.put({ ...request.result, settings }, id); };
      });
    } else {
      await navigator.locks.request(`scdl-stem-preset-${id}`, async () => {
        const directory = await (await this.root()).getDirectoryHandle(id);
        const record = await readRecord(directory);
        await write(directory, 'preset.json', JSON.stringify({ ...record, settings }));
      });
    }
  }
}
