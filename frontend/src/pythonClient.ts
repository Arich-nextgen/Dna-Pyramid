let worker: Worker | undefined;
let counter=0;
const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function getWorker(){
 if(worker)return worker;
 worker=new Worker(new URL('/runtime/python-worker.js',location.origin));
 worker.onmessage=(event:MessageEvent<{id:number;status:number;data:unknown;error?:string}>)=>{
  const p=pending.get(event.data.id);if(!p)return;pending.delete(event.data.id);clearTimeout(p.timer);
  if(event.data.error){p.reject(new Error(event.data.error));return;}
  if(event.data.status>=400){const status=event.data.status;const messages:Record<number,string>={401:'Доступ к материалу запрещён.',404:'Материал не найден.',422:'Проверьте данные. Текст должен содержать от 3 до 10 000 символов.'};p.reject(new Error(messages[status]??'Не удалось выполнить запрос к Python.'));return;}
  p.resolve(event.data.data);
 };
 worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Не удалось загрузить Python. Проверьте соединение и перезагрузите страницу.'));}pending.clear();worker?.terminate();worker=undefined;};
 return worker;
}
export function pythonRequest<T>(path:string,body?:unknown,method?:string):Promise<T>{
 return new Promise((resolve,reject)=>{
  const id=++counter;
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Python не ответил вовремя. При первом запуске загружается среда Python. Проверьте соединение и повторите.'));},120000);
  pending.set(id,{resolve:v=>resolve(v as T),reject,timer});
  getWorker().postMessage({id,path:path.startsWith('/health')?path:'/api/v1'+path,body,method:method??(body?'POST':'GET')});
 });
}
