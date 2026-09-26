/* Offscreen slice batches. Prepared audio and receipts survive worker/document restarts. */
(() => {
  "use strict";
  const renders = new Map();
  const TTL = 5 * 60 * 1000;
  const MAX_BYTES = 12 * 1024 * 1024;
  const failure = (code, error) => ({ success: false, code, error });

  async function handle(message, openDatabase) {
    const id = message.operationId;
    const owner = message.owner;
    if (typeof id !== "string" || !/^pad_slice_[A-Za-z0-9_-]{8,80}$/.test(id) ||
        typeof owner !== "string" || !owner || owner.length > 200) {
      return failure("invalid_operation", "Invalid slice operation.");
    }
    const database = await openDatabase();
    // All read/modify/write work stays inside IDB callbacks, with no awaits.
    const transaction = (action) => new Promise((resolve, reject) => {
      const tx = database.transaction(["operations", "claims", "samples"], "readwrite");
      const operations = tx.objectStore("operations");
      const claims = tx.objectStore("claims");
      const samples = tx.objectStore("samples");
      let result;
      const get = operations.get(id);
      get.onsuccess = () => {
        const operation = get.result;
        if (operation && (operation.kind !== "slices" || operation.owner !== owner)) {
          result = failure("operation_conflict", "Slice operation ID conflict.");
          return;
        }
        const allClaims = claims.getAll();
        allClaims.onsuccess = () => {
          try { result = action({ operation, operations, claims, samples, allClaims: allClaims.result }); }
          catch (error) { reject(error); tx.abort(); }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Could not save the eight slices."));
    });
    const owned = (operation, allClaims) => operation && Date.now() - operation.updatedAt <= TTL &&
      Array.from({ length: 8 }, (_, index) => index).every(index =>
        allClaims.some(claim => claim.index === index && claim.id === id));
    const finish = (operation, operations, result) => {
      operation.state = result.success ? "done" : "failed";
      operation.result = result;
      operation.updatedAt = Date.now();
      delete operation.prepared;
      operations.put(operation);
      return result;
    };
    try {
      if (message.type === "OFFSCREEN_SLICES_BEGIN") {
        const input = message.input;
        const range = input?.trimRange;
        const rate = input?.playbackTransform?.rate;
        if (!range || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) ||
            range.startMs < 0 || range.endMs <= range.startMs || !Number.isFinite(rate) || rate < .1 || rate > 4 ||
            (range.endMs - range.startMs) / rate > 30000) {
          return failure("invalid_range", "Select a loop of up to 30 seconds at the current speed.");
        }
        const signature = JSON.stringify(input);
        return await transaction(({ operation, operations, claims }) => {
          if (operation) {
            if (operation.signature && operation.signature !== signature) return failure("operation_conflict", "Slice operation ID conflict.");
            return operation.result || { success: true, state: operation.state };
          }
          // Expire abandoned prepared blobs and old receipts without touching pads.
          const cursor = operations.openCursor();
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (!item) return;
            if (item.value.kind === "slices" && item.value.updatedAt < Date.now() - TTL) item.delete();
            item.continue();
          };
          operations.put({ id, owner, kind: "slices", input, signature, state: "pending", updatedAt: Date.now() });
          for (let index = 0; index < 8; index++) claims.put({ index, id });
          return { success: true, state: "pending" };
        });
      }
      if (message.type === "OFFSCREEN_SLICES_CANCEL") {
        return await transaction(({ operation, operations }) => {
          if (operation?.state === "done") return operation.result;
          renders.get(id)?.controller.abort();
          return finish(operation || { id, owner, kind: "slices" }, operations,
            failure("slice_cancelled", "Slice preparation cancelled."));
        });
      }
      if (message.type === "OFFSCREEN_SLICES_COMMIT") {
        return await transaction(({ operation, operations, allClaims, samples }) => {
          if (!operation) return failure("unknown_operation", "Slice preparation expired.");
          if (operation.result) return operation.result;
          if (!owned(operation, allClaims)) return finish(operation, operations,
            failure("obsolete_pad", "A newer sample replaced this operation."));
          if (operation.state !== "prepared" || operation.prepared?.length !== 8) {
            return failure("not_prepared", "The eight slices are not ready yet.");
          }
          const pads = operation.prepared.map((record) => {
            samples.put(record);
            return { index: record.index, name: record.name, updatedAt: record.updatedAt };
          });
          return finish(operation, operations, { success: true, pads });
        });
      }
      if (message.type !== "OFFSCREEN_SLICES_RENDER") return failure("invalid_operation", "Unknown slice operation.");
      const state = await transaction(({ operation, allClaims }) => {
        if (!operation) return failure("unknown_operation", "Slice preparation expired.");
        if (operation.result) return operation.result;
        if (!owned(operation, allClaims)) return failure("obsolete_pad", "A newer sample replaced this operation.");
        return { success: true, operation };
      });
      if (!state.success || !state.operation) return state;
      if (state.operation.state === "prepared") return { success: true, state: "prepared" };
      if (renders.has(id)) return renders.get(id).promise;
      const controller = new AbortController();
      const promise = (async () => {
        const keepalive = setInterval(() => chrome.runtime.sendMessage({ type: "OFFSCREEN_KEEPALIVE" }).catch(() => {}), 10000);
        try {
          const input = state.operation.input;
          const { blob } = await SCDownload.buildTrackBlob(message.streamUrl, message.trackData, null,
            controller.signal, input.trimRange, input.playbackTransform, input.effects, true);
          if (controller.signal.aborted) throw new Error("Slice preparation cancelled.");
          if (!(blob instanceof Blob) || blob.size > MAX_BYTES) throw new Error("This loop is too large for the sampler.");
          const slices = SCSamplerCore.sliceWav(await blob.arrayBuffer(), input.trimRange, input.playbackTransform.rate);
          const prepared = slices.map((slice, index) => ({
            index, kind: "slice", schemaVersion: 1,
            name: `${String(input.name || "Loop").slice(0, 70)} · ${index + 1}/8`,
            blob: new Blob([slice.bytes], { type: "audio/wav" }),
            startFrame: slice.startFrame, endFrame: slice.endFrame, sampleRate: slice.sampleRate,
            source: { trackIdentity: input.trackIdentity, generation: input.generation, trimRange: input.trimRange },
            updatedAt: Date.now(),
          }));
          if (prepared.reduce((sum, record) => sum + record.blob.size, 0) > MAX_BYTES) throw new Error("This loop is too large for the sampler.");
          return await transaction(({ operation, operations, allClaims }) => {
            if (!operation) return failure("unknown_operation", "Slice preparation expired.");
            if (operation.result) return operation.result;
            if (controller.signal.aborted || !owned(operation, allClaims)) return finish(operation, operations,
              failure("obsolete_pad", "Slice preparation cancelled or replaced."));
            operation.prepared = prepared;
            operation.state = "prepared";
            operation.updatedAt = Date.now();
            operations.put(operation);
            return { success: true, state: "prepared" };
          });
        } catch (error) {
          // Expired media may be retried with a fresh URL and the same snapshot.
          if ([401, 403, 404].includes(error?.status)) return { ...failure("media_expired", error.message), status: error.status };
          return await transaction(({ operation, operations }) => operation
            ? operation.result || finish(operation, operations, failure("slice_failed", error?.message || "Could not prepare the slices."))
            : failure("unknown_operation", "Slice preparation expired."));
        } finally {
          clearInterval(keepalive);
          renders.delete(id);
        }
      })();
      renders.set(id, { controller, promise });
      return await promise;
    } catch (error) {
      return failure("slice_failed", error?.message || "Could not save the eight slices.");
    }
  }
  globalThis.SCSamplerSlices = Object.freeze({ handle });
})();
