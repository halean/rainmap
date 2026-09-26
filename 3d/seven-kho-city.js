// Geographic wrapper. The source asset remains independently inspectable.
import * as THREE from 'three';
import {createSevenKho} from './seven-kho.js';
import {extrude} from './landmark-kit.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Values from seven-kho-site.json; the JSON retains geographic/source evidence.
export const SEVEN_KHO_SITE=Object.freeze({lon:106.67978880686381,lat:10.766184867002776,yaw:-0.30055790360122264,outline:[[-2.1,-12.3],[2.1,-12.3],[2.1,3.7],[-2.1,3.7]]});
/** The studio model's parts the city leaves out: its own pavement (the city has one) and the
 *  shutters (open for service). Used by the worker build and the proxy (tools/build-lod.mjs). */
export const SEVEN_KHO_CITY_HIDDEN=Object.freeze(['pavement','shutters']);
/** Camera distances (m): the full model within `full` (built from `build`, freed after `keepMs`
 *  beyond `release`); the proxy to `lod1`; the plain block beyond. */
export const LOD=Object.freeze({build:90,full:60,release:160,keepMs:20000,lod1:450});
export function createSevenKhoCity({scene,project}){
 const group=new THREE.Group();group.name='landmark-seven-kho';const [x,z]=project(SEVEN_KHO_SITE.lon,SEVEN_KHO_SITE.lat);group.position.set(x,0,z);group.rotation.y=SEVEN_KHO_SITE.yaw;scene.add(group);
 const mat=new THREE.MeshStandardMaterial({color:'#858375',roughness:.9});const proxy=new THREE.Mesh(extrude(SEVEN_KHO_SITE.outline,0,7.54),mat);proxy.name='seven-kho-distant';group.add(proxy);
 // Unlike the studio platform, this patch stops before the mapped alley/road.
 const paving=new THREE.Mesh(extrude([[-7.5,3.7],[4.15,3.7],[4.15,9.0],[-7.5,9.0]],-.04,.018),new THREE.MeshStandardMaterial({color:'#928e7d',roughness:1}));paving.name='seven-kho-sidewalk';group.add(paving);
 // --- Levels of detail (like Nha Rong's, princess60-berth.js). The detailed model is
 // ~670k triangles and ~1 s to build, so it is built only near, in a Web Worker
 // (model-worker.js), and freed once the camera has stayed away. Between, a proxy
 // simplified from it offline (tools/build-lod.mjs seven-kho 0.06 1).
 let full=null,fullPromise=null,lod1=null,away=0,disposed=false;
 const state={name:'7 Khô',lon:SEVEN_KHO_SITE.lon,lat:SEVEN_KHO_SITE.lat,footprint:'photo-constrained estimate; no OSM polygon',integrated:true,lod:'proxy',triangles:24,building:false};
 const local=v=>group.localToWorld(new THREE.Vector3(...v));group.updateMatrixWorld(true);
 const view={target:local([0,1.20,-6.5]),eye:local([.65,1.75,7.2])};
 new GLTFLoader().loadAsync(new URL('./assets/seven-kho-lod1.glb',import.meta.url).href).then(g=>{if(disposed)return;lod1=g.scene;lod1.name='seven-kho-lod1';lod1.visible=false;
   lod1.traverse(m=>{if(m.isMesh)m.material.side=THREE.DoubleSide;});group.add(lod1);}).catch(e=>{state.lodError=String(e.message||e);});
 function adopt({meshes,materials:json}){
  const ml=new THREE.MaterialLoader(),mats=json.map(j=>ml.parse(j)),g=new THREE.Group();g.name='seven-kho-full';
  for(const m of meshes){const geo=new THREE.BufferGeometry();for(const [n,a] of Object.entries(m.attributes))geo.setAttribute(n,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
   if(m.index)geo.setIndex(new THREE.BufferAttribute(m.index,1));geo.computeBoundingSphere();
   const mesh=new THREE.Mesh(geo,mats[m.material]);mesh.name=m.name;mesh.visible=m.visible;mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(m.matrix);g.add(mesh);}
  g.userData.materials=mats;return g;
 }
 function ensureFull(){
  if(full||fullPromise)return;
  state.building=true;const t0=performance.now();
  fullPromise=(typeof Worker!=='undefined'
   ?new Promise((res,rej)=>{const w=new Worker(new URL('./model-worker.js',import.meta.url),{type:'module'});
     w.onmessage=e=>{w.terminate();e.data.error?rej(new Error(e.data.error)):res(adopt(e.data));};w.onerror=e=>{w.terminate();rej(e);};
     w.postMessage({module:'./seven-kho.js',create:'createSevenKho',options:{city:true},hide:SEVEN_KHO_CITY_HIDDEN});})
   :Promise.resolve().then(()=>{const m=createSevenKho({city:true});for(const k of SEVEN_KHO_CITY_HIDDEN)m.components[k].visible=false;m.group.name='seven-kho-full';m.group.userData.materials=Object.values(m.materials);return m.group;})
  ).then(g=>{fullPromise=null;state.building=false;if(disposed){release(g);return;}full=g;full.visible=false;group.add(full);state.lastBuildMs=Math.round(performance.now()-t0);},
   e=>{fullPromise=null;state.building=false;state.fullError=String(e.message||e);});
 }
 function release(g){g.removeFromParent();g.traverse(m=>{if(m.isMesh)m.geometry.dispose();});for(const m of g.userData.materials||[])m.dispose();}
 const tri=o=>{let n=0;o?.traverse(m=>{if(m.isMesh)n+=(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3;});return n;};
 const eye=new THREE.Vector3();
 function update(camera,nowMs=performance.now()){if(disposed||!camera)return;
  camera.getWorldPosition(eye);const d=eye.distanceTo(group.position);state.cameraDistance=Math.round(d);
  if(d<LOD.build)ensureFull();                                     // start building a little before it is needed
  if(d>LOD.release){if(!away)away=nowMs;else if(full&&nowMs-away>LOD.keepMs){release(full);full=null;}}else away=0;
  const want=d<LOD.full&&full?'full':d<LOD.lod1&&lod1?'lod1':'proxy';
  if(want!==state.lod||(want==='full'&&!full.visible)){if(full)full.visible=want==='full';if(lod1)lod1.visible=want==='lod1';proxy.visible=want==='proxy';
   state.lod=want;state.triangles=want==='full'?tri(full):want==='lod1'?tri(lod1):24;}
 }
 // No generic building exists here: do not remove neighboring geometry.
 function replaceGeneric(){return 0;}
 function dispose(){if(disposed)return;disposed=true;if(full)release(full);if(lod1)release(lod1);proxy.geometry.dispose();mat.dispose();paving.geometry.dispose();paving.material.dispose();group.removeFromParent();}
 return {group,state,view,update,replaceGeneric,dispose};
}
