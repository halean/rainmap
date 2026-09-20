// Camera classifications are ordinal, never a calibrated rainfall rate.
export const rainClasses = {No: 0, Light: 1, Medium: 2, Heavy: 3};
export const rainColors = ['#94a3b8', '#fab219', '#ec835a', '#d03b3b'];
export const mercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
export function freshCamera(p, now = Date.now()) {
  const age = now - Date.parse(p.captured_at);
  return Number.isFinite(p.lon) && Number.isFinite(p.lat) && Object.hasOwn(rainClasses, p.rain) && age >= -300000 && age <= 30 * 60000;
}
export function gaugeValue(points, x, z) {
  let weight = 0, amount = 0;
  for (const p of points) {
    if (p.stale || !Number.isFinite(p.rain_mm) || !(p.coverage > 0)) continue;
    const d2 = ((x - p.x) ** 2 + (z - p.z) ** 2) / 1e6;
    if (d2 > 144) continue;
    const w = Math.exp(-d2 / 32) * p.coverage;
    weight += w; amount += w * p.rain_mm;
  }
  return {mm: weight ? amount / weight : 0, weight};
}

// Match rainmap renderRadar: 4 km Gaussian, 11.2 km cutoff, dry observations
// participate in the weighted mean. Freshness filtering belongs to the caller.
export function cameraDensitySampler(points) {
  const valid = points.filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Object.hasOwn(rainClasses,p.rain));
  const lat0 = valid.length ? (Math.min(...valid.map(p=>p.lat))+Math.max(...valid.map(p=>p.lat)))/2 : 0;
  const lonKm = 111.32*Math.cos(lat0*Math.PI/180);
  return (lon,lat) => {
    let weight=0, sum=0;
    for(const p of valid) {
      const d2=((lon-p.lon)*lonKm)**2+((lat-p.lat)*110.57)**2;
      if(d2>11.2**2) continue;
      const w=Math.exp(-d2/32);weight+=w;sum+=w*rainClasses[p.rain];
    }
    const score=weight ? sum/weight : 0;
    const density=weight<.05 ? 0 : Math.min(weight,1)*Math.min(score,1);
    return {score,density};
  };
}
export function cameraRainRGB(score) {
  const stops=[[250,178,25],[236,131,90],[208,59,59]];
  const s=Math.max(1,Math.min(3,Math.round(Math.max(1,Math.min(3,score))/.4)*.4));
  const t=s-1,i=Math.min(1,Math.floor(t)),f=t-i;
  return stops[i].map((v,j)=>v+(stops[i+1][j]-v)*f);
}
