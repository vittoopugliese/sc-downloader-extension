const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
function readFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert(start >= 0, `Missing ${name}`);
  const end = source.indexOf("\n}", start) + 2;
  return source.slice(start, end);
}
function element() {
  return {
    style: {}, dataset: {}, children: [], scrollTop: 0, clientHeight: 320,
    classList: { add() {}, remove() {} },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren(fragment) { this.children = fragment?.children || []; },
  };
}

(async () => {
  let finishLoading;
  let requests = 0;
  let confirmations = 0;
  let accepted = false;
  let loading = false;
  let restored = false;
  const context = vm.createContext({
    console, Set, Math, String, Number,
    currentPlaylistData: { kind: "likes", totalCount: 150 },
    isOpeningSelection: false, isSelectionMode: false,
    SELECT_WARN_THRESHOLD: 1000, ROW_HEIGHT: 40, OVERSCAN: 6, MAX_SELECTION_HEIGHT: 320,
    selectionItems: [], selectionTotal: 0, selectionAll: false,
    selectionExcludedIds: new Set(), selectedIds: new Set(), selectionScrollRaf: null,
    selectionViewport: element(), selectionSpacer: element(), selectionRows: element(),
    selectionPanel: element(), downloadLimitControl: element(), downloadBtn: element(),
    loadingText: element(), document: { body: element(), createElement: element, createDocumentFragment: element },
    t: key => key,
    confirm() { confirmations++; return accepted; }, alert() {},
    showLoading() { loading = true; }, hideLoading() { loading = false; },
    updateCollectionControlHints() {}, closeDownloadLimitMenu() {}, moveControlsToSelectionView() {},
    updateSelectionCount() {}, showDownloadDestination() {},
    restoreCollectionAfterSelectionError() { restored = true; },
    requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {},
    requestFromActiveTab(message) {
      requests++;
      assert.equal(message.type, "GET_BULK_SELECTION_LIST");
      return new Promise(resolve => { finishLoading = resolve; });
    },
  });
  for (const name of ["openSelectionPanel", "enterSelectionMode", "renderVisibleSelectionRows", "onSelectionScroll"]) {
    vm.runInContext(readFunction(name), context);
  }

  await context.openSelectionPanel();
  assert.equal(confirmations, 1, "Likes must ask before loading, even below 1000");
  assert.equal(requests, 0, "Cancel must not fetch tracks");
  accepted = true;
  const opening = context.openSelectionPanel({ selectAllByDefault: true });
  assert.equal(loading, true);
  assert.equal(context.isSelectionMode, false, "Do not show a partial list");
  await context.openSelectionPanel();
  assert.equal(requests, 1, "Ignore duplicate clicks while loading");
  const items = Array.from({ length: 120 }, (_, index) => ({
    id: index + 1, title: `Track ${index + 1}`, index: index % 46 + 1,
    indexLabel: String(index % 46 + 1).padStart(2, "0"), duration: "3:00",
  }));
  finishLoading({ success: true, items });
  await opening;
  assert.equal(loading, false);
  assert.equal(context.selectionTotal, 120, "Use actual selectable count, excluding unavailable tracks");
  assert.equal(context.selectionAll, true);
  assert.equal(context.selectionSpacer.style.height, "4800px", "Full scroll range must exist immediately");
  context.selectionViewport.scrollTop = 46 * 40;
  context.onSelectionScroll();
  const row = context.selectionRows.children.find(row => row.dataset.index === "46");
  assert.equal(row.children[1].textContent, "047", "Numbers must continue across page boundaries");
  context.selectionViewport.scrollTop = 119 * 40;
  context.onSelectionScroll();
  assert.equal(context.selectionRows.children.at(-1).children[1].textContent, "120");
  assert.equal(requests, 1, "Scrolling must never request more tracks");

  context.isSelectionMode = false;
  const failed = context.openSelectionPanel();
  finishLoading({ success: false, error: "Network failure" });
  await failed;
  assert.equal(restored, true);
  assert.equal(context.isOpeningSelection, false);
  assert.equal(loading, false);
  console.log("Popup selection: confirmation, complete loading, continuous numbering, local scrolling and error recovery passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
