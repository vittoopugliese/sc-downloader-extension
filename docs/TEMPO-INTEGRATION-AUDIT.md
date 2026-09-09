# Tempo integration audit

Audit date: 2026-09-09

Reference: `docs/FEATURE-MAP-SOUNDCLOUD-EXTENSIONS.md` and the local
`repos/soundcloud-tempo-control-main` source tree.

## Result

The compact player control is correctly isolated into a playback module and a
SoundCloud UI adapter. It implements the requested fixed `0.5x`-`2x` range,
`0.05x` increments, automatic application, native pitch preservation and host
write guards. It does not copy the reference project's advanced live
AudioWorklet graph, timeline, library, per-track profiles or extreme-rate
buffered transport.

The original integration had one important product gap: its state changed
live playback only. Loop export still cut the unmodified decoded source. That
gap is now closed for the current waveform A-B loop.

## Implemented seam

`SCLoopAudioRenderer.render(audioBuffer, trimRange, playbackTransform, hooks)`
is the single offline-render interface. It owns range extraction, output
duration, natural-pitch resampling, preserved-pitch Signalsmith rendering,
cancellation and progress. The downloader only decodes the source, invokes
this interface and encodes the returned PCM as WAV.

The selected player state crosses the page/download seam as:

```text
{ rate: 0.5..2, preservePitch: boolean }
```

The looper reads that snapshot when the user presses Download loop. The
download pipeline treats it as untrusted input: the renderer clamps it again
before processing.

## Audio ownership decision

Signalsmith runs only in the extension offscreen document while building a
WAV. It does not attach a `MediaElementAudioSourceNode`, AudioWorklet or second
output route to SoundCloud's player. Live playback remains owned by the native
media element plus the existing tempo guard; the looper bridge owns only
state/seek commands. This avoids double audio, competing graphs and lifecycle
races.

## Rendering behavior

- `1x`: copies the selected A-B PCM without tempo processing.
- Non-`1x`, Preserve Pitch off: renders at the selected rate with natural pitch
  movement, matching the player's native mode.
- Non-`1x`, Preserve Pitch on: uses the pinned Signalsmith Stretch WASM engine
  and retains the source pitch while changing duration.
- Output is always a newly encoded WAV. Its filename records the rate and pitch
  mode when processing is active.

## Provenance and verification

The packaged Signalsmith factory is byte-identical to the local reference repo:

```text
SHA-256 14c2c5858daff55746fb6c61dee3a67a9fc5ba5edf57ce715559297c041d3d89
```

The verification suite checks state propagation, natural-rate duration,
Signalsmith invocation, finite output, preserved frequency, cancellation
surface, manifest WASM policy, license presence and package inclusion.

## Remaining limitations

- Tempo preferences are global rather than saved per track.
- Live playback uses Chromium's native `preservesPitch`; Signalsmith is used
  only for deterministic file export.
- The current delivery covers waveform loop export, not the persistent player
  button's full-track download.
- Musical listening QA and a long live SoundCloud export remain release checks;
  synthetic tests cannot establish subjective quality for every source.
