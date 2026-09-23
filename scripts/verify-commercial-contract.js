const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const runtimeCopy = ["README.md", "popup.html", "index.html", "scripts/landing-i18n.js",
  ...fs.readdirSync(path.join(root, "_locales")).map((locale) => `_locales/${locale}/messages.json`)]
  .map((file) => `${file}\n${read(file)}`).join("\n");

for (const obsolete of [
  /Looper is included for free/i,
  /Looper is free on compatible/i,
  /Looper es gratis en tracks/i,
  /Looper ist auf kompatiblen.*kostenlos/i,
  /Looper é grátis em faixas/i,
  /Looper бесплатен для/i,
  /Job state stored in `chrome\.storage\.session`/i,
  /(?:46%\s*OFF|Future price|Precio futuro|Preço futuro|Künftiger Preis|Будущая цена)/i,
  /(?:trial starts once|empieza una sola vez|começa uma única vez|startet nur einmal|запускается один раз)/i,
]) assert.doesNotMatch(runtimeCopy, obsolete);

for (const required of [/7-day Player Tools trial/i, /20 new A–B loops/i, /WAV.*Pro/i,
  /two activated Chrome profiles/i, /signed 30-day offline receipt/i,
  /Full-track downloads stay free/i]) assert.match(runtimeCopy, required);
assert.match(runtimeCopy, /trial for the current Chrome profile/i);

console.log("Commercial FREE/trial/PRO copy verification passed across README, landing and five locales.");
