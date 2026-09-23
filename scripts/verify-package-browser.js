// Smoke-test the exact extension ZIP, not the source tree. Run after packaging:
//   node scripts/verify-package-browser.js [path/to/extension.zip]
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.SCDL_PLAYWRIGHT_PATH || "playwright");
const provenance = require("./package-provenance.js");

(async () => {
  const root = path.resolve(__dirname, "..");
  const version = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")).version;
  const zip = path.resolve(process.argv[2] || path.join(root, "dist", `soundcloud-track-downloader-${version}.zip`));
  await fs.access(zip);
  const sidecar = JSON.parse(await fs.readFile(`${zip}.provenance.json`, "utf8"));
  const zipBytes = await fs.readFile(zip);
  assert.equal(sidecar.zipSha256, provenance.sha256(zipBytes), "ZIP hash does not match its provenance sidecar");
  const packageScript = await fs.readFile(path.join(root, "scripts", "package-extension.ps1"), "utf8");
  const list = packageScript.match(/\$packageItems = @\(([\s\S]*?)\n\s*\)/)[1];
  const items = [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const currentSource = provenance.sourceState(root, items);
  assert.equal(sidecar.sourceCommit, currentSource.commit, "ZIP was built from a different commit");
  assert.equal(sidecar.sourceFingerprint, currentSource.fingerprint, "ZIP source fingerprint is stale");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-package-smoke-"));
  const extensionRoot = path.join(temporary, "extension");
  const profile = path.join(temporary, "profile");
  await fs.mkdir(extensionRoot);
  await fs.mkdir(profile);
  execFileSync("unzip", ["-q", zip, "-d", extensionRoot]);
  const embedded = JSON.parse(await fs.readFile(path.join(extensionRoot, "release-build.json"), "utf8"));
  assert.equal(embedded.stagedFingerprint, sidecar.stagedFingerprint);
  const extractedEntries = (await fs.readdir(extensionRoot)).filter(name => name !== "release-build.json");
  const extractedHashes = provenance.fileHashes(extensionRoot, extractedEntries);
  assert.deepEqual(extractedHashes, embedded.files, "Packaged entries differ from the signed-off staging manifest");
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ...(process.env.SCDL_CHROME_PATH ? { executablePath: process.env.SCDL_CHROME_PATH } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, version);
    assert.ok(manifest.permissions.includes("offscreen"));
    assert.ok(manifest.permissions.includes("alarms"));
    const commerce = await worker.evaluate(async () =>
      fetch(chrome.runtime.getURL("scripts/player-tools-commerce.js")).then(response => response.text()));
    assert.match(commerce, /const TEST_LOGIN = null;/);
    assert.doesNotMatch(commerce, /username:\s*"1",\s*password:\s*"1"/);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => document.readyState === "complete");
    assert.ok(await popup.locator("#commercePanel").count(), "Packaged popup did not load its commerce panel.");
    assert.ok(await popup.locator("#downloadBtn").count(), "Packaged popup did not load its download controls.");
    console.log(`Package browser smoke passed: ${path.basename(zip)} (${extensionId}).`);
  } finally {
    await context.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
