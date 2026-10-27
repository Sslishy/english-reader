#!/usr/bin/env python3
"""Fill data/examples-cet{4,6}.json for CET words that still have no example sentence.

Prefer editing the generated English/Chinese by hand for quality. The review cloze
question uses: vocab.sentence → CET list ex field → these JSON files.
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEMPLATES = {
    "v": [
        ("People often {w} when they face a hard problem.", "人们面对难题时常常会{z}。"),
        ("She tried to {w} in a calm and careful way.", "她试着冷静而仔细地{z}。"),
        ("We need to {w} before we make a final decision.", "我们在做最终决定前需要{z}。"),
    ],
    "n": [
        ("This {w} is important for everyday life.", "这个{z}对日常生活很重要。"),
        ("They talked about the {w} for a long time.", "他们就这个{z}讨论了很久。"),
        ("A clear {w} can help students learn faster.", "清楚的{z}能帮助学生学得更快。"),
    ],
    "adj": [
        ("The situation looks {w} to many young people.", "对很多年轻人来说，这种情况看起来很{z}。"),
        ("It was a {w} day for the whole family.", "对全家来说，那是{z}的一天。"),
        ("Her answer sounded {w} but still useful.", "她的回答听起来{z}，但仍然有用。"),
    ],
    "adv": [
        ("He spoke {w} during the short meeting.", "他在短会上{z}发言。"),
        ("The numbers changed {w} last year.", "去年这些数字{z}变化了。"),
        ("She explained the main idea {w} again.", "她再次{z}解释了主要意思。"),
    ],
    "other": [
        ("Students should remember the word \"{w}\" in this lesson.", "学生应记住本课中的单词“{w}”。"),
        ("You will see \"{w}\" in many news articles.", "你会在很多新闻文章里看到“{w}”。"),
    ],
}


def pos(zh):
    z = (zh or "").lstrip().lower()
    if z.startswith("adv"):
        return "adv"
    if z.startswith(("adj", "a.")):
        return "adj"
    if z.startswith(("prep", "conj", "pron", "num", "art")):
        return "other"
    if z.startswith(("vt.", "vi.", "v.", "v ")):
        return "v"
    if z.startswith(("n.", "n ")):
        return "n"
    # Chinese-only gloss: guess from endings
    if z.endswith("地") or "地；" in z or "地," in z:
        return "adv"
    if z.endswith("的") or "的；" in z:
        return "adj"
    return "other"


def zh_core(zh):
    z = re.sub(r"^[a-zA-Z./&\s]+", "", zh or "")
    z = re.split(r"[；;，,]", z)[0].strip()
    return z or "……"


def make(word, zh, i):
    tpls = TEMPLATES[pos(zh)]
    en_t, zh_t = tpls[i % len(tpls)]
    en, zh_out = en_t.format(w=word), zh_t.format(z=zh_core(zh), w=word)
    if word.lower() not in en.lower():
        en = f"Please remember the word {word} in this sentence."
        zh_out = f"请记住这句话中的单词{word}。"
    return {"en": en, "zh": zh_out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--level", choices=("cet4", "cet6", "both"), default="both")
    args = ap.parse_args()
    levels = ["cet4", "cet6"] if args.level == "both" else [args.level]
    for level in levels:
        src = json.load(open(os.path.join(ROOT, "data", f"{level}.json"), encoding="utf-8"))
        path = os.path.join(ROOT, "data", f"examples-{level}.json")
        cur = {"meta": {}, "examples": {}}
        if os.path.exists(path) and not args.force:
            cur = json.load(open(path, encoding="utf-8"))
            cur.setdefault("examples", {})
        added = 0
        for i, row in enumerate(src["words"]):
            w, zh, ex = row[0], row[2], (row[3] or "").strip()
            key = w.lower()
            if ex:
                continue
            if key in cur["examples"] and not args.force:
                continue
            cur["examples"][key] = make(w, zh, i)
            added += 1
        cur["meta"] = {
            "level": level,
            "count": len(cur["examples"]),
            "note": "Fill-in examples for CET entries that lack source sentences. Lazy-loaded by review cloze.",
        }
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
        print(f"{level}: {added} added, {len(cur['examples'])} total → {path}")


if __name__ == "__main__":
    main()
