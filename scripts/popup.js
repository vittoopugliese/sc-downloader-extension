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

          if (!response.artwork_url) artwork.style.backgroundColor = "black";

          if (response.waveform_url) await drawWaveform(response.waveform_url);

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


async function drawWaveform(waveformUrl) {
  const ctx = waveformCanvas.getContext('2d');

  try {
    const response = await fetch(waveformUrl);
    const waveformData = await response.json();
    
    ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    ctx.fillStyle = 'rgba(240, 240, 240, 0.5)';
    
    const samples = waveformData.samples || [];
    const maxSample = Math.max(...samples.map(Math.abs));
    
    const canvasHeight = waveformCanvas.height;
    const canvasWidth = waveformCanvas.width;
    const barWidth = canvasWidth / samples.length;
    
    samples.forEach((sample, index) => {
      const normalizedSample = sample / maxSample;
      const barHeight = Math.abs(normalizedSample) * (canvasHeight / 2);
      const x = index * barWidth;
      const y = (canvasHeight / 2) - (barHeight / 2);
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // at the final step, show the waveform ... 
    waveformCanvas.style.display = "flex";
  } catch (error) {
    console.error('Error drawing Waveform:', error);
    waveformCanvas.style.display = "none";
  };
};