import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createPrincess60NhaRong,PRINCESS60_NHARONG} from '../3d/princess60-nharong.js';
const yacht=createPrincess60NhaRong();
assert.equal(yacht.group.parent,null,'Must not attach itself to the city');
assert.deepEqual(yacht.group.position.toArray(),[0,0,0]);
assert.equal(yacht.group.userData.status,'moored-alongside-saigon-star');
assert.equal(PRINCESS60_NHARONG.destination,'Vinhomes Central Park Marina');
assert(!('lon' in PRINCESS60_NHARONG));assert(!('lat' in PRINCESS60_NHARONG));
assert.equal(Object.keys(yacht.components).length,12);
let triangles=0,meshes=0,bytes=0,normalSamples=0;
yacht.group.traverse(o=>{
 if(!o.isMesh)return;meshes++;
 const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;
 assert(p && n && p.count===n.count,o.name);assert.equal(p.count%3,0);
 assert(p.array.every(Number.isFinite),`${o.name}: finite vertices`);assert(n.array.every(Number.isFinite),`${o.name}: finite normals`);
 bytes+=p.array.byteLength+n.array.byteLength;triangles+=p.count/3;
 // The previously reversed hull must face out on both sides, not rely on
 // DoubleSide to hide incorrect lighting or GLB surface orientation.
 if(o.name==='p60nr-hull-ivory')for(let i=0;i<p.count;i++){
  if(Math.abs(p.getX(i))<0.5 && p.getY(i)>0.5 && p.getY(i)<1.2 && Math.abs(p.getZ(i))>2.1){assert(n.getZ(i)*p.getZ(i)>0,'Hull normal faces outward');normalSamples++;}
 }
});
assert(normalSamples>100);assert.equal(triangles,yacht.triangles);
const bounds=new THREE.Box3().setFromObject(yacht.group),size=bounds.getSize(new THREE.Vector3());
assert(size.x>18.3 && size.x<18.9,`LOA ${size.x}`);assert(size.z>4.8 && size.z<5.4,`Beam incl. fittings ${size.z}`);
assert(bounds.min.y>=-1.28 && bounds.min.y<=-1.24,`Draft ${bounds.min.y}`);assert(bounds.max.y<7.3);
// Clear stairwell through the roof and upper aft sunpad, rather than furniture
// covering the staircase. Only lower stair treads may be beneath this point.
const ray=new THREE.Raycaster(new THREE.Vector3(-5.95,8,-1.27),new THREE.Vector3(0,-1,0));
const hits=ray.intersectObjects([yacht.components.superstructure,yacht.components.flybridge],true);
assert(!hits.some(h=>h.point.y>3.5),'Upper stair opening is obstructed');
// No accidental city integration or dependency on the concurrently built yacht.
const source=fs.readFileSync(new URL('../3d/princess60-nharong.js',import.meta.url),'utf8');
assert(!source.includes("from './yacht.js'"));
let geometryDisposals=0,materialDisposals=0;
yacht.group.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>geometryDisposals++);});
Object.values(yacht.materials).forEach(m=>m.addEventListener('dispose',()=>materialDisposals++));
const scene=new THREE.Scene();scene.add(yacht.group);yacht.dispose();yacht.dispose();
assert.equal(yacht.group.parent,null);assert.equal(geometryDisposals,meshes);assert.equal(materialDisposals,Object.keys(yacht.materials).length);
console.log(JSON.stringify({triangles,meshes,geometryMiB:+(bytes/1048576).toFixed(2),size:size.toArray(),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},normalSamples,disposal:'passed',placement:'local asset; city berth in wrapper'},null,2));
// Round-trip the generated artifact through the same loader used by the city.
const artifact=new URL('../3d/assets/princess60-nharong.glb',import.meta.url);
if(fs.existsSync(artifact)) {
 const {GLTFLoader}=await import('../3d/vendor/loaders/GLTFLoader.js');
 const buffer=fs.readFileSync(artifact),ab=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
 const loaded=await new GLTFLoader().parseAsync(ab,'');let exportedTriangles=0;
 loaded.scene.traverse(o=>{if(o.isMesh){exportedTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;assert(o.geometry.attributes.position.array.every(Number.isFinite));}});
 assert.equal(exportedTriangles,triangles,'GLB matches current procedural model; re-export after edits');
 const exportBounds=new THREE.Box3().setFromObject(loaded.scene);
 assert(exportBounds.min.distanceTo(bounds.min)<1e-4);assert(exportBounds.max.distanceTo(bounds.max)<1e-4);
 assert.equal(loaded.scene.children[0].userData.status,'moored-alongside-saigon-star');
 console.log(`GLB round-trip passed: ${exportedTriangles} triangles, ${(buffer.length/1048576).toFixed(2)} MiB`);
} else console.log('GLB not generated: run the exporter to include round-trip verification.');
