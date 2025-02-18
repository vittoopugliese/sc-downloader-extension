let currentTrackData = null;

function isSoundCloudTrackPage() {
  return (
    window.location.href.includes("soundcloud.com") &&
    !window.location.href.includes("/discover") &&
    !window.location.href.includes("/search") &&
    !window.location.href.includes("/stream") &&
    !window.location.href.includes("/you")
  );
};

async function extractTrackData() {
  try {
    const html = document.documentElement.innerHTML;

    const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[.*?\]);/);
    if (!hydrationMatch) {
      console.error("Hydration data not found... Retrying in 2 seconds.");
      setTimeout(initScript, 2000);
    }

    const hydrationData = JSON.parse(hydrationMatch[1]);
    const trackData = hydrationData.find((item) => item.hydratable === "sound");
    
    if (!trackData || !trackData.data) throw new Error("Track data not found");

    currentTrackData = {
      title: trackData.data.title,
      artist: trackData.data.user.username,
      artistUrl: trackData.data.user.permalink_url,
      artistImageUrl: trackData.data.user.avatar_url,
      duration: formatDuration(trackData.data.duration),
      artwork_url: trackData.data.artwork_url?.replace("-large", "-t500x500"),
      description: trackData.data.description || "No Description.",
      streamUrl: extractStreamUrl(trackData.data),
      permalink: trackData.data.permalink_url,
      waveform_url: trackData.data.waveform_url,
      created_at: new Date(trackData.data.created_at).toLocaleDateString(),
    };

    chrome.runtime.sendMessage({type: "TRACK_DATA", data: currentTrackData});

    return currentTrackData;
  } catch (error) {
    console.error("SC Track Downloader Error: ", error);
    return null;
  };
};

function extractStreamUrl(data) {
  if (data.media?.transcodings) {
    const progressive = data.media.transcodings.find((t) => t.format.protocol === "progressive");
    return progressive?.url || null;
  };

  return null;
};

function formatDuration(ms) {
  ms = ms - 1000;
  const minutes = Math.floor(ms / 60000);
  const seconds = (((ms % 60000) / 1000)).toFixed(0);
  return `${minutes}:${seconds.padStart(2, "0")}`;
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TRACK_DATA") {
    if (currentTrackData && !request.forceRefresh) {
      sendResponse(currentTrackData);
    } else if (isSoundCloudTrackPage()) {
      extractTrackData().then((data) => sendResponse(data));
      return true;
    } else {
      sendResponse(null);
    };
  };
  
  return true;
});

function initScript() {
  if (isSoundCloudTrackPage()) setTimeout(extractTrackData, 1254);
};

initScript();