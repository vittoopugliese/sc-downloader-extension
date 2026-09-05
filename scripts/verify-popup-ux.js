const fs = require("fs");
const path = require("path");

const popupPath = path.resolve(__dirname, "..", "popup.html");
const popup = fs.readFileSync(popupPath, "utf8");
const popupScript = fs.readFileSync(path.resolve(__dirname, "popup.js"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const viewportRule = popup.match(
  /#selectionViewport\s*\{[^}]*height:\s*(\d+)px;/s
);
assert(viewportRule, "Could not find the selection viewport height.");
assert(
  Number(viewportRule[1]) <= 8 * 40,
  `Selection shows more than 8 rows (${viewportRule[1]}px at 40px per row).`
);

assert(
  !/id="downloadFolder"[^>]*type="text"/.test(popup),
  "The popup still asks the user to type a folder path."
);
assert(
  /id="chooseDownloadFolder"/.test(popup),
  "The compact folder-picker button is missing."
);

const presets = popupScript.match(/const DOWNLOAD_PRESETS = \[([^\]]+)\]/);
assert(presets, "Could not find the bulk download presets.");
assert(
  presets[1].replace(/\s/g, "") === "10,25,50,100,150,200,300",
  `Bulk presets do not match the README: [${presets[1]}].`
);

console.log("Popup UX verification passed.");
