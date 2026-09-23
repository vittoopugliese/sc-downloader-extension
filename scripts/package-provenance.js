const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function walk(root, relative, result) {
  const target = path.join(root, relative);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      if (name === ".DS_Store" || name === "Thumbs.db") continue;
      walk(root, path.join(relative, name), result);
    }
  } else {
    result.push(relative.split(path.sep).join("/"));
  }
}

function fileHashes(root, items) {
  const files = [];
  for (const item of [...items].sort()) walk(root, item, files);
  return Object.fromEntries(files.sort().map((relative) => [relative, sha256(fs.readFileSync(path.join(root, relative)))]));
}

function fingerprint(hashes) {
  return sha256(Buffer.from(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)))));
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function sourceState(root, items) {
  const hashes = fileHashes(root, items);
  const included = new Set(Object.keys(hashes));
  const changed = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).split(/\r?\n/).filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, "")).filter((file) => included.has(file));
  return { commit: git(root, ["rev-parse", "HEAD"]), dirty: changed.length > 0, changed, hashes,
    fingerprint: fingerprint(hashes) };
}

module.exports = { sha256, fileHashes, fingerprint, sourceState };
