#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const landingPath = path.join(projectRoot, 'index.html');
const defaultReviewSource = 'C:\\Users\\torib\\Desktop\\reviews.txt';
const reviewSourcePath = process.env.REVIEW_SOURCE || defaultReviewSource;
const html = fs.readFileSync(landingPath, 'utf8');
const i18nPath = path.join(projectRoot, 'scripts', 'landing-i18n.js');
const i18nSource = fs.readFileSync(i18nPath, 'utf8');

function parseInlineReviews(markup) {
  const declaration = markup.match(/const webStoreReviews\s*=\s*(\[[\s\S]*?\n\s*\]);/);
  assert(declaration, 'Expected one inline webStoreReviews declaration');
  assert.strictEqual(
    (markup.match(/const webStoreReviews\s*=/g) || []).length,
    1,
    'Expected exactly one webStoreReviews declaration'
  );
  return JSON.parse(declaration[1]);
}

function parseCopiedReviewSource(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const reviews = [];
  const stopLine = line =>
    line.startsWith('¿Te ha resultado útil') ||
    line.startsWith('Según ') ||
    /^A \d+ de \d+ les ha parecido útil$/.test(line) ||
    line.startsWith('Imagen de perfil');

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== 'Imagen de perfil de la reseña') continue;
    const author = lines[index + 1];
    const date = lines[index + 2];
    const textLines = [];
    for (let cursor = index + 3; cursor < lines.length && !stopLine(lines[cursor]); cursor += 1) {
      textLines.push(lines[cursor]);
    }
    reviews.push({ author, date, text: textLines.join('\n').trim(), source: 'Chrome Web Store' });
  }

  // The copied source omitted the standard profile marker before this one review.
  const orphanMatch = source.match(/(?:^|\r?\n)v\r?\n9 dic 2025\r?\n(Fantastic, works fast[^\r\n]+)/);
  assert(orphanMatch, 'Expected the marker-less review by v in the copied source');
  const orphan = {
    author: 'v',
    date: '9 dic 2025',
    text: orphanMatch[1],
    source: 'Chrome Web Store'
  };
  const insertionIndex = reviews.findIndex(review => review.author === 'Imtiaz Uddin');
  assert(insertionIndex > 0, 'Could not place the marker-less review in source order');
  reviews.splice(insertionIndex, 0, orphan);
  return reviews;
}

const reviews = parseInlineReviews(html);
const declaredReviewCount = Number(html.match(/id="review-count">(\d+)</)?.[1]);
assert(Number.isSafeInteger(declaredReviewCount), 'Landing review count is missing');
assert.strictEqual(reviews.length, declaredReviewCount, 'Landing review count must match its review data');
assert(reviews.length >= 39, 'Landing lost previously verified written reviews');

const identities = new Set();
for (const [index, review] of reviews.entries()) {
  for (const field of ['author', 'date', 'text', 'source']) {
    assert.strictEqual(typeof review[field], 'string', `Review ${index + 1} is missing ${field}`);
    assert(review[field].length > 0, `Review ${index + 1} has an empty ${field}`);
  }
  assert.strictEqual(review.source, 'Chrome Web Store');
  const identity = `${review.author}\u0000${review.date}\u0000${review.text}`;
  assert(!identities.has(identity), `Duplicate review: ${review.author} (${review.date})`);
  identities.add(identity);
}

assert(reviews.some(review => review.author === 'Павел Волков'), 'Cyrillic author was not preserved');
assert(
  reviews.some(review => review.text.includes('Лучшее из инструментов')),
  'Cyrillic review text was not preserved'
);
assert(!reviews.some(review => review.author === 'vittoopugliese'), 'Developer responses must not be reviews');

if (fs.existsSync(reviewSourcePath)) {
  const copiedReviews = parseCopiedReviewSource(fs.readFileSync(reviewSourcePath, 'utf8'));
  assert.strictEqual(copiedReviews.length, reviews.length, 'Inline/source review counts differ');
  copiedReviews.forEach((expected, index) => {
    const actual = reviews[index];
    assert.deepStrictEqual(
      { author: actual.author, date: actual.date, text: actual.text, source: actual.source },
      expected,
      `Inline review ${index + 1} differs from the copied source`
    );
  });
} else {
  console.warn(`Review source not found at ${reviewSourcePath}; source comparison skipped`);
}

assert(!html.includes('All features are free'), 'Outdated all-features-free promise remains');
for (const requiredCopy of [
  'Full-track downloads stay free',
  'Download only content you own or have permission to save.'
]) {
  assert(html.includes(requiredCopy), `Missing required landing copy: ${requiredCopy}`);
}

assert(
  html.includes('https://chrome.google.com/webstore/detail/ekmbbjdpakacalghjkikfppebgdpoebb/reviews'),
  'Review CTA must link to the official review page'
);
assert(html.includes('./scripts/landing-i18n.js'), 'Landing must load its localization script');
for (const locale of ['en', 'es', 'pt', 'de', 'ru']) {
  assert(new RegExp(`\\b${locale}:\\s*\\{`).test(i18nSource), `Landing locale ${locale} is missing`);
}
assert(i18nSource.includes('write_review') && i18nSource.includes('reviews_show_all'), 'Review CTA locales are incomplete');
assert(!/(href|action)=["'][^"']*(checkout|stripe|paddle|lemonsqueezy)/i.test(html), 'Checkout must not be active yet');
for (const requiredPlanCopy of [
  'Downloads are free. Go Pro for the tools.',
  'up to 20 new A–B loops total, shared across tracks and tabs',
  'Open the extension to buy or restore Player Tools Pro securely.'
]) {
  assert(html.includes(requiredPlanCopy), `Missing required Player Tools plan copy: ${requiredPlanCopy}`);
}
assert(html.includes("text.textContent = review.text"), 'Review text must be rendered with textContent');
assert(html.includes("badge.textContent = t('implemented_badge')"), 'Implemented review requests need their localized badge');
assert(html.includes('scroll-snap-type:x mandatory'), 'Reviews should use a horizontal scroll carousel');
assert(html.includes('id="review-prev"') && html.includes('id="review-next"'), 'Reviews should have previous and next controls');
assert(!html.includes('looper-player'), 'The retired standalone Looper player must be absent');
assert(!/<button[^>]+id="loop-export"/.test(html), 'The retired WAV-export UI must be absent');
assert(html.includes('id="looper"'), 'The landing must retain the Player Tools section anchor.');
assert(html.includes('mailto:it@vpugliese.online'), 'The configured support email is missing');
assert(!/reviews\.txt/i.test(html), 'Production landing must not fetch the Desktop review source');

const inlineScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
assert(inlineScripts.length > 0, 'Landing must contain its interactive script');
for (const [, attributes, source] of inlineScripts) {
  if (/type\s*=\s*["']application\/ld\+json["']/i.test(attributes)) {
    JSON.parse(source);
  } else {
    new Function(source);
  }
}

console.log(`Landing verification passed (${reviews.length} authentic reviews)`);
