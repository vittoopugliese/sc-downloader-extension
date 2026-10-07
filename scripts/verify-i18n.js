const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
assert(read("popup.html").includes('id="looperTab"'));

console.log(`i18n verification passed (${usedKeys.size} used keys, ${englishKeys.length} localized keys).`);

const toolsSandbox = {};
vm.runInNewContext(read('scripts/player-tools-i18n.js'), toolsSandbox);
const toolsCopy = toolsSandbox.SCPlayerToolsText;
for (const [source, translations] of Object.entries(toolsCopy.messages)) {
  assert.equal(translations.length, 5, `Player Tools must translate ${source} into all five languages`);
  for (const [index, translation] of translations.entries()) {
    assert.ok(translation.trim(), `${toolsCopy.locales[index]}: ${source} must not be empty`);
    assert.deepEqual(placeholders(translation), placeholders(source), `${toolsCopy.locales[index]}: ${source} placeholders`);
  }
}
for (const language of ['en-US', 'es-AR', 'de-AT', 'pt-BR', 'pt-PT', 'pt', 'ru-RU', 'fr-FR']) {
  const sandbox = { navigator: { language } };
  vm.runInNewContext(read('scripts/player-tools-i18n.js'), sandbox);
  const expected = language.startsWith('pt') ? 'pt-BR' : language.startsWith('fr') ? 'en' : language.slice(0, 2);
  assert.equal(sandbox.SCPlayerToolsText.locale(), expected);
  assert.ok(!sandbox.SCPlayerToolsText.t('Enable $1', 'USER $2').includes('$1'));
  assert.ok(sandbox.SCPlayerToolsText.t('Enable $1', 'USER $2').includes('USER $2'), 'Substitutions stay literal');
  vm.runInNewContext(read('scripts/likes-explorer-i18n.js'), sandbox);
  if (expected === 'pt-BR') assert.equal(sandbox.SCLikesText('open'), 'Abrir');
}
const manifest = JSON.parse(read('manifest.json'));
const mainScripts = manifest.content_scripts.find(entry => entry.js.includes('scripts/tempo-control-main.js')).js;
assert.ok(mainScripts.indexOf('scripts/player-tools-i18n.js') < mainScripts.indexOf('scripts/tempo-control-main.js'));
assert.ok(read('scripts/package-extension.ps1').includes('"scripts/player-tools-i18n.js"'));
assert.ok(read('stems.html').indexOf('scripts/player-tools-i18n.js') < read('stems.html').indexOf('scripts/record-ui.js'));
console.log(`Player Tools: ${Object.keys(toolsCopy.messages).length} messages in five languages, regional fallbacks and runtime packaging verified.`);
