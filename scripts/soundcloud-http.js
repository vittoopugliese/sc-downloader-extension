const SCSoundCloudHttp = (() => {
  const STATUS_CODE = Object.freeze({
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
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
    return { method: "GET", credentials: "include", headers };
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
    return error;
  }

  function create(request) {
    if (typeof request !== "function") {
      throw new Error("SoundCloud HTTP adapter is incomplete.");
    }

    async function json(url, options = {}) {
      const response = await request(
        url.toString(),
        requestOptions(options.oauthToken)
      );
      if (!response.ok) throw responseError(response, options.label);
      return response.json();
    }

    return { json };
  }

  return { create };
})();
