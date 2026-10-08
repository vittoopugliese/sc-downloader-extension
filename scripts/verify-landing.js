#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const NEW_STORE_ID = 'gmlijjdgphenebddlpmpiknmmfijfmnk';
const REMOVED_STORE_ID = 'ekmbbjdpakacalghjkikfppebgdpoebb';

const html = read('index.html');
const publicPages = ['index.html', 'how-to-download-soundcloud.html', '404.html', 'scripts/landing-goodbye.js', 'popup.html'];

// Every store link must lead to the new listing; the removed one is a dead end.
for (const file of publicPages) {
  const source = read(file);
  assert(!source.includes(REMOVED_STORE_ID), `${file} still links to the removed listing`);
  const storeLinks = source.match(/https:\/\/chromewebstore\.google\.com\/detail\/[^"'`\s?]+/g) || [];
  for (const link of storeLinks) assert(link.includes(`/${NEW_STORE_ID}`), `${file} has a store link outside the new listing: ${link}`);
}

const installLinks = html.match(/class="install[^"]*" href="([^"]+)"/g) || [];
assert(installLinks.length >= 3, 'Landing needs install CTAs in nav, hero and closing');
for (const medium of ['strip', 'nav', 'hero', 'closing']) {
  assert(html.includes(`utm_medium=${medium}&amp;`), `Missing UTM-tagged store link for ${medium}`);
}

assert(html.includes('<meta name="color-scheme" content="dark">'), 'Landing is dark only');
assert(!/prefers-color-scheme:\s*light/.test(html), 'Landing must not ship a light theme');
assert(read('how-to-download-soundcloud.html').includes('<meta name="robots" content="noindex">'), 'Downloader guide must be noindex');
assert(!read('sitemap.xml').includes('how-to-download-soundcloud'), 'Sitemap must not list the downloader guide');
assert(!/download soundcloud tracks/i.test(html.replace(/Does it download SoundCloud tracks\?/g, '')), 'Landing must not market downloads');

// Every data-l10n key in the markup exists in all locales.
const sandbox = { window: {}, navigator: { language: 'en' }, document: { documentElement: {}, querySelectorAll: () => [] } };
vm.runInNewContext(read('scripts/landing-i18n.js'), sandbox);
const i18n = sandbox.window.PTLandingI18n;
const markupKeys = new Set([...html.matchAll(/data-l10n(?:-placeholder)?="([a-z0-9_]+)"/g)].map((match) => match[1]));
const goodbyeKeys = new Set([...read('scripts/landing-goodbye.js').matchAll(/\bt\("([a-z0-9_]+)"\)/g)].map((match) => match[1]));
for (const locale of ['en', 'es', 'pt', 'de', 'ru']) {
  i18n.setLocale(locale);
  for (const key of [...markupKeys, ...goodbyeKeys, 'split_again', 'mix_back', 'doc_title']) {
    assert.notStrictEqual(i18n.t(key), key, `${locale} is missing ${key}`);
  }
}

// Uninstall routing: the removed extension gets the migration pitch, Player Tools gets plain feedback.
const goodbye = read('scripts/landing-goodbye.js');
assert(goodbye.includes('< 20261007'), 'Legacy cutoff must stay at the first Player Tools version');
assert(!goodbye.includes('value="yes"'), 'Obsolete promo reason must stay removed');

console.log(`Landing verification passed (${markupKeys.size} markup keys, ${goodbyeKeys.size} goodbye keys, 5 locales).`);
