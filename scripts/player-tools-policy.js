/* Player Tools access policy. Kept DOM-free so background and tests share the
 * exact same rules. */
(function (root) {
  "use strict";

  const TRIAL_LIMIT = 20;
  const PRO_OPERATIONS = new Set(["export-loop", "export-track-effects"]);
  const SESSION_OPERATIONS = new Set([
    "edit-loop",
    "set-rate",
    "set-preserve-pitch",
    "save-preset",
  ]);

  function integer(value, fallback = 0) {
    return Number.isInteger(value) ? value : fallback;
  }

  function normalize(raw) {
    const trial = raw && typeof raw === "object" ? raw.trial || {} : {};
    return {
      schemaVersion: 1,
      entitlement: raw?.entitlement?.status === "active"
        ? { status: "active", licenseId: typeof raw.entitlement.licenseId === "string" ? raw.entitlement.licenseId : "", checkedAt: integer(raw.entitlement.checkedAt, 0) }
        : { status: "free" },
      trial: {
        limit: TRIAL_LIMIT,
        used: Math.max(0, Math.min(TRIAL_LIMIT, integer(trial.used))),
        warnedLastUse: trial.warnedLastUse === true,
        grants: Array.isArray(trial.grants) ? trial.grants.filter((grant) => grant && typeof grant.sessionId === "string") : [],
      },
    };
  }

  function ownGrant(state, ownerKey) {
    return state.trial.grants.find((grant) => grant.ownerKey === ownerKey) || null;
  }

  function snapshot(raw, ownerKey) {
    const state = normalize(raw);
    const grant = ownGrant(state, ownerKey);
    const pro = state.entitlement.status === "active";
    const trialAvailable = state.trial.used < state.trial.limit;
    const sessionActive = Boolean(grant);
    const capabilities = {
      openPanel: true,
      beginLoop: pro || trialAvailable,
      editLoop: pro || sessionActive,
      tempo: pro || sessionActive,
      preservePitch: pro || sessionActive,
      savePreset: pro || sessionActive,
      exportLoop: pro,
      exportTrackEffects: pro,
    };
    const stateName = pro
      ? "pro"
      : sessionActive && !trialAvailable
        ? "trial_last_session"
        : trialAvailable
          ? "trial_available"
          : "free_locked";
    return {
      plan: pro ? "pro" : "free",
      state: stateName,
      used: state.trial.used,
      limit: state.trial.limit,
      remaining: state.trial.limit - state.trial.used,
      warnedLastUse: state.trial.warnedLastUse,
      grant: grant ? {
        sessionId: grant.sessionId,
        trackIdentity: grant.trackIdentity || null,
        generation: integer(grant.generation, 0),
      } : null,
      capabilities,
    };
  }

  function canAuthorize(raw, ownerKey, operation, sessionId) {
    // Live FX act on the current player independently of loop trial sessions.
    if (operation === "set-effect") return { allowed: true, consume: false, reason: null };
    const current = snapshot(raw, ownerKey);
    if (current.plan === "pro") return { allowed: true, consume: false, reason: null };
    if (PRO_OPERATIONS.has(operation)) return { allowed: false, consume: false, reason: "pro-required" };
    if (operation === "begin-loop") {
      return current.capabilities.beginLoop
        ? { allowed: true, consume: true, reason: null }
        : { allowed: false, consume: false, reason: "trial-exhausted" };
    }
    if (SESSION_OPERATIONS.has(operation)) {
      return current.grant && current.grant.sessionId === sessionId
        ? { allowed: true, consume: false, reason: null }
        : { allowed: false, consume: false, reason: "pro-required" };
    }
    return { allowed: false, consume: false, reason: "unknown-operation" };
  }

  const api = { TRIAL_LIMIT, normalize, snapshot, canAuthorize };
  root.SCPlayerToolsPolicy = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
