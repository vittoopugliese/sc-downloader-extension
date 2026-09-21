const SCSoundCloudHttp = (() => {
  const DEFAULT_TIMEOUT_MS = 15000;
  const DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024;
  const STATUS_CODE = Object.freeze({
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    408: "network_timeout",
    425: "service_unavailable",
    429: "rate_limited",
    500: "service_unavailable",
    502: "service_unavailable",
    503: "service_unavailable",
    504: "service_unavailable",
  });

  const STATUS_MESSAGE = Object.freeze({
    401: "SoundCloud rejected the request (401). This track may require login.",
    403: "Access denied (403). This track may be private or region-restricted.",
    404: "Stream link expired (404). Play the track on SoundCloud, then try again.",
  });

  function requestOptions(oauthToken) {
    const headers = {
      Accept: "application/json",
      Origin: "https://soundcloud.com",
      Referer: "https://soundcloud.com/",
    };
    if (oauthToken) headers.Authorization = `OAuth ${oauthToken}`;
    return { method: "GET", credentials: "include", redirect: "error", headers };
  }

  function authorizedApiUrl(value) {
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === "https:" && url.hostname === "api-v2.soundcloud.com" &&
      !url.username && !url.password &&
      (/^\/users\/\d+\/likes$/.test(url.pathname) ||
       /^\/tracks\/\d+\/download$/.test(url.pathname) ||
       url.pathname === "/tracks" || url.pathname === "/me" ||
       /^\/media\/soundcloud:tracks:\d+\//.test(url.pathname));
  }

  function resolverUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "api-v2.soundcloud.com" &&
        !url.username && !url.password && /^\/media\/[A-Za-z0-9:_/-]+$/.test(url.pathname);
    } catch { return false; }
  }

  function responseError(response, label) {
    const status = response.status;
    const message = label
      ? `${label} (${status}).`
      : STATUS_MESSAGE[status] || `HTTP error! status: ${status}`;
    const error = new Error(message);
    error.code = STATUS_CODE[status] || "http_error";
    error.status = status;
    error.retryAfter = response.headers?.get?.("Retry-After") || null;
    const retrySeconds = /^\d+(?:\.\d+)?$/.test(error.retryAfter || "")
      ? Number(error.retryAfter) : NaN;
    const retryDate = Number.isFinite(retrySeconds) ? NaN : Date.parse(error.retryAfter || "");
    if (Number.isFinite(retrySeconds)) error.retryAt = Date.now() + retrySeconds * 1000;
    else if (Number.isFinite(retryDate)) error.retryAt = retryDate;
    return error;
  }

  function typedError(message, code, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  async function readJson(response, maxBytes) {
    const header = response.headers?.get?.("Content-Length");
    const declared = header == null ? null : Number(header);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes)) {
      response.body?.cancel?.().catch?.(() => {});
      throw typedError("SoundCloud returned an oversized response.", "response_too_large");
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      try {
        return await response.json();
      } catch (error) {
        throw typedError("SoundCloud returned invalid JSON.", "invalid_response", error);
      }
    }

    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || size + value.byteLength > maxBytes) {
          throw typedError("SoundCloud returned an oversized response.", "response_too_large");
        }
        size += value.byteLength;
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        throw typedError("SoundCloud returned invalid JSON.", "invalid_response", error);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock?.();
    }
  }

  function create(request) {
    if (typeof request !== "function") {
      throw new Error("SoundCloud HTTP adapter is incomplete.");
    }

    async function json(url, options = {}) {
      if (options.oauthToken && !authorizedApiUrl(url)) {
        const error = new Error("Authenticated SoundCloud request has an invalid destination.");
        error.code = "invalid_auth_destination";
        throw error;
      }
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
      const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes : DEFAULT_MAX_JSON_BYTES;
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      options.signal?.addEventListener?.("abort", onAbort, { once: true });
      if (options.signal?.aborted) controller.abort();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(typedError("SoundCloud request timed out.", "network_timeout"));
        }, timeoutMs);
      });
      try {
        return await Promise.race([(async () => {
          const response = await request(url.toString(), {
            ...requestOptions(options.oauthToken),
            signal: controller.signal,
          });
          if (!response.ok) {
            response.body?.cancel?.().catch?.(() => {});
            throw responseError(response, options.label);
          }
          return readJson(response, maxBytes);
        })(), timeout]);
      } catch (error) {
        if (timedOut) throw typedError("SoundCloud request timed out.", "network_timeout", error);
        if (options.signal?.aborted) throw error;
        if (error?.code) throw error;
        if (error?.name === "AbortError") throw error;
        throw typedError(error?.message || "SoundCloud request failed.", "network_error", error);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener?.("abort", onAbort);
      }
    }

    return { json };
  }

  return { create, resolverUrl };
})();
