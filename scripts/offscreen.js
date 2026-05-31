const activeBuilds = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_BUILD") {
    handleBuild(message, sendResponse);
    return true;
  }

  if (message.type === "OFFSCREEN_REVOKE") {
    try {
      if (message.blobUrl) {
        URL.revokeObjectURL(message.blobUrl);
      }
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (message.type === "OFFSCREEN_ABORT") {
    const controller = activeBuilds.get(message.buildId);
    controller?.abort();
    activeBuilds.delete(message.buildId);
    sendResponse({ success: true });
    return true;
  }

  return false;
});

async function handleBuild(message, sendResponse) {
  const controller = new AbortController();
  activeBuilds.set(message.buildId, controller);

  try {
    const { blob, fileName } = await SCDownload.buildTrackBlob(
      message.streamUrl,
      message.trackData,
      null,
      controller.signal
    );
    const blobUrl = URL.createObjectURL(blob);
    sendResponse({ success: true, blobUrl, fileName });
  } catch (error) {
    if (error.name === "AbortError") {
      sendResponse({ success: false, error: "Build aborted." });
    } else {
      sendResponse({ success: false, error: error.message || "Build failed." });
    }
  } finally {
    activeBuilds.delete(message.buildId);
  }
}
