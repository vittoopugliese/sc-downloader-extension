// Keep the established PowerShell allow-list as the single source of package files.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const provenance = require('./package-provenance.js');
const root = path.resolve(__dirname,'..');
const edition = process.env.PACKAGE_EDITION || 'full';
if (!['full', 'tools'].includes(edition)) throw new Error('PACKAGE_EDITION must be "full" or "tools".');
const zipBaseName = edition === 'tools' ? 'soundcloud-player-tools' : 'soundcloud-track-downloader';
// The tools edition is the separate Player Tools listing: downloader hidden, track downloads off.
const editionSwitches = [
  ['scripts/release-config.js', 'const DOWNLOADER_ENABLED = true;', 'const DOWNLOADER_ENABLED = false;'],
  ['scripts/tempo-control-main.js', 'const TOOLS_EDITION = false;', 'const TOOLS_EDITION = true;'],
];

function zipEntries(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

function zipText(zipPath, entry) {
  return execFileSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8' });
}

function smokePackage(zipPath, apiPermission) {
  const entries = new Set(zipEntries(zipPath));
  const files = [...entries].filter(entry => !entry.endsWith('/'));
  const forbidden = /(^|\/)(?:\.git|\.agents|\.codex|docs|services|repos|node_modules|dist|test|tests)(?:\/|$)|(^|\/)verify-[^/]+\.js$|uninstall-feedback-emails|(^|\/)(?:\.DS_Store|Thumbs\.db|\.dev\.vars[^/]*)$/;
  const prohibited = files.filter(entry => forbidden.test(entry));
  if (prohibited.length) throw new Error(`Package contains development-only files: ${prohibited.join(', ')}`);
  for (const required of ['manifest.json', 'popup.html', 'offscreen.html', 'stems.html', 'assets/stems.css', 'scripts/local-audio-output.mjs',
    'scripts/stem-worker.mjs', 'scripts/stem-model.mjs', 'scripts/stem-audio.mjs', 'scripts/stem-jobs.js',
    'scripts/stem-presets.mjs', 'scripts/stem-library-ui.mjs', 'scripts/stem-tone-processor.mjs',
    'scripts/stem-playlist.mjs', 'scripts/stem-playlist-core.mjs', 'scripts/stem-playlist-audio.mjs', 'scripts/stem-playlist-stretch.mjs', 'scripts/stem-playlist-worker.mjs', 'assets/stem-playlist.css',
    'scripts/stem-loop.mjs', 'scripts/stem-sampler.mjs', 'scripts/stem-pattern-core.mjs', 'scripts/stem-instruments.mjs', 'scripts/stem-channel-rack.mjs', 'scripts/stem-piano.mjs', 'scripts/stem-spectrum.mjs', 'assets/icons/mute.svg',
    'scripts/stem-sample-browser.mjs', 'scripts/stem-sample-library.mjs', 'scripts/stem-sample-preview.mjs', 'scripts/stem-module-window.mjs', 'scripts/stem-row-menu.mjs', 'scripts/stem-rack-overview.mjs',
    'scripts/vendor/onnxruntime/ort.wasm.min.mjs', 'scripts/vendor/onnxruntime/ort-wasm-simd-threaded.mjs',
    'scripts/vendor/onnxruntime/ort-wasm-simd-threaded.wasm', 'scripts/background.js', 'THIRD_PARTY_LICENSES.md']) {
    if (!entries.has(required)) throw new Error(`Package smoke check: missing ${required}.`);
  }
  const manifest = JSON.parse(zipText(zipPath, 'manifest.json'));
  if (!manifest.host_permissions?.includes(apiPermission)) throw new Error(`Package smoke check: missing API host permission ${apiPermission}.`);
  const referencedScripts = [manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap(item => item.js || []),
    ...['popup.html', 'offscreen.html', 'stems.html'].flatMap((html) => [...zipText(zipPath, html).matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(match => match[1]))]
    .filter(Boolean);
  for (const script of referencedScripts) {
    const entry = script.replace(/^\.\//, '');
    if (!entries.has(entry)) throw new Error(`Package smoke check: runtime script ${script} is missing.`);
  }
  const commerce = zipText(zipPath, 'scripts/player-tools-commerce.js');
  if (/TEST_LOGIN|TEST_PLAYER_TOOLS_PRO|username:\s*"1",\s*password:\s*"1"/.test(commerce)) {
    throw new Error('Package smoke check: obsolete local Pro bypass is present.');
  }
  const receipts = zipText(zipPath, 'scripts/player-tools-receipts.js');
  if (receipts.includes('PACKAGED_ENTITLEMENT_PUBLIC_JWK = null') || /PACKAGED_ENTITLEMENT_PUBLIC_JWK[^;]*"d"\s*:/.test(receipts)) {
    throw new Error('Package smoke check: entitlement key is missing or contains private material.');
  }
  if (edition === 'tools') {
    for (const [file, , enabled] of editionSwitches) {
      if (!zipText(zipPath, file).includes(enabled)) throw new Error(`Package smoke check: ${file} is not switched to the tools edition.`);
    }
  }
  console.log(`Package smoke passed (${edition} edition; ${files.length} files; no local Pro bypass; no development paths).`);
}

if (process.platform === 'win32') {
  execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'package-extension.ps1')],{stdio:'inherit'});
  const apiBaseUrl = new URL(process.env.PLAYER_TOOLS_API_BASE_URL || '');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  smokePackage(path.join(root, 'dist', `${zipBaseName}-${manifest.version}.zip`), `${apiBaseUrl.origin}/*`);
} else {
  const script = fs.readFileSync(path.join(__dirname,'package-extension.ps1'),'utf8');
  const list = script.match(/\$packageItems = @\(([\s\S]*?)\n\s*\)/)[1];
  const items = [...list.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(),'scdl-package-'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const output = path.join(root,'dist',`${zipBaseName}-${manifest.version}.zip`);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  try {
    for (const item of items) {
      const destination = path.join(stage,item);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.cpSync(path.join(root,item),destination,{recursive:true});
    }
    const removePlatformMetadata = directory => {
      for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
        const target = path.join(directory,entry.name);
        if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') fs.rmSync(target,{force:true});
        else if (entry.isDirectory()) removePlatformMetadata(target);
      }
    };
    removePlatformMetadata(stage);
    if (edition === 'tools') {
      for (const [file, disabled, enabled] of editionSwitches) {
        const target = path.join(stage, file);
        const source = fs.readFileSync(target, 'utf8');
        if (source.split(disabled).length !== 2) throw new Error(`Could not apply the tools edition switch in ${file}.`);
        fs.writeFileSync(target, source.replace(disabled, enabled));
      }
    }
    const commercePath = path.join(stage,'scripts','player-tools-commerce.js');
    const apiBaseLine = 'const API_BASE_URL = "https://sctd-test.vpugliese.online/api/player-tools";';
    let apiBaseUrl;
    try { apiBaseUrl = new URL(process.env.PLAYER_TOOLS_API_BASE_URL || ''); }
    catch { throw new Error('Set PLAYER_TOOLS_API_BASE_URL to the HTTPS test or production licensing endpoint before packaging.'); }
    if (apiBaseUrl.protocol !== 'https:' || apiBaseUrl.username || apiBaseUrl.password || apiBaseUrl.search || apiBaseUrl.hash ||
        apiBaseUrl.pathname.replace(/\/$/, '') !== '/api/player-tools') {
      throw new Error('PLAYER_TOOLS_API_BASE_URL must be an HTTPS origin ending in /api/player-tools, without credentials, query or fragment.');
    }
    const normalizedApiBaseUrl = apiBaseUrl.href.replace(/\/$/, '');
    const commerceSource = fs.readFileSync(commercePath,'utf8');
    if (!commerceSource.includes(apiBaseLine)) throw new Error('Could not inject the Player Tools API endpoint.');
    fs.writeFileSync(commercePath,commerceSource
      .replace(apiBaseLine,`const API_BASE_URL = ${JSON.stringify(normalizedApiBaseUrl)};`));
    const packagedManifestPath = path.join(stage,'manifest.json');
    const packagedManifest = JSON.parse(fs.readFileSync(packagedManifestPath,'utf8'));
    const apiPermission = `${apiBaseUrl.origin}/*`;
    packagedManifest.host_permissions = packagedManifest.host_permissions
      .filter(permission => permission !== 'https://sctd-test.vpugliese.online/*');
    if (!packagedManifest.host_permissions.includes(apiPermission)) packagedManifest.host_permissions.push(apiPermission);
    fs.writeFileSync(packagedManifestPath,`${JSON.stringify(packagedManifest,null,2)}\n`);
    const receiptsPath = path.join(stage,'scripts','player-tools-receipts.js');
    const receiptSource = fs.readFileSync(receiptsPath,'utf8');
    const publicKeyLine = 'const PACKAGED_ENTITLEMENT_PUBLIC_JWK = Object.freeze({"keys":[{"kty":"EC","x":"5GzHukBSSLNF68uaBVAPv1j7cTortu1O78FnobWhDb4","y":"qRiRyTjbXx1gLiDSYEEsgDHY7FHw_eKLrefAA9kfxQ0","crv":"P-256","kid":"p256-test-2026-09"}]});';
    let publicJwk;
    try { publicJwk = JSON.parse(process.env.ENTITLEMENT_PUBLIC_JWK || ''); }
    catch { throw new Error('Set ENTITLEMENT_PUBLIC_JWK to the Worker signing public JWK before packaging.'); }
    const publicKeys = Array.isArray(publicJwk?.keys) ? publicJwk.keys : [publicJwk];
    const keyIds = new Set();
    const invalidPublicKey = publicKeys.some(key => {
      if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y || key.d ||
          !/^[A-Za-z0-9._-]{1,128}$/.test(key.kid || '') || keyIds.has(key.kid)) return true;
      keyIds.add(key.kid);
      return false;
    });
    if (!publicKeys.length || invalidPublicKey) {
      throw new Error('ENTITLEMENT_PUBLIC_JWK must be a public P-256 JWK or JWKS with unique kid values and no private material.');
    }
    if (!receiptSource.includes(publicKeyLine)) throw new Error('Could not inject the entitlement verification key.');
    fs.writeFileSync(receiptsPath,receiptSource.replace(publicKeyLine,`const PACKAGED_ENTITLEMENT_PUBLIC_JWK = Object.freeze(${JSON.stringify(publicJwk)});`));
    const source = provenance.sourceState(root, items);
    if (process.env.PACKAGE_RELEASE === '1') {
      if (!process.env.EXPECTED_COMMIT || process.env.EXPECTED_COMMIT !== source.commit) {
        throw new Error('Release packaging requires EXPECTED_COMMIT to equal the full current commit.');
      }
      if (source.dirty) throw new Error(`Release packaging refuses changed included files: ${source.changed.join(', ')}`);
    }
    const stagedHashes = provenance.fileHashes(stage, fs.readdirSync(stage));
    const build = {
      schemaVersion: 1,
      sourceCommit: source.commit,
      sourceDirty: source.dirty,
      sourceChanged: source.changed,
      sourceFingerprint: source.fingerprint,
      apiOrigin: apiBaseUrl.origin,
      apiMode: /(?:^|[-.])test(?:[-.]|$)/i.test(apiBaseUrl.hostname) ? 'test' : 'production',
      entitlementKeyIds: [...keyIds].sort(),
      files: stagedHashes,
      stagedFingerprint: provenance.fingerprint(stagedHashes),
    };
    fs.writeFileSync(path.join(stage, 'release-build.json'), `${JSON.stringify(build, null, 2)}\n`);
    const temporary = path.join(stage,'extension.zip');
    execFileSync('zip',['-q','-r',temporary,...fs.readdirSync(stage).filter(name => name !== 'extension.zip')],{cwd:stage});
    fs.copyFileSync(temporary,output);
    const sidecar = { ...build, zipFile: path.basename(output), zipSha256: provenance.sha256(fs.readFileSync(output)) };
    fs.writeFileSync(`${output}.provenance.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
    smokePackage(output, apiPermission);
    console.log(`Created ${output}`);
  } finally { fs.rmSync(stage,{recursive:true,force:true}); }
}
