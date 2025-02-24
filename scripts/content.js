let currentTrackData = null;
let lastUrl = location.href;

function isSoundCloudTrackPage() {
  return (
    window.location.href.includes("soundcloud.com") &&
    window.location.href.match(/soundcloud\.com\/[^/]+\/[^]+/) !== null &&
    !window.location.href.includes("/discover") &&
    !window.location.href.includes("/search") &&
    !window.location.href.includes("/stream") &&
    !window.location.href.includes("/upload") &&
    !window.location.href.includes("/feed") &&
    !window.location.href.includes("/you")
  );
};

async function extractTrackData() {
  currentTrackData = null;

  try {
    let html = document.documentElement.innerHTML;
    // reconstructing the html variable because its not updating when the page url changes
    html = await fetch(window.location.href).then((res) => res.text());
    // aparently fetching the page again is the only way to get the updated html lol 

    const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[.*?\]);/);
    if (!hydrationMatch) {
      console.error("Hydration data not found... Retrying in 2 seconds.");
      setTimeout(initScript, 2000);
      return null;
    };

    const hydrationData = JSON.parse(hydrationMatch[1]);
    const trackData = hydrationData.find((item) => item.hydratable === "sound");
    
    if (!trackData || !trackData.data) {
      throw new Error("Track data not found");
    };

    const newTrackData = {
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

    if (JSON.stringify(currentTrackData) !== JSON.stringify(newTrackData)) {
      currentTrackData = newTrackData;
      chrome.runtime.sendMessage({type: "TRACK_DATA", data: currentTrackData});
    };

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

const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;

    if (window.urlChangeTimeout) clearTimeout(window.urlChangeTimeout);

    window.urlChangeTimeout = setTimeout(async () => {
      if (isSoundCloudTrackPage()) await extractTrackData();
    }, 2000);
  };
});

function initScript() {
  if (isSoundCloudTrackPage()) setTimeout(extractTrackData, 1254);
  observer.observe(document, { subtree: true, childList: true });
};

initScript();