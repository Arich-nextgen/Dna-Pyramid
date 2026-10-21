from math import isclose

from pyramid_dna_engine import analyze, compare


def test_extraction_keeps_currency_ranges_and_roles_separate():
    result = analyze('Инвестировать от 20 до 10 000 USD в USDT; обещан доход 0,5–1,5% каждый день.')
    amount = result['financial_terms']['money'][0]
    assert amount['currency'] == 'USD'
    assert (amount['min'], amount['max'], amount['value']) == (20, 10000, None)
    assert amount['role'] == 'required_contribution'
    assert result['fingerprint']['needs_deposit'] is True
    assert result['fingerprint']['deposit_kzt'] is None
    assert result['financial_terms']['percentages'][0]['min'] == 0.5
    assert result['financial_terms']['percentages'][0]['max'] == 1.5
    assert result['financial_terms']['period']['unit'] == 'day'


def test_ru_kz_amount_roles_and_periods():
    ru = analyze('Взнос 5 000 ₸, выплата 10 000 ₸ через 7 дней.')
    kz = analyze('5 000 теңге жарна, 10 000 теңге төлем, 7 күнде.')
    assert [m['role'] for m in ru['amount_mentions']] == ['required_contribution', 'promised_return']
    assert [m['role'] for m in kz['amount_mentions']] == ['required_contribution', 'promised_return']
    assert ru['fingerprint']['period_days'] == kz['fingerprint']['period_days'] == 7


def test_currency_support_without_exchange_rate_and_package_is_not_return():
    result = analyze('Вложить 1 100 евро наличными; обещана доходность 20% годовых.')
    assert result['amount_mentions'][0]['currency'] == 'EUR'
    assert result['amount_mentions'][0]['value'] == 1100
    assert result['amount_mentions'][0]['role'] == 'required_contribution'
    assert 'value_kzt' not in result['amount_mentions'][0]
    assert result['financial_terms']['percentages'][0]['max'] == 20
    usdt = analyze('Вклад 500 USDT и прибыль 900 USDT.')
    assert [m['currency'] for m in usdt['amount_mentions']] == ['USDT', 'USDT']
    assert [m['role'] for m in usdt['amount_mentions']] == ['required_contribution', 'promised_return']


def test_negations_and_benign_operation_do_not_create_risk_factors():
    no_claim = analyze('Без взноса, доход не гарантирован и не обещан.')
    purchase = analyze('Оплата товара 5 000 ₸, без обещания дохода.')
    assert no_claim['fingerprint']['needs_deposit'] is False
    assert no_claim['fingerprint']['has_return_claim'] is False
    assert no_claim['fingerprint']['has_guarantee_claim'] is False
    assert no_claim['risk_points'] == 0
    assert purchase['fingerprint']['is_benign_context'] is True
    assert purchase['risk_points'] == 0


def test_evidence_spans_are_exact_utf16_offsets_for_unicode_and_repetition():
    text = '😀 Взнос 5 000 ₸, взнос 7 000 ₸.'
    result = analyze(text)
    spans = [s for s in result['evidence_spans'] if s['feature_type'] == 'deposit' and s['label'] == 'Требуемый взнос']
    assert spans[0]['text'] == 'Взнос'
    assert spans[0]['start'] == 3  # JS uses two UTF-16 units for the emoji.
    for span in result['evidence_spans']:
        assert text.encode('utf-16-le')[2 * span['start']:2 * span['end']].decode('utf-16-le') == span['text']


def test_feature_level_compare_contributions_sum_to_similarity():
    left = analyze('Взнос 5 000 ₸, выплата 10 000 ₸ через 7 дней.')
    right = analyze('5 000 теңге жарна, 10 000 теңге төлем, 7 күнде.')
    result = compare(left, right)
    assert result['feature_comparison']
    assert isclose(sum(row['normalized_contribution'] for row in result['feature_comparison']), result['similarity'], abs_tol=1e-4)
    assert any(row['status'] == 'exact_match' and row['label'] == 'Обещанная выплата, ₸' for row in result['feature_comparison'])
    assert 'Similarity of terms' not in result['caution']


def test_missing_features_are_unknown_not_shared_matches():
    left = analyze('Обычный текст без финансовых условий.')
    right = analyze('Обычный текст без финансовых условий.')
    result = compare(left, right)
    assert result['similarity'] == 0
    assert not result['shared_features']
    assert all(row['status'] == 'unknown' for row in result['feature_comparison'])


def test_risk_breakdown_uses_existing_scoring_points():
    result = analyze('Взнос 5 000 ₸, гарантированная выплата 10 000 ₸, пригласи 2 участников срочно.')
    factors = result['risk_breakdown']['factors']
    assert result['risk_breakdown']['uncapped_points'] == sum(f['points'] for f in factors)
    assert result['risk_points'] == min(100, sum(f['points'] for f in factors))
