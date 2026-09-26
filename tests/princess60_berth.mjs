import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createYacht,YACHT} from '../3d/yacht.js';
import {createMooredPrincess60,PRINCESS60_BERTH} from '../3d/princess60-berth.js';
const project=(lon,lat)=>[(lon-106.65)*111320*Math.cos(10.81*Math.PI/180),-(lat-10.81)*111320];
const scene=new THREE.Scene(),first=createYacht({scene,project}),second=createMooredPrincess60({scene,project});
assert.equal(second.group.parent,scene);assert.equal(second.state.status,'moored');
assert.equal(second.state.sunbathers,3);assert.equal(second.group.rotation.y,first.yacht.rotation.y);
assert.equal(second.yacht.position.y,-0.12);
// Level of detail: nothing heavy is built up front; the full model comes on demand.
assert.equal(second.levels.full,null,'full model not built at start');
assert.equal(second.state.triangles,0);
const far=new THREE.PerspectiveCamera();far.position.set(1e5,100,1e5);second.update(far,0);assert.equal(second.levels.full,null,'far away: not requested');
await second.ensureFull();assert(second.levels.full,'built on demand');
second.levels.full.visible=true;
const pos=first.yacht.worldToLocal(second.yacht.getWorldPosition(new THREE.Vector3()));
assert(Math.abs(pos.x)<1e-6 && Math.abs(pos.z-5.8)<1e-6,'Second yacht on the open-water side');
// Compare bounds in the shared heading frame, not rotated world AABBs.
const boxInFrame=(root,inverse)=>{const result=new THREE.Box3();root.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();result.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));}});return result;};
scene.updateMatrixWorld(true);const inverse=first.yacht.matrixWorld.clone().invert();
const a=boxInFrame(first.yacht,inverse),b=boxInFrame(second.yacht,inverse),clearance=b.min.z-a.max.z;
assert(clearance>0.55,`Boat/fender clearance: ${clearance}`);
assert.equal(second.ropes.children.length,4);
second.ropes.traverse(o=>{if(o.isMesh)assert(o.geometry.attributes.position.array.every(Number.isFinite));});
assert.equal(second.replaceGeneric(new THREE.Group()),0);
const viewer=fs.readFileSync(new URL('../3d/viewer.js',import.meta.url),'utf8');assert(viewer.includes("['princess60',createMooredPrincess60]"));
const html=fs.readFileSync(new URL('../3d/index.html',import.meta.url),'utf8');assert(html.includes('id="river-tour"') && !html.includes('id="yachts-view"'));
// Released once the camera has stayed away, and rebuilt on return.
const near=new THREE.PerspectiveCamera();near.position.fromArray(second.state.center).add(new THREE.Vector3(30,10,0));
second.update(near,1000);assert.equal(second.state.lod,'full');
second.update(far,2000);assert(second.levels.full,'kept for a while');second.update(far,2000+30000);assert.equal(second.levels.full,null,'released');
second.group.visible=false;assert.equal(first.group.visible,true,'Visibility does not mutate the first yacht');
let disposed=0;second.ropes.children.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed++));
second.dispose();second.dispose();assert.equal(disposed,4);assert.equal(second.group.parent,null);assert.equal(first.group.parent,scene);
first.dispose();assert.equal(scene.children.length,0);
console.log(JSON.stringify({berth:PRINCESS60_BERTH.marina,separation:5.8,minimumClearanceMetres:clearance,waterline:-0.12,lines:4,sunbathers:3,disposal:'passed'}));
