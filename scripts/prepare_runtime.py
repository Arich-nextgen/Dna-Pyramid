from pathlib import Path
import concurrent.futures, json, shutil, urllib.request, time, hashlib
project=Path(__file__).resolve().parent.parent
runtime=project/'frontend/public/runtime'
node=project/'frontend/node_modules/pyodide'
for name in ['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']:
 shutil.copyfile(node/name,runtime/name)
for name in ['api.py','cases.py','pyramid_dna_engine.py','safenet_kz_pyramid_dna_dataset.jsonl']:
 shutil.copyfile(project/name,runtime/name)
artifact_target=runtime/'artifacts'; artifact_target.mkdir(exist_ok=True)
for name in ['benchmark_results.json','public_challenge_results.json']:
 shutil.copyfile(project/'artifacts'/name,artifact_target/name)
lock=json.loads((node/'pyodide-lock.json').read_text())['packages']
seen=set()
def walk(key):
 key=key.replace('_','-')
 if key in seen:return
 seen.add(key)
 for dependency in lock[key].get('depends',[]):walk(dependency)
walk('fastapi');walk('sqlite3')
packages=[lock[k] for k in sorted(seen)]
def fetch(package):
 name=package['file_name']; target=runtime/name
 if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==package['sha256']:return name
 for attempt in range(4):
  try:
   with urllib.request.urlopen('https://cdn.jsdelivr.net/pyodide/v0.29.3/full/'+name, timeout=30) as r:data=r.read()
   if hashlib.sha256(data).hexdigest()!=package['sha256']:raise RuntimeError('Checksum mismatch: '+name)
   target.write_bytes(data);return name
  except Exception:
   if attempt==3:raise
   time.sleep(1)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for name in pool.map(fetch,packages):print('verified',name,flush=True)
print('runtime prepared',sum(f.stat().st_size for f in runtime.iterdir()),'bytes')
