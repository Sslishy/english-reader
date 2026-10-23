#!/usr/bin/env python3
"""Rebuild data/cet4.json and data/cet6.json from KyleBing/english-vocabulary (BSD-3-Clause).

Usage:  python3 scripts/build_wordlists.py [path/to/四级.jsonl path/to/六级.jsonl]
Without arguments the two source files are downloaded from GitHub.
Only standard library is used. Output format (compact, array-of-arrays):
  {"meta": {...}, "fields": ["w","p","zh","ex","exzh"], "words": [[word, phonetic, meaning_zh, example, example_zh], ...]}
Order follows the source file (its first block is the core/high-frequency list); duplicates are dropped,
and CET-6 excludes words already in CET-4.
"""
import json, sys, os, re, urllib.request, urllib.parse

BASE = "https://raw.githubusercontent.com/KyleBing/english-vocabulary/master/full_line_jsonl/sentence/%E6%AD%A3%E5%BA%8F/"
SRC = {"cet4": "四级", "cet6": "六级"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name, path=None):
    if path:
        text = open(path, encoding="utf-8").read()
    else:
        url = BASE + urllib.parse.quote(name) + ".jsonl"
        print("downloading", url)
        text = urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
    return [json.loads(l) for l in text.splitlines() if l.strip()]


def zh_of(e):
    parts = []
    for t in e.get("translations") or []:
        tr = (t.get("translation") or "").strip()
        if not tr:
            continue
        ty = (t.get("type") or "").strip()
        parts.append((ty + ". " if ty else "") + tr)
    s = "；".join(parts)
    return s[:60] + ("…" if len(s) > 60 else "")


def example_of(e):
    best = None
    for s in e.get("sentences") or []:
        en = (s.get("sentence") or "").strip()
        zh = (s.get("translation") or "").strip()
        if not en or len(en) > 110 or len(en) < 12:
            continue
        if best is None or abs(len(en) - 60) < abs(len(best[0]) - 60):
            best = (en, zh)
    return best or ("", "")


def build(entries, exclude=()):
    seen, out = set(exclude), []
    for e in entries:
        w = (e.get("word") or "").strip()
        k = w.lower()
        if not w or k in seen or not re.match(r"^[A-Za-z][A-Za-z' .\-]*$", w):
            continue
        zh = zh_of(e)
        if not zh:
            continue
        seen.add(k)
        ph = (e.get("uk") or e.get("us") or "").strip()
        ex, exzh = example_of(e)
        out.append([w, ph, zh, ex, exzh])
    return out


def main():
    paths = sys.argv[1:3] if len(sys.argv) >= 3 else [None, None]
    c4 = build(load(SRC["cet4"], paths[0]))
    c6 = build(load(SRC["cet6"], paths[1]), exclude={r[0].lower() for r in c4})
    for key, rows, label in (("cet4", c4, "CET-4 四级"), ("cet6", c6, "CET-6 六级（不含四级已有词）")):
        doc = {
            "meta": {
                "name": label,
                "count": len(rows),
                "source": "https://github.com/KyleBing/english-vocabulary (full_line_jsonl/sentence/正序)",
                "license": "BSD-3-Clause, Copyright (c) 2022-2026, KyleBing — see data/LICENSE-english-vocabulary.txt",
            },
            "fields": ["w", "p", "zh", "ex", "exzh"],
            "words": rows,
        }
        p = os.path.join(ROOT, "data", key + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        print(p, len(rows), os.path.getsize(p) // 1024, "KB")


if __name__ == "__main__":
    main()
