// Sample folder access for the Browser. The chosen root is a read-only handle kept in
// IndexedDB, apart from the read/write folder used for saved separations.
const AUDIO = /\.(wav|mp3|flac|m4a|ogg|opus|aac)$/i;
export const isAudioName = name => AUDIO.test(name);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

let database;
function db() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('scdl-sample-browser', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
}
async function preference(mode, run) {
  const store = (await db()).transaction('preferences', mode).objectStore('preferences');
  return new Promise((resolve, reject) => {
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savedRoot() {
  try { return await preference('readonly', store => store.get('root')) || null; } catch { return null; }
}
// Must run directly in a click's user activation. Cancelling throws AbortError and
// leaves the stored root untouched.
export async function chooseRoot() {
  if (typeof window.showDirectoryPicker !== 'function') throw new Error('This browser cannot open folders.');
  const handle = await window.showDirectoryPicker({ id: 'stem-samples', mode: 'read' });
  await preference('readwrite', store => store.put(handle, 'root')).catch(() => {});
  return handle;
}
// 'granted', 'prompt' or 'denied'. Requesting needs a user gesture.
export async function readPermission(handle, request = false) {
  let state = await handle.queryPermission({ mode: 'read' });
  if (state !== 'granted' && request) state = await handle.requestPermission({ mode: 'read' });
  return state;
}

// Folder listings are read lazily, one folder at a time, and the last `limit` folders
// stay cached. `onChunk` receives partial sorted listings while a large folder is read.
export function createFolderCache(limit = 24) {
  const folders = new Map();
  const sort = list => list.sort((a, b) => a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'directory' ? -1 : 1);
  return {
    async list(key, directory, { signal, onChunk } = {}) {
      if (folders.has(key)) { const entries = folders.get(key); folders.delete(key); folders.set(key, entries); return entries; }
      const entries = [];
      let count = 0;
      for await (const handle of directory.values()) {
        if (signal?.aborted) throw new DOMException('Listing cancelled', 'AbortError');
        if (handle.kind === 'directory' || isAudioName(handle.name)) entries.push({ kind: handle.kind, name: handle.name, handle });
        if (++count % 400 === 0) { onChunk?.(sort([...entries])); await new Promise(resolve => setTimeout(resolve)); }
      }
      if (signal?.aborted) throw new DOMException('Listing cancelled', 'AbortError');
      sort(entries); folders.set(key, entries);
      while (folders.size > limit) folders.delete(folders.keys().next().value);
      return entries;
    },
    forget(key) { folders.delete(key); },
    clear() { folders.clear(); },
  };
}
