"""Run: python -m pytest -q test_api.py"""
import pytest
from fastapi.testclient import TestClient

from api import app

client = TestClient(app)


def test_health():
    r = client.get('/healthz')
    assert r.status_code == 200
    assert r.json()['records_loaded'] == 720


def test_dataset_integrity_and_stats():
    assert client.get('/api/v1/dataset/validate').json()['valid'] is True
    assert client.get('/api/v1/dataset/stats').json()['total'] == 720


def test_analyze_and_no_retention():
    payload = {'text': 'Взнос 5 000 ₸, выплата 10 000 ₸, пригласи 2 участников.'}
    r = client.post('/api/v1/analyze', json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['data_retained'] is False
    assert body['analysis']['fingerprint']['deposit_kzt'] == 5000
    assert body['analysis']['fingerprint']['promised_payout_kzt'] == 10000
    assert body['analysis']['risk_label'] in ('low', 'medium', 'high')


def test_compare_and_caution():
    r = client.post('/api/v1/compare', json={
        'left': {'text': 'Взнос 5 000 ₸, выплата 10 000 ₸, пригласи 2 участников.'},
        'right': {'text': '5 000 теңге жарна, 10 000 теңге төлем, 2 адам шақыр.'},
    })
    assert r.status_code == 200, r.text
    assert r.json()['comparison']['similarity'] > 0.6
    assert r.json()['comparison']['shared_features']


def test_batch_and_limits():
    r = client.post('/api/v1/analyze/batch', json={'texts': [
        {'text': 'Взнос 5 000 ₸, выплата 10 000 ₸'},
        {'text': 'Оплата товара 5 000 ₸ за доставку'},
    ]})
    assert r.status_code == 200
    assert len(r.json()['results']) == 2
    bad = client.post('/api/v1/analyze', json={'text': '  '})
    assert bad.status_code == 422
    too_long = client.post('/api/v1/analyze', json={'text': 'x' * 10001})
    assert too_long.status_code == 422


def test_records_and_not_found():
    r = client.get('/api/v1/records', params={'split': 'test', 'risk': 'high', 'page_size': 5})
    assert r.status_code == 200
    assert r.json()['total'] == 48
    assert len(r.json()['items']) == 5
    assert client.get('/api/v1/records/MISSING').status_code == 404
    assert client.get('/api/v1/records/PDNA-0001').status_code == 200


def test_neighbors_and_search():
    r = client.get('/api/v1/records/PDNA-0001/neighbors', params={'top_k': 3})
    assert r.status_code == 200
    assert len(r.json()['neighbors']) <= 3
    assert all(x['id'] != 'PDNA-0001' for x in r.json()['neighbors'])
    r = client.post('/api/v1/search/similar', json={
        'text': 'Взнос 5 000 ₸, выплата 10 000 ₸, пригласи 2 участников', 'top_k': 3,
    })
    assert r.status_code == 200
    assert len(r.json()['neighbors']) <= 3


def test_evaluate():
    r = client.get('/api/v1/evaluate', params={'split': 'test'})
    assert r.status_code == 200
    assert r.json()['risk_classification']['count'] == 144
    assert 'pair_precision' in r.json()['mechanism_similarity']


def test_bad_query():
    assert client.get('/api/v1/records', params={'page_size': 9999}).status_code == 422
    assert client.post('/api/v1/search/similar', json={'text': 'ok!', 'top_k': 200}).status_code == 422
