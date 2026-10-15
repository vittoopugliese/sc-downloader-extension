import { mountDrumSampler } from './stem-sampler.mjs';
import { mountDrumSequencer } from './stem-sequencer.mjs';
import { mountStemPiano } from './stem-piano.mjs';

// A track owns its samples, rack and melody. Only its two editors share a grid;
// playback and speed belong to the playlist.
export function mountTrackEditor({ saved, changed, ...options }) {
  const sampler = mountDrumSampler({ ...options, saved: saved?.slices,
    changed() { sequencer.samplesChanged(); } });
  const sequencer = mountDrumSequencer({ ...options, sampler, saved: saved?.sequence,
    changed: change => { piano.gridChanged(); return changed(change); } });
  const piano = mountStemPiano({ ...options, saved: saved?.piano,
    getGrid: () => sequencer.grid(), setGrid: value => sequencer.setGrid(value), changed });
  // Selecting a sample or a beat must have exactly one recipient on this waveform.
  const cancelOther = event => {
    if (event.target.closest('.piano-sample,.stem-piano-toggle')) sampler.cancelPlacement();
    else if (event.target.closest('.stem-sampler-toggle,.stem-pad,.seq-set-start,.seq-sample')) piano.sampler.cancelPlacement();
  };
  options.actions.addEventListener('click', cancelOther);
  options.row.addEventListener('click', cancelOther);
  return {
    sampler, sequencer, piano,
    snapshot: () => ({ slices: sampler.snapshot(), sequence: sequencer.snapshot(), piano: piano.snapshot() }),
    place: seconds => piano.sampler.place(seconds) || sequencer.place(seconds) || sampler.place(seconds),
    render() { sampler.render(); sequencer.renderMarker(); piano.sampler.render(); },
    updateGain() { sampler.updateGain(); piano.updateGain(); },
    updateTransport(...args) { sequencer.updateTransport(...args); piano.updateTransport(...args); },
    dispose() {
      options.actions.removeEventListener('click', cancelOther); options.row.removeEventListener('click', cancelOther);
      piano.dispose(); sequencer.dispose(); sampler.dispose();
    },
  };
}
