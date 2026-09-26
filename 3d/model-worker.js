// Builds a procedural model off the main thread and hands its geometry back
// as transferable buffers, so a heavy landmark never stalls the page while
// it builds. Used by seven-kho-city.js (princess60-worker.js does the same for
// Nha Rong). Workers have no import map, so the model's module graph is
// relinked here: 'three' to the vendored build, relative imports to blob URLs
// of their relinked sources.
//
// Message in:  {module: './seven-kho.js', create: 'createSevenKho', options, hide: [component names]}
// Message out: {meshes: [{name, material, matrix, attributes, index, visible}], materials: [JSON], triangles}
const THREE_URL = new URL('./vendor/three.module.js', self.location.href).href;
const linked = new Map();
async function link(url) {
  if (linked.has(url)) return linked.get(url);
  let src = await (await fetch(url)).text();
  const deps = new Set([...src.matchAll(/\bfrom\s*['"](\.\.?\/[^'"]+)['"]/g)].map(m => m[1]));
  for (const d of deps) { const blob = await link(new URL(d, url).href); src = src.split(`'${d}'`).join(`'${blob}'`).split(`"${d}"`).join(`"${blob}"`); }
  src = src.replace(/\bfrom\s*['"]three['"]/g, `from '${THREE_URL}'`);
  const blob = URL.createObjectURL(new Blob([src], {type: 'text/javascript'}));
  linked.set(url, blob); return blob;
}
self.onmessage = async ({data: {module, create, options = {}, hide = []}}) => {
  try {
    const mod = await import(await link(new URL(module, self.location.href).href));
    const model = mod[create](options);
    model.group.updateMatrixWorld(true);
    const hidden = new Set(hide.map(k => model.components?.[k]).filter(Boolean));
    const materials = [], materialIndex = new Map(), meshes = [], transfer = new Set();
    let triangles = 0;
    model.group.traverse(o => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (hidden.has(p)) return;
      if (!materialIndex.has(o.material)) { materialIndex.set(o.material, materials.length); materials.push(o.material.toJSON()); }
      const attributes = {};
      for (const [name, a] of Object.entries(o.geometry.attributes)) { attributes[name] = {array: a.array, itemSize: a.itemSize, normalized: a.normalized}; transfer.add(a.array.buffer); }
      const index = o.geometry.index ? o.geometry.index.array : null; if (index) transfer.add(index.buffer);
      triangles += (index ? index.length : o.geometry.attributes.position.count) / 3;
      meshes.push({name: o.name, material: materialIndex.get(o.material), matrix: o.matrixWorld.toArray(), attributes, index, visible: o.visible});
    });
    self.postMessage({meshes, materials, triangles}, [...transfer]);
  } catch (error) {
    self.postMessage({error: String(error?.stack || error)});
  }
};
