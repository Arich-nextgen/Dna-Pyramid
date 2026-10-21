# PYRAMID DNA — External Public Challenge Pack

Prepared: 2026-10-21. Scope: open official AFM reports, **not a scraped AFM register**, not original Telegram/WhatsApp messages, and not evidence of an actual system integration with AFM. All text inputs are original researcher-authored factual paraphrases of public official announcements, not verbatim official texts. Source titles and URLs are included per row. Published dates not verified are set to `null`.

## What is inside

- `data/public_cases_challenge.jsonl` — **15 independently sourced official cases** with source URL, language, annotated positive features, known numeric terms, and explicit provenance. These 15 cases are now **diagnostic/development evidence**, because their first model predictions have been inspected.
- `data/source_manifest.json` — provenance for those 15.
- `data/public_final_holdout_inputs.jsonl` — **5 additional, distinct official cases** (Takorp, Mooni Gold, S-Group, Antares Limited, BINCLOUD). They have **NOT been run** through the model in creating this pack.
- `data/public_final_holdout_gold_DO_NOT_READ_BEFORE_FREEZE.jsonl` — annotations stored separately to reduce accidental tuning. It is a procedural holdout, **not cryptographically blind**; whoever can open the pack can read the annotations.
- `scripts/eval_public_challenge.py` — reproducible test harness for the *existing* engine; it never trains or modifies thresholds.
- `artifacts/public_challenge_results.json` — already measured results on the attached current engine.

## First independent baseline on the 15 diagnostic cases

The current `pyramid_dna_engine.py` was run unmodified with the official-case **paraphrases**. Results:

| Check | Correct / scored |
| --- | ---: |
| All supported, explicitly annotated gold checks | **28 / 45 (62.2%)** |
| Explicit promised return claim | **15 / 15** |
| Explicit participant recruitment signal | **6 / 6** |
| Explicit guarantee claim | **2 / 2** |
| Deposit/required investment indicator | **2 / 15** |
| Specific number of days | **2 / 6** |
| Cases with every gold-scored field extracted | **2 / 15** |

These are **positive-attribute extraction coverage** metrics, not classification accuracy, not case-level precision, not false-positive rate. Unknown/not mentioned features are not treated as negatives. Currency fields in USD/EUR/USDT and percentage ranges are preserved as human annotations but excluded from the current engine feature-level score because the current engine does not expose matching typed fields. Some Kazakh paraphrases contain borrowings or translated wording; native speaker review would improve label validity.

The 15-row challenge was applied *once before changing the engine*. Since the results were inspected, post-fix metrics on the same 15 rows **must** be reported as diagnostic/development improvements, not untouched external validation. The 5 reserved cases provide only a *small* final holdout, and were **not evaluated here**.

## Reproduce the baseline

From the extracted pack root, with the original `pyramid_dna_engine.py` available:

```bash
python scripts/eval_public_challenge.py \
  --engine /path/to/pyramid_dna_engine.py \
  --data data/public_cases_challenge.jsonl \
  --out artifacts/public_challenge_results.json \
  --training-dataset /path/to/safenet_kz_pyramid_dna_dataset.jsonl
```

Check engine commit or SHA-256 when comparing to the included results. The engine in the user's mounted files has been used for the baseline run; other versions can differ.

**Only once, after implementation and threshold freeze**, evaluate the reserved five:

```bash
python scripts/eval_public_challenge.py \
  --engine /path/to/pyramid_dna_engine.py \
  --data data/public_final_holdout_inputs.jsonl \
  --gold-file data/public_final_holdout_gold_DO_NOT_READ_BEFORE_FREEZE.jsonl \
  --out artifacts/public_final_holdout_results.json
```

Do **not** inspect the reserved gold or test the five source summaries during engine changes. If you have already used them for tuning/debugging, declare holdout compromised and collect new cases before claiming a fresh test.

## Correct scientific framing

Do say: “External extraction coverage on manually annotated, researcher-paraphrased **official AFM press release cases**.”

Do **not** say: “Accuracy on real Telegram posts”, “training on real AFM data”, “verified by AFM”, “official AFM integration”, “we identified the operators”, or “same fingerprint means same criminal organization”.

No private messages, personal contacts, closed group content, or non-consensual data collection are included. This is an educational/research prototype.
