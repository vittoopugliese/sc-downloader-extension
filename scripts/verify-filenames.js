const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  URL,
  Blob,
  TextEncoder,
  TextDecoder,
});

for (const relativePath of ["scripts/format-utils.js", "scripts/download-core.js"]) {
  const filePath = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
    filename: filePath,
  });
}

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sanitizeFilename(trackData, extension) {
  return evaluate(
    `SCDownload.sanitizeFilename(${JSON.stringify(trackData)}, ${JSON.stringify(extension)})`
  );
}

const cyrillicTrack = {
  artist: "\u041a\u0440\u044b\u043b\u044c\u044f",
  title: "\u0420\u043e\u0436\u0434\u0435\u043d\u0438\u0435\u2026 \u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442",
};
assertEqual(
  sanitizeFilename(cyrillicTrack, "mp3"),
  `${cyrillicTrack.artist} - ${cyrillicTrack.title}.mp3`,
  "Cyrillic filename"
);

const internationalTrack = {
  artist: "L\u00ea Ho\u00e0ng Nam",
  title: "\u6b4c\u66f2 \ud83c\udfb5",
};
assertEqual(
  sanitizeFilename(internationalTrack, "m4a"),
  `${internationalTrack.artist} - ${internationalTrack.title}.m4a`,
  "international filename"
);

assertEqual(
  sanitizeFilename({ artist: "AC/DC", title: "Why? <Demo>" }, "MP3"),
  "AC DC - Why Demo.mp3",
  "invalid path characters"
);
assertEqual(
  evaluate(`SCFormat.sanitizePathComponent("  \\u041c\\u043e\\u0439   \\u043f\\u043b\\u0435\\u0439\\u043b\\u0438\\u0441\\u0442. ", "Fallback", 120)`),
  "\u041c\u043e\u0439 \u043f\u043b\u0435\u0439\u043b\u0438\u0441\u0442",
  "Unicode folder name"
);
assertEqual(
  evaluate(`SCFormat.sanitizePathComponent("CON", "Fallback", 120)`),
  "_CON",
  "Windows reserved name"
);

console.log("Filename verification passed.");
