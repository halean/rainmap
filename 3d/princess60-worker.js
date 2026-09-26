// Builds the full Princess 60 Nha Rong (princess60-nharong.js, ~1.72M
// triangles, ~1.7 s of CPU) off the main thread, and hands the geometry back
// as transferable buffers. Workers have no import map, so the model's module
// graph is relinked here: 'three' to the vendored build, relative imports to
// blob URLs of their relinked sources.
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
self.onmessage = async () => {
  try {
    const {createPrincess60NhaRong} = await import(await link(new URL('./princess60-nharong.js', self.location.href).href));
    const yacht = createPrincess60NhaRong();
    yacht.group.updateMatrixWorld(true);
    const materials = [], materialIndex = new Map(), meshes = [], transfer = new Set();
    // Its static flag is left out: in the city the ensign is the shared,
    // waving flag (flag.js), hung at the staff's top by princess60-berth.js.
    const skip = new Set([yacht.materials.flag, yacht.materials.star]);
    yacht.group.traverse(o => {
      if (!o.isMesh || skip.has(o.material)) return;
      if (!materialIndex.has(o.material)) { materialIndex.set(o.material, materials.length); materials.push(o.material.toJSON()); }
      const attributes = {};
      for (const [name, a] of Object.entries(o.geometry.attributes)) { attributes[name] = {array: a.array, itemSize: a.itemSize, normalized: a.normalized}; transfer.add(a.array.buffer); }
      const index = o.geometry.index ? o.geometry.index.array : null; if (index) transfer.add(index.buffer);
      meshes.push({name: o.name, material: materialIndex.get(o.material), matrix: o.matrixWorld.toArray(), attributes, index, visible: o.visible});
    });
    self.postMessage({meshes, materials, triangles: yacht.triangles, userData: yacht.group.userData}, [...transfer]);
  } catch (error) {
    self.postMessage({error: String(error?.stack || error)});
  }
};
