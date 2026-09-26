/* Pure, shared policy. No storage, DOM, clocks or transport authority here. */
(function (root) {
  "use strict";
  const CONFIG = root.SCReleaseConfig || (typeof require === "function" && require("./release-config.js"));
  const TRIAL_LIMIT = 20;
  const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  const SCHEMA_VERSION = 3;
  const PRO_OPERATIONS = new Set(["export-loop", "export-track-effects", "export-wav", "edit-loop-precise"]);
  const TRIAL_OPERATIONS = new Set(["set-effect", "set-eq", "save-loop-pad", "play-loop-instrument", "explore-likes"]);
  const PLAYBACK_OPERATIONS = new Set(["set-rate", "set-preserve-pitch", "save-preset"]);
  const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 1024;
  const validGeneration = (value) => Number.isSafeInteger(value) && value >= 0;
  const validTimestamp = (value) => Number.isSafeInteger(value) && value >= 0;

  function invalidState() {
    return Object.assign(new Error("Invalid Player Tools access record"), { code: "access-state-invalid" });
  }

  function normalize(raw) {
    // Only absence initializes a trial. Corrupt/future records must never reset it.
    if (raw === undefined) raw = { schemaVersion: SCHEMA_VERSION, trial: { used: 0, grants: [], warnedLastUse: false, startedAt: null, expiresAt: null } };
    // Version 1 had the lifetime loop allowance but no clock.  Preserve every
    // receipt and let the next eligible surface start this version's trial.
    const sourceVersion = raw?.schemaVersion;
    if (!raw || ![1, 2, SCHEMA_VERSION].includes(sourceVersion) || !raw.trial ||
        !Number.isInteger(raw.trial.used) || raw.trial.used < 0 || raw.trial.used > TRIAL_LIMIT ||
        !Array.isArray(raw.trial.grants) || raw.trial.grants.length > TRIAL_LIMIT ||
        typeof raw.trial.warnedLastUse !== "boolean" ||
        (raw.revision !== undefined && !validGeneration(raw.revision)) ||
        (raw.entitlement !== undefined && !["active", "free"].includes(raw.entitlement?.status))) throw invalidState();
    const startedAt = sourceVersion === 1 ? null : raw.trial.startedAt;
    const expiresAt = sourceVersion === 1 ? null : raw.trial.expiresAt;
    if (!((startedAt === null && expiresAt === null) ||
      (validTimestamp(startedAt) && validTimestamp(expiresAt) && expiresAt === startedAt + TRIAL_DURATION_MS))) throw invalidState();
    const sessions = new Set();
    const requests = new Set();
    const owners = new Set();
    const grants = raw.trial.grants.map((grant) => {
      if (!grant || !validId(grant.sessionId) || !validId(grant.ownerKey) ||
          !validId(grant.trackIdentity) || !validGeneration(grant.generation) ||
          (grant.active !== undefined && typeof grant.active !== "boolean") ||
          (grant.requestId !== undefined && !validId(grant.requestId)) || sessions.has(grant.sessionId)) throw invalidState();
      const active = grant.active !== false;
      const requestKey = JSON.stringify([grant.ownerKey, grant.requestId]);
      if ((active && owners.has(grant.ownerKey)) || (grant.requestId && requests.has(requestKey))) throw invalidState();
      sessions.add(grant.sessionId);
      if (active) owners.add(grant.ownerKey);
      if (grant.requestId) requests.add(requestKey);
      return { sessionId: grant.sessionId, ownerKey: grant.ownerKey, trackIdentity: grant.trackIdentity,
        generation: grant.generation, active, ...(grant.requestId ? { requestId: grant.requestId } : {}) };
    });
    if (grants.length > raw.trial.used) throw invalidState();
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: raw.revision ?? 0,
      entitlement: raw.entitlement?.status === "active"
        ? { status: "active", licenseId: typeof raw.entitlement.licenseId === "string" ? raw.entitlement.licenseId : "",
          checkedAt: validGeneration(raw.entitlement.checkedAt) ? raw.entitlement.checkedAt : 0,
          expiresAt: validTimestamp(raw.entitlement.expiresAt) ? raw.entitlement.expiresAt :
            (sourceVersion < 3 ? 0 : (() => { throw invalidState(); })()),
          // The access record is a cache.  The service-worker verifier checks
          // this receipt before granting any PRO operation.
          receipt: raw.entitlement.receipt && typeof raw.entitlement.receipt === "object"
            ? { algorithm: raw.entitlement.receipt.algorithm, keyId: raw.entitlement.receipt.keyId,
              payload: raw.entitlement.receipt.payload, signature: raw.entitlement.receipt.signature }
            : null }
        : { status: "free" },
      trial: { limit: TRIAL_LIMIT, used: raw.trial.used, warnedLastUse: raw.trial.warnedLastUse, startedAt, expiresAt, grants,
        receipt: raw.trial.receipt && typeof raw.trial.receipt === "object"
          ? { algorithm: raw.trial.receipt.algorithm, keyId: raw.trial.receipt.keyId,
            payload: raw.trial.receipt.payload, signature: raw.trial.receipt.signature }
          : null },
    };
  }

  function startTrial(raw, now) {
    const state = normalize(raw);
    if (!validTimestamp(now)) throw invalidState();
    if (state.entitlement.status === "active" || state.trial.startedAt !== null) return state;
    state.trial.startedAt = now;
    state.trial.expiresAt = now + TRIAL_DURATION_MS;
    return state;
  }

  function snapshot(raw, ownerKey, now = Date.now()) {
    const state = normalize(CONFIG?.FREE_PRO_ENABLED ? undefined : raw);
    if (!validTimestamp(now)) throw invalidState();
    const grant = state.trial.grants.find((item) => item.active && item.ownerKey === ownerKey);
    const pro = CONFIG?.FREE_PRO_ENABLED || (state.entitlement.status === "active" && now < state.entitlement.expiresAt);
    const started = state.trial.startedAt !== null;
    const expired = started && now >= state.trial.expiresAt;
    const trialAvailable = started && !expired && state.trial.used < TRIAL_LIMIT;
    // Likes Explorer is a seven-day onboarding capability.  It deliberately
    // does not consume, nor is it shortened by, the separate 20-loop trial.
    const likesExplorerTrialAvailable = started && !expired;
    // Only the owner of the twentieth granted loop keeps the existing grace.
    const finalLoopGrace = !pro && state.trial.used === TRIAL_LIMIT && Boolean(grant);
    const playback = pro || trialAvailable || finalLoopGrace;
    const remainingMs = started && !expired ? state.trial.expiresAt - now : 0;
    return {
      revision: state.revision,
      plan: pro ? "pro" : "free",
      state: pro ? "pro" : finalLoopGrace ? "trial_last_session" : !started ? "trial_not_started" : expired ? "trial_expired" : trialAvailable ? "trial_available" : "free_locked",
      used: state.trial.used, limit: TRIAL_LIMIT, remaining: TRIAL_LIMIT - state.trial.used,
      warnedLastUse: state.trial.warnedLastUse,
      trial: { startedAt: state.trial.startedAt, expiresAt: state.trial.expiresAt, expired,
        daysRemaining: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
        isLastDay: remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1000 },
      grant: grant ? { sessionId: grant.sessionId, trackIdentity: grant.trackIdentity, generation: grant.generation } : null,
      capabilities: {
        openPanel: true, beginLoop: pro || (trialAvailable && !grant), editLoop: playback,
        tempo: playback, preservePitch: playback, savePreset: playback,
        maximizeLooper: playback, editLoopPrecise: pro, exportLoop: pro, exportTrackEffects: pro,
        likesExplorer: pro || likesExplorerTrialAvailable, parametricEq: pro || likesExplorerTrialAvailable,
        freeEffects: true, premiumEffects: pro || likesExplorerTrialAvailable,
        saveLoopPad: pro || likesExplorerTrialAvailable, loopInstrument: pro || likesExplorerTrialAvailable,
      },
    };
  }

  function canAuthorize(raw, ownerKey, operation, sessionId, now = Date.now()) {
    const result = (allowed, reason = null, consume = false) => ({ allowed, consume, reason });
    if (operation === "set-free-effect") return result(true);
    if (!PRO_OPERATIONS.has(operation) && !PLAYBACK_OPERATIONS.has(operation) && !TRIAL_OPERATIONS.has(operation) &&
        operation !== "begin-loop" && operation !== "edit-loop" && operation !== "explore-likes") return result(false, "unknown-operation");
    const current = snapshot(raw, ownerKey, now);
    if (current.plan === "pro") return result(true);
    if (TRIAL_OPERATIONS.has(operation)) {
      return current.capabilities.likesExplorer
        ? result(true)
        : result(false, current.trial.expired ? "trial-expired" : "pro-required");
    }
    if (PRO_OPERATIONS.has(operation)) return result(false, "pro-required");
    if (operation === "edit-loop") return current.capabilities.editLoop && current.grant && current.grant.sessionId === sessionId
      ? result(true) : result(false, "stale-generation");
    if (operation === "begin-loop") {
      if (current.grant) return current.grant.sessionId === sessionId
        ? current.capabilities.editLoop ? result(true) : result(false, current.trial.expired ? "trial-expired" : "trial-exhausted")
        : result(false, "session-active");
      if (sessionId) return result(false, "stale-generation");
      return current.capabilities.beginLoop ? result(true, null, true) : result(false, current.trial.expired ? "trial-expired" : "trial-exhausted");
    }
    return current.capabilities.tempo ? result(true) : result(false, current.trial.expired ? "trial-expired" : "trial-exhausted");
  }

  function validateLoopRequest(request) {
    const payload = request?.payload;
    if (!validId(request?.requestId)) return "invalid-request";
    if (!validId(payload?.trackIdentity) || !validGeneration(request.expectedGeneration) ||
        payload.generation !== request.expectedGeneration) return "stale-generation";
    if (![payload.startMs, payload.endMs, payload.durationMs].every(Number.isFinite) ||
        payload.startMs < 0 || payload.endMs - payload.startMs < 250 ||
        payload.endMs > payload.durationMs) return "invalid-range";
    return null;
  }

  const api = { FREE_PRO_ENABLED: CONFIG?.FREE_PRO_ENABLED === true, TRIAL_LIMIT, TRIAL_DURATION_MS, SCHEMA_VERSION, normalize, startTrial, snapshot, canAuthorize, validateLoopRequest };
  root.SCPlayerToolsPolicy = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
