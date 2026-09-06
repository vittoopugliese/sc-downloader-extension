#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const landingPath = path.join(projectRoot, 'index.html');
const defaultReviewSource = 'C:\\Users\\torib\\Desktop\\reviews.txt';
const reviewSourcePath = process.env.REVIEW_SOURCE || defaultReviewSource;
const html = fs.readFileSync(landingPath, 'utf8');

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
assert.strictEqual(reviews.length, 39, 'Landing must contain all 39 written reviews');

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
  'One free Looper WAV export',
  'A–B repeat',
  '$2.99',
  'one time',
  'Purchases open soon',
  'Download only content you own or have permission to save.'
]) {
  assert(html.includes(requiredCopy), `Missing required landing copy: ${requiredCopy}`);
}

assert(
  html.includes('https://chrome.google.com/webstore/detail/ekmbbjdpakacalghjkikfppebgdpoebb/reviews'),
  'Review CTA must link to the official review page'
);
assert(/reviewLabels[\s\S]*de:[\s\S]*en:[\s\S]*es:[\s\S]*pt:[\s\S]*ru:/.test(html), 'Review CTA locales are incomplete');
assert(!/(href|action)=["'][^"']*(checkout|stripe|paddle|lemonsqueezy)/i.test(html), 'Checkout must not be active yet');
assert(html.includes("text.textContent = review.text"), 'Review text must be rendered with textContent');
assert(!/reviews\.txt/i.test(html), 'Production landing must not fetch the Desktop review source');

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert(inlineScripts.length > 0, 'Landing must contain its interactive script');
for (const script of inlineScripts) new Function(script[1]);

console.log(`Landing verification passed (${reviews.length} authentic reviews)`);
