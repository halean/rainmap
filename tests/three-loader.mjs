// Node has no importmap support; the browser gets "three" -> 3d/vendor/three.module.js
// via 3d/index.html's <script type="importmap">, so tests that import a 3d/*.js
// module need the same redirect here. Used only for `node --loader`.
const THREE_URL = new URL('../3d/vendor/three.module.js', import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return {url: THREE_URL, shortCircuit: true};
  return nextResolve(specifier, context);
}

// 3d/*.js ships for the browser (plain <script type="module">, no
// package.json "type") so Node's default CJS-by-extension detection would
// otherwise reject its `import` statements; force ESM for that directory.
export async function load(url, context, nextLoad) {
  const path = url.split('?')[0];
  if (path.includes('/3d/') && path.endsWith('.js')) return nextLoad(url, {...context, format: 'module'});
  return nextLoad(url, context);
}
