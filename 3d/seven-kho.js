// Standalone photographic interpretation. Local metres; +Z faces the street.
// No scene attachment, map coordinates, city imports or network requests.
import * as THREE from 'three';
import {builder} from './landmark-kit.js';
import {paintSevenKhoMurals} from './seven-kho-murals.js';
export const SEVEN_KHO = Object.freeze({name:'7 Khô',address:'94–96–98 Lý Thái Tổ, P.2, Q.3 (photographed menu)',listingAddress:'98B Lý Thái Tổ',identity:'Lý Thái Tổ confirmed by user',status:'standalone-not-integrated',estimated:true});
export function createSevenKho({city=false}={}){
 const group=new THREE.Group();group.name='seven-kho';group.userData={...SEVEN_KHO};
 const materials={};
 const colors={paintCream:'#d9c6a0',paintOchre:'#c6aa76',paintCoral:'#af6552',paintPink:'#b87586',paintTeal:'#557e73',paintSkin:'#bf9975',floor:'#c7c4b9',ceiling:'#b7b8af',conduit:'#85877d',wood:'#655440',grain:'#99816a',muralPlaster:'#aaa185',muralDoor:'#3e615a',muralTrim:'#807d63',muralInk:'#605646',brick:'#85654d',brickLight:'#a28465',shutter:'#3b9990',shutterDark:'#24655f',screen:'#777f81',thatch:'#665d48',thatchLight:'#8e8161',awning:'#29453d',bamboo:'#ab9b65',blue:'#345371',clay:'#9b8264',carrot:'#dc7830',cucumber:'#9dbb61',cabbage:'#d9dfac',crumb:'#d6b878',chili:'#b73c22',ice:'#d2e1d5',bronze:'#746447',plaster:'#797970',stone:'#b9b3a1',recess:'#45483f',trim:'#cec8b4',timber:'#443b2d',metal:'#a8b0af',iron:'#292e2b',chair:'#282d29',table:'#393b33',tile:'#928e7d',grout:'#656658',red:'#b82d24',gold:'#b18b46',paper:'#ba9870',porcelain:'#e1dbc0',sauce:'#8c381b',squid:'#b78955',food:'#be8b35',herb:'#456b2a',bottle:'#294b32',beer:'#bf8422',glass:'#b4c6b5',bark:'#62523b',leaf:'#365337',leafLight:'#61754c',bulb:'#ffe4aa',lantern:'#ec3024',water:'#668176'};
 for(const [k,color] of Object.entries(colors))materials[k]=new THREE.MeshStandardMaterial({color,roughness:['metal','glass','table','porcelain'].includes(k)?.3:.84,metalness:k==='metal'?.7:0});
 materials.glass.transparent=true;materials.glass.opacity=.28;materials.glass.depthWrite=false;materials.glass.roughness=.12;
 materials.bulb.emissive.set('#ffbf66');materials.bulb.emissiveIntensity=2;
 materials.lantern.emissive.set('#f92813');materials.lantern.emissiveIntensity=.4;
 const components={};let triangles=0;
 function section(name,build){const g=new THREE.Group();g.name=`seven-kho-${name}`;components[name]=g;const b=builder(materials,`seven-kho-${name}`);build(b);triangles+=b.finish(g);group.add(g);}
 const vec=a=>new THREE.Vector3(...a);
 function rod(b,k,a,c,r=.02,n=10){const start=vec(a),end=vec(c),d=end.clone().sub(start),g=new THREE.CylinderGeometry(r,r,d.length(),n);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray());b.add(k,g);}
 function curve(b,k,pts,r=.018,steps=24){b.add(k,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(vec)),steps,r,8,false));}
 function ball(b,k,x,y,z,sx,sy=sx,sz=sx,n=16){const g=new THREE.SphereGeometry(1,n,10);g.scale(sx,sy,sz);b.add(k,g,x,y,z);}
 function cyl(b,k,r,h,x,y,z,r2=r,n=24){b.add(k,new THREE.CylinderGeometry(r,r2,h,n),x,y,z);}
 function ring(b,k,r,t,x,y,z,rx=0){b.add(k,new THREE.TorusGeometry(r,t,8,32),x,y,z,rx);}
 function frame(b,x,y,z,w,h,k='trim',t=.065){b.box(k,w,t,.075,x,y-h/2,z);b.box(k,w,t,.075,x,y+h/2,z);b.box(k,t,h,.075,x-w/2,y,z);b.box(k,t,h,.075,x+w/2,y,z);}
 function diamond(b,x,y,z,size){const pts=[[x,y+size,z],[x+size,y,z],[x,y-size,z],[x-size,y,z],[x,y+size,z]];for(let i=1;i<pts.length;i++)rod(b,'trim',pts[i-1],pts[i],.026);}
 function arch(b,x,y,z,w,rise){const pts=[];for(let i=0;i<=24;i++){const a=Math.PI*i/24;pts.push([x+w/2*Math.cos(a),y+rise*Math.sin(a),z]);}curve(b,'trim',pts,.075,40);curve(b,'stone',pts.map(([a,c,d])=>[a,c+.16,d-.045]),.07,40);}
 const glyph={ '7':[[0,1,.65,1],[.65,1,.15,0]],K:[[0,0,0,1],[0,.45,.62,1],[0,.45,.65,0]],H:[[0,0,0,1],[.65,0,.65,1],[0,.5,.65,.5]],O:[[0,0,0,1],[0,1,.65,1],[.65,1,.65,0],[.65,0,0,0]]};
 function logo(b,x,y,z,h){for(const [i,ch]of [...'7KHO'].entries())for(const [a,c,d,e]of glyph[ch])rod(b,'gold',[x+(i*.9+a)*h,y+c*h,z],[x+(i*.9+d)*h,y+e*h,z],h*.035);rod(b,'gold',[x+2.75*h,y+1.12*h,z],[x+3.02*h,y+1.3*h,z],h*.03);rod(b,'gold',[x+3.02*h,y+1.3*h,z],[x+3.28*h,y+1.12*h,z],h*.03);}
 section('pavement',b=>{
  b.box('stone',15,.24,13,0,-.12,2.7);b.box('iron',15,.07,1.1,0,-.09,9.7);
  for(let x=-7.25;x<7.5;x+=.5)for(let z=-3.5;z<9.2;z+=.5){b.box('tile',.485,.025,.485,x,.012,z);if(z>3){const pts=[];for(let a=0;a<=8;a++)pts.push([x+.21*Math.cos(a*Math.PI/4),.027,z+.21*Math.sin(a*Math.PI/4)]);curve(b,'grout',pts,.006,12);}}
  for(let x=-7;x<7.5;x+=.5)b.box('stone',.48,.16,.24,x,.0,9.2);
 });
 section('shell',b=>{
  // User-supplied frontage: a single narrow shop, next to the passage at no.98.
  b.box('plaster',4.2,7.45,.18,0,3.725,-3.7);
  b.box('plaster',.18,7.45,7.4,-2.1,3.725,0);
  b.box('plaster',.16,3.2,7.4,2.1,1.6,0);
  b.box('timber',4.2,.15,7.4,0,3.25,0);
  for(const x of [-1.92,1.92])b.box('plaster',.37,3.22,.35,x,1.61,3.65);
  b.box('plaster',4.2,.46,.32,0,3.01,3.65);
  // Timber balcony, carved balusters and gray lowered fabric screen.
  b.box('recess',3.75,2.1,.1,0,4.42,2.93);
  for(const x of [-1.81,1.81])rod(b,'timber',[x,3.3,3.62],[x,5.72,3.62],.085,16);
  b.box('timber',3.6,.09,.28,0,3.63,3.68);b.box('timber',3.66,.12,.31,0,4.1,3.70);
  for(let x=-1.62;x<1.7;x+=.21){cyl(b,'timber',.036,.4,x,3.88,3.69);ball(b,'timber',x,3.85,3.69,.061,.10,.061,12);}
  // Shallow folds in a hanging roller screen rather than an opaque masonry panel.
  const pos=[];for(let i=0;i<60;i++){
   const x0=-1.69+i*3.38/60,x1=-1.69+(i+1)*3.38/60;
   const q=(x,y)=>[x,y,3.76+.035*Math.sin(x*10)+.07*Math.cos(x*2)*(5.56-y)];
   pos.push(...q(x0,4.16),...q(x1,4.16),...q(x1,5.58),...q(x0,4.16),...q(x1,5.58),...q(x0,5.58));
  }
  const screen=new THREE.BufferGeometry();screen.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));screen.computeVertexNormals();b.add('screen',screen);
  rod(b,'metal',[-1.74,4.14,3.88],[1.74,4.14,3.88],.023);
  for(const x of [-1.73,1.73])rod(b,'metal',[x,3.65,3.84],[x,5.67,3.84],.015);
  // Side balcony facing the alley: green posts, low parapet and open bays.
  b.box('plaster',.15,.77,6.9,2.07,3.7,-.06);
  for(let z=-3.35;z<3.5;z+=1.3){b.box('shutterDark',.10,2.23,.12,2.08,4.53,z);b.box('timber',.13,.085,1.22,2.08,4.12,z+.5);}
  // Weathered party wall above the front awning.
  b.box('plaster',4.2,1.62,.18,0,6.7,2.95);
  for(let i=0;i<170;i++){const x=Math.sin(i*47.7)*1.97,y=5.98+(i%19)*.079;b.box(i%3?'stone':'recess',.012+(i%6)*.016,.017,.009,x,y,3.049);}
  for(const x of [-1.94,1.94]){ball(b,'iron',x,2.65,3.90,.055,.09,.055,12);ball(b,'bulb',x,2.65,3.94,.025,.04,.025,10);}
  // Utility conduits and meter boxes on the passage-side pier.
  rod(b,'bamboo',[2.03,.1,3.97],[2.03,2.1,3.97],.028);
  for(const y of [1.65,1.94]){b.box('stone',.17,.21,.12,1.98,y,3.88);b.box('recess',.095,.065,.018,1.98,y+.025,3.95);}
 });
 section('shutters',b=>{
  // Four turquoise louvred shutter leaves, set into the ground floor opening.
  for(const x of [-1.215,-.405,.405,1.215]){
   b.box('shutterDark',.79,2.37,.07,x,1.275,3.75);frame(b,x,1.275,3.80,.76,2.37,'shutter',.048);
   for(let j=0;j<27;j++)b.add('shutter',new THREE.BoxGeometry(.65,.058,.042),x,.18+j*.082,3.815,-.22);
   for(const y of [.48,1.95])b.box('iron',.043,.065,.034,x-.34,y,3.87);
   rod(b,'iron',[x+.22,1.10,3.87],[x+.22,1.24,3.87],.011);
  }
  b.box('red',.69,.31,.023,1.215,.265,3.86);
 });
 section('roof',b=>{
  b.box('plaster',4.3,.12,7.5,0,7.48,0);
  // Tiered reed thatch across the frontage, each strand modeled separately.
  for(let tier=0;tier<3;tier++){
   const y=6.56-tier*.27,z=3.33+tier*.23;
   b.add('thatch',new THREE.BoxGeometry(4.48,.055,.53),0,y,z,.65);
   for(let j=0;j<230;j++){const x=-2.23+j*4.46/229,delta=.03*Math.sin(j*7.1);rod(b,j%3?'thatch':'thatchLight',[x,y+.12,z-.19],[x+.016*Math.sin(j),y-.18+delta,z+.23],.006,5);}
  }
  // Sloping thatch along the open side passage.
  for(let z=-3.6;z<3.35;z+=.038)rod(b,'thatch',[1.92,5.97,z],[2.48,5.40+.025*Math.sin(z*30),z],.009,5);
 });
 section('awning',b=>{
  // Dark green scalloped canvas awning above the sign.
  b.add('awning',new THREE.BoxGeometry(4.28,.035,.75),0,3.40,4.01,.12);
  b.box('awning',4.28,.18,.04,0,3.27,4.37);
  for(let x=-2.05;x<2.1;x+=.28)curve(b,'gold',[[x-.14,3.23,4.40],[x,3.18,4.40],[x+.14,3.23,4.40]],.009,10);
  for(const x of [-1.9,1.9])rod(b,'iron',[x,2.96,3.8],[x,3.35,4.36],.018);
  b.box('paper',3.38,.43,.09,0,2.94,3.94);frame(b,0,2.94,4.0,3.38,.43,'shutterDark',.028);
  // Present-day restaurant identity, a restrained interpretation of the old sign.
  logo(b,-.66,2.81,4.01,.37);
  for(let j=0;j<165;j++){const x=-1.78+j*.022;rod(b,j%3?'thatch':'thatchLight',[x,3.19,3.89],[x,3.09+.028*Math.sin(j*3),4.08],.007,5);}
 });
 function chair(b,x,z,yaw){
  const p=(a,y,c)=>[x+a*Math.cos(yaw)+c*Math.sin(yaw),y,z-a*Math.sin(yaw)+c*Math.cos(yaw)];
  const tube=(pts,r=.015,k='metal')=>curve(b,k,pts.map(v=>p(...v)),r,24);
  // Bent chrome sled frames, folding pivots, reclined fabric back and piped seat.
  for(const a of [-.255,.255]){
   tube([[a,.48,-.23],[a,.16,.29],[a,.055,.30],[a,.045,-.25],[a,.085,-.31],[a,.46,.14],[a,.91,.30]],.016);
   tube([[a,.48,-.22],[a,.49,.17]],.014);
   ball(b,'metal',...p(a,.39,.04),.025,.025,.025,12);
   for(const c of [-.27,.27])ball(b,'iron',...p(a,.047,c),.027,.025,.045,10);
  }
  tube([[-.255,.88,.29],[-.25,.96,.32],[-.19,.985,.325],[.19,.985,.325],[.25,.96,.32],[.255,.88,.29]],.017);
  tube([[-.25,.13,-.27],[.25,.13,-.27]],.013);
  const seat=new THREE.BoxGeometry(.46,.035,.43,8,1,8);seat.rotateY(yaw);b.add('chair',seat,x,.48,z);
  tube([[-.22,.502,-.2],[-.22,.502,.19],[.22,.502,.19],[.22,.502,-.2],[-.22,.502,-.2]],.006,'recess');
  // Back is a curved fabric surface, not a rigid vertical rectangular slab.
  const pos=[];
  const q=(u,v)=>p(u*.46,.57+v*.35,.19+v*.11-.023*Math.cos(u*Math.PI));
  for(let j=0;j<7;j++)for(let i=0;i<12;i++){
   const a=q(i/12-.5,j/7),c=q((i+1)/12-.5,j/7),d=q((i+1)/12-.5,(j+1)/7),e=q(i/12-.5,(j+1)/7);
   pos.push(...a,...c,...d,...a,...d,...e,...d,...c,...a,...e,...d,...a);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();b.add('chair',g);
  for(const u of [-.225,.225])tube([[u,.58,.19],[u,.91,.30]],.006,'recess');
 }
 function vessel(b,k,x,y,z,r,h){
  // Closed cross-section gives a genuinely hollow bowl with a rounded lip.
  const pts=[[0,0],[r*.54,0],[r*.66,h*.12],[r*.89,h*.65],[r,h*.94],[r,h],[r*.94,h],[r*.83,h*.62],[r*.57,h*.18],[0,h*.18]].map(p=>new THREE.Vector2(...p));
  b.add(k,new THREE.LatheGeometry(pts,48),x,y,z);
 }
 function plate(b,x,z,r=.185,y=.702){
  vessel(b,'porcelain',x,y,z,r,.038);ring(b,'blue',r*.96,.003,x,y+.039,z,Math.PI/2);
  for(let j=0;j<38;j++){const a=j*Math.PI*2/38,r0=r*(.8+(j%3)*.025);rod(b,'blue',[x+Math.cos(a)*r0,y+.033,z+Math.sin(a)*r0],[x+Math.cos(a)*r*.96,y+.039,z+Math.sin(a)*r*.96],.0018,5);}
 }
 function leaf(b,x,y,z,a=0,s=.04){const g=new THREE.SphereGeometry(1,10,6);g.scale(s,.004,s*.4);g.rotateY(a);b.add('herb',g,x,y,z);rod(b,'leafLight',[x-Math.cos(a)*s*.8,y+.004,z+Math.sin(a)*s*.8],[x+Math.cos(a)*s*.8,y+.004,z-Math.sin(a)*s*.8],.0015,5);}
 function garnish(b,x,y,z){for(let j=0;j<9;j++){const a=j*2.4;leaf(b,x+Math.sin(a)*.065,y+(j%3)*.012,z+Math.cos(a)*.065,a,.035);}}
 function dish(b,x,z,kind){
  plate(b,x,z);const y=.755;
  if(kind%4===0){ // golden tofu cubes, crisp edges and herbs
   for(let j=0;j<12;j++){const a=j*2.4,r=.04+(j%3)*.035,xx=x+Math.cos(a)*r,zz=z+Math.sin(a)*r;b.box('food',.047,.035,.044,xx,y+(j%2)*.018,zz,a);for(let k=0;k<3;k++)ball(b,'crumb',xx+Math.sin(k*5+j)*.017,y+.023+(j%2)*.018,zz+Math.cos(k*4)*.016,.004,.002,.004,6);}garnish(b,x-.06,y+.032,z+.035);
  }else if(kind%4===1){ // shredded grilled squid, toasted flecks and green garnish
   for(let j=0;j<25;j++){const a=j*2.4,xx=x+Math.sin(a)*.105,zz=z+Math.cos(a)*.07;curve(b,'squid',[[xx-.035,y+(j%4)*.009,zz-.03],[xx,y+.02+(j%4)*.009,zz],[xx+.045,y+(j%4)*.009,zz+.03]],.004,8);}garnish(b,x-.08,y+.028,z+.07);
  }else if(kind%4===2){ // distinct carrot batons, cucumber, cabbage and broccoli
   for(let j=0;j<5;j++){b.box('carrot',.022,.024,.12,x-.11+j*.024,y,z-.025,j*.06);b.box('cucumber',.017,.023,.14,x-.08+j*.025,y+.01,z+.035,-.12);}
   for(let j=0;j<9;j++){const a=j*2.4;ball(b,'cabbage',x+.065+Math.sin(a)*.035,y+.02+(j%3)*.012,z+.06+Math.cos(a)*.025,.032,.009,.023,8);}
   for(let j=0;j<18;j++){const a=j*2.4;ball(b,'herb',x+.065+Math.sin(a)*.04,y+.025+(j%3)*.012,z-.08+Math.cos(a)*.025,.014,.013,.014,8);}
  }else { // clay casserole, two handles and visible braising sauce
   vessel(b,'clay',x,.743,z,.128,.075);cyl(b,'sauce',.109,.009,x,.797,z);for(const s of [-1,1]){b.box('clay',.068,.023,.05,x+s*.13,.805,z);ring(b,'clay',.127,.006,x,.82,z,Math.PI/2);}
   for(let j=0;j<9;j++){const a=j*2.4;ball(b,j%3?'food':'squid',x+Math.sin(a)*.075,.811+(j%2)*.013,z+Math.cos(a)*.065,.022,.012,.017,10);}for(let j=0;j<20;j++)ball(b,'crumb',x+Math.sin(j*5)*.083,.827,z+Math.cos(j*3)*.075,.0025,.002,.0025,6);
  }
 }
 function drinkingGlass(b,x,z){
  vessel(b,'glass',x,.703,z,.043,.15);cyl(b,'beer',.035,.105,x,.768,z);ring(b,'glass',.042,.003,x,.854,z,Math.PI/2);
  for(let j=0;j<12;j++){const a=j*Math.PI/6;rod(b,'glass',[x+Math.cos(a)*.03,.72,z+Math.sin(a)*.03],[x+Math.cos(a)*.041,.846,z+Math.sin(a)*.041],.002,6);}
  for(let j=0;j<3;j++)b.box('ice',.026,.021,.024,x+Math.sin(j*3)*.017,.825+j*.004,z+Math.cos(j*3)*.013,j);
  for(let j=0;j<14;j++){const a=j*2.4;ball(b,'porcelain',x+Math.sin(a)*.027,.824,z+Math.cos(a)*.027,.003,.002,.003,6);}
 }
 function table(b,x,z,index){
  // Photos show low black drum tables with a rolled rim and mottled top.
  cyl(b,'table',.59,.04,x,.665,z);cyl(b,'table',.48,.60,x,.33,z,.46,48);
  for(const y of [.07,.15,.52,.62])ring(b,'iron',.475,.012,x,y,z,Math.PI/2);
  ring(b,'bronze',.587,.012,x,.688,z,Math.PI/2);
  for(let j=0;j<95;j++){const a=j*2.39996,r=.56*Math.sqrt((j+.5)/95);ball(b,j%4?'recess':'stone',x+Math.cos(a)*r,.687,z+Math.sin(a)*r,.004,.0008,.003,6);}
  dish(b,x-.23,z-.16,index);dish(b,x+.19,z-.13,index+1);dish(b,x-.025,z+.23,index+2);
  for(const dx of [-.38,.36]){
   vessel(b,'porcelain',x+dx,.705,z+.1,.063,.038);cyl(b,dx<0?'sauce':'chili',.052,.006,x+dx,.728,z+.1);for(let j=0;j<5;j++)ball(b,'crumb',x+dx+Math.sin(j*4)*.031,.733,z+.1+Math.cos(j*3)*.032,.0025,.001,.002,6);
   drinkingGlass(b,x+dx,z+.32);
   for(let j=0;j<2;j++)rod(b,'timber',[x+dx+j*.016,.709,z-.08],[x+dx+j*.016,.709,z+.17],.003,8);
  }
  vessel(b,'porcelain',x-.05,.703,z-.43,.072,.065);ring(b,'blue',.066,.003,x-.05,.756,z-.43,Math.PI/2);
  cyl(b,'bottle',.035,.16,x+.17,.784,z-.43);cyl(b,'bottle',.017,.08,x+.17,.904,z-.43);cyl(b,'gold',.019,.01,x+.17,.949,z-.43);cyl(b,'paper',.0355,.064,x+.17,.78,z-.43);
  b.box('paper',.10,.018,.15,x-.25,.711,z+.40,.15);b.box('porcelain',.09,.007,.11,x-.25,.724,z+.40,.18);
 }
 // Fixed irregular layout: stable across reloads, with angled and pulled-out chairs.
 const outdoorScale=.65;
 section('dining',b=>{
  const layout=[[-5.35,5.12,-.16],[-2.86,5.59,.24],[-.38,5.08,-.31],[2.28,5.43,.12],[5.12,5.17,-.23],[-4.88,7.61,.27],[-2.35,7.28,-.13],[.24,7.73,.19],[2.69,7.31,-.26],[5.31,7.66,.11]];
  for(const [n,[x,z,turn]] of layout.entries()){
   if(city&&(n===4||n===9))continue;
   const add=(key,g,px=0,py=0,pz=0,rx=0,ry=0,rz=0)=>{
    const m=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx,ry,rz));m.setPosition(px,py,pz);
    g.applyMatrix4(m);g.translate(-x,-.018,-z);g.scale(outdoorScale,outdoorScale,outdoorScale);g.rotateY(turn);g.translate(x,.018,z);b.add(key,g);
   };
   const scaled={add,box:(key,w,h,d,px,py,pz,yaw=0)=>add(key,new THREE.BoxGeometry(w,h,d),px,py,pz,0,yaw)};
   table(scaled,x,z,n);
   for(const [j,base] of [-Math.PI/2,Math.PI/2,0].entries()){
    const a=base+.19*Math.sin(n*2.7+j*4.1),pull=.91+.13*(.5+.5*Math.sin(n*4.3+j*2.2));
    chair(scaled,x+Math.sin(a)*pull,z+Math.cos(a)*pull,a+.16*Math.cos(n*3.2+j*1.9));
   }
   if(n%2===0){cyl(scaled,'red',.18,.26,x+.85,.14,z-.48);ring(scaled,'metal',.18,.011,x+.85,.28,z-.48,Math.PI/2);}
  }
 });
 section('interior',b=>{
  // Long narrow room from the supplied interior photograph. The aisle stays clear.
  for(let x=-1.75;x<2;x+=.5)for(let z=-11.95;z<3.4;z+=.5){b.box('floor',.493,.035,.493,x,.032,z);for(let j=0;j<3;j++)b.box('stone',.07,.001,.018,x+Math.sin(j*4+z)*.17,.050,z+Math.cos(j+x)*.17,j);}
  b.box('ceiling',4.02,.05,15.8,0,3.14,-4.35);
  for(const x of [-1.78,1.78])rod(b,'conduit',[x,3.07,-12.1],[x,3.07,3.5],.014);
  for(const z of [-10.8,-7.8,-4.8,-1.8,1.2,2.8])rod(b,'conduit',[-1.8,3.065,z],[1.8,3.065,z],.012);
  for(const z of [-10.5,-7.7,-4.9,-2.1,.7,2.6])for(const x of [-.9,.65]){
   rod(b,'iron',[x,3.10,z],[x,2.78,z],.007);
   b.add('iron',new THREE.ConeGeometry(.17,.13,28,1,true),x,2.745,z);
   cyl(b,'bulb',.155,.008,x,2.682,z);ring(b,'metal',.169,.008,x,2.68,z,Math.PI/2);
  }
  for(const z of [-8.6,-3.1]){
   rod(b,'conduit',[.25,3.13,z],[.25,2.76,z],.025);ball(b,'ceiling',.25,2.72,z,.1,.065,.1);
   for(let j=0;j<3;j++){const a=j*Math.PI*2/3+.25;const g=new THREE.BoxGeometry(.57,.014,.105);g.rotateY(a);b.add('ceiling',g,.25+Math.cos(a)*.34,2.71,z-Math.sin(a)*.34);}
  }
  for(const x of [-1.55,1.55])for(const z of [-9,-5,-1,2]){rod(b,'iron',[x,3.06,z-.36],[x,3.06,z+.36],.012);for(const dz of [-.25,.25]){b.add('iron',new THREE.CylinderGeometry(.028,.04,.11,12),x,2.99,z+dz,0,0,x>0?-.3:.3);ball(b,'bulb',x,2.93,z+dz,.024,.012,.024,8);}}
  // Rectangular plank tables and low A-frame stools, not outdoor folding chairs.
  for(const z of [-10.8,-8.3,-5.8,-3.3,-.8,1.7]){
   const x=1.04;b.box('wood',1.08,.065,1.64,x,.735,z);
   for(let a=-.48;a<.5;a+=.135){b.box('timber',.006,.003,1.63,x+a,.77,z);for(let j=0;j<5;j++)rod(b,'grain',[x+a+j*.018,.772,z-.78],[x+a+j*.018+.009,.772,z+.78],.0015,5);}
   for(const dx of [-.42,.42])for(const dz of [-.66,.66])rod(b,'timber',[x+dx,.05,z+dz],[x+dx*.87,.71,z+dz*.94],.037,6);
   for(const dz of [-.65,.65])rod(b,'timber',[x-.43,.3,z+dz],[x+.43,.3,z+dz],.027,6);
   for(const sx of [1.80,.24])for(const sz of [-.46,.46]){
    b.box('wood',.32,.055,.34,sx,.44,z+sz);
    for(const dx of [-.13,.13])for(const dz of [-.13,.13])rod(b,'timber',[sx+dx*1.2,.045,z+sz+dz*1.15],[sx+dx*.75,.414,z+sz+dz*.72],.023,6);
    rod(b,'timber',[sx-.14,.17,z+sz],[sx+.14,.17,z+sz],.015,6);
   }
   // Sparse indoor settings reflect the uncluttered tables in the reference.
   for(let j=0;j<2;j++)rod(b,'bamboo',[x-.20+j*.014,.773,z-.12],[x-.20+j*.014,.773,z+.13],.003,6);
   b.box('paper',.11,.006,.07,x+.18,.775,z+.25,.12);
  }
 });
 section('murals',paintSevenKhoMurals);
 section('seafood-display',b=>{
  const x=-.90,z=4.40;b.box('metal',1.46,.06,.68,x,.86,z);for(const dx of [-.67,.67])for(const dz of [-.28,.28])rod(b,'metal',[x+dx,.1,z+dz],[x+dx,.88,z+dz],.025);
  rod(b,'metal',[x-.72,.86,z],[x-.72,2.22,z],.018);rod(b,'metal',[x+.72,.86,z],[x+.72,2.22,z],.018);rod(b,'metal',[x-.72,2.22,z],[x+.72,2.22,z],.018);
  for(let i=0;i<7;i++){const xx=x-.58+i*.19;rod(b,'iron',[xx,2.22,z],[xx,2.08,z],.006);ball(b,'squid',xx,1.88,z,.07,.21,.018,12);for(let j=0;j<5;j++)curve(b,'squid',[[xx+(j-2)*.015,1.72,z],[xx+(j-2)*.02,1.61,z+.01],[xx+(j-2)*.026,1.51+(j%2)*.04,z-.018]],.006,8);}
  for(let i=0;i<4;i++){const xx=x-.54+i*.35;b.box('metal',.31,.055,.49,xx,.91,z);for(let j=0;j<9;j++)ball(b,i%2?'squid':'food',xx+Math.sin(j*5)*.1,.96+(j%2)*.025,z+Math.cos(j*4)*.16,.045,.018,.03,8);}
 });
 section('street-details',b=>{
  // Illustrated stand and paper menus. Menu wording/prices are documented separately.
  for(const x of [city?2.2:3.2]){rod(b,'timber',[x-.33,.04,3.85],[x-.33,1.28,3.55],.025);rod(b,'timber',[x+.33,.04,3.85],[x+.33,1.28,3.55],.025);b.box('paper',.67,.92,.06,x,.83,3.7);frame(b,x,.83,3.75,.67,.92,'timber',.035);logo(b,x-.25,1.06,3.76,.15);for(let j=0;j<8;j++){b.box('timber',.4,.008,.007,x-.04,.95-j*.066,3.739);b.box('red',.07,.008,.007,x+.23,.95-j*.066,3.739);}}
  for(const x of [-1.95,1.95]){cyl(b,'stone',.29,.45,x,.23,4.05,.24);for(let j=0;j<9;j++){let a=j*2.4;curve(b,'herb',[[x,.42,4.05],[x+Math.cos(a)*.1,.8,4.05+Math.sin(a)*.1],[x+Math.cos(a)*.22,1.15+(j%3)*.13,4.05+Math.sin(a)*.22]],.025,10);}}
  for(const x of (city?[-5.95]:[-5.95,5.95])){cyl(b,'bark',.12,4.6,x,2.3,8.25,.19);for(let j=0;j<7;j++){let a=j*2.4;rod(b,'bark',[x,2.8,8.25],[x+Math.cos(a)*1.1,4.5+(j%3)*.35,8.25+Math.sin(a)],.055);ball(b,j%2?'leaf':'leafLight',x+Math.cos(a)*1.06,4.75+(j%3)*.25,8.25+Math.sin(a),.8,.55,.68,12);}}
  const pts=[];for(let i=0;i<=30;i++){const x=-6+i*.4,y=4.35-.75*Math.sin(i/30*Math.PI);pts.push([x,y,8.2]);if(i%2===0){rod(b,'iron',[x,y,8.2],[x,y-.13,8.2],.012);ball(b,'bulb',x,y-.18,8.2,.055,.073,.055);}}
  curve(b,'iron',pts,.012,60);
  // Visible wiring and drain pipes.
  for(const x of [-2.12,2.12])rod(b,'iron',[x,.15,3.5],[x,6.8,3.5],.035);
  for(let i=0;i<3;i++)curve(b,'iron',[[-2.15,3.6+i*.04,3.8],[0,3.49+i*.04,3.9],[2.15,3.65+i*.04,3.8]],.008,30);
 });
 for(const key of ['shell','roof'])components[key].traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){const z=p.getZ(i);if(z<3.7)p.setZ(i,3.7-(3.7-z)*16/7.4);}p.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();});
 group.updateMatrixWorld(true);
 let disposed=false;
 return {group,components,materials,triangles,state:{...SEVEN_KHO,triangles,tables:city?14:16,chairs:city?24:30,stools:24,indoorTables:6,buildingLength:16,outdoorScale},dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(o=>o.geometry?.dispose());for(const m of Object.values(materials))m.dispose();}};
}
