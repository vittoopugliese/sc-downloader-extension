// Test helper: drops audio files on a playlist lane, as a user drags them from the desktop.
// `files`: one or more { name, mimeType, buffer }. The drop lands at the lane's start.
async function dropAudio(page, files, { lane = 0 } = {}) {
  const list = (Array.isArray(files) ? files : [files]).map(file => ({ name: file.name, type: file.mimeType, data: [...file.buffer] }));
  await page.locator('.pl-lane').nth(lane).waitFor();
  await page.evaluate(({ list, lane }) => {
    const target = document.querySelectorAll('.pl-lane')[lane], dataTransfer = new DataTransfer();
    for (const file of list) dataTransfer.items.add(new File([new Uint8Array(file.data)], file.name, { type: file.type }));
    const { left, top } = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: left, clientY: top + 4 }));
  }, { list, lane });
}
module.exports = { dropAudio };
