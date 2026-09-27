"""Build the viewer's startup layer from the whole-city overview (no OSM fetch).

The viewer hides every overview road line, yet the lines are about 80% of
overview.glb. The base layer keeps what the viewer draws (water, green) and,
of the major and street lines, only the vertices city-lighting.js samples as
street-lamp candidates -- every ceil(n/1500)th -- so lamps land where they did.
overview.glb stays whole as the downloadable model.
"""
import argparse
from array import array
import json
import math
from pathlib import Path
import struct
import numpy as np
from build import Buffer, write_glb

LAMP_SAMPLES=1500   # city-lighting.js: stride = ceil(count / 1500)


def generate(assets):
    assets=Path(assets)
    manifest=json.loads((assets/'manifest.json').read_text())
    raw=(assets/Path(manifest['overview']['url']).relative_to('assets')).read_bytes()
    size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]);binary=memoryview(raw)[28+size:]
    root=doc['nodes'][doc['scenes'][0]['nodes'][0]]
    def values(index):
        accessor=doc['accessors'][index];view=doc['bufferViews'][accessor['bufferView']]
        assert accessor['componentType']==5126 and accessor['type']=='VEC3'
        return np.frombuffer(binary,dtype='<f4',count=accessor['count']*3,offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)).reshape(-1,3)
    buffers={}
    for mesh in doc['meshes']:
        name=mesh['name'];[primitive]=mesh['primitives']
        positions=values(primitive['attributes']['POSITION'])
        if name in ('water','green'):
            buffer=buffers[name]=Buffer()
            buffer.pos.extend(array('f',positions.astype('<f4').tobytes()))
            buffer.norm.extend(array('f',values(primitive['attributes']['NORMAL']).astype('<f4').tobytes()))
        elif name in ('major','street'):
            sampled=positions[::max(1,math.ceil(len(positions)/LAMP_SAMPLES))]
            # Line segments need pairs; a repeated last vertex falls in the same lamp cell.
            if len(sampled)%2:sampled=np.vstack([sampled,sampled[-1:]])
            buffer=buffers[name]=Buffer(1)
            buffer.pos.extend(array('f',sampled.astype('<f4').tobytes()))
    result=write_glb(assets/'overview-base.glb',buffers,root.get('translation',(0,0,0)),extras={'purpose':'Viewer startup layer: overview water and green, plus street-lamp samples of its road lines','license':'ODbL 1.0'})
    manifest['totalModelBytes']-=manifest.get('overviewBase',{}).get('bytes',0)
    manifest['overviewBase']={'url':'assets/overview-base.glb',**result}
    manifest['totalModelBytes']+=result['bytes']
    (assets/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('Overview base:',result['bytes'],'bytes, from',manifest['overview']['bytes'],flush=True)
    return manifest['overviewBase']

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,default=Path(__file__).resolve().parents[1]/'assets')
    args=parser.parse_args();generate(args.assets)
