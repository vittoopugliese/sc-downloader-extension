const fs = require("node:fs");
const path = require("node:path");
const provenance = require("./package-provenance.js");

const root = path.resolve(__dirname, "..");
const mode = process.argv[2];
function packageItems() {
  const script = fs.readFileSync(path.join(__dirname, "package-extension.ps1"), "utf8");
  const list = script.match(/\$packageItems = @\(([\s\S]*?)\n\s*\)/)?.[1];
  if (!list) throw new Error("Could not read the package allow-list.");
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

if (mode === "stage") {
  const stage = path.resolve(process.argv[3]);
  const apiBaseUrl = new URL(process.argv[4]);
  const publicJwk = JSON.parse(process.env.ENTITLEMENT_PUBLIC_JWK || "null");
  const keys = Array.isArray(publicJwk?.keys) ? publicJwk.keys : [publicJwk];
  const source = provenance.sourceState(root, packageItems());
  if (process.env.PACKAGE_RELEASE === "1") {
    if (!process.env.EXPECTED_COMMIT || process.env.EXPECTED_COMMIT !== source.commit)
      throw new Error("Release packaging requires EXPECTED_COMMIT to equal the full current commit.");
    if (source.dirty) throw new Error(`Release packaging refuses changed included files: ${source.changed.join(", ")}`);
  }
  const stagedHashes = provenance.fileHashes(stage, fs.readdirSync(stage));
  const build = { schemaVersion: 1, sourceCommit: source.commit, sourceDirty: source.dirty,
    sourceChanged: source.changed, sourceFingerprint: source.fingerprint, apiOrigin: apiBaseUrl.origin,
    apiMode: /(?:^|[-.])test(?:[-.]|$)/i.test(apiBaseUrl.hostname) ? "test" : "production",
    entitlementKeyIds: keys.map((key) => key.kid).sort(), files: stagedHashes,
    stagedFingerprint: provenance.fingerprint(stagedHashes) };
  fs.writeFileSync(path.join(stage, "release-build.json"), `${JSON.stringify(build, null, 2)}\n`);
} else if (mode === "sidecar") {
  const zip = path.resolve(process.argv[3]);
  const embedded = process.argv[4]
    ? JSON.parse(fs.readFileSync(path.join(path.resolve(process.argv[4]), "release-build.json"), "utf8"))
    : JSON.parse(require("node:child_process").execFileSync("unzip", ["-p", zip, "release-build.json"], { encoding: "utf8" }));
  fs.writeFileSync(`${zip}.provenance.json`, `${JSON.stringify({ ...embedded, zipFile: path.basename(zip),
    zipSha256: provenance.sha256(fs.readFileSync(zip)) }, null, 2)}\n`);
} else throw new Error("Usage: write-package-provenance.js stage STAGE API_URL | sidecar ZIP [STAGE]");
