const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const locales = ["en", "es", "ru", "pt_BR", "de"];
const filesUsingMessages = [
  "popup.html",
  "scripts/popup.js",
  "scripts/content.js",
  "scripts/inline-button.js",
  "scripts/looper.js",
  "scripts/background.js",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function placeholders(message) {
  return [...String(message).matchAll(/\$([1-9]\d*)/g)]
    .map((match) => match[1])
    .sort();
}

const messages = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(read(`_locales/${locale}/messages.json`)),
  ])
);
const englishKeys = Object.keys(messages.en).sort();

for (const locale of locales) {
  const localeKeys = Object.keys(messages[locale]).sort();
  assert.deepEqual(localeKeys, englishKeys, `${locale} must cover exactly the English keys`);

  for (const key of englishKeys) {
    const localized = messages[locale][key]?.message;
    assert.equal(typeof localized, "string", `${locale}:${key} must be a string`);
    assert(localized.length > 0, `${locale}:${key} must not be empty`);
    assert.deepEqual(
      placeholders(localized),
      placeholders(messages.en[key].message),
      `${locale}:${key} has incompatible placeholders`
    );
  }
}

const usedKeys = new Set();
for (const relativePath of filesUsingMessages) {
  const source = read(relativePath);
  for (const match of source.matchAll(/\b(?:t|translate)\("([a-z][a-z0-9_]*)"/g)) usedKeys.add(match[1]);
  for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?="([a-z][a-z0-9_]*)"/g)) usedKeys.add(match[1]);
}

for (const key of usedKeys) {
  assert(key in messages.en, `Missing English message key: ${key}`);
}

assert.equal(messages.en.app_name.message, "SoundCloud Track Downloader");
assert(read("manifest.json").includes('"default_locale": "en"'));
assert(read("popup.html").includes('id="helpPanel"'));
assert(read("popup.html").includes('id="looperActionSlot"'));

console.log(`i18n verification passed (${usedKeys.size} used keys, ${englishKeys.length} localized keys).`);
