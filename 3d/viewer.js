import * as THREE from 'three';
import {createWeather} from './weather.js';
import {createFlights} from './flights.js';
import {createLightning,tallBuildings,nearestHighrise} from './lightning.js';
import {createSky} from './sky-render.js';
import {createCityLighting} from './city-lighting.js';
import {createFlag,createFlagSet} from './flag.js';
import {createMetro} from './metro.js';
import {createNotreDame} from './notre-dame.js';
import {createBenThanh} from './ben-thanh.js';
import {createIndependencePalace} from './independence-palace.js';
import {createMajestic} from './majestic.js';
import {createOperaHouse} from './opera-house.js';
import {createStateBank} from './state-bank.js';
import {createPostOffice} from './post-office.js';
import {createCityHall} from './city-hall.js';
import {createBitexco} from './bitexco.js';
import {createLandmark81} from './landmark81.js';
import {createNhaRong} from './nha-rong.js';
import {createContinental} from './continental.js';
import {createCityMuseum} from './city-museum.js';
import {createTanDinh} from './tan-dinh.js';
import {createJadeEmperor} from './jade-emperor.js';
import {createBinhTay} from './binh-tay.js';
import {createThienHau} from './thien-hau.js';
import {createBridges} from './bridges.js';
import {createRailway} from './railway.js';
import {createYacht} from './yacht.js';
import {createMooredPrincess60} from './princess60-berth.js';
import {createOpenTour} from './opentour.js';
import {createRiverTour} from './rivertour.js';
// Landmark models built on OSM outlines: each replaces its generic block as
// tiles stream in, and follows the Buildings checkbox.
const LANDMARKS=[['opera',createOperaHouse],['stateBank',createStateBank],['postOffice',createPostOffice],['cityHall',createCityHall],['bitexco',createBitexco],['landmark81',createLandmark81],['nhaRong',createNhaRong],['continental',createContinental],['cityMuseum',createCityMuseum],['tanDinh',createTanDinh],['jadeEmperor',createJadeEmperor],['binhTay',createBinhTay],['thienHau',createThienHau],['bridges',createBridges],['yacht',createYacht],['princess60',createMooredPrincess60]];
const landmarks={};
import {createRex} from './rex.js';
let weather,flights,lightning,sky,flag,flagSet,railway,openTour,riverTour,metro,cityLighting,cathedral,market,palace,majestic,rex;
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const $=id=>document.getElementById(id),host=$('viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color('#263e40');
const camera=new THREE.PerspectiveCamera(43,1,1,500000);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});}
catch(error){$('loading').textContent='This 3D model needs a WebGL-capable browser.';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.maxPolarAngle=Math.PI/2-.08;controls.minDistance=25;controls.maxDistance=220000;
// Map-style navigation: pan across the ground plane, not the screen plane (on
// a tilted view, screen-space panning sank the orbit pivot underground and
// the camera with it), and zoom towards the point under the cursor, which
// also brings the pivot -- and with it the pan speed -- to what is being
// looked at. maxDistance and the pivot's reach are set from the city's
// bounds once the manifest is loaded.
controls.screenSpacePanning=false;controls.zoomToCursor=true;
const hemiLight=new THREE.HemisphereLight('#e7f1ee','#769080',2.6);scene.add(hemiLight);const sunLight=new THREE.DirectionalLight('#fff3da',2.7);sunLight.position.set(-10000,20000,5000);scene.add(sunLight);
const loader=new GLTFLoader(),tiles=new Map(),pending=new Set(),failed=new Set();let manifest,overview,skyline,cameraMarkers,ready=false,lastLoad=0,desired=new Set(),focusTile=null,highrises=[];
// tallBuildings() clusters skyline vertices into approximate individual
// towers (the same list lightning.js favours for strikes); reused here so a
// double-click can snap to the tower nearest the click. Matched in SCREEN
// space (project each known tower's top point, compare pixel distance to
// the click), not by raycasting the scene: skyline.glb deliberately keeps
// only each tower's upper portion (its walls below minimum_height are
// dropped for size), so a ray aimed at the visible lower two-thirds of a
// tall building's facade would miss that geometry entirely and hit nothing.
const HIGHRISE_SNAP_PIXELS=45;
function project(lon,lat){return [(lon-manifest.originLonLat[0])*111320*Math.cos(manifest.originLonLat[1]*Math.PI/180),-(lat-manifest.originLonLat[1])*111320];}
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(manifest)limitNavigation();if(ready&&$('overview').classList.contains('active'))wholeCity();}
new ResizeObserver(resize).observe(host);resize();
function setActive(id){if(id!==following?.button)stopFollowing();document.querySelectorAll('.views button').forEach(b=>b.classList.toggle('active',b.id===id));}
function goTo(x,z,distance=1600,top=false){controls.target.set(x,0,z);camera.position.copy(controls.target).add(top?new THREE.Vector3(0,distance,1):new THREE.Vector3(.6,.85,.7).normalize().multiplyScalar(distance));controls.update();lastLoad=0;}
// Look through the rain volume from below the schematic cloud deck.
function centralCity(){const [x,z]=project(106.699,10.774);controls.target.set(x,120,z);camera.position.copy(controls.target).add(new THREE.Vector3(-.6,.36,.7).normalize().multiplyScalar(2600));controls.update();lastLoad=0;setActive('downtown');}
function wholeCityDistance(){const b=manifest.boundsXZ,span=Math.hypot(b[2]-b[0],b[3]-b[1]);const fov=Math.min(camera.fov*Math.PI/360,Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect));return Math.min(200000,span*.52/Math.sin(fov));}
function wholeCity(){const b=manifest.boundsXZ;goTo((b[0]+b[2])/2,(b[1]+b[3])/2,wholeCityDistance());setActive('overview');}
// Keep navigation over the city: zoom out no further than half again the
// whole-city view, and keep the pivot within the model's bounds.
function limitNavigation(){const b=manifest.boundsXZ;controls.maxDistance=wholeCityDistance()*1.5;controls.cursor.set((b[0]+b[2])/2,0,(b[1]+b[3])/2);controls.maxTargetRadius=Math.hypot(b[2]-b[0],b[3]-b[1])/2;}
function updateLayer(group){group.traverse(o=>{if(!o.isMesh&&!o.isLineSegments)return;const name=o.name;o.visible= name.startsWith('building')?$('buildings').checked : ['street','path'].includes(name)?$('minor').checked : true;});}
function dispose(group){cityLighting?.unregister(group);group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
function tileDistance(tile){const b=tile.bounds,t=controls.target;const dx=Math.max(b[0]-t.x,0,t.x-b[2]),dz=Math.max(b[1]-t.z,0,t.z-b[3]);return Math.hypot(dx,dz);}
function updateSkyline(){if(!skyline)return;skyline.traverse(o=>{if(!o.isMesh)return;const id=o.name.split('__')[1];const visible=$('buildings').checked&&!tiles.get(id)?.group.visible;o.visible=visible;});}
function updateTiles(){
 if(!ready)return;
 const distance=camera.position.distanceTo(controls.target),detail=distance<6500;
 $('detail-badge').textContent=detail?'3D DETAIL':'OVERVIEW';
 const selected=detail?manifest.tiles.filter(t=>tileDistance(t)<Math.min(4400,Math.max(1500,distance*.65))).sort((a,b)=>tileDistance(a)-tileDistance(b)).slice(0,20):[];
 desired=new Set(selected.map(t=>t.id));
 for(const [id,entry] of tiles){entry.group.visible=desired.has(id);if(entry.group.visible)entry.lastSeen=performance.now();}
 // At most 28 resident detailed tiles. Dispose off-screen GPU buffers, not just scene objects.
 const evict=[...tiles.entries()].filter(([id])=>!desired.has(id)).sort((a,b)=>a[1].lastSeen-b[1].lastSeen);
 while(tiles.size>28&&evict.length){const [id,entry]=evict.shift();scene.remove(entry.group);dispose(entry.group);tiles.delete(id);}
 for(const t of selected){
  if(tiles.has(t.id)||pending.has(t.id)||failed.has(t.id)||pending.size>=3)continue;
  pending.add(t.id);
  loader.load(t.url,gltf=>{pending.delete(t.id);cathedral?.replaceGeneric(gltf.scene);market?.replaceGeneric(gltf.scene);palace?.replaceGeneric(gltf.scene);majestic?.replaceGeneric(gltf.scene);rex?.replaceGeneric(gltf.scene);for(const l of Object.values(landmarks))l.replaceGeneric(gltf.scene);sky?.registerWater(gltf.scene);sky?.registerBuildings(gltf.scene);sky?.registerRoads(gltf.scene);cityLighting?.register(gltf.scene);updateLayer(gltf.scene);gltf.scene.visible=desired.has(t.id);scene.add(gltf.scene);tiles.set(t.id,{group:gltf.scene,lastSeen:performance.now()});updateSkyline();lastLoad=0;},undefined,error=>{pending.delete(t.id);failed.add(t.id);console.error('Tile load failed',t.id,error);lastLoad=0;});
 }
 updateSkyline();
 const visible=[...tiles.keys()].filter(id=>desired.has(id)).length;
 $('tile-status').textContent=detail?`${visible} / ${selected.length} local tiles${pending.size?' · loading…':''}${failed.size?' · some tiles failed':''}`:`${manifest.tiles.length} detailed tiles available · zoom in`;
 const nearest=selected[0];focusTile=nearest?.id??null;
 $('download').href=nearest?nearest.url:manifest.overview.url;$('download').textContent=nearest?'↓ Download local tile GLB':'↓ Download overview GLB';
}
async function init(){
 const response=await fetch('assets/manifest.json');if(!response.ok)throw new Error('The model manifest is not available yet');manifest=await response.json();limitNavigation();
 const cameraData=await fetch('assets/cameras.json').then(r=>r.json());
 $('road-km').textContent=Math.round(manifest.statistics.roadLengthMetres/1000).toLocaleString();$('building-count').textContent=manifest.statistics.buildingFeatures.toLocaleString();
 const b=manifest.boundsXZ;$('extent').textContent=`${((b[2]-b[0])/1000).toFixed(0)} × ${((b[3]-b[1])/1000).toFixed(0)} km · ${manifest.cameraCount} camera locations · static 3D model`;
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(600000,600000),new THREE.MeshStandardMaterial({color:'#455d52',roughness:1}));ground.name='ground';ground.rotation.x=-Math.PI/2;ground.position.y=-.5;scene.add(ground);
 const positions=[];for(const c of cameraData)positions.push(c.x,14,c.z);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));cameraMarkers=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#ffc777',size:5,sizeAttenuation:false,depthTest:false}));cameraMarkers.visible=false;cameraMarkers.renderOrder=5;scene.add(cameraMarkers);
 centralCity();
 const gltf=await loader.loadAsync(manifest.overview.url,event=>{$('loading-progress').textContent=`${(event.loaded/1e6).toFixed(1)} MB received`;});overview=gltf.scene;
 // Overview lines are a cartographic guide. Use a light colour so narrow streets remain legible at city scale.
 overview.traverse(o=>{if(o.isLineSegments){o.material.color.set(o.name==='major'?'#c1d1b6':o.name==='street'?'#90aaa0':'#88a294');o.material.transparent=true;o.material.opacity=o.name==='major'?.95:.65;}});
 if(manifest.skyline){const layer=await loader.loadAsync(manifest.skyline.url);skyline=layer.scene;scene.add(skyline);updateSkyline();highrises=tallBuildings(skyline,Infinity);}
 cathedral=createNotreDame({scene,project});cathedral.group.visible=$('buildings').checked;cathedral.replaceGeneric(skyline);
 market=createBenThanh({scene,project});market.group.visible=$('buildings').checked;market.replaceGeneric(skyline);
 palace=createIndependencePalace({scene,project});palace.group.visible=$('buildings').checked;palace.replaceGeneric(skyline);
 majestic=createMajestic({scene,project});majestic.group.visible=$('buildings').checked;majestic.replaceGeneric(skyline);
 rex=createRex({scene,project});rex.group.visible=$('buildings').checked;rex.replaceGeneric(skyline);
 railway=createRailway({scene,project});
 openTour=createOpenTour({scene,project});   // the open-top tour bus, simulated from its timetable   // the North-South railway and its yards: not in the generic model
 for(const [key,create] of LANDMARKS){const l=landmarks[key]=create({scene,project});l.group.visible=$('buildings').checked;l.replaceGeneric(skyline);}
 sky=createSky({scene,manifest,directionalLight:sunLight,hemisphereLight:hemiLight});
 sky.registerWater(overview);sky.registerBuildings(skyline);sky.registerRoads(overview);
 cityLighting=createCityLighting({scene,camera,controls,sky});
 cityLighting.register(overview);cityLighting.register(skyline);
 for(const [id,key] of [['city-lights','lights']]) {
  const input=$(id);cityLighting.state[key]=input.checked;
  input.onchange=()=>{cityLighting.state[key]=input.checked;};
 }
 updateLayer(overview);scene.add(overview);$('loading').hidden=true;ready=true;updateTiles();
 weather=createWeather({scene,project,manifest});
 flights=createFlights({scene,project,controls});
 metro=createMetro({scene,project});
 lightning=createLightning({scene,weather,skyline,camera});
 flag=createFlag({scene,skyline,camera,roof:landmarks.landmark81?.roof});
 // River tours: the two yachts circle the river continuously, never moored.
 if(landmarks.yacht&&landmarks.princess60){
  const star=landmarks.yacht,nha=landmarks.princess60;nha.setRafted(false);
  riverTour=createRiverTour({project,boats:[
   {name:'Saigon Star',object:star.yacht,waterY:0,moored:on=>star.setMoored(on)},
   {name:'Nha Rong',object:nha.yacht,waterY:-0.12},
  ]});
 }
 // Every landmark's flag: the same flag, turned by the same wind, waving when near.
 flagSet=createFlagSet({scene,camera});
 for(const l of [palace,majestic,rex,...Object.values(landmarks)])for(const f of l?.flags??[])flagSet.add({parent:l.group,...f});
 window.cityModel={get skyline(){const visible=new Set();skyline?.traverse(o=>{if(o.isMesh&&o.visible)visible.add(o.name.split('__')[1]);});return {loaded:!!skyline,visibleTiles:[...visible],detailedTiles:[...tiles].filter(([,entry])=>entry.group.visible).map(([id])=>id),maximumHeight:manifest.skyline?.maximumHeightMetres};},get weather(){return weather.state;},get flights(){return flights.state;},get flightPositions(){return flights.aircraft;},get lightning(){return lightning.state;},get sky(){return sky.state;},get lighting(){return cityLighting?.state;},get flag(){return flag?.state;},get flags(){return flagSet?.state;},get railway(){return railway?.state;},get openTour(){return openTour?.state;},get riverTour(){return riverTour?.state;},get metro(){return metro?.state;},get palace(){return palace?.state;},get majestic(){return majestic?.state;},get rex(){return rex?.state;},get landmarks(){return Object.fromEntries(Object.entries(landmarks).map(([key,l])=>[key,l.state]));},get cathedral(){return cathedral?.state;},get market(){return market?.state;},get ready(){return ready;},get loadedTiles(){return tiles.size;},get pendingTiles(){return pending.size;},get failedTiles(){return failed.size;},get focusTile(){return focusTile;},get statistics(){return manifest.statistics;},get bounds(){return manifest.boundsXZ;}};
}
$('overview').onclick=()=>{if(ready)wholeCity();};
$('downtown').onclick=()=>{if(ready)centralCity();};
// Tân Sơn Nhất: look west along the 25 approach from above the terminals.
$('airport').onclick=()=>{if(!ready)return;const [x,z]=project(106.6525,10.8185);controls.target.set(x,30,z);camera.position.copy(controls.target).add(new THREE.Vector3(.55,.42,.72).normalize().multiplyScalar(3600));controls.update();lastLoad=0;setActive('airport');};
// Metro Line 1: chase the train from behind. The camera stays at a fixed
// distance and a fixed angle above the train; only its compass direction eases
// round (the shortest way) to stay behind the train's direction of travel, so
// it follows curves and turns at the terminals smoothly without bobbing up and
// down. The mouse wheel changes the distance. Panning away, Esc, or any other
// view ends it.
const CHASE_PITCH=0.38;          // radians above the horizontal, ~22°
const CHASE_TURN=2.5;            // how quickly the view swings round, per second
let following=null;
function stopFollowing(){if(!following)return;following.source?.setFollowing?.(false);following=null;controls.enableZoom=true;}
const behindYaw=v=>Math.atan2(-v.forward.x,-v.forward.z);        // direction from train to camera
function placeChase(v){const {yaw,distance}=following,pitch=following.pitch??CHASE_PITCH,flat=distance*Math.cos(pitch);
 controls.target.copy(v.pos);
 camera.position.set(v.pos.x+Math.sin(yaw)*flat,v.pos.y+distance*Math.sin(pitch),v.pos.z+Math.cos(yaw)*flat);
 following.last.copy(v.pos);}
$('metro-view').onclick=()=>{if(!ready)return;metro?.setFollowing?.(false);const v=metro?.trainView(controls.target.clone());
 if(!v){const [x,z]=project(106.744,10.803);controls.target.set(x,12,z);camera.position.copy(controls.target).add(new THREE.Vector3(-.35,.45,.82).normalize().multiplyScalar(1400));controls.update();lastLoad=0;setActive('metro-view');return;}
 following={yaw:behindYaw(v),distance:140,last:v.pos.clone(),at:performance.now(),button:'metro-view',source:metro,view:()=>metro?.trainView()};
 // The wheel sets the chase distance (below); the controls' own zoom, which
 // moves the pivot to the cursor, would end the chase.
 controls.enableZoom=false;
 placeChase(v);controls.update();metro.setFollowing?.(true);lastLoad=0;setActive('metro-view');};
// Open tour: follow the nearest tour bus from behind, closer and lower than
// the train; with no bus running (before 09:00 or after the last loop),
// show the start at the Opera House.
// River tour: follow the nearer yacht from low astern.
$('river-tour').onclick=()=>{if(!ready||!riverTour)return;stopFollowing();riverTour.update(Date.now());const v=riverTour.followView(controls.target.clone());
 // Low astern and aimed above the yacht, looking up the river at the skyline.
 following={yaw:behindYaw(v),distance:48,pitch:0.07,last:v.pos.clone(),at:performance.now(),button:'river-tour',source:riverTour,view:()=>riverTour.followView()};
 controls.enableZoom=false;placeChase(v);controls.update();lastLoad=0;setActive('river-tour');};
$('open-tour').onclick=()=>{if(!ready||!openTour)return;stopFollowing();openTour.update(Date.now());const v=openTour.followView(controls.target.clone());
 if(!v){const [x,z]=project(106.70305,10.7764);controls.target.set(x,4,z);camera.position.copy(controls.target).add(new THREE.Vector3(-.5,.35,.8).normalize().multiplyScalar(160));controls.update();lastLoad=0;setActive('open-tour');return;}
 following={yaw:behindYaw(v),distance:32,last:v.pos.clone(),at:performance.now(),button:'open-tour',source:openTour,view:()=>openTour.followView()};
 controls.enableZoom=false;placeChase(v);controls.update();lastLoad=0;setActive('open-tour');};
function followTrain(){
 if(!following)return;const v=following.view();if(!v)return;
 // The user panned: the target is no longer where we left it.
 if(controls.target.distanceTo(following.last)>0.5){stopFollowing();setActive('');return;}
 const now=performance.now(),dt=Math.min(0.1,(now-following.at)/1000);following.at=now;
 let turn=behindYaw(v)-following.yaw;turn=Math.atan2(Math.sin(turn),Math.cos(turn));   // shortest way round
 following.yaw+=turn*(1-Math.exp(-CHASE_TURN*dt));
 placeChase(v);
}
renderer.domElement.addEventListener('wheel',e=>{if(!following)return;
 following.distance=Math.min(2000,Math.max(following.button==='open-tour'?12:following.button==='river-tour'?20:40,following.distance*Math.exp(e.deltaY*0.001)));},{passive:true});
addEventListener('keydown',e=>{if(e.key==='Escape'&&following){stopFollowing();setActive('');}});
$('top').onclick=()=>{if(!ready)return;goTo(controls.target.x,controls.target.z,camera.position.distanceTo(controls.target),true);setActive('top');};
for(const id of ['buildings','minor'])$(id).onchange=()=>{if(cathedral)cathedral.group.visible=$('buildings').checked;if(market)market.group.visible=$('buildings').checked;if(palace)palace.group.visible=$('buildings').checked;if(majestic)majestic.group.visible=$('buildings').checked;if(rex)rex.group.visible=$('buildings').checked;for(const l of Object.values(landmarks))l.group.visible=$('buildings').checked;if(overview)updateLayer(overview);for(const e of tiles.values())updateLayer(e.group);updateSkyline();};
$('cameras').onchange=()=>{if(cameraMarkers)cameraMarkers.visible=$('cameras').checked;};
renderer.domElement.addEventListener('dblclick',e=>{
 if(!ready||!highrises.length)return;
 const rect=renderer.domElement.getBoundingClientRect();
 const v=new THREE.Vector3(),onScreen=[];
 for(const b of highrises){
  v.set(b.x,b.height,b.z).project(camera);
  if(v.z<-1||v.z>1)continue; // behind the camera or past the far plane
  onScreen.push({x:(v.x+1)/2*rect.width,z:(1-v.y)/2*rect.height,building:b});
 }
 const nearest=nearestHighrise(onScreen,e.clientX-rect.left,e.clientY-rect.top,HIGHRISE_SNAP_PIXELS);
 if(!nearest)return;
 const b=nearest.building;
 // Hover just off the roof corner, looking back across it, rather than
 // straight down from directly above -- matches the other presets' angle.
 controls.target.set(b.x,b.height,b.z);
 camera.position.copy(controls.target).add(new THREE.Vector3(.6,.3,.7).normalize().multiplyScalar(190));
 controls.update();lastLoad=0;setActive('');
});
$('about').onclick=()=>$('info').showModal();$('close').onclick=()=>$('info').close();
controls.addEventListener('start',()=>{if(!following)setActive('');});
function animate(now){requestAnimationFrame(animate);followTrain();controls.update();if(camera.position.y<3)camera.position.y=3;   // zooming to the cursor must not take the camera below the ground
 weather?.update(now,camera);flights?.update(now);lightning?.update(now);flag?.update?.(now);riverTour?.update(Date.now());flagSet?.update(now);for(const l of Object.values(landmarks))l.update?.(camera,now);openTour?.update(Date.now());metro?.update(now);sky?.update();if(ready&&now-lastLoad>400){lastLoad=now;updateTiles();const p=controls.target;$('position').textContent=`${(manifest.originLonLat[1]-p.z/111320).toFixed(4)}° N / ${(manifest.originLonLat[0]+p.x/(111320*Math.cos(manifest.originLonLat[1]*Math.PI/180))).toFixed(4)}° E`;}cityLighting?.update(now);renderer.render(scene,camera);}
requestAnimationFrame(animate);
init().catch(error=>{console.error(error);$('loading').innerHTML='';const title=document.createElement('strong');title.textContent='Model could not be loaded';const p=document.createElement('p');p.textContent=error.message;$('loading').append(title,p);});

