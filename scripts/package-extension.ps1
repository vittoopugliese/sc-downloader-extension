param(
    [string]$OutputDirectory = "dist",
    # "tools" builds the separate Player Tools listing: downloader hidden, track downloads off.
    [ValidateSet("full", "tools")]
    [string]$Edition = $(if ($env:PACKAGE_EDITION) { $env:PACKAGE_EDITION } else { "full" })
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot "build-icons.cjs") --check
if ($LASTEXITCODE -ne 0) { throw "Icon build is stale. Run npm run build:icons before packaging." }
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -Encoding utf8 $manifestPath | ConvertFrom-Json
$version = $manifest.version
$distributionRoot = Join-Path $projectRoot $OutputDirectory
$stagingRoot = Join-Path $distributionRoot "extension-staging"
$zipBaseName = if ($Edition -eq "tools") { "soundcloud-player-tools" } else { "soundcloud-track-downloader" }
$zipPath = Join-Path $distributionRoot "$zipBaseName-$version.zip"

# This is an allow-list, deliberately separate from the development scripts in
# this directory. Adding a runtime script requires adding it here as well. That
# makes a Chrome upload independent from node_modules, tests and local tooling.
$packageItems = @(
    "manifest.json",
    "popup.html",
    "offscreen.html",
    "stems.html",
    "assets/stems.css",
    "assets/stem-playlist.css",
    "assets/icon-cursors.css",
    "assets/likes-player.css",
    "assets/icon48.png",
    "assets/icon128.png",
    "assets/LooperPlayerToolkit.png",
    "assets/icons/player-toolkit.png",
    "assets/drums",
    "assets/images/default_avatar.png",
    "assets/images/likes-explorer.png",
    "_locales",
    "scripts/icons.js",
    "scripts/icons-client.js",
    "scripts/background.js",
    "scripts/release-config.js",
    "scripts/soundcloud-likes-source.js",
    "scripts/likes-library.js",
    "scripts/likes-jobs.js",
    "scripts/likes-explorer-i18n.js",
    "scripts/likes-explorer.js",
    "scripts/likes-player.js",
    "scripts/soundcloud-playback.js",
    "scripts/soundcloud-likes-locator.js",
    "scripts/likes-popup.js",
    "scripts/audio-effects-core.js",
    "scripts/bitcrusher-processor.js",
    "scripts/parametric-eq.js",
    "scripts/player-tools-collapsible.js",
    "scripts/player-tools-i18n.js",
    "scripts/parametric-eq-ui.js",
    "scripts/record-core.js",
    "scripts/record-ui.js",
    "scripts/record-processor.js",
    "scripts/widget-record-tap.js",
    "scripts/widget-record-source.js",
    "scripts/bulk-library.js",
    "scripts/bulk-job-manager.js",
    "scripts/stem-jobs.js",
    "scripts/stem-recording-jobs.js",
    "scripts/stem-audio.mjs",
    "scripts/stem-model.mjs",
    "scripts/stem-worker.mjs",
    "scripts/stems-page.mjs",
    "scripts/stem-presets.mjs",
    "scripts/stem-library-ui.mjs",
    "scripts/stem-loop.mjs",
    "scripts/stem-sampler.mjs",
    "scripts/stem-pattern-core.mjs",
    "scripts/stem-instruments.mjs",
    "scripts/stem-channel-rack.mjs",
    "scripts/stem-effects.mjs",
    "scripts/stem-module-window.mjs",
    "scripts/stem-rack-overview.mjs",
    "scripts/stem-row-menu.mjs",
    "scripts/stem-sample-browser.mjs",
    "scripts/stem-sample-library.mjs",
    "scripts/stem-sample-preview.mjs",
    "scripts/stem-piano.mjs",
    "scripts/stem-spectrum.mjs",
    "scripts/stem-playlist.mjs",
    "scripts/stem-playlist-core.mjs",
    "scripts/stem-playlist-audio.mjs",
    "scripts/stem-playlist-stretch.mjs",
    "scripts/stem-playlist-worker.mjs",
    "scripts/local-audio-output.mjs",
    "scripts/stem-tone-processor.mjs",
    "scripts/vendor/onnxruntime",
    "scripts/content.js",
    "scripts/contact-content.js",
    "scripts/directory-storage.js",
    "scripts/download-core.js",
    "scripts/download-analytics.js",
    "scripts/download-destination.js",
    "scripts/download-intent.js",
    "scripts/download-policy.js",
    "scripts/download-source.js",
    "scripts/download-track.js",
    "scripts/fast-tooltips.js",
    "scripts/format-utils.js",
    "scripts/i18n.js",
    "scripts/inline-button.js",
    "scripts/looper-core.js",
    "scripts/loop-session.js",
    "scripts/looper-main-bridge.js",
    "scripts/looper.js",
    "scripts/loop-audio-renderer.js",
    "scripts/spectral-waveform.js",
    "scripts/spectral-waveform-stream.js",
    "scripts/metadata.js",
    "scripts/offscreen.js",
    "scripts/page-intake.js",
    "scripts/player-tools-access.js",
    "scripts/player-tools-receipts.js",
    "scripts/player-tools-client.js",
    "scripts/player-tools-commerce.js",
    "scripts/player-tools-policy.js",
    "scripts/popup.js",
    "scripts/soundcloud-http.js",
    "scripts/stream-selector.js",
    "scripts/tempo-control-core.js",
    "scripts/sampler-core.js",
    "scripts/sampler-slices.js",
    "scripts/tempo-control-main.js",
    "scripts/track-download-execution.js",
    "scripts/vendor/id3-writer.js",
    "scripts/vendor/signalsmith/wasm-factory.mjs",
    "THIRD_PARTY_LICENSES.md"
  )

New-Item -ItemType Directory -Force -Path $distributionRoot | Out-Null
if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

foreach ($item in $packageItems) {
    $sourcePath = Join-Path $projectRoot $item
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Required extension package item is missing: $item"
    }

    $destinationPath = Join-Path $stagingRoot $item
    $destinationParent = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse
}

# Directory allow-list entries must not carry OS metadata into the Web Store ZIP.
Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force -File |
    Where-Object { $_.Name -in @(".DS_Store", "Thumbs.db") } |
    Remove-Item -Force

$requiredRuntimeAssets = @(
    "scripts/icons.js",
    "scripts/icons-client.js",
    "assets/icon-cursors.css",
    "assets/LooperPlayerToolkit.png",
    "assets/images/default_avatar.png",
    "assets/images/likes-explorer.png",
    "assets/icons/player-toolkit.png",
    "scripts/record-processor.js"
)
$missingRuntimeAssets = @($requiredRuntimeAssets | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $stagingRoot $_) -PathType Leaf)
})
if ($missingRuntimeAssets.Count -gt 0) {
    throw "Package asset smoke check failed. Missing runtime assets: $($missingRuntimeAssets -join ', ')"
}
$nestedIconsPath = Join-Path $stagingRoot "assets/icons/icons"
if (Test-Path -LiteralPath $nestedIconsPath -PathType Container) {
    throw "Package asset smoke check failed. Icons were copied under assets/icons/icons instead of assets/icons."
}

if ($Edition -eq "tools") {
    # Each switch must exist exactly once, so a refactor cannot silently ship the downloader.
    $editionSwitches = @(
        @{ Path = "scripts/release-config.js"; From = "const DOWNLOADER_ENABLED = true;"; To = "const DOWNLOADER_ENABLED = false;" },
        @{ Path = "scripts/tempo-control-main.js"; From = "const TOOLS_EDITION = false;"; To = "const TOOLS_EDITION = true;" }
    )
    foreach ($switch in $editionSwitches) {
        $switchPath = Join-Path $stagingRoot $switch.Path
        $switchSource = Get-Content -LiteralPath $switchPath -Raw -Encoding utf8
        if (([regex]::Matches($switchSource, [regex]::Escape($switch.From))).Count -ne 1) {
            throw "Could not apply the tools edition switch in $($switch.Path)."
        }
        [System.IO.File]::WriteAllText($switchPath, $switchSource.Replace($switch.From, $switch.To), $utf8NoBom)
    }
}

$commercePath = Join-Path $stagingRoot "scripts/player-tools-commerce.js"
$commerceSource = Get-Content -LiteralPath $commercePath -Raw -Encoding utf8
$apiBaseLine = 'const API_BASE_URL = "https://sctd-test.vpugliese.online/api/player-tools";'
if (-not $commerceSource.Contains($apiBaseLine)) { throw "Could not inject the Player Tools API endpoint." }
if (-not $env:PLAYER_TOOLS_API_BASE_URL) { throw "Set PLAYER_TOOLS_API_BASE_URL to the HTTPS test or production licensing endpoint before packaging." }
try { $apiBaseUri = [System.Uri]$env:PLAYER_TOOLS_API_BASE_URL }
catch { throw "PLAYER_TOOLS_API_BASE_URL must be a valid HTTPS URL." }
if ($apiBaseUri.Scheme -ne "https" -or -not $apiBaseUri.IsAbsoluteUri -or $apiBaseUri.UserInfo -or
    $apiBaseUri.Query -or $apiBaseUri.Fragment -or $apiBaseUri.AbsolutePath.TrimEnd('/') -ne "/api/player-tools") {
    throw "PLAYER_TOOLS_API_BASE_URL must be an HTTPS origin ending in /api/player-tools, without credentials, query or fragment."
}
$normalizedApiBaseUrl = $apiBaseUri.GetLeftPart([System.UriPartial]::Authority) + "/api/player-tools"
$apiBaseLiteral = $normalizedApiBaseUrl | ConvertTo-Json -Compress
$commerceSource = $commerceSource.Replace($apiBaseLine, "const API_BASE_URL = $apiBaseLiteral;")
[System.IO.File]::WriteAllText($commercePath, $commerceSource, $utf8NoBom)

$packagedManifestPath = Join-Path $stagingRoot "manifest.json"
$packagedManifest = Get-Content -LiteralPath $packagedManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$apiPermission = $apiBaseUri.GetLeftPart([System.UriPartial]::Authority) + "/*"
$packagedManifest.host_permissions = @($packagedManifest.host_permissions | Where-Object { $_ -ne "https://sctd-test.vpugliese.online/*" })
if ($packagedManifest.host_permissions -notcontains $apiPermission) {
    $packagedManifest.host_permissions = @($packagedManifest.host_permissions) + $apiPermission
}
# Chrome expects manifest.json without a byte order mark.
[System.IO.File]::WriteAllText($packagedManifestPath, ($packagedManifest | ConvertTo-Json -Depth 20), $utf8NoBom)

$receiptsPath = Join-Path $stagingRoot "scripts/player-tools-receipts.js"
$receiptSource = Get-Content -LiteralPath $receiptsPath -Raw -Encoding utf8
$publicKeyLine = 'const PACKAGED_ENTITLEMENT_PUBLIC_JWK = Object.freeze({"keys":[{"kty":"EC","x":"5GzHukBSSLNF68uaBVAPv1j7cTortu1O78FnobWhDb4","y":"qRiRyTjbXx1gLiDSYEEsgDHY7FHw_eKLrefAA9kfxQ0","crv":"P-256","kid":"p256-test-2026-09"}]});'
if (-not $env:ENTITLEMENT_PUBLIC_JWK) { throw "Set ENTITLEMENT_PUBLIC_JWK before packaging." }
try { $publicJwk = $env:ENTITLEMENT_PUBLIC_JWK | ConvertFrom-Json }
catch { throw "ENTITLEMENT_PUBLIC_JWK must be valid JSON." }
$publicKeys = if ($publicJwk.keys) { @($publicJwk.keys) } else { @($publicJwk) }
$keyIds = @{}
if ($publicKeys.Count -eq 0) { throw "ENTITLEMENT_PUBLIC_JWK must contain at least one public key." }
foreach ($key in $publicKeys) {
    if ($key.kty -ne "EC" -or $key.crv -ne "P-256" -or -not $key.x -or -not $key.y -or $key.d -or
        -not ($key.kid -match '^[A-Za-z0-9._-]{1,128}$') -or $keyIds.ContainsKey($key.kid)) {
        throw "ENTITLEMENT_PUBLIC_JWK must be a public P-256 JWK or JWKS with unique kid values and no private material."
    }
    $keyIds[$key.kid] = $true
}
if (-not $receiptSource.Contains($publicKeyLine)) { throw "Could not inject the entitlement verification key." }
$publicJwkCompact = $publicJwk | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($receiptsPath, $receiptSource.Replace($publicKeyLine, "const PACKAGED_ENTITLEMENT_PUBLIC_JWK = Object.freeze($publicJwkCompact);"), $utf8NoBom)

& node (Join-Path $PSScriptRoot "write-package-provenance.js") stage $stagingRoot $normalizedApiBaseUrl
if ($LASTEXITCODE -ne 0) { throw "Could not write package provenance." }

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
# Compress-Archive on Windows PowerShell writes "\" separators, which the Web Store and
# non-Windows unzip treat as part of the file name. Write portable "/" entries instead.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stagingPrefixLength = (Resolve-Path -LiteralPath $stagingRoot).Path.TrimEnd([char]92).Length + 1
$zipArchive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force -File) {
        $entryName = $file.FullName.Substring($stagingPrefixLength).Replace([char]92, [char]47)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally { $zipArchive.Dispose() }
& node (Join-Path $PSScriptRoot "write-package-provenance.js") sidecar $zipPath $stagingRoot
if ($LASTEXITCODE -ne 0) { throw "Could not write package provenance sidecar." }
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Output "Created $zipPath"
