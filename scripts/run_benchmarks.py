#!/usr/bin/env python3
"""Reproducible structural-matcher vs TF-IDF pair benchmark on synthetic splits."""
from __future__ import annotations

from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
import hashlib
import json
import math
import platform
import random
import re
import sys
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pyramid_dna_engine import analyze, compare  # noqa: E402

SEED = 73129
SPLITS = ('train', 'validation', 'test')


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def validate_group_splits(rows: list[dict]) -> dict[str, set[str]]:
    owner: dict[str, str] = {}
    groups: dict[str, set[str]] = defaultdict(set)
    for record in rows:
        mechanism, split = record['mechanism_id'], record['split']
        if split not in SPLITS:
            raise ValueError(f"Unexpected split: {split}")
        if mechanism in owner and owner[mechanism] != split:
            raise ValueError(f"mechanism_id leakage: {mechanism} in {owner[mechanism]} and {split}")
        owner[mechanism] = split
        groups[split].add(mechanism)
    return groups


def build_pairs(rows: list[dict], split: str, seed: int) -> list[tuple[dict, dict, int]]:
    """All within-mechanism positives and an equal seeded sample of negatives."""
    subset = [r for r in rows if r['split'] == split]
    by_mechanism: dict[str, list[dict]] = defaultdict(list)
    for row in subset:
        by_mechanism[row['mechanism_id']].append(row)
    positive = [(a, b, 1) for group in sorted(by_mechanism) for a, b in combinations(by_mechanism[group], 2)]
    if not positive:
        raise ValueError(f'No positive mechanism pairs in {split}')
    negative_candidates = [(a, b, 0) for a, b in combinations(subset, 2) if a['mechanism_id'] != b['mechanism_id']]
    if len(negative_candidates) < len(positive):
        raise ValueError(f'Not enough negative pairs in {split}')
    negative = random.Random(seed).sample(negative_candidates, len(positive))
    pairs = positive + negative
    random.Random(seed + 1).shuffle(pairs)
    return pairs


def tokens(text: str) -> list[str]:
    return re.findall(r'(?u)\b\w+\b', text.casefold())


def fit_tfidf(train_rows: list[dict]) -> tuple[dict[str, float], list[dict[str, float]]]:
    """Fit word 1–2 gram vocabulary and smoothed IDF exclusively on train texts."""
    documents: list[Counter[str]] = []
    document_frequency: Counter[str] = Counter()
    for row in train_rows:
        words = tokens(row['text'])
        terms = Counter(words + [f'{a} {b}' for a, b in zip(words, words[1:])])
        documents.append(terms)
        document_frequency.update(terms.keys())
    count = len(documents)
    idf = {term: math.log((1 + count) / (1 + df)) + 1 for term, df in document_frequency.items()}
    vectors: list[dict[str, float]] = []
    for terms in documents:
        vector = {term: (1 + math.log(freq)) * idf[term] for term, freq in terms.items()}
        norm = math.sqrt(sum(value * value for value in vector.values())) or 1.
        vectors.append({term: value / norm for term, value in vector.items()})
    return idf, vectors


def tfidf_vector(text: str, idf: dict[str, float]) -> dict[str, float]:
    words = tokens(text)
    terms = Counter(words + [f'{a} {b}' for a, b in zip(words, words[1:])])
    vector = {term: (1 + math.log(freq)) * idf[term] for term, freq in terms.items() if term in idf}
    norm = math.sqrt(sum(value * value for value in vector.values())) or 1.
    return {term: value / norm for term, value in vector.items()}


def cosine(left: dict[str, float], right: dict[str, float]) -> float:
    if len(left) > len(right): left, right = right, left
    return sum(value * right.get(term, 0.) for term, value in left.items())


def choose_threshold(values: list[float], labels: list[int]) -> tuple[float, dict]:
    candidates = sorted({0., 1., *values})
    best: tuple[float, float, dict] | None = None
    for threshold in candidates:
        metrics = score(values, labels, threshold)
        candidate = (metrics['f1'], threshold, metrics)
        if best is None or candidate[:2] > best[:2]: best = candidate
    assert best is not None
    return best[1], best[2]


def score(values: list[float], labels: list[int], threshold: float) -> dict:
    tp=sum(1 for value,label in zip(values,labels) if label==1 and value>=threshold)
    fn=sum(1 for value,label in zip(values,labels) if label==1 and value<threshold)
    fp=sum(1 for value,label in zip(values,labels) if label==0 and value>=threshold)
    tn=sum(1 for value,label in zip(values,labels) if label==0 and value<threshold)
    precision=tp/(tp+fp) if tp+fp else 0.
    recall=tp/(tp+fn) if tp+fn else 0.
    return {'precision':precision,'recall':recall,'fpr':fp/(fp+tn) if fp+tn else None,
            'f1':2*precision*recall/(precision+recall) if precision+recall else 0.,
            'confusion':{'tp':tp,'fp':fp,'fn':fn,'tn':tn},'threshold':threshold,'sample_size':len(labels)}


def main() -> None:
    data_path=ROOT/'safenet_kz_pyramid_dna_dataset.jsonl'
    rows=load_rows(data_path)
    group_splits=validate_group_splits(rows)
    split_pairs={s:build_pairs(rows,s,SEED+index*100) for index,s in enumerate(SPLITS)}
    train_rows=[r for r in rows if r['split']=='train']
    idf,_=fit_tfidf(train_rows)
    vector_by_id={row['id']:tfidf_vector(row['text'],idf) for row in rows}
    analysis_by_id={row['id']:analyze(row['text']) for row in rows}
    values: dict[str,dict[str,list[float]]]={'dna':{},'tfidf':{}}
    labels_by_split={}
    # One shared ordered list of labeled pairs is used for both systems.
    for split,pairs in split_pairs.items():
        labels_by_split[split]=[label for _,_,label in pairs]
        values['dna'][split]=[compare(analysis_by_id[a['id']],analysis_by_id[b['id']])['similarity'] for a,b,_ in pairs]
        values['tfidf'][split]=[cosine(vector_by_id[a['id']],vector_by_id[b['id']]) for a,b,_ in pairs]
    thresholds={}
    validation={}
    for method in ('dna','tfidf'):
        threshold,metrics=choose_threshold(values[method]['validation'],labels_by_split['validation'])
        thresholds[method]=threshold;validation[method]=metrics
    test={method:score(values[method]['test'],labels_by_split['test'],thresholds[method]) for method in ('dna','tfidf')}
    pair_ids={s:hashlib.sha256('\n'.join(f"{a['id']}|{b['id']}|{label}" for a,b,label in split_pairs[s]).encode()).hexdigest() for s in SPLITS}
    result={
      'benchmark':'PYRAMID DNA structural matcher vs word TF-IDF cosine similarity',
      'dataset_provenance':'fully_synthetic', 'created_at':datetime.now(timezone.utc).isoformat(),
      'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
      'seed':SEED,'python_version':platform.python_version(),'engine_sha256':digest(ROOT/'pyramid_dna_engine.py'),
      'dataset_sha256':digest(data_path),'split_mechanism_counts':{s:len(group_splits[s]) for s in SPLITS},
      'mechanism_leakage_check':'passed','tfidf_features':{'word_ngrams':[1,2],'vocabulary_terms':len(idf),'fit_split':'train'},
      'pair_construction':'all within-mechanism positive pairs plus equal-count seeded negatives sampled within each split; shared ordered pair list for both methods',
      'pair_ids_sha256':pair_ids,
      'pairs':{s:{'positive':sum(labels_by_split[s]),'negative':len(labels_by_split[s])-sum(labels_by_split[s]),'sample_size':len(labels_by_split[s])} for s in SPLITS},
      'threshold_selection':'max validation F1; ties choose the higher threshold',
      'validation_metrics':validation,'frozen_thresholds':thresholds,'test_metrics_once':test,
      'interpretation':'This benchmark measures pairwise mechanism matching on the synthetic split only; it is not real-world case accuracy.'
    }
    out=ROOT/'artifacts'/'benchmark_results.json';out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'saved':str(out),'pairs':result['pairs'],'thresholds':thresholds,'test_metrics_once':test},ensure_ascii=False,indent=2))


if __name__=='__main__':main()
