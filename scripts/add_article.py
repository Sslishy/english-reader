#!/usr/bin/env python3
"""Validate a daily-reading article JSON, copy it into articles/ and update articles/index.json.

Usage:
  python3 scripts/add_article.py path/to/article.json      # validate + add (replaces an existing article of the same date)
  python3 scripts/add_article.py --check                   # validate every article listed in articles/index.json
  python3 scripts/add_article.py --validate-only file.json # only validate

Standard library only. See README.md for the schema.
"""
import json, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "articles")
INDEX = os.path.join(ART_DIR, "index.json")

STR_FIELDS = ["date", "title", "title_zh", "source_name", "source_url", "level", "summary_zh"]
KW_FIELDS = ["word", "phonetic", "meaning_zh"]


def validate(a):
    """Return a list of error strings (empty list = valid)."""
    errs = []
    if not isinstance(a, dict):
        return ["top level must be a JSON object"]
    for k in STR_FIELDS:
        if k not in a:
            errs.append(f"missing field: {k}")
        elif not isinstance(a[k], str) or not a[k].strip():
            errs.append(f"field {k} must be a non-empty string")
    d = a.get("date")
    if isinstance(d, str):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            errs.append("date must look like YYYY-MM-DD")
        else:
            try:
                datetime.date.fromisoformat(d)
            except ValueError:
                errs.append("date is not a real calendar date")
    u = a.get("source_url")
    if isinstance(u, str) and not re.match(r"^https?://", u):
        errs.append("source_url must start with http:// or https://")
    p = a.get("paragraphs")
    if not isinstance(p, list) or not p:
        errs.append("paragraphs must be a non-empty list of strings")
    elif not all(isinstance(x, str) and x.strip() for x in p):
        errs.append("every paragraph must be a non-empty string")
    kw = a.get("key_words")
    if not isinstance(kw, list):
        errs.append("key_words must be a list")
    else:
        for i, w in enumerate(kw):
            if not isinstance(w, dict):
                errs.append(f"key_words[{i}] must be an object")
                continue
            for k in KW_FIELDS:
                if not isinstance(w.get(k), str) or (k != "phonetic" and not w.get(k, "").strip()):
                    errs.append(f"key_words[{i}].{k} must be a string" + ("" if k == "phonetic" else " (non-empty)"))
    extra = set(a) - set(STR_FIELDS) - {"paragraphs", "key_words"}
    if extra:
        print("warning: unknown fields kept as-is:", ", ".join(sorted(extra)), file=sys.stderr)
    return errs


def load_index():
    if not os.path.exists(INDEX):
        return []
    with open(INDEX, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit("articles/index.json must be a JSON list")
    return data


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def add(path):
    with open(path, encoding="utf-8") as f:
        a = json.load(f)
    errs = validate(a)
    if errs:
        print("INVALID article:\n  - " + "\n  - ".join(errs), file=sys.stderr)
        return 1
    os.makedirs(ART_DIR, exist_ok=True)
    fname = a["date"] + ".json"
    save_json(os.path.join(ART_DIR, fname), a)
    idx = [e for e in load_index() if isinstance(e, dict) and e.get("date") != a["date"]]
    idx.append({"date": a["date"], "title": a["title"], "file": fname})
    idx.sort(key=lambda e: e.get("date", ""), reverse=True)
    save_json(INDEX, idx)
    print(f"added articles/{fname}; index now has {len(idx)} article(s), newest {idx[0]['date']}")
    return 0


def check_all():
    bad = 0
    idx = load_index()
    dates = [e.get("date") for e in idx]
    if dates != sorted(dates, reverse=True):
        print("index.json is not sorted newest first", file=sys.stderr); bad += 1
    if len(set(dates)) != len(dates):
        print("index.json has duplicate dates", file=sys.stderr); bad += 1
    for e in idx:
        p = os.path.join(ART_DIR, e.get("file", ""))
        if not os.path.exists(p):
            print("missing file:", p, file=sys.stderr); bad += 1; continue
        with open(p, encoding="utf-8") as f:
            errs = validate(json.load(f))
        if errs:
            print(e["file"], "INVALID:", errs, file=sys.stderr); bad += 1
        else:
            print(e["file"], "ok")
    return 1 if bad else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(2)
    if args[0] == "--check":
        sys.exit(check_all())
    if args[0] == "--validate-only":
        with open(args[1], encoding="utf-8") as f:
            errs = validate(json.load(f))
        print("valid" if not errs else "INVALID:\n  - " + "\n  - ".join(errs)); sys.exit(1 if errs else 0)
    sys.exit(add(args[0]))
