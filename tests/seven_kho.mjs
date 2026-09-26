import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {createSevenKho} from '../3d/seven-kho.js';
const m=createSevenKho();assert.equal(m.group.parent,null);assert.equal(m.state.status,'standalone-not-integrated');assert.deepEqual(m.group.position.toArray(),[0,0,0]);
assert.equal(m.state.buildingLength,16);assert.equal(m.state.indoorTables,6);assert.equal(m.state.stools,24);assert.ok(m.components.interior&&m.components.murals&&m.components.shutters);
let count=0,meshes=0;const geometries=new Set();
m.group.traverse(o=>{if(!o.isMesh)return;meshes++;geometries.add(o.geometry);const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;assert.ok(p&&n);for(const attr of [p,n])for(const v of attr.array)assert.ok(Number.isFinite(v),`${o.name}: non-finite geometry`);count+=(o.geometry.index?.count??p.count)/3;assert.ok(o.material.isMeshStandardMaterial);});assert.equal(count,m.triangles);
const box=new THREE.Box3().setFromObject(m.group),size=box.getSize(new THREE.Vector3());assert.ok(size.x>=15&&size.x<16);assert.ok(size.y>7&&size.y<8);assert.ok(size.z>22&&size.z<24);
// Export round-trip must preserve the entire assembly, including small props.
const bytes=fs.readFileSync(new URL('../3d/assets/seven-kho.glb',import.meta.url));const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');let exported=0;gltf.scene.traverse(o=>{if(o.isMesh){exported+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});assert.equal(exported,count);const out=new THREE.Box3().setFromObject(gltf.scene);assert.ok(out.min.distanceTo(box.min)<1e-4);assert.ok(out.max.distanceTo(box.max)<1e-4);
let disposed=0;for(const g of geometries)g.addEventListener('dispose',()=>disposed++);const scene=new THREE.Scene();scene.add(m.group);m.dispose();m.dispose();assert.equal(m.group.parent,null);assert.equal(disposed,geometries.size);
gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
console.log(JSON.stringify({triangles:count,meshes,dimensions:size.toArray(),glbBytes:bytes.length,exportRoundTrip:'passed',disposal:'passed',standalone:true}));
