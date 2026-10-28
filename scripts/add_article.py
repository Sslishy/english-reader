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


def _norm(s):
    s = s.lower().replace("\u2019", "'").replace("\u2018", "'")
    return " ".join(re.sub(r"[^a-z0-9'\- ]", " ", s).split())


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
    pz = a.get("paragraphs_zh")
    if pz is None:
        if isinstance(p, list) and p:
            print("warning: no paragraphs_zh (whole-paragraph Chinese translation); the reader will hide the 译 / 全文对照 buttons", file=sys.stderr)
    elif not isinstance(pz, list):
        errs.append("paragraphs_zh must be a list of strings (optional field)")
    else:
        if not all(isinstance(x, str) and x.strip() for x in pz):
            errs.append("every paragraphs_zh item must be a non-empty string")
        elif not all(re.search(r"[\u4e00-\u9fff]", x) for x in pz):
            errs.append("every paragraphs_zh item must contain Chinese")
        if isinstance(p, list) and len(pz) != len(p):
            errs.append(f"paragraphs_zh has {len(pz)} item(s) but paragraphs has {len(p)}; they must match one-to-one")
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
    ph = a.get("phrases")
    if ph is not None:
        if not isinstance(ph, list):
            errs.append("phrases must be a list (optional field)")
        else:
            seen = set()
            for i, x in enumerate(ph):
                if not isinstance(x, dict):
                    errs.append(f"phrases[{i}] must be an object"); continue
                for k in ("text", "meaning_zh"):
                    if not isinstance(x.get(k), str) or not x.get(k, "").strip():
                        errs.append(f"phrases[{i}].{k} must be a non-empty string")
                t = x.get("text")
                if isinstance(t, str) and t.strip():
                    n = _norm(t)
                    if n in seen:
                        errs.append(f"phrases[{i}].text duplicates an earlier phrase: {t!r}")
                    seen.add(n)
                    if isinstance(p, list) and n not in _norm(" ".join(str(y) for y in p) + " " + str(a.get("title", ""))):
                        print(f"warning: phrases[{i}] {t!r} does not appear in the article text", file=sys.stderr)
                z = x.get("meaning_zh")
                if isinstance(z, str) and z.strip() and not re.search(r"[\u4e00-\u9fff]", z):
                    errs.append(f"phrases[{i}].meaning_zh must contain Chinese")
    extra = set(a) - set(STR_FIELDS) - {"paragraphs", "paragraphs_zh", "key_words", "phrases"}
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
