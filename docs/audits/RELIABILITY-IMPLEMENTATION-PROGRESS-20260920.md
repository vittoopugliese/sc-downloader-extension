# Reliability implementation progress

Checked against `docs/audits/RELIABILITY-MITIGATION-PLAN-20260920.md` on the current checkout. This is an interim report, not a release approval.

## Implemented in this working tree

- M1: bulk tracks have stable operation IDs. Offscreen joins duplicate builds and directory saves with the same ID and rejects a changed payload. A lost directory save response is not retried automatically. Bulk records `saving` before the save, checkpoints Chrome `downloadId` as soon as it is returned, and checks `downloads.search` after worker recovery. A save whose outcome cannot be proved becomes `ambiguous_save`, remains visible, and is excluded from automatic and failed-track retries. Confirmed saves retain their result if blob cleanup fails. Jobs with some failures end as `completed_with_errors`.
- M2: audio, playlist and cover responses are read by a bounded stream reader. It checks headers and counts chunks before concatenation. HLS workers share a 128 MiB segment budget. Covers are limited to 5 MiB. WAV size and a combined compressed/decoded/rendered/WAV estimate are checked before the final WAV allocation. `memory_budget_exceeded` stays typed through transformed export.

## Evidence

- Local: `npm test` passed 41 verifications. Added tests for concurrent duplicate offscreen builds/saves, interrupted bulk recovery, Chrome ID reconciliation, unbounded chunked bodies, and synthetic large WAV output.
- Browser fixtures: `npm run test:e2e:download`, `npm run test:e2e:popup`, and `npm run test:e2e:likes` passed outside the macOS sandbox before the final WAV limit and bulk summary edits. The download test covered offscreen, Chrome Downloads, selected folder and fallback. The Likes test used its browser fixtures and real IndexedDB. These tests did not use a live SoundCloud session or the exact final working tree.

## Still required by the mitigation plan

- M1: durable operation records for singles/loops; full reconciliation of in-progress Chrome downloads and folder writes; bounded durable deduplication history.
- M2: bounded reads in all non-audio HTTP routes, measured process memory under repeated jobs and ChromeOS, and comprehensive HLS aggregate tests.
- M3–M8: HTTP policy and error classification across contexts, durable paged bulk enumeration, Explorer integrity and cost work, offscreen leases/cancellation, HLS/security coverage, and exact ZIP smoke tests remain open.
- Commercial release gate: Cloudflare/Lemon Squeezy deployment and reconciled sandbox/live purchase, production entitlement and refund tests, and a final ZIP without test login remain open. No external production action was taken.

Do not use this tree as a release candidate until the remaining gates are completed and measured. The pre-existing local changes to `scripts/fast-tooltips.js` and `scripts/verify-tempo-browser.js` were preserved.
