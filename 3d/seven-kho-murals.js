// Original vector-painted scenes, baked into the model's material batches.
// Coordinates are metres; all paint is shallow layered geometry on the walls.
import * as THREE from 'three';
export function paintSevenKhoMurals(b){
 for(const side of [-1,1]){
  b.box('muralPlaster',.018,2.85,15.6,side*1.993,1.54,-4.35);
  b.box('muralInk',.024,.15,15.6,side*1.976,.16,-4.35);
  for(let bay=0;bay<5;bay++){
   const centre=-10.35+bay*3.02;let layer=0;
   function poly(k,pts){const flat=pts.map(p=>new THREE.Vector2(...p)),faces=THREE.ShapeUtils.triangulateShape(flat,[]),pos=[];const x=side*(1.977-(++layer)*.000012);for(const face of faces)for(const i of face)pos.push(x,pts[i][1],centre+side*pts[i][0]);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();b.add(k,g);}
   const rect=(k,x,y,w,h)=>poly(k,[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
   function oval(k,x,y,rx,ry){poly(k,Array.from({length:28},(_,i)=>{const a=i*Math.PI*2/28;return[x+Math.cos(a)*rx,y+Math.sin(a)*ry];}));}
   function line(k,x,y,u,v,t=.014){const d=Math.hypot(u-x,v-y)||1,nx=-(v-y)/d*t/2,ny=(u-x)/d*t/2;poly(k,[[x+nx,y+ny],[x-nx,y-ny],[u-nx,v-ny],[u+nx,v+ny]]);}
   function path(k,pts,t=.014){for(let i=1;i<pts.length;i++)line(k,...pts[i-1],...pts[i],t);}
   function wheel(x,y,r){oval('muralInk',x,y,r,r);oval('muralPlaster',x,y,r-.025,r-.025);for(let i=0;i<12;i++){const a=i*Math.PI/6;line('muralTrim',x,y,x+Math.cos(a)*(r-.03),y+Math.sin(a)*(r-.03),.006);}oval('muralInk',x,y,.026,.026);}
   function shutter(x,y,w,h){rect('muralInk',x-.04,y-.04,w+.08,h+.08);rect('muralDoor',x,y,w,h);for(let j=0;j<16;j++)line('muralTrim',x+.02,y+.05+j*h/17,x+w-.02,y+.05+j*h/17,.012);line('muralInk',x+w/2,y,x+w/2,y+h,.022);}
   function person(x,y,coat,hat=false){
    poly('muralInk',[[x-.12,y],[x-.05,y+.69],[x+.16,y+.67],[x+.21,y+.02],[x+.12,y],[x+.055,y+.46],[x-.015,y+.05]]);
    poly(coat,[[x-.17,y+.63],[x-.2,y+1.05],[x-.09,y+1.18],[x+.09,y+1.19],[x+.21,y+1.04],[x+.15,y+.63]]);
    oval('paintSkin',x,y+1.30,.115,.14);poly('muralInk',[[x-.116,y+1.32],[x-.1,y+1.43],[x+.04,y+1.47],[x+.12,y+1.37],[x+.06,y+1.36],[x-.02,y+1.4]]);
    line('paintSkin',x+.17,y+1.04,x+.33,y+.80,.075);line('paintSkin',x+.33,y+.80,x+.54,y+.86,.063);
    line('muralInk',x+.04,y+1.32,x+.09,y+1.32,.009);
    if(hat){poly('paintCream',[[x-.26,y+1.41],[x,y+1.64],[x+.28,y+1.41]]);line('muralTrim',x-.26,y+1.41,x+.28,y+1.41,.014);}
   }
   const theme=(bay+(side===1?2:0))%5;
   rect(bay%2?'paintOchre':'paintCream',-1.48,.24,2.96,2.68);
   // Uneven plaster, a roofline and brickwork tie the individual scenes together.
   for(let j=0;j<55;j++){const x=Math.sin(j*7.7+bay)*1.4,y=.31+(j%19)*.133;rect(j%3?'muralPlaster':'paintCream',x,y,.035+(j%5)*.011,.007+(j%3)*.006);}
   path('brick',[[-1.48,2.56],[-.3,2.72],[1.48,2.55]],.055);
   for(let row=0;row<9;row++)for(let col=0;col<3;col++)rect((row+col)%3?'brickLight':'brick',-1.46+col*.15+(row%2)*.05,.27+row*.14,.137,.10);
   if(theme===0){ // A bicycle resting beside an old green shutter.
    shutter(-.25,.53,1.2,1.7);rect('paintCoral',-.95,2.23,.70,.28);
    wheel(-.60,.61,.34);wheel(.65,.61,.34);
    path('paintTeal',[[-.60,.61],[-.12,.64],[.20,1.12],[-.41,1.12],[-.60,.61]],.038);
    path('paintTeal',[[-.41,1.12],[-.12,.64],[.48,1.10],[.65,.61]],.035);
    path('muralInk',[[.48,1.10],[.42,1.36],[.63,1.38]],.026);line('muralInk',-.41,1.12,-.42,1.3,.025);line('muralInk',-.56,1.31,-.27,1.31,.047);
    poly('paintOchre',[[.48,1.12],[.86,1.14],[.91,1.43],[.47,1.40]]);for(let j=0;j<5;j++)line('brick',.50+j*.075,1.15,.51+j*.075,1.4,.009);
    oval('brick',1.12,.40,.19,.10);rect('brick',.96,.38,.32,.26);for(let j=0;j<7;j++){const a=j*2.4;line('paintTeal',1.11,.61,1.11+Math.sin(a)*.20,1.0+Math.cos(a)*.19,.019);oval(j%2?'paintCoral':'paintPink',1.11+Math.sin(a)*.20,1.0+Math.cos(a)*.19,.048,.045);}
   }else if(theme===1){ // Noodle vendor beneath a striped awning.
    shutter(.43,.64,.73,1.48);person(-.83,.35,'paintTeal',true);
    rect('paintCoral',-.45,.52,1.62,.69);rect('muralInk',-.5,1.16,1.74,.065);rect('paintCream',-.34,.65,1.36,.33);
    for(const x of [-.22,.94])wheel(x,.42,.15);
    for(const x of [-.43,1.14])line('muralInk',x,1.21,x,2.2,.025);
    poly('paintTeal',[[-.66,2.12],[-.43,2.33],[1.14,2.33],[1.35,2.12]]);
    for(let j=0;j<8;j++)poly(j%2?'paintCream':'paintTeal',[[-.66+j*.25,2.12],[-.43+j*.20,2.33],[-.23+j*.20,2.33],[-.41+j*.25,2.12]]);
    oval('muralInk',.65,1.30,.23,.11);rect('paintCream',.44,1.27,.42,.23);oval('paintCream',.65,1.50,.21,.05);
    for(let j=0;j<3;j++)path('paintCream',[[.57+j*.09,1.57],[.52+j*.09,1.69],[.59+j*.09,1.82]],.015);
    for(let j=0;j<3;j++){oval('paintTeal',-.24+j*.19,1.28,.075,.035);oval('paintCream',-.24+j*.19,1.31,.079,.019);}
   }else if(theme===2){ // Friendly neighborhood barber, scissors and mirror.
    rect('brick',-.98,.55,1.00,1.67);rect('paintTeal',-.91,.65,.86,1.49);rect('paintCream',-.85,.75,.74,1.32);
    person(.62,.34,'paintCoral');oval('paintSkin',-.27,1.33,.12,.14);oval('muralInk',-.27,1.40,.13,.087);
    poly('paintCream',[[-.38,1.25],[-.1,1.24],[.17,.76],[-.65,.76]]);rect('muralInk',-.67,.67,.83,.12);line('muralInk',-.24,.39,-.24,.68,.05);line('muralInk',-.55,.36,.06,.36,.045);
    path('paintSkin',[[.47,1.37],[.26,1.55],[-.12,1.53]],.065);
    path('muralInk',[[.0,1.52],[.15,1.68]],.011);path('muralInk',[[-.02,1.66],[.16,1.53]],.011);
    rect('paintCream',1.12,.70,.15,1.33);for(let j=0;j<8;j++)poly(j%2?'paintTeal':'paintCoral',[[1.12,.72+j*.15],[1.27,.80+j*.15],[1.27,.87+j*.15],[1.12,.79+j*.15]]);
    rect('paintTeal',-.78,2.28,1.60,.24);for(let j=0;j<5;j++)line('paintCream',-.61+j*.29,2.33,-.46+j*.29,2.47,.024);
   }else if(theme===3){ // Balconies with bougainvillea above a quiet doorway.
    shutter(-.74,.31,1.13,1.54);rect('brick',-.97,1.93,1.91,.14);rect('muralDoor',-.62,2.1,.91,.57);
    for(let j=0;j<10;j++)line('muralInk',-.88+j*.185,2.04,-.88+j*.185,2.45,.015);line('muralInk',-.98,2.46,.97,2.46,.026);
    for(let j=0;j<30;j++){const x=.25+Math.sin(j*2.4)*.80,y=2.60+Math.cos(j*3.7)*.20;oval('paintTeal',x,y,.09,.055);if(j%2)oval(j%3?'paintPink':'paintCoral',x+.025,y+.02,.042,.035);}
    rect('brick',.63,.28,.39,.25);for(let j=0;j<9;j++)line('paintTeal',.82,.52,.82+Math.sin(j*3)*.23,1.04+(j%3)*.12,.026);
    oval('muralInk',-.7,.27,.21,.08);poly('muralInk',[[-.87,.29],[-.9,.52],[-.79,.41],[-.7,.52],[-.65,.28]]);
   }else { // Coffee corner, kettle, stools and a person reading.
    shutter(-1.12,.83,.78,1.27);person(.72,.30,'paintTeal');
    poly('paintCream',[[.31,1.42],[.75,1.36],[.98,1.50],[.5,1.61]]);path('muralTrim',[[.50,1.59],[.64,1.39]],.012);
    rect('wood',-.96,.83,1.07,.06);for(const x of [-.88,.02])line('muralInk',x,.29,x,.84,.027);
    for(const x of [-.98,-.03]){rect('brick',x-.12,.42,.27,.035);line('muralInk',x-.09,.25,x-.07,.42,.02);line('muralInk',x+.09,.25,x+.07,.42,.02);}
    oval('paintTeal',-.64,1.03,.15,.13);path('paintTeal',[[-.77,1.06],[-.93,1.13],[-.87,1.00]],.033);oval('paintCream',-.64,1.16,.11,.025);
    for(const x of [-.34,-.1]){rect('paintCoral',x-.05,.90,.10,.13);oval('paintCream',x,1.035,.057,.018);}
    line('muralInk',-.10,2.54,-.1,2.06,.012);poly('paintCoral',[[-.35,1.97],[-.1,2.13],[.15,1.97]]);oval('paintCream',-.1,1.96,.24,.035);
   }
   // Deliberately sparse rubbed patches keep the art matte and aged.
   for(let j=0;j<34;j++){const u=Math.sin(j*13+bay)*1.42,v=.29+(j%19)*.129;rect('muralPlaster',u,v,.011+(j%4)*.008,.003+(j%3)*.003);}
  }
 }
}
