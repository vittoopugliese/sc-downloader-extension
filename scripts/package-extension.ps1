param(
    [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -Encoding utf8 $manifestPath | ConvertFrom-Json
$version = $manifest.version
$distributionRoot = Join-Path $projectRoot $OutputDirectory
$stagingRoot = Join-Path $distributionRoot "extension-staging"
$zipPath = Join-Path $distributionRoot "soundcloud-track-downloader-$version.zip"

# This is an allow-list, deliberately separate from the development scripts in
# this directory. Adding a runtime script requires adding it here as well. That
# makes a Chrome upload independent from node_modules, tests and local tooling.
$packageItems = @(
    "manifest.json",
    "popup.html",
    "offscreen.html",
    "assets/icon48.png",
    "assets/icon128.png",
    "assets/icons",
    "_locales",
    "scripts/background.js",
    "scripts/bulk-job-manager.js",
    "scripts/content.js",
    "scripts/directory-storage.js",
    "scripts/download-core.js",
    "scripts/download-destination.js",
    "scripts/download-intent.js",
    "scripts/download-source.js",
    "scripts/download-track.js",
    "scripts/format-utils.js",
    "scripts/i18n.js",
    "scripts/inline-button.js",
    "scripts/looper-core.js",
    "scripts/loop-session.js",
    "scripts/looper-main-bridge.js",
    "scripts/looper.js",
    "scripts/loop-audio-renderer.js",
    "scripts/metadata.js",
    "scripts/offscreen.js",
    "scripts/page-intake.js",
    "scripts/popup.js",
    "scripts/soundcloud-http.js",
    "scripts/stream-selector.js",
    "scripts/tempo-control-core.js",
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

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stagingRoot -Force | Select-Object -ExpandProperty FullName) -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Output "Created $zipPath"
