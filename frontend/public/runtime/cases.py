"""Explicit, local case retention, separate from the synthetic dataset."""
from contextlib import contextmanager
import hashlib
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pyramid_dna_engine import analyze

class CaseInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=3, max_length=10000)
    source_type: Literal['public', 'voluntary', 'synthetic', 'other'] = 'other'
    source_url: str = Field(default='', max_length=2000)
    notes: str = Field(default='', max_length=10000)
    status: Literal['new', 'reviewing', 'closed'] = 'new'

@contextmanager
def connect():
    path = Path(os.environ.get('PYRAMID_DNA_CASE_DB', str(Path(__file__).with_name('cases.sqlite3'))))
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL)')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def unpack(row):
    return dict(id=row['id'], created_at=row['created_at'], **json.loads(row['payload']))

def case_router(dependency):
    from fastapi import Depends
    router = APIRouter(prefix='/api/v1/cases', dependencies=[Depends(dependency)])
    @router.get('')
    def listing():
        with connect() as db:
            return {'items': [unpack(r) for r in db.execute('SELECT * FROM cases ORDER BY created_at DESC')]}
    @router.post('', status_code=201)
    def create(payload: CaseInput):
        return save(str(uuid.uuid4()), payload, True)
    def save(case_id, payload, new=False):
        data = payload.model_dump()
        if not payload.text.strip() or not payload.title.strip():
            raise HTTPException(422, 'Title and text must not be blank')
        data.update(sha256=hashlib.sha256(payload.text.encode()).hexdigest(), analysis=analyze(payload.text))
        with connect() as db:
            row = db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
            if not new and not row:
                raise HTTPException(404, 'Case not found')
            created = datetime.now(timezone.utc).isoformat() if new else row['created_at']
            db.execute('INSERT OR REPLACE INTO cases VALUES (?, ?, ?)', (case_id, created, json.dumps(data, ensure_ascii=False)))
        return dict(id=case_id, created_at=created, **data)
    @router.get('/{case_id}')
    def get(case_id: str):
        with connect() as db:
            row = db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
        if not row: raise HTTPException(404, 'Case not found')
        return unpack(row)
    @router.put('/{case_id}')
    def update(case_id: str, payload: CaseInput):
        return save(case_id, payload)
    @router.delete('/{case_id}', status_code=204)
    def delete(case_id: str):
        with connect() as db:
            if not db.execute('DELETE FROM cases WHERE id=?', (case_id,)).rowcount:
                raise HTTPException(404, 'Case not found')
    return router
