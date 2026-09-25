// A schematic architectural model of Saigon's Notre-Dame Cathedral.
// Footprint/heading measured from this project's OSM tile 2_1; permanent
// architecture, without restoration scaffolding. See NOTRE-DAME.md.
import * as THREE from 'three';
import {mergeGeometries} from './vendor/utils/BufferGeometryUtils.js';

export const CATHEDRAL = Object.freeze({
  lon: 106.6990174239144, lat: 10.779803570321144,
  yaw: 0.7866631685313783, width: 34.4327, length: 89.1841, towerHeight: 60.5,
});

export function createNotreDame({scene, project}) {
  const group = new THREE.Group(); group.name = 'landmark-notre-dame';
  const [x, z] = project(CATHEDRAL.lon, CATHEDRAL.lat);
  group.position.set(x, 0, z); group.rotation.y = CATHEDRAL.yaw;
  const materials = {
    brick: new THREE.MeshStandardMaterial({color:'#ad573b', roughness:0.95}),
    stone: new THREE.MeshStandardMaterial({color:'#d9c8a5', roughness:0.9}),
    roof: new THREE.MeshStandardMaterial({color:'#ac562e', roughness:0.9}),
    spire: new THREE.MeshStandardMaterial({color:'#b7b9b5', metalness:0.2, roughness:0.65}),
    glass: new THREE.MeshStandardMaterial({color:'#20333b', roughness:0.45}),
    door: new THREE.MeshStandardMaterial({color:'#493027', roughness:0.9}),
    white: new THREE.MeshStandardMaterial({color:'#e5dfcf', roughness:0.85}),
    grass: new THREE.MeshStandardMaterial({color:'#536b3d', roughness:1}),
  };
  // Fine mortar fades out when bricks become smaller than screen pixels.
  materials.brick.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrickPosition;\nvarying vec3 vBrickNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrickPosition = transformed;\nvBrickNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrickPosition;\nvarying vec3 vBrickNormal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 brickCell = vec2(abs(vBrickNormal.x) > 0.5 ? vBrickPosition.z : vBrickPosition.x, vBrickPosition.y) / vec2(0.48, 0.22);
        vec2 brickFW = fwidth(brickCell);
        brickCell.x += mod(floor(brickCell.y), 2.0) * 0.5;
        vec2 edge = min(fract(brickCell), 1.0 - fract(brickCell));
        vec2 joint = 1.0 - smoothstep(vec2(0.035), vec2(0.035) + brickFW, edge);
        float mortar = max(joint.x, joint.y) * (1.0 - smoothstep(0.2, 0.8, max(brickFW.x, brickFW.y)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.22, 0.15), mortar * 0.55);`);
  };
  const parts = Object.fromEntries(Object.keys(materials).map(key => [key, []]));
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  function add(key, geometry, px=0, py=0, pz=0, rx=0, ry=0, rz=0) {
    quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
    matrix.compose(new THREE.Vector3(px,py,pz), quaternion, new THREE.Vector3(1,1,1));
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(matrix); parts[key].push(g);
  }
  function box(key, w,h,d, px,py,pz, yaw=0) { add(key,new THREE.BoxGeometry(w,h,d),px,py,pz,0,yaw); }
  function gable(key,w,rise,length,px,base,pz,yaw=0) {
    const s = new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,rise);s.closePath();
    const g = new THREE.ExtrudeGeometry(s,{depth:length,bevelEnabled:false});g.translate(0,0,-length/2);
    add(key,g,px,base,pz,0,yaw);
  }
  function arch(key,w,h,px,py,pz,yaw=0) {
    const r=w/2,s=new THREE.Shape();s.moveTo(-r,0);s.lineTo(r,0);s.lineTo(r,h-r);s.absarc(0,h-r,r,0,Math.PI,false);s.lineTo(-r,0);s.closePath();
    add(key,new THREE.ExtrudeGeometry(s,{depth:0.12,bevelEnabled:false,curveSegments:10}),px,py,pz,0,yaw);
  }
  function window(w,h,px,py,pz,yaw=0,fill='glass') {
    arch('stone',w+0.45,h+0.35,px,py-0.18,pz,yaw);
    arch(fill,w,h,px+Math.sin(yaw)*0.15,py,pz+Math.cos(yaw)*0.15,yaw);
  }
  function rose(radius,px,py,pz) {
    add('glass',new THREE.CircleGeometry(radius,32),px,py,pz);
    add('stone',new THREE.TorusGeometry(radius,0.22,6,32),px,py,pz+0.08);
    add('stone',new THREE.TorusGeometry(radius*0.35,0.10,5,24),px,py,pz+0.12);
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/6;
      add('stone',new THREE.BoxGeometry(0.12,radius*0.68,0.12),px-Math.sin(a)*radius*0.65,py+Math.cos(a)*radius*0.65,pz+0.14,0,0,a);
    }
  }
  const front=CATHEDRAL.length/2, towerZ=front-5.1;
  // Raised plinth, central nave, lower aisles and projecting transept.
  box('stone',34.4,0.6,78,0,0.3,5);
  box('brick',15.6,23.8,76,0,12.5,5.5);
  gable('roof',17.0,7.0,78,0,24.4,5.5);
  for(const side of [-1,1]) {
    box('brick',7.4,12.5,68,side*11.5,6.85,0.5);
    gable('roof',8.4,3.0,70,side*11.5,13.1,0.5);
  }
  box('brick',34.4,16.5,12,0,8.85,-21);
  gable('roof',13.2,6.0,35.3,0,17.1,-21,Math.PI/2);
  // Rounded sanctuary and two smaller rear chapels.
  add('brick',new THREE.CylinderGeometry(8.2,8.2,21.0,16),0,11.1,-35.5);
  add('roof',new THREE.ConeGeometry(8.9,7.3,16),0,25.25,-35.5);
  for(const side of [-1,1]) {
    add('brick',new THREE.CylinderGeometry(3.6,3.6,11.5,12),side*10.8,6.35,-33.5);
    add('roof',new THREE.ConeGeometry(4.1,4.2,12),side*10.8,14.2,-33.5);
  }
  // Front facade: three portals and a rose window under the central gable.
  box('brick',15.0,24.0,2.0,0,12.6,front-1.05);
  gable('brick',15.0,6.0,1.9,0,24.6,front-1.05);
  for(const px of [-12.1,0,12.1]) window(px===0?4.5:3.5,7.0,px,0.7,front+0.04,0,'door');
  rose(3.0,0,20.2,front+0.16);
  rose(0.85,0,27.1,front+0.16);
  for(const px of [-5.3,-2.65,0,2.65,5.3]) window(1.1,2.8,px,11.3,front+0.04);
  box('stone',15.4,0.5,0.6,0,16.0,front+0.15);
  // Twin square bell towers, pale octagonal spires, dormers and crosses.
  for(const side of [-1,1]) {
    const tx=side*12.1;
    box('brick',9.8,35.8,10.2,tx,18.5,towerZ);
    for(const y of [0.9,10.0,17.0,25.8,35.8]) box('stone',10.15,0.45,10.55,tx,y,towerZ);
    for(const dx of [-4.45,4.45]) for(const dz of [-4.65,4.65]) box('stone',0.42,34.5,0.42,tx+dx,18.25,towerZ+dz);
    // Double belfry openings on all four sides, with visible horizontal louvers.
    for(let face=0;face<4;face++) {
      const yaw=face*Math.PI/2, sx=Math.sin(yaw),sz=Math.cos(yaw);
      for(const offset of [-1.85,1.85]) {
        const wx=tx+sx*5.16+sz*offset,wz=towerZ+sz*5.16-sx*offset;
        window(2.35,6.6,wx,27.9,wz,yaw);
        for(let i=0;i<9;i++)box('spire',2.25,0.12,0.25,wx+sx*0.3,28.1+i*0.52,wz+sz*0.3,yaw);
      }
    }
    for(const dx of [-2.8,0,2.8]) window(1.2,3.8,tx+dx,18.2,front+0.18);
    rose(0.9,tx,23.7,front+0.2);
    box('stone',10.6,0.7,10.8,tx,36.5,towerZ);
    const base = new THREE.CylinderGeometry(3.9,5.8,3.3,4);base.rotateY(Math.PI/4);
    add('spire',base,tx,38.5,towerZ);
    add('spire',new THREE.ConeGeometry(4.0,17.2,8),tx,48.7,towerZ);
    for(let face=0;face<4;face++) {
      const yaw=face*Math.PI/2,sx=Math.sin(yaw),sz=Math.cos(yaw);
      box('spire',2.2,3.7,0.65,tx+sx*3.0,41.3,towerZ+sz*3.0,yaw);
      gable('spire',2.8,2.5,0.7,tx+sx*3.0,43.15,towerZ+sz*3.0,yaw);
      window(0.8,2.5,tx+sx*3.4,39.8,towerZ+sz*3.4,yaw);
    }
    box('spire',0.22,3.5,0.22,tx,58.75,towerZ);
    box('spire',2.0,0.20,0.22,tx,59.6,towerZ);
  }
  // Repeating side bays, upper clerestory windows and stone-capped buttresses.
  for(const side of [-1,1]) {
    const yaw=side*Math.PI/2;
    for(const pz of [-29,-11,-2,7,16,25,33]) {
      window(2.0,6.3,side*15.25,4.0,pz,yaw);
      window(1.7,4.2,side*7.85,18.0,pz,yaw);
      box('brick',1.2,13.5,1.25,side*16.0,7.2,pz-3.5);
      box('stone',1.5,0.35,1.5,side*16.0,14.1,pz-3.5);
    }
    window(3.0,7.8,side*17.25,3.0,-21,yaw);
    for(const pz of [-27,-15,-3,9,21,33]) box('stone',0.35,0.35,2.0,side*7.95,23.9,pz);
  }
  // Small forecourt island and schematic Our Lady of Peace statue.
  add('stone',new THREE.CylinderGeometry(12.0,12.0,0.25,48),0,0.17,74);
  add('grass',new THREE.CylinderGeometry(10.8,10.8,0.18,48),0,0.35,74);
  box('stone',3.5,0.15,23.0,0,0.47,74);
  box('stone',23.0,0.15,3.5,0,0.47,74);
  box('white',2.4,1.0,2.4,0,1.05,74);
  box('white',1.5,2.2,1.5,0,2.6,74);
  add('white',new THREE.ConeGeometry(0.75,2.4,12),0,4.7,74);
  add('white',new THREE.SphereGeometry(0.34,12,8),0,6.15,74);
  for(const side of [-1,1])add('white',new THREE.CylinderGeometry(0.12,0.17,1.15,8),side*0.43,5.6,74.15,0,0,side*0.65);

  let triangles=0;
  for(const [key, geometries] of Object.entries(parts)) {
    const geometry=mergeGeometries(geometries,false);
    for(const g of geometries)g.dispose();
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials[key]);mesh.name=`cathedral-${key}`;
    triangles+=geometry.attributes.position.count/3;group.add(mesh);
  }
  scene.add(group);group.updateWorldMatrix(true,true);
  const inverse=group.matrixWorld.clone().invert(), v=new THREE.Vector3();
  const replacementBox=new THREE.Box3(new THREE.Vector3(-18.3,-1,-45.7),new THREE.Vector3(18.3,80,45.7));
  const worldBox=replacementBox.clone().applyMatrix4(group.matrixWorld);
  // The OSM tile merges whole neighbourhoods into each mesh. Filter only
  // triangles entirely inside the church footprint, never hide that mesh.
  function replaceGeneric(root) {
    if(!root)return 0;
    root.updateWorldMatrix(true,true);let removed=0;
    root.traverse(o=>{
      if(!o.isMesh || !o.name.startsWith('building') || o.userData.cathedralReplaced)return;
      o.userData.cathedralReplaced=true;
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
  const view={target:group.localToWorld(new THREE.Vector3(0,23,2)),eye:group.localToWorld(new THREE.Vector3(95,68,155))};
  const state={name:'Notre-Dame Cathedral of Saigon',lon:CATHEDRAL.lon,lat:CATHEDRAL.lat,height:CATHEDRAL.towerHeight,triangles,drawCalls:group.children.length,schematic:true};
  return {group,state,view,replaceGeneric,dispose(){scene.remove(group);for(const m of group.children)m.geometry.dispose();for(const m of Object.values(materials))m.dispose();}};
}
