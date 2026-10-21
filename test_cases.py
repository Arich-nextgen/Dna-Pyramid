import hashlib
from fastapi.testclient import TestClient
from api import app

def test_case_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setenv('PYRAMID_DNA_CASE_DB', str(tmp_path / 'cases.sqlite3'))
    c = TestClient(app)
    text = 'Взнос 5 000 ₸, выплата 10 000 ₸, пригласи 2 участников.'
    body = {'title':'Проверка', 'text':text, 'source_type':'synthetic'}
    assert c.get('/api/v1/cases').json()['items'] == []
    assert c.post('/api/v1/analyze',json={'text':text}).status_code == 200
    assert c.get('/api/v1/cases').json()['items'] == []
    r = c.post('/api/v1/cases',json=body)
    assert r.status_code == 201
    item = r.json()
    assert item['sha256'] == hashlib.sha256(text.encode()).hexdigest()
    assert item['analysis']['fingerprint']['deposit_kzt'] == 5000
    route = '/api/v1/cases/' + item['id']
    assert c.get(route).json()['text'] == text
    assert len(c.get('/api/v1/cases').json()['items']) == 1
    updated = c.put(route,json={**body,'notes':'Проверено','status':'reviewing','text':'Оплата товара 5 000 ₸'})
    assert updated.status_code == 200
    assert updated.json()['created_at'] == item['created_at']
    assert updated.json()['analysis']['risk_label'] == 'low'
    assert updated.json()['sha256'] != item['sha256']
    assert c.delete(route).status_code == 204
    assert c.get(route).status_code == 404
    assert c.put(route,json=body).status_code == 404
    assert c.delete(route).status_code == 404

def test_case_validation_and_auth(tmp_path,monkeypatch):
    monkeypatch.setenv('PYRAMID_DNA_CASE_DB', str(tmp_path/'cases.sqlite3'))
    c=TestClient(app)
    assert c.post('/api/v1/cases',json={'title':' ', 'text':'   '}).status_code == 422
    assert c.post('/api/v1/cases',json={'title':'Test', 'text':'x'*10001}).status_code == 422
    assert c.post('/api/v1/cases',json={'title':'Test', 'text':'text','source_type':'illegal'}).status_code == 422
    import api
    monkeypatch.setattr(api,'API_KEY','test-key')
    assert c.get('/api/v1/cases').status_code == 401
    assert c.get('/api/v1/cases',headers={'X-API-Key':'test-key'}).status_code == 200

def test_full_workflow_and_edge_cases(tmp_path, monkeypatch):
    monkeypatch.setenv('PYRAMID_DNA_CASE_DB',str(tmp_path/'workflow.sqlite3'))
    c=TestClient(app)
    text='Взнос 40 000 ₸, выплата 60 000 ₸ через 7 дней. Пригласи 5 участников.'
    a=c.post('/api/v1/analyze',json={'text':text}).json()['analysis']
    assert a['risk_points']==60
    assert a['fingerprint']['period_days']==7
    matches=c.post('/api/v1/search/similar',json={'text':text}).json()['neighbors']
    assert len(matches)==10
    kz=next(n for n in matches if n['language']=='kk')
    record=c.get('/api/v1/records/'+kz['id']).json()
    comp=c.post('/api/v1/compare',json={'left':{'text':text},'right':{'text':record['record']['text']}}).json()
    assert comp['comparison']['similarity']==1
    created=c.post('/api/v1/cases',json={'title':'Синтетическое демо','text':text,'source_type':'synthetic'}).json()
    assert c.get('/api/v1/cases/'+created['id']).json()['analysis']==a
    assert c.get('/api/v1/evaluate?split=test').json()['risk_classification']['count']==144
    assert c.post('/api/v1/analyze',json={'text':''}).status_code==422
    assert c.post('/api/v1/analyze',json={'text':'x'*10000}).status_code==200
    assert c.post('/api/v1/analyze',json={'text':'x'*10001}).status_code==422
    for text in ['Бүгін ауа райы жақсы.', 'В чате: 40 000 ₸ салым, 60 000 ₸ пайда, 5 адам шақыру.', 'Оплата товара 5 000 ₸']:
        assert c.post('/api/v1/analyze',json={'text':text}).status_code==200
    assert c.post('/api/v1/search/similar',json={'text':'Никаких денежных предложений здесь нет.'}).json()['neighbors']==[]
    assert c.get('/api/v1/records?q=zzzzzzz-no-match').json()['total']==0
