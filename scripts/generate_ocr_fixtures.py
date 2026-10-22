#!/usr/bin/env python3
"""Create synthetic RU/KZ chat-like screenshots for OCR regression tests."""
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "ocr_fixtures"
FONT = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"

CASES = [
    {
        "id": "RU-01",
        "text": "Взнос 40 000 ₸. Через 7 дней обещают выплату 60 000 ₸. Требуется пригласить 5 участников.",
        "expected": {"deposit_kzt": 40000, "promised_payout_kzt": 60000, "period_days": 7, "referral_count": 5},
    },
    {
        "id": "KZ-01",
        "text": "Қатысу жарнасы 40 000 теңге. 7 күннен кейін 60 000 теңге төлем уәде етіледі. 5 адам шақыру керек.",
        "expected": {"deposit_kzt": 40000, "promised_payout_kzt": 60000, "period_days": 7, "referral_count": 5},
    },
    {
        "id": "MIX-01",
        "text": "Kaspi арқылы 5 000 тг салым. Через 3 дня выплата 10 000 ₸. 2 адам шақыр.",
        "expected": {"deposit_kzt": 5000, "promised_payout_kzt": 10000, "period_days": 3, "referral_count": 2},
    },
    {
        "id": "NEG-01",
        "text": "Оплата ноутбука 200 000 ₸ через Kaspi. Это покупка товара, не инвестиция.",
        "expected": {"deposit_kzt": None, "promised_payout_kzt": None, "risk_points": 0},
    },
    {
        "id": "WARNING-01",
        "text": "Бұл күмәнді ұсыныс. Ақша аудармаңыздар. Доход не гарантирован.",
        "expected": {"deposit_kzt": None, "promised_payout_kzt": None, "risk_points": 0},
    },
    {
        "id": "BAD-01",
        "text": "Взнос 40 000 ₸. Выплата 60 000 ₸ через 7 дней.",
        "expected": {"deposit_kzt": 40000, "promised_payout_kzt": 60000, "period_days": 7},
        "degraded": True,
    },
]


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def render(case: dict) -> None:
    image = Image.new("RGB", (1080, 620), "#eee9e3")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, 36)
    small = ImageFont.truetype(FONT, 24)
    draw.rounded_rectangle((70, 70, 1010, 550), radius=28, fill="#ffffff", outline="#d8d7d0", width=2)
    draw.text((110, 105), "СИНТЕТИЧЕСКИЙ OCR-ТЕСТ", font=small, fill="#8a5a45")
    y = 190
    for line in wrap(draw, case["text"], font, 820):
        draw.text((120, y), line, font=font, fill="#263a31")
        y += 60
    if case.get("degraded"):
        image = image.resize((540, 310), Image.Resampling.BILINEAR).resize((1080, 620), Image.Resampling.BILINEAR)
        image = image.filter(ImageFilter.GaussianBlur(1.8))
    image.save(OUT / f"{case['id']}.png", optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for case in CASES:
        render(case)
    reference = next(case for case in CASES if case["id"] == "RU-01")
    extras = []
    source = Image.open(OUT / "RU-01.png")
    for degrees in (90, 180, 270):
        item = {**reference, "id": f"ROT-{degrees:03d}", "rotation_degrees": degrees}
        source.rotate(degrees, expand=True).save(OUT / f"{item['id']}.png", optimize=True)
        extras.append(item)
    exif = Image.Exif()
    exif[274] = 6
    source.rotate(90, expand=True).save(OUT / "EXIF-090.jpg", exif=exif, quality=94)
    extras.append({**reference, "id": "EXIF-090", "exif_orientation": 6})
    dark = ImageOps.invert(source.convert("RGB"))
    dark.save(OUT / "DARK-01.png", optimize=True)
    extras.append({**reference, "id": "DARK-01", "theme": "dark"})
    small = source.resize((540, 310), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", source.size, "#e8e6df")
    canvas.paste(small, ((source.width - small.width) // 2, (source.height - small.height) // 2))
    canvas.save(OUT / "SMALL-01.png", optimize=True)
    extras.append({**reference, "id": "SMALL-01", "text_size": "small"})
    expected = CASES + extras
    (OUT / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(expected)} fixtures in {OUT}")


if __name__ == "__main__":
    main()
