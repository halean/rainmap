// The viewer's startup layer (assets/overview-base.glb) against the full overview:
// it must draw the same water and green, and put the street lamps in the same places.
// node --loader ./tests/three-loader.mjs tests/overview_base.mjs
import fs from 'node:fs';import assert from 'node:assert/strict';import * as THREE from 'three';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {createCityLighting} from '../3d/city-lighting.js';
const manifest=JSON.parse(fs.readFileSync(new URL('../3d/assets/manifest.json',import.meta.url)));
const load=async url=>{const b=fs.readFileSync(new URL(`../3d/${url}`,import.meta.url));assert.equal(b.length,url===manifest.overview.url?manifest.overview.bytes:manifest.overviewBase.bytes);return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;};
const full=await load(manifest.overview.url),base=await load(manifest.overviewBase.url);
const named=root=>{const m={};root.traverse(o=>{if(o.isMesh||o.isLineSegments)m[o.name]=o;});return m;};
const F=named(full),B=named(base);
assert.deepEqual(Object.keys(B).sort(),['green','major','street','water']);
for(const k of ['water','green']){
  assert(B[k].isMesh);
  assert.deepEqual(B[k].geometry.attributes.position.array,F[k].geometry.attributes.position.array,`${k} positions`);
  assert.deepEqual(B[k].geometry.attributes.normal.array,F[k].geometry.attributes.normal.array,`${k} normals`);
  assert.equal(B[k].material.color.getHexString(),F[k].material.color.getHexString(),`${k} colour`);
}
full.updateMatrixWorld(true);base.updateMatrixWorld(true);
assert(B.major.matrixWorld.equals(F.major.matrixWorld),'Same placement');
for(const k of ['major','street'])assert(B[k].isLineSegments&&B[k].geometry.attributes.position.count<=1500,`${k}: lamp samples only`);
assert(manifest.overviewBase.bytes<manifest.overview.bytes*.4,`Base layer is small: ${manifest.overviewBase.bytes}`);

// Street lamps, placed by the real city-lighting.js from each layer, across the city at night.
const lampsAt=(root,target)=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),controls={target:target.clone()};
  camera.position.copy(target).add(new THREE.Vector3(0,400,400));scene.add(camera);
  const lighting=createCityLighting({scene,camera,controls,sky:{state:{cityLights:1}}});lighting.register(root);lighting.update(1000);
  const out=[];scene.traverse(o=>{if(o.isSpotLight&&o.visible)out.push(o.target.position.toArray().map(v=>+v.toFixed(3)));});return out;
};
const b=manifest.boundsXZ;let placed=0;
for(let i=0;i<=6;i++)for(let j=0;j<=6;j++){
  const t=new THREE.Vector3(b[0]+(b[2]-b[0])*i/6,0,b[1]+(b[3]-b[1])*j/6);
  const a=lampsAt(full,t),c=lampsAt(base,t);assert.deepEqual(c,a,`Lamps at ${t.x.toFixed(0)},${t.z.toFixed(0)}`);placed+=a.length;
}
assert(placed>50,`Lamps were placed somewhere: ${placed}`);

// The viewer starts from the base layer; the download stays the full overview.
const viewer=fs.readFileSync(new URL('../3d/viewer.js',import.meta.url),'utf8');
assert.match(viewer,/const base=manifest\.overviewBase\?\?manifest\.overview;[^\n]*\n[^\n]*loadAsync\(base\.url/);
assert.match(viewer,/\$\('download'\)\.href=nearest\?nearest\.url:manifest\.overview\.url/);
console.log('overview base OK',{bytes:manifest.overviewBase.bytes,full:manifest.overview.bytes,lamps:placed});
