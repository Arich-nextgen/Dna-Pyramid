from fastapi.testclient import TestClient

from api import app
from conversation_parser import analyze_conversation, parse_conversation


SPLIT_OFFER = """21.10.2026, 14:32 - Айдана: Для участия нужен взнос 40 000 ₸.
21.10.2026, 14:33 - Борис: Через 7 дней выплатят 60 000 ₸.
[21.10.2026, 14:34] Айдана: Нужно пригласить 5 участников.
Айдана: Осталось три места, успей сегодня."""


def test_parser_supports_common_headers_multiline_unicode_and_anonymizes():
    parsed = parse_conversation(SPLIT_OFFER + "\nжалғасы 😊")
    assert parsed["recognized_format"] is True
    assert len(parsed["messages"]) == 4
    assert parsed["messages"][0]["timestamp"] == "2026-10-21T14:32"
    assert parsed["messages"][0]["author_label"] == "Участник 1"
    assert parsed["messages"][1]["author_label"] == "Участник 2"
    assert parsed["messages"][3]["text"].endswith("жалғасы 😊")


def test_parser_warns_when_plain_text_is_not_clearly_a_conversation():
    parsed = parse_conversation("Взнос 5 000 ₸ и выплата 10 000 ₸ через 7 дней")
    assert parsed["recognized_format"] is False
    assert len(parsed["messages"]) == 1
    assert parsed["warnings"]


def test_phone_is_redacted_without_destroying_financial_amounts():
    parsed = parse_conversation("21.10.2026, 14:32 - +7 701 123 45 67: Взнос 40 000 ₸")
    message = parsed["messages"][0]
    assert message["author_label"] == "Участник 1"
    assert message["phone_redacted"] is True
    assert "40 000 ₸" in message["text"]
    assert "+7 701" not in str(parsed)


def test_reconstructs_split_offer_with_exact_provenance():
    result = analyze_conversation(parse_conversation(SPLIT_OFFER)["messages"])
    assert len(result["mechanisms"]) == 1
    mechanism = result["mechanisms"][0]
    fp = mechanism["fingerprint"]
    assert fp["deposit"]["value"] == 40000
    assert fp["payout"]["value"] == 60000
    assert fp["payout_multiplier"] == 1.5
    assert fp["period_days"] == 7
    assert fp["referral_count"] == 5
    assert mechanism["connection_status"] == "confirmed"
    assert result["risk_points"] == 70
    source = {m["message_id"]: m["text"] for m in result["messages"]}
    for evidence in result["evidence"]:
        assert source[evidence["message_id"]][evidence["start"]:evidence["end"]] == evidence["text"]


def test_different_schemes_are_not_merged_and_conflict_is_visible():
    messages = parse_conversation("""A: Взнос 40 000 ₸.
B: Выплата 60 000 ₸ через 7 дней.
A: Другая схема: взнос 10 000 ₸.
B: Выплата 30 000 ₸ через 3 дня.""")["messages"]
    result = analyze_conversation(messages)
    assert len(result["mechanisms"]) == 2
    assert result["mechanisms"][0]["fingerprint"]["deposit"]["value"] == 40000
    assert result["mechanisms"][1]["fingerprint"]["deposit"]["value"] == 10000
    assert result["conflicts"]


def test_warning_purchase_and_quote_do_not_create_false_mechanism():
    parsed = parse_conversation("""A: Осторожно, мошенники просят взнос 40 000 ₸. Не переводите деньги.
B: Оплата товара через Kaspi 25 000 ₸, доставка завтра.
C: > Вложи 5 000 ₸ и получи 10 000 ₸.""")
    result = analyze_conversation(parsed["messages"])
    assert result["mechanisms"] == []
    assert result["risk_points"] == 0
    assert [m["excluded_reason"] for m in result["messages"]] == [
        "warning_context", "benign_context", "unconfirmed_quote"
    ]


def test_calendar_period_without_financial_claim_is_not_a_mechanism():
    parsed = parse_conversation("A: Встречаемся завтра у офиса.\nB: Принесу документы.")
    result = analyze_conversation(parsed["messages"])
    assert result["mechanisms"] == []
    assert result["risk_points"] == 0


def test_repeated_message_does_not_increase_conversation_score():
    one = [
        {"message_id": "a", "text": "Взнос 5 000 ₸, выплата 10 000 ₸ через 7 дней. Пригласи 2 участников."}
    ]
    repeated = one + [
        {"message_id": "b", "text": one[0]["text"]},
        {"message_id": "c", "text": one[0]["text"]},
    ]
    assert analyze_conversation(one)["risk_points"] == analyze_conversation(repeated)["risk_points"]


def test_question_and_unverified_payout_mentions_are_not_confirmed_claims():
    parsed = parse_conversation("""A: А доказательства выплат существуют?
B: Утверждают, что есть скриншоты выплат, но их достоверность не проверена.""")
    result = analyze_conversation(parsed["messages"])
    assert result["mechanisms"] == []
    assert result["risk_points"] == 0
    assert [message["analysis"]["context_status"] for message in result["messages"]] == [
        "question", "unverified"
    ]
    assert [message["excluded_reason"] for message in result["messages"]] == [
        "question_context", "unverified_context"
    ]
    assert all(message["analysis"]["evidence_spans"] for message in result["messages"])
    assert all(
        span["context_status"] != "claim"
        for message in result["messages"]
        for span in message["analysis"]["evidence_spans"]
    )


def test_ru_kz_conditions_can_form_one_provenanced_mechanism():
    parsed = parse_conversation("""A: Для участия нужен взнос 40 000 ₸.
B: 7 күннен кейін 60 000 теңге төлем беріледі.
C: 5 адам шақыру керек.""")
    result = analyze_conversation(parsed["messages"])
    assert len(result["mechanisms"]) == 1
    fingerprint = result["mechanisms"][0]["fingerprint"]
    assert fingerprint["deposit"]["value"] == 40000
    assert fingerprint["payout"]["value"] == 60000
    assert fingerprint["period_days"] == 7
    assert fingerprint["referral_count"] == 5
    assert {evidence["message_id"] for evidence in result["evidence"]} == {
        "msg-001", "msg-002", "msg-003"
    }


def test_conflicting_payouts_are_never_resolved_arbitrarily():
    parsed = parse_conversation("""A: Проект Север: взнос 40 000 ₸.
B: Через 7 дней выплата 60 000 ₸.
C: По проекту Север выплата 80 000 ₸.""")
    result = analyze_conversation(parsed["messages"])
    payouts = [
        mechanism["fingerprint"]["payout"]["value"]
        for mechanism in result["mechanisms"]
        if mechanism["fingerprint"]["payout"]
    ]
    assert sorted(payouts) == [60000, 80000]
    assert any(conflict["type"] == "conflicting_payout" for conflict in result["conflicts"])


def test_api_parse_and_conversation_analysis_validation():
    client = TestClient(app)
    parsed = client.post("/api/v1/conversation/parse", json={"text": SPLIT_OFFER})
    assert parsed.status_code == 200
    response = client.post("/api/v1/analyze/conversation", json={"messages": parsed.json()["messages"]})
    assert response.status_code == 200
    assert response.json()["mechanisms"][0]["fingerprint"]["payout_multiplier"] == 1.5
    invalid = client.post("/api/v1/analyze/conversation", json={"messages": []})
    assert invalid.status_code == 422
