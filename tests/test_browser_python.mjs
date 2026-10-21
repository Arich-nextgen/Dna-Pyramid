import {loadPyodide} from '../frontend/node_modules/pyodide/pyodide.mjs';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('frontend/public/runtime');
const py=await loadPyodide({indexURL:root+path.sep});
await py.loadPackage(['fastapi','sqlite3']);
py.FS.mkdirTree('/project');py.FS.mkdirTree('/persist');
for(const file of ['api.py','cases.py','pyramid_dna_engine.py','safenet_kz_pyramid_dna_dataset.jsonl'])py.FS.writeFile('/project/'+file,fs.readFileSync(path.join(root,file)));
py.FS.mkdirTree('/project/artifacts');
for(const file of ['benchmark_results.json','public_challenge_results.json'])py.FS.writeFile('/project/artifacts/'+file,fs.readFileSync(path.join(root,'artifacts',file)));
await py.runPythonAsync(fs.readFileSync(path.join(root,'asgi_bridge.py'),'utf8'));
async function request(url,body,method=body?'POST':'GET'){
 py.globals.set('_request_json',JSON.stringify({path:url,method,...(body?{body}:{})}));
 return JSON.parse(await py.runPythonAsync('await dispatch_request(_request_json)'));
}
function assert(condition,message){if(!condition)throw new Error(message);}
let r=await request('/healthz');assert(r.data.records_loaded===720,'health');
const text='Взнос 40 000 ₸, выплата 60 000 ₸ через 7 дней. Пригласи 5 участников.';
r=await request('/api/v1/analyze',{text});assert(r.status===200,'analyze status '+JSON.stringify(r));assert(r.data.analysis.risk_points===60,'risk');assert(r.data.analysis.evidence_spans.every(s=>text.slice(s.start,s.end)===s.text),'exact evidence spans');assert(r.data.analysis.risk_breakdown.factors.reduce((n,x)=>n+x.points,0)===r.data.analysis.risk_points,'risk breakdown');
r=await request('/api/v1/search/similar',{text});assert(r.data.neighbors.length===10,'search');
const kz=r.data.neighbors.find(n=>n.language==='kk');
r=await request('/api/v1/compare',{left:{text},right:{text:kz.text}});assert(r.data.comparison.similarity===1,'compare');assert(Math.abs(r.data.comparison.feature_comparison.reduce((n,x)=>n+x.normalized_contribution,0)-r.data.comparison.similarity)<1e-7,'comparison contributions sum');
r=await request('/api/v1/cases',{title:'Pyodide test',text,source_type:'synthetic'});assert(r.status===201,'create '+JSON.stringify(r));const id=r.data.id;
r=await request('/api/v1/cases/'+id);assert(r.data.sha256?.length===64,'saved hash');
r=await request('/api/v1/cases/'+id,{title:'Edited',text,source_type:'synthetic',notes:'Saved from WASM',status:'reviewing'},'PUT');assert(r.status===200&&r.data.notes==='Saved from WASM','edit');
r=await request('/api/v1/cases/'+id,undefined,'DELETE');assert(r.status===204,'delete');
r=await request('/api/v1/evaluate?split=test');assert(r.data.risk_classification.count===144,'evaluation');
r=await request('/api/v1/quality/benchmark');assert(r.data.test_metrics_once.dna.fpr===1,'benchmark artifact');
r=await request('/api/v1/quality/public-challenge');assert(r.data.extraction_coverage.correct_checks===45,'public challenge artifact');
r=await request('/api/v1/analyze',{text:' '});assert(r.status===422,'blank input');
r=await request('/api/v1/records?q=not-present-zzzz');assert(r.data.total===0,'empty records');
console.log('PASS: Original FastAPI in Python/WASM: health, analysis/spans/risk factors, search, compare/contributions, SQLite CRUD, evaluation, quality artifacts, validation, empty results');
