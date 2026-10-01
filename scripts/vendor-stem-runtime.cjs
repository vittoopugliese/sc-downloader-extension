// Copy only the pinned runtime assets needed by the extension's WASM worker.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/onnxruntime-web');
const target = path.join(__dirname, 'vendor/onnxruntime');
const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
if (version !== '1.30.0') throw new Error(`Expected ONNX Runtime Web 1.30.0, got ${version}`);
fs.mkdirSync(target, { recursive: true });
for (const file of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.join(source, 'dist', file), path.join(target, file));
}
// npm omits the LICENSE file; the upstream MIT notice is maintained alongside these assets.
if (!fs.existsSync(path.join(target, 'LICENSE'))) throw new Error('Missing bundled ONNX Runtime license.');
console.log(`Vendored ONNX Runtime Web ${version}`);
