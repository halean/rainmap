/** Second Princess 60: independent, local-space model; city placement in princess60-berth.js.
 * Metres, Y up, +X bow, +Z port, design waterline Y=0.
 * No scene attachment, geographic coordinates, pier, or mooring side effects.
 * Principal dimensions: Princess 60 UK brochure (2013); detail is interpreted.
 */
import * as THREE from 'three';
import {builder, letters} from './landmark-kit.js';

export const PRINCESS60_NHARONG = Object.freeze({
  id: 'princess60-nharong', name: 'NHA RONG', length: 18.61, beam: 4.83,
  draft: 1.27, destination: 'Vinhomes Central Park Marina', status: 'moored-alongside-saigon-star',
});
const V = p => new THREE.Vector3(...p);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const stern=-7.85, stem=9.0, halfBeam=2.415;
function breadth(x) {
  const t=clamp((x-stern)/(stem-stern));
  return halfBeam*(t<0.48 ? 0.94+0.06*Math.sin(t/0.48*Math.PI/2) : Math.pow(Math.max(0,Math.cos((t-0.48)/0.52*Math.PI/2)),0.78));
}
const sheer=x=>1.52+0.75*Math.pow(clamp((x-stern)/(stem-stern)),2.3);
const keel=x=>-1.05+3.22*Math.pow(clamp((x-4.6)/4.4),1.75);
function hullPoint(x,u,sign) {
  const w=breadth(x), top=sheer(x), k=keel(x), chine=0.03+1.43*Math.pow(clamp((x-3)/6),1.7);
  if(u<=0.57) {
    const v=u/0.57;
    return [x,top+(chine-top)*v,sign*w*(1-0.105*v+0.012*Math.sin(v*Math.PI))];
  }
  const v=(u-0.57)/0.43;
  return [x,chine+(k-chine)*Math.pow(v,0.92),sign*w*0.895*(1-v)];
}
function topsideZ(x,y) {
  const chine=0.03+1.43*Math.pow(clamp((x-3)/6),1.7), v=clamp((sheer(x)-y)/(sheer(x)-chine));
  return breadth(x)*(1-0.105*v+0.012*Math.sin(v*Math.PI));
}

export function createPrincess60NhaRong() {
  const group=new THREE.Group(); group.name=PRINCESS60_NHARONG.id;
  group.userData={...PRINCESS60_NHARONG, waterline:0, bowAxis:'+X', revision:3};
  const mat=(color,props={})=>new THREE.MeshStandardMaterial({color,roughness:0.48,...props});
  const materials={
    ivory:mat('#f5f3ed',{roughness:0.22,metalness:0.08,side:THREE.DoubleSide}), white:mat('#faf9f5',{roughness:0.3}),
    navy:mat('#152939',{roughness:0.24,metalness:0.25}), bottom:mat('#23343a',{roughness:0.75}),
    steel:mat('#c9d7df',{metalness:0.94,roughness:0.19}), bronze:mat('#bc9354',{metalness:0.8,roughness:0.27}),
    glass:mat('#132d3b',{metalness:0.32,roughness:0.12,transparent:true,opacity:0.78,side:THREE.DoubleSide,depthWrite:false}),
    black:mat('#101a20',{roughness:0.56}), seam:mat('#43372c',{roughness:0.9}),
    teak:mat('#ac8051',{roughness:0.78}), teakLight:mat('#bd9160',{roughness:0.78}), teakDark:mat('#98704a',{roughness:0.78}),
    leather:mat('#ebe2cd',{roughness:0.86}), piping:mat('#d2c2a7',{roughness:0.9}),
    blue:mat('#244557',{roughness:0.88}), wood:mat('#6a4030',{roughness:0.38}),
    screen:mat('#163442',{emissive:'#137187',emissiveIntensity:0.38,roughness:0.27}),
    cyan:mat('#7ad2d8',{emissive:'#53becb',emissiveIntensity:0.65}),
    warm:mat('#fff0c6',{emissive:'#ffcc76',emissiveIntensity:0.65}),
    red:mat('#be2726'), green:mat('#218966'), gold:mat('#d0ac66',{metalness:0.72,roughness:0.3}),
    flag:mat('#d8212d',{roughness:0.95,side:THREE.DoubleSide}), star:mat('#ffe246',{roughness:0.8,side:THREE.DoubleSide}),
    skinWarm:mat('#c99170',{roughness:0.78}), skinTan:mat('#a76d4f',{roughness:0.8}), skinLight:mat('#e3b398',{roughness:0.8}),
    hairDark:mat('#30231f',{roughness:0.92}), hairBrown:mat('#785034',{roughness:0.92}),
    swimCoral:mat('#bf5447',{roughness:0.88}), swimTeal:mat('#257e85',{roughness:0.88}), swimNavy:mat('#253e61',{roughness:0.88}),
    lip:mat('#a56359',{roughness:0.85}), towelCream:mat('#e5d6b3',{roughness:1}),
    rope:mat('#c7c1ab',{roughness:1}), towel:mat('#597f90',{roughness:1}),
  };
  const components={}; let b, total=0;
  function component(name,fn) {
    const g=new THREE.Group();g.name=`p60nr-${name}`;components[name]=g;group.add(g);
    b=builder(materials,`p60nr-${name}`);fn();const triangles=b.finish(g);g.userData.triangles=triangles;total+=triangles;
  }
  const box=(m,w,h,d,x,y,z,yaw=0)=>b.box(m,w,h,d,x,y,z,yaw);
  function rounded(m,w,h,d,x,y,z,r=0.06,rx=0,ry=0,rz=0) {
    r=Math.min(r,w*0.48,h*0.48,d*0.48); const a=w/2-r,c=d/2-r,s=new THREE.Shape();
    s.moveTo(-a,-d/2);s.lineTo(a,-d/2);s.quadraticCurveTo(w/2,-d/2,w/2,-c);
    s.lineTo(w/2,c);s.quadraticCurveTo(w/2,d/2,a,d/2);s.lineTo(-a,d/2);
    s.quadraticCurveTo(-w/2,d/2,-w/2,c);s.lineTo(-w/2,-c);s.quadraticCurveTo(-w/2,-d/2,-a,-d/2);
    const g=new THREE.ExtrudeGeometry(s,{depth:Math.max(0.001,h-2*r),bevelEnabled:true,bevelSegments:5,steps:1,bevelSize:r,bevelThickness:r,curveSegments:10});
    // Bevel expands the outline: inset x/z so the nominal size stays exact.
    g.scale((w-2*r)/w,(d-2*r)/d,1);g.rotateX(-Math.PI/2);g.translate(0,-h/2+r,0);
    b.add(m,g,x,y,z,rx,ry,rz);
  }
  function rod(m,a,c,r=0.018,segments=16) {
    const av=V(a),cv=V(c),delta=cv.clone().sub(av),g=new THREE.CylinderGeometry(r,r,delta.length(),segments,1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate(...av.add(cv).multiplyScalar(0.5).toArray());b.add(m,g);
  }
  function tube(m,pts,r=0.018,closed=false,segments=16) {
    const path=new THREE.CatmullRomCurve3(pts.map(V),closed,'centripetal');
    b.add(m,new THREE.TubeGeometry(path,Math.max(32,pts.length*10),r,segments,closed));
  }
  function ellipsoid(m,x,y,z,rx,ry,rz) {
    const g=new THREE.SphereGeometry(1,40,24);g.scale(rx,ry,rz);b.add(m,g,x,y,z);
  }
  function torus(m,r,thick,x,y,z,rx=0,ry=0,rz=0) {b.add(m,new THREE.TorusGeometry(r,thick,12,48),x,y,z,rx,ry,rz);}
  function panel(m,pts) {
    const p=[]; for(let i=1;i<pts.length-1;i++)p.push(...pts[0],...pts[i],...pts[i+1]);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();b.add(m,g);
  }
  // Indexed sampled surfaces retain smooth normals before material batching.
  function surface(m,nu,nv,fn,flip=false,exclude=null) {
    const p=[],ind=[];
    for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++)p.push(...fn(i/nu,j/nv));
    for(let i=0;i<nu;i++)for(let j=0;j<nv;j++) {if(exclude && exclude(fn((i+0.5)/nu,(j+0.5)/nv)))continue;const a=i*(nv+1)+j,c=a+nv+1;if(flip)ind.push(a,a+1,c,a+1,c+1,c);else ind.push(a,c,a+1,a+1,c,c+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ind);g.computeVertexNormals();b.add(m,g);
  }
  function teakRect(x,y,z,w,d) {
    rounded('teakDark',w,0.045,d,x,y-0.015,z,0.02);
    const n=Math.floor(d/0.115),dw=(d-0.12)/n;
    for(let j=0;j<n;j++) {
      const zz=z-d/2+0.06+(j+0.5)*dw;
      for(let a=0;a<3;a++) {
        const len=(w-0.16)/3;
        box(['teak','teakLight','teakDark'][(j+a)%3],len-0.008,0.022,dw-0.008,x-w/2+0.08+(a+0.5)*len,y+0.016,zz);
      }
    }
  }
  function cushion(x,y,z,w,d) {
    rounded('leather',w,0.18,d,x,y,z,0.075);
    const pts=[[-w/2+0.09,-d/2+0.045],[w/2-0.09,-d/2+0.045],[w/2-0.045,-d/2+0.09],[w/2-0.045,d/2-0.09],[w/2-0.09,d/2-0.045],[-w/2+0.09,d/2-0.045],[-w/2+0.045,d/2-0.09],[-w/2+0.045,-d/2+0.09]];
    tube('piping',pts.map(([a,c])=>[x+a,y+0.055,z+c]),0.008,true,8);
    for(let i=1;i<4;i++)rod('piping',[x-w/2+0.12,y+0.091,z-d/2+d*i/4],[x+w/2-0.12,y+0.091,z-d/2+d*i/4],0.0025,6);
  }
  function seat(x,y,z) {
    // Seat faces +X; isolated transforms allow the aft seats to face forward too.
    rod('steel',[x,y,z],[x,y+0.4,z],0.065);cushion(x,y+0.52,z,0.62,0.59);
    rounded('leather',0.17,0.63,0.65,x-0.27,y+0.85,z,0.07,0,0,-0.15);
    for(const s of [-1,1]) rounded('leather',0.52,0.12,0.095,x,y+0.78,z+s*0.34,0.04);
  }
  function table(x,y,z,w,d) {
    for(const dx of [-w*0.28,w*0.28])rod('steel',[x+dx,y-0.55,z],[x+dx,y,z],0.048);
    rounded('teakLight',w,0.075,d,x,y,z,0.036);
    for(let i=1;i<7;i++)rod('seam',[x-w/2+0.07,y+0.04,z-d/2+d*i/7],[x+w/2-0.07,y+0.04,z-d/2+d*i/7],0.003,6);
    box('steel',0.014,0.008,d-0.1,x,y+0.045,z);
  }
  function cleat(x,y,z) {
    rounded('steel',0.30,0.035,0.12,x,y,z,0.016);
    for(const d of [-0.065,0.065])rod('steel',[x+d,y,z],[x+d,y+0.095,z],0.023);
    rod('steel',[x-0.21,y+0.105,z],[x+0.21,y+0.105,z],0.027);
    for(const d of [-0.11,0.11])ellipsoid('black',x+d,y+0.021,z,0.008,0.003,0.008);
  }

  component('hull',()=>{
    for(const s of [-1,1]) {
      surface('ivory',340,42,(u,v)=>hullPoint(stern+(stem-stern)*u,v*0.57,s),s>0);
      surface('bottom',340,30,(u,v)=>hullPoint(stern+(stem-stern)*u,0.57+v*0.43,s),s>0);
      // Fine waterline boot stripes and substantial stainless rubbing band.
      const rub=[],stripe=[];
      for(let i=0;i<=150;i++) {const x=stern+(stem-stern-0.02)*i/150;rub.push([x,sheer(x)-0.095,s*(breadth(x)+0.014)]);stripe.push([x,0.16+1.48*Math.pow(clamp((x-4)/5),1.6),s*(topsideZ(x,0.16+1.48*Math.pow(clamp((x-4)/5),1.6))+0.015)]);}
      tube('steel',rub,0.027);tube('navy',stripe,0.032);
      for(const frac of [0.32,0.6,0.83]) {
        const pts=[];for(let i=0;i<=90;i++){const x=stern+(8.6-stern)*i/90;const p=hullPoint(x,0.57+0.43*frac,s);p[2]+=s*0.016;pts.push(p);}tube('ivory',pts,0.022);
      }
      // Flush oval guest-cabin portlights with a real metallic rim.
      for(const [x,y,rx,ry] of [[5.6,1.24,0.65,0.17],[1.8,1.07,0.25,0.15],[-0.55,0.99,0.24,0.15]]) {
        const outline=[];
        for(let i=0;i<64;i++){const a=i/64*Math.PI*2,xx=x+rx*Math.cos(a),yy=y+ry*Math.sin(a);outline.push([xx,yy,s*(topsideZ(xx,yy)+0.014)]);}
        panel('glass',s>0?outline:[...outline].reverse());tube('steel',outline,0.015,true);
      }
      // Four vertical owner's-cabin windows, following the flared hull.
      for(let j=0;j<4;j++) {
        const x=-2.95+j*0.31,pts=[[x,0.37],[x+0.245,0.37],[x+0.245,1.19],[x,1.19]].map(([xx,yy])=>[xx,yy,s*(topsideZ(xx,yy)+0.02)]);
        panel('glass',s>0?pts:[...pts].reverse());tube('steel',pts,0.011,true);
      }
      // Engine-room intake scallop and closely spaced recessed louvers.
      const z=s*(breadth(-5.7)+0.002);rounded('navy',1.48,0.16,0.025,-5.6,1.18,z,0.01);
      for(let j=0;j<24;j++)box('steel',0.022,0.10,0.027,-6.25+j*0.055,1.18,z+s*0.012);
    }
    const rim=[];for(let i=0;i<=50;i++)rim.push(hullPoint(stern,i/50,1));for(let i=49;i>=0;i--)rim.push(hullPoint(stern,i/50,-1));
    // Boarding notches on each transom quarter; the steps actually pass through.
    for(const [z,y] of [[-2.12,1.52],[-2.12,0.42],[-1.39,0.42],[-1.39,1.52],[1.39,1.52],[1.39,0.42],[2.12,0.42],[2.12,1.52]])rim.push([stern,y,z]);
    const contour=rim.map(p=>new THREE.Vector2(p[2],p[1]));
    for(const tri of THREE.ShapeUtils.triangulateShape(contour,[])) {
      const pts=tri.map(i=>rim[i]);
      if(V(pts[1]).sub(V(pts[0])).cross(V(pts[2]).sub(V(pts[0]))).x>0)pts.reverse();
      panel('ivory',pts);
    }
    rounded('ivory',1.37,0.19,4.12,-8.50,0.23,0,0.09);teakRect(-8.50,0.335,0,1.25,3.95);
    for(const z of [-1.45,1.45]) {
      rounded('steel',0.055,0.15,0.26,stern-0.02,0.50,z,0.022);
      ellipsoid('cyan',stern-0.055,0.50,z,0.025,0.035,0.065);
      rod('steel',[-7.8,-0.25,z],[-8.45,0.10,z],0.065);
    }
    // Transom lettering faces aft, clear of the platform and boarding stairs.
    b.add('steel',letters('NHA RONG',{h:0.19,w:0.14,stroke:0.018,depth:0.012}),stern-0.012,0.91,0,0,-Math.PI/2,0);
  });

  component('deck',()=>{
    // Cambered deck runs all the way to the bow; solid closed deck skin.
    surface('white',240,36,(u,v)=>{const x=stern+(stem-stern)*u,t=v*2-1;return [x,sheer(x)+0.022+0.045*(1-t*t),t*breadth(x)];},true,([x,y,z])=>x< -7.04 && Math.abs(z)>1.39 && Math.abs(z)<2.12);
    // Planked foredeck clipped against the curved hull, with staggered butt joints.
    for(let j=-18;j<=18;j++) {
      const z=j*0.115;let start=3.12,end=8.75;
      while(end>start && breadth(end)<Math.abs(z)+0.15)end-=0.035;
      if(end<=start)continue;
      surface(j%3===0?'teakLight':j%3===1?'teakDark':'teak',32,1,(u,v)=>{const x=start+(end-start)*u;return[x,sheer(x)+0.075,z+(v-0.5)*0.107];},true);
      for(let x=4+(Math.abs(j)%3)*0.45;x<end;x+=1.8) rod('seam',[x,sheer(x)+0.078,z-0.053],[x,sheer(x)+0.078,z+0.053],0.004,6);
    }
    for(const s of [-1,1])for(let j=0;j<3;j++) {
      const pts=[];for(let i=0;i<=85;i++){const x=-7.4+10.6*i/85;pts.push([x,sheer(x)+0.063,s*(breadth(x)-0.13-j*0.11)]);}tube('teak',pts,0.047,false,8);
    }
    teakRect(-6.37,1.58,0,2.67,3.70);
    // Engine access hatch, hinge leaves, recessed lift rings.
    rounded('seam',1.18,0.025,0.92,-5.75,1.623,0,0.01);teakRect(-5.75,1.635,0,1.13,0.87);
    for(const z of [-0.27,0.27])box('steel',0.12,0.015,0.05,-6.26,1.668,z);
    torus('steel',0.045,0.006,-5.28,1.67,0,Math.PI/2);
    for(const s of [-1,1]) {
      // Platform-to-cockpit stairs with inset teak and courtesy lights.
      for(let i=0;i<4;i++) {const x=-7.93+i*0.22,y=0.55+i*0.27;rounded('ivory',0.32,0.25,0.62,x,y-0.12,s*1.75,0.04);teakRect(x,y+0.015,s*1.75,0.28,0.54);box('warm',0.012,0.045,0.13,x-0.163,y-0.075,s*1.75);}
      tube('steel',[[-8.12,0.63,s*2.05],[-7.5,1.46,s*2.05],[-6.95,2.25,s*2.05]],0.027);
    }
    // Bow sunbed: independently upholstered pads, bolsters and restrained towels.
    for(const s of [-1,1]) {cushion(4.65,2.16,s*0.54,2.22,1.02);rounded('leather',0.47,0.23,1.02,3.74,2.32,s*0.54,0.10,0,0,-0.18);}
    rounded('towel',1.23,0.025,0.57,4.78,2.269,0.51,0.009);
    for(let j=0;j<5;j++)box('leather',0.028,0.009,0.57,4.28+j*0.045,2.287,0.51);
    rounded('steel',0.65,0.025,0.65,6.25,sheer(6.25)+0.09,0,0.012);
    rounded('glass',0.58,0.025,0.58,6.25,sheer(6.25)+0.108,0,0.012);
    for(const z of [-0.22,0.22])box('steel',0.045,0.028,0.06,6.0,sheer(6.25)+0.132,z);
  });

  component('superstructure',()=>{
    // Sweeping cabin sides: large raked windows remain genuinely open behind glass.
    for(const s of [-1,1]) {
      const z=s*1.91;
      panel('ivory',[[-4.9,1.58,z],[-4.9,2.25,z],[2.38,2.37,z],[3.62,1.81,s*1.70]]);
      const win=[[-4.83,2.32,z],[-4.32,3.40,s*1.82],[1.68,3.35,s*1.76],[3.10,2.43,s*1.85]];
      panel('glass',s>0?win:[...win].reverse());tube('steel',win,0.026,true);
      for(const x of [-2.94,-0.3,1.65])rod('ivory',[x,2.34,z],[x-0.48,3.37,s*1.8],0.056);
      // Sculpted eyebrow above the glass and tapering aft buttress.
      tube('ivory',[[-5.1,3.52,s*1.98],[-3.2,3.67,s*1.97],[0.0,3.65,s*1.88],[1.8,3.47,s*1.79],[3.19,2.46,s*1.9]],0.082);
      panel('ivory',[[-5.05,2.1,s*1.95],[-5.0,3.55,s*1.96],[-4.33,3.46,s*1.85],[-4.82,2.3,s*1.91]]);
      rod('steel',[0.9,3.0,s*1.87],[1.27,3.0,s*1.87],0.012);
    }
    const wind=[[[1.75,3.38,-1.76],[3.16,2.42,-1.86],[3.16,2.42,1.86],[1.75,3.38,1.76]]][0];
    panel('glass',wind);tube('ivory',wind,0.048,true);
    for(const z of [-0.61,0.61])rod('steel',[1.75,3.38,z],[3.16,2.42,z],0.025);
    for(const z of [-1.17,0,1.17]) {rod('black',[3.05,2.5,z],[2.35,2.98,z+0.2],0.012);rod('black',[2.2,3.085,z+0.2],[2.7,2.745,z+0.2],0.018);}
    // Shaped coachroof and overhanging flybridge floor.
    const roof=[[-6.65,-1.88],[-6.8,-1.65],[-6.8,1.65],[-6.65,1.88],[-3.3,2.0],[0.7,1.9],[2.04,1.66],[2.26,1.1],[2.33,0],[2.26,-1.1],[2.04,-1.66],[0.7,-1.9],[-3.3,-2.0]];
    const roofShape=new THREE.Shape(roof.map(([x,z])=>new THREE.Vector2(x,-z)));
    const stairHole=new THREE.Path();stairHole.moveTo(-6.66,0.90);stairHole.lineTo(-4.94,0.90);stairHole.lineTo(-4.94,1.63);stairHole.lineTo(-6.66,1.63);stairHole.closePath();roofShape.holes.push(stairHole);
    const roofGeometry=new THREE.ExtrudeGeometry(roofShape,{depth:0.23,bevelEnabled:false});roofGeometry.rotateX(-Math.PI/2);roofGeometry.translate(0,3.50,0);b.add('ivory',roofGeometry);
    for(const s of [-1,1])tube('steel',[[-6.55,3.61,s*1.9],[-3.3,3.73,s*2.01],[0.65,3.70,s*1.91],[2.03,3.65,s*1.65]],0.021);
    // Triple sliding saloon doors, with rails and handles.
    for(let j=0;j<3;j++) {
      const z=-1.18+j*1.18;panel('glass',[[-4.96,1.69,z-0.55],[-4.96,3.39,z-0.55],[-4.96,3.39,z+0.55],[-4.96,1.69,z+0.55]]);
      for(const zz of [z-0.55,z+0.55])rod('steel',[-4.975,1.66,zz],[-4.975,3.43,zz],0.018);
      rod('steel',[-5.01,2.30,z+0.39],[-5.01,2.57,z+0.39],0.015);
    }
    for(const y of [1.68,3.43])rod('steel',[-4.99,y,-1.78],[-4.99,y,1.78],0.023);
    for(const x of [-5.55,-6.3])for(const z of [-1.2,1.2])ellipsoid('warm',x,3.48,z,0.045,0.012,0.045);
  });

  component('saloon',()=>{
    teakRect(-1.72,1.70,0,6.25,3.45);
    for(const s of [-1,1]) {
      rounded('wood',2.8,0.36,0.72,-3.0,1.92,s*1.31,0.045);
      for(let i=0;i<3;i++)cushion(-4+i*0.96,2.18,s*1.29,0.9,0.7);
      rounded('leather',2.90,0.52,0.17,-3,2.40,s*1.64,0.06);
    }
    table(-2.7,2.20,0,1.42,0.82);
    rounded('wood',1.4,0.78,0.62,0.35,2.09,-1.34,0.025);
    rounded('white',1.48,0.055,0.70,0.35,2.51,-1.34,0.024);
    rounded('steel',0.49,0.019,0.41,0.63,2.55,-1.34,0.008);
    rounded('black',0.40,0.013,0.33,0.63,2.568,-1.34,0.006);
    tube('steel',[[0.72,2.56,-1.58],[0.72,2.82,-1.58],[0.72,2.87,-1.40],[0.72,2.78,-1.35]],0.015);
    for(const x of [-0.13,0.15])for(const z of [-1.21,-1.49])torus('black',0.1,0.012,x,2.552,z,Math.PI/2);
    for(let i=0;i<3;i++){box('seam',0.004,0.64,0.012,-0.3+i*0.44,2.12,-0.999);rod('steel',[-0.21+i*0.44,2.31,-0.98],[-0.02+i*0.44,2.31,-0.98],0.01);}
    seat(1.04,1.73,-0.58);seat(1.04,1.73,0.22);
    rounded('navy',0.55,0.45,1.5,1.87,2.47,-0.1,0.09);
    for(const z of [-0.5,0.16])rounded('screen',0.3,0.018,0.47,1.76,2.71,z,0.006,0,0,-0.28);
  });

  component('flybridge',()=>{
    teakRect(-1.92,3.75,0,6.04,3.35);teakRect(-5.72,3.75,0.43,1.55,2.38);
    // Low sculpted coaming, not a closed upper cabin.
    for(const s of [-1,1]) {
      tube('ivory',[[-6.3,3.9,s*1.7],[-5.0,3.91,s*1.79],[-2.4,3.98,s*1.81],[0.45,4.02,s*1.67],[1.48,4.12,s*1.3]],0.12);
      tube('steel',[[-6.18,4.32,s*1.67],[-4.7,4.36,s*1.78],[-2.75,4.38,s*1.79]],0.022);
      for(const x of [-6.1,-5.15,-4.2,-3.25])rod('steel',[x,3.94,s*1.76],[x,4.35,s*1.76],0.019);
    }
    // Aft sunpad and U-shaped lounge, segmented upholstery.
    rounded('white',1.68,0.29,2.05,-5.56,3.95,0.42,0.12);
    for(let j=0;j<2;j++)cushion(-5.55,4.17,-0.07+j*0.98,1.57,0.93);
    rounded('white',2.56,0.35,0.77,-3.35,3.96,1.18,0.07);
    for(let j=0;j<3;j++)cushion(-4.18+j*0.85,4.19,1.15,0.8,0.71);
    rounded('leather',2.7,0.48,0.18,-3.35,4.40,1.53,0.06);
    for(const x of [-4.53,-2.15]){cushion(x,4.19,0.61,0.61,0.73);rounded('leather',0.18,0.45,0.87,x+(x< -3?-0.26:0.26),4.4,0.63,0.06);}
    table(-3.34,4.38,0.40,1.63,0.79);
    // Twin helm seats, sloping console, separate displays and instrument bezels.
    seat(-0.73,3.80,-0.56);seat(-0.73,3.80,0.21);
    rounded('ivory',0.9,0.76,1.92,0.43,4.17,-0.21,0.12);
    rounded('navy',0.70,0.05,1.75,0.34,4.56,-0.21,0.02,0,0,-0.18);
    for(const z of [-0.70,-0.06]) {
      rounded('black',0.43,0.032,0.53,0.35,4.603,z,0.009,0,0,-0.18);
      rounded('screen',0.37,0.033,0.45,0.35,4.624,z,0.006,0,0,-0.18);
      // Chart grid and a tiny route line modelled directly on the display.
      for(let j=0;j<4;j++)rod('cyan',[0.21,4.66-j*0.012,z-0.16+j*0.105],[0.47,4.613-j*0.012,z-0.16+j*0.105],0.003,6);
    }
    torus('steel',0.195,0.018,-0.12,4.39,0.20,0,Math.PI/2,0.3);
    for(let j=0;j<3;j++){const a=j*Math.PI*2/3;rod('steel',[-0.12,4.39,0.20],[-0.12,4.39+0.18*Math.sin(a),0.20+0.18*Math.cos(a)],0.009);}
    ellipsoid('navy',-0.13,4.39,0.2,0.03,0.055,0.055);
    for(const z of [-1.05,-0.93]){rod('steel',[-0.04,4.5,z],[0.02,4.69,z],0.009);ellipsoid('black',0.02,4.69,z,0.03,0.032,0.026);}
    for(let j=0;j<5;j++){ellipsoid('steel',0.49,4.605,0.44+j*0.082,0.038,0.007,0.034);ellipsoid('black',0.49,4.614,0.44+j*0.082,0.029,0.005,0.027);}
    // Wraparound flybridge wind deflector.
    const screen=[];for(let i=0;i<=42;i++){const a=-Math.PI/2+Math.PI*i/42;screen.push([0.85+0.96*Math.cos(a),4.22,1.53*Math.sin(a)]);}
    for(let i=0;i<screen.length-1;i++){const a=screen[i],c=screen[i+1];panel('glass',[a,c,[c[0]-0.14,4.62,c[2]],[a[0]-0.14,4.62,a[2]]]);}
    tube('steel',screen.map(p=>[p[0]-0.14,4.62,p[2]]),0.014);
    // Wet bar: hinged barbecue, sink, faucet, cabinet doors and louvered fridge.
    rounded('ivory',1.57,0.69,0.66,-2.75,4.12,-1.17,0.08);
    rounded('white',1.64,0.06,0.74,-2.75,4.50,-1.17,0.025);
    rounded('steel',0.52,0.02,0.49,-2.29,4.54,-1.17,0.009);
    rounded('black',0.42,0.013,0.38,-2.29,4.555,-1.17,0.006);
    tube('steel',[[-2.2,4.55,-1.47],[-2.2,4.81,-1.47],[-2.2,4.83,-1.27],[-2.2,4.75,-1.23]],0.014);
    rounded('steel',0.58,0.035,0.48,-3.15,4.55,-1.17,0.016);
    for(let j=0;j<10;j++)rod('black',[-3.39+j*0.053,4.573,-1.35],[-3.39+j*0.053,4.573,-0.99],0.009);
    for(let j=0;j<2;j++){rounded('seam',0.65,0.48,0.014,-3.12+j*0.76,4.1,-0.828,0.006);rounded('white',0.62,0.45,0.015,-3.12+j*0.76,4.1,-0.817,0.006);rod('steel',[-3.31+j*0.76,4.26,-0.80],[-3.08+j*0.76,4.26,-0.80],0.012);}
    // Raked radar arch, broad flat GRP legs and overhead bridge.
    for(const s of [-1,1]) {
      const shape=[[-4.72,3.84,s*1.73],[-4.30,3.89,s*1.73],[-4.80,5.69,s*1.48],[-5.27,5.76,s*1.48]];
      panel('ivory',shape);panel('ivory',shape.map(p=>[p[0],p[1],p[2]+s*0.13]).reverse());
      for(let i=0;i<4;i++)panel('ivory',[shape[i],shape[(i+1)%4],[shape[(i+1)%4][0],shape[(i+1)%4][1],shape[(i+1)%4][2]+s*0.13],[shape[i][0],shape[i][1],shape[i][2]+s*0.13]]);
    }
    rounded('ivory',0.68,0.20,3.10,-5.03,5.73,0,0.09);
    rod('steel',[-5.03,5.82,0],[-5.03,6.23,0],0.045);
    rounded('white',0.32,0.19,1.57,-5.03,6.26,0,0.09);
    for(const z of [-1.16,1.16]){ellipsoid('white',-5.03,5.97,z,0.18,0.23,0.18);rod('steel',[-4.72,5.73,z],[-4.47,7.15,z],0.012);}
    rod('steel',[-5.17,5.81,0],[-5.33,6.83,0],0.02);ellipsoid('warm',-5.33,6.85,0,0.05,0.065,0.05);
    // Stairway outboard to leave cockpit and saloon doorway usable.
    for(let i=0;i<9;i++) {const x=-6.90+i*0.24,y=1.82+i*0.225;rounded('white',0.31,0.14,0.61,x,y,-1.27,0.035);teakRect(x,y+0.081,-1.27,0.28,0.56);}
    for(const z of [-1.64,-0.92])tube('steel',[[-7.0,2.48,z],[-6.3,3.13,z],[-5.13,4.27,z]],0.023);
  });

  component('cockpit',()=>{
    rounded('white',0.60,0.43,2.49,-7.28,1.82,0,0.08);
    for(let i=0;i<3;i++)cushion(-7.27,2.08,-0.82+i*0.82,0.62,0.77);
    rounded('leather',0.18,0.47,2.50,-7.58,2.30,0,0.07);
    table(-6.29,2.18,0.25,0.91,1.55);
    // Small objects resolve at deck-level zoom: tumblers, plates and a bottle.
    for(const z of [-0.24,0.77]) {torus('white',0.12,0.017,-6.29,2.23,z,Math.PI/2);rod('glass',[-6.34,2.23,z+0.25],[-6.34,2.37,z+0.25],0.038,24);}
    rod('green',[-6.19,2.23,0.25],[-6.19,2.49,0.25],0.045,24);rod('gold',[-6.19,2.49,0.25],[-6.19,2.57,0.25],0.018);
    for(const s of [-1,1]) {
      rounded('ivory',1.61,0.36,0.19,-6.65,1.91,s*2.03,0.07);
      for(const x of [-6.12,-6.55]) {torus('steel',0.065,0.006,x,2.10,s*2.03,Math.PI/2);ellipsoid('black',x,2.095,s*2.03,0.056,0.006,0.056);}
      torus('steel',0.1,0.012,-7.32,1.22,s*1.42,0,Math.PI/2);
    }
  });

  component('hardware',()=>{
    for(const s of [-1,1]) {
      const rail=[];
      for(let i=0;i<=85;i++) {const x=-5+13.87*i/85;rail.push([x,sheer(x)+0.88,s*(breadth(x)-0.08)]);}
      tube('steel',rail,0.021);tube('steel',rail.map(p=>[p[0],p[1]-0.39,p[2]]),0.013);
      for(let x=-4.9;x<8.5;x+=1.08) {const z=s*(breadth(x)-0.08),y=sheer(x);rod('steel',[x,y+0.06,z],[x,y+0.88,z],0.018);rounded('steel',0.10,0.02,0.07,x,y+0.075,z,0.009);}
      for(const x of [-7.05,-2.9,6.8])cleat(x,sheer(x)+0.08,s*(breadth(x)-0.25));
      for(const x of [-3.8,0.25]) {const y=sheer(x)+0.07,z=s*(breadth(x)-0.23);torus('steel',0.063,0.008,x,y,z,Math.PI/2);ellipsoid('steel',x,y,z,0.057,0.008,0.057);rod('black',[x-0.025,y+0.01,z],[x+0.025,y+0.01,z],0.004);}
      // Stowed fenders and their lines, with ribs and end eyelets.
      for(const x of [-4.1,-5.15,-6.2]) {
        const z=s*(breadth(x)+0.09),y=1.12;
        ellipsoid('blue',x,y,z,0.15,0.43,0.15);
        for(let j=0;j<12;j++){const a=j*Math.PI/6;rod('navy',[x+0.143*Math.cos(a),y-0.23,z+0.143*Math.sin(a)],[x+0.143*Math.cos(a),y+0.23,z+0.143*Math.sin(a)],0.004,6);}
        torus('steel',0.027,0.008,x,y+0.415,z);
        tube('rope',[[x,y+0.43,z],[x+0.02,2.1,z],[x,2.34,z-0.09*s]],0.008,false,8);
      }
      // Navigation light housings: port red, starboard green.
      rounded('steel',0.18,0.095,0.07,1.23,3.48,s*1.79,0.03);
      ellipsoid(s>0?'red':'green',1.23,3.48,s*1.831,0.06,0.031,0.02);
    }
    // Bow pulpit, windlass, anchor roller, exposed linked chain and Delta anchor.
    tube('steel',[[8.82,3.11,-0.15],[9.12,3.13,-0.13],[9.3,3.13,0],[9.12,3.13,0.13],[8.82,3.11,0.15]],0.02);
    rounded('steel',0.73,0.09,0.25,8.81,2.29,0,0.03);
    for(const x of [8.51,8.84,9.10])rod('black',[x,2.31,-0.09],[x,2.31,0.09],0.04);
    rounded('steel',0.50,0.1,0.42,7.63,2.27,0,0.025);rod('steel',[7.63,2.3,0],[7.63,2.53,0],0.105,32);
    for(let j=0;j<23;j++)torus('steel',0.035,0.008,7.84+j*0.05,2.34,0,j%2?Math.PI/2:0,Math.PI/2);
    rod('steel',[9.1,2.27,0],[8.98,1.67,0],0.035);
    panel('steel',[[8.98,1.69,0],[8.61,1.53,-0.27],[9.22,1.53,0]]);panel('steel',[[8.98,1.69,0],[9.22,1.53,0],[8.61,1.53,0.27]]);
    for(const z of [-0.59,0.59]){rounded('white',0.47,0.022,0.43,7.81,2.21,z,0.01);torus('steel',0.034,0.007,7.8,2.232,z,Math.PI/2);}
    // Rope coils are onboard, not connected to land.
    for(const z of [-1.13,1.13])for(let j=0;j<5;j++)torus('rope',0.11+j*0.023,0.01,-6.70,1.64,z,Math.PI/2);
    // Retracted bathing ladder on the platform.
    for(const z of [-1.49,-1.10])tube('steel',[[-8.91,0.37,z],[-9.05,0.37,z],[-9.07,0.15,z]],0.022);
    for(let j=0;j<4;j++)rod('steel',[-8.50-j*0.13,0.39,-1.49],[-8.50-j*0.13,0.39,-1.10],0.023);
    // Radar-arch searchlight and horn trumpets.
    rounded('white',0.26,0.19,0.29,1.0,3.86,0,0.07);ellipsoid('warm',1.15,3.87,0,0.015,0.067,0.10);
    for(const z of [-0.22,0.22]) {const g=new THREE.ConeGeometry(0.065,0.30,32,1,true);g.rotateZ(-Math.PI/2);b.add('steel',g,-4.69,5.9,z);}
  });

  component('running-gear',()=>{
    for(const s of [-1,1]) {
      const z=s*1.02;
      rod('steel',[-3.8,-0.40,z],[-6.77,-0.95,z],0.045,24);
      rod('bronze',[-5.95,-0.30,z],[-6.42,-0.86,z],0.065,24);
      ellipsoid('bronze',-6.63,-0.93,z,0.22,0.095,0.095);
      for(let blade=0;blade<4;blade++) {
        const a0=blade*Math.PI/2;
        surface('bronze',30,16,(u,v)=>{const r=0.07+u*0.27,a=a0+u*0.7+(v-0.5)*1.08*Math.sin(Math.PI*u);return[-6.65+(v-0.5)*0.14+0.04*u,-0.93+r*Math.sin(a),z+r*Math.cos(a)];},s<0);
        // Opposite face avoids depending on double-sided material for the blade.
        surface('bronze',30,16,(u,v)=>{const r=0.07+u*0.27,a=a0+u*0.7+(v-0.5)*1.08*Math.sin(Math.PI*u);return[-6.656+(v-0.5)*0.14+0.04*u,-0.93+r*Math.sin(a),z+r*Math.cos(a)];},s>0);
      }
      rounded('bronze',0.47,0.73,0.052,-7.21,-0.905,z,0.024);
      rod('steel',[-7.16,-0.32,z],[-7.16,-0.65,z],0.044);
      box('steel',0.47,0.035,0.65,-7.96,-0.16,s*1.65);
      rod('steel',[-7.83,0.25,s*1.65],[-8.08,-0.15,s*1.65],0.027);
      // Exhaust trim rings, recessed black throats.
      torus('steel',0.11,0.022,-7.865,0.02,s*1.80,0,Math.PI/2);
      ellipsoid('black',-7.862,0.02,s*1.80,0.016,0.096,0.096);
    }
  });

  component('ensign',()=>{
    rod('steel',[-7.69,1.55,0],[-8.12,3.06,0],0.016);
    // Static sewn flag, curved in three dimensions. No cloth subsystem dependency.
    const at=(u,v)=>[-8.11-u*0.82,3.04-v*0.52-u*0.13,0.055*Math.sin(u*9-v*2)*u];
    surface('flag',72,42,at);
    const star=[];for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?0.057:0.145;star.push(at(0.50+Math.cos(a)*r/0.82,0.5-Math.sin(a)*r/0.52));}
    const center=at(0.5,0.5);
    for(let i=0;i<10;i++)for(const s of [-1,1])panel('star',[center,star[i],star[(i+1)%10]].map(p=>[p[0],p[1],p[2]+s*0.004]));
    tube('rope',[[ -8.1,3.04,0],[-7.71,1.65,0.015]],0.004,false,6);
  });


  // Adult-scale, relaxed sunbathers. Each figure stays on its own cushion;
  // the flybridge figure bends the knees to fit the shorter aft sunbed.
  function sunbather({id,x,y,z,skin,hair,swim,onePiece=false,bent=false}) {
    const start=total;
    component(`sunbather-${id}`,()=>{
      const P=(a,h,c)=>[x+a,y+h,z+c];
      const blob=(m,a,h,c,rx,ry,rz)=>ellipsoid(m,x+a,y+h,z+c,rx,ry,rz);
      const limb=(m,a,c,r0,r1)=>{
        const A=V(P(...a)),B=V(P(...c)),d=B.clone().sub(A);
        const g=new THREE.CylinderGeometry(r1,r0,d.length(),32,8);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));
        g.translate(...A.add(B).multiplyScalar(0.5).toArray());b.add(m,g);
        blob(m,...a,r0,r0,r0);blob(m,...c,r1,r1,r1);
      };
      // A fitted towel and small pillow support the body rather than float over it.
      rounded('towelCream',bent?1.46:1.92,0.019,0.62,x+(bent?0.12:0.20),y-0.014,z,0.006);
      for(const end of [-1,1])for(let j=0;j<15;j++){
        const xx=x+(bent?0.12:0.20)+end*(bent?0.70:0.92);
        rod('towelCream',[xx,y-0.003,z-0.28+j*0.04],[xx+end*0.05,y-0.008,z-0.28+j*0.04],0.003,6);
      }
      rounded('towel',0.34,0.075,0.38,x-0.48,y+0.035,z,0.033);
      // Elliptical torso sections with shoulder, ribcage, waist and hip contours.
      const stations=[[-0.32,0.135,0.075,0.12],[-0.24,0.145,0.09,0.205],[-0.07,0.148,0.10,0.184],[0.12,0.135,0.085,0.139],[0.27,0.13,0.095,0.172],[0.35,0.12,0.082,0.155]];
      surface(onePiece?swim:skin,72,64,(u,v)=>{
        const q=u*(stations.length-1),i=Math.min(stations.length-2,Math.floor(q)),t=q-i;
        const k=stations[i].map((n,j)=>n+(stations[i+1][j]-n)*t),a=v*Math.PI*2;
        return P(k[0],k[1]+k[2]*Math.cos(a),k[3]*Math.sin(a));
      },true);
      blob(skin,-0.335,0.15,0,0.09,0.072,0.073);
      blob(skin,-0.475,0.203,0,0.13,0.117,0.095);
      blob(skin,-0.387,0.221,0,0.052,0.064,0.070); // jaw/chin
      for(const sign of [-1,1])blob(skin,-0.485,0.19,sign*0.094,0.030,0.043,0.015);
      // Hair is a scalp hemisphere, leaving the upward-facing face uncovered.
      const scalp=new THREE.SphereGeometry(1,48,32,0,Math.PI*2,0,Math.PI*0.52);
      scalp.scale(0.134,0.125,0.102);scalp.rotateZ(Math.PI/2);b.add(hair,scalp,x-0.492,y+0.20,z);
      if(onePiece) {
        blob(hair,-0.617,0.165,0,0.077,0.060,0.074);
        for(let j=0;j<9;j++)tube(hair,[P(-0.57,0.25,-0.073+j*0.018),P(-0.624,0.20,-0.067+j*0.016),P(-0.652,0.15,-0.05+j*0.012)],0.004,false,8);
        // Shoulder straps and neckline trim.
        for(const sign of [-1,1])tube(swim,[P(-0.31,0.205,sign*0.13),P(-0.33,0.17,sign*0.15),P(-0.27,0.11,sign*0.19)],0.019,false,12);
      } else {
        // Separate tailored swim-short legs, waistband and drawstring.
        for(const sign of [-1,1])limb(swim,[0.23,0.13,sign*0.094],[0.44,0.115,sign*0.115],0.105,0.09);
        tube('white',[P(0.19,0.209,-0.14),P(0.18,0.225,0),P(0.19,0.209,0.14)],0.008,false,8);
        tube('white',[P(0.19,0.231,0),P(0.28,0.232,-0.02),P(0.30,0.218,-0.01)],0.004,false,8);
      }
      // Small face details and sunglasses: lenses, bridge and temples.
      blob(skin,-0.457,0.318,0,0.032,0.033,0.022);
      tube('lip',[P(-0.406,0.290,-0.026),P(-0.40,0.295,0),P(-0.406,0.290,0.026)],0.005,false,8);
      for(const sign of [-1,1]) {
        blob('black',-0.507,0.309,sign*0.044,0.030,0.012,0.033);
        blob('navy',-0.507,0.320,sign*0.044,0.025,0.005,0.028);
        tube('black',[P(-0.513,0.308,sign*0.075),P(-0.527,0.276,sign*0.097),P(-0.526,0.203,sign*0.102)],0.006,false,8);
      }
      rod('black',P(-0.51,0.313,-0.018),P(-0.51,0.313,0.018),0.005,8);
      for(const sign of [-1,1]) {
        const shoulder=[-0.23,0.135,sign*0.202],elbow=[0.02,0.080,sign*0.292],wrist=[0.27,0.055,sign*0.278];
        limb(skin,shoulder,elbow,0.066,0.046);limb(skin,elbow,wrist,0.048,0.029);
        blob(skin,0.32,0.053,sign*0.274,0.069,0.027,0.042);
        for(let f=0;f<4;f++)limb(skin,[0.35,0.052,sign*(0.247+f*0.018)],[0.417-Math.abs(f-1.5)*0.007,0.043,sign*(0.247+f*0.018)],0.010,0.007);
        limb(skin,[0.30,0.05,sign*0.241],[0.35,0.035,sign*0.215],0.015,0.010);
        const knee=bent?[0.59,0.39,sign*0.135]:[0.71,0.105,sign*0.12];
        const ankle=bent?[0.86,0.080,sign*0.145]:[1.10,0.061,sign*0.125];
        limb(skin,[0.31,0.125,sign*0.098],knee,0.094,0.064);
        limb(skin,knee,ankle,0.064,0.033);
        if(!onePiece)limb(swim,[0.28,0.133,sign*0.099],[0.44,bent?0.24:0.119,sign*0.114],0.101,0.088);
        blob(skin,ankle[0]+0.060,0.06,ankle[2],0.101,0.043,0.047);
        for(let toe=0;toe<5;toe++)blob(skin,ankle[0]+0.133-Math.abs(toe-1)*0.006,0.053,ankle[2]+sign*(-0.03+toe*0.015),0.024,0.014,0.009);
      }
      // Bracelet and seams provide readable details at deck-level zoom.
      torus('gold',0.031,0.004,x+0.263,y+0.055,z-0.278,0,Math.PI/2);
    });
    components[`sunbather-${id}`].userData={...components[`sunbather-${id}`].userData,adult:true,pose:bent?'reclining-bent-knees':'reclining',triangles:total-start};
  }
  sunbather({id:'foredeck-port',x:4.32,y:2.30,z:0.54,skin:'skinWarm',hair:'hairDark',swim:'swimCoral',onePiece:true});
  sunbather({id:'foredeck-starboard',x:4.32,y:2.30,z:-0.54,skin:'skinTan',hair:'hairDark',swim:'swimNavy'});
  sunbather({id:'flybridge',x:-5.59,y:4.29,z:0.91,skin:'skinLight',hair:'hairBrown',swim:'swimTeal',onePiece:true,bent:true});
  group.userData.sunbathers=3;

  group.userData.triangles=total;
  group.userData.components=Object.keys(components);
  group.updateMatrixWorld(true);
  let disposed=false;
  return {group,components,materials,triangles:total,
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});Object.values(materials).forEach(m=>m.dispose());}
  };
}
