// Renders thunder off the main thread so the flash never stutters: a render
// is ~100-400 ms of arithmetic, and the multi-stroke flicker it would
// otherwise stall lasts about that long. thunder.js has no DOM or three.js
// dependency, which is what makes it importable here.
import {renderThunder} from './thunder.js';

self.onmessage = ({data}) => {
  const {id, segments, listener, options} = data;
  const rendered = renderThunder(segments, listener, options);
  if (!rendered) { self.postMessage({id, rendered: null}); return; }
  self.postMessage({id, rendered}, [rendered.samples.buffer]);
};
