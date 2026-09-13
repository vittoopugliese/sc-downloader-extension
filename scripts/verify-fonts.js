const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const quicksand = "assets/fonts/Quicksand-Medium.ttf";

for (const fontPath of [quicksand]) {
  const absolutePath = path.join(projectRoot, fontPath);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size === 0) {
    throw new Error(`Font asset is missing or empty: ${fontPath}`);
  }
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8")
);
const exposedResources = manifest.web_accessible_resources.flatMap(
  (entry) => entry.resources || []
);
for (const fontPath of [quicksand]) {
  if (!exposedResources.includes(fontPath)) {
    throw new Error(`Font is not exposed to the SoundCloud UI: ${fontPath}`);
  }
}

const packageScript = fs.readFileSync(
  path.join(__dirname, "package-extension.ps1"),
  "utf8"
);
if (!packageScript.includes('"assets/fonts"')) {
  throw new Error("Extension packaging does not include assets/fonts.");
}

const popup = fs.readFileSync(path.join(projectRoot, "popup.html"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
const inlineButton = fs.readFileSync(path.join(__dirname, "inline-button.js"), "utf8");
const looper = fs.readFileSync(path.join(__dirname, "looper.js"), "utf8");
const tempoControl = fs.readFileSync(
  path.join(__dirname, "tempo-control-main.js"),
  "utf8"
);

for (const [name, source] of [
  ["popup", popup],
  ["SoundCloud font registration", content],
  ["looper", looper],
]) {
  if (
    !source.includes("Quicksand-Medium.ttf") ||
    !source.includes('font-family: "SCDL UI"')
  ) {
    throw new Error(`${name} does not define the extension UI font.`);
  }
}

for (const [name, source] of [
  ["popup", popup],
  ["inline button", inlineButton],
  ["looper", looper],
  ["tempo control", tempoControl],
]) {
  if (!source.includes('"SCDL UI", sans-serif')) {
    throw new Error(`${name} does not use the extension UI font family.`);
  }
}

console.log("Extension UI font verified.");
