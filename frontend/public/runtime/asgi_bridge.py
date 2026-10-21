"""ASGI transport for the unchanged application in Pyodide, not an analysis substitute."""
import os
import sys
import json
from urllib.parse import urlsplit
sys.path.insert(0, '/project')
os.environ['PYRAMID_DNA_CASE_DB']='/persist/cases.sqlite3'
# WebWorkers already isolate synchronous work. Pyodide cannot spawn OS threads.
async def inline_threadpool(func, *args, **kwargs):
    return func(*args, **kwargs)
import starlette.concurrency
import starlette.routing
import fastapi.routing
import fastapi.dependencies.utils
starlette.concurrency.run_in_threadpool=inline_threadpool
starlette.routing.run_in_threadpool=inline_threadpool
fastapi.routing.run_in_threadpool=inline_threadpool
fastapi.dependencies.utils.run_in_threadpool=inline_threadpool
from api import app

async def dispatch_request(raw):
    request=json.loads(raw)
    url=urlsplit(request['path'])
    body=json.dumps(request.get('body'),ensure_ascii=False).encode() if 'body' in request else b''
    events=[]
    sent=False
    async def receive():
        nonlocal sent
        if not sent:
            sent=True
            return {'type':'http.request','body':body,'more_body':False}
        return {'type':'http.disconnect'}
    async def send(event):
        events.append(event)
    scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1',
           'method':request.get('method','GET'),'scheme':'https','path':url.path,
           'raw_path':url.path.encode(),'query_string':url.query.encode(),'root_path':'',
           'headers':[(b'content-type',b'application/json')],'server':('python.local',443),'client':('browser',0)}
    await app(scope,receive,send)
    status=next(e['status'] for e in events if e['type']=='http.response.start')
    output=b''.join(e.get('body',b'') for e in events if e['type']=='http.response.body')
    return json.dumps({'status':status,'data':json.loads(output) if output else None},ensure_ascii=False)
