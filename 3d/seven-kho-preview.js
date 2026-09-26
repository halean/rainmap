import * as THREE from 'three';
import {OrbitControls} from './vendor/controls/OrbitControls.js';
import {createSevenKho} from './seven-kho.js';
try {
 const scene=new THREE.Scene();scene.background=new THREE.Color('#d4cbbd');
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
 const camera=new THREE.PerspectiveCamera(40,1,.05,250);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=1;controls.maxDistance=65;
 const model=createSevenKho();scene.add(model.group);model.group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#b9b2a4',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.26;ground.receiveShadow=true;scene.add(ground);
 const ambient=new THREE.HemisphereLight('#fff2dc','#747866',2.1);scene.add(ambient);const sun=new THREE.DirectionalLight('#fff0d2',3.0);sun.position.set(-12,18,17);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-15,right:15,top:15,bottom:-15,near:1,far:65});sun.shadow.normalBias=.035;scene.add(sun);
 const fill=new THREE.DirectionalLight('#b1c5e0',.65);fill.position.set(10,8,-10);scene.add(fill);
 const warm=[];for(const [x,y,z]of [[-2,2.7,3],[2,2.7,3],[-4,3.5,7],[4,3.5,7]]){const l=new THREE.PointLight('#ffd395',0,9,2);l.position.set(x,y,z);scene.add(l);warm.push(l);}
 const roomLights=[];for(const z of [-10,-6,-2,2]){const l=new THREE.PointLight('#fff0da',0,6,2);l.position.set(0,2.65,z);scene.add(l);roomLights.push(l);}
 const views={interior:[[.65,1.75,7.2],[0,1.20,-6.5]],overview:[[18,13,23],[0,3,2]],front:[[0,6.2,26],[0,4.15,2.4]],dining:[[9,4.5,13],[0,1.0,6]],table:[[1.6,2.1,9.7],[0,.72,7.45]],display:[[1.8,2.8,8],[-.9,1.4,4.4]]};
 function view(key){model.components.shutters.visible=key!=='interior';roomLights.forEach(l=>l.intensity=key==='interior'?14:0);camera.position.fromArray(views[key][0]);controls.target.fromArray(views[key][1]);controls.update();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===key));}
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));view('interior');
 document.querySelector('#roof').onchange=e=>model.components.roof.visible=!e.target.checked;
 document.querySelector('#night').onchange=e=>{const n=e.target.checked;scene.background.set(n?'#17252b':'#d4cbbd');ambient.intensity=n?.5:2.1;sun.intensity=n?.15:3;fill.intensity=n?.3:.65;warm.forEach(l=>l.intensity=n?36:0);};
 document.querySelector('#menu').onclick=()=>document.querySelector('#research').showModal();
 function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();
 document.querySelector('#status').textContent=`${model.triangles.toLocaleString()} triangles · 16 tables · 30 chairs · 24 stools`;
 window.sevenKho={model,scene,camera,renderer,controls,view};
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
 addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);controls.dispose();model.dispose();ground.geometry.dispose();ground.material.dispose();sun.shadow.map?.dispose();renderer.dispose();},{once:true});
}catch(error){document.querySelector('#error').textContent=error.stack;console.error(error);}
