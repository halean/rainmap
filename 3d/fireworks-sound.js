// The fireworks' sound, built from physics (fireworks-acoustics.js) and
// played with the Web Audio API -- no recordings.
//
// Every launch and burst is rendered into its own stereo buffer: the source
// waveform (a blast pulse, a mortar's muzzle blast and tube ring, crackling
// stars' micro-blasts, a whistle, combustion hiss), sent along each path to
// the listener (the camera) -- direct, off the river, and off each tall
// building -- each arrival delayed by its own length at the speed of sound
// for the air's temperature and the wind, filtered by the air's absorption
// over that length (ISO 9613-1), scaled by spreading, and panned from the
// direction it arrives from. A burst 700 m off is seen two seconds before
// it is heard, booms rather than cracks, and comes back off the towers.
// A diffuse tail (multiple scattering in the city) is added by a convolver.
// The rendering (fireworks-render.js) runs in a Web Worker, so a finale
// never stalls the animation; the buffers are started when their first
// arrival is due.
//
// Browsers only allow sound after a click: resume() is called from the
// Fireworks button. It falls silent while the page is hidden or unfocused.
// On an iPhone it also sets the audio session to playback, so the ring/silent
// switch doesn't mute it. See FIREWORKS.md.
import {atmosphereAt, soundSpeed} from './fireworks-acoustics.js';
import {render} from './fireworks-render.js';

/** Seconds for sound to travel d metres through air at T °C. */
export const soundDelay = (d, T = 28) => d / soundSpeed(T);

/** A second of silence as a WAV, for the <audio> element that holds iOS's playback session. */
function silentWav() {
  const n = 8000, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer), w = (o, t) => [...t].forEach((c, i) => b[o + i] = c.charCodeAt(0));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], {type: 'audio/wav'}));
}

export function createFireworkSound({volume = 0.8} = {}) {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const state = {enabled: true, available: !!AC, running: false, focused: true, played: 0};
  let ctx = null, master = null, bus = null, impulse = null;
  const listener = {x: 0, y: 0, z: 0, rx: 1, rz: 0};                            // position, and the view's right (for panning)

  function init() {
    if (ctx || !AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;   // the finale must not clip
    master.connect(comp).connect(ctx.destination);
    // The diffuse tail: sound scattered again and again among the buildings, a 3 s decay.
    const n = Math.floor(ctx.sampleRate * 3), ir = impulse = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < n; i++) { const t = i / ctx.sampleRate; ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 1.6) * (t < 0.08 ? t / 0.08 : 1); } }
    bus = makeBus();
  }
  /** What the voices feed: a dry input and the echo, into master. Replaced
   *  when the page loses focus, so sounds already scheduled are cut off
   *  instead of all playing at once when it comes back. */
  function makeBus() {
    const dry = ctx.createGain(), reverb = ctx.createConvolver(), wet = ctx.createGain();
    reverb.buffer = impulse; wet.gain.value = 0.45;
    dry.connect(master); reverb.connect(wet).connect(master);
    return {dry, reverb, wet};
  }
  /** Call from a click or tap (browsers allow sound only after one); it must
   *  run inside the tap's handler, not after an await. */
  let silent = null, rearmed = false;
  function resume() {
    // iPhone: Web Audio follows the ring/silent switch unless the page's
    // audio session is 'playback' (Safari 16.4+); before that, a looping
    // silent <audio> element puts the session into playback.
    try { if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (!globalThis.navigator?.audioSession && globalThis.Audio && !silent) {
      try { silent = new Audio(silentWav()); silent.loop = true; silent.setAttribute?.('playsinline', ''); silent.play()?.catch?.(() => {}); } catch {}
    }
    state.focused = !globalThis.document?.hidden;                       // a tap: the page is in front
    init();
    if (!ctx) return;
    // iOS unlocks Web Audio only once a sound starts inside the tap: a one-sample silence.
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); } catch {}
    if (ctx.state !== 'running') ctx.resume?.()?.catch?.(() => {});
    state.running = true;
    // iOS suspends ('interrupted') the audio on calls, lock and tab switches: the next tap brings it back.
    if (!rearmed && globalThis.document) {
      rearmed = true;
      const wake = () => { if (ctx && ctx.state !== 'running' && state.enabled && state.focused) { ctx.resume?.()?.catch?.(() => {}); silent?.play()?.catch?.(() => {}); } };
      for (const e of ['touchend', 'pointerdown', 'keydown']) document.addEventListener(e, wake, {passive: true});
    }
  }
  function setEnabled(on) { state.enabled = on; if (master) master.gain.value = on ? volume : 0; if (!on) silent?.pause(); }
  function setListener(camera) {
    listener.x = camera.position.x; listener.y = camera.position.y; listener.z = camera.position.z;
    const e = camera.matrixWorld.elements; listener.rx = e[0]; listener.rz = e[2];   // the camera's x axis: its right
  }
  const ready = () => ctx && state.enabled && state.focused && ctx.state === 'running';

  // Silent while the page is hidden or unfocused; back on return.
  const doc = globalThis.document;
  state.focused = !doc || (!doc.hidden && (doc.hasFocus?.() ?? true));
  function focusChanged() {
    const focused = !doc.hidden && doc.hasFocus();
    if (focused === state.focused) return;
    state.focused = focused;
    if (!ctx) return;
    if (!focused) {
      bus.dry.disconnect(); bus.wet.disconnect(); bus = makeBus();      // drop what was already scheduled
      ctx.suspend?.()?.catch?.(() => {}); silent?.pause();
    } else if (state.enabled && state.running) {
      ctx.resume?.()?.catch?.(() => {}); silent?.play()?.catch?.(() => {});
    }
  }
  if (doc) {
    doc.addEventListener('visibilitychange', focusChanged);
    globalThis.addEventListener?.('blur', focusChanged); globalThis.addEventListener?.('focus', focusChanged);
    globalThis.addEventListener?.('pagehide', focusChanged); globalThis.addEventListener?.('pageshow', focusChanged);
  }

  // --- The air, the wind and the city. ---
  let wind = [0, 0], reflectors = [];
  function setWind(w) { wind = w; }
  /** Tall buildings to echo off: [{x, y, z, area}], area of the facade (m²). */
  function setReflectors(list) { reflectors = list; }
  const scene = () => ({sr: ctx.sampleRate, ear: [listener.x, listener.y, listener.z], right: [listener.rx, listener.rz],
    atm: atmosphereAt((new Date().getUTCHours() + 7 + new Date().getUTCMinutes() / 60) % 24), wind, reflectors});

  // --- Rendering, off the main thread where there is a Worker. ---
  let worker = null, nextId = 1;
  const pending = new Map();
  try {
    if (globalThis.Worker && globalThis.document) {
      worker = new Worker(new URL('./fireworks-sound-worker.js', import.meta.url), {type: 'module'});
      worker.onmessage = ({data}) => { const job = pending.get(data.id); pending.delete(data.id); if (job && data.out) schedule(job, data.out); else if (data.error) state.renderError = data.error; };
      worker.onerror = () => { worker = null; };                          // no module workers: render inline
    }
  } catch { worker = null; }
  /** Ask for a render; the event happened `lag` s ago (<= 0) relative to now. */
  function request(kind, args, lag) {
    if (!ready()) return;
    const job = {asked: ctx.currentTime, lag, bus};
    if (worker) { const id = nextId++; pending.set(id, job); worker.postMessage({id, kind, scene: scene(), args}); }
    else schedule(job, render(kind, scene(), args));
  }
  /** Start the rendered buffers when their first arrival is due; if the render took longer than
   *  the sound's travel time, start partway in. Dropped if the page lost focus meanwhile. */
  function schedule(job, out) {
    if (!ready() || job.bus !== bus) return;
    for (const {L, R, delay, wet} of out) {
      const buf = ctx.createBuffer(2, L.length, ctx.sampleRate); buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const send = ctx.createGain(); send.gain.value = wet;
      src.connect(bus.dry); src.connect(send).connect(bus.reverb);
      const when = job.asked + job.lag + delay, now = ctx.currentTime;
      if (when >= now) src.start(when); else if (now - when < buf.duration) src.start(now, now - when); else continue;
      state.played++;
    }
  }
  /** A mortar firing at p; with `whistle`, the shell whistles up its flight (from p at v, for `rise` s). */
  function launch(p, lag, rise, whistle, v = null) { request('launch', [p, rise, whistle, v], lag); }
  /** A burst at p of the given effect and size (its radius, m). */
  function burst(p, lag, type, size) { request('burst', [p, type, size], lag); }
  return {state, resume, setEnabled, setListener, setWind, setReflectors, launch, burst, get context() { return ctx; }, get pending() { return pending.size; }};
}
