const fs = require("fs");
const path = require("path");

const popupPath = path.resolve(__dirname, "..", "popup.html");
const popup = fs.readFileSync(popupPath, "utf8");
const popupScript = fs.readFileSync(path.resolve(__dirname, "popup.js"), "utf8");
const buttonTags = [...popup.matchAll(/<button\b[^>]*>/g)].map(
  ([tag]) => tag
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const viewportRule = popup.match(
  /#selectionViewport\s*\{([^}]*)\}/s
);
assert(viewportRule, "Could not find the selection viewport styles.");
const panelRule = popup.match(/#selectionPanel\s*\{([^}]*)\}/s);
assert(panelRule, "Could not find the selection panel styles.");
assert(
  /flex:\s*0 0 auto;/.test(panelRule[1]),
  "The selection panel should not grow and push the download button away."
);
assert(
  /flex:\s*0 0 auto;/.test(viewportRule[1]) &&
    /max-height:\s*320px;/.test(viewportRule[1]),
  "The selection viewport should size to its rows and cap at 8 rows (320px)."
);
assert(
  /overflow-y:\s*auto;/.test(viewportRule[1]),
  "The selection viewport should scroll internally."
);
assert(
  /const MAX_SELECTION_HEIGHT = 8 \* ROW_HEIGHT;/.test(popupScript) &&
    /selectionViewport\.style\.height\s*=\s*`\$\{Math\.min\(\s*total \* ROW_HEIGHT \+ 2,\s*MAX_SELECTION_HEIGHT\s*\)\}px`/.test(
      popupScript
    ),
  "The selection viewport should match the number of tracks and cap at 8 rows."
);
assert(
  !/body\.selection-mode\s*\{[^}]*520px/s.test(popup),
  "Selection mode should not force the popup to a 520px height."
);

assert(
  !/id="downloadFolder"[^>]*type="text"/.test(popup),
  "The popup still asks the user to type a folder path."
);
assert(
  /id="chooseDownloadFolder"/.test(popup),
  "The compact folder-picker button is missing."
);
assert(
  /id="selectionBackBtn"[^>]*aria-label="Back"[^>]*>[\s\S]*class="back-icon"[^>]*src="\.\/assets\/back-arrow\.svg"/.test(
    popup
  ),
  "The selection back button should use the compact back-arrow icon."
);
assert(
  /class="folder-icon"[^>]*src="\.\/assets\/folder-icon\.svg"/.test(popup),
  "The folder-picker icon asset is missing."
);
assert(
  /id="downloadFolderName">Downloads<\/span>/.test(popup),
  "The active download destination must be visible next to the folder icon."
);
assert(
  /\.folder-icon\s*,\s*\.back-icon\s*\{[^}]*filter:\s*invert\(1\);/s.test(
    popup
  ),
  "The compact icons should be inverted for the dark UI."
);
assert(
  /\.folder-icon\s*,\s*\.back-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s.test(
      popup
    ) &&
    /\.back-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s.test(popup),
  "The folder icon should use 20px and the back icon should use 16px."
);
assert(
  /id="selectAllBtn"[^>]*aria-label="Select all tracks"[^>]*>[\s\S]*src="\.\/assets\/select-all\.svg"/.test(
    popup
  ) &&
    /id="clearAllBtn"[^>]*aria-label="Clear selected tracks"[^>]*>[\s\S]*src="\.\/assets\/deselect-all\.svg"/.test(
      popup
    ),
  "The selection action buttons should use their icon assets."
);
assert(
  /\.selection-action-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*filter:\s*invert\(1\);/s.test(
    popup
  ),
  "The selection action icons should use the compact inverted icon style."
);
assert(
  /id="downloadLimit"[^>]*class="[^"]*popup-control-btn/.test(popup),
  "The download preset selector does not use the shared control style."
);
assert(
  buttonTags.length > 0 && buttonTags.every((tag) => /\btitle="[^"]+"/.test(tag)),
  "Every popup button should have a tooltip."
);
assert(
  /async function ensureDownloadDestinationPermission\(\)[\s\S]*SCDownloadDirectory\.ensurePermission\(currentDownloadDestination\.id\)/.test(
    popupScript
  ),
  "The popup must restore access to a remembered folder from the download click."
);
const permissionChecks = popupScript.match(
  /await ensureDownloadDestinationPermission\(\);/g
);
assert(
  permissionChecks?.length === 3,
  "Single, bulk, and selected downloads must all restore folder access."
);
assert(
  /function formatDownloadSuccess\(result\)[\s\S]*result\?\.fileName[\s\S]*result\?\.destinationName/.test(
    popupScript
  ),
  "A completed download must identify the file and the destination it actually used."
);
assert(
  /const result = await popupDownloadIntent\.downloadTrack\([\s\S]*setDownloadState\(false, formatDownloadSuccess\(result\)\)/.test(
    popupScript
  ),
  "The popup must not report a generic success without showing the resolved destination."
);

const presets = popupScript.match(/const DOWNLOAD_PRESETS = \[([^\]]+)\]/);
assert(presets, "Could not find the bulk download presets.");
assert(
  presets[1].replace(/\s/g, "") === "10,25,50,100,150,200,300",
  `Bulk presets do not match the README: [${presets[1]}].`
);

console.log("Popup UX verification passed.");
