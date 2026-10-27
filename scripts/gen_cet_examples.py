#!/usr/bin/env python3
"""Validate / merge data/examples-cet{4,6}.json (no template generation).

Hand-write any new fill-in sentences directly in the JSON files (or merge via --merge).
This script only validates and optionally merges; it never invents sentences from templates.

Checks:
  • each fill-in contains the target word (or a simple inflection)
  • Chinese translation is present
  • no leftover template markers
  • reports CET headwords that still lack both a source example and a fill-in

Usage:
  python3 scripts/gen_cet_examples.py
  python3 scripts/gen_cet_examples.py --merge path/to/handwritten.json
"""
from __future__ import annotations

import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Proper nouns / unusable lemmas — cloze simply skips these.
OMIT = {
    "china", "england", "france", "germany", "japan", "italian", "oceania",
    "connexion", "automatically", "moslem", "venus",
}


def word_in_sentence(word: str, en: str) -> bool:
    w = word.lower()
    forms = {w}
    for suf in ("s", "es", "ed", "ing", "er", "est", "ly"):
        forms.add(w + suf)
    if w.endswith("y") and len(w) > 2:
        forms.add(w[:-1] + "ies")
        forms.add(w[:-1] + "ied")
    if w.endswith("e"):
        forms.add(w + "d")
        forms.add(w[:-1] + "ing")
    for f in sorted(forms, key=len, reverse=True):
        if re.search(rf"(?i)(^|[^A-Za-z]){re.escape(f)}(?![A-Za-z])", en or ""):
            return True
    return False


def load_examples(level: str) -> dict:
    path = os.path.join(ROOT, "data", f"examples-{level}.json")
    if not os.path.exists(path):
        return {"meta": {"level": level, "count": 0}, "examples": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_examples(level: str, examples: dict) -> None:
    path = os.path.join(ROOT, "data", f"examples-{level}.json")
    data = {
        "meta": {
            "level": level,
            "count": len(examples),
            "note": "Hand-written B1 example sentences for CET entries that lack source examples. Lazy-loaded by review cloze.",
        },
        "examples": examples,
    }
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--merge", help="JSON of hand-written {word: {en, zh}} (or {examples: {...}})")
    ap.add_argument("--level", choices=("cet4", "cet6", "both"), default="both")
    args = ap.parse_args()

    merge = None
    if args.merge:
        merge = json.load(open(args.merge, encoding="utf-8"))
        if isinstance(merge, dict) and isinstance(merge.get("examples"), dict):
            merge = merge["examples"]

    levels = ["cet4", "cet6"] if args.level == "both" else [args.level]
    err_count = 0
    for level in levels:
        src = json.load(open(os.path.join(ROOT, "data", f"{level}.json"), encoding="utf-8"))
        examples = dict(load_examples(level).get("examples") or {})
        if merge:
            for k, v in merge.items():
                key = str(k).lower().strip()
                if isinstance(v, dict) and v.get("en") and v.get("zh"):
                    examples[key] = {"en": str(v["en"]).strip(), "zh": str(v["zh"]).strip()}

        gaps, errs = [], []
        for row in src["words"]:
            w, src_ex = row[0], (row[3] or "").strip()
            key = w.lower()
            if src_ex or key in OMIT:
                continue
            ent = examples.get(key)
            if not ent:
                gaps.append(w)
                continue
            en, zh = ent.get("en", ""), ent.get("zh", "")
            if not word_in_sentence(w, en):
                errs.append(f"{level} {w}: target word not found in: {en!r}")
            if not re.search(r"[\u4e00-\u9fff]", zh or ""):
                errs.append(f"{level} {w}: Chinese translation missing")
            if "{w}" in en or "{z}" in zh or "important for everyday life" in en:
                errs.append(f"{level} {w}: looks like a leftover template")

        # drop accidental keys for OMIT headwords
        for k in list(examples):
            if k in OMIT:
                del examples[k]

        save_examples(level, examples)
        print(f"{level}: {len(examples)} fill-ins; {len(gaps)} gaps (cloze skipped); {len(errs)} errors")
        if gaps:
            print("  gaps:", ", ".join(gaps[:30]) + ("…" if len(gaps) > 30 else ""))
        for e in errs:
            print("  ERR:", e)
        err_count += len(errs)

    return 1 if err_count else 0


if __name__ == "__main__":
    sys.exit(main())
