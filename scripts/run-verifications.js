const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const scriptsDirectory = __dirname;
const excluded = new Set([
  "verify-download-browser.js",
  "verify-loop-browser.js",
  "verify-live-looper.js",
  "verify-live-player-download.js",
]);
const verifications = fs
  .readdirSync(scriptsDirectory)
  .filter((fileName) => fileName.startsWith("verify-") && fileName.endsWith(".js"))
  .filter((fileName) => !excluded.has(fileName))
  .sort();

for (const verification of verifications) {
  process.stdout.write(`\n> ${verification}\n`);
  const result = spawnSync(process.execPath, [path.join(scriptsDirectory, verification)], {
    cwd: path.resolve(scriptsDirectory, ".."),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`\n${verifications.length} local verifications passed.`);
