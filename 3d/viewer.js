import * as THREE from 'three';
import {createWeather} from './weather.js';
import {createFlights} from './flights.js';
import {createLightning} from './lightning.js';
let weather,flights,lightning;
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
scene.add(new THREE.HemisphereLight('#e7f1ee','#769080',2.6));const sun=new THREE.DirectionalLight('#fff3da',2.7);sun.position.set(-10000,20000,5000);scene.add(sun);
const loader=new GLTFLoader(),tiles=new Map(),pending=new Set(),failed=new Set();let manifest,overview,skyline,streets=[],cameraMarkers,ready=false,lastLoad=0,desired=new Set(),focusTile=null;
function project(lon,lat){return [(lon-manifest.originLonLat[0])*111320*Math.cos(manifest.originLonLat[1]*Math.PI/180),-(lat-manifest.originLonLat[1])*111320];}
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(ready&&$('overview').classList.contains('active'))wholeCity();}
new ResizeObserver(resize).observe(host);resize();
function setActive(id){document.querySelectorAll('.views button').forEach(b=>b.classList.toggle('active',b.id===id));}
function goTo(x,z,distance=1600,top=false){controls.target.set(x,0,z);camera.position.copy(controls.target).add(top?new THREE.Vector3(0,distance,1):new THREE.Vector3(.6,.85,.7).normalize().multiplyScalar(distance));controls.update();lastLoad=0;}
// Look through the rain volume from below the schematic cloud deck.
function centralCity(){const [x,z]=project(106.699,10.774);controls.target.set(x,120,z);camera.position.copy(controls.target).add(new THREE.Vector3(-.6,.36,.7).normalize().multiplyScalar(2600));controls.update();lastLoad=0;setActive('downtown');}
function wholeCity(){const b=manifest.boundsXZ,span=Math.hypot(b[2]-b[0],b[3]-b[1]);const fov=Math.min(camera.fov*Math.PI/360,Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect));goTo((b[0]+b[2])/2,(b[1]+b[3])/2,Math.min(200000,span*.52/Math.sin(fov)));setActive('overview');}
function updateLayer(group){group.traverse(o=>{if(!o.isMesh&&!o.isLineSegments)return;const name=o.name;o.visible= name.startsWith('building')?$('buildings').checked : ['street','path'].includes(name)?$('minor').checked : true;});}
function dispose(group){group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
function tileDistance(tile){const b=tile.bounds,t=controls.target;const dx=Math.max(b[0]-t.x,0,t.x-b[2]),dz=Math.max(b[1]-t.z,0,t.z-b[3]);return Math.hypot(dx,dz);}
function updateSkyline(){if(!skyline)return;skyline.traverse(o=>{if(!o.isMesh)return;const id=o.name.split('__')[1];o.visible=$('buildings').checked&&!tiles.get(id)?.group.visible;});}
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
  loader.load(t.url,gltf=>{pending.delete(t.id);updateLayer(gltf.scene);gltf.scene.visible=desired.has(t.id);scene.add(gltf.scene);tiles.set(t.id,{group:gltf.scene,lastSeen:performance.now()});updateSkyline();lastLoad=0;},undefined,error=>{pending.delete(t.id);failed.add(t.id);console.error('Tile load failed',t.id,error);lastLoad=0;});
 }
 updateSkyline();
 const visible=[...tiles.keys()].filter(id=>desired.has(id)).length;
 $('tile-status').textContent=detail?`${visible} / ${selected.length} local tiles${pending.size?' · loading…':''}${failed.size?' · some tiles failed':''}`:`${manifest.tiles.length} detailed tiles available · zoom in`;
 const nearest=selected[0];focusTile=nearest?.id??null;
 $('download').href=nearest?nearest.url:manifest.overview.url;$('download').textContent=nearest?'↓ Download local tile GLB':'↓ Download overview GLB';
}
async function init(){
 const response=await fetch('assets/manifest.json');if(!response.ok)throw new Error('The model manifest is not available yet');manifest=await response.json();
 const [streetData,cameraData]=await Promise.all([fetch('assets/streets.json').then(r=>r.json()),fetch('assets/cameras.json').then(r=>r.json())]);streets=streetData;
 $('road-km').textContent=Math.round(manifest.statistics.roadLengthMetres/1000).toLocaleString();$('building-count').textContent=manifest.statistics.buildingFeatures.toLocaleString();
 const b=manifest.boundsXZ;$('extent').textContent=`${((b[2]-b[0])/1000).toFixed(0)} × ${((b[3]-b[1])/1000).toFixed(0)} km · ${manifest.cameraCount} camera locations · static 3D model`;
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(600000,600000),new THREE.MeshStandardMaterial({color:'#455d52',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.5;scene.add(ground);
 const positions=[];for(const c of cameraData)positions.push(c.x,14,c.z);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));cameraMarkers=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#ffc777',size:5,sizeAttenuation:false,depthTest:false}));cameraMarkers.visible=false;cameraMarkers.renderOrder=5;scene.add(cameraMarkers);
 const options=document.createDocumentFragment();for(const r of streets){const o=document.createElement('option');o.value=r.name;options.appendChild(o);}$('street-list').appendChild(options);
 centralCity();
 const gltf=await loader.loadAsync(manifest.overview.url,event=>{$('loading-progress').textContent=`${(event.loaded/1e6).toFixed(1)} MB received`;});overview=gltf.scene;
 // Overview lines are a cartographic guide. Use a light colour so narrow streets remain legible at city scale.
 overview.traverse(o=>{if(o.isLineSegments){o.material.color.set(o.name==='major'?'#c1d1b6':o.name==='street'?'#90aaa0':'#88a294');o.material.transparent=true;o.material.opacity=o.name==='major'?.95:.65;}});
 if(manifest.skyline){const layer=await loader.loadAsync(manifest.skyline.url);skyline=layer.scene;scene.add(skyline);updateSkyline();}
 updateLayer(overview);scene.add(overview);$('loading').hidden=true;ready=true;updateTiles();
 weather=createWeather({scene,project,manifest});
 flights=createFlights({scene,project,controls});
 lightning=createLightning({scene,weather,skyline,camera});
 window.cityModel={get skyline(){const visible=new Set();skyline?.traverse(o=>{if(o.isMesh&&o.visible)visible.add(o.name.split('__')[1]);});return {loaded:!!skyline,visibleTiles:[...visible],detailedTiles:[...tiles].filter(([,entry])=>entry.group.visible).map(([id])=>id),maximumHeight:manifest.skyline?.maximumHeightMetres};},get weather(){return weather.state;},get flights(){return flights.state;},get flightPositions(){return flights.aircraft;},get lightning(){return lightning.state;},get ready(){return ready;},get loadedTiles(){return tiles.size;},get pendingTiles(){return pending.size;},get failedTiles(){return failed.size;},get focusTile(){return focusTile;},get statistics(){return manifest.statistics;},get bounds(){return manifest.boundsXZ;}};
}
$('overview').onclick=()=>{if(ready)wholeCity();};
$('downtown').onclick=()=>{if(ready)centralCity();};
// Tân Sơn Nhất: look west along the 25 approach from above the terminals.
$('airport').onclick=()=>{if(!ready)return;const [x,z]=project(106.6525,10.8185);controls.target.set(x,30,z);camera.position.copy(controls.target).add(new THREE.Vector3(.55,.42,.72).normalize().multiplyScalar(3600));controls.update();lastLoad=0;setActive('airport');};
$('vvk').onclick=()=>{if(!ready)return;const p=project(106.694,10.7605);goTo(...p,1900);setActive('vvk');};
$('top').onclick=()=>{if(!ready)return;goTo(controls.target.x,controls.target.z,camera.position.distanceTo(controls.target),true);setActive('top');};
function search(){if(!ready)return;const clean=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().trim();const q=clean($('search').value);if(!q)return;const r=streets.find(s=>clean(s.name)===q)||streets.find(s=>clean(s.name).includes(q));if(!r){$('search-status').textContent='No matching mapped street. Try another name.';return;}goTo(r.x,r.z,1300);setActive('');$('search-status').textContent=r.name+' · OSM way '+r.id;}
$('go').onclick=search;$('search').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
for(const id of ['buildings','minor'])$(id).onchange=()=>{if(overview)updateLayer(overview);for(const e of tiles.values())updateLayer(e.group);updateSkyline();};
$('cameras').onchange=()=>{if(cameraMarkers)cameraMarkers.visible=$('cameras').checked;};
$('about').onclick=()=>$('info').showModal();$('close').onclick=()=>$('info').close();
controls.addEventListener('start',()=>setActive(''));
function animate(now){requestAnimationFrame(animate);controls.update();weather?.update(now);flights?.update(now);lightning?.update(now);if(ready&&now-lastLoad>400){lastLoad=now;updateTiles();const p=controls.target;$('position').textContent=`${(manifest.originLonLat[1]-p.z/111320).toFixed(4)}° N / ${(manifest.originLonLat[0]+p.x/(111320*Math.cos(manifest.originLonLat[1]*Math.PI/180))).toFixed(4)}° E`;}renderer.render(scene,camera);}
requestAnimationFrame(animate);
init().catch(error=>{console.error(error);$('loading').innerHTML='';const title=document.createElement('strong');title.textContent='Model could not be loaded';const p=document.createElement('p');p.textContent=error.message;$('loading').append(title,p);});
