#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deterministic external extraction coverage evaluation; no tuning or training.

Run:
  python scripts/eval_public_challenge.py --engine pyramid_dna_engine.py \
      --data data/public_cases_challenge.jsonl \
      --out artifacts/public_challenge_results.json
"""
import argparse
import hashlib
import importlib.util
import json
from collections import defaultdict
from pathlib import Path
import sys
from datetime import datetime, timezone

SUPPORTED_BINARY={'needs_deposit','has_return_claim','has_recruitment','has_guarantee_claim'}
SUPPORTED_NUMERIC={'period_days','deposit_kzt'}

def load_engine(path):
    if not path.is_file():
        raise SystemExit(f'Engine not found: {path}. Pass --engine PATH.');
    spec=importlib.util.spec_from_file_location('pyramid_dna_engine_external_challenge',path)
    mod=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=mod
    spec.loader.exec_module(mod)
    if not callable(getattr(mod,'analyze',None)):
        raise SystemExit('Engine does not expose analyze(text).')
    return mod

def evaluate(engine, records, data_sha256):
    feats=defaultdict(lambda:{'correct':0,'evaluated':0,'failures':[]})
    case_reports=[]
    seen=set()
    for r in records:
        if r['id'] in seen:raise ValueError('Duplicate id '+r['id'])
        seen.add(r['id'])
        if r.get('used_for_training') or r.get('used_for_threshold_tuning'):
            raise ValueError('Challenge contamination flag '+r['id'])
        if r.get('text_kind')!='researcher_authored_factual_paraphrase' or r.get('original_message') is not False:
            raise ValueError('Incorrect provenance '+r['id'])
        output=engine.analyze(r['text'])
        fp=output.get('fingerprint',{})
        evals=[]
        for k,v in r['expected_features'].items():
            if k not in SUPPORTED_BINARY:raise ValueError(f'Unsupported binary {k} in {r["id"]}')
            if v is not True:raise ValueError(f'Only explicitly supported gold-positive annotations allowed: {r["id"]}/{k}')
            actual=fp.get(k)
            ok=actual is True
            feats[k]['evaluated']+=1
            feats[k]['correct']+=int(ok)
            if not ok:feats[k]['failures'].append(r['id'])
            evals.append({'feature':k,'expected':v,'observed':actual,'correct':ok,'kind':'binary_explicit_positive'})
        for k,v in r.get('expected_numeric',{}).items():
            if k not in SUPPORTED_NUMERIC:continue  # Captured provenance, not scored as existing engine capability.
            actual=fp.get(k)
            ok=(type(actual) in (int,float)) and abs(actual-v)<1e-7
            feats[k]['evaluated']+=1
            feats[k]['correct']+=int(ok)
            if not ok:feats[k]['failures'].append(r['id'])
            evals.append({'feature':k,'expected':v,'observed':actual,'correct':ok,'kind':'numeric_exact'})
        case_reports.append({'id':r['id'],'case_name':r['case_name'],'language':r['language'],'source_url':r['source_url'],
                             'checks':evals,'correct':sum(x['correct'] for x in evals),'evaluated':len(evals),
                             'all_expected_features_extracted':all(x['correct'] for x in evals),
                             'risk_label_observed_not_scored':output.get('risk_label')})
    fields={k:dict(v,coverage=round(v['correct']/v['evaluated'],4) if v['evaluated'] else None)
            for k,v in sorted(feats.items())}
    nc=sum(v['correct'] for v in feats.values())
    nd=sum(v['evaluated'] for v in feats.values())
    bin_c=sum(v['correct'] for k,v in feats.items() if k in SUPPORTED_BINARY)
    bin_d=sum(v['evaluated'] for k,v in feats.items() if k in SUPPORTED_BINARY)
    all_cases=sum(r['all_expected_features_extracted'] for r in case_reports)
    return {
      'dataset_name':'External Public Challenge Set — source-grounded official AFM case summaries',
      'data_sha256':data_sha256,'case_count':len(records),'distinct_source_urls':len(set(r['source_url'] for r in records)),
      'source_access':{t:sum(1 for r in records if r['source_access_status']==t) for t in sorted(set(r['source_access_status'] for r in records))},
      'run_characteristics':{'train_performed':False,'threshold_tuned':False,'engine_mutated':False,'risk_labels_scored':False},
      'extraction_coverage':{'correct_checks':nc,'evaluated_checks':nd,'rate':round(nc/nd,4) if nd else None,
                             'binary_correct':bin_c,'binary_evaluated':bin_d,'binary_rate':round(bin_c/bin_d,4) if bin_d else None,
                             'cases_with_all_expected_checks':all_cases,'total_cases':len(records)},
      'per_feature':fields,'per_case':case_reports,
      'not_measured':['Real WhatsApp/Telegram accuracy','Population-level precision or specificity','Legal status','Cross-language campaign attribution','Percentage-return parsing (unsupported in current schema)','EUR/USD/USDT amount extraction'],
      'interpretation':'Coverage means recall on manually identified, source-supported attributes of researcher-authored paraphrases, not accuracy on original promotional messages. Unmentioned attributes are unknown, not negative.'
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--engine',type=Path,default=Path('pyramid_dna_engine.py'))
    p.add_argument('--data',type=Path,default=Path('data/public_cases_challenge.jsonl'))
    p.add_argument('--out',type=Path,default=Path('artifacts/public_challenge_results.json'))
    p.add_argument('--training-dataset',type=Path,default=None)
    p.add_argument('--gold-file',type=Path,default=None,help='Only use after freezing engine; joins withheld gold by ID')
    a=p.parse_args()
    payload=a.data.read_bytes()
    rows=[json.loads(line) for line in payload.decode('utf-8-sig').splitlines() if line.strip()]
    if a.gold_file:
        labels=[json.loads(line) for line in a.gold_file.read_text(encoding='utf-8').splitlines() if line.strip()]
        lookup={r['id']:r for r in labels}
        if len(lookup)!=len(labels) or {r['id'] for r in rows}!=set(lookup):raise SystemExit('Holdout gold/input IDs mismatch')
        rows=[dict(r,expected_features=lookup[r['id']]['expected_features'],expected_numeric=lookup[r['id']]['expected_numeric']) for r in rows]
    if a.training_dataset:
        train=[json.loads(line) for line in a.training_dataset.read_text(encoding='utf-8').splitlines() if line.strip()]
        train_texts={r['text'].strip() for r in train if r.get('split') in ('train','validation','test')}
        overlap=[r['id'] for r in rows if r['text'].strip() in train_texts]
        if overlap:raise SystemExit(f'Exact-text collision with synthetic dataset: {overlap}')
    engine=load_engine(a.engine)
    report=evaluate(engine,rows,hashlib.sha256(payload).hexdigest())
    report['created_at']=datetime.now(timezone.utc).isoformat()
    report['engine_sha256']=hashlib.sha256(a.engine.read_bytes()).hexdigest()
    report['measurement_status']='diagnostic_development' if not a.gold_file else 'reserved_holdout_after_freeze'
    report['provenance_note']='Researcher-authored paraphrases of official press releases; not original Telegram/WhatsApp messages.'
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Cases: {report["case_count"]}; extracted {report["extraction_coverage"]["correct_checks"]}/{report["extraction_coverage"]["evaluated_checks"]} expected attributes; cases fully covered: {report["extraction_coverage"]["cases_with_all_expected_checks"]}/{report["case_count"]}')
    for k,v in report['per_feature'].items():print(f'  {k}: {v["correct"]}/{v["evaluated"]}')
    print('Saved:',a.out)
if __name__=='__main__':main()
