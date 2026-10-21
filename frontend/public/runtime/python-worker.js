/* Original FastAPI + Python engine executed in a dedicated browser worker. */
let ready;
let queue=Promise.resolve();
const root=new URL('.',self.location).href;
async function sync(py,populate){await new Promise((resolve,reject)=>py.FS.syncfs(populate,error=>error?reject(error):resolve()));}
async function initialize(){
 importScripts(root+'pyodide.js');
 const py=await loadPyodide({indexURL:root});
 await py.loadPackage(['fastapi','sqlite3']);
 py.FS.mkdirTree('/project');py.FS.mkdirTree('/project/artifacts');py.FS.mkdirTree('/persist');
 py.FS.mount(py.FS.filesystems.IDBFS,{},'/persist');
 await sync(py,true);
 for(const file of ['api.py','cases.py','pyramid_dna_engine.py','safenet_kz_pyramid_dna_dataset.jsonl','artifacts/benchmark_results.json','artifacts/public_challenge_results.json']){
  const response=await fetch(root+file);if(!response.ok)throw new Error('Не загружен файл Python: '+file);
  py.FS.writeFile('/project/'+file,await response.text());
 }
 const bridge=await fetch(root+'asgi_bridge.py');if(!bridge.ok)throw new Error('Не загружен адаптер FastAPI.');
 await py.runPythonAsync(await bridge.text());
 return py;
}
self.onmessage=event=>{
 const request=event.data;
 queue=queue.then(async()=>{
  try{
   if(!ready)ready=initialize().catch(error=>{ready=undefined;throw error;});
   const py=await ready;
   py.globals.set('_request_json',JSON.stringify(request));
   const answer=JSON.parse(await py.runPythonAsync('await dispatch_request(_request_json)'));
   if(request.path.startsWith('/api/v1/cases')&&['POST','PUT','DELETE'].includes(request.method)&&answer.status<400){await sync(py,false);}
   self.postMessage({id:request.id,...answer});
  }catch(error){self.postMessage({id:request.id,status:500,error:'Python не выполнил запрос: '+String(error.message||error)+'. Повторите попытку или обновите страницу.'});}
 });
};
