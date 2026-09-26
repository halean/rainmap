import * as THREE from 'three';
import {OrbitControls} from './vendor/controls/OrbitControls.js';
import {createPrincess60NhaRong} from './princess60-nharong.js';
try {
const scene=new THREE.Scene();scene.background=new THREE.Color('#d6dfe2');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.92;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(34,innerWidth/innerHeight,0.03,250);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=0.7;controls.maxDistance=65;controls.target.set(0,2,0);
scene.add(new THREE.HemisphereLight('#eaf5ff','#54646b',1.4));
const key=new THREE.DirectionalLight('#fff0da',2.6);key.position.set(4,15,11);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-14,right:14,top:14,bottom:-14,near:1,far:55});key.shadow.normalBias=0.025;key.shadow.bias=-0.00015;scene.add(key);
const fill=new THREE.DirectionalLight('#c8e3f4',1.0);fill.position.set(-8,6,-9);scene.add(fill);
// Procedural studio reflections; all resources local and original.
const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d');
const grad=ctx.createLinearGradient(0,0,0,512);grad.addColorStop(0,'#e8f1f6');grad.addColorStop(.45,'#8da8b5');grad.addColorStop(.51,'#e5e9e8');grad.addColorStop(1,'#324a58');ctx.fillStyle=grad;ctx.fillRect(0,0,1024,512);
ctx.fillStyle='#ffffff';ctx.fillRect(90,80,160,180);ctx.fillRect(620,100,75,210);ctx.fillStyle='#dbe4e8';ctx.fillRect(810,100,130,160);
const env=new THREE.CanvasTexture(canvas);env.mapping=THREE.EquirectangularReflectionMapping;env.colorSpace=THREE.SRGBColorSpace;
const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromEquirectangular(env);scene.environment=target.texture;env.dispose();pmrem.dispose();
const yacht=createPrincess60NhaRong();scene.add(yacht.group);yacht.group.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true;}});
const ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:'#c9d4d8',roughness:0.94}));ground.rotation.x=-Math.PI/2;ground.position.y=-1.46;ground.receiveShadow=true;scene.add(ground);
const views={hero:[[23,15,23],[0,2.4,0]],side:[[0,5,30],[0,2.2,0]],stern:[[-19,10,14],[-3,2.3,0]],deck:[[-10,13,8],[-2.5,4,0]],bow:[[14,9,10],[4,2,0]],under:[[-13,-0.6,12],[-5,-0.45,0]]};
function setView(name){const [p,t]=views[name]||views.hero;camera.position.set(...p);controls.target.set(...t);ground.visible=name!=='under';controls.update();document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===name));}
document.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>setView(e.dataset.view));
document.querySelector('#wire').onchange=e=>Object.values(yacht.materials).forEach(m=>{m.wireframe=e.target.checked;});
document.querySelector('#interior').onchange=e=>{for(const name of ['superstructure','flybridge','sunbather-flybridge'])yacht.components[name].visible=!e.target.checked;};
setView(new URLSearchParams(location.search).get('view')||'hero');
document.querySelector('#status').innerHTML=`${yacht.triangles.toLocaleString()} triangles<br>${Object.keys(yacht.components).length} detailed assemblies<br>Studio view · moored beside Saigon Star in the city`;
window.__princess60={yacht,scene,camera,renderer,setView};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
} catch(error) {document.querySelector('#error').textContent=`Unable to open the model: ${error.message}`;console.error(error);}
