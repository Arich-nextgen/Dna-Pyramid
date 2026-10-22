#!/usr/bin/env python3
"""Evaluate OCR text and its downstream financial-field preservation."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pyramid_dna_engine import analyze  # noqa: E402

EXPECTED = ROOT / "tests" / "ocr_fixtures" / "expected.json"
RAW = ROOT / "artifacts" / "ocr_raw_results.json"
OUT = ROOT / "artifacts" / "ocr_benchmark_results.json"
FIELDS = ("deposit_kzt", "promised_payout_kzt", "period_days", "referral_count")
KAZAKH = set("әғқңөұүһіӘҒҚҢӨҰҮҺІ")


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold().replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_currency_glyph(text: str) -> tuple[str, int]:
    """Mirror the browser's narrow, reviewable tenge-glyph normalization."""
    return re.subn(r"(\d(?:[\d\s.,]*\d)?)\s*[ТT](?=[\s.,;:!?]|$)", r"\1 ₸", text)


def distance(left: list[str], right: list[str]) -> int:
    row = list(range(len(right) + 1))
    for i, lvalue in enumerate(left, 1):
        next_row = [i]
        for j, rvalue in enumerate(right, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (lvalue != rvalue)))
        row = next_row
    return row[-1]


def rate(reference: list[str], hypothesis: list[str]) -> float:
    return distance(reference, hypothesis) / max(1, len(reference))


def main() -> None:
    expected = {item["id"]: item for item in json.loads(EXPECTED.read_text(encoding="utf-8"))}
    raw_payload = json.loads(RAW.read_text(encoding="utf-8"))
    raw = raw_payload["results"]
    cases, field_correct, field_total, amount_correct, amount_total = [], 0, 0, 0, 0
    raw_cer_total = raw_wer_total = 0.0
    raw_field_correct = raw_amount_correct = 0
    tenge_expected = tenge_kept = normalized_tenge_kept = kaz_expected = kaz_kept = 0
    for result in raw:
        item = expected[result["id"]]
        raw_text = result.get("raw_text", result["text"])
        ref, hyp = normalize(item["text"]), normalize(result["text"])
        raw_hyp = normalize(raw_text)
        normalized_text, replacements = normalize_currency_glyph(result["text"])
        raw_analysis = analyze(raw_text)
        analysis = analyze(normalized_text)
        fp = analysis["fingerprint"]
        raw_fp = raw_analysis["fingerprint"]
        correct = raw_correct = total = 0
        for field in FIELDS:
            if field not in item["expected"]:
                continue
            total += 1
            observed = fp.get(field)
            raw_observed = raw_fp.get(field)
            wanted = item["expected"][field]
            correct += observed == wanted
            raw_correct += raw_observed == wanted
            if field in ("deposit_kzt", "promised_payout_kzt") and wanted is not None:
                amount_total += 1
                amount_correct += observed == wanted
                raw_amount_correct += raw_observed == wanted
        if "risk_points" in item["expected"]:
            total += 1
            correct += analysis["risk_points"] == item["expected"]["risk_points"]
            raw_correct += raw_analysis["risk_points"] == item["expected"]["risk_points"]
        field_correct += correct
        raw_field_correct += raw_correct
        field_total += total
        tenge_expected += item["text"].count("₸")
        tenge_kept += min(item["text"].count("₸"), raw_text.count("₸"))
        normalized_tenge_kept += min(item["text"].count("₸"), normalized_text.count("₸"))
        ref_chars = [char for char in item["text"] if char in KAZAKH]
        hyp_chars = [char for char in result["text"] if char in KAZAKH]
        kaz_expected += len(ref_chars)
        remaining = hyp_chars.copy()
        for char in ref_chars:
            if char in remaining:
                kaz_kept += 1
                remaining.remove(char)
        raw_cer, raw_wer = rate(list(ref), list(raw_hyp)), rate(ref.split(), raw_hyp.split())
        raw_cer_total += raw_cer
        raw_wer_total += raw_wer
        cases.append({
            "id": item["id"], "cer": rate(list(ref), list(hyp)), "raw_cer": raw_cer,
            "wer": rate(ref.split(), hyp.split()), "raw_wer": raw_wer, "elapsed_seconds": result["elapsed_seconds"],
            "financial_fields_correct": correct, "financial_fields_total": total,
            "raw_financial_fields_correct": raw_correct,
            "recognized_text": result["text"], "raw_text": raw_text, "normalized_text": normalized_text,
            "currency_glyph_normalizations": replacements, "confidence": result["confidence"],
        })
    output = {
        "created_at": datetime.now(timezone.utc).isoformat(), "library": "Tesseract.js 7.0.0 / tessdata_fast",
        "languages": ["rus", "kaz"], "case_count": len(cases),
        "model_initialization_seconds": raw_payload.get("initialization_seconds"),
        "average_recognition_seconds": sum(case["elapsed_seconds"] for case in cases) / len(cases),
        "average_cer": sum(case["cer"] for case in cases) / len(cases),
        "average_wer": sum(case["wer"] for case in cases) / len(cases),
        "raw_average_cer": raw_cer_total / len(cases),
        "raw_average_wer": raw_wer_total / len(cases),
        "raw_financial_field_accuracy": raw_field_correct / max(1, field_total),
        "review_text_financial_field_accuracy": field_correct / max(1, field_total),
        "raw_amount_exact_match": raw_amount_correct / max(1, amount_total),
        "review_text_amount_exact_match": amount_correct / max(1, amount_total),
        "raw_tenge_symbol_retention": tenge_kept / max(1, tenge_expected),
        "review_text_tenge_symbol_retention": normalized_tenge_kept / max(1, tenge_expected),
        "kazakh_character_recall": kaz_kept / max(1, kaz_expected),
        "cases": cases,
        "known_limitations": [
            "Synthetic screenshots only; not field accuracy on WhatsApp or Telegram exports.",
            "BAD-01 intentionally uses blur and resampling.",
            "Users must verify material financial numbers before analysis.",
            "A deterministic review-text step replaces Cyrillic Т/T with ₸ only directly after a numeric amount; raw metrics remain reported separately.",
        ],
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
