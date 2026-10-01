// Static inspection only: never loads DLLs or executes model pickle/code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/inspect-stem-extractor.cjs <extractor-directory>');
function inspectPE(b) {
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('Invalid PE');
  const count = b.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const sectionOffset = optional + b.readUInt16LE(pe + 20);
  const sections = Array.from({ length: count }, (_, i) => {
    const p = sectionOffset + i * 40;
    return { rva: b.readUInt32LE(p + 12), size: Math.max(b.readUInt32LE(p + 8), b.readUInt32LE(p + 16)), raw: b.readUInt32LE(p + 20) };
  });
  const offset = rva => {
    const s = sections.find(s => rva >= s.rva && rva < s.rva + s.size);
    if (!s) throw new Error(`Unmapped RVA ${rva}`);
    return s.raw + rva - s.rva;
  };
  const string = p => b.toString('ascii', p, b.indexOf(0, p));
  const data = optional + (b.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const exports = [];
  const exportRva = b.readUInt32LE(data);
  if (exportRva) {
    const e = offset(exportRva);
    const names = offset(b.readUInt32LE(e + 32));
    for (let i = 0; i < b.readUInt32LE(e + 24); i++) exports.push(string(offset(b.readUInt32LE(names + i * 4))));
  }
  const imports = [];
  const importRva = b.readUInt32LE(data + 8);
  if (importRva) {
    for (let p = offset(importRva); b.readUInt32LE(p + 12); p += 20) imports.push(string(offset(b.readUInt32LE(p + 12))));
  }
  return { machine: b.readUInt16LE(pe + 4).toString(16), exports, imports };
}
function inspectZip(b) {
  let end = b.length - 22;
  while (end >= Math.max(0, b.length - 65557) && b.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, b.length - 65557)) return null;
  let p = b.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = b.readUInt16LE(p + 10);
    const compressed = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLength = b.readUInt16LE(p + 28);
    const name = b.toString('utf8', p + 46, p + 46 + nameLength);
    const local = b.readUInt32LE(p + 42);
    const entry = { name, size, compressed, method };
    if (/\.(py|json|txt)$|\/version$|\/byteorder$/.test(name) && size < 1000000) {
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      const raw = b.subarray(start, start + compressed);
      if (method === 0 || method === 8) entry.text = (method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 1000000 }) : raw).toString('utf8');
    }
    entries.push(entry);
    p += 46 + nameLength + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return entries;
}
const result = {};
for (const name of ['stemextract.dll', 'data.mod']) {
  const b = fs.readFileSync(path.join(directory, name));
  const strings = b.toString('latin1').match(/[ -~]{8,}/g) || [];
  result[name] = {
    bytes: b.length,
    sha256: crypto.createHash('sha256').update(b).digest('hex'),
    signature: b.subarray(0, 32).toString('hex'),
    pe: b.toString('ascii', 0, 2) === 'MZ' ? inspectPE(b) : undefined,
    zip: inspectZip(b),
    relevantStrings: strings.filter(s => /torch|demucs|spleet|onnx|forward|\.py|\.pkl|model|stem|vocal|drums|bass|sample|fft/i.test(s)).slice(0,180),
  };
  if (name === 'data.mod' && !result[name].zip) {
    // Candidate repeating mask inferred from the zero fields in a ZIP local header.
    const mask = b.subarray(16, 24);
    const decoded = Buffer.alloc(b.length);
    for (let i = 0; i < b.length; i++) decoded[i] = b[i] ^ mask[i % mask.length];
    if (decoded.readUInt32LE(0) === 0x04034b50) {
      result[name].candidateMask = mask.toString('hex');
      result[name].decodedSignature = decoded.subarray(0, 32).toString('hex');
      result[name].decodedHeader = decoded.subarray(0, 256).toString('hex');
      result[name].decodedZip = inspectZip(decoded);
      result[name].decodedStrings = (decoded.toString('latin1').match(/[ -~]{8,}/g) || []).filter(s => /torch|demucs|\.py|\.pkl|model|\.th|\.pt|\.zip/.test(s)).slice(0,100);
      result[name].decodedTail = decoded.subarray(-100).toString('hex');
    }
  }
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
