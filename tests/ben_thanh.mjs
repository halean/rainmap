// node --loader ./tests/three-loader.mjs tests/ben_thanh.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {MARKET,createBenThanh} from '../3d/ben-thanh.js';
const project=(lon,lat)=>[(lon-106.65)*111320*Math.cos(10.81*Math.PI/180),-(lat-10.81)*111320];
const scene=new THREE.Scene(), market=createBenThanh({scene,project});
assert.equal(market.group.parent,scene);
assert.equal(market.state.drawCalls,6);
assert(market.state.triangles<25000);
const bounds=new THREE.Box3().setFromObject(market.group);
assert(Math.abs(bounds.max.y-MARKET.height)<1e-4);
const forward=new THREE.Vector3(0,0,1).transformDirection(market.group.matrixWorld);
assert(forward.x>0.5&&forward.z>0.8,'entrance faces southeast');
market.group.traverse(o=>{if(o.isMesh){assert(!o.name.startsWith('building'),'landmark avoids generic facade recoloring');for(const attr of Object.values(o.geometry.attributes))assert(attr.array.every(Number.isFinite));}});
const bytes=fs.readFileSync(new URL('../3d/assets/tiles/2_2.glb',import.meta.url));
const tile=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
let original=0;tile.scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('building'))original+=o.geometry.attributes.position.count/3;});
const removed=market.replaceGeneric(tile.scene);assert.equal(removed,70,'remove the known market polygon only');
let remaining=0;tile.scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('building'))remaining+=o.geometry.attributes.position.count/3;});
assert.equal(original-remaining,removed);assert(remaining>original*.95,'neighbouring buildings preserved');
assert.equal(market.replaceGeneric(tile.scene),0,'replacement is idempotent');
// Re-loading a streamed tile must remove the same generic building again.
const reload=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
assert.equal(market.replaceGeneric(reload.scene),removed);
market.dispose();assert.equal(market.group.parent,null);
console.log(`ok - market placement, orientation, 28.8 m height, ${market.state.triangles} triangles, 6 batches; replaced ${removed} generic triangles`);
