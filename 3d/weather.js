import * as THREE from 'three';
import {freshCamera, rainClasses, rainColors, mercator, gaugeValue, cameraDensitySampler, cameraRainRGB} from './weather-data.js';
const $ = id => document.getElementById(id);
const time = iso => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('en-GB', {timeZone:'Asia/Ho_Chi_Minh'}) + ' ICT' : 'unknown time';
export function createWeather({scene, project, manifest}) {
  const groups = {}, busy = {}, generations = {};
  let rain = null, rainBase = [], last = 0, lastRainPoints = [];
  const state = {cameraCount:0, rainParticleCount:0, rainDensityCells:0, gaugeCount:0, cloudScan:null};
  for (const name of ['rain','gauges','clouds']) { groups[name] = new THREE.Group(); scene.add(groups[name]); }
  function clear(name) {
    for (const o of [...groups[name].children]) {
      groups[name].remove(o); o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose();
    }
    if (name === 'rain') {rain = null; rainBase = []; lastRainPoints = []; state.cameraCount = 0; state.rainParticleCount = 0; state.rainDensityCells = 0; $('weather-readings').replaceChildren();}
    if (name === 'gauges') {state.gaugeCount = 0; $('gauge-readings').replaceChildren();}
    if (name === 'clouds') {state.cloudScan = null; $('cloud-scale').replaceChildren();}
  }
  async function json(path) {
    const response = await fetch(path, {signal:AbortSignal.timeout(100000), cache:'no-store'});
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    return response.json();
  }
  function plane(texture, y, opacity) {
    const [w,s,e,n] = manifest.boundsXZ;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(e-w,n-s), new THREE.MeshBasicMaterial({map:texture, transparent:true, opacity, depthWrite:false, side:THREE.DoubleSide}));
    mesh.rotation.x = -Math.PI/2; mesh.position.set((w+e)/2,y,(s+n)/2); return mesh;
  }
  function cameras(data) {
    if (!Array.isArray(data)) throw new Error('Invalid camera response');
    clear('rain');
    const points = data.filter(p => freshCamera(p));
    // Kept for 3d/lightning.js: which currently-reporting cameras are wet
    // enough to plausibly be under a thunderstorm, and where.
    lastRainPoints = points.map(p => {const [x,z] = project(p.lon,p.lat); return {x, z, classIndex: rainClasses[p.rain]};});
    const positions = [], colors = [], drops = [], dropColors = [];
    for (const p of points) {
      const [x,z] = project(p.lon,p.lat), level = rainClasses[p.rain], c = new THREE.Color(rainColors[level]);
      positions.push(x,35,z); colors.push(c.r,c.g,c.b);
    }
    const sample=cameraDensitySampler(points), [west,north,east,south]=manifest.boundsXZ;
    const lonScale=111320*Math.cos(manifest.originLonLat[1]*Math.PI/180);
    const at=(x,z)=>sample(manifest.originLonLat[0]+x/lonScale,manifest.originLonLat[1]-z/111320);
    // The same density drives the overview field and the distribution of 3D rain.
    const size=180, canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d'), pixels=ctx.createImageData(size,size);
    for(let row=0;row<size;row++) for(let col=0;col<size;col++) {
      const {score,density}=at(west+(east-west)*(col+.5)/size,north+(south-north)*(row+.5)/size);
      if(!density) continue;
      const index=(row*size+col)*4;
      pixels.data.set([...cameraRainRGB(score),Math.round(215*density)],index);state.rainDensityCells++;
    }
    ctx.putImageData(pixels,0,0);
    const field=new THREE.CanvasTexture(canvas);field.colorSpace=THREE.SRGBColorSpace;
    groups.rain.add(plane(field,12,.45));
    // Stable, evenly distributed candidates avoid flicker between API refreshes.
    // At most 32,768 streaks, independent of camera count or overlapping kernels.
    let seed=20260920;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let row=0;row<128;row++) for(let col=0;col<128;col++) for(let j=0;j<2;j++) {
      const x=west+(east-west)*(col+random())/128,z=north+(south-north)*(row+random())/128;
      const {score,density}=at(x,z), chance=random(), y=50+random()*1300;
      if(chance>=density*Math.min(1,score/3)) continue;
      const c=new THREE.Color('#8fdcff').lerp(new THREE.Color('#d5edff'),Math.min(1,score/3));
      drops.push(x,y,z,x,y+45,z);dropColors.push(c.r,c.g,c.b,c.r,c.g,c.b);rainBase.push(y);
    }
    state.rainParticleCount=rainBase.length;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    groups.rain.add(new THREE.Points(geo,new THREE.PointsMaterial({vertexColors:true,size:7,sizeAttenuation:false,depthTest:false})));
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position',new THREE.Float32BufferAttribute(drops,3)); dg.setAttribute('color',new THREE.Float32BufferAttribute(dropColors,3));
    rain = new THREE.LineSegments(dg,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.5,depthWrite:false})); groups.rain.add(rain);
    state.cameraCount = points.length;
    $('rain-status').textContent = `${points.filter(p=>rainClasses[p.rain]>0).length}/${points.length} fresh cameras report rain · interpolated density · ${data.length-points.length} stale/unknown excluded. Latest capture ${time(points.map(p=>p.captured_at).sort().at(-1))}.`;
    $('weather-readings').replaceChildren(...points.map(p=>{const el=document.createElement('p');el.textContent=`${p.location_text||p.title}: ${p.rain}${p.approx?' · approximate location':''} · ${time(p.captured_at)}. ${p.justification||''}`;return el;}));
  }
  function gauges(data) {
    if (!Array.isArray(data.points)) throw new Error('Invalid gauge response');
    clear('gauges');
    const points = data.stale ? [] : data.points.filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>{const [x,z]=project(p.lon,p.lat);return {...p,x,z};});
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=192;
    const ctx=canvas.getContext('2d'), pixels=ctx.createImageData(192,192), [w,s,e,n]=manifest.boundsXZ;
    for(let y=0;y<192;y++) for(let x=0;x<192;x++) {
      const {mm,weight}=gaugeValue(points,w+(e-w)*(x+.5)/192,s+(n-s)*(y+.5)/192);
      const color=new THREE.Color('#72d6ff').lerp(new THREE.Color('#5143bd'),Math.min(1,mm/50)), i=(y*192+x)*4;
      pixels.data.set([color.r*255,color.g*255,color.b*255,170*Math.min(1,weight)*Math.min(1,mm)],i);
    }
    ctx.putImageData(pixels,0,0); const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    groups.gauges.add(plane(texture,8,.8));
    state.gaugeCount=points.filter(p=>!p.stale&&Number.isFinite(p.rain_mm)&&p.coverage>0).length;
    $('gauges-status').textContent=`${state.gaugeCount} usable gauges · ${data.window_hours} h ending ${time(data.end)}. ${data.points.filter(p=>p.partial).length} partial totals (lower bounds). ${data.stale?'Log stale; field hidden.':''}`;
    $('gauge-readings').replaceChildren(...data.points.map(p=>{const el=document.createElement('p');el.textContent=`${p.station}: ${p.rain_mm===null?'unavailable':`${p.partial?'at least ':''}${p.rain_mm} mm`} · ${Math.round(p.coverage*100)}% coverage${p.stale?' · stale':''} · ${time(p.observed_at)}`;return el;}));
  }
  async function clouds(data, generation) {
    if(!data.bounds || !data.image_url || !Number.isFinite(Date.parse(data.scan))) throw new Error('Invalid satellite response');
    const url=new URL(data.image_url,location.origin);
    if(url.origin!==location.origin || url.pathname!='/api/rain-map/himawari.png') throw new Error('Unexpected satellite image URL');
    const response=await fetch(url,{signal:AbortSignal.timeout(100000)}); if(!response.ok) throw new Error(`Image HTTP ${response.status}`);
    const bitmap=await createImageBitmap(await response.blob(),{imageOrientation:'flipY'});
    if(generation!==generations.clouds) {bitmap.close();return;}
    const texture=new THREE.Texture(bitmap);texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;
    // Crop the Mercator image to the model extent; UVs account for its latitude projection.
    const [[south,west],[north,east]]=data.bounds, [w,s,e,n]=manifest.boundsXZ;
    const geometry=new THREE.PlaneGeometry(e-w,n-s,1,32), positions=geometry.attributes.position, uv=geometry.attributes.uv;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i)+(w+e)/2, z=-positions.getY(i)+(s+n)/2;
      const lat=manifest.originLonLat[1]-z/111320, lon=manifest.originLonLat[0]+x/(111320*Math.cos(manifest.originLonLat[1]*Math.PI/180));
      uv.setXY(i,(lon-west)/(east-west),(mercator(lat)-mercator(south))/(mercator(north)-mercator(south)));
    }
    // Discard outside the satellite footprint instead of stretching edge texels.
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:Number($('cloud-opacity').value),side:THREE.DoubleSide,depthWrite:false});
    material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nif (vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0) discard;');};
    texture.addEventListener('dispose',()=>bitmap.close());
    clear('clouds'); const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.set((w+e)/2,2500,(s+n)/2);groups.clouds.add(mesh);state.cloudScan=data.scan;
    const age=Math.round((Date.now()-Date.parse(data.scan))/60000);
    $('clouds-status').textContent=`${data.label||data.mode} · ${time(data.scan)} · ${age} min old${age>40?' · STALE':''} · ${Math.round(data.coverage*100)}% coverage.`;
    $('cloud-scale').replaceChildren(...(data.scale||[]).map(s=>{const el=document.createElement('span');el.style.borderTop=`5px solid ${s.color}`;el.textContent=s.label;return el;}));
  }
  async function refresh(name) {
    if(!$(name+'-weather').checked || busy[name]) return;
    busy[name]=true;const generation=generations[name]=(generations[name]||0)+1;
    $(name+'-status').textContent='Loading…';
    try {
      const data=await json(name==='rain'?'/api/rain-map':name==='gauges'?`/api/rain-map/vrain?hours=${$('gauge-hours').value}`:'/api/rain-map/himawari');
      if(generation!==generations[name]) return;
      if(name==='clouds') await clouds(data,generation); else if(name==='rain') cameras(data); else gauges(data);
    } catch(error) {if(generation===generations[name]) {clear(name);$(name+'-status').textContent=`Unavailable: ${error.message}. Retrying automatically.`;}}
    finally {busy[name]=false;}
  }
  for(const name of Object.keys(groups)) {
    $(name+'-weather').onchange=()=>{groups[name].visible=$(name+'-weather').checked;if(groups[name].visible)refresh(name);};
    groups[name].visible=$(name+'-weather').checked;refresh(name);
  }
  $('gauge-hours').onchange=()=>{clear('gauges');generations.gauges=(generations.gauges||0)+1;const retry=()=>{if(busy.gauges)setTimeout(retry,100);else refresh('gauges');};retry();};
  $('weather-refresh').onclick=()=>Object.keys(groups).forEach(refresh);
  $('cloud-opacity').oninput=()=>groups.clouds.children.forEach(o=>o.material.opacity=Number($('cloud-opacity').value));
  setInterval(()=>refresh('rain'),60000);
  setInterval(()=>['gauges','clouds'].forEach(refresh),120000);
  return {state, rainPoints: () => lastRainPoints, update(now) {
    if(now-last<32 || !rain || !groups.rain.visible) return;last=now;
    const pos=rain.geometry.attributes.position;
    for(let i=0;i<rainBase.length;i++) {const y=50+((rainBase[i]-now*.25)%1300+1300)%1300;pos.setY(i*2,y);pos.setY(i*2+1,y+45);}
    pos.needsUpdate=true;
  }};
}
