"""Generate independent, tiled GLB streets/buildings from a Geofabrik OSM PBF.
Writes generated assets to --output; source camera and OSM data are read-only.
"""
import argparse
from array import array
from collections import Counter, defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import time

import numpy as np
import osmium
import shapely
from shapely.geometry import LineString, Polygon, box, shape

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT/'assets'
TILE = 2000
ORIGIN = [106.65,10.81]
SX = 111320*math.cos(math.radians(ORIGIN[1]))
SY = 111320
WIDTHS = {'motorway':13,'motorway_link':6.4,'trunk':11,'trunk_link':6.4,'primary':9.6,'primary_link':6.4,'secondary':8,'secondary_link':5.5,'tertiary':6.4,'tertiary_link':4.5,'residential':5,'unclassified':5,'service':3.5,'living_street':4,'road':4,'track':2.5,'cycleway':2,'footway':1.5,'pedestrian':4,'path':1.2,'steps':1.2}
COLORS={'major':[.17,.25,.28,1],'street':[.26,.34,.36,1],'path':[.46,.53,.46,1],'bridge':[.32,.40,.43,1],'tunnel':[.22,.27,.30,1],'building':[.67,.72,.65,1],'building-tagged':[.59,.68,.64,1],'water':[.19,.42,.46,1],'green':[.35,.49,.37,1],'rail':[.50,.44,.34,1]}

def file_sha256(path):
    digest=hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def project(lon,lat):return ((lon-ORIGIN[0])*SX,-(lat-ORIGIN[1])*SY)
def num(value,default):
    try:return float(re.search(r'-?\d+(?:\.\d+)?',str(value)).group())
    except (ValueError,AttributeError):return default

def polygons(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    if hasattr(g,'geoms'):return [p for c in g.geoms for p in polygons(c)]
    return []
def lines(g):
    if g.is_empty:return []
    if g.geom_type=='LineString':return [g]
    if hasattr(g,'geoms'):return [p for c in g.geoms for p in lines(c)]
    return []

class Buffer:
    def __init__(self,mode=4):self.pos=array('f');self.norm=array('f');self.mode=mode
    def triangle(self,a,b,c,normal=None):
        if normal is None:
            u=np.subtract(b,a);v=np.subtract(c,a);n=np.cross(u,v);mag=np.linalg.norm(n)
            if mag<1e-10:return
            normal=n/mag
        for p in (a,b,c):self.pos.extend(p);self.norm.extend(normal)
    def line(self,a,b):self.pos.extend(a);self.pos.extend(b)

def write_glb(path,buffers,translation=(0,0,0),extras=None):
    binary=bytearray();views=[];accessors=[];meshes=[];nodes=[];materials=[]
    def accessor(data,kind):
        while len(binary)%4:binary.append(0)
        start=len(binary);raw=data.tobytes();binary.extend(raw)
        views.append({'buffer':0,'byteOffset':start,'byteLength':len(raw),'target':34962})
        arr=np.frombuffer(raw,dtype='<f4').reshape(-1,3)
        a={'bufferView':len(views)-1,'componentType':5126,'count':len(arr),'type':'VEC3'}
        if kind=='POSITION':a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        accessors.append(a);return len(accessors)-1
    for key,b in buffers.items():
        if not b.pos:continue
        color=COLORS[key]
        # glTF factors are linear. Convert chosen display colours to linear values.
        linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in color[:3]]+[color[3]]
        materials.append({'name':key,'pbrMetallicRoughness':{'baseColorFactor':linear,'metallicFactor':0,'roughnessFactor':.95},'doubleSided':True})
        attrs={'POSITION':accessor(b.pos,'POSITION')}
        if b.norm:attrs['NORMAL']=accessor(b.norm,'NORMAL')
        mesh={'name':key,'primitives':[{'attributes':attrs,'mode':b.mode,'material':len(materials)-1}]}
        meshes.append(mesh);nodes.append({'mesh':len(meshes)-1,'name':key})
    root={'name':'HCMC camera-area street model','translation':list(translation),'children':list(range(len(nodes))),'extras':extras or {}}
    nodes.append(root)
    doc={'asset':{'version':'2.0','generator':'HCMC isolated OSM city builder','copyright':'© OpenStreetMap contributors — ODbL 1.0'},'scene':0,'scenes':[{'nodes':[len(nodes)-1]}],'nodes':nodes,'meshes':meshes,'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
    encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*((-len(encoded))%4);binary+=b'\0'*((-len(binary))%4)
    total=12+8+len(encoded)+8+len(binary)
    with path.open('wb') as f:f.write(struct.pack('<4sII',b'glTF',2,total));f.write(struct.pack('<I4s',len(encoded),b'JSON'));f.write(encoded);f.write(struct.pack('<I4s',len(binary),b'BIN\0'));f.write(binary)
    return {'bytes':total,'vertices':sum(len(b.pos)//3 for b in buffers.values())}

class Extract(osmium.SimpleHandler):
    def __init__(self,bounds):
        super().__init__();self.bounds=bounds;self.roads=[];self.areas=[];self.excluded=Counter();self.errors=Counter();self.factory=osmium.geom.GeoJSONFactory()
    def inside(self,lon,lat):return self.bounds[0]<=lon<=self.bounds[2] and self.bounds[1]<=lat<=self.bounds[3]
    def way(self,w):
        tags=dict(w.tags);kind=tags.get('highway')
        if kind is None:return
        if kind not in WIDTHS:
            if kind in {'construction','proposed','abandoned','razed'} and any(n.location.valid() and self.inside(n.lon,n.lat) for n in w.nodes):self.excluded[kind]+=1
            return
        try:
            coords=[(n.lon,n.lat) for n in w.nodes]
            if not coords:return
            # Bounding-box overlap includes roads crossing the extent with both ends outside.
            xs,ys=zip(*coords)
            if max(xs)<self.bounds[0] or min(xs)>self.bounds[2] or max(ys)<self.bounds[1] or min(ys)>self.bounds[3]:return
            self.roads.append({'id':w.id,'tags':tags,'points':[project(*p) for p in coords],'nodeIds':[n.ref for n in w.nodes]})
        except osmium.InvalidLocationError:self.errors['roadMissingLocation']+=1
    def area(self,a):
        tags=dict(a.tags)
        if tags.get('building') not in (None,'no') and tags.get('building')!='construction':kind='building'
        elif tags.get('natural')=='water' or tags.get('waterway') in {'riverbank','dock'} or tags.get('landuse') in {'reservoir','basin'}:kind='water'
        elif tags.get('leisure') in {'park','garden','golf_course'} or tags.get('landuse') in {'forest','recreation_ground'} or tags.get('natural')=='wood':kind='green'
        else:return
        try:
            rings=list(a.outer_rings())
            if not rings:return
            coords=[(n.lon,n.lat) for ring in rings for n in ring]
            if not coords:return
            xs,ys=zip(*coords)
            if max(xs)<self.bounds[0] or min(xs)>self.bounds[2] or max(ys)<self.bounds[1] or min(ys)>self.bounds[3]:return
            g=shape(json.loads(self.factory.create_multipolygon(a)))
            g=shapely.transform(g,lambda xy:np.column_stack(((xy[:,0]-ORIGIN[0])*SX,-(xy[:,1]-ORIGIN[1])*SY)))
            if not g.is_valid:g=shapely.make_valid(g)
            self.areas.append({'id':a.orig_id(),'sourceType':'way' if a.from_way() else 'relation','kind':kind,'tags':tags,'geometry':g})
        except (osmium.InvalidLocationError,RuntimeError,ValueError) as e:self.errors['areaGeometry']+=1

def face_polygon(buffer,poly,y,ox,oz):
    result=shapely.constrained_delaunay_triangles(poly)
    for tri in result.geoms:
        coords=list(tri.exterior.coords)[:3]
        a,b,c=[(x-ox,y,z-oz) for x,z in coords]
        buffer.triangle(a,b,c,(0,1,0))

def building(buffer,poly,height,base,ox,oz):
    face_polygon(buffer,poly,base+height,ox,oz)
    for ring in [poly.exterior,*poly.interiors]:
        coords=list(ring.coords)
        for (x,z),(u,v) in zip(coords,coords[1:]):
            a=(x-ox,base,z-oz);b=(u-ox,base,v-oz);c=(u-ox,base+height,v-oz);d=(x-ox,base+height,z-oz)
            buffer.triangle(a,b,c);buffer.triangle(a,c,d)

def road_ribbon(buffer,coords,width,height,ox,oz):
    if len(coords)<2:return
    sides=[]
    for i,(x,z) in enumerate(coords):
        a=np.array(coords[max(0,i-1)]);b=np.array(coords[min(len(coords)-1,i+1)]);d=b-a;mag=np.linalg.norm(d)
        if mag<1e-7:d=np.array([1,0]);mag=1
        nx,nz=-d[1]/mag,d[0]/mag
        y=height(x,z)
        sides.append(((x+nx*width/2-ox,y,z+nz*width/2-oz),(x-nx*width/2-ox,y,z-nz*width/2-oz)))
    for (a,b),(c,d) in zip(sides,sides[1:]):
        buffer.triangle(a,c,b);buffer.triangle(b,c,d)
        for p,q in [(a,c),(d,b)]:
            r=(q[0],q[1]-.22,q[2]);s=(p[0],p[1]-.22,p[2]);buffer.triangle(p,q,r);buffer.triangle(p,r,s)


def main():
    global ASSETS
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf',type=Path)
    parser.add_argument('--cameras',type=Path,default=ROOT.parent/'data/derived/camera_locations.json')
    parser.add_argument('--output',type=Path,default=ROOT/'assets')
    parser.add_argument('--source-url',default='https://download.geofabrik.de/asia/vietnam-260918.osm.pbf')
    args=parser.parse_args()
    if not args.pbf.is_file():parser.error(f'OSM PBF not found: {args.pbf}')
    ASSETS=args.output.resolve()
    cameras=json.loads(args.cameras.read_text());valid=[c for c in cameras if isinstance(c.get('lon'),(int,float)) and isinstance(c.get('lat'),(int,float)) and math.isfinite(c['lon']) and math.isfinite(c['lat'])]
    if not valid:parser.error('Camera input has no valid coordinates')
    bounds=[min(c['lon'] for c in valid)-.01,min(c['lat'] for c in valid)-.01,max(c['lon'] for c in valid)+.01,max(c['lat'] for c in valid)+.01]
    west,south=project(bounds[0],bounds[1]);east,north=project(bounds[2],bounds[3]);extent=box(west,north,east,south)
    ASSETS.mkdir(parents=True,exist_ok=True);(ASSETS/'tiles').mkdir(exist_ok=True)
    t=time.time();print('Reading PBF; camera-area bounds',bounds,flush=True)
    handler=Extract(bounds);handler.apply_file(str(args.pbf),locations=True,idx='flex_mem')
    print('Extracted',len(handler.roads),'roads;',len(handler.areas),'areas in',round(time.time()-t),'s',flush=True)
    # Persist source data separately, so the model can be audited without parsing GLB.
    with gzip.open(ASSETS/'features.ndjson.gz','wt') as f:
        for r in handler.roads:f.write(json.dumps({'type':'road',**r},ensure_ascii=False,separators=(',',':'))+'\n')
        for a in handler.areas:f.write(json.dumps({k:v for k,v in a.items() if k!='geometry'},ensure_ascii=False,separators=(',',':'))+'\n')
    tiles={};overview={k:Buffer(1) for k in ['major','street','path']};overview['water']=Buffer();overview['green']=Buffer()
    stats=Counter();roads_index=[];node_heights={}
    for r in handler.roads:
        tags=r['tags']
        if tags.get('bridge') not in (None,'no'):
            elevation=max(1,num(tags.get('layer'),1))*6
            for node in r['nodeIds']:node_heights[node]=max(node_heights.get(node,0),elevation)
    def tile_items(geom):
        minx,minz,maxx,maxz=geom.bounds
        for ix in range(math.floor(minx/TILE),math.floor(maxx/TILE)+1):
            for iz in range(math.floor(minz/TILE),math.floor(maxz/TILE)+1):
                key=f'{ix}_{iz}';cell=box(ix*TILE,iz*TILE,(ix+1)*TILE,(iz+1)*TILE)
                clipped=geom.intersection(cell)
                if clipped.is_empty:continue
                if key not in tiles:tiles[key]={'ix':ix,'iz':iz,'buffers':defaultdict(Buffer),'counts':Counter()}
                yield tiles[key],clipped
    for idx,r in enumerate(handler.roads):
        tags=r['tags'];kind=tags['highway'];points=r['points']
        if len(points)<2:continue
        line=LineString(points)
        if line.length<.1:continue
        cut=line.intersection(extent)
        if cut.is_empty:continue
        width=num(tags.get('width'),None)
        if width is None:
            lane=num(tags.get('lanes'),None)
            width=lane*3.2 if lane and lane>0 else WIDTHS[kind];stats['widthAssumed']+=1
        else:stats['widthTagged']+=1
        width=max(.7,min(40,width));stats['roadWays']+=1;stats['roadLengthMetres']+=cut.length
        major=kind.startswith(('motorway','trunk','primary','secondary'));material='major' if major else 'path' if kind in {'path','footway','cycleway','steps','pedestrian','track'} else 'street'
        bridge=tags.get('bridge') not in (None,'no');tunnel=tags.get('tunnel') not in (None,'no')
        if bridge:stats['bridgeWays']+=1
        if tunnel:stats['tunnelWays']+=1
        y0=node_heights.get(r['nodeIds'][0],0);y1=node_heights.get(r['nodeIds'][-1],0)
        constant=max(1,num(tags.get('layer'),1))*6 if bridge else -max(1,abs(num(tags.get('layer'),-1)))*5 if tunnel else None
        def height(x,z):
            if constant is not None:return .3+constant
            if y0 or y1:
                s=line.project(shapely.Point(x,z));return .3+max(y0*max(0,1-s/70),y1*max(0,1-(line.length-s)/70))
            return .3
        for segment in lines(cut):
            simple=list(segment.simplify(2).coords)
            if not tunnel:
                for a,b in zip(simple,simple[1:]):overview[material].line((a[0],3,a[1]),(b[0],3,b[1]))
        for tile,clipped in tile_items(cut):
            key='bridge' if bridge else 'tunnel' if tunnel else material
            for segment in lines(clipped):road_ribbon(tile['buffers'][key],list(segment.coords),width,height,tile['ix']*TILE,tile['iz']*TILE)
            tile['counts']['roads']+=1
        if tags.get('name'):
            p=cut.interpolate(.5,normalized=True);roads_index.append({'id':r['id'],'name':tags['name'],'x':round(p.x,1),'z':round(p.y,1),'highway':kind})
        if idx%10000==0:print('Meshed roads',idx,'tiles',len(tiles),flush=True)
    print('Meshing buildings and water',flush=True)
    for idx,a in enumerate(handler.areas):
        g=a['geometry'].intersection(extent)
        if g.is_empty:continue
        kind=a['kind'];tags=a['tags'];stats[kind+'Features']+=1
        height=num(tags.get('height'),None);tagged=height is not None
        if height is None:
            levels=num(tags.get('building:levels'),None);height=levels*3.2 if levels else 10.5;tagged=levels is not None
        height=max(2,min(500,height));base=max(0,num(tags.get('min_height'),0))
        if kind=='building':stats['buildingHeightTagged' if tagged else 'buildingHeightAssumed']+=1
        material='building-tagged' if kind=='building' and tagged else kind
        if kind!='building':
            for poly in polygons(g.simplify(2,preserve_topology=True)):
                if poly.area>.1:face_polygon(overview[kind],poly,-.12 if kind=='water' else .01,0,0)
        for tile,clipped in tile_items(g):
            for poly in polygons(clipped):
                if poly.area<.1:continue
                if kind=='building':building(tile['buffers'][material],poly,height,base+.08,tile['ix']*TILE,tile['iz']*TILE)
                else:face_polygon(tile['buffers'][material],poly,-.12 if kind=='water' else .01,tile['ix']*TILE,tile['iz']*TILE)
            tile['counts'][kind]+=1
        if idx%10000==0:print('Meshed areas',idx,flush=True)
    manifest={'title':'HCMC · city streets','extentDescription':'Bounding rectangle of the supplied HCMC camera locations, plus 0.01 degrees (~1.1 km) on each side; not the municipal administrative boundary.','boundsLonLat':bounds,'boundsXZ':[west,north,east,south],'originLonLat':ORIGIN,'coordinates':'Local metres: X east, Y up, Z south; equirectangular projection at origin latitude.','tileSizeMetres':TILE,'source':{'url':args.source_url,'sha256':file_sha256(args.pbf),'bytes':args.pbf.stat().st_size,'attribution':'© OpenStreetMap contributors','license':'ODbL 1.0','licenseUrl':'https://www.openstreetmap.org/copyright'},'builtAt':datetime.now(timezone.utc).isoformat(),'cameraCount':len(valid),'statistics':dict(stats),'excludedHighways':dict(handler.excluded),'geometryErrors':dict(handler.errors),'assumptions':['Road alignments and building footprints are OSM-derived, not surveyed here.','Road widths use OSM width where present, otherwise lanes × 3.2 m or class defaults.','Building heights use height, levels × 3.2 m, or a 10.5 m default.','Bridge decks use 6 m per OSM layer with schematic 70 m approach ramps; not measured elevation.','Tunnels are modelled below the ground plane and are normally hidden.','Terrain is flat; no junction turning simulation, traffic or CCTV capture is running.','Coverage reflects OSM completeness. Missing buildings are not proof of empty land.','Overview road lines are simplified by up to 2 m for display; detailed road tiles use original centreline vertices.'],'overview':{},'tiles':[]}
    manifest['overview']={'url':'assets/overview.glb',**write_glb(ASSETS/'overview.glb',overview,extras={'purpose':'whole-city overview','license':'ODbL 1.0'})}
    for i,(key,tile) in enumerate(sorted(tiles.items())):
        relative=f'assets/tiles/{key}.glb';out=write_glb(ASSETS/'tiles'/f'{key}.glb',tile['buffers'],(tile['ix']*TILE,0,tile['iz']*TILE),{'tile':key,'source':'OpenStreetMap','originLonLat':ORIGIN,'assumptions':manifest['assumptions']})
        manifest['tiles'].append({'id':key,'url':relative,'bounds':[tile['ix']*TILE,tile['iz']*TILE,(tile['ix']+1)*TILE,(tile['iz']+1)*TILE],'counts':dict(tile['counts']),**out})
        if i%50==0:print('Wrote tile',i,'/',len(tiles),flush=True)
    manifest['totalModelBytes']=manifest['overview']['bytes']+sum(t['bytes'] for t in manifest['tiles'])
    (ASSETS/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    unique={}
    for r in roads_index:unique.setdefault(r['name'],r)
    (ASSETS/'streets.json').write_text(json.dumps(sorted(unique.values(),key=lambda r:r['name']),ensure_ascii=False,separators=(',',':')))
    (ASSETS/'cameras.json').write_text(json.dumps([{**c,'x':project(c['lon'],c['lat'])[0],'z':project(c['lon'],c['lat'])[1]} for c in valid],ensure_ascii=False,separators=(',',':')))
    print('DONE',dict(stats),'tiles',len(tiles),'model MB',round(manifest['totalModelBytes']/1e6,1),'seconds',round(time.time()-t),flush=True)

if __name__=='__main__':main()
