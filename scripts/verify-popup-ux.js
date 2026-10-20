const fs = require("fs");
const path = require("path");

const popupPath = path.resolve(__dirname, "..", "popup.html");
const popup = fs.readFileSync(popupPath, "utf8");
const popupScript = fs.readFileSync(path.resolve(__dirname, "popup.js"), "utf8");
const buttonTags = [...popup.matchAll(/<button\b[^>]*>/g)].map(
  ([tag]) => tag
);

assert(
  /id="downloadAnnouncement"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(popup) &&
    /function announceDownloadStatus\(message\)/.test(popupScript) &&
    /bulkState !== lastAnnouncedBulkState/.test(popupScript),
  "Download progress and outcomes need a polite status region without repeating every track update."
);

assert(
  /id="helpBtn"[^>]*data-i18n-aria-label="settings_and_help"/.test(popup) &&
    /id="helpPanel"[^>]*role="dialog"/.test(popup) &&
    /id="helpBackBtn"/.test(popup),
  "The popup must provide an internal, keyboard-accessible Help view."
);
assert(
  /\.download-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s.test(popup) &&
    /id="downloadToolbar"[\s\S]*id="downloadFormat"[\s\S]*id="downloadLimit"[\s\S]*id="chooseDownloadFolder"[\s\S]*id="resetDownloadFolder"[\s\S]*id="downloadBtn"/.test(popup),
  "Download controls must share one toolbar."
);
assert(
  !/role="tab(?:list|panel)?"|data-help-tab=/.test(popup) && !/selectHelpTab/.test(popupScript),
  "The popup home must have no help tabs or tab panels."
);
assert(
  /id="helpBackBtn"[^>]*>[\s\S]*name="back"[^>]*class="back-icon"/.test(popup),
  "Help must reuse the compact existing back-arrow icon."
);
assert(
  /function openHelp\(\)[\s\S]*helpPanel\.classList\.add\("is-visible"\)/.test(
    popupScript
  ) &&
    /function closeHelp\(\)[\s\S]*selectionViewport\.scrollTop = helpSelectionScrollTop/.test(
      popupScript
    ) &&
    /event\.key === "Escape"/.test(popupScript) &&
    /function trapHelpFocus\(event\)/.test(popupScript),
  "Help must preserve selection scroll, trap keyboard focus, and close with Escape."
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  !/id="waveformCanvas"/.test(popup) && !/\bdrawWaveform\b/.test(popupScript),
  "The extension popup must not duplicate the waveform shown in the tempo panel."
);

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
  /body\.selection-mode\s*\{\s*height:\s*auto;\s*\}/s.test(popup) &&
    /body\.selection-mode \.container\s*\{[^}]*height:\s*auto;[^}]*justify-content:\s*flex-start;/s.test(popup),
  "Selection mode should size the popup to its content instead of leaving empty space below the actions."
);
assert(
  /body\.selection-mode \.download-button-container\s*\{\s*margin-top:\s*8px;\s*\}/s.test(popup),
  "The selection download action should remain close to the end of the track list."
);
assert(
  /body\.selection-mode \.selection-header #downloadFormat\s*\{[^}]*width:\s*54px;[^}]*max-width:\s*54px;[^}]*flex:\s*0 0 54px;/s.test(popup),
  "The selection quality control should retain its readable 54px width."
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
  /id="resetDownloadFolder"[^>]*data-i18n-title="reset_download_folder"[^>]*>[\s\S]*name="close"[\s\S]*<\/button>/.test(popup) &&
    /SCDownloadDirectory\.clearCurrent\(\)/.test(popupScript),
  "The popup must provide a way back to the browser Downloads folder."
);
assert(
  /id="selectionBackBtn"[^>]*aria-label="Back"[^>]*>[\s\S]*name="back"[^>]*class="back-icon"/.test(
    popup
  ),
  "The selection back button should use the compact back-arrow icon."
);
assert(
  /name="folder"[^>]*class="folder-icon"/.test(popup),
  "The folder-picker icon asset is missing."
);
assert(
  /id="chooseDownloadFolder"[^>]*data-i18n-aria-label="choose_folder"/.test(popup) &&
    /has-custom-folder/.test(popup) &&
    /t\("change_download_folder", folderName\)/.test(popupScript),
  "The folder icon must expose the selected destination through its tooltip."
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
  /id="selectAllBtn"[^>]*aria-label="Select all tracks"[^>]*>[\s\S]*name="select-all"/.test(
    popup
  ) &&
    /id="clearAllBtn"[^>]*aria-label="Clear selected tracks"[^>]*>[\s\S]*name="deselect-all"/.test(
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
  /id="downloadLimitControl"[^>]*class="[^"]*popup-control-btn/.test(popup) &&
    /id="downloadLimit"[^>]*role="combobox"/.test(popup) &&
    /id="downloadLimitAll"[^>]*role="option"/.test(popup) &&
    /id="downloadLimitSelect"[^>]*role="option"/.test(popup),
  "The editable amount control must offer All and Select."
);
assert(
  buttonTags.length > 0 && buttonTags.every((tag) => /\btitle="[^"]+"/.test(tag)),
  "Every popup button should have a tooltip."
);
assert(
  !/commerceTestAccess|commerceTestUsername|commerceTestPassword|commerceTestBtn|TEST_LOGIN|TEST_PLAYER_TOOLS_PRO|isTestLogin/.test(popup + popupScript),
  "The popup must not contain a local Pro bypass."
);
assert(
  /productOffers\.hidden = active;/.test(popupScript) &&
    /document\.body\.classList\.toggle\("pro-active", active\);/.test(popupScript) &&
    !/SHOW_PRODUCT_OFFERS_FOR_PRO/.test(popupScript) &&
    /body\s*\{[\s\S]*?width:\s*426px;[\s\S]*?height:\s*341px;/s.test(popup) &&
    /body\.pro-active:not\(\.selection-mode\) \.track-info\s*\{\s*margin-block:\s*auto;\s*\}/s.test(popup),
  "Active Pro must hide the complete promotion row, center the track content, and preserve the popup dimensions."
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
assert(
  /id="failedDetails"[^>]*aria-live="polite"/.test(popup) &&
    /job\.failed\.map\(\(failed\)/.test(popupScript) &&
    /reason\.textContent = failed\.error/.test(popupScript),
  "Failed tracks must show their individual save or download reason before retrying."
);

assert(
  !/DOWNLOAD_PRESETS/.test(popupScript) &&
    /function selectedDownloadLimit\(\)/.test(popupScript) &&
    /amount <= getCollectionTotal\(\)/.test(popupScript),
  "The popup must accept custom amounts up to the collection total."
);

console.log("Popup UX verification passed.");
