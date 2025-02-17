chrome.runtime.onInstalled.addListener(() => {
  console.log("SoundCloud Scraper extension running!");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_MP3_URL") {
    getFinalMp3Url(request.streamUrl)
      .then((url) => sendResponse({success: true, url: url}))
      .catch((error) => sendResponse({success: false, error: error.message}));
    return true;
  };
});

function getOAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get(
      {url: "https://soundcloud.com", name: "oauth_token"},
      (cookie) => {
        if (cookie) {
          resolve(cookie.value);
        } else {
          reject(new Error("Cannot get oauth_token."));
        };
      }
    );
  });
};

function buildRequestData(oauthToken) {
  return {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Origin": "https://soundcloud.com",
      "Referer": "https://soundcloud.com/",
      "Authorization": `OAuth ${oauthToken}`,
    },
  };
};

async function getFinalMp3Url(streamUrl) {
  try {
    const oauthToken = await getOAuthToken();
    const authenticatedUrl = `${streamUrl}?oauth_token=${oauthToken}`;
    const response = await fetch(authenticatedUrl, buildRequestData(oauthToken));

    if (response.url) {
      const trackResponse = await fetch(response.url, buildRequestData(oauthToken));
      const trackDownloadResponse = await trackResponse.json();
      return trackDownloadResponse.url || null;
    };

    return null;
  } catch (error) {
    console.error("Error getting MP3 URL:", error);
    throw error;
  };
};
