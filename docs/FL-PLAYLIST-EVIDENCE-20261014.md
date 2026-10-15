# FL Studio playlist evidence — 2026-10-14

Purpose: guide a web audio playlist for the existing stem extractor. This records installation identity, documented interactions and the limits of native analysis. No FL Studio code was decompiled, no FL Studio process was started, and no native assets were copied into the application.

## Local observations

The user selected `C:\Program Files\Image-Line\FL Studio 2025`.

| Artifact | Bytes | Windows file/product version | SHA-256 |
| --- | ---: | --- | --- |
| `FL64.exe` | 1,099,256 | 25.2.4.5242 | `4E5FEE4031653AE0B85ACF8278E95C8BDC9109474BEA539EDF987CCBD6700C64` |
| `FLEngine_x64.dll` | 57,338,872 | 25.2.4.5242 | `B74993C5B6F3E8CAA7C82DC279E48218271D7722F32CD9B862A50AFD3FE143DC` |

Read-only PowerShell inspection of both files found a PE signature, machine `0x8664`, PE32+ optional-header magic `0x020B`, and a zero CLR directory RVA/size. This supports routing these two artifacts to native x64 analysis rather than managed assembly decompilation. It does not identify playlist procedures or prove which DLL owns them.

The installed `Help\index_offline.html` describes obtaining an offline manual. A bounded filename search under `Help` found no playlist/audio-clip/sampler manual pages. Online primary documentation was therefore used for interaction requirements. Local `HelpAliases.scr`, `WhatsNew.htm` and a separate help subtree exist, but were not treated as execution evidence.

## REA and Ghidra availability

- No REA MCP analysis tools are advertised in this agent session. `Get-Command rea` did not resolve a CLI. This establishes session/PATH availability only; it does not establish that REA is absent from the entire machine.
- A targeted search in `C:\Users\torib\.codex\config.toml` found no REA/Ghidra registration matches. The active account's `CODEX_HOME` points elsewhere; reading that account config was denied by the sandbox. Its registration remains unknown. No config was changed and no package acquisition was attempted.
- The supplied `C:\Users\torib\Downloads\ghidra-Ghidra_12.1.4_build` contains `build.gradle`, `gradlew`, source directories and runtime-script templates. The recursive bounded search found `analyzeHeadless.bat` only in `Ghidra\RuntimeScripts\Windows\support`, no `decompile.exe`, and only bundled support/DMG jars rather than compiled Ghidra modules.
- Its own `README.md` distinguishes the source archive from a runnable release. The observed tree is not a ready installed Ghidra release. Source compilation and dependency acquisition were not attempted.
- `node.exe` and `java.exe` resolve on PATH. Runtime versions and Ghidra compatibility were not validated because there is no ready engine in the selected tree.

Native decompilation therefore remains unresolved. A connected REA native provider or runnable Ghidra distribution is needed before any procedure-level claim. A disassembler would produce partial pseudocode; it would not directly produce a working web application or establish playback behavior without further analysis. No REA Evidence IDs exist for this pass: all local findings above are ordinary filesystem/PE observations.

## Documented interaction requirements

These are observations of current official documentation, not observations of the installed application's runtime. The online manual is updated independently and may describe features newer than version 25.2.4.5242.

### Playlist

The manual describes a horizontal musical timeline with overlapping clips and multiple tracks. Moving clips follows snap settings, with Alt temporarily bypassing snap. Slip editing moves content while retaining clip boundaries. Slice divides clips. Clip mute and track mute are separate. Track solo, horizontal zoom and seeking are supported. Play/pause preserves playback position; stop behavior can return to a remembered start. Stretching an audio clip's edge uses its stretching mode, and pitch preservation requires a mode other than Resample. Audio, pattern and automation clips can share tracks; playlist lanes are not inherently mixer channels. [Official Playlist manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm)

### Audio clips

Audio files can be dragged into the playlist. Clip properties distinguish individual instances from shared channel settings. Per-instance controls include gain, semitone/fine pitch, mute, reverse, start and duration. Pitch changes preserve length. Fades and clip gain can be edited per instance; overlapping clips can use automatic crossfades. Sample duplication can reuse the original audio file; a separate option creates a new physical sample. [Official Audio Clips manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist_audioclip.htm)

### Pitch and time

Sampler controls distinguish pitch, duration and a time multiplier. Resample couples pitch to playback speed and length. Stretch allows independent pitch and duration changes. The documentation identifies Elastique algorithms and distinguishes real-time and precomputed processing. These are product descriptions, not recovered DSP implementation. [Official Sampler manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/chansettings_sampler.htm)

## Web design implications (inferences and design choices)

- Keep immutable decoded sample data separate from editable clip instances. A clip needs its own track, timeline position, source offset, source range, duration, pitch, gain, reverse and mute state. This is a proposed implementation model, not a recovered native data structure.
- Moving changes timeline position/track; trimming changes the audible source range; slipping changes source offset while retaining timeline bounds; stretching changes the source-to-timeline mapping. These operations should remain distinct.
- Pitch independent of length needs actual audio processing. A UI pitch knob alone is insufficient. A resampling implementation should disclose the resulting duration change rather than claim FL-style stretch behavior.
- Undo should restore arrangement state without copying entire decoded audio buffers. Export should use the same clip timing, pitch, gain and mute interpretation as playback.
- An audio arrangement editor covers the user's stem/sample use case. Full FL Playlist parity additionally includes pattern and automation clip systems, arrangements, markers, detailed routing, recording and many editing modes; those cannot be claimed merely because draggable waveforms work.

## Coverage ledger

| Question | Status | Evidence / remaining gap |
| --- | --- | --- |
| Installed target identity | Answered | File metadata, SHA-256 and PE header inspection above |
| Move/snap, slip, slice, stretch and transport semantics | Partially answered | Official current manual; installed-version behavior not exercised |
| Per-instance pitch versus source/global settings | Partially answered | Official current manual; native ownership/data flow unknown |
| Native playlist procedures and DSP internals | Unresolved | No connected REA tools or runnable engine in selected Ghidra tree |
| Recovered source suitable for direct web port | Unresolved | No decompilation performed; no recovered source exists |
| Audio quality / latency parity with FL Studio | Unresolved | Requires implementation-specific audio measurements and listening tests |

Searches were limited to the selected installation/help directory, supplied Ghidra tree, advertised tools, shell command resolution and two narrowly selected Codex config locations. No wider disk scan, unrelated application investigation, install, licensing change or target execution occurred.
