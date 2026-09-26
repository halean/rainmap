// The fireworks' sound, synthesised with the Web Audio API (no recordings):
// the thump of each mortar and the whistle of some shells rising, the boom
// of each burst with its echo off the city, the crackle of crackling stars,
// the hiss of willows and the sharp bang of salutes.
//
// Each sound reaches the listener (the camera) after the time sound takes
// to cross the distance (343 m/s), so a burst 700 m off is seen two seconds
// before it is heard. It is quieter and duller the further off (air takes
// the high notes first), and panned by where it is in the view. Browsers
// only allow sound after a click: resume() is called from the Fireworks
// button. It falls silent while the page is hidden or unfocused. On an iPhone it also sets the audio session to playback, so the
// ring/silent switch doesn't mute it. See FIREWORKS.md.

export const SPEED_OF_SOUND = 343;
/** Seconds for sound to travel d metres. */
export const soundDelay = d => d / SPEED_OF_SOUND;
/** Loudness at d metres (1 at 150 m and nearer), and the low-pass cutoff (Hz) of the air in between. */
export const attenuation = d => ({gain: Math.min(1, 150 / Math.max(1, d)), cutoff: Math.max(900, 16000 * Math.exp(-d / 900))});

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
  let ctx = null, master = null, bus = null, impulse = null, noise = null;
  const listener = {x: 0, y: 0, z: 0, rx: 1, rz: 0};                            // position, and the view's right (for panning)

  function init() {
    if (ctx || !AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;   // the finale must not clip
    master.connect(comp).connect(ctx.destination);
    // White noise, shared by every sound.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // The echo off the city: a 3 s decaying noise impulse response.
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

  /** A chain for a sound at p, `lag` seconds after now (plus the travel time): returns the node to feed and its start time. */
  function voice(p, lag, loud) {
    const dx = p[0] - listener.x, dy = p[1] - listener.y, dz = p[2] - listener.z, d = Math.hypot(dx, dy, dz);
    const {gain, cutoff} = attenuation(d), at = ctx.currentTime + Math.max(0, lag) + soundDelay(d);
    const g = ctx.createGain(); g.gain.value = gain * loud;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();   // no panner before Safari 14.1
    if (pan.pan) pan.pan.value = Math.max(-1, Math.min(1, (dx * listener.rx + dz * listener.rz) / Math.max(1, d)));
    g.connect(lp).connect(pan); pan.connect(bus.dry);
    const send = ctx.createGain(); send.gain.value = Math.min(1, 0.4 + d / 1500); pan.connect(send).connect(bus.reverb);   // far off, more of it is echo
    state.played++;
    return {input: g, at};
  }
  function noiseBurst(out, at, dur, {attack = 0.003, from = 3000, to = 300, q = 0.7, type = 'lowpass', level = 1} = {}) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    const env = ctx.createGain(); env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(level, at + attack); env.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    src.connect(f).connect(env).connect(out); src.start(at, Math.random() * 1.5); src.stop(at + dur + 0.05);
  }
  function tone(out, at, dur, f0, f1, level, type = 'sine') {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const env = ctx.createGain(); env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(level, at + 0.01); env.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    o.connect(env).connect(out); o.start(at); o.stop(at + dur + 0.05);
  }

  /** A mortar firing at p; some shells whistle on the way up (`rise` s). */
  function launch(p, lag, rise, whistle) {
    if (!ready()) return;
    const {input, at} = voice(p, lag, 0.3);
    tone(input, at, 0.25, 120, 40, 1.0);                                          // the thump
    noiseBurst(input, at, 0.3, {from: 1800, to: 200, level: 0.6});
    if (whistle) tone(input, at + 0.05, rise * 0.9, 900 + Math.random() * 300, 2600 + Math.random() * 900, 0.12, 'triangle');
  }
  /** A burst at p: its boom, and what follows for the effect. */
  function burst(p, lag, type, size) {
    if (!ready()) return;
    const big = Math.min(1.4, size / 80), {input, at} = voice(p, lag, type === 'salute' ? 1.4 : 1.15 * big);
    if (type === 'salute') { noiseBurst(input, at, 0.5, {attack: 0.001, from: 6000, to: 400, level: 1.2}); tone(input, at, 0.4, 90, 35, 0.9); }
    else { noiseBurst(input, at, 1.1 + 0.5 * big, {attack: 0.004, from: 2200, to: 90, level: 1}); tone(input, at, 0.9, 70, 28, 0.9 * big); }
    if (type === 'crackle' || type === 'salute') {                                 // crackle: a scatter of tiny sharp pops
      const n = type === 'crackle' ? 70 : 25, start = type === 'crackle' ? 1.2 : 0.3;
      for (let i = 0; i < n; i++) noiseBurst(input, at + start + Math.random() * 1.6, 0.025, {attack: 0.0005, from: 5000 + Math.random() * 3000, to: 2000, type: 'bandpass', q: 1.2, level: 0.25 + Math.random() * 0.3});
    }
    if (type === 'willow' || type === 'palm') noiseBurst(input, at + 0.2, 3.5, {attack: 0.8, from: 7000, to: 3000, type: 'highpass', level: 0.08});   // the hiss of falling embers
  }
  return {state, resume, setEnabled, setListener, launch, burst, get context() { return ctx; }};
}
