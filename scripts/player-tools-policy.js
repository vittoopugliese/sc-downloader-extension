/* Pure, shared policy. No storage, DOM, clocks or transport authority here. */
(function (root) {
  "use strict";
  const TRIAL_LIMIT = 20;
  const PRO_OPERATIONS = new Set(["export-loop", "export-track-effects", "edit-loop-precise"]);
  const PLAYBACK_OPERATIONS = new Set(["set-effect", "set-rate", "set-preserve-pitch", "save-preset"]);
  const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 1024;
  const validGeneration = (value) => Number.isSafeInteger(value) && value >= 0;

  function invalidState() {
    return Object.assign(new Error("Invalid Player Tools access record"), { code: "access-state-invalid" });
  }

  function normalize(raw) {
    // Only absence initializes a trial. Corrupt/future records must never reset it.
    if (raw === undefined) raw = { schemaVersion: 1, trial: { used: 0, grants: [], warnedLastUse: false } };
    if (!raw || raw.schemaVersion !== 1 || !raw.trial ||
        !Number.isInteger(raw.trial.used) || raw.trial.used < 0 || raw.trial.used > TRIAL_LIMIT ||
        !Array.isArray(raw.trial.grants) || raw.trial.grants.length > TRIAL_LIMIT ||
        typeof raw.trial.warnedLastUse !== "boolean" ||
        (raw.revision !== undefined && !validGeneration(raw.revision)) ||
        (raw.entitlement !== undefined && !["active", "free"].includes(raw.entitlement?.status))) throw invalidState();
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
      schemaVersion: 1,
      revision: raw.revision ?? 0,
      entitlement: raw.entitlement?.status === "active"
        ? { status: "active", licenseId: typeof raw.entitlement.licenseId === "string" ? raw.entitlement.licenseId : "",
          checkedAt: validGeneration(raw.entitlement.checkedAt) ? raw.entitlement.checkedAt : 0 }
        : { status: "free" },
      trial: { limit: TRIAL_LIMIT, used: raw.trial.used, warnedLastUse: raw.trial.warnedLastUse, grants },
    };
  }

  function snapshot(raw, ownerKey) {
    const state = normalize(raw);
    const grant = state.trial.grants.find((item) => item.active && item.ownerKey === ownerKey);
    const pro = state.entitlement.status === "active";
    const trialAvailable = state.trial.used < TRIAL_LIMIT;
    const playback = pro || trialAvailable || Boolean(grant);
    return {
      revision: state.revision,
      plan: pro ? "pro" : "free",
      state: pro ? "pro" : trialAvailable ? "trial_available" : grant ? "trial_last_session" : "free_locked",
      used: state.trial.used, limit: TRIAL_LIMIT, remaining: TRIAL_LIMIT - state.trial.used,
      warnedLastUse: state.trial.warnedLastUse,
      grant: grant ? { sessionId: grant.sessionId, trackIdentity: grant.trackIdentity, generation: grant.generation } : null,
      capabilities: {
        openPanel: true, beginLoop: pro || (trialAvailable && !grant), editLoop: pro || Boolean(grant),
        tempo: playback, preservePitch: playback, savePreset: playback,
        maximizeLooper: playback, editLoopPrecise: pro, exportLoop: pro, exportTrackEffects: pro,
      },
    };
  }

  function canAuthorize(raw, ownerKey, operation, sessionId) {
    const result = (allowed, reason = null, consume = false) => ({ allowed, consume, reason });
    if (!PRO_OPERATIONS.has(operation) && !PLAYBACK_OPERATIONS.has(operation) &&
        operation !== "begin-loop" && operation !== "edit-loop") return result(false, "unknown-operation");
    const current = snapshot(raw, ownerKey);
    if (current.plan === "pro") return result(true);
    if (PRO_OPERATIONS.has(operation)) return result(false, "pro-required");
    if (operation === "edit-loop") return current.grant && current.grant.sessionId === sessionId
      ? result(true) : result(false, "stale-generation");
    if (operation === "begin-loop") {
      if (current.grant) return current.grant.sessionId === sessionId
        ? result(true) : result(false, "session-active");
      if (sessionId) return result(false, "stale-generation");
      return current.remaining > 0 ? result(true, null, true) : result(false, "trial-exhausted");
    }
    return current.capabilities.tempo ? result(true) : result(false, "trial-exhausted");
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

  const api = { TRIAL_LIMIT, normalize, snapshot, canAuthorize, validateLoopRequest };
  root.SCPlayerToolsPolicy = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
