/* Player Tools access policy. Kept DOM-free so background and tests share the
 * exact same rules. */
(function (root) {
  "use strict";

  const TRIAL_LIMIT = 20;
  const PRO_OPERATIONS = new Set(["export-loop", "export-track-effects"]);
  const FREE_PLAYBACK_OPERATIONS = new Set([
    "begin-loop",
    "edit-loop",
    "set-effect",
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
      beginLoop: true,
      editLoop: true,
      // Playback controls are independent from A-B loop selection. A loop is
      // only a prerequisite for exporting the selected range as WAV.
      tempo: true,
      preservePitch: true,
      savePreset: true,
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
    // Live playback controls act on the current player independently of loop
    // trial sessions.
    if (FREE_PLAYBACK_OPERATIONS.has(operation)) {
      return { allowed: true, consume: false, reason: null };
    }
    const current = snapshot(raw, ownerKey);
    if (current.plan === "pro") return { allowed: true, consume: false, reason: null };
    if (PRO_OPERATIONS.has(operation)) return { allowed: false, consume: false, reason: "pro-required" };
    return { allowed: false, consume: false, reason: "unknown-operation" };
  }

  const api = { TRIAL_LIMIT, normalize, snapshot, canAuthorize };
  root.SCPlayerToolsPolicy = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
