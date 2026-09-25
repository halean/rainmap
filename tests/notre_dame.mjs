// node --loader ./tests/three-loader.mjs tests/notre_dame.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../3d/vendor/three.module.js';
import {GLTFLoader} from '../3d/vendor/loaders/GLTFLoader.js';
import {CATHEDRAL,createNotreDame} from '../3d/notre-dame.js';
const project=(lon,lat)=>[(lon-106.65)*111320*Math.cos(10.81*Math.PI/180),-(lat-10.81)*111320];
const scene=new THREE.Scene(), cathedral=createNotreDame({scene,project});
assert.equal(cathedral.group.parent,scene);
assert.equal(cathedral.state.drawCalls,8);
assert(cathedral.state.triangles<25000);
const bounds=new THREE.Box3().setFromObject(cathedral.group);
assert(Math.abs(bounds.max.y-CATHEDRAL.towerHeight)<1e-4);
const forward=new THREE.Vector3(0,0,1).transformDirection(cathedral.group.matrixWorld);
assert(forward.x>0.7&&forward.z>0.7,'entrance faces southeast');
cathedral.group.traverse(o=>{if(o.isMesh){assert(!o.name.startsWith('building'),'landmark avoids generic facade recoloring');for(const attr of Object.values(o.geometry.attributes))assert(attr.array.every(Number.isFinite));}});
const bytes=fs.readFileSync(new URL('../3d/assets/tiles/2_1.glb',import.meta.url));
const tile=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
let original=0;tile.scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('building'))original+=o.geometry.attributes.position.count/3;});
const removed=cathedral.replaceGeneric(tile.scene);assert(removed>50&&removed<300,'remove only the church');
let remaining=0;tile.scene.traverse(o=>{if(o.isMesh&&o.name.startsWith('building'))remaining+=o.geometry.attributes.position.count/3;});
assert.equal(original-remaining,removed);assert(remaining>original*.98,'neighbouring buildings preserved');
assert.equal(cathedral.replaceGeneric(tile.scene),0,'replacement is idempotent');
// Re-loading a streamed tile must remove the same generic building again.
const reload=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
assert.equal(cathedral.replaceGeneric(reload.scene),removed);
cathedral.dispose();assert.equal(cathedral.group.parent,null);
console.log(`ok - cathedral placement, orientation, 60.5 m height, ${cathedral.state.triangles} triangles, 8 batches; replaced ${removed} generic triangles`);
