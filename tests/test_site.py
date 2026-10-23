#!/usr/bin/env python3
"""End-to-end test with Playwright (headless Chromium) over a local http.server.

  pip install playwright && playwright install chromium     # or set CHROME=/path/to/chrome
  python3 tests/test_site.py            # deterministic run: dictionary APIs are mocked
  python3 tests/test_site.py --live     # additionally do one real (unmocked) online lookup

Uses ?today=YYYY-MM-DD to simulate several days of spaced repetition.
"""
import json, os, socket, subprocess, sys, time, tempfile, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = "--live" in sys.argv
results, errors = [], []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


PORT = free_port()
server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
BASE = f"http://127.0.0.1:{PORT}/"

# ---------- mocked dictionary services ----------
FAKE_ZH = {"emission": "排放；排放物", "sobering": "令人清醒的", "scenario": "情景；设想", "farming": "农业", "consolidation": "巩固", "goal": "目标"}


def mock_routes(ctx):
    def dictapi(route):
        w = route.request.url.rsplit("/", 1)[-1].split("?")[0].lower()
        lemma = {"emissions": "emission"}.get(w, w)
        if lemma in FAKE_ZH:
            body = [{"word": lemma, "phonetic": "/fake/", "phonetics": [{"text": "/fake/", "audio": ""}],
                     "meanings": [{"partOfSpeech": "noun", "definitions": [{"definition": f"definition of {lemma}", "example": f"an example with {lemma}"}]}]}]
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        else:
            route.fulfill(status=404, content_type="application/json", body='{"title":"No Definitions Found"}')

    def mymemory(route):
        m = re.search(r"[?&]q=([^&]+)", route.request.url)
        w = m.group(1).lower() if m else ""
        zh = FAKE_ZH.get(w, "")
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"responseStatus": 200, "responseData": {"translatedText": zh}, "matches": []}))

    ctx.route(re.compile(r"https://api\.dictionaryapi\.dev/.*"), dictapi)
    ctx.route(re.compile(r"https://api\.mymemory\.translated\.net/.*"), mymemory)
    ctx.route(re.compile(r"https://(en|zh)\.wiktionary\.org/.*"), lambda r: r.fulfill(status=404, body="{}"))
    ctx.route(re.compile(r"https://(dict\.youdao\.com|commons\.wikimedia\.org)/.*"), lambda r: r.fulfill(status=204, body=""))


def attach(page, tag):
    page.on("pageerror", lambda e: errors.append(f"{tag} pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"{tag} console.{m.type}: {m.text}") if m.type == "error" else None)


def vocab(page):
    return page.evaluate("ER.getVocab()")


def word(page, w):
    return page.evaluate("w=>{var v=ER.findWord(w);return v?JSON.parse(JSON.stringify(v)):null}", w)


def goto(page, day, hash_="#/read"):
    page.goto(f"{BASE}?today={day}{hash_}")
    page.wait_for_function("window.ER && ER.today")


def run_session(page, wrong=(), allow_retry_wrong=False, max_steps=200):
    """Click through the current review session. Words in `wrong` are answered wrongly on their first attempt."""
    seen_types, steps, retries = set(), 0, []
    page.click("#btnStart")
    while steps < max_steps:
        steps += 1
        page.wait_for_function("document.querySelector('#qCard,#btnGotIt,#summaryCard')")
        if page.locator("#summaryCard").count():
            break
        if page.locator("#btnGotIt").count():
            page.click("#btnGotIt"); continue
        st = page.evaluate("(()=>{var s=ER.views.review.state();var it=s.queue[s.idx];return {word:it.word,type:it.type,first:it.first,answer:it.answer||null}})()")
        seen_types.add(st["type"])
        bad = st["first"] and st["word"] in wrong
        if not st["first"]:
            retries.append(st["word"])
        if st["type"] == "spell":
            page.fill("#spellInput", ("zz" + st["word"]) if bad else st["word"].upper())  # upper: case-insensitive check
            page.click("#btnCheck")
        else:
            opts = page.locator(".opts button")
            target = None
            for i in range(opts.count()):
                o = opts.nth(i).get_attribute("data-opt")
                if (o == st["answer"]) != bad:
                    target = opts.nth(i); break
            target.click()
        page.wait_for_selector("#btnNext:not([hidden])")
        fb = page.inner_text("#feedback")
        if bad:
            assert "正确答案" in fb, fb
        cur = page.evaluate("(()=>{var s=ER.views.review.state();return s?s.idx:-1})()")
        try:
            page.click("#btnNext", timeout=1500)
        except Exception:
            pass
        page.wait_for_function(f"(()=>{{var s=ER.views.review.state();return !s || s.idx!=={cur}}})()")
    return seen_types, retries


with sync_playwright() as p:
    exe = os.environ.get("CHROME")
    try:
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
    except Exception:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(accept_downloads=True, viewport={"width": 1100, "height": 900})
    mock_routes(ctx)
    page = ctx.new_page(); attach(page, "desktop")

    # ---------- 1. newest article ----------
    idx = json.load(open(os.path.join(ROOT, "articles/index.json"), encoding="utf-8"))
    goto(page, "2026-10-23")
    page.wait_for_selector("#articleReader h2")
    check("newest article loads", idx[0]["title"].split(",")[0] in page.inner_text("#articleReader h2"), page.inner_text("#articleReader h2"))
    check("archive lists articles", page.locator("#archiveList li").count() == len(idx))
    check("key words rendered", page.locator(".kw").count() >= 8)
    check("source link points to real article", page.locator(f'a[href="{json.load(open(os.path.join(ROOT, "articles", idx[0]["file"]), encoding="utf-8"))["source_url"]}"]').count() == 1)
    check("nav badge hidden with empty vocab", page.locator("#dueBadge").is_hidden())

    # ---------- 2. lookup popup on article ----------
    page.locator('#articleReader .w[data-w="emissions"]').first.dblclick()
    page.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    pop = page.inner_text("#pop")
    check("lookup popup shows word + Chinese", "emission" in pop and ("排放" in pop), pop[:120].replace("\n", " | "))
    check("popup shows CET word-list meaning", "四六级词库" in pop)
    page.click("#pop [data-act=add]")
    v = word(page, "emission")
    check("added word enters review queue (stage 0, due today)", v and v["srs"]["stage"] == 0 and v["srs"]["due"] == "2026-10-23", str(v and v["srs"]))
    check("badge shows 1 due", page.inner_text("#dueBadge") == "1" and page.locator("#dueBadge").is_visible())
    check("word highlighted in article", page.locator('#articleReader .w.known[data-w="emissions"]').count() >= 1)
    page.mouse.click(5, 600)
    check("popup closes on outside click", page.locator("#pop.show").count() == 0)
    # key word button
    page.click('button[data-kwadd="scenario"]')
    check("key word added from list", word(page, "scenario") is not None and word(page, "scenario")["zh"].startswith("n."))
    check("badge shows 2 due", page.inner_text("#dueBadge") == "2")

    # ---------- 3. day 1 review: due words + 10 new CET-4 words ----------
    page.click('a[data-tab="review"]')
    page.wait_for_selector("#statDue")
    check("review home shows 2 due / 10 new", page.inner_text("#statDue") == "2" and page.inner_text("#statNew") == "10")
    types, retries = run_session(page, wrong={"emission"})
    check("all three question types used in session", types == {"spell", "en2zh", "zh2en"}, str(types))
    vs = vocab(page)
    cet_new = [x for x in vs if x["source"] == "cet4"]
    check("10 new CET-4 words added", len(cet_new) == 10, ", ".join(x["word"] for x in cet_new))
    check("new words have phonetic + Chinese", all(x["zh"] for x in cet_new) and sum(1 for x in cet_new if x["phonetic"]) >= 8)
    check("new words scheduled after first test (stage 1, due tomorrow)", all(x["srs"]["stage"] == 1 and x["srs"]["due"] == "2026-10-24" for x in cet_new))
    e = word(page, "emission")
    check("wrong answer -> stage 0, due tomorrow", e["srs"]["stage"] == 0 and e["srs"]["due"] == "2026-10-24" and e["srs"]["lapses"] == 1, str(e["srs"]))
    check("wrong word reappeared later in same session", "emission" in retries, str(retries))
    s = word(page, "scenario")
    check("correct answer advances stage (0->1, due +1d)", s["srs"]["stage"] == 1 and s["srs"]["due"] == "2026-10-24", str(s["srs"]))
    check("summary lists reset word", "emission" in page.inner_text("#sumReset"))
    check("summary counts", page.inner_text("#sumCorrect") == "11" and page.inner_text("#sumWrong") == "1",
          page.inner_text("#sumCorrect") + "/" + page.inner_text("#sumWrong"))
    check("badge cleared after session", page.locator("#dueBadge").is_hidden())
    cal = page.locator(".cal div")
    check("calendar shows 12 due tomorrow", cal.count() == 14 and cal.nth(1).locator("b").inner_text() == "12")
    page.click("#btnHome")
    check("same day: nothing due, no more new words", "完成" in page.inner_text("#reviewBox"))

    # ---------- 4. day 2: CET-6 toggle, everything due ----------
    goto(page, "2026-10-24", "#/review")
    page.wait_for_selector("#statDue")
    check("day 2 badge = 12 due", page.inner_text("#dueBadge") == "12")
    page.check("#optCet6")
    page.select_option("#optNewPer", "10")
    page.wait_for_selector("#statNew")
    # pick a CET-4 new word to answer wrong at stage 1 -> reset
    victim = cet_new[0]["word"]
    run_session(page, wrong={victim})
    vs = vocab(page)
    lv = {x["source"] for x in vs}
    check("CET-6 words appear when toggled", "cet6" in lv and sum(1 for x in vs if x["source"] == "cet6") == 5,
          ", ".join(x["word"] for x in vs if x["source"] == "cet6"))
    vv = word(page, victim)
    check("wrong at stage 1 resets to 0", vv["srs"]["stage"] == 0 and vv["srs"]["due"] == "2026-10-25", str(vv["srs"]))
    s = word(page, "scenario")
    check("day 2 correct: stage 2, due +2d (10-26)", s["srs"]["stage"] == 2 and s["srs"]["due"] == "2026-10-26", str(s["srs"]))

    # ---------- 5. follow 'emission' through the whole Ebbinghaus ladder ----------
    page.click("#btnHome"); page.select_option("#optNewPer", "0")
    expected = []
    day = "2026-10-24"  # emission was answered correctly on day 2 -> stage1, due 10-25
    e = word(page, "emission")
    check("emission day2: stage 1 due 10-25", e["srs"]["stage"] == 1 and e["srs"]["due"] == "2026-10-25", str(e["srs"]))
    ladder_ok = True; log = []
    for exp_stage, gap in [(2, 2), (3, 4), (4, 7), (5, 15), (6, 30)]:
        day = e["srs"]["due"]
        # the day before it is due, it must not be in the queue
        prev = page.evaluate(f"SRS.addDays('{day}',-1)")
        goto(page, prev, "#/review"); page.wait_for_selector("#statDue")
        not_due = page.evaluate(f"SRS.dueList(ER.getVocab(),'{prev}',0).every(v=>v.word!=='emission')")
        goto(page, day, "#/review"); page.wait_for_selector("#statDue")
        due_now = page.evaluate(f"SRS.dueList(ER.getVocab(),'{day}',0).some(v=>v.word==='emission')")
        if page.locator("#btnStart").count():
            run_session(page)
        e = word(page, "emission")
        want_due = page.evaluate(f"SRS.addDays('{day}',{gap})")
        ok = not_due and due_now and e["srs"]["stage"] == exp_stage and e["srs"]["due"] == want_due
        log.append(f"{day}->stage{e['srs']['stage']} due {e['srs']['due']}")
        ladder_ok &= ok
    check("intervals 1,2,4,7,15,30 days then mastered", ladder_ok, "; ".join(log))
    page.click('a[data-tab="vocab"]'); page.wait_for_selector("#vocabList .vitem")
    check("vocab page shows 已掌握", "已掌握" in page.inner_text("#vocabList"), page.inner_text("#vocabList")[:150].replace("\n"," | "))
    # mastered word answered wrong -> reset to 0 and re-asked in session
    day = e["srs"]["due"]
    goto(page, day, "#/review"); page.wait_for_selector("#statDue")
    _, retries = run_session(page, wrong={"emission"})
    e = word(page, "emission")
    check("mastered word wrong -> stage 0 due tomorrow + re-asked", e["srs"]["stage"] == 0 and e["srs"]["due"] == page.evaluate(f"SRS.addDays('{day}',1)") and "emission" in retries, str(e["srs"]))
    check("cap: at most 30 due per session", page.evaluate("SRS.dueList(Array.from({length:50},(_, i)=>({word:'w'+i,srs:{due:'2026-01-01',stage:0}})),'2026-10-23',30).length") == 30)

    # ---------- 6. export / import round trip ----------
    goto(page, day, "#/vocab"); page.wait_for_selector("#btnBackup")
    before = vocab(page)
    seen_before = page.evaluate("ER.lsGet('er_cet_seen',{})")
    with page.expect_download() as d:
        page.click("#btnBackup")
    path = d.value.path()
    backup = json.load(open(path, encoding="utf-8"))
    check("backup file has vocab + progress", backup["app"] == "english-reader" and len(backup["data"]["vocab"]) == len(before))
    page.evaluate("localStorage.clear()")
    page.reload(); page.wait_for_selector("#btnBackup")
    check("cleared storage -> empty vocab", len(vocab(page)) == 0)
    with page.expect_file_chooser() as fc:
        page.click("#btnImportMerge")
    fc.value.set_files(path)
    page.wait_for_function(f"ER.getVocab().length==={len(before)}")
    after = vocab(page)
    norm = lambda L: sorted(json.dumps(x, sort_keys=True, ensure_ascii=False) for x in L)
    check("import restores identical vocab + SRS progress", norm(after) == norm(before))
    check("import restores seen CET words", page.evaluate("ER.lsGet('er_cet_seen',{})") == seen_before)
    # merge keeps newer progress: modify locally, import old backup -> local newer wins
    page.evaluate("(()=>{var v=ER.findWord('scenario');v.srs.last='2099-01-01';v.srs.stage=5;ER.saveVocab();})()")
    with page.expect_file_chooser() as fc:
        page.click("#btnImportMerge")
    fc.value.set_files(path)
    page.wait_for_timeout(400)
    check("merge import keeps newer local progress", word(page, "scenario")["srs"]["stage"] == 5)
    page.on("dialog", lambda dlg: dlg.accept())
    with page.expect_file_chooser() as fc:
        page.click("#btnImportReplace")
    fc.value.set_files(path)
    page.wait_for_timeout(400)
    check("replace import restores backup exactly", norm(vocab(page)) == norm(before))
    with page.expect_download() as d:
        page.click("#btnExport")
    check("CSV export still works", "单词" in open(d.value.path(), encoding="utf-8-sig").read()[:20])

    # ---------- 7. paste mode ----------
    page.click('a[data-tab="paste"]')
    page.click("#btnSample1"); page.click("#btnRead")
    page.locator('#pasteReader .w[data-w="farming"]').first.dblclick()
    page.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    check("paste mode lookup works", "farming" in page.inner_text("#pop").lower() or "farm" in page.inner_text("#pop").lower())
    page.keyboard.press("Escape")
    page.screenshot(path="/tmp/er_paste.png")

    # ---------- 8. mobile (touch) ----------
    m = browser.new_context(viewport={"width": 390, "height": 820}, has_touch=True, is_mobile=True, device_scale_factor=2)
    mock_routes(m)
    mp = m.new_page(); attach(mp, "mobile")
    mp.goto(f"{BASE}?today=2026-10-23#/read"); mp.wait_for_selector("#articleReader h2")
    mp.locator('#articleReader .w[data-w="sobering"]').first.tap()
    mp.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    check("mobile tap opens bottom-sheet popup", mp.evaluate("document.getElementById('pop').classList.contains('sheet')"))
    check("no horizontal overflow on mobile", mp.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    mp.screenshot(path="/tmp/er_mobile_read.png")
    mp.goto(f"{BASE}?today=2026-10-23#/review"); mp.wait_for_selector("#btnStart"); mp.tap("#btnStart")
    mp.wait_for_selector("#btnGotIt"); mp.screenshot(path="/tmp/er_mobile_card.png")
    mp.tap("#btnGotIt"); mp.wait_for_selector("#btnGotIt"); mp.tap("#btnGotIt")
    mp.wait_for_selector("#qCard"); mp.screenshot(path="/tmp/er_mobile_test.png")
    page.goto(f"{BASE}?today=2026-10-23#/read"); page.wait_for_selector("#articleReader h2"); page.screenshot(path="/tmp/er_desktop_read.png", full_page=True)

    # ---------- 9. live lookup (optional, real network) ----------
    if LIVE:
        lc = browser.new_context(); lp = lc.new_page(); attach(lp, "live")
        lp.goto(f"{BASE}#/read"); lp.wait_for_selector("#articleReader h2")
        lp.locator('#articleReader .w[data-w="pessimistic"]').first.dblclick()
        lp.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')", timeout=60000)
        txt = lp.inner_text("#pop")
        check("LIVE lookup returns definition + Chinese", "pessimistic" in txt and re.search(r"[\u4e00-\u9fff]", txt), txt[:200].replace("\n", " | "))
        lp.screenshot(path="/tmp/er_live_pop.png")

    browser.close()
server.terminate()

# Network-level failures of third-party APIs in --live mode (e.g. CORS on a 429/5xx) are handled by the app's
# fallback chain and are not JavaScript errors.
errs = [e for e in errors if "favicon" not in e and "Failed to load resource" not in e
        and not (e.startswith("live console") and ("CORS policy" in e or "net::" in e))]
net = [e for e in errors if e not in errs and e.startswith("live")]
if net:
    print("note: live network errors handled by fallback:", net[:3])
check("no JS errors", not errs, "; ".join(errs[:5]))
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
