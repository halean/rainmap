// Hồ Con Rùa / International Square: five piers, a 25-rib flower crown,
// and a 34 m open central finial. Placement and paths follow the local OSM
// basin; elevations and small details are interpreted from photographs.
import * as THREE from 'three';
import {builder,extrude} from './landmark-kit.js';
export const HO_CON_RUA=Object.freeze({
  lon:106.69594642476704,lat:10.782637187410849,height:34,
  outline:[[-26.836,-9.887],[-11.987,-25.972],[9.882,-26.841],[25.967,-11.991],[26.841,9.884],[11.992,25.97],[-9.887,26.849],[-25.972,11.988]],
});
const polygon=(r,n=8,phase=-Math.PI/8-0.04)=>Array.from({length:n},(_,i)=>[r*Math.cos(phase+i*2*Math.PI/n),r*Math.sin(phase+i*2*Math.PI/n)]);
export function createHoConRua({scene,project,paths=null}) {
  const group=new THREE.Group();group.name='landmark-ho-con-rua';const [x,z]=project(HO_CON_RUA.lon,HO_CON_RUA.lat);group.position.set(x,0,z);
  const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:0.86,...extra});
  const materials={concrete:mat('#c8c0a9'),edge:mat('#e0d9c8'),recess:mat('#8b8d7e'),stone:mat('#aaa693'),paving:mat('#c5bca4'),
    water:mat('#486e66',{roughness:0.32,metalness:0.16}),soil:mat('#4a4537'),leaf:mat('#52694a'),leafLight:mat('#6c8259'),trunk:mat('#665845'),
    metal:mat('#6e7772',{metalness:0.5,roughness:0.5}),flower:mat('#a45686'),lamp:mat('#e5e7d2',{emissive:'#d7bb7d',emissiveIntensity:0.25})};
  const {add,box,finish}=builder(materials,'ho-con-rua');
  const rod=(key,a,b,r=0.035)=>{const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av);const g=new THREE.CylinderGeometry(r,r,d.length(),12);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate(...av.add(bv).multiplyScalar(.5).toArray());add(key,g);};
  const rim=(key,outline,y,w,h)=>outline.forEach(([a,b],i)=>{const [c,d]=outline[(i+1)%outline.length],dx=c-a,dz=d-b;box(key,Math.hypot(dx,dz)+0.03,h,w,(a+c)/2,y,(b+d)/2,Math.atan2(-dz,dx));});
  function ring(outer,inner,y0,y1,key) {
    const s=new THREE.Shape(outer.map(([a,b])=>new THREE.Vector2(a,-b))),h=new THREE.Path(inner.map(([a,b])=>new THREE.Vector2(a,-b)));s.holes.push(h);
    const g=new THREE.ExtrudeGeometry(s,{depth:y1-y0,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y0,0);add(key,g);
  }
  const lake=HO_CON_RUA.outline;
  ring(polygon(34.1,128),lake,0.04,0.28,'paving');
  add('water',extrude(lake,-0.06,0.015));
  rim('stone',lake,0.34,0.66,0.60);rim('edge',lake,0.67,0.81,0.09);
  // Octagonal seating rim, expansion joints and radial paving divisions.
  for(let i=0;i<8;i++){
    const a=lake[i],c=lake[(i+1)%8],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);
    for(let j=1;j<14;j++){const t=j/14,u=a[0]+dx*t,v=a[1]+dz*t;rod('recess',[u-dz/len*.4,.718,v+dx/len*.4],[u+dz/len*.4,.718,v-dx/len*.4],.007);}
  }
  for(let i=0;i<64;i++){const a=i*Math.PI/32;rod('stone',[29.0*Math.cos(a),.285,29.0*Math.sin(a)],[34*Math.cos(a),.285,34*Math.sin(a)],.012);}
  // Five open, slender reinforced-concrete piers. No solid central cylinder.
  const phase=0.22;
  for(let i=0;i<5;i++){
    const a=phase+i*Math.PI*2/5,px=1.34*Math.cos(a),pz=1.34*Math.sin(a);
    add('stone',new THREE.CylinderGeometry(.78,.95,.38,8),px,.36,pz);
    box('concrete',.73,26.8,.85,px,13.9,pz,-a);
    box('edge',.075,26.2,.045,px+.33*Math.cos(a),13.9,pz+.33*Math.sin(a),-a);
    for(let j=1;j<12;j++)box('recess',.74,.018,.86,px,2.2+j*2.05,pz,-a);
    // Fine casting marks and occasional darker weathering strips.
    box('recess',.045,5.7,.018,px+.35*Math.sin(a),10.8,pz+.35*Math.cos(a),-a);
  }
  // Five fans of five concrete ribs form the distinctive open flower crown.
  for(let i=0;i<25;i++){
    const a=phase+i*Math.PI*2/25,shape=new THREE.Shape();
    const radii=Array.from({length:15},(_,j)=>1.28+j*(6.45/14));
    const crownY=r=>26.8+3.8*Math.pow((r-1.28)/6.45,1.45);
    shape.moveTo(radii[0],crownY(radii[0]));
    radii.slice(1).forEach(r=>shape.lineTo(r,crownY(r)));
    [...radii].reverse().forEach(r=>shape.lineTo(r,crownY(r)+.36));shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:.72,bevelEnabled:true,bevelSegments:2,bevelSize:.035,bevelThickness:.035,curveSegments:8});g.translate(0,0,-.36);g.rotateY(-a);add('concrete',g);
    // Recessed upper surface with a fine raised border on each rib.
    for(const side of [-1,1]){
      const p=radii.map(r=>new THREE.Vector3(r*Math.cos(a)-side*.325*Math.sin(a),crownY(r)+.40,r*Math.sin(a)+side*.325*Math.cos(a)));
      add('edge',new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p),42,.037,8,false));
    }
  }
  // Visible concrete collars and the open pentagonal finial above the petals.
  for(const y of [26.8,27.3,29.4,32.1])rim(y<28?'concrete':'metal',polygon(y<28?1.65:1.03,5,phase),y,.18,.18);
  for(let i=0;i<5;i++){
    const a=phase+i*2*Math.PI/5,px=1.03*Math.cos(a),pz=1.03*Math.sin(a);
    box('concrete',.25,6.40,.25,px,30.8,pz,-a);
    const c=phase+(i+1)*2*Math.PI/5;
    rod('metal',[px,29.5,pz],[1.03*Math.cos(c),32.0,1.03*Math.sin(c)],.025);
  }
  // Central round pedestal, retained without the lost historical turtle statue.
  add('stone',new THREE.CylinderGeometry(2.7,2.9,.28,80),0,.2,0);
  add('edge',new THREE.CylinderGeometry(2.75,2.75,.10,80),0,.39,0);
  // Solid oval podium inside the mapped oval circulation route.
  const podium=Array.from({length:80},(_,i)=>{const a=i*Math.PI/40;return[1.1+3.8*Math.cos(a),16.7+6.0*Math.sin(a)];});
  add('concrete',extrude(podium,2.97,3.3));rim('edge',podium,3.31,.18,.10);
  for(let i=0;i<12;i++){
    const a=i*Math.PI/6;if(Math.abs(Math.sin(a))>.9)continue;
    const px=1.1+3.30*Math.cos(a),pz=16.7+5.45*Math.sin(a);
    add('stone',new THREE.CylinderGeometry(.46,.40,.38,16),px,3.51,pz);
    const shrub=new THREE.SphereGeometry(.47,12,8);shrub.scale(1,.65,1);add('leaf',shrub,px,3.90,pz);
    for(let j=0;j<5;j++)add('flower',new THREE.IcosahedronGeometry(.11,1),px+.33*Math.cos(j*1.256),4.04,pz+.33*Math.sin(j*1.256));
  }
  // Supports and stair flights to the raised viewing platform south of the tower.
  for(const [px,pz] of [[-1.8,13.5],[3.4,14.0],[-.9,20.0],[4.0,20.0]])box('concrete',.42,3.0,.42,px,1.7,pz);
  for(let i=0;i<18;i++)box('stone',2.15,.168*(i+1),.42,0.7,.28+.084*(i+1),29.7-i*.40);
  for(const s of [-1,1])rod('metal',[.7+s*1.05,1.25,30.0],[.7+s*1.05,4.30,22.65],.032);
  // Restrained planted edge: low pots around the lake, not seasonal signage.
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8+.17,px=30.3*Math.cos(a),pz=30.3*Math.sin(a);
    if(Math.abs(Math.sin(a))>.97)continue;
    add('stone',new THREE.CylinderGeometry(.94,.63,.58,24),px,.56,pz);
    add('soil',new THREE.CylinderGeometry(.85,.85,.07,24),px,.88,pz);
    const shrub=new THREE.SphereGeometry(1,16,10);shrub.scale(.82,1.04,.82);add(i%2?'leaf':'leafLight',shrub,px,1.62,pz);
  }
  // Mature trees on the perimeter; trunks stay clear of the lake-side paths.
  for(let i=0;i<12;i++){
    const a=i*Math.PI/6+.16,px=32.1*Math.cos(a),pz=32.1*Math.sin(a);if(Math.abs(Math.sin(a))>.98)continue;
    rod('trunk',[px,.3,pz],[px,8.0,pz],.22);
    for(let j=0;j<4;j++){
      const b=j*Math.PI/2+i,dx=1.7*Math.cos(b),dz=1.7*Math.sin(b);
      rod('trunk',[px,5.4,pz],[px+dx,9,pz+dz],.10);
      const leaf=new THREE.IcosahedronGeometry(2.9,2);leaf.scale(1,1.25,1);add(j%2?'leaf':'leafLight',leaf,px+dx,10.5+(j%2)*1.6,pz+dz);
    }
  }
  const triangles=finish(group);
  const pathGroup=new THREE.Group();pathGroup.name='ho-con-rua-mapped-walkways';group.add(pathGroup);
  const state={name:'Hồ Con Rùa — Turtle Lake',lon:HO_CON_RUA.lon,lat:HO_CON_RUA.lat,height:34,piers:5,crownRibs:25,triangles,pathsLoaded:false,schematic:true};
  let disposed=false;
  function installPaths(data){
    if(disposed)return;
    const arr=data.positions.flatMap(([a,b,c])=>[a,b>10?3.3-2.77*Math.max(0,Math.min(1,(a-3.7)/13))+(b-12.3):.53+(b-6.3),c]);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,materials.concrete);mesh.name='ho-con-rua-walkways';pathGroup.add(mesh);state.pathsLoaded=true;state.triangles+=arr.length/9;
  }
  const ready=paths?(installPaths(paths),Promise.resolve()):fetch(new URL('./ho-con-rua-paths.json',import.meta.url)).then(r=>{if(!r.ok)throw Error(`Walkways HTTP ${r.status}`);return r.json();}).then(installPaths).catch(e=>{state.pathsError=e.message;console.warn('Hồ Con Rùa walkways:',e);});
  scene.add(group);group.updateMatrixWorld(true);
  const inverse=group.matrixWorld.clone().invert(),v=new THREE.Vector3();
  const replaceGeneric=root=>{
    if(!root)return 0;root.updateMatrixWorld(true);let cut=0;
    root.traverse(o=>{
      if((!o.isMesh&&!o.isLineSegments)||!['bridge','path'].some(n=>o.name===n||o.name.startsWith(n+'__'))||o.userData.hoConRuaReplaced)return;
      o.userData.hoConRuaReplaced=true;const original=o.geometry,g=original.index?original.toNonIndexed():original,p=g.attributes.position,keep=[];let removed=0;
      const m=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);
      const stride=o.isLineSegments?2:3;
      for(let i=0;i<p.count;i+=stride){let within=true;for(let j=0;j<stride;j++){v.fromBufferAttribute(p,i+j).applyMatrix4(m);if(Math.hypot(v.x,v.z)>31.8||v.y>13||v.y< -1)within=false;}
        if(within)removed++;else for(let j=0;j<stride;j++)keep.push(i+j);
      }
      if(removed){const out=new THREE.BufferGeometry();for(const [name,attr]of Object.entries(g.attributes)){const arr=new attr.array.constructor(keep.length*attr.itemSize);keep.forEach((k,i)=>{for(let j=0;j<attr.itemSize;j++)arr[i*attr.itemSize+j]=attr.array[k*attr.itemSize+j];});out.setAttribute(name,new THREE.BufferAttribute(arr,attr.itemSize,attr.normalized));}out.computeBoundingBox();out.computeBoundingSphere();o.geometry=out;original.dispose();cut+=removed;}
      if(g!==original)g.dispose();
    });return cut;
  };
  const view={target:group.localToWorld(new THREE.Vector3(0,12,0)),eye:group.localToWorld(new THREE.Vector3(63,48,67))};
  return {group,state,view,ready,replaceGeneric,dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});Object.values(materials).forEach(m=>m.dispose());}};
}
