const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { validate } = require("./contact-content.js");

const root = path.resolve(__dirname, "..");
const contentPath = path.join(root, "extension-content/contact.json");
const raw = fs.readFileSync(contentPath);
assert.ok(raw.byteLength <= 16 * 1024, "Contact JSON exceeds 16 KiB");
const source = JSON.parse(raw.toString("utf8"));
const content = validate(source);
assert.ok(content, "Contact JSON does not match schema version 1");
if (content.enabled) {
  assert.equal(JSON.stringify(content), JSON.stringify(source), "Contact JSON contains invalid or unknown fields");
  if (content.image) {
    const filename = path.basename(new URL(content.image.url).pathname);
    assert.match(filename, /^[-a-zA-Z0-9]+-v\d+\.(?:png|jpe?g|webp)$/,
      "Image filename must have a version suffix");
    assert.ok(fs.statSync(path.join(root, "extension-content/images", filename)).isFile(),
      "Referenced image is missing");
  }
}
console.log(`Contact content valid: ${content.revision} (${content.enabled ? "enabled" : "disabled"})`);
