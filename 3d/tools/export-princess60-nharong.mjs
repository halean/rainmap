// Rebuild the standalone GLB without Blender or external packages.
// node --loader ./tests/three-loader.mjs 3d/tools/export-princess60-nharong.mjs
import fs from 'node:fs';
import {createPrincess60NhaRong} from '../princess60-nharong.js';
import {mergeVertices} from '../vendor/utils/BufferGeometryUtils.js';
const yacht=createPrincess60NhaRong();
const gltf={asset:{version:'2.0',generator:'Rainmap / Princess 60 Nha Rong'},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[]};
const chunks=[];let offset=0;const materialIds=new Map();
for(const [name,m] of Object.entries(yacht.materials)) {
 materialIds.set(m,gltf.materials.length);
 gltf.materials.push({name,pbrMetallicRoughness:{baseColorFactor:[m.color.r,m.color.g,m.color.b,m.opacity],metallicFactor:m.metalness,roughnessFactor:m.roughness},emissiveFactor:m.emissive.toArray().map(v=>v*m.emissiveIntensity),doubleSided:m.side===2,alphaMode:m.transparent?'BLEND':'OPAQUE'});
}
function accessor(array,type,componentType,target,min,max){
 const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),view=gltf.bufferViews.length;
 gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});chunks.push(bytes);offset+=bytes.length;
 const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
 const id=gltf.accessors.length;gltf.accessors.push({bufferView:view,componentType,count:array.length/(type==='VEC3'?3:1),type,...(min?{min,max}:{})});return id;
}
function node(obj){
 const id=gltf.nodes.length,n={name:obj.name};gltf.nodes.push(n);
 if(obj===yacht.group)n.extras={...obj.userData};
 if(obj.isMesh){
  const g=mergeVertices(obj.geometry,1e-5);g.computeBoundingBox();const attrs={};
  attrs.POSITION=accessor(g.attributes.position.array,'VEC3',5126,34962,g.boundingBox.min.toArray(),g.boundingBox.max.toArray());
  attrs.NORMAL=accessor(g.attributes.normal.array,'VEC3',5126,34962);
  const ind=g.index.array,indices=accessor(ind,'SCALAR',ind instanceof Uint32Array?5125:5123,34963);
  n.mesh=gltf.meshes.length;gltf.meshes.push({name:obj.name,primitives:[{attributes:attrs,indices,material:materialIds.get(obj.material),mode:4}]});g.dispose();
 }
 if(obj.children.length)n.children=obj.children.map(node);return id;
}
node(yacht.group);gltf.buffers=[{byteLength:offset}];
const raw=Buffer.from(JSON.stringify(gltf)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,0x20);raw.copy(json);
const bin=Buffer.concat(chunks),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+bin.length,8);
jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
const path=new URL('../assets/princess60-nharong.glb',import.meta.url);fs.writeFileSync(path,Buffer.concat([header,jh,json,bh,bin]));
console.log(`${path.pathname}: ${yacht.triangles.toLocaleString()} triangles, ${gltf.meshes.length} meshes, ${(fs.statSync(path).size/1048576).toFixed(2)} MiB`);yacht.dispose();
