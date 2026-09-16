const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupSource = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
const fallbackPath = "./assets/images/default_avatar.png";

assert.match(
  popupHtml,
  new RegExp(`<img id="artistArtwork"[^>]+src="${fallbackPath.replaceAll(".", "\\.")}"`),
  "The popup must render the neutral avatar before artist data is available",
);

const helperStart = popupSource.indexOf("function setArtistArtwork(");
const helperEnd = popupSource.indexOf("\n}\n", helperStart) + 3;
assert.ok(helperStart >= 0 && helperEnd > helperStart, "The popup must centralize artist avatar fallback handling");

const context = {};
vm.runInNewContext(`${popupSource.slice(helperStart, helperEnd)}; this.setArtistArtwork = setArtistArtwork;`, context);

function createImageThatFails(remoteUrl) {
  let currentSrc = "";
  return {
    onerror: null,
    get src() {
      return currentSrc;
    },
    set src(value) {
      currentSrc = value;
      if (value === remoteUrl) this.onerror?.();
    },
  };
}

const missingAvatar = createImageThatFails("unused");
context.setArtistArtwork(missingAvatar, null);
assert.equal(missingAvatar.src, fallbackPath, "A user without an avatar URL must use the neutral avatar");

const brokenUrl = "https://example.test/broken-avatar.jpg";
const brokenAvatar = createImageThatFails(brokenUrl);
context.setArtistArtwork(brokenAvatar, brokenUrl);
assert.equal(brokenAvatar.src, fallbackPath, "A failed remote avatar must be replaced by the neutral avatar");
assert.equal(brokenAvatar.onerror, null, "The fallback must not create an error loop");

for (const assignment of [
  "job.artistImageUrl",
  "trackData.artistImageUrl",
  "playlistData.artistImageUrl",
]) {
  assert.match(
    popupSource,
    new RegExp(`setArtistArtwork\\(artistArtwork, ${assignment.replace(".", "\\.")}\\)`),
    `The ${assignment} render path must use the shared avatar fallback`,
  );
}

console.log("Popup artist avatar fallback verification passed.");
