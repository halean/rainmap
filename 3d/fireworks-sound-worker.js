// Renders firework sounds off the main thread (fireworks-render.js), so a
// finale's worth of blasts, echoes and whistles never stalls the animation.
// Receives {id, kind, scene, args}; replies {id, out: [{L, R, delay, wet}]},
// the sample arrays transferred, not copied. See FIREWORKS.md.
import {render} from './fireworks-render.js';

self.onmessage = ({data: {id, kind, scene, args}}) => {
  try {
    const out = render(kind, scene, args);
    self.postMessage({id, out}, out.flatMap(o => [o.L.buffer, o.R.buffer]));
  } catch (error) {
    self.postMessage({id, error: String(error?.message ?? error)});
  }
};
