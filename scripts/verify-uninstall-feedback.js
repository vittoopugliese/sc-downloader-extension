const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let installedListener;
let startupListener;
const uninstallUrls = [];

const context = vm.createContext({
  console,
  URL,
  fetch: async () => {},
  importScripts() {},
  BulkJobManager: {
    KEEPALIVE_ALARM: "keepalive",
    recoverRunningJob: async () => {},
  },
  SCDownloadTrack: {},
  SCDownloadSource: { configure: () => ({}) },
  chrome: {
    cookies: { get() {} },
    i18n: { getUILanguage: () => "es-419" },
    runtime: {
      getManifest: () => ({ version: "2026.9.10" }),
      setUninstallURL: async url => { uninstallUrls.push(url); },
      onInstalled: { addListener: listener => { installedListener = listener; } },
      onStartup: { addListener: listener => { startupListener = listener; } },
      onMessage: { addListener() {} },
    },
    alarms: { onAlarm: { addListener() {} } },
  },
});

const source = fs.readFileSync(path.resolve(__dirname, "background.js"), "utf8");
vm.runInContext(source, context, { filename: "background.js" });

(async () => {
  assert.equal(typeof installedListener, "function");
  assert.equal(typeof startupListener, "function");

  installedListener({ reason: "update" });
  await new Promise(resolve => setImmediate(resolve));
  startupListener();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(uninstallUrls.length, 2);
  for (const value of uninstallUrls) {
    const url = new URL(value);
    assert.equal(url.origin, "https://sctd.vpugliese.online");
    assert.equal(url.pathname, "/");
    assert.equal(url.searchParams.get("view"), "goodbye");
    assert.equal(url.searchParams.get("locale"), "es-419");
    assert.equal(url.searchParams.get("version"), "2026.9.10");
  }

  console.log("Uninstall feedback URL verification passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
