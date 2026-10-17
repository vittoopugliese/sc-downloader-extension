const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build, compile, packageFiles } = require('./build-icons.cjs');
const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(__dirname, 'icons-runtime.js'), 'utf8');
const svg = id => `<svg viewBox="0 0 24 24"><path d="M${id} 0v10"/></svg>`;
const fixture = {
  sources: ['<sc-icon name="play"></sc-icon>', "SCIcons.create(active ? 'pause' : 'play')", "const menu = { icon: 'resume' };"],
  aliases: { help: 'a', play: 'b', resume: 'b', pause: 'c', unused: 'd', slice: 'e' },
  catalog: { a: svg(1), b: svg(2), c: svg(3), d: svg(4), e: svg(5) }, runtime,
};
const result = compile(fixture);
const context = vm.createContext({});
vm.runInContext(result.client, context);
assert.deepEqual(Array.from(context.SCIcons.names), ['help', 'pause', 'play', 'resume']);
assert.equal(context.SCIcons.has('unused'), false);
assert.equal(result.vectorCount, 3, 'Aliases sharing geometry must not duplicate it');
assert.ok(!result.output.includes(svg(4)), 'Unused geometry must be removed');
assert.ok(!result.client.includes('<svg'), 'Isolated helpers must contain no geometry');
assert.ok(context.SCIcons.html('<img>', '"onclick="bad').includes('&lt;img&gt;'));
assert.equal(compile({ ...fixture, include: ['unused'] }).vectorCount, 4);
assert.throws(() => compile({ ...fixture, include: ['missing'] }), /Unknown included icon/);
assert.throws(() => compile({ ...fixture, sources: ['<sc-icon name="missing"></sc-icon>'] }), /Unknown literal icon/);
assert.throws(() => compile({ ...fixture, catalog: { ...fixture.catalog, b: '<svg><script/></svg>' } }), /unsafe vector/);

const actual = build(root, { check: true });
assert.ok(actual.vectorCount < 100, 'Do not ship the full catalog');
assert.ok(Buffer.byteLength(actual.output) < 60000);
assert.ok(Buffer.byteLength(actual.client) < 4000);
assert.ok(!/ILGlyphs|ILLogos|ImageLine|glyph:|cursor:/.test(actual.output), 'Runtime uses semantic names only');
const files = packageFiles(root);
assert.deepEqual(files.filter(file => file.startsWith('assets/icons')), ['assets/icons/player-toolkit.png']);
assert.ok(!files.some(file => /icon-(?:vectors|aliases|include)|build-icons|icons-runtime/.test(file)));
const manifest = require('../manifest.json');
for (const entry of manifest.content_scripts.filter(entry => entry.js?.some(file => /icons(?:-client)?\.js$/.test(file)))) {
  const expected = entry.world === 'MAIN' ? 'scripts/icons.js' : 'scripts/icons-client.js';
  assert.equal(entry.js[0], expected);
  assert.ok(files.includes(expected));
}
console.log(`Icons: unused vectors removed, dynamic states retained, deduplication, escaping and package selection passed (${actual.vectorCount} vectors).`);
