// Geographic wrapper. The source asset remains independently inspectable.
import * as THREE from 'three';
import {createSevenKho} from './seven-kho.js';
import {extrude} from './landmark-kit.js';
// Values from seven-kho-site.json; the JSON retains geographic/source evidence.
export const SEVEN_KHO_SITE=Object.freeze({lon:106.67978880686381,lat:10.766184867002776,yaw:-0.30055790360122264,outline:[[-2.1,-10.3],[2.1,-10.3],[2.1,3.7],[-2.1,3.7]]});
export function createSevenKhoCity({scene,project}){
 const group=new THREE.Group();group.name='landmark-seven-kho';const [x,z]=project(SEVEN_KHO_SITE.lon,SEVEN_KHO_SITE.lat);group.position.set(x,0,z);group.rotation.y=SEVEN_KHO_SITE.yaw;scene.add(group);
 const mat=new THREE.MeshStandardMaterial({color:'#858375',roughness:.9});const proxy=new THREE.Mesh(extrude(SEVEN_KHO_SITE.outline,0,7.54),mat);proxy.name='seven-kho-distant';group.add(proxy);
 // Unlike the studio platform, this patch stops before the mapped alley/road.
 const paving=new THREE.Mesh(extrude([[-7.5,3.7],[4.15,3.7],[4.15,9.0],[-7.5,9.0]],-.04,.018),new THREE.MeshStandardMaterial({color:'#928e7d',roughness:1}));paving.name='seven-kho-sidewalk';group.add(paving);
 let detail=null,disposed=false;
 const state={name:'7 Khô',lon:SEVEN_KHO_SITE.lon,lat:SEVEN_KHO_SITE.lat,footprint:'photo-constrained estimate; no OSM polygon',integrated:true,lod:'proxy',triangles:24};
 const local=v=>group.localToWorld(new THREE.Vector3(...v));group.updateMatrixWorld(true);
 const view={target:local([0,3,3]),eye:local([16,11,26])};
 function update(camera){if(disposed)return;const d=camera.position.distanceTo(group.position);
  if(d<220&&!detail){detail=createSevenKho({city:true});detail.components.pavement.visible=false;
   group.add(detail.group);
  }
  const near=d<300&&!!detail;proxy.visible=!near;if(detail)detail.group.visible=near;state.lod=near?'detail':'proxy';state.triangles=near?detail.triangles:24;
  if(d>900&&detail){detail.dispose();detail=null;}
 }
 // No generic building exists here: do not remove neighboring geometry.
 function replaceGeneric(){return 0;}
 function dispose(){if(disposed)return;disposed=true;detail?.dispose();proxy.geometry.dispose();mat.dispose();paving.geometry.dispose();paving.material.dispose();group.removeFromParent();}
 return {group,state,view,update,replaceGeneric,dispose};
}
