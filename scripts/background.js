importScripts(
  "release-config.js",
  "i18n.js",
  "format-utils.js",
  "player-tools-policy.js",
  "player-tools-access.js",
  "player-tools-receipts.js",
  "player-tools-commerce.js",
  "download-analytics.js",
  "directory-storage.js",
  "soundcloud-http.js",
  "stream-selector.js",
  "download-track.js",
  "download-policy.js",
  "download-source.js",
  "download-destination.js",
  "track-download-execution.js",
  "bulk-library.js",
  "spectral-waveform.js",
  "bulk-job-manager.js",
  "stem-jobs.js",
  "stem-recording-jobs.js",
  "soundcloud-likes-source.js",
  "likes-library.js",
  "likes-jobs.js"
);

const t = globalThis.SCDLI18n?.t || ((key) => key);

function trackDirectDownloadResult(type, result) {
  const event = globalThis.SCDirectDownloadAnalytics?.terminalEvent(type, result);
  if (event) playerToolsCommerce.track("download_job_completed", event.properties, event.options).catch(() => {});
}

const playerToolsAccess = globalThis.SCPlayerToolsAccess || {
  configureAuthority() {},
  async startTrial() { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
  async getSnapshot() { return { status: "free", plan: "free" }; },
  async authorize() { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
  async endSession() {},
  async endTab() {},
};

const UNINSTALL_FEEDBACK_URL = "https://sctd.vpugliese.online/";
const INSTALL_LIKES_URL = "https://soundcloud.com/you/likes";
const playerToolsCommerce = globalThis.SCPlayerToolsCommerce?.create
  ? globalThis.SCPlayerToolsCommerce.create({
      storage: chrome.storage.local,
      identityStorage: chrome.storage.local,
      legacyIdentityStorage: chrome.storage.sync,
      sessionStorage: chrome.storage.session,
      alarms: chrome.alarms,
      access: playerToolsAccess,
      version: chrome.runtime.getManifest().version,
    })
  // Narrow fallback for legacy verification harnesses that stub importScripts.
  : {
      getState: async () => ({ status: "free", canCheckout: false }),
      startCheckout: async () => { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
      claimCheckout: async () => { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
      activate: async () => { throw Object.assign(new Error("Player Tools licensing is unavailable."), { code: "service-unavailable" }); },
      startTrial: async () => { throw Object.assign(new Error("Trial service is unavailable."), { code: "service-unavailable" }); },
      consumeTrial: async () => { throw Object.assign(new Error("Trial service is unavailable."), { code: "service-unavailable" }); },
      track: async () => false,
    };
playerToolsAccess.configureAuthority?.({
  startTrial: () => playerToolsCommerce.startTrial(),
  consumeTrial: (value) => playerToolsCommerce.consumeTrial(value),
  validateEntitlement: (value) => playerToolsCommerce.validateEntitlement(value),
  ensureEntitlement: (value) => playerToolsCommerce.ensureEntitlement(value),
  validateTrial: (value) => playerToolsCommerce.validateTrial(value),
});
playerToolsCommerce.getState({ revalidate: true }).catch(() => {});
BulkJobManager.recoverDirectOperations?.().catch(() => {});

async function configureUninstallFeedback() {
  const url = new URL(UNINSTALL_FEEDBACK_URL);
  url.searchParams.set("view", "goodbye");
  url.searchParams.set("locale", chrome.i18n.getUILanguage());
  url.searchParams.set("version", chrome.runtime.getManifest().version);
  await chrome.runtime.setUninstallURL(url.toString());
}

async function openInstallLikes() {
  await playerToolsAccess.startTrial();
  await chrome.tabs.create({ url: INSTALL_LIKES_URL });
}

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get(
      { url: "https://soundcloud.com", name: "oauth_token" },
      (cookie) =>
        cookie?.value
          ? resolve(cookie.value)
          : reject(Object.assign(new Error("No oauth_token cookie"), { code: "auth_required" }))
    );
  });
}

const downloadPolicy = globalThis.SCDownloadPolicy?.create({
  storage: chrome.storage.local,
  apiBaseUrl: globalThis.SCPlayerToolsCommerce?.API_BASE_URL,
  request: (url, options) => fetch(url, options),
});
const downloadSource = SCDownloadSource.configure({
  request: (url, options) => fetch(url, options),
  getOAuthToken,
  getDownloadPolicy: () => downloadPolicy?.getPolicy() || { allDownloadsActivated: false },
});

const likesJobs = globalThis.SCLikesJobs?.create({ getToken: getOAuthToken, resolveUser: clientId => downloadSource.resolveLoggedInUser(clientId), access: playerToolsAccess });
chrome.cookies.onChanged?.addListener(change => {
  if (change.cookie.name !== 'oauth_token' || !/(^|\.)soundcloud\.com$/.test(change.cookie.domain.replace(/^\./, ''))) return;
  likesJobs?.invalidate();
  chrome.tabs.query({ url: 'https://soundcloud.com/*' })
    .then(tabs => Promise.allSettled(tabs
      .filter(tab => Number.isInteger(tab.id))
      .map(tab => chrome.tabs.sendMessage(tab.id, { type: 'SOUNDCLOUD_AUTH_CHANGED' }))))
    .catch(() => {});
});
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes['scdl.playerTools.access.v1']) likesJobs?.invalidate();
});

function errorResponse(error, fallback = t("download_failed")) {
  return {
    success: false,
    error: error?.message || fallback,
    code: error?.code || "unknown_error",
    status: error?.status,
    retryAt: error?.retryAt,
  };
}

function respond(promise, sendResponse, project = (value) => value) {
  promise
    .then((value) => sendResponse({ success: true, ...project(value) }))
    .catch((error) => sendResponse(errorResponse(error)));
  return true;
}

function hasEffectivePlaybackTransform(transform) {
  if (!transform || typeof transform !== "object") return false;
  const rate = Number(transform.rate);
  return Number.isFinite(rate) && Math.abs(rate - 1) > 0.0001;
}

function hasEffectiveEffects(effects) {
  if (!effects || typeof effects !== "object" || effects.bypassed === true) return false;
  if (["reverb", "delay", "flanger", "phaser", "bitcrusher", "saturation"]
    .some((name) => Number(effects[name]) > 0)) return true;
  const eq = effects.eq;
  return eq?.enabled === true && (eq.hardClip === true ||
    (Array.isArray(eq.bands) && eq.bands.some((band) => band?.type !== "peaking" || Number(band?.gain) !== 0)));
}

function isSoundCloudTopFrameSender(sender) {
  if (sender?.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) {
    return false;
  }
  try {
    const url = new URL(sender.url || sender.tab.url);
    return url.origin === "https://soundcloud.com";
  } catch {
    return false;
  }
}

const INSTRUMENT_OPERATIONS_KEY = "scdl.instrument.operations.v1";
const INSTRUMENT_OPERATION_TTL_MS = 5 * 60 * 1000;
const instrumentOperations = new Map();
const instrumentRenderPromises = new Map();
let instrumentOperationsLoaded = false;
let instrumentOperationQueue = Promise.resolve();

function instrumentOwner(sender) {
  return {
    tabId: sender?.tab?.id,
    frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0,
    documentId: typeof sender?.documentId === "string" ? sender.documentId : null,
  };
}

function sameInstrumentOwner(left, right) {
  return left?.tabId === right?.tabId && left?.frameId === right?.frameId &&
    left?.documentId === right?.documentId;
}

function withInstrumentOperationState(action) {
  const run = instrumentOperationQueue.then(action);
  instrumentOperationQueue = run.then(() => {}, () => {});
  return run;
}

async function loadInstrumentOperations() {
  if (instrumentOperationsLoaded) return;
  instrumentOperationsLoaded = true;
  const stored = await chrome.storage.session.get(INSTRUMENT_OPERATIONS_KEY).catch(() => ({}));
  for (const record of stored?.[INSTRUMENT_OPERATIONS_KEY] || []) {
    if (record && typeof record.id === "string") instrumentOperations.set(record.id, record);
  }
}

function pruneInstrumentOperations() {
  const cutoff = Date.now() - INSTRUMENT_OPERATION_TTL_MS;
  for (const [id, record] of instrumentOperations) {
    if (!Number.isFinite(record.updatedAt) || record.updatedAt < cutoff) instrumentOperations.delete(id);
  }
  while (instrumentOperations.size > 100) {
    instrumentOperations.delete(instrumentOperations.keys().next().value);
  }
}

async function persistInstrumentOperations() {
  await chrome.storage.session.set({
    [INSTRUMENT_OPERATIONS_KEY]: [...instrumentOperations.values()],
  });
}

function instrumentRequestSignature(request) {
  return JSON.stringify({
    fullTrack: request.fullTrack === true,
    trackUrl: request.trackUrl || null,
    trimRange: request.trimRange || null,
    playbackTransform: request.playbackTransform || null,
    effects: request.effects || null,
    name: request.name || null,
  });
}

async function beginInstrumentOperation(request, sender) {
  return withInstrumentOperationState(async () => {
    await loadInstrumentOperations();
    pruneInstrumentOperations();
    const id = request.operationId;
    if (typeof id !== "string" || !/^instrument_[A-Za-z0-9_-]{8,100}$/.test(id)) {
      throw Object.assign(new Error("Invalid instrument operation."), { code: "invalid_operation" });
    }
    const owner = instrumentOwner(sender);
    const signature = instrumentRequestSignature(request);
    const existing = instrumentOperations.get(id);
    if (existing && (!sameInstrumentOwner(existing.owner, owner) || existing.signature !== signature)) {
      throw Object.assign(new Error("Instrument operation ID conflict."), { code: "operation_conflict" });
    }
    if (existing?.state === "cancelled") {
      throw Object.assign(new Error("Instrument preparation cancelled."), { code: "instrument_cancelled", name: "AbortError" });
    }
    const record = existing || { id, owner, signature, state: "pending", updatedAt: Date.now() };
    record.updatedAt = Date.now();
    instrumentOperations.set(id, record);
    await persistInstrumentOperations();
    return record;
  });
}

async function instrumentOperationCancelled(id) {
  return withInstrumentOperationState(async () => {
    await loadInstrumentOperations();
    return instrumentOperations.get(id)?.state === "cancelled";
  });
}

async function finishInstrumentOperation(record) {
  return withInstrumentOperationState(async () => {
    await loadInstrumentOperations();
    const current = instrumentOperations.get(record.id);
    if (current && current.signature === record.signature && sameInstrumentOwner(current.owner, record.owner) &&
        current.state !== "cancelled") {
      instrumentOperations.delete(record.id);
      await persistInstrumentOperations();
    }
  });
}

async function cancelInstrumentOperation(request, sender) {
  const record = await withInstrumentOperationState(async () => {
    await loadInstrumentOperations();
    pruneInstrumentOperations();
    const current = instrumentOperations.get(request.operationId);
    if (!current || !sameInstrumentOwner(current.owner, instrumentOwner(sender))) return null;
    current.state = "cancelled";
    current.updatedAt = Date.now();
    await persistInstrumentOperations();
    return current;
  });
  if (!record) return { success: true, cancelled: false, code: "unknown_operation" };
  await BulkJobManager.cancelLoopInstrument(record.id);
  return { success: true, cancelled: true, code: "instrument_cancelled" };
}

async function renderInstrumentOperation(request, sender) {
  const record = await beginInstrumentOperation(request, sender);
  const existing = instrumentRenderPromises.get(record.id);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const access = await playerToolsAccess.authorize(sender, { operation: "play-loop-instrument" });
      if (!access.allowed) throw new Error("Player Tools Pro is required to play a loop as an instrument.");
      if (await instrumentOperationCancelled(record.id)) {
        throw Object.assign(new Error("Instrument preparation cancelled."), { code: "instrument_cancelled", name: "AbortError" });
      }
      const trackData = await resolveLoopTrack(request, sender);
      if (await instrumentOperationCancelled(record.id)) {
        throw Object.assign(new Error("Instrument preparation cancelled."), { code: "instrument_cancelled", name: "AbortError" });
      }
      return await BulkJobManager.renderLoopInstrument(trackData, request.trimRange,
        request.playbackTransform, request.effects || {}, request.name || `${trackData.title || "Track"} instrument`, request.operationId, {
          fullTrack: request.fullTrack === true,
          onChunk: async (chunk) => {
            if (await instrumentOperationCancelled(record.id)) throw Object.assign(new Error("Instrument preparation cancelled."), { code: "instrument_cancelled" });
            await chrome.tabs.sendMessage(sender.tab.id, { type: "LOOP_INSTRUMENT_CHUNK", operationId: record.id, chunk },
              sender.documentId ? { documentId: sender.documentId } : { frameId: sender.frameId || 0 });
          },
        });
    } finally {
      await finishInstrumentOperation(record).catch(() => {});
    }
  })();
  instrumentRenderPromises.set(record.id, promise);
  promise.finally(() => {
    if (instrumentRenderPromises.get(record.id) === promise) instrumentRenderPromises.delete(record.id);
  }).catch(() => {});
  return promise;
}

async function requestTopFrameLoopTrack(tabId, trackUrl) {
  if (!Number.isInteger(tabId)) {
    throw new Error(t("soundcloud_tab_not_found"));
  }

  const response = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "RESOLVE_LOOP_TRACK_DATA", trackUrl: trackUrl || null },
      { frameId: 0 },
      (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      }
    );
  });

  if (!response?.success || !SCDownloadTrack.canDownload(response.trackData)) {
    throw new Error(
      response?.error || t("resolve_selected_loop_failed")
    );
  }
  return response.trackData;
}

async function resolveLoopTrack(request, sender) {
  if (SCDownloadTrack.canDownload(request.trackData)) {
    return SCDownloadTrack.migrate(request.trackData);
  }
  return requestTopFrameLoopTrack(sender.tab?.id, request.trackUrl);
}

async function openPlayerToolsPanel() {
  await playerToolsAccess.startTrial();
  const tabs = await chrome.tabs.query({ url: "https://soundcloud.com/*" });
  const existing = tabs.find((tab) => tab.active) || tabs[0];
  const tab = existing || await chrome.tabs.create({ url: "https://soundcloud.com/" });
  if (!Number.isInteger(tab.id)) throw new Error("Could not open a SoundCloud tab.");
  if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { type: "OPEN_PLAYER_TOOLS_PANEL" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Open a SoundCloud track, then try Player Tools again."));
        return;
      }
      resolve(response);
    });
  });
  playerToolsCommerce.track("player_tools_opened", { origin: "popup" }).catch(() => {});
  return { tabId: tab.id };
}

const stemJobs = globalThis.SCStemJobs?.create({
  chrome,
  authorize: sender => playerToolsAccess.authorize(sender, { operation: "export-loop" }),
  resolveTrack: resolveLoopTrack,
  render: (...args) => BulkJobManager.renderLoopInstrument(...args),
  cancel: operationId => BulkJobManager.cancelLoopInstrument(operationId),
});
const stemRecordingJobs = globalThis.SCStemRecordingJobs?.create({
  chrome,
  authorize: sender => playerToolsAccess.authorize(sender, { operation: "export-loop" }),
});
stemRecordingJobs?.sweep().catch(error => console.warn("Stem recording cleanup failed", error));
chrome.runtime.onConnect.addListener((port) => {
  if (stemRecordingJobs?.acceptsPort(port.name)) stemRecordingJobs.connect(port);
});

chrome.runtime.onInstalled.addListener((details) => {
  configureUninstallFeedback().catch(() => {});
  BulkJobManager.recoverRunningJob().catch(() => {});
  if (details?.reason === "install") openInstallLikes().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  configureUninstallFeedback().catch(() => {});
  BulkJobManager.recoverRunningJob().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stemJobs?.removeTab(tabId).catch(error => console.warn("Stem session cleanup failed", error));
  stemRecordingJobs?.removeTab(tabId).catch(error => console.warn("Stem recording cleanup failed", error));
  playerToolsAccess.endTab(tabId).catch((error) => console.warn("Player Tools session cleanup failed", error.code));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === globalThis.SCPlayerToolsCommerce?.LICENSE_REVALIDATION_ALARM) {
    playerToolsCommerce.getState({ revalidate: true }).catch(() => {});
  }
  if (alarm.name === 'scdl-likes') likesJobs?.tick().catch(() => {});
  if (alarm.name === BulkJobManager.KEEPALIVE_ALARM) {
    BulkJobManager.ensureJobRunning().catch(() => {});
  }
  if (alarm.name.startsWith(BulkJobManager.RETRY_ALARM_PREFIX)) {
    BulkJobManager.resumeJob(alarm.name.slice(BulkJobManager.RETRY_ALARM_PREFIX.length)).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (stemJobs?.accepts(request.type)) {
    stemJobs.handle(request, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (stemRecordingJobs?.accepts(request.type)) {
    stemRecordingJobs.handle(request, sender).then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }
  if (request.type === "GET_DOWNLOAD_POLICY") {
    return respond(Promise.resolve(downloadPolicy?.getPolicy() || { allDownloadsActivated: false }),
      sendResponse, (policy) => ({ policy }));
  }
  if (["OFFSCREEN_KEEPALIVE", "OFFSCREEN_BUILD_PROGRESS"].includes(request?.type) &&
      (sender?.id !== chrome.runtime.id || sender?.tab ||
       sender?.url !== chrome.runtime.getURL("offscreen.html"))) {
    sendResponse({ success: false, code: "invalid_sender" });
    return false;
  }
  if (request.type === "GET_FORMAT_PREFERENCE") {
    return respond(chrome.storage.local.get(SCStreamSelector.STORAGE_KEY), sendResponse,
      (value) => ({ preference: value[SCStreamSelector.STORAGE_KEY] || "auto" }));
  }
  if (request.type === "SET_FORMAT_PREFERENCE") {
    const preference = SCStreamSelector.normalizePreference(request.preference);
    return respond(chrome.storage.local.set({ [SCStreamSelector.STORAGE_KEY]: preference }), sendResponse);
  }
  if (request.type === "SET_POPUP_START_VIEW") {
    const key = "scdl.popup.startView";
    if (request.view !== null && !["looper", "pro"].includes(request.view)) {
      sendResponse({ success: false, code: "invalid_view" }); return false;
    }
    const action = request.view === null ? chrome.storage.local.remove(key) : chrome.storage.local.set({ [key]: request.view });
    return respond(action, sendResponse);
  }
  if (['GET_LIKES_LIBRARY_STATUS','START_LIKES_INDEX','REFRESH_LIKES_LIBRARY','CANCEL_LIKES_INDEX','QUERY_LIKES','SAVE_LIKES_VIEW','OPEN_LIKED_TRACK','PLAY_LIKED_TRACK','LOCATE_LIKED_TRACK','START_LIKES_ARTWORK','PAUSE_LIKES_ARTWORK','GET_LIKES_ARTWORK','DELETE_LIKES_ARTWORK','DELETE_LIKES_LIBRARY','GET_LIKES_DOWNLOAD_SELECTION'].includes(request.type)) {
    return respond(likesJobs.handle(request, sender), sendResponse);
  }
  if (request.type === "BULK_JOB_UPDATE" && ["completed", "completed_with_errors", "failed", "cancelled", "partial"].includes(request.job?.status)) {
    playerToolsCommerce.track("download_job_completed", {
      type: "bulk", count: Number.isSafeInteger(request.job.completed) ? request.job.completed : 0,
      result: request.job.status,
    }).catch(() => {});
    return false;
  }

  if (request.type === "GET_PLAYER_TOOLS_SNAPSHOT") {
    return respond(playerToolsAccess.getSnapshot(sender), sendResponse, (snapshot) => ({ snapshot }));
  }

  if (request.type === "START_PLAYER_TOOLS_TRIAL") {
    return respond(playerToolsAccess.startTrial(), sendResponse, (snapshot) => ({ snapshot }));
  }

  if (request.type === "GET_PLAYER_TOOLS_COMMERCE") {
    return respond(playerToolsCommerce.getState({ revalidate: request.revalidate === true }), sendResponse, (commerce) => ({ commerce }));
  }

  if (request.type === "START_PLAYER_TOOLS_CHECKOUT") {
    playerToolsCommerce.startCheckout(request.locale)
      .then(async (commerce) => {
        await chrome.tabs.create({ url: commerce.checkoutUrl });
        playerToolsCommerce.track("checkout_started", { surface: request.surface || "popup" }).catch(() => {});
        sendResponse({ success: true, commerce });
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "RESTORE_PLAYER_TOOLS_LICENSE") {
    playerToolsCommerce.activate(request)
      .then((commerce) => {
        playerToolsCommerce.track("license_activated", { result: "active" }).catch(() => {});
        sendResponse({ success: true, commerce });
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "CLAIM_PLAYER_TOOLS_CHECKOUT") {
    playerToolsCommerce.claimCheckout()
      .then((commerce) => {
        if (commerce.status === "active") playerToolsCommerce.track("license_activated", { result: "active" }).catch(() => {});
        sendResponse({ success: true, commerce });
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "TRACK_PLAYER_TOOLS_EVENT") {
    return respond(playerToolsCommerce.track(request.name, request.properties, {
      once: request.once === true, scope: request.scope === "session" ? "session" : "lifetime",
    }), sendResponse, (accepted) => ({ accepted }));
  }

  if (request.type === "AUTHORIZE_PLAYER_TOOLS") {
    const authorization = playerToolsAccess.authorize(sender, request);
    authorization.then((result) => {
      if (!result.allowed && ["pro-required", "trial-expired", "trial-exhausted"].includes(result.code)) {
        playerToolsCommerce.track("paywall_seen", { cause: result.code }, { once: true, scope: "session" }).catch(() => {});
        if (result.code === "pro-required") playerToolsCommerce.track("pro_feature_attempted", { feature: request.operation }).catch(() => {});
      } else if (result.allowed && ["set-rate", "set-effect", "set-preserve-pitch"].includes(request.operation)) {
        playerToolsCommerce.track("player_tools_value_reached", { category: request.operation }, { once: true }).catch(() => {});
      }
    }).catch(() => {});
    return respond(
      authorization,
      sendResponse,
      (result) => result
    );
  }

  if (request.type === "END_PLAYER_TOOLS_SESSION") {
    return respond(
      playerToolsAccess.endSession(sender, request),
      sendResponse,
      (result) => result
    );
  }

  if (request.type === "OFFSCREEN_KEEPALIVE") {
    sendResponse({ success: true });
    return false;
  }

  if (request.type === "OFFSCREEN_BUILD_PROGRESS") {
    return respond(
      BulkJobManager.reportBuildProgress(request.buildId, request.statusText),
      sendResponse,
      (handled) => ({ handled })
    );
  }

  if (request.type === "OPEN_EXTENSION_POPUP") {
    if (typeof chrome.action.openPopup !== "function") {
      sendResponse({
        success: false,
        error: t("open_popup_unsupported"),
      });
      return false;
    }

    const options = sender.tab?.windowId
      ? { windowId: sender.tab.windowId }
      : undefined;
    try {
      Promise.resolve(
        options ? chrome.action.openPopup(options) : chrome.action.openPopup()
      )
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse(errorResponse(error)));
    } catch (error) {
      sendResponse(errorResponse(error));
    }
    return true;
  }

  // Compatibility for content/popup instances that outlive a worker upgrade.
  if (request.type === "GET_MP3_URL" || request.type === "GET_STREAM_URL") {
    return respond(
      downloadSource.resolveDownloadStream(
        SCDownloadTrack.migrate({
          id: request.trackId || /soundcloud:tracks:(\d+)/.exec(request.streamUrl || "")?.[1],
          streamUrl: request.streamUrl,
          clientId: request.clientId,
          trackAuthorization: request.trackAuthorization,
          streamProtocol: request.streamProtocol,
          streamPreset: request.streamPreset,
          streamMimeType: request.streamMimeType,
        })
      ),
      sendResponse
    );
  }

  if (request.type === "GET_ORIGINAL_DOWNLOAD") {
    return respond(
      downloadSource.resolveOriginal(request.trackId, request.clientId),
      sendResponse
    );
  }

  if (request.type === "GET_LOGGED_IN_USER") {
    if (!isSoundCloudTopFrameSender(sender)) {
      sendResponse({ success: false, code: "invalid_sender" });
      return false;
    }
    return respond(
      downloadSource.resolveLoggedInUser(request.clientId),
      sendResponse,
      (profile) => ({ profile: { user: {
        id: profile.user.id,
        username: profile.user.username,
        permalink_url: profile.user.permalink_url,
        avatar_url: profile.user.avatar_url,
        public_likes_count: profile.user.public_likes_count,
        likes_count: profile.user.likes_count,
      } } })
    );
  }

  if (request.type === "GET_AUTH_LIKES_PAGE") {
    if (!isSoundCloudTopFrameSender(sender) ||
        !/^\d+$/.test(String(request.userId)) ||
        typeof request.clientId !== "string" || request.clientId.length > 128 ||
        (request.nextHref != null && (typeof request.nextHref !== "string" || request.nextHref.length > 2048))) {
      sendResponse({ success: false, code: "invalid_sender" });
      return false;
    }
    return respond((async () => {
      const profile = await downloadSource.resolveLoggedInUser(request.clientId);
      const ownerId = String(profile.user.id);
      if (ownerId !== String(request.userId)) {
        throw Object.assign(new Error("SoundCloud session changed."), { code: "session_changed" });
      }
      const cursor = SCLikesSource.cursor(request.nextHref, ownerId);
      const url = new URL(cursor || `https://api-v2.soundcloud.com/users/${ownerId}/likes?limit=50&linked_partitioning=1`);
      url.searchParams.set("client_id", request.clientId);
      const page = await SCSoundCloudHttp.create(fetch).json(url, { oauthToken: profile.oauthToken });
      if (!Array.isArray(page.collection)) {
        throw Object.assign(new Error("SoundCloud returned an invalid likes page."), { code: "invalid_response" });
      }
      return { collection: page.collection, nextHref: SCLikesSource.cursor(page.next_href, ownerId) };
    })(), sendResponse, (page) => ({ page }));
  }

  if (request.type === "START_BULK_JOB") {
    BulkJobManager.createJob(
      request.tracks,
      request.playlistTitle,
      request.playlistMeta || {},
      request.formatPreference || "auto",
      request.downloadDestination ?? null
    )
      .then((job) => sendResponse({ success: true, job }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "START_PAGED_BULK_JOB") {
    const tabId = Number.isInteger(request.tabId) ? request.tabId : sender?.tab?.id;
    BulkJobManager.createPagedJob(
      tabId,
      request.collection,
      request.requestedLimit ?? null,
      request.formatPreference || "auto",
      request.downloadDestination ?? null,
      request.selection || null
    )
      .then((job) => sendResponse({ success: true, job }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "DOWNLOAD_SINGLE_TRACK") {
    const authorization = hasEffectivePlaybackTransform(request.playbackTransform) || hasEffectiveEffects(request.effects)
      ? playerToolsAccess.authorize(sender, { operation: "export-track-effects" })
      : Promise.resolve({ allowed: true });
    authorization
      .then((access) => {
        if (!access.allowed) {
          const error = new Error("Player Tools Pro is required to download a track with playback effects.");
          error.code = access.code || "pro-required";
          throw error;
        }
        return BulkJobManager.downloadSingleTrack(
          request.trackData,
          request.formatPreference || "auto",
          request.downloadDestination ?? null,
          request.playbackTransform || null,
          request.effects || null,
          request.operationId || null
        );
      })
      .then((result) => {
        trackDirectDownloadResult("single", result);
        sendResponse(result);
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "OPEN_PLAYER_TOOLS_PANEL") {
    return respond(openPlayerToolsPanel(), sendResponse);
  }

  if (request.type === "DOWNLOAD_LOOP") {
    playerToolsAccess.authorize(sender, { operation: "export-loop" })
      .then((access) => {
        if (access.allowed) return access;
        const error = new Error("Player Tools Pro is required to export A–B loops.");
        error.code = access.code || "pro-required";
        throw error;
      })
      .then(() => resolveLoopTrack(request, sender))
      .then((trackData) =>
        BulkJobManager.downloadLoop(
          trackData,
          request.formatPreference || trackData.formatPreference || "auto",
          request.trimRange,
          request.playbackTransform || null,
          request.downloadDestination ?? null,
          request.effects || null,
          request.operationId || null
        )
      )
      .then((result) => {
        trackDirectDownloadResult("loop", result);
        sendResponse(result);
      })
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (["RENDER_LOOP_SLICES", "COMMIT_LOOP_SLICES", "CANCEL_LOOP_SLICES"].includes(request.type)) {
    if (sender.id !== chrome.runtime.id || !sender.tab || !/^https:\/\/soundcloud\.com\//.test(sender.url || "")) {
      sendResponse({ success: false, error: "This action is only available on SoundCloud." });
      return false;
    }
    const owner = JSON.stringify(instrumentOwner(sender));
    const operationId = request.operationId;
    if (typeof operationId !== "string" || !/^pad_slice_[A-Za-z0-9_-]{8,80}$/.test(operationId)) {
      sendResponse({ success: false, error: "Invalid slice operation." });
      return false;
    }
    const run = async () => {
      if (request.type === "CANCEL_LOOP_SLICES") {
        return BulkJobManager.padMessage({ type: "OFFSCREEN_SLICES_CANCEL", operationId, owner });
      }
      const access = await playerToolsAccess.authorize(sender, { operation: "save-loop-pad" });
      if (!access.allowed) throw new Error("Player Tools Pro is required to save a loop to pads.");
      if (request.type === "COMMIT_LOOP_SLICES") {
        return BulkJobManager.padMessage({ type: "OFFSCREEN_SLICES_COMMIT", operationId, owner });
      }
      const range = request.trimRange;
      const rate = request.playbackTransform?.rate;
      if (request.count !== 8 || !range || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) ||
          !Number.isFinite(range.durationMs) || range.startMs < 0 || range.endMs <= range.startMs ||
          range.endMs > range.durationMs || !Number.isFinite(rate) || rate < .1 || rate > 4 ||
          (range.endMs - range.startMs) / rate > 30000 ||
          typeof request.trackIdentity !== "string" || request.trackIdentity !== `permalink:${request.trackUrl}` ||
          !/^https:\/\/soundcloud\.com\/[^/]+\/[^/?#]+$/.test(request.trackUrl) ||
          !Number.isSafeInteger(request.generation) || request.generation < 0) {
        throw new Error("Select a loop of up to 30 seconds at the current speed.");
      }
      const effects = { schemaVersion: 2, bypassed: request.effects?.bypassed === true,
        eq: { enabled: false, hardClip: false, bands: [] } };
      for (const field of ["reverb", "delay", "flanger", "phaser", "bitcrusher", "saturation", "reverbSize",
        "reverbDecay", "reverbPreDelay", "reverbTone", "delayTime", "delayFeedback", "delayTone", "flangerRate",
        "flangerDepth", "flangerFeedback", "phaserRate", "phaserDepth", "phaserFeedback", "bitDepth",
        "sampleRateReduction", "saturationDrive", "saturationTone"]) {
        if (request.effects?.[field] === undefined) continue;
        if (!Number.isFinite(request.effects[field])) throw new Error("Invalid effects snapshot.");
        effects[field] = request.effects[field];
      }
      if (typeof request.effects?.reverbRoom === "string") effects.reverbRoom = request.effects.reverbRoom.slice(0, 32);
      const input = {
        count: 8, trackIdentity: request.trackIdentity, generation: request.generation,
        trimRange: { startMs: range.startMs, endMs: range.endMs, durationMs: range.durationMs },
        playbackTransform: { rate: Math.round(rate * 1000) / 1000, preservePitch: request.playbackTransform.preservePitch === true },
        effects, name: String(request.name || "Loop").slice(0, 70),
      };
      // FX are normalized by the shared offline renderer before applying them.
      const begun = await BulkJobManager.padMessage({ type: "OFFSCREEN_SLICES_BEGIN", operationId, owner, input });
      if (!begun?.success || begun.state === "prepared" || begun.pads) return begun;
      try {
        // Resolve only through the SoundCloud content bridge; MAIN cannot supply a stream URL.
        const trackData = await requestTopFrameLoopTrack(sender.tab.id, request.trackUrl);
        return await BulkJobManager.renderLoopSlices(trackData, operationId, owner);
      } catch (error) {
        await BulkJobManager.padMessage({ type: "OFFSCREEN_SLICES_CANCEL", operationId, owner }).catch(() => {});
        throw error;
      }
    };
    run().then(sendResponse).catch(error => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "ANALYZE_WAVEFORM") {
    if (sender.id !== chrome.runtime.id || !sender.tab || !/^https:\/\/soundcloud\.com\//.test(sender.url || "") ||
        typeof request.trackUrl !== "string" || !/^https:\/\/soundcloud\.com\/[^/]+\/[^/?#]+$/.test(request.trackUrl)) {
      sendResponse({ success: false, error: "Invalid waveform request." });
      return false;
    }
    requestTopFrameLoopTrack(sender.tab.id, request.trackUrl)
      .then(track => BulkJobManager.analyzeWaveform(track)).then(sendResponse)
      .catch(error => sendResponse(errorResponse(error)));
    return true;
  }

  if (["SAMPLER_PRESET_LIST", "SAMPLER_PRESET_SAVE", "SAMPLER_PRESET_LOAD", "SAMPLER_PRESET_DELETE", "SAMPLER_PRESET_RENDER",
      "RENDER_LOOP_PAD", "RENDER_LOOP_INSTRUMENT", "CANCEL_LOOP_INSTRUMENT",
      "GET_LOOP_PAD_LIST", "GET_LOOP_PAD_AUDIO", "TRIM_LOOP_PAD_AUDIO", "STORE_LOOP_PAD_AUDIO", "DELETE_LOOP_PAD_AUDIO"].includes(request.type)) {
    if (sender.id !== chrome.runtime.id || !sender.tab || !/^https:\/\/soundcloud\.com\//.test(sender.url || "")) {
      sendResponse({ success: false, error: "This action is only available on SoundCloud." });
      return false;
    }
    if (request.type.startsWith("SAMPLER_PRESET_")) {
      BulkJobManager.padMessage({ type: `OFFSCREEN_${request.type}`, presetId: request.presetId,
        name: request.name, settings: request.settings }).then(sendResponse)
        .catch(error => sendResponse(errorResponse(error)));
      return true;
    }
    if (request.type === "CANCEL_LOOP_INSTRUMENT") {
      cancelInstrumentOperation(request, sender)
        .then(sendResponse)
        .catch((error) => sendResponse(errorResponse(error)));
      return true;
    }
    const index = request.index;
    if (!["GET_LOOP_PAD_LIST", "RENDER_LOOP_INSTRUMENT"].includes(request.type) && (!Number.isInteger(index) || index < 0 || index >= 8)) {
      sendResponse({ success: false, error: "Invalid pad." });
      return false;
    }
    if (request.type === "RENDER_LOOP_PAD" || request.type === "RENDER_LOOP_INSTRUMENT") {
      const duration = Number(request.trimRange?.endMs) - Number(request.trimRange?.startMs);
      const rate = Number(request.playbackTransform?.rate);
      const editableInstrument = request.type === "RENDER_LOOP_INSTRUMENT" && request.fullTrack === true;
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(rate) || rate <= 0 || (!editableInstrument && duration / rate > 30000)) {
        sendResponse({ success: false, error: "Pad samples can be up to 30 seconds long." });
        return false;
      }
      if (request.type === "RENDER_LOOP_INSTRUMENT") {
        renderInstrumentOperation(request, sender)
          .then(sendResponse)
          .catch((error) => sendResponse(errorResponse(error)));
        return true;
      }
      playerToolsAccess.authorize(sender, { operation: "save-loop-pad" })
        .then((access) => {
          if (!access.allowed) throw new Error("Player Tools Pro is required to save a loop to a pad.");
          return resolveLoopTrack(request, sender);
        })
        .then((trackData) => BulkJobManager.renderLoopPad(trackData, index, request.trimRange,
          request.playbackTransform, request.effects || {}, request.name || `${trackData.title || "Track"} loop`, request.operationId))
        .then(sendResponse)
        .catch((error) => sendResponse(errorResponse(error)));
      return true;
    }
    const offscreenRequest = request.type === "GET_LOOP_PAD_LIST"
      ? { type: "OFFSCREEN_PAD_LIST" }
      : request.type === "GET_LOOP_PAD_AUDIO"
        ? { type: "OFFSCREEN_PAD_GET", index, timePercent: request.timePercent, original: request.original === true,
          metadataOnly: request.metadataOnly === true, expectedUpdatedAt: request.expectedUpdatedAt }
        : request.type === "TRIM_LOOP_PAD_AUDIO"
          ? { type: "OFFSCREEN_PAD_TRIM", index, trim: request.trim, expectedUpdatedAt: request.expectedUpdatedAt,
            expectedTrimRevision: request.expectedTrimRevision }
        : request.type === "DELETE_LOOP_PAD_AUDIO"
          ? { type: "OFFSCREEN_PAD_DELETE", index, operationId: request.operationId }
        : { type: "OFFSCREEN_PAD_STORE", index, name: request.name, mimeType: request.mimeType, base64: request.base64, operationId: request.operationId };
    if (request.type === "RENDER_LOOP_PAD") offscreenRequest.operationId = request.operationId;
    BulkJobManager.padMessage(offscreenRequest).then(sendResponse).catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (request.type === "GET_JOB_STATUS") {
    return respond(BulkJobManager.getStatus(), sendResponse);
  }
  if (request.type === "GET_DOWNLOAD_OPERATION") {
    return respond(BulkJobManager.getDownloadOperation(request.operationId), sendResponse,
      (operation) => ({ operation }));
  }
  if (request.type === "PAUSE_BULK_JOB") {
    return respond(BulkJobManager.pauseJob(), sendResponse);
  }
  if (request.type === "RESUME_BULK_JOB") {
    return respond(BulkJobManager.resumeJob(), sendResponse);
  }
  if (request.type === "RETRY_FAILED_BULK_JOB") {
    return respond(BulkJobManager.retryFailedJob(), sendResponse);
  }
  if (request.type === "CANCEL_BULK_JOB") {
    return respond(BulkJobManager.cancelJob(), sendResponse);
  }

  if (request.type === "REFRESH_TRACK") {
    return respond(
      downloadSource.refresh(
        request.trackId,
        request.clientId,
        request.formatPreference || "auto"
      ),
      sendResponse,
      (trackData) => ({ trackData })
    );
  }

  return false;
});
