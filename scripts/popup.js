document.addEventListener("DOMContentLoaded", () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {type: "GET_TRACK_DATA"},
      async (response) => {
        if (response) {
          title.textContent = response.title;
          artist.textContent = response.artist;
          artistUrl.href = response.artistUrl;
          artistArtwork.src = response.artistImageUrl;
          duration.textContent = `${response.duration}`;
          artwork.style.backgroundImage = `url(${response.artwork_url})` || "placeholder.png";

          downloadBtn.addEventListener("click", async () => {
            if (response.streamUrl) {
              try {
                const result = await chrome.runtime.sendMessage({
                  type: "GET_MP3_URL",
                  streamUrl: response.streamUrl
                });

                if (result.success && result.url) {
                  await forceDownload(result.url, response);
                } else {
                  alert("Error: " + (result.error || "Cannot obtain final file URL."));
                };

              } catch (error) {
                alert("Error communicating with Background Script. " + error.message);
              };
            } else {
              alert("Cannot obtain stream URL.");
            };
          });
        } else {
          title.textContent = "Error loading track data.";
          artist.textContent = "You should be on the track main page!";
          duration.textContent = "";
          downloadBtn.style.display = "none";
          desiredPage.style.display = "flex";
        }
      }
    );
  });
});

function sanitizeFilename(response) {
  const fileName = `${response.artist} - ${response.title}`;
  const sanitizedFileName = fileName.replace(/[^a-z0-9 -]/gi, " ");
  return `${sanitizedFileName}.mp3`;
}

async function forceDownload(url, response) {
  const fileName = sanitizeFilename(response);

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.error("Error downloading file:", error);
  };
};