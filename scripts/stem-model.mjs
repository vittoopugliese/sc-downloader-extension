export const MODEL = Object.freeze({
  url: 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx',
  bytes: 165612636,
  sha256: 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a',
  cache: 'scdl-stem-model-v1',
});

export async function loadModel(progress) {
  let cache;
  try { cache = await caches.open(MODEL.cache); } catch { /* Private/storage-restricted sessions can still run. */ }
  let response = await cache?.match(MODEL.url);
  const cached = Boolean(response);
  if (!response) response = await fetch(MODEL.url, { credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}). Check your connection and retry.`);
  const bytes = new Uint8Array(MODEL.bytes);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (received + value.length > bytes.length) throw new Error('Unexpected model size.');
      bytes.set(value, received);
      received += value.length;
      progress({ phase: cached ? 'cache' : 'download', received, total: MODEL.bytes });
    }
  } finally { await reader.cancel().catch(() => {}); }
  progress({ phase: 'verify' });
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (received !== MODEL.bytes || digest !== MODEL.sha256) {
    await cache?.delete(MODEL.url);
    throw new Error('The model download is incomplete or invalid. Retry to download it again.');
  }
  if (!cached && cache) {
    try { await cache.put(MODEL.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
    catch { progress({ phase: 'cache-unavailable' }); }
  }
  return bytes;
}
