const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const TRACK_URL =
  process.env.SCDL_LIVE_TRACK_URL || "https://soundcloud.com/forss/flickermood";
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;
const useSelectedDirectory = process.argv.includes("--folder");
const SELECTED_DIRECTORY_ID = "live-loop-directory";

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

async function waitForDownloadedFile(directory, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const files = await fs.readdir(directory);
    const complete = files.find(
      (fileName) => fileName.endsWith(".wav") && !fileName.endsWith(".crdownload")
    );
    if (complete) return path.join(directory, complete);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No completed loop WAV appeared before timeout.");
}

async function configureSelectedDirectory(extensionPage) {
  await extensionPage.evaluate(async (directoryId) => {
    const handle = await navigator.storage.getDirectory();
    const request = indexedDB.open("scdl_download_directories", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("handles")) {
        request.result.createObjectStore("handles");
      }
    };
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, directoryId);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    await chrome.storage.local.set({
      downloadDestination: { id: directoryId, name: "Live test folder" },
    });
  }, SELECTED_DIRECTORY_ID);
}

async function readSelectedDirectoryWav(extensionPage) {
  return extensionPage.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".wav")) continue;
      const file = await handle.getFile();
      const header = new Uint8Array(await file.slice(0, 44).arrayBuffer());
      return { name, size: file.size, header: Array.from(header) };
    }
    return null;
  });
}

async function describeLooper(page) {
  return page.evaluate(() => {
    const button = document.querySelector("[data-scdl-looper]");
    const download = document.querySelector("[data-scdl-loop-download]");
    return {
      url: location.href,
      title: document.title,
      debug: document.documentElement.getAttribute("data-scdl-looper-debug"),
      loopButton: button
        ? {
            title: button.title,
            disabled: button.getAttribute("aria-disabled"),
            active: button.getAttribute("aria-pressed"),
          }
        : null,
      downloadButton: download
        ? {
            title: download.title,
            state: download.dataset.scdlLoopDownloadState,
          }
        : null,
      sliders: Array.from(document.querySelectorAll('[role="slider"]')).map(
        (element) => ({
          tag: element.tagName,
          className: String(element.className || "").slice(0, 180),
          label: element.getAttribute("aria-label"),
          valueMax: element.getAttribute("aria-valuemax"),
        })
      ),
      menuCandidates: Array.from(
        document.querySelectorAll('button[aria-haspopup="true"]')
      ).map((element) => ({
        className: String(element.className || "").slice(0, 180),
        label: element.getAttribute("aria-label"),
        title: element.getAttribute("title"),
        text: String(element.textContent || "").trim().slice(0, 80),
      })),
      waveformCandidates: Array.from(
        document.querySelectorAll('[class*="waveform" i], canvas')
      )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: String(element.className || "").slice(0, 180),
            label: element.getAttribute("aria-label"),
            role: element.getAttribute("role"),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((element) => element.width > 100 && element.height > 20),
      waveformHtml:
        document.querySelector(".waveform.loaded")?.outerHTML.slice(0, 12000) || null,
      playerAreaHtml:
        document.querySelector(".fullHero__playerArea")?.outerHTML.slice(0, 8000) ||
        null,
      playCandidates: Array.from(
        document.querySelectorAll('[class*="play" i], button[title*="Play" i]')
      )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: String(element.className || "").slice(0, 220),
            label: element.getAttribute("aria-label"),
            title: element.getAttribute("title"),
            text: String(element.textContent || "").trim().slice(0, 80),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((element) => element.width > 0 && element.height > 0),
      waveformAncestors: (() => {
        const ancestors = [];
        let element = document.querySelector(".waveform.loaded");
        while (element && ancestors.length < 8) {
          ancestors.push({
            tag: element.tagName,
            id: element.id,
            className: String(element.className || "").slice(0, 240),
            attributes: Object.fromEntries(
              Array.from(element.attributes)
                .filter((attribute) =>
                  /^(aria-|data-|role|title)/.test(attribute.name)
                )
                .map((attribute) => [attribute.name, attribute.value])
            ),
          });
          element = element.parentElement;
        }
        return ancestors;
      })(),
      frames: Array.from(document.querySelectorAll("iframe")).map((frame) => ({
        src: frame.src ? new URL(frame.src).origin + new URL(frame.src).pathname : "",
        title: frame.title,
      })),
    };
  });
}

async function startTrackPlayback(page) {
  const candidates = page.locator(
    ".soundTitle__playButton a.playButton, a.playButton, .fullHero__playerArea button, button.sc-button-play:not(.disabled), button.playButton:not(.disabled)"
  );
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      await candidate.click({ force: true });
      return;
    }
  }
  throw new Error("Could not find the track play button.");
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "scdl-live-loop-"));
  const downloads = path.join(profile, "downloads");
  const artifactDirectory = path.join(root, "test-results", "live-looper");
  await fs.mkdir(downloads);
  await fs.mkdir(artifactDirectory, { recursive: true });

  const context = await chromium.launchPersistentContext(profile, {
    headless: process.env.SCDL_HEADED !== "1",
    channel: "chromium",
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
    acceptDownloads: true,
  });
  let page = null;
  let extensionPage = null;
  let passed = false;
  const diagnostics = [];

  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const worker =
      context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    worker.on("console", (message) => {
      if (message.type() === "error") diagnostics.push(`worker: ${message.text()}`);
    });

    if (useSelectedDirectory) {
      const extensionId = new URL(worker.url()).host;
      extensionPage = await context.newPage();
      await extensionPage.goto(`chrome-extension://${extensionId}/offscreen.html`);
      await configureSelectedDirectory(extensionPage);
      // Avoid keeping a second offscreen listener alive while the download runs.
      await extensionPage.goto(`chrome-extension://${extensionId}/index.html`);
    }

    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.text().includes("SCDL")) {
        diagnostics.push(`page:${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on("requestfailed", (request) => {
      if (/soundcloud|sndcdn/.test(request.url())) {
        diagnostics.push(
          `requestfailed: ${request.method()} ${redactUrl(request.url())} ${request.failure()?.errorText || ""}`
        );
      }
    });

    if (!useSelectedDirectory) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
      });
    }
    await page.goto(TRACK_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const consent = page.locator("#onetrust-consent-sdk");
    if (await consent.isVisible({ timeout: 10000 }).catch(() => false)) {
      const cookieButton = consent
        .locator("button")
        .filter({ hasText: /^(Acepto|Accept All|Aceptar todo)$/i })
        .first();
      await cookieButton.click({ force: true, timeout: 10000 });
      await consent.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    }

    const modalCloseButton = page
      .locator(
        'button[aria-label="Close"], button[aria-label="Cerrar"], button[title="Close"], button[title="Cerrar"], .modal__closeButton'
      )
      .filter({ visible: true })
      .first();
    if (await modalCloseButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await modalCloseButton.click();
    }

    const loopButton = page.locator("[data-scdl-looper]");
    await loopButton.waitFor({ state: "visible", timeout: 30000 });
    if ((await loopButton.getAttribute("aria-disabled")) === "true") {
      await startTrackPlayback(page);
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-scdl-looper]")
            ?.getAttribute("aria-disabled") !== "true",
        null,
        { timeout: 30000 }
      );
    }

    await loopButton.evaluate((button) => button.click());
    const overlay = page.locator("[data-scdl-loop-overlay]");
    await overlay.waitFor({ state: "visible", timeout: 30000 });
    const startMarker = overlay.locator('[data-marker="start"]');
    const endMarker = overlay.locator('[data-marker="end"]');
    const startMs = Number(await startMarker.getAttribute("aria-valuenow"));
    const initialEndMs = Number(await endMarker.getAttribute("aria-valuenow"));
    if (initialEndMs - startMs > 1250) await endMarker.press("Shift+ArrowLeft");
    const endMs = Number(await endMarker.getAttribute("aria-valuenow"));
    assert.ok(endMs > startMs, "The live A-B selection is invalid.");

    const downloadButton = page.locator("[data-scdl-loop-download]");
    await downloadButton.evaluate((button) => button.click());
    await page.waitForFunction(
      () =>
        /success|error/.test(
          document.querySelector("[data-scdl-loop-download]")?.dataset
            .scdlLoopDownloadState || ""
        ),
      null,
      { timeout: DOWNLOAD_TIMEOUT_MS }
    );
    assert.equal(
      await downloadButton.getAttribute("data-scdl-loop-download-state"),
      "success",
      (await downloadButton.getAttribute("title")) || "Live loop download failed."
    );

    let downloadedName;
    let wav;
    if (useSelectedDirectory) {
      const savedFile = await readSelectedDirectoryWav(extensionPage);
      assert.ok(savedFile, "No completed loop WAV appeared in the selected folder.");
      downloadedName = savedFile.name;
      wav = Buffer.from(savedFile.header);
      assert.ok(savedFile.size >= 44, "The selected-folder WAV is incomplete.");
    } else {
      const downloadedFile = await waitForDownloadedFile(downloads, DOWNLOAD_TIMEOUT_MS);
      downloadedName = path.basename(downloadedFile);
      wav = await fs.readFile(downloadedFile);
    }
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    const sampleRate = wav.readUInt32LE(24);
    const blockAlign = wav.readUInt16LE(32);
    const dataSize = wav.readUInt32LE(40);
    const actualDurationMs = (dataSize / blockAlign / sampleRate) * 1000;
    assert.ok(
      Math.abs(actualDurationMs - (endMs - startMs)) <= 2,
      `Expected ${endMs - startMs}ms, downloaded ${actualDurationMs}ms.`
    );

    passed = true;
    console.log(
      `Live looper${useSelectedDirectory ? " selected-folder" : ""} passed: ${downloadedName} (${actualDurationMs} ms)`
    );
  } catch (error) {
    if (page) {
      await page.screenshot({
        path: path.join(artifactDirectory, "failure.png"),
        fullPage: true,
      }).catch(() => {});
      const state = await describeLooper(page).catch(() => null);
      await fs.writeFile(
        path.join(artifactDirectory, "diagnostics.json"),
        JSON.stringify({ state, diagnostics: diagnostics.slice(-100) }, null, 2)
      );
    }
    throw error;
  } finally {
    await context.tracing
      .stop(
        passed
          ? undefined
          : { path: path.join(artifactDirectory, "trace.zip") }
      )
      .catch(() => {});
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
