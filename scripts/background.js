chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_MP3_URL" || request.type === "GET_STREAM_URL") {
    resolveStreamUrl(
      request.streamUrl,
      request.clientId,
      request.trackAuthorization,
      request.streamProtocol,
      request.streamPreset,
      request.streamMimeType
    )
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
          code: error.code || "unknown_error",
        })
      );

    return true;
  }

  if (request.type === "GET_LOGGED_IN_USER") {
    resolveLoggedInUserProfile(request.clientId)
      .then((profile) => sendResponse({ success: true, profile }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );

    return true;
  }
});

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get(
      { url: "https://soundcloud.com", name: "oauth_token" },
      (cookie) => {
        if (cookie?.value) {
          resolve(cookie.value);
        } else {
          reject(new Error("No oauth_token cookie"));
        }
      }
    );
  });
}

function buildStreamError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getHttpErrorMessage(status) {
  if (status === 401) {
    return "SoundCloud rejected the request (401). This track may require login.";
  }

  if (status === 403) {
    return "Access denied (403). This track may be private or region-restricted.";
  }

  if (status === 404) {
    return "Stream not found (404). Reload the SoundCloud page and try again.";
  }

  return `HTTP error! status: ${status}`;
}

async function requestStreamUrl(streamUrl, options) {
  const { clientId, oauthToken, trackAuthorization } = options;
  const requestUrl = new URL(streamUrl);

  if (oauthToken) {
    // OAuth path: SoundCloud accepts Authorization header.
  } else if (clientId) {
    requestUrl.searchParams.set("client_id", clientId);
  } else {
    throw buildStreamError(
      "No se pudo obtener client_id. Recargá la página de SoundCloud e intentá de nuevo.",
      "missing_client_id"
    );
  }

  if (trackAuthorization) {
    requestUrl.searchParams.set("track_authorization", trackAuthorization);
  }

  const headers = {
    Accept: "application/json",
    Origin: "https://soundcloud.com",
    Referer: "https://soundcloud.com/",
  };

  if (oauthToken) {
    headers.Authorization = `OAuth ${oauthToken}`;
  }

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw buildStreamError(
      getHttpErrorMessage(response.status),
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : "http_error",
      response.status
    );
  }

  const streamData = await response.json();

  if (!streamData.url) {
    throw buildStreamError(
      "SoundCloud did not return a playable stream URL.",
      "empty_stream_url"
    );
  }

  return streamData.url;
}

async function resolveStreamUrl(
  streamUrl,
  clientId,
  trackAuthorization,
  streamProtocol,
  streamPreset,
  streamMimeType
) {
  const attempts = [];

  if (clientId) {
    attempts.push({
      label: "public",
      clientId,
      trackAuthorization,
    });
  }

  let oauthToken = null;
  try {
    oauthToken = await getOAuthToken();
    attempts.push({
      label: "oauth",
      oauthToken,
      trackAuthorization,
    });
  } catch {
    // No logged-in session available.
  }

  if (!attempts.length) {
    throw buildStreamError(
      "No se pudo obtener client_id. Recargá la página de SoundCloud e intentá de nuevo.",
      "missing_client_id"
    );
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const url = await requestStreamUrl(streamUrl, attempt);

      return {
        url,
        protocol: streamProtocol || null,
        preset: streamPreset || null,
        mimeType: streamMimeType || null,
        authMode: attempt.label,
      };
    } catch (error) {
      lastError = error;

      if (![401, 403].includes(error.status)) {
        throw error;
      }
    }
  }

  if (lastError?.status === 403) {
    throw buildStreamError(
      "No se pudo descargar esta track. Puede ser privada, restringida por región o requerir login.",
      "forbidden",
      403
    );
  }

  if (lastError?.status === 401) {
    throw buildStreamError(
      "No se pudo acceder al stream sin login. Probá iniciar sesión en SoundCloud.",
      "unauthorized",
      401
    );
  }

  throw lastError || buildStreamError("Could not resolve stream URL.", "unknown_error");
}

async function resolveLoggedInUserProfile(clientId) {
  if (!clientId) {
    throw new Error("Missing client_id.");
  }

  const oauthToken = await getOAuthToken();
  const requestUrl = new URL("https://api-v2.soundcloud.com/me");
  requestUrl.searchParams.set("client_id", clientId);

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Origin: "https://soundcloud.com",
      Referer: "https://soundcloud.com/",
      Authorization: `OAuth ${oauthToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      "Could not resolve logged-in user. Sign in to SoundCloud and try again."
    );
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error("SoundCloud did not return a logged-in user profile.");
  }

  return { user, oauthToken };
}
