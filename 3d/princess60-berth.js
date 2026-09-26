// Nha Rong rafted alongside Saigon Star on the open-water side of its berth.
// The original yacht owns the existing pontoon; this adds no second dock.
//
// Levels of detail: the full model (princess60-nharong.js, ~1.72M triangles,
// ~118 MiB of vertex buffers, ~1.7 s to build) exists only while the camera
// is near. It is built on demand in a Web Worker (princess60-worker.js), so
// the page does not stall, and released once the camera has stayed away.
// Further off, two proxies made offline from it by vertex clustering
// (tools/build-princess60-lod.mjs) stand in: LOD1 (~42k triangles) and LOD2
// (~9k). Beyond LOD.hide nothing is drawn.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {YACHT} from './yacht.js';

// Camera distances (m) to the yacht's centre. The full model is requested
// inside full, kept until beyond release for keepMs, then freed.
export const LOD=Object.freeze({full:180,release:350,keepMs:20000,lod1:700,hide:3000});

export const PRINCESS60_BERTH=Object.freeze({
  beside:'Saigon Star', marina:'Vinhomes Central Park Marina',
  separation:5.8, along:0, waterline:-0.12,
});

export function createMooredPrincess60({scene,project}) {
  const group=new THREE.Group();group.name='landmark-princess60-nharong';
  // The yacht's own frame, holding whichever level is shown.
  const yacht=new THREE.Group();yacht.name='princess60-nharong';
  const [x,z]=project(YACHT.lon,YACHT.lat),[hx,hz]=YACHT.heading;
  group.position.set(x,0,z);group.rotation.y=Math.atan2(-hz,hx);
  // Original model's +Z points away from the pontoon, east into open water.
  yacht.position.set(PRINCESS60_BERTH.along,PRINCESS60_BERTH.waterline,PRINCESS60_BERTH.separation);
  yacht.userData.status='moored-alongside-saigon-star';
  group.add(yacht);
  const ropes=new THREE.Group();ropes.name='princess60-raft-lines';group.add(ropes);
  const material=new THREE.MeshStandardMaterial({color:'#c9c0a8',roughness:1});
  const secondCleat=px=>{
    const t=(px+7.85)/16.85;
    const half=2.415*(t<0.48?0.94+0.06*Math.sin(t/0.48*Math.PI/2):Math.pow(Math.cos((t-0.48)/0.52*Math.PI/2),0.78));
    return new THREE.Vector3(px,1.52+0.75*Math.pow(t,2.3)+0.185+PRINCESS60_BERTH.waterline,PRINCESS60_BERTH.separation-half+0.25);
  };
  const firstCleat=px=>{
    const t=(px+YACHT.hull/2)/YACHT.hull;
    const half=YACHT.beam/2*(t<0.52?1-0.025*(0.52-t):Math.pow(Math.cos((t-0.52)/0.48*Math.PI/2),0.7));
    return new THREE.Vector3(px,1.45+0.85*Math.pow(t,1.7)+0.14,half-0.18);
  };
  const connections=[['bow',6.8,7.3],['stern',-7.05,-YACHT.hull/2+0.5],['forward-spring',-2.9,7.3],['aft-spring',6.8,0.3]];
  const endpoints=[];
  for(const [name,a,b] of connections) {
    const start=secondCleat(a),end=firstCleat(b);
    // Lead over each gunwale before sagging into the clear channel between
    // hulls, so spring lines do not cut across the narrowing bow sections.
    const leave=start.clone().add(new THREE.Vector3(0,0.06,-0.42));
    const approach=end.clone().add(new THREE.Vector3(0,0.06,0.42));
    const level=Math.min(start.y,end.y)-0.10;
    const curve=new THREE.CatmullRomCurve3([start,leave,new THREE.Vector3(a,level,2.95),new THREE.Vector3(b,level,2.95),approach,end]);
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,96,0.022,12,false),material);mesh.name=`princess60-raft-${name}`;ropes.add(mesh);
    endpoints.push({name,start:start.toArray(),end:end.toArray()});
  }
  scene.add(group);group.updateMatrixWorld(true);
  const center=group.localToWorld(new THREE.Vector3(0,0,PRINCESS60_BERTH.separation));
  const state={name:'Princess 60 Nha Rong beside Saigon Star',status:'moored',marina:PRINCESS60_BERTH.marina,
    beside:PRINCESS60_BERTH.beside,center:center.toArray(),separation:PRINCESS60_BERTH.separation,
    waterline:PRINCESS60_BERTH.waterline,sunbathers:3,fullTriangles:1723097,ropeTriangles:4*96*12*2,lod:'none',triangles:0,lines:endpoints};
  // The ensign: the shared flag (flag.js), at the top of the raked staff.
  const flags=[{top:yacht.localToWorld(new THREE.Vector3(-8.12,3.06,0)),length:0.82,parent:yacht}];   // on the yacht: it sails (rivertour.js)
  const view={target:group.localToWorld(new THREE.Vector3(0,2,2.9)),eye:group.localToWorld(new THREE.Vector3(-27,19,35))};
  // --- Levels ----------------------------------------------------------------
  const levels={full:null,lod1:null,lod2:null};
  // Rafted: the lines to Saigon Star are out only while both lie at the berth.
  let rafted=true;const setRafted=on=>{rafted=on;ropes.visible=on&&ropes.visible;state.rafted=on;};
  let fullPromise=null,fullAway=0,disposed=false;
  const triangles=o=>{let n=0;o?.traverse(m=>{if(m.isMesh)n+=(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3;});return n;};
  // The proxies are small GLBs, fetched once at start.
  const loader=new GLTFLoader();
  for(const level of ['lod1','lod2']){
    const url=new URL(`./assets/princess60-nharong-${level}.glb`,import.meta.url).href;
    loader.loadAsync(url).then(gltf=>{if(disposed)return;const o=gltf.scene;o.name=`princess60-${level}`;o.visible=false;
      o.traverse(m=>{if(m.isMesh){m.material.side=THREE.DoubleSide;}});levels[level]=o;yacht.add(o);}).catch(e=>{state.lodError=String(e.message||e);});
  }
  // The full model: from the worker, or built here where there is no Worker.
  function adopt({meshes,materials:json,userData}){
    const ml=new THREE.MaterialLoader(),mats=json.map(j=>ml.parse(j)),full=new THREE.Group();full.name='princess60-full';
    for(const m of meshes){
      const g=new THREE.BufferGeometry();
      for(const [name,a] of Object.entries(m.attributes))g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
      if(m.index)g.setIndex(new THREE.BufferAttribute(m.index,1));
      g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,mats[m.material]);mesh.name=m.name;mesh.visible=m.visible;
      mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(m.matrix);full.add(mesh);
    }
    full.userData={...userData,materials:mats};return full;
  }
  function ensureFull(){
    if(levels.full)return Promise.resolve(levels.full);
    if(fullPromise)return fullPromise;
    state.building=true;
    const started=performance.now();
    fullPromise=(typeof Worker!=='undefined'
      ? new Promise((resolve,reject)=>{const w=new Worker(new URL('./princess60-worker.js',import.meta.url),{type:'module'});
          w.onmessage=e=>{w.terminate();e.data.error?reject(new Error(e.data.error)):resolve(adopt(e.data));};w.onerror=e=>{w.terminate();reject(e);};w.postMessage('build');})
      : import('./princess60-nharong.js').then(({createPrincess60NhaRong})=>{const m=createPrincess60NhaRong();const full=m.group;full.traverse(o=>{if(o.isMesh&&(o.material===m.materials.flag||o.material===m.materials.star))o.visible=false;});full.name='princess60-full';full.userData.materials=Object.values(m.materials);return full;})
    ).then(full=>{
      fullPromise=null;state.building=false;
      if(disposed){releaseGroup(full);return null;}
      levels.full=full;full.visible=false;yacht.add(full);state.lastBuildMs=Math.round(performance.now()-started);return full;
    },error=>{fullPromise=null;state.building=false;state.fullError=String(error.message||error);throw error;});
    return fullPromise;
  }
  function releaseGroup(o){o.removeFromParent();o.traverse(m=>{if(m.isMesh)m.geometry.dispose();});for(const m of o.userData.materials||[])m.dispose();}
  function releaseFull(){if(!levels.full)return;releaseGroup(levels.full);levels.full=null;}
  function show(level){
    for(const [k,o] of Object.entries(levels))if(o)o.visible=k===level;
    state.lod=level;state.triangles=level==='none'?0:triangles(levels[level])+state.ropeTriangles;
  }
  const eye=new THREE.Vector3();
  /** Pick the level for the camera's distance; call every frame. */
  function update(camera,nowMs=performance.now()){
    if(disposed||!camera)return;
    camera.getWorldPosition(eye);
    yacht.getWorldPosition(center);                   // it sails: levels follow it
    const d=eye.distanceTo(center);state.cameraDistance=Math.round(d);
    let visible=true;for(let o=group;o;o=o.parent)visible=visible&&o.visible;
    if(d<LOD.full&&visible)ensureFull().catch(()=>{});
    if(d>LOD.release){if(!fullAway)fullAway=nowMs;else if(levels.full&&nowMs-fullAway>LOD.keepMs)releaseFull();}else fullAway=0;
    ropes.visible=rafted&&d<LOD.lod1;
    const want=d>LOD.hide?'none':d<LOD.full&&levels.full?'full':d<LOD.lod1&&levels.lod1?'lod1':levels.lod2?'lod2':levels.lod1?'lod1':'none';
    if(want!==state.lod)show(want);
  }
  return {group,yacht,ropes,state,view,flags,levels,setRafted,update,ensureFull,releaseFull,replaceGeneric:()=>0,
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const o of Object.values(levels))if(o)releaseGroup(o);ropes.children.forEach(m=>m.geometry.dispose());material.dispose();}
  };
}
