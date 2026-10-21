import importlib.util
from pathlib import Path

import pytest


PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'run_benchmarks.py'
spec = importlib.util.spec_from_file_location('run_benchmarks', PATH)
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def test_mechanisms_do_not_leak_across_splits():
    rows = benchmark.load_rows(benchmark.ROOT / 'safenet_kz_pyramid_dna_dataset.jsonl')
    groups = benchmark.validate_group_splits(rows)
    assert set(groups) == {'train', 'validation', 'test'}
    with pytest.raises(ValueError, match='leakage'):
        benchmark.validate_group_splits([
            {'mechanism_id': 'same', 'split': 'train'},
            {'mechanism_id': 'same', 'split': 'test'},
        ])


def test_pair_labels_match_mechanism_ids_and_negative_sample_is_seeded():
    rows = [
        {'id': 'a1', 'split': 'train', 'mechanism_id': 'a'},
        {'id': 'a2', 'split': 'train', 'mechanism_id': 'a'},
        {'id': 'b1', 'split': 'train', 'mechanism_id': 'b'},
        {'id': 'b2', 'split': 'train', 'mechanism_id': 'b'},
    ]
    one = benchmark.build_pairs(rows, 'train', 17)
    two = benchmark.build_pairs(rows, 'train', 17)
    assert [(a['id'], b['id'], label) for a, b, label in one] == [(a['id'], b['id'], label) for a, b, label in two]
    assert sum(label for _, _, label in one) == 2
    assert len(one) == 4
    assert all((a['mechanism_id'] == b['mechanism_id']) == bool(label) for a, b, label in one)
    assert all(a['split'] == b['split'] == 'train' for a, b, _ in one)


def test_tfidf_vocab_comes_only_from_supplied_training_records():
    rows = [{'text': 'train phrase here'}, {'text': 'shared train words'}]
    idf, _ = benchmark.fit_tfidf(rows)
    assert 'validationonly' not in idf
    assert 'testonly' not in idf
    assert set(benchmark.tfidf_vector('validationonly train', idf)) <= set(idf)
