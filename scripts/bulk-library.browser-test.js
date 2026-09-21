const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://soundcloud.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Bulk library fixture</title>',
    }));
    await page.goto('https://soundcloud.com/__scdl_bulk_fixture');
    await page.addScriptTag({ path: path.join(__dirname, 'bulk-library.js') });

    const basic = await page.evaluate(async () => {
      const item = id => ({ trackId: String(id), track: { id, title: `Track ${id}` } });
      const job = await SCBulkLibrary.createJob({
        jobId: 'resume-job', sourceType: 'likes', sourceUserId: '42', mode: 'all', sessionEpoch: 'account-a',
      });
      const first = await SCBulkLibrary.commitPage(job.jobId, {
        epoch: job.epoch,
        expectedCursor: null,
        items: [item(1), item(2), item(2)],
        enumerated: 3,
        nextCursor: 'cursor-2',
      });
      const replay = await SCBulkLibrary.commitPage(job.jobId, {
        epoch: job.epoch,
        expectedCursor: null,
        items: [item(99)],
        enumerated: 1,
        nextCursor: 'cursor-2',
      });
      const paused = await SCBulkLibrary.pause(job.jobId, {
        epoch: job.epoch, code: 'rate_limited', retryAt: 12345,
      });
      const resumed = await SCBulkLibrary.resume(job.jobId);
      return { first, replay, paused, resumed, tracks: await SCBulkLibrary.getTracks(job.jobId) };
    });
    assert.equal(basic.first.inserted, 2);
    assert.equal(basic.first.job.enumerated, 3);
    assert.equal(basic.first.job.skipped.duplicate, 1);
    assert.equal(basic.replay.replay, true);
    assert.equal(basic.paused.retryAt, 12345);
    assert.equal(basic.resumed.nextCursor, 'cursor-2');
    assert.deepEqual(basic.tracks.map(value => value.trackId), ['1', '2']);

    await page.reload();
    await page.addScriptTag({ path: path.join(__dirname, 'bulk-library.js') });
    const recovered = await page.evaluate(async () => {
      const before = await SCBulkLibrary.getJob('resume-job');
      const committed = await SCBulkLibrary.commitPage('resume-job', {
        epoch: before.epoch,
        expectedCursor: before.nextCursor,
        items: [{ trackId: '3', track: { id: 3, title: 'Track 3' } }],
        enumerated: 1,
        nextCursor: null,
        done: true,
      });
      return { before, committed, tracks: await SCBulkLibrary.getTracks('resume-job') };
    });
    assert.equal(recovered.before.status, 'enumerating');
    assert.equal(recovered.committed.job.status, 'ready');
    assert.equal(recovered.committed.job.enumerationComplete, true);
    assert.deepEqual(recovered.tracks.map(value => value.trackId), ['1', '2', '3']);

    const activeJob = await page.evaluate(() => SCBulkLibrary.getActiveJob());
    assert.equal(activeJob.jobId, 'resume-job');
    assert.equal(activeJob.status, 'ready');

    const edgeCases = await page.evaluate(async () => {
      const item = id => ({ trackId: String(id), track: { id, title: `Track ${id}` } });
      const cycle = await SCBulkLibrary.createJob({ jobId: 'cycle-job', mode: 'all' });
      await SCBulkLibrary.commitPage(cycle.jobId, {
        epoch: cycle.epoch, expectedCursor: null, items: [item(1)], nextCursor: 'same',
      });
      const partial = await SCBulkLibrary.commitPage(cycle.jobId, {
        epoch: cycle.epoch, expectedCursor: 'same', items: [item(2)], nextCursor: 'same',
      });

      const limited = await SCBulkLibrary.createJob({ jobId: 'limited-job', mode: 'limit', requestedLimit: 50 });
      const limitedPage = await SCBulkLibrary.commitPage(limited.jobId, {
        epoch: limited.epoch,
        expectedCursor: null,
        items: Array.from({ length: 100 }, (_, index) => item(index + 1)),
        enumerated: 100,
        nextCursor: 'more',
      });

      const cancelled = await SCBulkLibrary.createJob({ jobId: 'cancelled-job', mode: 'all' });
      await SCBulkLibrary.cancel(cancelled.jobId);
      let staleCode = null;
      try {
        await SCBulkLibrary.commitPage(cancelled.jobId, {
          epoch: cancelled.epoch, expectedCursor: null, items: [item(1)], nextCursor: null,
        });
      } catch (error) { staleCode = error.code; }
      return {
        partial: partial.job,
        limited: limitedPage.job,
        limitedTracks: await SCBulkLibrary.getTracks(limited.jobId, 0, 500),
        staleCode,
      };
    });
    assert.equal(edgeCases.partial.status, 'partial');
    assert.equal(edgeCases.partial.error, 'cursor_cycle');
    assert.equal(edgeCases.partial.eligible, 2);
    assert.equal(edgeCases.limited.status, 'ready');
    assert.equal(edgeCases.limited.enumerationComplete, false);
    assert.equal(edgeCases.limited.eligible, 50);
    assert.equal(edgeCases.limitedTracks.length, 50);
    assert.equal(edgeCases.staleCode, 'stale_job');

    const runner = await page.evaluate(async () => {
      const item = id => ({ trackId: `runner-${id}`, track: { id, title: `Runner ${id}` } });
      const created = await SCBulkLibrary.createJob({ jobId: 'runner-job', mode: 'limit', requestedLimit: 4 });
      await SCBulkLibrary.commitPage(created.jobId, {
        epoch: created.epoch, expectedCursor: null,
        items: [item(1), item(2), item(3), item(4)], nextCursor: null, done: true,
      });
      await SCBulkLibrary.updateJob(created.jobId, ['ready'], { status: 'running', playlistTitle: 'Runner' });
      await SCBulkLibrary.updateTrackState(created.jobId, 0, 'saving', { downloadId: 77 });
      await SCBulkLibrary.updateTrackState(created.jobId, 0, 'done');
      await SCBulkLibrary.updateTrackState(created.jobId, 1, 'failed', { error: 'network' });
      await SCBulkLibrary.updateTrackState(created.jobId, 2, 'saving');
      await SCBulkLibrary.updateTrackState(created.jobId, 2, 'ambiguous_save', {
        expectedStates: ['saving'], error: 'check folder',
      });
      const beforeRetry = await SCBulkLibrary.getJob(created.jobId);
      const saving = await SCBulkLibrary.getTracksByState(created.jobId, 'saving');
      const retry = await SCBulkLibrary.retryFailed(created.jobId);
      const pending = await SCBulkLibrary.getTracksByState(created.jobId, 'pending');
      return {
        beforeRetry,
        retry,
        saving,
        pending: pending.map(value => value.index),
        first: await SCBulkLibrary.getTrack(created.jobId, 0),
        afterRetry: await SCBulkLibrary.getJob(created.jobId),
      };
    });
    assert.equal(runner.beforeRetry.saved, 1);
    assert.equal(runner.beforeRetry.failed, 2);
    assert.equal(runner.beforeRetry.remaining, 1);
    assert.equal(runner.saving.length, 0);
    assert.equal(runner.retry.reset, 1);
    assert.deepEqual(runner.pending, [1, 3]);
    assert.equal(runner.first.downloadId, 77);
    assert.equal(runner.afterRetry.failed, 1, 'Ambiguous saves must not be retried');
    assert.equal(runner.afterRetry.recentFailures.length, 1);
    assert.equal(runner.afterRetry.recentFailures[0].ambiguous, true);

    const scale = await page.evaluate(async () => {
      const job = await SCBulkLibrary.createJob({ jobId: 'scale-50000', sourceType: 'user_tracks', mode: 'all' });
      const started = performance.now();
      const pageSize = 200;
      for (let offset = 0; offset < 50000; offset += pageSize) {
        const next = offset + pageSize < 50000 ? `cursor-${offset + pageSize}` : null;
        await SCBulkLibrary.commitPage(job.jobId, {
          epoch: job.epoch,
          expectedCursor: offset === 0 ? null : `cursor-${offset}`,
          items: Array.from({ length: pageSize }, (_, index) => {
            const id = offset + index + 1;
            return { trackId: String(id), track: { id, title: `Track ${id}` } };
          }),
          enumerated: pageSize,
          nextCursor: next,
          done: next == null,
        });
      }
      const summary = await SCBulkLibrary.getJob(job.jobId);
      const tail = await SCBulkLibrary.getTracks(job.jobId, 49990, 20);
      return { summary, tail: tail.map(value => value.trackId), elapsedMs: performance.now() - started };
    });
    assert.equal(scale.summary.status, 'ready');
    assert.equal(scale.summary.enumerationComplete, true);
    assert.equal(scale.summary.enumerated, 50000);
    assert.equal(scale.summary.eligible, 50000);
    assert.equal(scale.summary.skipped.duplicate, 0);
    assert.deepEqual(scale.tail, Array.from({ length: 10 }, (_, index) => String(49991 + index)));
    console.log(`Bulk IndexedDB verification passed (50,000 tracks in ${Math.round(scale.elapsedMs)} ms).`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
