#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Conversation parsing and conservative mechanism reconstruction.

The module has no network or third-party runtime dependency so the same code runs
under CPython/FastAPI and in the browser's Pyodide worker.  It deliberately keeps
uncertain fragments separate instead of manufacturing a complete offer.
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
import re
from typing import Any

from pyramid_dna_engine import analyze, normalize

MAX_CONVERSATION_CHARS = 100_000
MAX_MESSAGES = 200

_DATED_DASH = re.compile(
    r"^(?P<date>\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s*(?P<time>\d{1,2}:\d{2})\s*-\s*"
    r"(?:(?P<author>[^:]{1,80}):\s*)?(?P<text>.*)$"
)
_BRACKETED = re.compile(
    r"^\[(?P<date>\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s*(?P<time>\d{1,2}:\d{2})\]\s*"
    r"(?:(?P<author>[^:]{1,80}):\s*)?(?P<text>.*)$"
)
_AUTHOR_ONLY = re.compile(r"^(?P<author>[^:\n]{1,64}):\s+(?P<text>.+)$")
_PHONE = re.compile(r"(?<!\d)(?:\+?7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)")
_SYSTEM = re.compile(
    r"(?:сообщения и звонки защищены|создал(?:а)? группу|добавил(?:а)? вас|"
    r"изменил(?:а)? название|messages and calls are end-to-end encrypted|"
    r"топқа қосты|тобының атауын өзгертті)", re.I
)
_BOUNDARY = re.compile(
    r"\b(?:другая|другой|вторая|новая)\s+(?:схема|программа|предложение|вариант)|"
    r"\b(?:отдельн\w*|тағы бір)\s+(?:схема|предложение|ұсыныс)", re.I
)
_QUOTE_ONLY = re.compile(r"^(?:>|цитата\s*:|переслано\s*:|forwarded\s*:)", re.I)


def _timestamp(date: str | None, time: str | None) -> str | None:
    if not date:
        return None
    raw = f"{date} {time or '00:00'}"
    for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%y %H:%M", "%d/%m/%Y %H:%M", "%d/%m/%y %H:%M"):
        try:
            return datetime.strptime(raw, fmt).isoformat(timespec="minutes")
        except ValueError:
            pass
    return None


def _redact_phone(text: str) -> tuple[str, bool]:
    redacted, count = _PHONE.subn("[телефон скрыт]", text)
    return redacted, bool(count)


def _message(message_id: str, order: int, text: str, timestamp: str | None,
             author: str | None, author_map: OrderedDict[str, str], system: bool = False) -> dict[str, Any]:
    cleaned, phone_redacted = _redact_phone(text.strip())
    raw_author = (author or "").strip()
    if raw_author:
        author_key, _ = _redact_phone(raw_author)
        if author_key not in author_map:
            author_map[author_key] = f"Участник {len(author_map) + 1}"
        label = author_map[author_key]
    else:
        label = None
    return {
        "message_id": message_id,
        "order": order,
        "text": cleaned,
        "timestamp": timestamp,
        "author_label": label,
        "is_system": system or bool(_SYSTEM.search(cleaned)),
        "phone_redacted": phone_redacted or bool(raw_author and _PHONE.search(raw_author)),
    }


def parse_conversation(raw_text: str) -> dict[str, Any]:
    """Parse common WhatsApp/Telegram text exports into an editable preview."""
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise ValueError("Переписка пуста.")
    if len(raw_text) > MAX_CONVERSATION_CHARS:
        raise ValueError(f"Переписка превышает {MAX_CONVERSATION_CHARS // 1000} КБ текста.")

    messages: list[dict[str, Any]] = []
    author_map: OrderedDict[str, str] = OrderedDict()
    current: dict[str, Any] | None = None
    recognized_headers = 0
    ignored_blank = 0

    def finish() -> None:
        nonlocal current
        if current and current["text"].strip():
            messages.append(_message(
                f"msg-{len(messages) + 1:03d}", len(messages) + 1,
                current["text"], current.get("timestamp"), current.get("author"),
                author_map, current.get("system", False),
            ))
        current = None

    for raw_line in raw_text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        if not line.strip():
            ignored_blank += 1
            if current and current["text"]:
                current["text"] += "\n"
            continue
        match = _DATED_DASH.match(line) or _BRACKETED.match(line)
        author_match = None if match else _AUTHOR_ONLY.match(line)
        # Avoid treating ordinary sentences such as "Важно: ..." as authors.
        if author_match and author_match.group("author").casefold() in {
            "важно", "условия", "взнос", "выплата", "цитата", "предупреждение", "итого"
        }:
            author_match = None
        if match or author_match:
            finish()
            recognized_headers += 1
            if match:
                current = {
                    "text": match.group("text"),
                    "timestamp": _timestamp(match.groupdict().get("date"), match.groupdict().get("time")),
                    "author": match.groupdict().get("author"),
                    "system": not bool(match.groupdict().get("author")),
                }
            else:
                current = {"text": author_match.group("text"), "timestamp": None,
                           "author": author_match.group("author"), "system": False}
        elif current:
            current["text"] += ("" if current["text"].endswith("\n") else "\n") + line
        else:
            # Keep unstructured text visible rather than silently dropping it.
            current = {"text": line, "timestamp": None, "author": None, "system": False}
    finish()
    if len(messages) > MAX_MESSAGES:
        raise ValueError(f"Найдено {len(messages)} сообщений; допустимо не более {MAX_MESSAGES}.")

    structured = recognized_headers >= 2 and recognized_headers >= max(2, len(messages) // 2)
    warnings: list[str] = []
    if not structured:
        warnings.append("Структура переписки распознана неоднозначно. Проверьте разделение сообщений перед анализом.")
    if any(item["phone_redacted"] for item in messages):
        warnings.append("Телефонные номера скрыты автоматически.")
    return {
        "messages": messages,
        "recognized_format": structured,
        "warnings": warnings,
        "stats": {"message_count": len(messages), "recognized_headers": recognized_headers,
                  "ignored_blank_lines": ignored_blank, "participant_count": len(author_map)},
    }


def _typed_amount(analysis: dict[str, Any], roles: tuple[str, ...]) -> dict[str, Any] | None:
    candidates = [m for m in analysis.get("amount_mentions", []) if m.get("role") in roles and m.get("value") is not None]
    if not candidates:
        return None
    return max(candidates, key=lambda item: float(item.get("confidence", 0)))


def _features(analysis: dict[str, Any]) -> dict[str, Any]:
    fp = analysis["fingerprint"]
    deposit = _typed_amount(analysis, ("required_contribution", "package_cost"))
    payout = _typed_amount(analysis, ("promised_return",))
    return {
        "deposit": deposit,
        "payout": payout,
        "period_days": fp.get("period_days"),
        "referral_count": fp.get("referral_count"),
        "needs_deposit": bool(fp.get("needs_deposit")),
        "has_return_claim": bool(fp.get("has_return_claim")),
        "has_guarantee_claim": bool(fp.get("has_guarantee_claim")),
        "has_recruitment": bool(fp.get("has_recruitment")),
        "has_individual_transfer": bool(fp.get("has_individual_transfer")),
        "has_urgency": bool(fp.get("has_urgency")),
        "has_tasks_upfront": bool(fp.get("has_tasks_upfront")),
    }


def _candidate(features: dict[str, Any]) -> bool:
    # A date or period by itself ("встречаемся завтра") is not a financial
    # mechanism.  Require a financial or recruitment claim as the anchor.
    return bool(features["deposit"] or features["payout"] or features["needs_deposit"] or
                features["has_return_claim"] or features["has_recruitment"] or
                features["has_guarantee_claim"])


def _same_amount(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
    if not left or not right:
        return True
    return left.get("currency") == right.get("currency") and left.get("value") == right.get("value")


def _mechanism_risk(fp: dict[str, Any]) -> tuple[int, list[dict[str, Any]]]:
    points = 0
    factors: list[dict[str, Any]] = []
    def add(label: str, value: int) -> None:
        nonlocal points
        points += value
        factors.append({"indicator": label, "points": value})
    if fp["needs_deposit"]:
        add("Взнос является условием участия", 16)
    dep, pay = fp.get("deposit"), fp.get("payout")
    if dep and pay and dep["currency"] == pay["currency"] and pay["value"] >= dep["value"] * 1.5:
        add("Обещанная выплата заметно больше взноса", 24)
    if fp["has_guarantee_claim"] and fp["has_return_claim"]:
        add("Заявлена гарантированная выплата", 18)
    if fp["has_recruitment"] and fp["has_return_claim"]:
        add("Выплата связана с приглашением участников", 20 if fp["needs_deposit"] else 16)
    if fp["has_individual_transfer"] and fp["needs_deposit"]:
        add("Перевод на личную карту связан со взносом", 12)
    if fp["has_urgency"] and fp["needs_deposit"]:
        add("Денежное предложение ограничено по времени", 10)
    if fp["has_tasks_upfront"]:
        add("Предварительный взнос для получения заданий", 18)
    return min(points, 100), factors


def _new_group(item: dict[str, Any]) -> dict[str, Any]:
    return {"items": [item], "last_order": item["order"], "deposit": item["features"]["deposit"],
            "payout": item["features"]["payout"]}


def analyze_conversation(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze messages and conservatively reconstruct one or more mechanisms."""
    if not 1 <= len(messages) <= MAX_MESSAGES:
        raise ValueError(f"Допустимо от 1 до {MAX_MESSAGES} сообщений.")
    author_map: OrderedDict[str, str] = OrderedDict()
    prepared: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, source in enumerate(messages, 1):
        text = str(source.get("text", ""))
        if not text.strip():
            raise ValueError(f"Сообщение {index} пусто.")
        if len(text) > 10_000:
            raise ValueError(f"Сообщение {index} превышает 10 000 символов.")
        message_id = str(source.get("message_id") or f"msg-{index:03d}")
        if message_id in seen_ids:
            raise ValueError("message_id должны быть уникальными.")
        seen_ids.add(message_id)
        safe_text, phone_redacted = _redact_phone(text)
        raw_author = str(source.get("author_label") or "").strip()
        if raw_author:
            if raw_author not in author_map:
                author_map[raw_author] = f"Участник {len(author_map) + 1}"
            author_label = author_map[raw_author]
        else:
            author_label = None
        result = analyze(safe_text)
        fp = result["fingerprint"]
        quote_only = bool(_QUOTE_ONLY.search(safe_text.strip()))
        context_status = result.get("context_status", "claim")
        item = {
            "message_id": message_id, "order": index, "text": safe_text,
            "timestamp": source.get("timestamp"), "author_label": author_label,
            "is_system": bool(source.get("is_system")) or bool(_SYSTEM.search(safe_text)),
            "phone_redacted": phone_redacted, "analysis": result,
            "features": _features(result), "excluded_reason": None,
        }
        if item["is_system"]:
            item["excluded_reason"] = "system_message"
        elif fp.get("is_warning"):
            item["excluded_reason"] = "warning_context"
        elif fp.get("is_benign_context"):
            item["excluded_reason"] = "benign_context"
        elif quote_only:
            item["excluded_reason"] = "unconfirmed_quote"
        elif context_status == "question":
            item["excluded_reason"] = "question_context"
        elif context_status == "unverified":
            item["excluded_reason"] = "unverified_context"
        elif context_status == "negated":
            item["excluded_reason"] = "negated_context"
        elif context_status == "quoted":
            item["excluded_reason"] = "unconfirmed_quote"
        prepared.append(item)

    groups: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for item in prepared:
        if item["excluded_reason"] or not _candidate(item["features"]):
            continue
        feature = item["features"]
        boundary = bool(_BOUNDARY.search(item["text"]))
        far = current is not None and item["order"] - current["last_order"] > 3
        deposit_conflict = current is not None and feature["deposit"] and current["deposit"] and not _same_amount(feature["deposit"], current["deposit"])
        payout_conflict = current is not None and feature["payout"] and current["payout"] and not _same_amount(feature["payout"], current["payout"])
        if current is None or boundary or far or deposit_conflict or payout_conflict:
            if deposit_conflict or payout_conflict:
                field = "deposit" if deposit_conflict else "payout"
                conflicts.append({
                    "type": f"conflicting_{field}",
                    "message_ids": [current["items"][-1]["message_id"], item["message_id"]],
                    "explanation": "Противоречащие денежные условия оставлены в разных механизмах.",
                })
            current = _new_group(item)
            groups.append(current)
        else:
            # Exact duplicate text is retained for provenance but contributes no new rules.
            current["items"].append(item)
            current["last_order"] = item["order"]
            current["deposit"] = current["deposit"] or feature["deposit"]
            current["payout"] = current["payout"] or feature["payout"]

    mechanisms: list[dict[str, Any]] = []
    all_evidence: list[dict[str, Any]] = []
    all_unknowns: list[dict[str, Any]] = []
    for group_index, group in enumerate(groups, 1):
        mechanism_id = f"mechanism-{group_index:02d}"
        unique_items: list[dict[str, Any]] = []
        seen_texts: set[str] = set()
        for item in group["items"]:
            key = normalize(item["text"])
            if key not in seen_texts:
                unique_items.append(item); seen_texts.add(key)
        fp: dict[str, Any] = {
            "deposit": None, "payout": None, "payout_multiplier": None,
            "period_days": None, "referral_count": None,
            "needs_deposit": False, "has_return_claim": False,
            "has_guarantee_claim": False, "has_recruitment": False,
            "has_individual_transfer": False, "has_urgency": False,
            "has_tasks_upfront": False,
        }
        for item in unique_items:
            features = item["features"]
            fp["deposit"] = fp["deposit"] or features["deposit"]
            fp["payout"] = fp["payout"] or features["payout"]
            fp["period_days"] = fp["period_days"] or features["period_days"]
            fp["referral_count"] = fp["referral_count"] or features["referral_count"]
            for field in ("needs_deposit", "has_return_claim", "has_guarantee_claim", "has_recruitment",
                          "has_individual_transfer", "has_urgency", "has_tasks_upfront"):
                fp[field] = fp[field] or features[field]
            for span_index, span in enumerate(item["analysis"].get("evidence_spans", []), 1):
                evidence = {
                    "evidence_id": f"{mechanism_id}-{item['message_id']}-{span_index}",
                    "mechanism_id": mechanism_id, "message_id": item["message_id"],
                    "feature_type": span["feature_type"], "text": span["text"],
                    "start": span["start"], "end": span["end"],
                    "label": span.get("label"), "explanation": span.get("explanation"),
                    "context_status": span.get("context_status", "claim"),
                }
                all_evidence.append(evidence)
        dep, pay = fp["deposit"], fp["payout"]
        if dep and pay and dep["currency"] == pay["currency"] and dep["value"]:
            fp["payout_multiplier"] = round(pay["value"] / dep["value"], 2)
        risk_points, factors = _mechanism_risk(fp)
        risk_label = "high" if risk_points >= 58 else "medium" if risk_points >= 25 else "low"
        unknown_fields = [label for field, label in (
            ("deposit", "взнос"), ("payout", "обещанная выплата"),
            ("period_days", "срок"), ("referral_count", "число приглашённых"),
        ) if fp[field] is None]
        confirmed_core = bool(fp["deposit"] and (fp["payout"] or fp["has_recruitment"]))
        connection_status = "confirmed" if confirmed_core and len(unique_items) > 1 else "single_message" if len(unique_items) == 1 else "unconfirmed"
        if connection_status == "unconfirmed":
            all_unknowns.append({"mechanism_id": mechanism_id, "field": "connection",
                                 "explanation": "Связь между условиями не подтверждена."})
        mechanisms.append({
            "mechanism_id": mechanism_id,
            "source_message_ids": [item["message_id"] for item in group["items"]],
            "connection_status": connection_status,
            "fingerprint": fp,
            "risk_points": risk_points,
            "risk_label": risk_label,
            "risk_factors": factors,
            "unknown_fields": unknown_fields,
        })

    max_points = max((m["risk_points"] for m in mechanisms), default=0)
    overall_label = "high" if max_points >= 58 else "medium" if max_points >= 25 else "low"
    public_messages = []
    for item in prepared:
        public_messages.append({key: item[key] for key in (
            "message_id", "order", "text", "timestamp", "author_label", "is_system",
            "phone_redacted", "analysis", "excluded_reason"
        )})
    review_required = bool(mechanisms) and (max_points >= 25 or len(mechanisms) > 1 or bool(conflicts) or bool(all_unknowns))
    return {
        "messages": public_messages,
        "mechanisms": mechanisms,
        "evidence": all_evidence,
        "conflicts": conflicts,
        "unknowns": all_unknowns,
        "risk_label": overall_label,
        "risk_points": max_points,
        "risk_method": "Максимальный балл одного механизма; сообщения и повторы не суммируются.",
        "review_required": review_required,
        "disclaimer": "Предварительный анализ признаков. Связь сообщений и выводы должен проверить специалист.",
    }
