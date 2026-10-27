#!/usr/bin/env python3
"""End-to-end test with Playwright (headless Chromium) over a local http.server.

  pip install playwright && playwright install chromium     # or set CHROME=/path/to/chrome
  python3 tests/test_site.py            # deterministic run: dictionary APIs are mocked
  python3 tests/test_site.py --live     # additionally do one real (unmocked) online lookup

Uses ?today=YYYY-MM-DD to simulate several days of spaced repetition.
"""
import json, os, socket, subprocess, sys, time, tempfile, re
from urllib.parse import unquote_plus
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
FAKE_ZH = {"emission": "排放；排放物", "sobering": "令人清醒的", "scenario": "情景；设想", "farming": "农业", "consolidation": "巩固", "goal": "目标",
           # phrases (MyMemory en|zh-CN); anything else -> empty translation = "translation failed"
           "sobering message": "发人深省的信息", "carbon emissions": "碳排放", "make ends meet": "勉强维持生计",
           "climate summit": "气候峰会", "play a complementary role": "发挥补充作用"}


def mock_routes(ctx, translators=None):
    """Mock dictionary + translation APIs.

    translators: which online services succeed with FAKE_ZH. Default ("youdao",) so the
    fallback chain is exercised but existing phrase tests stay stable. Pass () for total
    online failure, or ("google",) to force a later service, etc.
    """
    ok = set(translators if translators is not None else ("youdao",))

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
        w = unquote_plus(m.group(1)).lower() if m else ""
        zh = FAKE_ZH.get(w, "") if "mymemory" in ok else ""
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"responseStatus": 200, "responseData": {"translatedText": zh}, "matches": []}))

    def youdao(route):
        q = ""
        try:
            q = unquote_plus(re.search(r"(?:^|&)q=([^&]*)", route.request.post_data or "").group(1)).lower()
        except Exception:
            pass
        if "youdao" in ok and q in FAKE_ZH:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"errorCode": "0", "translation": [FAKE_ZH[q]], "query": q, "l": "en2zh-CHS"}))
        else:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"errorCode": "207", "translation": []}))

    def google(route):
        m = re.search(r"[?&]q=([^&]+)", route.request.url)
        w = unquote_plus(m.group(1)).lower() if m else ""
        if "google" in ok and w in FAKE_ZH:
            route.fulfill(status=200, content_type="application/json", body=json.dumps([FAKE_ZH[w]]))
        else:
            route.fulfill(status=429, content_type="application/json", body='[]')

    ctx.route(re.compile(r"https://api\.dictionaryapi\.dev/.*"), dictapi)
    ctx.route(re.compile(r"https://api\.mymemory\.translated\.net/.*"), mymemory)
    ctx.route(re.compile(r"https://aidemo\.youdao\.com/.*"), youdao)
    ctx.route(re.compile(r"https://translate\.googleapis\.com/.*"), google)
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


def drag_select(page, sel_from, sel_to):
    """Real mouse drag from the start of one word span to the end of another."""
    a_loc, b_loc = page.locator(sel_from).first, page.locator(sel_to).first
    a_loc.scroll_into_view_if_needed()
    a, b = a_loc.bounding_box(), b_loc.bounding_box()
    page.mouse.move(a["x"] + 2, a["y"] + a["height"] / 2)
    page.mouse.down()
    page.mouse.move((a["x"] + b["x"]) / 2 + 1, b["y"] + b["height"] / 2, steps=4)
    page.mouse.move(b["x"] + b["width"] - 2, b["y"] + b["height"] / 2, steps=4)
    page.mouse.up()


def wait_phrase_pop(page):
    page.wait_for_function("document.querySelector('#pop.show.phrase') && !document.querySelector('#pop .spinner')")


def force_type(page, w, t):
    """Set srs.qn so that SRS.qtype() gives question type t for entry w."""
    page.evaluate("""([w,t])=>{var v=ER.findWord(w);var n=(SRS.TYPES||[]).length||5;for(var q=0;q<n*2;q++){if(SRS.qtype(v.word,{qn:q})===t){v.srs.qn=q;ER.saveVocab();return;} } throw new Error('cannot force type '+t+' for '+w);}""", [w, t])


def run_session(page, wrong=(), allow_retry_wrong=False, max_steps=200, log=None, tap=False, shots=None):
    """Click through the current review session. Words in `wrong` are answered wrongly on their first attempt."""
    seen_types, steps, retries = set(), 0, []
    act = (lambda loc: loc.tap()) if tap else (lambda loc: loc.click())
    act(page.locator("#btnStart"))
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
        entry = {"word": st["word"], "type": st["type"], "first": st["first"], "bad": bad}
        if shots is not None and st["type"] not in shots:
            shots[st["type"]] = f"/tmp/er_mobile_q_{st['type']}.png"; page.screenshot(path=shots[st["type"]])
        if st["type"] == "spell":
            if " " in st["word"]:   # phrase: case, punctuation and extra spaces must be ignored
                ans = ("zz " + st["word"]) if bad else "  " + st["word"].upper().replace(" ", "   ") + " !!"
            else:
                ans = ("zz" + st["word"]) if bad else st["word"].upper()  # upper: case-insensitive check
            page.fill("#spellInput", ans)
            act(page.locator("#btnCheck"))
        elif st["type"] == "cloze":
            ans = st.get("answer") or st["word"]
            page.fill("#clozeInput", ("zz" + ans) if bad else ans)
            act(page.locator("#btnCheck"))
        elif st["type"] == "gaps":
            if bad:
                page.fill("#gapsFull", "zzzz")
            else:
                if page.locator(".gap-in").count():
                    page.evaluate("""(w)=>{
                      document.querySelectorAll('.gap-in').forEach(inp=>{
                        inp.value = w.charAt(+inp.dataset.i);
                      });
                    }""", st["word"])
                else:
                    page.fill("#gapsFull", st["word"])
            act(page.locator("#btnCheck"))
        elif st["type"] == "order":
            n = page.locator("#orderPool .tile").count()
            for i in (reversed(range(n)) if bad else range(n)):
                act(page.locator(f'#orderPool .tile[data-i="{i}"]'))
            entry["placed"] = page.evaluate("Array.from(document.querySelectorAll('#orderAns .tile')).map(t=>t.textContent).join(' ')")
            act(page.locator("#btnCheck"))
        else:
            entry["opts"] = page.evaluate("Array.from(document.querySelectorAll('.opts button')).map(b=>b.dataset.opt)")
            opts = page.locator(".opts button")
            target = None
            for i in range(opts.count()):
                o = opts.nth(i).get_attribute("data-opt")
                if (o == st["answer"]) != bad:
                    target = opts.nth(i); break
            act(target)
        page.wait_for_selector("#btnNext:not([hidden])")
        fb = page.inner_text("#feedback")
        entry["ok"] = "正确！" in fb
        entry["diff"] = page.locator("#diff").count() > 0
        if log is not None:
            log.append(entry)
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
    # the steps below use the words of the first article (2026-10-23); newer daily articles are added every day
    goto(page, "2026-10-23", "#/read/2026-10-23"); page.wait_for_selector("#articleReader h2")

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
    check("mixed question types used in session", len(types) >= 3 and bool(types & {"spell", "en2zh", "zh2en"}), str(types))
    vs = vocab(page)
    cet_new = [x for x in vs if x["source"] == "cet4"]
    check("10 new CET-4 words added", len(cet_new) == 10, ", ".join(x["word"] for x in cet_new))
    first_letters = {x["word"][0].lower() for x in cet_new}
    check("new CET words are mixed (not all same letter / not alpha-a dump)",
          len(first_letters) >= 5 and not all(x["word"][0].lower() == "a" for x in cet_new),
          ", ".join(x["word"] for x in cet_new))
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
    # updatedAt is sync bookkeeping (a replace import re-stamps it on purpose), compare the learning data itself
    norm = lambda L: sorted(json.dumps({k: v for k, v in x.items() if k != "updatedAt"}, sort_keys=True, ensure_ascii=False) for x in L)
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
    mp.goto(f"{BASE}?today=2026-10-23#/read/2026-10-23"); mp.wait_for_selector("#articleReader h2")
    mp.locator('#articleReader .w[data-w="sobering"]').first.tap()
    mp.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    check("mobile tap opens bottom-sheet popup", mp.evaluate("document.getElementById('pop').classList.contains('sheet')"))
    check("no horizontal overflow on mobile", mp.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    mp.screenshot(path="/tmp/er_mobile_read.png")
    mp.goto(f"{BASE}?today=2026-10-23#/review"); mp.wait_for_selector("#btnStart"); mp.tap("#btnStart")
    mp.wait_for_selector("#btnGotIt"); mp.screenshot(path="/tmp/er_mobile_card.png")
    mp.tap("#btnGotIt"); mp.wait_for_selector("#btnGotIt"); mp.tap("#btnGotIt")
    mp.wait_for_selector("#qCard"); mp.screenshot(path="/tmp/er_mobile_test.png")
    page.goto(f"{BASE}?today=2026-10-23#/read/2026-10-23"); page.wait_for_selector("#articleReader h2"); page.screenshot(path="/tmp/er_desktop_read.png", full_page=True)


    # ---------- 9. phrases / short sentences (fresh profile) ----------
    pc = browser.new_context(accept_downloads=True, viewport={"width": 1100, "height": 900})
    mock_routes(pc)
    pp = pc.new_page(); attach(pp, "phrase")
    goto(pp, "2026-10-23", "#/read/2026-10-23"); pp.wait_for_selector("#articleReader h2")
    AR = "#articleReader"
    # single-word drag selection on desktop: behaves as before (nothing pops up)
    box_ = pp.locator(f'{AR} .w[data-w="sobering"]').first.bounding_box()
    pp.mouse.move(box_["x"] + 2, box_["y"] + 8); pp.mouse.down(); pp.mouse.move(box_["x"] + box_["width"] - 2, box_["y"] + 8, steps=4); pp.mouse.up()
    pp.wait_for_timeout(700)
    check("desktop: single-word selection opens nothing", pp.locator("#pop.show").count() == 0)
    pp.mouse.click(5, 5)
    # multi-word drag selection -> phrase popup with mocked MyMemory translation
    drag_select(pp, f'{AR} .w[data-w="sobering"]', f'{AR} .w[data-w="sobering"] + .w')
    wait_phrase_pop(pp)
    check("drag-select 2 words opens phrase popup", pp.inner_text("#phraseText") == "sobering message", pp.inner_text("#pop")[:100].replace("\n", " | "))
    check("phrase popup shows mocked Chinese translation", pp.input_value("#phraseZh") == "发人深省的信息" and "机器翻译" in pp.inner_text("#pop"))
    check("phrase popup has speak button + not a sheet on desktop", pp.locator("#pop [data-act=psay]").count() == 1 and not pp.evaluate("document.getElementById('pop').classList.contains('sheet')"))
    pp.screenshot(path="/tmp/er_phrase_pop_desktop.png")
    check("desktop popup placed below the selection", pp.evaluate("getSelection().getRangeAt(0).getBoundingClientRect().bottom <= document.getElementById('pop').getBoundingClientRect().top"))
    pp.click("#pop [data-act=psay]")
    pp.click("#pop [data-act=padd]")
    sm = word(pp, "sobering message")
    check("phrase saved with type=phrase, zh, source sentence, due today",
          sm and sm["type"] == "phrase" and sm["zh"] == "发人深省的信息" and "delivered a sobering message" in sm["sentence"]
          and sm["srs"]["stage"] == 0 and sm["srs"]["due"] == "2026-10-23" and sm["article"] == "2026-10-23", str(sm)[:200])
    check("saved phrase highlighted in article", pp.locator(f"{AR} .w.ph").count() == 2)
    check("popup now says 已在生词本", "已在生词本" in pp.inner_text("#pop [data-act=padd]"))
    check("badge counts the phrase", pp.inner_text("#dueBadge") == "1")
    pp.keyboard.press("Escape")
    # translation failure -> user types the meaning
    drag_select(pp, f'{AR} p .w[data-w="global"]', f'{AR} p .w[data-w="global"] + .w + .w')
    wait_phrase_pop(pp)
    check("failed translation shows message + empty editable box", pp.inner_text("#phraseText") == "global climate policy"
          and ("请自己填写" in pp.inner_text("#phraseStatus") or "请参考" in pp.inner_text("#phraseStatus")) and pp.input_value("#phraseZh") == "")
    pp.click("#pop [data-act=padd]")
    check("cannot add phrase without Chinese", word(pp, "global climate policy") is None)
    pp.fill("#phraseZh", "全球气候政策")
    pp.click("#pop [data-act=padd]")
    check("user-typed Chinese saved", (word(pp, "global climate policy") or {}).get("zh") == "全球气候政策")
    pp.keyboard.press("Escape")
    # too long (triple-click a paragraph)
    pp.locator(f"{AR} > p").nth(1).click(click_count=3)
    pp.wait_for_function("document.querySelector('#pop.show.phrase')")
    check("selection > 20 words -> 'too long' message, no add button", "太长" in pp.inner_text("#pop") and pp.locator("#pop [data-act=padd]").count() == 0)
    pp.keyboard.press("Escape"); pp.mouse.click(5, 5)
    # word double-click still a word lookup
    pp.locator(f'{AR} .w[data-w="emissions"]').first.dblclick()
    pp.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    check("double-click still opens single-word lookup", "排放" in pp.inner_text("#pop") and pp.locator("#pop.phrase").count() == 0)
    pp.keyboard.press("Escape")
    # paste mode
    pp.click('a[data-tab="paste"]'); pp.click("#btnSample1"); pp.click("#btnRead")
    drag_select(pp, '#pasteReader .w[data-w="carbon"]', '#pasteReader .w[data-w="carbon"] + .w')
    wait_phrase_pop(pp)
    check("paste mode: phrase popup + translation", pp.inner_text("#phraseText") == "carbon emissions" and pp.input_value("#phraseZh") == "碳排放")
    pp.click("#pop [data-act=padd]")
    ce = word(pp, "carbon emissions")
    check("paste-mode phrase saved with sentence + highlighted", ce and ce["type"] == "phrase" and "lowers carbon emissions" in ce["sentence"]
          and pp.locator("#pasteReader .w.ph").count() == 2)
    pp.keyboard.press("Escape")
    pp.screenshot(path="/tmp/er_phrase_desktop.png")

    # ---------- 10. manual add + edit meaning ----------
    pp.click('a[data-tab="vocab"]'); pp.click("#manCard summary")
    pp.fill("#manEn", "make ends meet"); pp.click("#manTrans")
    pp.wait_for_function("document.getElementById('manZh').value!==''")
    check("manual add: auto-translate fills Chinese", pp.input_value("#manZh") == "勉强维持生计")
    pp.fill("#manNote", "Many students work part-time to make ends meet.")
    pp.click("#manAdd")
    me = word(pp, "make ends meet")
    check("manual phrase saved (type, source, note)", me and me["type"] == "phrase" and me["source"] == "manual" and "part-time" in me["note"], str(me)[:160])
    LONG = "The more you practise, the better you become."
    pp.fill("#manEn", LONG); pp.fill("#manZh", "练得越多，就会越好。"); pp.click("#manAdd")
    pp.fill("#manEn", "resilience"); pp.fill("#manZh", "韧性；恢复力"); pp.click("#manAdd")
    check("manual long sentence + single word saved", (word(pp, LONG) or {}).get("type") == "phrase" and (word(pp, "resilience") or {}).get("type") == "word")
    n_before = len(vocab(pp))
    pp.fill("#manEn", "Make Ends Meet"); pp.fill("#manZh", "x"); pp.click("#manAdd")
    check("manual duplicate (case-insensitive) rejected", len(vocab(pp)) == n_before)
    pp.fill("#manEn", ""); pp.fill("#manZh", "")
    pp.click('[data-edit="make ends meet"]'); pp.fill(".vedit-zh", "收支相抵；勉强维持生计"); pp.click('[data-save="make ends meet"]')
    check("edit Chinese meaning of existing entry", word(pp, "make ends meet")["zh"] == "收支相抵；勉强维持生计" and "收支相抵" in pp.inner_text("#vocabList"))
    pp.select_option("#vocabSrc", "phrase")
    check("filter: only phrases (5)", pp.locator("#vocabList .vitem").count() == 5 and pp.locator("#vocabList .ptag").count() == 5)
    pp.select_option("#vocabSrc", "all")
    with pp.expect_download() as d:
        pp.click("#btnExport")
    csv = open(d.value.path(), encoding="utf-8-sig").read()
    check("CSV includes phrases with type column", "make ends meet" in csv and "短语" in csv and "全球气候政策" in csv)

    # ---------- 11. phrases in review ----------
    pp.click('a[data-tab="review"]'); pp.wait_for_selector("#statDue")
    pp.select_option("#optNewPer", "0"); pp.wait_for_selector("#btnStart")
    force_type(pp, "sobering message", "en2zh")
    force_type(pp, "make ends meet", "zh2en")
    force_type(pp, "carbon emissions", "spell")
    force_type(pp, LONG, "spell")
    force_type(pp, "global climate policy", "spell")
    qlog = []
    run_session(pp, wrong={"global climate policy", LONG}, log=qlog)
    by = {}
    for e in qlog:
        by.setdefault((e["word"], e["first"]), e)
    first = lambda w: by.get((w, True), {})
    check("phrase en2zh multiple choice", first("sobering message").get("type") == "en2zh" and first("sobering message").get("ok"))
    zopts = first("make ends meet").get("opts") or []
    check("phrase zh2en multiple choice, distractors are other phrases",
          first("make ends meet").get("type") == "zh2en" and first("make ends meet").get("ok") and len(zopts) == 4 and all(" " in o for o in zopts), str(zopts))
    check("phrase dictation: case/punctuation/extra spaces ignored", first("carbon emissions").get("type") == "spell" and first("carbon emissions").get("ok"))
    check("short phrase wrong dictation shows word diff", first("global climate policy").get("type") == "spell" and not first("global climate policy").get("ok") and first("global climate policy").get("diff"))
    check("long phrase (>6 words) uses word-order tiles", first(LONG).get("type") == "order" and not first(LONG).get("ok") and first(LONG).get("diff"), str(first(LONG)))
    check("wrong phrases re-asked later in session", (("global climate policy", False) in by) and ((LONG, False) in by))
    order_retry = [e for e in qlog if e["word"] == LONG and not e["first"] and e["type"] == "order"]
    t2 = pp.evaluate("w=>{var v=ER.findWord(w);return SRS.qtype(v.word,{qn:0})}", LONG)
    g = word(pp, "global climate policy"); L = word(pp, LONG); c = word(pp, "carbon emissions")
    check("wrong phrase -> stage 0, due tomorrow, lapse counted", g["srs"]["stage"] == 0 and g["srs"]["due"] == "2026-10-24" and g["srs"]["lapses"] == 1
          and L["srs"]["stage"] == 0 and L["srs"]["lapses"] == 1, str(g["srs"]))
    check("correct phrase -> stage 1, due tomorrow", c["srs"]["stage"] == 1 and c["srs"]["due"] == "2026-10-24" and word(pp, "sobering message")["srs"]["stage"] == 1)
    # order question answered correctly: force order again for day 2
    goto(pp, "2026-10-24", "#/review"); pp.wait_for_selector("#btnStart")
    force_type(pp, LONG, "spell"); force_type(pp, "carbon emissions", "en2zh")
    qlog2 = []
    run_session(pp, log=qlog2)
    lo = [e for e in qlog2 if e["word"] == LONG]
    check("word-order question answered correctly", lo and lo[0]["type"] == "order" and lo[0]["ok"] and lo[0]["placed"] == LONG, str(lo[:1]))
    c = word(pp, "carbon emissions"); L = word(pp, LONG)
    check("day 2: phrase stage 2 due +2d; reset phrase back to stage 1", c["srs"]["stage"] == 2 and c["srs"]["due"] == "2026-10-26"
          and L["srs"]["stage"] == 1 and L["srs"]["due"] == "2026-10-25", f'{c["srs"]} / {L["srs"]}')

    # ---------- 12. phrase backup round trip + legacy data ----------
    goto(pp, "2026-10-24", "#/vocab"); pp.wait_for_selector("#btnBackup")
    before = vocab(pp)
    with pp.expect_download() as d:
        pp.click("#btnBackup")
    bpath = d.value.path()
    bk = json.load(open(bpath, encoding="utf-8"))
    check("backup contains phrases with type", sum(1 for x in bk["data"]["vocab"] if x.get("type") == "phrase") == 5)
    pp.evaluate("localStorage.clear()"); pp.reload(); pp.wait_for_selector("#btnBackup")
    with pp.expect_file_chooser() as fc:
        pp.click("#btnImportMerge")
    fc.value.set_files(bpath)
    pp.wait_for_function(f"ER.getVocab().length==={len(before)}")
    check("phrase backup round-trip identical", norm(vocab(pp)) == norm(before))
    legacy = [{"word": "look forward to", "zh": "期待"}, {"word": "goal", "zh": "目标", "srs": {"stage": 2, "due": "2026-10-30"}}]
    pp.evaluate("v=>localStorage.setItem('er_vocab',JSON.stringify(v))", legacy); pp.reload(); pp.wait_for_selector("#btnBackup")
    lv = {x["word"]: x for x in vocab(pp)}
    check("legacy data without type: phrase/word inferred, progress kept",
          lv["look forward to"]["type"] == "phrase" and lv["goal"]["type"] == "word" and lv["goal"]["srs"]["stage"] == 2 and lv["look forward to"]["srs"]["due"] == "2026-10-24")
    with pp.expect_file_chooser() as fc:
        pp.click("#btnImportMerge")
    fc.value.set_files(bpath)
    pp.wait_for_function(f"ER.getVocab().length==={len(before) + 2}")
    check("merge import of phrase backup into legacy data", word(pp, "make ends meet") is not None and word(pp, "look forward to") is not None)

    # ---------- 13. mobile phrase flow ----------
    mc = browser.new_context(viewport={"width": 390, "height": 760}, has_touch=True, is_mobile=True, device_scale_factor=2)
    mock_routes(mc)
    mq = mc.new_page(); attach(mq, "mobile-phrase")
    mq.goto(f"{BASE}?today=2026-10-23#/read/2026-10-23"); mq.wait_for_selector("#articleReader h2")
    check("mobile: native text selection enabled in reader", mq.evaluate("getComputedStyle(document.getElementById('articleReader')).userSelect") != "none")
    mq.locator('#articleReader .w[data-w="sobering"]').first.tap()
    mq.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    check("mobile: tap still opens word lookup", mq.locator("#pop.phrase").count() == 0 and "sobering" in mq.inner_text("#pop").lower())
    mq.evaluate("ER.hidePop()")
    # simulate long-press + dragging handles: selection made while finger is down, sheet only after touchend
    SEL_JS = """([a,b])=>{var A=document.querySelectorAll('#articleReader .w[data-w="'+a+'"]'), B=document.querySelectorAll('#articleReader .w[data-w="'+b+'"]');
      var x=A[A.length-1], y=B[B.length-1]; var r=document.createRange(); r.setStart(x.firstChild,0); r.setEnd(y.firstChild,y.firstChild.length);
      var s=getSelection(); s.removeAllRanges(); s.addRange(r);}"""
    mq.evaluate("document.querySelectorAll('#articleReader .w[data-w=\"summit\"]')[0].scrollIntoView({block:'end'})")
    mq.evaluate("document.dispatchEvent(new Event('touchstart'))")
    mq.evaluate(SEL_JS, ["climate", "summit"])
    mq.wait_for_timeout(1000)
    check("mobile: no popup while finger still down (native menu not fought)", mq.locator("#pop.show").count() == 0)
    mq.evaluate("document.dispatchEvent(new Event('touchend'))")
    wait_phrase_pop(mq)
    check("mobile: phrase bottom sheet after touchend", mq.evaluate("document.getElementById('pop').classList.contains('sheet')") and mq.inner_text("#phraseText") == "climate summit"
          and mq.input_value("#phraseZh") == "气候峰会")
    check("mobile: selection scrolled above the sheet", mq.evaluate("getSelection().getRangeAt(0).getBoundingClientRect().bottom <= document.getElementById('pop').getBoundingClientRect().top"))
    check("mobile: no horizontal overflow with sheet", mq.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    mq.screenshot(path="/tmp/er_mobile_phrase_sheet.png")
    mq.tap("#pop [data-act=padd]")
    check("mobile: phrase added", (word(mq, "climate summit") or {}).get("type") == "phrase" and mq.locator("#articleReader .w.ph").count() >= 2)
    mq.evaluate("ER.hidePop(); getSelection().removeAllRanges()")
    # long-press selecting a single word on the phone -> word lookup (old behaviour)
    mq.evaluate(SEL_JS, ["goal", "goal"])
    mq.wait_for_function("document.querySelector('#pop.show') && !document.querySelector('#pop .spinner')")
    check("mobile: single-word long-press selection -> word lookup", mq.locator("#pop.phrase").count() == 0 and "goal" in mq.inner_text("#pop").lower())
    mq.evaluate("ER.hidePop(); getSelection().removeAllRanges()")
    # manual add + review on phone (word-order tiles by tapping)
    mq.goto(f"{BASE}?today=2026-10-23#/vocab"); mq.wait_for_selector("#manCard")
    mq.tap("#manCard summary"); mq.fill("#manEn", "Food grown close to consumers travels shorter distances")
    mq.fill("#manZh", "在消费者附近种植的食物运输距离更短"); mq.tap("#manAdd")
    check("mobile: manual add works", word(mq, "Food grown close to consumers travels shorter distances") is not None)
    check("mobile: vocab page no horizontal overflow", mq.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    mq.screenshot(path="/tmp/er_mobile_vocab.png", full_page=True)
    mq.evaluate("ER.settings.newPerDay=0;ER.saveSettings()")
    force_type(mq, "Food grown close to consumers travels shorter distances", "spell")
    mq.goto(f"{BASE}?today=2026-10-23#/review"); mq.wait_for_selector("#btnStart")
    mlog, shots = [], {}
    run_session(mq, log=mlog, tap=True, shots=shots)
    mo = [e for e in mlog if e["type"] == "order"]
    check("mobile: word-order question by tapping tiles", mo and mo[0]["ok"], str(mlog))
    check("mobile: all phrase answers correct on phone", all(e["ok"] for e in mlog) and len(mlog) == 2, str(mlog))

    # ---------- 14. data-loss safeguards ----------
    sc = browser.new_context(accept_downloads=True); mock_routes(sc)
    sp = sc.new_page(); attach(sp, "safeguard")
    goto(sp, "2026-10-26", "#/vocab"); sp.wait_for_selector("#btnBackup")
    sp.evaluate("""()=>{ER.addWord({word:'alpha',zh:'甲',source:'manual'});ER.addWord({word:'make ends meet',type:'phrase',zh:'勉强维持生计',source:'manual'});}""")
    for d, h in [("2026-10-27", "#/read"), ("2026-10-27", "#/review"), ("2026-10-28", "#/vocab"), ("2026-10-28", "#/paste"), ("2026-10-29", "#/review")]:
        goto(sp, d, h); sp.wait_for_timeout(200)
    check("new-day rollover keeps vocab (D+1..D+3, all pages)", [v["word"] for v in vocab(sp)] == ["alpha", "make ends meet"], str(vocab(sp)))
    check("every item gets updatedAt", all(v.get("updatedAt") for v in vocab(sp)))
    check("automatic backup snapshot kept", sp.evaluate("ER.lsGet('er_vocab_backup',{}).n") == 2)
    # stale in-memory copy (missed storage event, e.g. restored from back/forward cache): must not clobber newer data
    sp.evaluate("""()=>{var a=JSON.parse(localStorage.getItem('er_vocab'));a.push({word:'from other tab',type:'phrase',zh:'别的标签页',srs:{stage:0,due:'2026-10-29'},updatedAt:Date.now()});localStorage.setItem('er_vocab',JSON.stringify(a));}""")
    sp.evaluate("ER.addWord({word:'gamma',zh:'丙',source:'manual'})")
    stored = sp.evaluate("JSON.parse(localStorage.getItem('er_vocab')).map(v=>v.word)")
    check("stale tab save merges instead of overwriting", set(stored) == {"alpha", "make ends meet", "from other tab", "gamma"}, str(stored))
    # empty list never saved over non-empty storage
    sp.evaluate("""()=>{localStorage.setItem('er_vocab',JSON.stringify([{word:'zz1',srs:{}}]));}""")
    goto(sp, "2026-10-29", "#/vocab"); sp.reload(); sp.wait_for_selector("#btnBackup")
    sp.evaluate("""()=>{localStorage.setItem('er_vocab',JSON.stringify([{word:'kept',srs:{}}]));ER.getVocab().length=0;ER.saveVocab();}""")
    check("empty in-memory list never overwrites stored words", sp.evaluate("JSON.parse(localStorage.getItem('er_vocab')).map(v=>v.word)") == ["kept"])
    # explicit deletion of the last word is allowed
    goto(sp, "2026-10-29", "#/vocab"); sp.reload(); sp.wait_for_selector("#btnBackup"); sp.evaluate("ER.removeWord('kept')")
    check("explicit deletion of last word allowed", sp.evaluate("JSON.parse(localStorage.getItem('er_vocab')).length") == 0)
    # corrupt JSON -> raw kept aside, restore button from automatic backup
    sp.evaluate("""()=>{ER.addWord({word:'alpha',zh:'甲',source:'manual'});ER.addWord({word:'beta',zh:'乙',source:'manual'});localStorage.setItem('er_vocab','[{"word":"alpha",');}""")
    goto(sp, "2026-10-29", "#/vocab"); sp.reload(); sp.wait_for_selector("#btnBackup")
    check("corrupt vocab JSON is preserved aside", sp.evaluate("localStorage.getItem('er_vocab_corrupt')") == '[{"word":"alpha",')
    check("restore button shown when vocab empty but backup exists", sp.locator("#btnRestoreAuto").is_visible() and "2" in sp.inner_text("#restoreBox"))
    sp.click("#btnRestoreAuto")
    check("restore from automatic backup", sorted(v["word"] for v in vocab(sp)) == ["alpha", "beta"] and sp.locator(".vitem").count() == 2)
    # visibilitychange re-reads storage written elsewhere
    sp.evaluate("""()=>{var a=JSON.parse(localStorage.getItem('er_vocab'));a.push({word:'delta',srs:{},updatedAt:Date.now()});localStorage.setItem('er_vocab',JSON.stringify(a));document.dispatchEvent(new Event('visibilitychange'));}""")
    check("tab becoming visible reloads vocab from storage", word(sp, "delta") is not None)
    check("storage.persist requested (hint shown)", sp.inner_text("#persistHint") != "")
    # copy / paste backup code
    sc.grant_permissions(["clipboard-read", "clipboard-write"])
    sp.click("#btnCopyCode")
    code = sp.input_value("#backupCode")
    check("backup code generated", json.loads(code)["app"] == "english-reader" and len(json.loads(code)["data"]["vocab"]) == 3)
    sc2 = browser.new_context(); mock_routes(sc2); sp2 = sc2.new_page(); attach(sp2, "paste-import")
    goto(sp2, "2026-10-29", "#/vocab"); sp2.wait_for_selector("#btnPasteImport")
    sp2.click("#btnPasteImport"); sp2.fill("#backupCode", code); sp2.click("#btnPasteImport")
    check("paste backup code imports (merge)", sorted(v["word"] for v in vocab(sp2)) == ["alpha", "beta", "delta"])
    sp2.click("#btnPasteImport"); sp2.fill("#backupCode", "{broken"); sp2.click("#btnPasteImport")
    check("bad backup code leaves data intact", len(vocab(sp2)) == 3)
    sc2.close(); sc.close()

    # ---------- 15. GitHub gist sync (GitHub API mocked) ----------
    TOKEN = "ghp_" + "x" * 36   # fake test token
    class FakeGitHub:
        def __init__(self):
            self.gists, self.mode, self.calls, self.n = {}, "ok", [], 0
        def reply(self, route, status, body):
            route.fulfill(status=status, content_type="application/json", body=json.dumps(body),
                          headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type,accept",
                                   "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Expose-Headers": "x-ratelimit-remaining,x-ratelimit-reset"})
        def handle(self, route):
            req = route.request; path = req.url.split("api.github.com", 1)[1].split("?")[0]
            if req.method == "OPTIONS":
                return self.reply(route, 204, {})
            self.calls.append((req.method, path))
            if self.mode == "offline":
                return route.abort("internetdisconnected")
            if self.mode == "401" or req.headers.get("authorization") != "Bearer " + TOKEN:
                return self.reply(route, 401, {"message": "Bad credentials"})
            self.n += 1; now = f"2026-10-27T00:00:{self.n:02d}Z"
            def full(g):
                return {"id": g["id"], "updated_at": g["updated_at"], "public": False,
                        "files": {k: {"filename": k, "content": v, "truncated": False} for k, v in g["files"].items()}}
            if path == "/gists" and req.method == "GET":
                return self.reply(route, 200, [{"id": g["id"], "updated_at": g["updated_at"], "files": {k: {"filename": k} for k in g["files"]}} for g in self.gists.values()])
            if path == "/gists" and req.method == "POST":
                b = json.loads(req.post_data); gid = f"gist{sum(1 for k in self.gists if k.startswith('gist')) + 1}"
                self.gists[gid] = {"id": gid, "updated_at": now, "public": b.get("public"), "files": {k: v["content"] for k, v in b["files"].items()}}
                return self.reply(route, 201, full(self.gists[gid]))
            gid = path.rsplit("/", 1)[-1]
            if gid not in self.gists:
                return self.reply(route, 404, {"message": "Not Found"})
            if req.method == "PATCH":
                b = json.loads(req.post_data)
                for k, v in b["files"].items():
                    self.gists[gid]["files"][k] = v["content"]
                self.gists[gid]["updated_at"] = now
            return self.reply(route, 200, full(self.gists[gid]))
        def data(self):
            g = [g for g in self.gists.values() if "english-reader-data.json" in g["files"]][0]; return json.loads(g["files"]["english-reader-data.json"])
    gh = FakeGitHub()
    gh.gists["other"] = {"id": "other", "updated_at": "2020-01-01T00:00:00Z", "files": {"notes.md": "unrelated"}}
    def device(tag):
        c = browser.new_context(); mock_routes(c); c.route(re.compile(r"https://api\.github\.com/.*"), gh.handle)
        pg = c.new_page(); attach(pg, tag); pg.on("dialog", lambda d: d.accept())
        goto(pg, "2026-10-27", "#/vocab"); pg.wait_for_selector("#syncCard")
        pg.evaluate("ER.SYNC_DEBOUNCE=150")
        return c, pg
    def connect(pg):
        pg.fill("#syncToken", TOKEN); pg.click("#btnSyncConnect")
        pg.wait_for_function("(ER.lsGet('er_sync_meta',{}).state||'')!=='syncing' && ER.lsGet('er_sync_meta',{}).state")
    def sync(pg):
        return pg.evaluate("ER.syncNow('test')")
    def words(pg):
        return sorted(v["word"] for v in vocab(pg))
    ca, A = device("deviceA")
    check("sync card: token link pre-fills gist scope", A.get_attribute("#syncTokenLink", "href") == "https://github.com/settings/tokens/new?scopes=gist&description=english-reader-sync")
    A.evaluate("""()=>{ER.addWord({word:'alpha',zh:'甲',source:'manual'});ER.addWord({word:'beta',zh:'乙',source:'manual'});ER.addWord({word:'make ends meet',type:'phrase',zh:'勉强维持生计',source:'manual'});}""")
    connect(A)
    check("first connect creates one secret gist", sum(1 for m, p_ in gh.calls if m == "POST") == 1 and gh.gists["gist1"]["public"] is False)
    check("gist contains vocab incl. phrase", sorted(v["word"] for v in gh.data()["vocab"]) == ["alpha", "beta", "make ends meet"])
    check("sync status shows last sync time", "上次同步" in A.inner_text("#syncStatus"), A.inner_text("#syncStatus"))
    check("token is stored only locally and not in backups", TOKEN not in A.evaluate("JSON.stringify(ER.buildBackup())") and TOKEN not in json.dumps(gh.data()))
    cb, Bp = device("deviceB")
    Bp.evaluate("ER.addWord({word:'zeta',zh:'己',source:'manual'})")
    connect(Bp)
    check("second device finds existing gist (no new gist)", sum(1 for m, p_ in gh.calls if m == "POST") == 1 and Bp.evaluate("ER.lsGet('er_sync_meta',{}).gistId") == "gist1")
    check("second device gets union of both devices", words(Bp) == ["alpha", "beta", "make ends meet", "zeta"], str(words(Bp)))
    sync(A)
    check("first device receives second device's word", words(A) == ["alpha", "beta", "make ends meet", "zeta"])
    # deletion propagates (tombstone), debounced auto-sync after change
    A.evaluate("ER.removeWord('alpha')")
    A.wait_for_function("ER.lsGet('er_sync_meta',{}).state==='ok' && !(JSON.stringify(ER.syncState().vocab).includes('\"alpha\"'))")
    A.wait_for_timeout(800)
    check("deletion stored as tombstone in gist", "alpha" in gh.data()["tombstones"] and "alpha" not in [v["word"] for v in gh.data()["vocab"]])
    sync(Bp)
    check("deletion propagates to other device", "alpha" not in words(Bp) and "beta" in words(Bp))
    # newer review progress wins; daily new-word progress merges
    Bp.evaluate("""()=>{var v=ER.findWord('beta');v.srs=SRS.answer(v.srs,true,'2026-10-27');v.srs=SRS.answer(v.srs,true,'2026-10-28');ER.saveVocab();ER.lsSet('er_daily',{date:'2026-10-27',newDone:7});}""")
    sync(Bp); sync(A)
    check("newer SRS progress wins on other device", word(A, "beta")["srs"]["stage"] == 2, str(word(A, "beta")["srs"]))
    check("daily new-word progress synced", A.evaluate("ER.lsGet('er_daily',{}).newDone") == 7)
    # concurrent edits on both devices to different words -> both kept
    A.evaluate("ER.findWord('zeta').zh='己（A 改）';ER.saveVocab()")
    Bp.evaluate("ER.addWord({word:'kappa',zh:'癸',source:'manual'})")
    sync(A); sync(Bp); sync(A)
    check("edits on both devices merged", word(Bp, "zeta")["zh"] == "己（A 改）" and word(A, "kappa") is not None)
    # settings sync (newer wins)
    A.click("#btnSettings"); A.select_option("#optAccent", "en-GB"); A.click("#btnCloseSettings"); sync(A); sync(Bp)
    check("settings synced", Bp.evaluate("ER.settings.accent") == "en-GB")
    # offline: local data untouched, error shown, later retry succeeds
    gh.mode = "offline"
    A.evaluate("ER.addWord({word:'offline word',type:'phrase',zh:'离线',source:'manual'})")
    ok = sync(A)
    check("offline sync fails gracefully", ok is False and "网络" in A.inner_text("#syncStatus"), A.inner_text("#syncStatus"))
    A.reload(); A.wait_for_selector("#syncCard"); A.wait_for_timeout(500)
    check("offline: local data kept after failed sync + reload", "offline word" in words(A) and "kappa" in words(A))
    gh.mode = "401"
    ok = sync(A)
    check("401 shows token error, keeps local data", ok is False and "token" in A.inner_text("#syncStatus") and "offline word" in words(A))
    gh.mode = "ok"
    sync(A); sync(Bp)
    check("after reconnect, offline change reaches other device", "offline word" in words(Bp))
    # disconnect keeps data
    A.click("#btnSyncNow"); A.wait_for_timeout(300)
    A.click("#btnSyncOff")
    check("disconnect removes token, keeps data", A.evaluate("localStorage.getItem('er_sync_token')") is None and "offline word" in words(A) and A.locator("#syncSetup").is_visible())
    ca.close(); cb.close()

    # ---------- 18. cloze + letter-gaps review types ----------
    qc = browser.new_context(accept_downloads=True, viewport={"width": 1100, "height": 900})
    mock_routes(qc)
    qp = qc.new_page(); attach(qp, "cloze-gaps")
    goto(qp, "2026-10-23", "#/review"); qp.wait_for_selector("#statNew")
    # seed vocab with known sentences
    qp.evaluate("""()=>{
      ER.addWord({word:'contribute',zh:'v. 贡献',sentence:'She contributed a lot to the project.',sentence_zh:'她为这个项目贡献了很多。',source:'manual'});
      ER.addWord({word:'acutely',zh:'adv. 敏锐地',sentence:'He felt the loss acutely.',sentence_zh:'他敏锐地感到了损失。',source:'manual'});
      ER.addWord({word:'make ends meet',type:'phrase',zh:'勉强维持生计',sentence:'Many families struggle to make ends meet.',sentence_zh:'许多家庭艰难维持生计。',source:'manual'});
      // due today
      ['contribute','acutely','make ends meet'].forEach(w=>{var v=ER.findWord(w);v.srs.due='2026-10-23';v.srs.stage=2;});
      ER.saveVocab();
      ER.settings.newPerDay=0; ER.saveSettings();
    }""")
    qp.reload(); qp.wait_for_function("window.ER && ER.today")
    goto(qp, "2026-10-23", "#/review"); qp.wait_for_selector("#statDue")
    # unit helpers
    mask = qp.evaluate("()=>ER.gapMask('acutely', 2, '2026-10-23')")
    check("gapMask keeps first letter and hides some",
          mask["text"] == "acutely" and mask["display"][0] == "a" and "_" in mask["display"]
          and 1 <= len(mask["gaps"]) <= 5, str(mask))
    mask2 = qp.evaluate("()=>ER.gapMask('acutely', 2, '2026-10-23')")
    check("gapMask deterministic for word+day", mask == mask2)
    blank = qp.evaluate("()=>{var v=ER.findWord('contribute');var s=ER.resolveSentence(v);return {sent:s, blank:ER.clozeBlank(v,s.en)};}")
    check("cloze blanks inflected form in sentence",
          blank["blank"] and blank["blank"]["form"].lower() == "contributed"
          and blank["sent"]["en"].lower().find("contributed") >= 0, str(blank)[:240])
    force_type(qp, "contribute", "cloze")
    force_type(qp, "acutely", "gaps")
    force_type(qp, "make ends meet", "cloze")
    qlog = []
    run_session(qp, wrong={"acutely"}, log=qlog)
    by = {e["word"]: e for e in qlog if e["first"]}
    check("cloze question for contribute", by.get("contribute", {}).get("type") == "cloze" and by["contribute"]["ok"], str(by.get("contribute")))
    check("gaps question for acutely (wrong resets)", by.get("acutely", {}).get("type") == "gaps" and not by["acutely"]["ok"], str(by.get("acutely")))
    check("wrong gaps -> stage 0", (word(qp, "acutely") or {}).get("srs", {}).get("stage") == 0)
    check("cloze phrase blanks whole phrase", by.get("make ends meet", {}).get("type") == "cloze" and by["make ends meet"]["ok"], str(by.get("make ends meet")))
    # CET examples file available for words without source ex
    ex = qp.evaluate("""async()=>{
      await ER.pickNewCet(0);
      // load examples via a dummy session prep: call resolve after ensuring lists
      return await fetch('data/examples-cet6.json').then(r=>r.json()).then(d=>({n:Object.keys(d.examples||{}).length, acutely:d.examples.acutely}));
    }""")
    check("examples-cet6.json has fill-ins", ex["n"] >= 100 and ex["acutely"] and "acutely" in ex["acutely"]["en"].lower(), str(ex)[:200])
    qc.close()

    # mobile letter-gap inputs
    qm = browser.new_context(viewport={"width": 390, "height": 760}, has_touch=True, is_mobile=True, device_scale_factor=2)
    mock_routes(qm)
    qmp = qm.new_page(); attach(qmp, "gaps-mobile")
    goto(qmp, "2026-10-23", "#/review")
    qmp.evaluate("""()=>{
      ER.addWord({word:'statue',zh:'n. 雕像',source:'manual'});
      var v=ER.findWord('statue'); v.srs.due='2026-10-23'; v.srs.stage=3; ER.saveVocab();
      ER.settings.newPerDay=0; ER.saveSettings();
    }""")
    qmp.reload(); goto(qmp, "2026-10-23", "#/review"); qmp.wait_for_selector("#statDue")
    force_type(qmp, "statue", "gaps")
    qmp.click("#btnStart")
    qmp.wait_for_selector("#qCard[data-type=gaps]")
    check("mobile gaps: letter inputs present", qmp.locator(".gap-in").count() >= 1)
    qmp.evaluate("""(w)=>{document.querySelectorAll('.gap-in').forEach(inp=>{inp.value=w.charAt(+inp.dataset.i);});}""", "statue")
    qmp.locator("#btnCheck").tap()
    qmp.wait_for_selector("#btnNext:not([hidden])")
    check("mobile gaps: correct via letter inputs", "正确" in qmp.inner_text("#feedback"))
    qmp.screenshot(path="/tmp/er_gaps_mobile.png")
    qm.close()

    # ---------- 17. CET new-word order (hash-mixed, deterministic) ----------
    oc = browser.new_context(); mock_routes(oc)
    op = oc.new_page(); attach(op, "cet-order")
    goto(op, "2026-10-23", "#/review"); op.wait_for_selector("#statNew")
    batch1 = op.evaluate("""async()=>{
      var a=await ER.pickNewCet(10); return a.map(x=>x.word);
    }""")
    batch1b = op.evaluate("""async()=>{
      var a=await ER.pickNewCet(10); return a.map(x=>x.word);
    }""")
    check("CET pickNew is deterministic on reload", batch1 == batch1b, str(batch1))
    check("CET pickNew first batch is mixed letters",
          len({w[0].lower() for w in batch1}) >= 5 and batch1[0][0].lower() != "a",
          ", ".join(batch1))
    check("CET pickNew skips obscure / proper nouns",
          all(len(w) >= 2 and " " not in w and w[0] == w[0].lower() for w in batch1),
          ", ".join(batch1))
    # mark first 5 as seen (as if already introduced); next batch must not repeat them
    op.evaluate("""(ws)=>{
      var s=ER.lsGet('er_cet_seen',{});
      ws.forEach(w=>s[w.toLowerCase()]='learn');
      ER.lsSet('er_cet_seen',s);
    }""", batch1[:5])
    batch2 = op.evaluate("""async()=>{
      var a=await ER.pickNewCet(10); return a.map(x=>x.word);
    }""")
    check("CET pickNew skips already-seen words", not set(batch1[:5]) & set(batch2),
          f"seen={batch1[:5]} next={batch2}")
    check("CET next batch still mixed", len({w[0].lower() for w in batch2}) >= 4, ", ".join(batch2))
    # second fresh device with empty seen gets the same first batch
    oc2 = browser.new_context(); mock_routes(oc2)
    op2 = oc2.new_page(); attach(op2, "cet-order-2")
    goto(op2, "2026-10-23", "#/review"); op2.wait_for_selector("#statNew")
    batch_other = op2.evaluate("""async()=>{
      var a=await ER.pickNewCet(10); return a.map(x=>x.word);
    }""")
    check("CET order identical across fresh devices", batch_other == batch1, f"{batch1} vs {batch_other}")
    oc.close(); oc2.close()

    # ---------- 16. glossary + translation fallbacks ----------
    gc = browser.new_context(accept_downloads=True, viewport={"width": 1100, "height": 900})
    mock_routes(gc, translators=())   # all online translators fail
    gp = gc.new_page(); attach(gp, "glossary")
    goto(gp, "2026-10-27", "#/read/2026-10-27"); gp.wait_for_selector("#articleReader h2")
    AR27 = "#articleReader"
    drag_select(gp, f'{AR27} .w[data-w="failed"]', f'{AR27} .w[data-w="harvests"]')
    wait_phrase_pop(gp)
    check("glossary: exact phrase fills Chinese offline",
          gp.input_value("#phraseZh") == "歉收；收成不好" and "本文短语表" in gp.inner_text("#pop")
          and "请参考" not in gp.inner_text("#pop") and "暂不可用" not in gp.inner_text("#pop"), gp.inner_text("#pop")[:200].replace("\n"," | "))
    gp.mouse.click(5, 5); gp.wait_for_timeout(200)
    # partial / related: select "rising seas" covered by glossary; then a longer selection containing it
    drag_select(gp, f'{AR27} .w[data-w="rising"]', f'{AR27} .w[data-w="seas"]')
    wait_phrase_pop(gp)
    check("glossary: rising seas exact", gp.input_value("#phraseZh") == "海平面上升" and "本文短语表" in gp.inner_text("#pop"))
    gp.mouse.click(5, 5); gp.wait_for_timeout(200)
    # selection contained in glossary phrase: "extreme heat is" is not exact; related may include extreme heat
    # select a phrase NOT in glossary and NOT in FAKE_ZH -> online fails -> per-word hints
    drag_select(gp, f'{AR27} .w[data-w="hospital"]', f'{AR27} .w[data-w="admissions"]')
    wait_phrase_pop(gp)
    # "hospital admissions" IS in glossary — use a non-glossary selection
    gp.mouse.click(5, 5); gp.wait_for_timeout(200)
    drag_select(gp, f'{AR27} .w[data-w="completely"]', f'{AR27} .w[data-w="ignored"]')
    wait_phrase_pop(gp)
    # "almost completely ignored" is in glossary as exact if we select all three; select just "completely ignored"
    txt = gp.inner_text("#phraseText")
    if txt == "almost completely ignored":
        check("glossary: almost completely ignored exact", "几乎完全被忽视" in gp.input_value("#phraseZh"))
    else:
        # related tip or online fail with hints
        status = gp.inner_text("#phraseStatus") + gp.inner_text("#pop")
        check("non-glossary selection: related tip or fail+hints",
              ("本文相关短语" in status) or ("请参考" in status) or ("逐词意思" in status) or gp.input_value("#phraseZh") != "",
              status[:180].replace("\n"," | "))
    # total online failure + per-word hints via paste (no article glossary)
    gp.evaluate("()=>{try{window.getSelection().removeAllRanges();}catch(e){} var p=document.getElementById('pop'); if(p){p.classList.remove('show','phrase'); p.innerHTML='';}}")
    goto(gp, "2026-10-27", "#/paste"); gp.wait_for_selector("#src")
    gp.fill("#src", "xyzzypq qwertyuiop asdfghjkl.")
    gp.click("#btnRead", force=True); gp.wait_for_selector("#pasteReader .w")
    drag_select(gp, '#pasteReader .w[data-w="xyzzypq"]', '#pasteReader .w[data-w="asdfghjkl"]')
    wait_phrase_pop(gp)
    gp.wait_for_function("document.querySelector('#phraseHint') || (document.querySelector('#phraseStatus') && document.querySelector('#phraseStatus').classList.contains('err'))", timeout=15000)
    check("all translators fail: shows Chinese hint message + retry",
          "请参考" in gp.inner_text("#phraseStatus") and gp.locator("#pop [data-act=ptrans]").count() == 1
          and gp.input_value("#phraseZh") == "", gp.inner_text("#pop")[:220].replace("\n"," | "))
    check("all translators fail: per-word hint box rendered", gp.locator("#phraseHint").count() == 1)
    # fallback order: only google succeeds
    gc.close()
    gc2 = browser.new_context(viewport={"width": 1100, "height": 900})
    mock_routes(gc2, translators=("google",))
    gp2 = gc2.new_page(); attach(gp2, "fallback-google")
    goto(gp2, "2026-10-23", "#/paste"); gp2.wait_for_selector("#src")
    gp2.evaluate("()=>{var p=document.getElementById('pop'); if(p) p.classList.remove('show','phrase');}")
    gp2.fill("#src", "The climate summit starts soon.")
    gp2.click("#btnRead"); gp2.wait_for_selector("#pasteReader .w")
    drag_select(gp2, '#pasteReader .w[data-w="climate"]', '#pasteReader .w[data-w="summit"]')
    wait_phrase_pop(gp2)
    check("fallback: Youdao+MyMemory fail, Google succeeds",
          gp2.input_value("#phraseZh") == "气候峰会" and "Google" in gp2.inner_text("#pop"),
          gp2.inner_text("#pop")[:180].replace("\n"," | "))
    # related tip: select "sobering message" while glossary has "delivered a sobering message"
    goto(gp2, "2026-10-23", "#/read/2026-10-23"); gp2.wait_for_selector("#articleReader h2")
    drag_select(gp2, '#articleReader .w[data-w="sobering"]', '#articleReader .w[data-w="sobering"] + .w')
    wait_phrase_pop(gp2)
    check("glossary related tip for sobering message",
          "本文相关短语" in gp2.inner_text("#pop") and "delivered a sobering message" in gp2.inner_text("#pop"),
          gp2.inner_text("#pop")[:220].replace("\n"," | "))
    gc2.close()

    # ---------- 14. live lookup (optional, real network) ----------
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
