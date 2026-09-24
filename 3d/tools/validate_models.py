"""Check every generated GLB, its manifest entry and camera coverage."""
import argparse
import json
from pathlib import Path
import struct
import numpy as np

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--assets',type=Path,default=root/'assets')
assets=parser.parse_args().assets.resolve()
manifest=json.loads((assets/'manifest.json').read_text())
total=0
triangles=0
for entry in [manifest['overview'],*manifest['tiles'],*([manifest['skyline']] if 'skyline' in manifest else [])]:
    relative=Path(entry['url']).relative_to('assets')
    assert '..' not in relative.parts
    raw=(assets/relative).read_bytes()
    magic,version,length=struct.unpack_from('<4sII',raw)
    assert (magic,version,length)==(b'glTF',2,len(raw)),entry['url']
    assert len(raw)==entry['bytes']
    total+=len(raw)
    size,kind=struct.unpack_from('<I4s',raw,12)
    assert kind==b'JSON'
    doc=json.loads(raw[20:20+size])
    binary_size,kind=struct.unpack_from('<I4s',raw,20+size)
    assert kind==b'BIN\0'
    binary=memoryview(raw)[28+size:]
    assert len(binary)==binary_size==doc['buffers'][0]['byteLength']
    def data(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        assert a['componentType']==5126 and a['type']=='VEC3'
        assert v['byteOffset']+v['byteLength']<=len(binary)
        arr=np.frombuffer(binary,dtype='<f4',count=a['count']*3,offset=v['byteOffset']).reshape(-1,3)
        assert np.isfinite(arr).all(),entry['url']
        if 'min' in a:
            assert np.allclose(arr.min(axis=0),a['min'])
            assert np.allclose(arr.max(axis=0),a['max'])
        return arr
    vertices=0
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            pos=data(p['attributes']['POSITION']);vertices+=len(pos)
            if p['mode']==4:
                assert len(pos)%3==0
                norms=data(p['attributes']['NORMAL'])
                assert len(norms)==len(pos)
                assert np.allclose(np.linalg.norm(norms,axis=1),1,atol=1e-5)
                faces=pos.reshape(-1,3,3)
                cross=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0])
                # Small triangles can collapse under float32 quantization.
                valid=np.linalg.norm(cross,axis=1)>1e-5
                assert (np.sum(cross[valid]*norms[::3][valid],axis=1)>=-1e-5).all(),(entry['url'],mesh['name'],'winding')
                triangles+=len(faces)
            else:assert p['mode']==1 and len(pos)%2==0
    assert vertices==entry['vertices']
assert total==manifest['totalModelBytes']
cameras=json.loads((assets/'cameras.json').read_text())
assert len(cameras)==manifest['cameraCount'] and len(cameras)>0
w,s,e,n=manifest['boundsLonLat']
assert all(w<=c['lon']<=e and s<=c['lat']<=n for c in cameras)
assert len(manifest['tiles'])==len(set(t['id'] for t in manifest['tiles']))
assert len(manifest['tiles'])>0
print(json.dumps({'glbFiles':len(manifest['tiles'])+1+int('skyline' in manifest),'triangles':triangles,'bytes':total,'camerasCovered':len(cameras),'geometryErrors':manifest['geometryErrors']},indent=2))
