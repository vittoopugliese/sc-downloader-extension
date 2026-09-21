(function (root) {
  'use strict';

  const DB_NAME = 'scdl_bulk_jobs';
  const DB_VERSION = 1;
  const FIRST_CURSOR = '__first__';
  const ACTIVE_STATUSES = new Set(['enumerating', 'paused', 'ready', 'downloading']);
  const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'partial']);
  const request = value => new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error || new Error('indexeddb-request-failed'));
  });

  let opening = null;

  function fail(code, message = code) {
    return Object.assign(new Error(message), { code });
  }

  function cursorKey(value) {
    if (value == null) return FIRST_CURSOR;
    if (typeof value !== 'string' || !value || value.length > 2048) {
      throw fail('invalid_cursor', 'Bulk cursor is invalid.');
    }
    return value;
  }

  function normalizeSkipped(value = {}) {
    return {
      duplicate: Math.max(0, Number(value.duplicate) || 0),
      unavailable: Math.max(0, Number(value.unavailable) || 0),
      invalid: Math.max(0, Number(value.invalid) || 0),
    };
  }

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const opened = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      opened.onupgradeneeded = () => {
        const db = opened.result;
        if (!db.objectStoreNames.contains('jobs')) {
          const jobs = db.createObjectStore('jobs', { keyPath: 'jobId' });
          jobs.createIndex('status', 'status');
          jobs.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('tracks')) {
          const tracks = db.createObjectStore('tracks', { keyPath: ['jobId', 'index'] });
          tracks.createIndex('job', 'jobId');
          tracks.createIndex('state', ['jobId', 'state']);
        }
        if (!db.objectStoreNames.contains('seen')) {
          db.createObjectStore('seen', { keyPath: ['jobId', 'trackId'] });
        }
        if (!db.objectStoreNames.contains('cursors')) {
          db.createObjectStore('cursors', { keyPath: ['jobId', 'cursor'] });
        }
      };
      opened.onblocked = () => {
        if (settled) return;
        settled = true;
        opening = null;
        reject(fail('storage_blocked', 'Bulk storage upgrade is blocked by another extension page.'));
      };
      opened.onerror = () => {
        if (settled) return;
        settled = true;
        opening = null;
        reject(opened.error || fail('storage_error'));
      };
      opened.onsuccess = () => {
        if (settled) {
          opened.result.close();
          return;
        }
        settled = true;
        const db = opened.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
    });
    return opening;
  }

  async function transaction(names, mode, visit) {
    const db = await open();
    const tx = db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || fail('storage_aborted'));
      tx.onerror = () => {};
    });
    try {
      const result = await visit(name => tx.objectStore(name));
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async function createJob(spec) {
    if (!spec?.jobId || typeof spec.jobId !== 'string' || spec.jobId.length > 128) {
      throw fail('invalid_job', 'Bulk job ID is invalid.');
    }
    const createdAt = Number.isFinite(spec.createdAt) ? spec.createdAt : Date.now();
    const job = {
      jobId: spec.jobId,
      status: 'enumerating',
      sourceType: spec.sourceType || 'unknown',
      sourceUserId: spec.sourceUserId == null ? null : String(spec.sourceUserId),
      sourceUrl: spec.sourceUrl || null,
      sessionEpoch: spec.sessionEpoch == null ? null : String(spec.sessionEpoch),
      mode: spec.mode || 'all',
      requestedLimit: Number.isSafeInteger(spec.requestedLimit) && spec.requestedLimit >= 0
        ? spec.requestedLimit : null,
      epoch: 0,
      revision: 0,
      enumerated: 0,
      eligible: 0,
      selected: 0,
      skipped: normalizeSkipped(),
      saved: 0,
      failed: 0,
      remaining: 0,
      nextCursor: spec.initialCursor ?? null,
      enumerationComplete: false,
      error: null,
      retryAt: null,
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
    };
    return transaction(['jobs'], 'readwrite', async store => {
      if (await request(store('jobs').get(job.jobId))) throw fail('job_exists');
      store('jobs').add(job);
      return job;
    });
  }

  function validatePage(page) {
    if (!page || !Array.isArray(page.items) || page.items.length > 500) {
      throw fail('invalid_page', 'Bulk page is invalid.');
    }
    for (const item of page.items) {
      if (!item || !/^[A-Za-z0-9:_-]{1,128}$/.test(String(item.trackId || '')) || !item.track) {
        throw fail('invalid_page', 'Bulk page contains an invalid track.');
      }
    }
  }

  async function commitPage(jobId, page) {
    validatePage(page);
    const expected = cursorKey(page.expectedCursor);
    const next = page.nextCursor == null ? null : cursorKey(page.nextCursor);
    const pageSkipped = normalizeSkipped(page.skipped);
    return transaction(['jobs', 'tracks', 'seen', 'cursors'], 'readwrite', async store => {
      const jobs = store('jobs');
      const tracks = store('tracks');
      const seen = store('seen');
      const cursors = store('cursors');
      const job = await request(jobs.get(jobId));
      if (!job) throw fail('job_missing');
      if (page.epoch != null && job.epoch !== page.epoch) throw fail('stale_job');

      const checkpoint = await request(cursors.get([jobId, expected]));
      if (checkpoint) return { job, replay: true, inserted: 0 };
      if (job.status !== 'enumerating' || cursorKey(job.nextCursor) !== expected) {
        throw fail('stale_checkpoint');
      }

      let inserted = 0;
      let duplicate = pageSkipped.duplicate;
      for (const item of page.items) {
        if (job.requestedLimit != null && job.eligible + inserted >= job.requestedLimit) break;
        const trackId = String(item.trackId);
        if (await request(seen.get([jobId, trackId]))) {
          duplicate += 1;
          continue;
        }
        const index = job.eligible + inserted;
        seen.put({ jobId, trackId });
        tracks.put({
          jobId,
          index,
          trackId,
          track: item.track,
          state: 'pending',
          attempts: 0,
          operationId: `${jobId}:${index}`,
          downloadId: null,
          error: null,
        });
        inserted += 1;
      }

      const rawCount = Number.isSafeInteger(page.enumerated) && page.enumerated >= 0
        ? page.enumerated
        : page.items.length + pageSkipped.unavailable + pageSkipped.invalid;
      job.enumerated += rawCount;
      job.eligible += inserted;
      job.selected = job.eligible;
      job.skipped = {
        duplicate: job.skipped.duplicate + duplicate,
        unavailable: job.skipped.unavailable + pageSkipped.unavailable,
        invalid: job.skipped.invalid + pageSkipped.invalid,
      };
      job.revision += 1;
      job.updatedAt = Date.now();
      job.nextCursor = next === FIRST_CURSOR ? null : next;
      job.remaining = Math.max(0, job.eligible - job.saved - job.failed);

      const nextWasSeen = next != null && (
        next === expected || Boolean(await request(cursors.get([jobId, next])))
      );
      const reachedLimit = job.requestedLimit != null && job.eligible >= job.requestedLimit;
      if (nextWasSeen) {
        job.status = 'partial';
        job.error = 'cursor_cycle';
        job.finishedAt = Date.now();
      } else if (page.done === true || next == null || reachedLimit) {
        job.status = 'ready';
        job.enumerationComplete = page.done === true || next == null;
        job.nextCursor = reachedLimit && !job.enumerationComplete ? next : null;
      }

      cursors.put({
        jobId,
        cursor: expected,
        nextCursor: next,
        revision: job.revision,
        inserted,
        committedAt: job.updatedAt,
      });
      jobs.put(job);
      return { job, replay: false, inserted };
    });
  }

  async function getJob(jobId) {
    return transaction(['jobs'], 'readonly', store => request(store('jobs').get(jobId)));
  }

  async function getTracks(jobId, offset = 0, limit = 200) {
    offset = Math.max(0, Number.isSafeInteger(offset) ? offset : 0);
    limit = Math.min(500, Math.max(1, Number.isSafeInteger(limit) ? limit : 200));
    return transaction(['tracks'], 'readonly', store => new Promise((resolve, reject) => {
      const values = [];
      const range = IDBKeyRange.bound([jobId, offset], [jobId, Number.MAX_SAFE_INTEGER]);
      const opened = store('tracks').openCursor(range);
      opened.onerror = () => reject(opened.error || fail('storage_error'));
      opened.onsuccess = () => {
        const cursor = opened.result;
        if (!cursor || values.length >= limit) {
          resolve(values);
          return;
        }
        values.push(cursor.value);
        cursor.continue();
      };
    }));
  }

  async function pause(jobId, detail = {}) {
    return transaction(['jobs'], 'readwrite', async store => {
      const job = await request(store('jobs').get(jobId));
      if (!job || job.status !== 'enumerating') return null;
      if (detail.epoch != null && detail.epoch !== job.epoch) throw fail('stale_job');
      job.status = 'paused';
      job.error = detail.code || 'network_error';
      job.retryAt = Number.isFinite(detail.retryAt) ? detail.retryAt : null;
      job.updatedAt = Date.now();
      store('jobs').put(job);
      return job;
    });
  }

  async function resume(jobId) {
    return transaction(['jobs'], 'readwrite', async store => {
      const job = await request(store('jobs').get(jobId));
      if (!job || job.status !== 'paused') return null;
      job.status = 'enumerating';
      job.error = null;
      job.retryAt = null;
      job.updatedAt = Date.now();
      store('jobs').put(job);
      return job;
    });
  }

  async function cancel(jobId) {
    return transaction(['jobs'], 'readwrite', async store => {
      const job = await request(store('jobs').get(jobId));
      if (!job || !ACTIVE_STATUSES.has(job.status)) return null;
      job.epoch += 1;
      job.status = 'cancelled';
      job.error = null;
      job.updatedAt = Date.now();
      job.finishedAt = job.updatedAt;
      store('jobs').put(job);
      return job;
    });
  }

  async function deleteJob(jobId) {
    return transaction(['jobs', 'tracks', 'seen', 'cursors'], 'readwrite', async store => {
      const job = await request(store('jobs').get(jobId));
      if (!job) return false;
      if (!TERMINAL_STATUSES.has(job.status)) throw fail('job_active');
      for (const name of ['tracks', 'seen', 'cursors']) {
        await new Promise((resolve, reject) => {
          const opened = store(name).openCursor();
          opened.onerror = () => reject(opened.error || fail('storage_error'));
          opened.onsuccess = () => {
            const cursor = opened.result;
            if (!cursor) return resolve();
            if (cursor.value.jobId === jobId) cursor.delete();
            cursor.continue();
          };
        });
      }
      store('jobs').delete(jobId);
      return true;
    });
  }

  root.SCBulkLibrary = Object.freeze({
    DB_NAME,
    open,
    createJob,
    commitPage,
    getJob,
    getTracks,
    pause,
    resume,
    cancel,
    deleteJob,
  });
})(globalThis);
