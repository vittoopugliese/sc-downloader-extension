(function initializeDownloadDirectory(globalScope) {
  const DB_NAME = "scdl_download_directories";
  const DB_VERSION = 1;
  const STORE_NAME = "handles";
  const CURRENT_KEY = "downloadDestination";
  // Chrome limits File System Access picker IDs to 32 characters.
  const PICKER_ID = "scdl-destination";

  let saveQueue = Promise.resolve();

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!globalScope.indexedDB) {
        reject(new Error("Directory storage is not available in this browser."));
        return;
      }

      const request = globalScope.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open directory storage."));
    });
  }

  async function runStoreRequest(mode, operation) {
    const database = await openDatabase();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Directory storage failed."));
        transaction.onabort = () => reject(transaction.error || new Error("Directory storage was aborted."));
      });
    } finally {
      database.close();
    }
  }

  function createDirectoryId() {
    if (globalScope.crypto?.randomUUID) {
      return globalScope.crypto.randomUUID();
    }

    return `directory_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeDestination(value) {
    if (!value || typeof value.id !== "string" || typeof value.name !== "string") {
      return null;
    }

    return { id: value.id, name: value.name };
  }

  async function chooseDirectory() {
    if (typeof globalScope.showDirectoryPicker !== "function") {
      throw new Error("Your browser does not support choosing a download folder.");
    }

    // Keep this call before any await: the browser requires a direct user gesture.
    const handle = await globalScope.showDirectoryPicker({
      id: PICKER_ID,
      mode: "readwrite",
    });
    const destination = { id: createDirectoryId(), name: handle.name };

    await runStoreRequest("readwrite", (store) => store.put(handle, destination.id));
    await chrome.storage.local.set({ [CURRENT_KEY]: destination });
    return destination;
  }

  async function getCurrent() {
    const stored = await chrome.storage.local.get(CURRENT_KEY);
    return normalizeDestination(stored[CURRENT_KEY]);
  }

  async function getHandle(directoryId) {
    if (!directoryId) {
      return null;
    }

    return runStoreRequest("readonly", (store) => store.get(directoryId));
  }

  async function ensurePermission(directoryId) {
    const directoryHandle = await getHandle(directoryId);
    if (!directoryHandle) {
      throw new Error("The selected folder is no longer available. Choose it again in the popup.");
    }

    const options = { mode: "readwrite" };
    let permission = await directoryHandle.queryPermission(options);
    if (permission === "granted") {
      return true;
    }

    if (typeof directoryHandle.requestPermission !== "function") {
      throw new Error("Folder access expired. Open the popup and choose the folder again.");
    }

    permission = await directoryHandle.requestPermission(options);
    if (permission !== "granted") {
      throw new Error("Folder access was not granted. Choose the folder again to download.");
    }

    return true;
  }

  async function findAvailableName(directoryHandle, requestedName) {
    const safeName = SCFormat.sanitizePathComponent(requestedName, "SoundCloud track", 180);
    const lastDot = safeName.lastIndexOf(".");
    const hasExtension = lastDot > 0;
    const stem = hasExtension ? safeName.slice(0, lastDot) : safeName;
    const extension = hasExtension ? safeName.slice(lastDot) : "";

    for (let suffix = 0; suffix < 10000; suffix += 1) {
      const candidate = suffix === 0 ? safeName : `${stem} (${suffix})${extension}`;

      try {
        await directoryHandle.getFileHandle(candidate);
      } catch (error) {
        if (error?.name === "NotFoundError") {
          return candidate;
        }
        throw error;
      }
    }

    throw new Error("Could not create a unique filename in the selected folder.");
  }

  async function saveBlobNow(directoryId, requestedName, blob) {
    const directoryHandle = await getHandle(directoryId);
    if (!directoryHandle) {
      throw new Error("The selected folder is no longer available. Choose it again in the popup.");
    }

    const permission = await directoryHandle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      throw new Error("Folder access expired. Open the popup and choose the folder again.");
    }

    const fileName = await findAvailableName(directoryHandle, requestedName);
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }

    return fileName;
  }

  function saveBlob(directoryId, requestedName, blob) {
    const operation = saveQueue.then(() => saveBlobNow(directoryId, requestedName, blob));
    saveQueue = operation.catch(() => {});
    return operation;
  }

  globalScope.SCDownloadDirectory = {
    CURRENT_KEY,
    chooseDirectory,
    ensurePermission,
    getCurrent,
    getHandle,
    saveBlob,
  };
})(globalThis);
