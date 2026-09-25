// Schematic permanent exterior; dimensions inferred from the OSM footprint
// and architectural photographs. See BEN-THANH.md.
import * as THREE from 'three';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';
export const MARKET=Object.freeze({lon:106.69801546623155,lat:10.772564071677984,yaw:0.5469374182598203,width:100.4402,length:137.6377,height:28.8});
export function createBenThanh({scene,project}) {
  const group=new THREE.Group();group.name='landmark-ben-thanh';
  const [x,z]=project(MARKET.lon,MARKET.lat);group.position.set(x,0,z);group.rotation.y=MARKET.yaw;
  const materials={
    wall:new THREE.MeshStandardMaterial({color:'#e6d9ae',roughness:.95}),
    trim:new THREE.MeshStandardMaterial({color:'#f2e9d1',roughness:.9}),
    roof:new THREE.MeshStandardMaterial({color:'#a83e24',roughness:.9}),
    dark:new THREE.MeshStandardMaterial({color:'#263a32',roughness:.9}),
    shutter:new THREE.MeshStandardMaterial({color:'#476b61',roughness:.8}),
    clock:new THREE.MeshStandardMaterial({color:'#355d65',roughness:.7}),
  };
  const parts=Object.fromEntries(Object.keys(materials).map(k=>[k,[]]));
  function add(key,g,x=0,y=0,z=0,rx=0,ry=0,rz=0) {
    const geometry=g.index?g.toNonIndexed():g;if(geometry!==g)g.dispose();
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1)));parts[key].push(geometry);
  }
  const box=(key,w,h,d,x,y,z,yaw=0)=>add(key,new THREE.BoxGeometry(w,h,d),x,y,z,0,yaw);
  function gable(w,rise,length,x,y,z,yaw=0){
    const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,rise);s.closePath();
    const g=new THREE.ExtrudeGeometry(s,{depth:length,bevelEnabled:false});g.translate(0,0,-length/2);add('roof',g,x,y,z,0,yaw);
  }
  function arch(w,h,x,y,z,yaw=0,key='dark'){
    const r=w/2,s=new THREE.Shape();s.moveTo(-r,0);s.lineTo(r,0);s.lineTo(r,h-r);s.absarc(0,h-r,r,0,Math.PI,false);s.closePath();
    add(key,new THREE.ShapeGeometry(s,12),x,y,z,0,yaw);
  }
  function opening(w,h,x,y,z,yaw=0){
    arch(w+.5,h+.3,x,y-.1,z,yaw,'trim');arch(w,h,x+Math.sin(yaw)*.035,y,z+Math.cos(yaw)*.035,yaw);
  }
  const W=MARKET.width-2,L=MARKET.length-3,F=L/2;
  box('wall',W,6.6,L,0,3.6,0);box('trim',W+.6,.55,L+.6,0,6.9,0);
  // Parallel roof halls with raised ventilation ridges and a central crossing.
  for(let bay=-2;bay<=2;bay++){
    const bx=bay*19.1;gable(19.3,5.3,L-5,bx,7.2,0);
    box('dark',3.8,.8,L-12,bx,12.55,0);gable(5.6,1.1,L-10,bx,12.95,0);
    for(let pz=-F+7;pz<F-4;pz+=5)box('trim',.16,.75,.18,bx-1.95,12.5,pz);
  }
  gable(17,5.0,W+1,0,9.0,0,Math.PI/2);
  // Shallow arched bays and pilasters along all four street elevations.
  for(let face=0;face<4;face++){
    const yaw=face*Math.PI/2,s=Math.sin(yaw),c=Math.cos(yaw),span=face%2?L:W,depth=face%2?W/2:F;
    for(let u=-span/2+3;u<span/2-1;u+=5.1){
      if(Math.abs(u)<8)continue;
      const px=s*(depth+.08)+c*u,pz=c*(depth+.08)-s*u;
      opening(3.4,4.7,px,.45,pz,yaw);
      box('shutter',2.8,2.0,.08,px+s*.06,1.45,pz+c*.06,yaw);
    }
    // The secondary gates have taller square parapets and broad arches.
    if(face){
      const px=s*(depth-.7),pz=c*(depth-.7);
      box('wall',14,9.7,3.0,px,4.95,pz,yaw);box('trim',14.6,.45,3.6,px,9.9,pz,yaw);
      opening(7.4,7.6,s*(depth+.84),.45,c*(depth+.84),yaw);
    }
  }
  // South entrance: projecting arch, side piers, clock stage and hipped roof.
  box('wall',16,12.7,6,0,6.65,F-1.8);
  opening(7.4,9.4,0,.4,F+1.23);
  for(const side of [-1,1]){
    box('trim',1.1,13.1,6.4,side*7.5,6.85,F-1.8);
    box('trim',2,.6,6.9,side*7.5,13.3,F-1.8);
    box('shutter',2,4.4,.12,side*5.5,3,F+1.28);
  }
  box('wall',10.5,11,9,0,18.7,F-4.4);
  for(const h of [13.7,23.7,24.4])box('trim',11.5,.45,10,0,h,F-4.4);
  for(const dx of [-4.9,4.9])for(const dz of [-4.1,4.1])box('trim',.4,9.7,.4,dx,18.8,F-4.4+dz);
  // Four real geometry clock faces; static hands keep the landmark inexpensive.
  for(let face=0;face<4;face++){
    const yaw=face*Math.PI/2,s=Math.sin(yaw),c=Math.cos(yaw),depth=face%2?5.29:4.54;
    const px=s*depth,pz=F-4.4+c*depth;
    add('trim',new THREE.CircleGeometry(1.95,40),px,20.4,pz,0,yaw);
    add('clock',new THREE.TorusGeometry(1.73,.085,5,40),px+s*.03,20.4,pz+c*.03,0,yaw);
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6,ux=Math.sin(a)*1.43,uy=Math.cos(a)*1.43;
      // Round hour markers remain legible from a distance.
      add('clock',new THREE.SphereGeometry(.095,6,4),px+c*ux+s*.06,20.4+uy,pz-s*ux+c*.06);
    }
    box('clock',.13,1.35,.1,px+s*.07,21.0,pz+c*.07,yaw);
    box('clock',1.05,.13,.1,px+c*.46+s*.07,20.4,pz-s*.46+c*.07,yaw);
  }
  const hip=new THREE.CylinderGeometry(1.8,8.7,4.2,4);hip.rotateY(Math.PI/4);add('roof',hip,0,26.7,F-4.4);
  // Block lettering above the main entrance, built from strokes (no font fetch).
  const glyph={C:['111','100','100','100','111'],H:['101','101','111','101','101'],O:['111','101','101','101','111'],B:['110','101','110','101','110'],E:['111','100','110','100','111'],N:['101','111','111','111','101'],T:['111','010','010','010','010'],A:['010','101','111','101','101']};
  const sign='CHO BEN THANH',step=.19,total=(sign.length*4-1)*step;
  [...sign].forEach((ch,i)=>{glyph[ch]?.forEach((row,j)=>{[...row].forEach((on,k)=>{if(on==='1')box('clock',.15,.15,.08,-total/2+(i*4+k)*step,11.7-j*step,F+1.26);});});});
  let triangles=0;
  for(const [key,geometries] of Object.entries(parts)){
    const geometry=mergeGeometries(geometries,false);for(const g of geometries)g.dispose();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials[key]);mesh.name=`market-${key}`;triangles+=geometry.attributes.position.count/3;group.add(mesh);
  }
  scene.add(group);group.updateWorldMatrix(true,true);
  const inverse=group.matrixWorld.clone().invert(), v=new THREE.Vector3();
  const replacementBox=new THREE.Box3(new THREE.Vector3(-51.3,-1,-70),new THREE.Vector3(51.3,80,70));
  const worldBox=replacementBox.clone().applyMatrix4(group.matrixWorld);
  // The OSM tile merges whole neighbourhoods into each mesh. Filter only
  // triangles entirely inside the market footprint, never hide that mesh.
  function replaceGeneric(root) {
    if(!root)return 0;
    root.updateWorldMatrix(true,true);let removed=0;
    root.traverse(o=>{
      if(!o.isMesh || !o.name.startsWith('building') || o.userData.benThanhReplaced)return;
      o.userData.benThanhReplaced=true;
      const original=o.geometry;
      if(!original.boundingBox)original.computeBoundingBox();
      if(!original.boundingBox.clone().applyMatrix4(o.matrixWorld).intersectsBox(worldBox))return;
      const g=original.index?original.toNonIndexed():original,p=g.attributes.position;
      const transform=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld),keep=[];
      let cut=0;
      for(let i=0;i<p.count;i+=3){
        let inside=true;
        for(let j=0;j<3;j++) {v.fromBufferAttribute(p,i+j).applyMatrix4(transform);inside=inside&&replacementBox.containsPoint(v);}
        if(inside)cut++;else keep.push(i,i+1,i+2);
      }
      if(cut){
        const out=new THREE.BufferGeometry();
        for(const [name,attr] of Object.entries(g.attributes)){
          const array=new attr.array.constructor(keep.length*attr.itemSize);
          for(let i=0;i<keep.length;i++)for(let c=0;c<attr.itemSize;c++)array[i*attr.itemSize+c]=attr.array[keep[i]*attr.itemSize+c];
          out.setAttribute(name,new THREE.BufferAttribute(array,attr.itemSize,attr.normalized));
        }
        out.computeBoundingBox();out.computeBoundingSphere();o.geometry=out;original.dispose();removed+=cut;
      }
      if(g!==original)g.dispose();
    });
    return removed;
  }
  const state={name:'Chợ Bến Thành',...MARKET,triangles,drawCalls:group.children.length,schematic:true};
  return {group,state,replaceGeneric,dispose(){scene.remove(group);for(const m of group.children)m.geometry.dispose();for(const m of Object.values(materials))m.dispose();}};
}
