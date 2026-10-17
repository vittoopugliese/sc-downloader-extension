// FL Studio-style metronome: a short wooden tick on every beat, higher on the first beat of
// each 4/4 bar. Synthesized, so no audio files ship. It plays straight to the speakers:
// effects, the recorder and the WAV export never hear it.
const LOOKAHEAD = .12, TICK_MS = 25;

function tick(context, when, accent) {
  const out = context.createGain();
  out.gain.setValueAtTime(.0001, when);
  out.gain.exponentialRampToValueAtTime(accent ? .55 : .36, when + .0015);
  out.gain.exponentialRampToValueAtTime(.0001, when + (accent ? .07 : .05));
  out.connect(context.destination);
  const nodes = [out];
  // A body tone and an inharmonic partial give the woodblock color of FL's click.
  for (const [ratio, level] of [[1, 1], [2.76, .35]]) {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = 'sine'; osc.frequency.value = (accent ? 1568 : 1175) * ratio; gain.gain.value = level;
    osc.connect(gain).connect(out); osc.start(when); osc.stop(when + .08);
    nodes.push(osc, gain);
  }
  return nodes;
}

export function createMetronome() {
  let enabled = false, timer = 0, io = null, last = -Infinity;
  const live = new Set();
  function schedule() {
    const position = io?.position();
    if (position == null) return;
    const context = io.context, rate = io.rate() || 1, beat = 60 / io.bpm(), loop = io.loop();
    const reach = position + LOOKAHEAD * rate;
    // [from, to, seconds of timeline before `from`]: the loop wrap starts a second span.
    const spans = loop && position < loop.end && reach > loop.end
      ? [[position, loop.end, 0], [loop.start, loop.start + reach - loop.end, loop.end - position]]
      : [[position, reach, 0]];
    for (const [from, to, before] of spans) {
      for (let index = Math.ceil(from / beat - 1e-6); index * beat < to; index++) {
        const when = context.currentTime + (before + index * beat - from) / rate;
        // Ticks are scheduled once; the clock only moves forward.
        if (when < context.currentTime || when <= last + .02) continue;
        last = when;
        const nodes = tick(context, when, index % 4 === 0);
        live.add(nodes); nodes[1].onended = () => live.delete(nodes);
      }
    }
  }
  function silence() {
    for (const nodes of live) for (const node of nodes) { try { node.stop?.(); } catch {} node.disconnect(); }
    live.clear();
  }
  return {
    enabled: () => enabled,
    setEnabled(value) { enabled = !!value; if (!enabled) this.stop(); },
    // `position()` is the timeline time (null when stopped); bpm, rate and loop are read live.
    start(transport) {
      this.stop();
      if (!enabled) return;
      io = transport; last = -Infinity;
      schedule(); timer = setInterval(schedule, TICK_MS);
    },
    stop() { clearInterval(timer); timer = 0; io = null; silence(); },
  };
}
