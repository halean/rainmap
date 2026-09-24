"""Build a persistent high-rise layer from existing detailed GLBs (no OSM fetch)."""
import argparse
from array import array
import json
from pathlib import Path
import struct
import numpy as np
from build import Buffer, COLORS, write_glb


def generate(assets, minimum_height=40):
    assets=Path(assets)
    manifest=json.loads((assets/'manifest.json').read_text())
    buffers={}; height=0; tile_ids=[]
    for tile in manifest['tiles']:
        raw=(assets/Path(tile['url']).relative_to('assets')).read_bytes()
        size=struct.unpack_from('<I',raw,12)[0]
        doc=json.loads(raw[20:20+size]);binary=memoryview(raw)[28+size:]
        translation=doc['nodes'][doc['scenes'][0]['nodes'][0]].get('translation',[0,0,0])
        def values(index):
            accessor=doc['accessors'][index];view=doc['bufferViews'][accessor['bufferView']]
            assert accessor['componentType']==5126 and accessor['type']=='VEC3'
            return np.frombuffer(binary,dtype='<f4',count=accessor['count']*3,offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)).reshape(-1,3)
        for mesh in doc['meshes']:
            if not mesh['name'].startswith('building'):continue
            for primitive in mesh['primitives']:
                assert primitive['mode']==4 and 'indices' not in primitive
                triangles=values(primitive['attributes']['POSITION']).reshape(-1,3,3)
                # These GLBs contain extruded buildings: both wall triangles touch
                # the roof. Retain roofs and complete walls, not just roof caps.
                keep=triangles[:,:,1].max(axis=1)+translation[1]>=minimum_height
                if not keep.any():continue
                positions=triangles[keep].reshape(-1,3).copy();positions+=np.asarray(translation,dtype=np.float32)
                normals=values(primitive['attributes']['NORMAL']).reshape(-1,3,3)[keep].reshape(-1,3)
                name=f"building-skyline__{tile['id']}__{mesh['name']}"
                COLORS[name]=COLORS[mesh['name']]
                buffer=buffers.setdefault(name,Buffer())
                buffer.pos.extend(array('f',positions.astype('<f4').tobytes()))
                buffer.norm.extend(array('f',normals.astype('<f4').tobytes()))
                height=max(height,float(positions[:,1].max()))
                if tile['id'] not in tile_ids:tile_ids.append(tile['id'])
    result=write_glb(assets/'skyline.glb',buffers,extras={'purpose':'Persistent high-rise skyline; hidden per tile when detail is present','minimumHeightMetres':minimum_height})
    manifest['totalModelBytes']-=manifest.get('skyline',{}).get('bytes',0)
    manifest['skyline']={'url':'assets/skyline.glb',**result,'minimumHeightMetres':minimum_height,'maximumHeightMetres':height,'tileIds':tile_ids}
    manifest['totalModelBytes']+=result['bytes']
    (assets/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('Skyline:',len(tile_ids),'tiles;',result['bytes'],'bytes; maximum height',height,flush=True)
    return manifest['skyline']

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,default=Path(__file__).resolve().parents[1]/'assets')
    args=parser.parse_args();generate(args.assets)
