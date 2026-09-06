const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const handleStore = new Map();
const localStorage = {};

function asyncRequest(result) {
  const request = {};
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}

const database = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction() {
    return {
      objectStore() {
        return {
          put(value, key) {
            handleStore.set(key, value);
            return asyncRequest(key);
          },
          get(key) {
            return asyncRequest(handleStore.get(key));
          },
        };
      },
    };
  },
};

const indexedDB = {
  open() {
    return asyncRequest(database);
  },
};

const files = new Map([["Artist - Song.mp3", { existing: true }]]);
let pickerOptions = null;
let directoryPermission = "granted";
let permissionRequests = 0;
const directoryHandle = {
  name: "My Music",
  queryPermission: async () => directoryPermission,
  async requestPermission() {
    permissionRequests += 1;
    directoryPermission = "granted";
    return directoryPermission;
  },
  async getFileHandle(name, options = {}) {
    if (!files.has(name) && !options.create) {
      const error = new Error("Missing file");
      error.name = "NotFoundError";
      throw error;
    }

    if (!files.has(name)) {
      files.set(name, {});
    }

    return {
      async createWritable() {
        return {
          async write(blob) {
            files.set(name, { blob });
          },
          async close() {},
          async abort() {},
        };
      },
    };
  },
};

const context = vm.createContext({
  console,
  URL,
  Blob,
  indexedDB,
  crypto: { randomUUID: () => "directory-id" },
  showDirectoryPicker: async (options) => {
    pickerOptions = options;
    return directoryHandle;
  },
  chrome: {
    storage: {
      local: {
        async get(key) {
          return { [key]: localStorage[key] };
        },
        async set(values) {
          Object.assign(localStorage, values);
        },
        async remove(key) {
          delete localStorage[key];
        },
      },
    },
  },
});

for (const relativePath of ["scripts/format-utils.js", "scripts/directory-storage.js"]) {
  const filePath = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
    filename: filePath,
  });
}

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

(async () => {
  const destination = await evaluate("SCDownloadDirectory.chooseDirectory()");
  if (destination.id !== "directory-id" || destination.name !== "My Music") {
    throw new Error("The selected directory was not persisted correctly.");
  }
  if (!pickerOptions?.id || pickerOptions.id.length > 32) {
    throw new Error("The directory picker id must be at most 32 characters.");
  }

  const remembered = await evaluate("SCDownloadDirectory.getCurrent()");
  if (remembered.id !== destination.id) {
    throw new Error("The current directory setting was not restored.");
  }

  await evaluate("SCDownloadDirectory.clearCurrent()");
  const cleared = await evaluate("SCDownloadDirectory.getCurrent()");
  if (cleared !== null) {
    throw new Error("The remembered directory was not cleared for browser Downloads.");
  }

  const savedName = await evaluate(`SCDownloadDirectory.saveBlob(
    "directory-id",
    "Artist - Song.mp3",
    new Blob(["audio"], { type: "audio/mpeg" })
  )`);
  if (savedName !== "Artist - Song (1).mp3") {
    throw new Error(`Duplicate filename was not uniquified: ${savedName}`);
  }
  if (!files.get(savedName)?.blob) {
    throw new Error("The audio blob was not written to the selected directory.");
  }

  // Chromium can return "prompt" for a persisted handle after the extension
  // restarts. The popup must restore permission from the download click before
  // the offscreen document attempts to write the prepared audio file.
  directoryPermission = "prompt";
  const authorized = await evaluate(
    'SCDownloadDirectory.ensurePermission("directory-id")'
  );
  if (!authorized || permissionRequests !== 1) {
    throw new Error("A remembered directory was not re-authorized after restart.");
  }

  const restartedSaveName = await evaluate(`SCDownloadDirectory.saveBlob(
    "directory-id",
    "Restarted track.m4a",
    new Blob(["audio"], { type: "audio/mp4" })
  )`);
  if (!files.get(restartedSaveName)?.blob) {
    throw new Error("The track was not saved after restoring folder access.");
  }

  console.log("Directory storage verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
