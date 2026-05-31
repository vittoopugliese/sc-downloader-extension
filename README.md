# 🎵 SoundCloud Downloader

> Download SoundCloud tracks, playlists, and likes ~ right from your browser. One extension, one click (or one ZIP).

![ImagePreview](./assets/readme_preview.jpeg)

## 🆕 Update ~ 2026.06.01

This release is a **big one**. What started as a single-track downloader is now a fully polished bulk-download tool ~ with a ton of bug fixes and UX improvements along the way.

![ImagePreview](./assets/readme_inline_download.jpeg)

**Highlights:**
- **Inline download button** ~ download tracks directly from SoundCloud's action bar (Like/Repost/Share) without opening the popup
- **Playlists, sets & albums** ~ download an entire collection as a single `.zip`
- **Likes** ~ your own (`/you/likes`) or any user's public likes page
- **Configurable batch size** ~ choose how many tracks to grab: `25`, `50`, `100`, `200`, or **All**
- **No login required** for most public tracks (OAuth fallback when needed)
- **Modern AAC HLS streaming** support ~ SoundCloud's current format, handled automatically
- **SPA-friendly** ~ switch tracks, playlists, or pages without reloading SoundCloud
- **Polished UI** ~ loading spinner, clear error states, download progress, and a unified popup for tracks & collections

If you used an older version and ran into bugs ~ stale track data, blank screens, login-only downloads ~ this update was built to fix exactly that. 🎉

---

## ✨ Features

### Single tracks
- Track title, artwork, and artist info (with clickable profile link)
- Duration and stream format (e.g. `AAC HLS 160k`)
- Waveform visualization
- One-click download ~ works on public tracks without signing in
- **Inline download button** on the track page action bar (next to Like/Repost/Share) ~ same download flow, no popup needed

### Playlists, sets & albums
- Open any `soundcloud.com/{user}/sets/{name}` page
- See the collection title, artist, total track count, and waveform preview (first track)
- Pick how many tracks to download from the inline preset selector
- Download everything as a numbered `.zip` file

### Likes
- **Your likes:** `soundcloud.com/you/likes` (requires being logged in)
- **Anyone's likes:** `soundcloud.com/{username}/likes`
- Same UI and ZIP download flow as playlists

### Bulk download controls
- Presets: **25 · 50 · 100 · 200 · All**
- Options adapt to the actual collection size (e.g. a 30-track playlist shows `25` and `All (30)`)
- Warning prompt before large downloads (200+ tracks) ~ because yes, you *can* download thousands, but your RAM might have opinions

### Reliability & UX
- Deferred metadata loading ~ fast popup open, full resolution only when you hit download
- Loading overlay with retry on timeout
- Clear error screen when you're not on a supported page
- Download progress: `Track 3/50 ~ Downloading 12/48 parts...`
- SPA navigation detection ~ no more stale track data when browsing SoundCloud

---

## 🚀 How It Works

### Download a single track
1. Go to any SoundCloud **track** page
2. Click the **inline download button** in the action bar (next to Like/Repost/Share), **or** click the extension icon and use the popup download button
3. Wait for the track info to load (popup only)
4. Hit download ~ the file saves to your browser's default download folder

### Download a playlist or likes
1. Go to a **playlist/set** page or a **likes** page
2. Click the extension icon
3. Choose how many tracks to download from the dropdown next to the track count
4. Hit the download button
5. Grab your `.zip` when it's ready

---

## 🎨 User Interface

One popup, two modes ~ same look, same feel:

| Track page | Playlist / Likes page |
|---|---|
| Title · artist · duration · format | Title · artist · `{N} tracks · [preset]` |
| Waveform | Waveform (first track) |
| Inline button + popup download | Download button → ZIP |

Dark blurred artwork background, SoundCloud-orange accents, spinner states, and status text that actually tells you what's going on.

---

## 🛠️ Technical notes

- **Manifest V3** Chrome extension
- Streams resolved via SoundCloud's `api-v2` (public `client_id` + optional OAuth cookie)
- HLS segments fetched and assembled client-side; output as `.m4a` / `.mp3` depending on source
- ZIP built in-popup with JSZip (store compression ~ audio is already compressed)
- Large collections: pagination handled automatically; choose your limit wisely

---

## 💡 Feedback

Something not working? A feature you'd love to see next?
- Open a Pull Request, send me an email, or drop a message ~ I'd love to hear from you.

---

## ⚠️ Disclaimer

Please respect artists' rights and SoundCloud's terms of service when using this extension. Download only content you have the right to save for personal use.

---

*Made with ❤️ for music lovers ~ and for myself, obviously.*
