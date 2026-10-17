# Third-party notices

## ONNX Runtime Web 1.30.0

The files in `scripts/vendor/onnxruntime` are copied from the pinned npm package
`onnxruntime-web@1.30.0`. Copyright (c) Microsoft Corporation. MIT License;
the complete license is included in that directory.
Source: https://github.com/microsoft/onnxruntime/tree/v1.30.0

## HTDemucs / StemSplit ONNX conversion

The experimental loop separator downloads model data on demand from
https://huggingface.co/StemSplitio/htdemucs-onnx at revision
`d54ed9eb60e258ea82131c6ee14578628816456a`.
File: `htdemucs_fp16weights.onnx` (165612636 bytes).
SHA-256: `d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`.
The distributor's model card declares MIT. Original HTDemucs:
Copyright (c) Meta Platforms, Inc. and affiliates. MIT License; the MIT
permission and warranty text below also applies to that attribution.
ONNX export and packaging by StemSplit: https://github.com/StemSplit/demucs-onnx
The model is cached locally, not bundled as executable code. No Image-Line
binary, code or weights are included in this feature.

Reference: Rouard, Massa and Défossez, “Hybrid Transformers for Music Source
Separation”, ICASSP 2023.

## browser-id3-writer v6.3.1

The bundled `scripts/vendor/id3-writer.js` is browser-id3-writer by
Evgeny Yurchenko, distributed under the MIT License.

Copyright (c) Evgeny Yurchenko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Toastify JS 1.12.0

The files in `scripts/vendor/toastify` come from the npm package `toastify-js@1.12.0`
by Varun A P. `toastify.min.mjs` is its ES module (`src/toastify-es.js`) minified with
terser; `toastify.css` is unchanged. MIT License; the complete license is included in
that directory. Source: https://github.com/apvarun/toastify-js

## Signalsmith Stretch

The bundled `scripts/vendor/signalsmith/wasm-factory.mjs` is a pinned generated
build of Signalsmith Stretch (revision `57b93f4e9206a089a45387eaa39bdc9f310d3308`).
Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd. It is distributed under
the MIT License; the MIT License text above applies.
