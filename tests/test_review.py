#!/usr/bin/env python3
"""Behavioral regression tests for recall-first daily review.

pip install playwright
CHROME=/path/to/chrome python3 tests/test_review.py
The HTTP server and browser profile are temporary; no personal learning data is used.
"""
import atexit
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DAY = '2026-11-02'
checks = []
errors = []


def check(name, condition, detail=''):
    checks.append(bool(condition))
    print(('PASS ' if condition else 'FAIL ') + name + (f' [{detail}]' if detail else ''), flush=True)


def entry(word, zh='词义测试', source='manual', **extra):
    return dict(word=word, zh=zh, source=source,
                sentence=f'They discussed {word} yesterday.', sentence_zh=f'他们昨天讨论了{zh}。', **extra)


def seed(page, entries, mode='reading', new=0):
    page.evaluate('''([entries,mode,n])=>{
      localStorage.clear();
      localStorage.setItem('er_settings',JSON.stringify({newPerDay:n,reviewMode:mode}));
      localStorage.setItem('er_vocab',JSON.stringify(entries));
    }''', [entries, mode, new])
    page.reload()
    page.wait_for_selector('#statDue')


def old(word, zh='测试含义', **extra):
    srs = dict(stage=2, due=DAY, reps=2, lapses=0, qn=0, last='2026-10-29', added='2026-10-20')
    return entry(word, zh, srs=srs, **extra)


def state(page):
    return page.evaluate('''()=>{var s=ER.views.review.state();return s?JSON.parse(JSON.stringify(s)):null}''')


def item(page):
    s = state(page)
    return s['queue'][s['idx']]


def word(page, name):
    return page.evaluate('w=>ER.findWord(w)', name)


def start(page):
    page.click('#btnStart')
    page.wait_for_selector('#btnGotIt, #qCard, #summaryCard')


def step(page, rating='good', hint=False):
    if page.locator('#btnGotIt').count():
        page.click('#btnGotIt')
        return None
    if page.locator('#summaryCard').count():
        return None
    it = item(page)
    name, typ = it['word'], it['type']
    if typ == 'recall':
        if hint and page.locator('#btnRecallHint').count():
            page.click('#btnRecallHint')
        page.click('#btnReveal')
        page.click({'good':'#btnRecallGood','hard':'#btnRecallHard','again':'#btnRecallAgain'}[rating])
    elif typ in ('spell', 'cloze'):
        answer = it.get('answer') or name
        page.fill('#spellInput' if typ == 'spell' else '#clozeInput', answer if rating == 'good' else 'wronganswer')
        page.click('#btnCheck')
    elif typ == 'gaps':
        page.evaluate('w=>document.querySelectorAll(".gap-in").forEach(i=>i.value=w[+i.dataset.i])', name)
        page.click('#btnCheck')
    elif typ == 'order':
        count = page.locator('#orderPool .tile').count()
        for index in range(count):
            page.click(f'#orderPool .tile[data-i="{index}"]')
        page.click('#btnCheck')
    else:
        opts = page.locator('.opts button')
        for i in range(opts.count()):
            candidate = opts.nth(i)
            if (candidate.get_attribute('data-opt') == it['answer']) == (rating == 'good'):
                candidate.click()
                break
    page.wait_for_selector('#btnNext:not([hidden])')
    return it


def next_(page):
    page.click('#btnNext')
    page.wait_for_selector('#btnGotIt, #qCard, #summaryCard')


def finish(page, wrong_first=(), limit=180):
    log = []
    for _ in range(limit):
        if page.locator('#summaryCard').count():
            return log
        if page.locator('#btnGotIt').count():
            page.click('#btnGotIt')
            continue
        it = item(page)
        log.append(dict(it, index=len(log)))
        step(page, 'again' if it.get('first') and it['word'] in wrong_first else 'good')
        next_(page)
    raise AssertionError('Session did not finish within its bounded attempt limit')


with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
server = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'],
                          cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
atexit.register(server.terminate)
time.sleep(.6)
base = f'http://127.0.0.1:{port}/?today={DAY}#/review'

with sync_playwright() as p:
    chrome = os.environ.get('CHROME')
    browser = p.chromium.launch(executable_path=chrome, args=['--no-sandbox']) if chrome else p.chromium.launch()

    def profile(mobile=False):
        ctx = browser.new_context(viewport={'width':390 if mobile else 1100, 'height':820},
                                  has_touch=mobile, is_mobile=mobile, accept_downloads=True)
        ctx.add_init_script('''if(window.speechSynthesis){speechSynthesis.speak=()=>{};speechSynthesis.cancel=()=>{};}''')
        ctx.route('https://**/*', lambda route: route.fulfill(status=204, body=''))
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base)
        pg.wait_for_selector('#statDue')
        return ctx, pg

    ctx, page = profile()
    check('fresh profile defaults to five new words and reading mode', page.input_value('#optNewPer') == '5' and page.input_value('#optReviewMode') == 'reading')

    seed(page, [old('resilience', '韧性；恢复力')])
    migrated = word(page, 'resilience')['srs']
    check('legacy meaning progress migrates without erasure', migrated['skills']['meaning']['stage'] == 2 and migrated['skills']['meaning']['due'] == DAY)
    start(page)
    check('reading review begins with independent recall', item(page)['type'] == 'recall')
    check('translation and scoring hidden before reveal', '韧性；恢复力' not in page.inner_text('#qCard') and not page.locator('#btnRecallGood').is_visible())
    page.click('#btnReveal')
    check('reveal shows meaning and three recall ratings', '韧性；恢复力' in page.inner_text('#qCard') and all(page.locator(x).is_visible() for x in ['#btnRecallGood','#btnRecallHard','#btnRecallAgain']))
    page.click('#btnRecallGood')
    good = word(page, 'resilience')['srs']
    check('independent recall advances only meaning', good['skills']['meaning']['stage'] == 3 and good['skills']['spelling']['stage'] == 0)
    check('history distinguishes self-reported recall', good['history'][-1]['self'] and not good['history'][-1]['assisted'])

    seed(page, [old('resilience', '韧性；恢复力')])
    start(page)
    step(page, hint=True)
    assisted = word(page, 'resilience')['srs']
    check('sentence hint cannot earn independent advancement', assisted['skills']['meaning']['stage'] <= 2 and assisted['history'][-1]['assisted'])
    next_(page)
    check('too few intervening words defer rather than immediate repeated answer', not any(q.get('word')=='resilience' and q.get('skill')=='meaning' and not q.get('done') for q in (state(page) or {}).get('queue',[])) and word(page, 'resilience')['srs']['skills']['meaning']['due'] == '2026-11-03')

    # Balanced mode can test spelling while meaning retains its independent schedule.
    seed(page, [old('resilience', '韧性；恢复力')], mode='balanced')
    page.evaluate('''()=>{var v=ER.findWord('resilience');v.srs.skills.meaning.due='2026-11-15';
      v.srs.skills.spelling=Object.assign({},v.srs.skills.meaning,{stage:1,due:ER.today(),active:true,last:'2026-10-31',qn:0});
      v.srs=SRS.normalize(v.srs,ER.today());ER.saveVocab();}''')
    page.reload(); page.wait_for_selector('#btnStart'); start(page)
    check('overdue spelling gets its own prompt', item(page)['skill'] == 'spelling' and item(page)['type'] == 'spell')
    step(page, 'again')
    spelling = word(page, 'resilience')['srs']
    check('spelling error does not erase meaning progress', spelling['skills']['meaning']['stage'] == 2 and spelling['skills']['meaning']['due'] == '2026-11-15' and spelling['skills']['spelling']['lapses'] > 0)
    next_(page)

    seed(page, [old('contribute', '贡献')])
    page.evaluate('''()=>{var v=ER.findWord('contribute');v.sentence='She contributed a lot to the project.';
      v.srs.skills.meaning.due='2026-11-15';v.srs.skills.usage=Object.assign({},v.srs.skills.meaning,{stage:0,due:ER.today(),active:true,last:'2026-11-01'});
      v.srs=SRS.normalize(v.srs,ER.today());ER.saveVocab();}''')
    page.reload(); page.wait_for_selector('#btnStart'); start(page)
    check('usage prompt blanks inflected form', item(page)['type'] == 'cloze' and item(page)['answer'].lower() == 'contributed')
    step(page)
    check('usage success records separate ability', word(page, 'contribute')['srs']['history'][-1]['skill'] == 'usage')

    # A revealed word must not immediately earn another independent skill promotion.
    seed(page, [old('resilience', '韧性；恢复力')], mode='balanced')
    start(page)
    step(page)
    next_(page)
    near = item(page)
    check('same-word follow-up after reveal is treated as warm-up', near['word']=='resilience' and near.get('recentExposure') and near.get('assisted'))
    step(page)
    check('recently exposed answer cannot advance another ability', word(page,'resilience')['srs']['skills'][near['skill']]['stage']==0)

    # Hints, unlike ordinary pronunciation in a spelling task, lower the score.
    seed(page, [old('resilience')], mode='balanced')
    page.evaluate("""()=>{var v=ER.findWord('resilience');v.srs.skills.meaning.due='2026-11-15';
      v.srs.skills.usage.active=false;v.srs.skills.spelling=Object.assign({},v.srs.skills.meaning,{stage:1,active:true,due:ER.today()});
      v.srs=SRS.normalize(v.srs,ER.today());ER.saveVocab();ER.views.review.show();}""")
    start(page)
    page.click('#btnHint')
    step(page)
    check('spelling first-letter hint is saved and never promotes', word(page,'resilience')['srs']['skills']['spelling']['stage']==1 and word(page,'resilience')['srs']['history'][-1]['assisted'])

    seed(page, [old('contribute', '贡献')])
    page.evaluate("""()=>{var v=ER.findWord('contribute');v.sentence='She contributed a lot to the project.';
      v.srs.skills.meaning.due='2026-11-15';v.srs.skills.usage=Object.assign({},v.srs.skills.meaning,{stage:1,active:true,due:ER.today()});
      v.srs=SRS.normalize(v.srs,ER.today());ER.saveVocab();ER.views.review.show();}""")
    start(page)
    check('cold cloze hides Chinese until requested', not page.locator('#clozeZh').is_visible())
    page.click('#btnClozeHint')
    step(page)
    check('cloze Chinese hint cannot promote usage', word(page,'contribute')['srs']['skills']['usage']['stage']==1 and word(page,'contribute')['srs']['history'][-1]['assisted'])

    # Known words are cold-tested at the spot-check date instead of showing a study card again.
    seed(page, [entry('resilience', '韧性；恢复力')])
    start(page)
    page.click('#btnKnown')
    page.evaluate("ER.setToday('2026-11-09');ER.views.review.show()")
    start(page)
    check('known word gets a cold spot-check after seven days', page.locator('#btnGotIt').count()==0 and item(page)['type']=='recall' and not item(page).get('assisted'))
    step(page,'again')
    check('failed spot-check returns word to tomorrow strengthening', word(page,'resilience')['srs']['skills']['meaning']['due']=='2026-11-10' and word(page,'resilience')['srs']['skills']['meaning']['learningPending'])
    page.reload();page.wait_for_selector('#statDue')

    # A word marked familiar remains in the vocabulary and will be spot-checked.
    seed(page, [], new=5)
    start(page)
    page.wait_for_selector('#btnKnown')
    known_name = item(page)['word']
    page.click('#btnKnown')
    known = word(page, known_name)
    check('known shortcut keeps word for future spot-check', known is not None and known['srs']['due'] == '2026-11-09')
    check('known shortcut is not evidence of mastery', not page.evaluate('w=>SRS.isMastered(ER.findWord(w).srs)', known_name))

    # Full backlog suppresses additional CET introductions; collected reading words come first.
    seed(page, [old('word' + str(i)) for i in range(35)], new=5)
    check('backlog automatically reduces new words', page.inner_text('#statNew') == '0')
    start(page)
    check('session caps the initial due-word batch', len({x.get('word') for x in state(page)['queue'] if x.get('kind') == 'test'}) <= 30)
    page.click('#btnQuit')

    seed(page, [old('resilience')] + [old('word'+str(i)) for i in range(12)])
    start(page)
    log = finish(page, wrong_first={'resilience'})
    attempts = [x for x in log if x['word'] == 'resilience' and x['skill'] == 'meaning']
    check('wrong word receives two independent delayed successes', len(attempts) == 3 and not attempts[1]['first'] and not attempts[2]['first'], str([(x['type'],x['index']) for x in attempts]))
    check('retries have at least three intervening other questions', len(attempts) == 3 and all(b['index']-a['index'] >= 4 for a,b in zip(attempts,attempts[1:])))
    hist = word(page, 'resilience')['srs']['history']
    check('same-session corrections do not double-promote or erase error', hist[-1]['practice'] and word(page,'resilience')['srs']['skills']['meaning']['due'] == '2026-11-03')

    seed(page, [old('constructor', '构造者')])
    start(page)
    check('dictionary words that match object keys can be scheduled', item(page)['word']=='constructor')

    # Resume saves queue position and does not grade a revealed card by itself.
    seed(page, [old('resilience'),old('retain'),old('restore'),old('recall')])
    start(page)
    first = item(page)['word']
    step(page)
    next_(page)
    pending = item(page)['word']
    count_before = len(word(page, first)['srs']['history'])
    page.reload()
    page.wait_for_selector('#btnResume')
    page.click('#btnResume')
    page.wait_for_selector('#qCard')
    check('refresh resumes the pending word', item(page)['word'] == pending)
    check('resume does not duplicate previous grade', len(word(page,first)['srs']['history']) == count_before)

    # Backup transports the new skill and evidence structures unchanged.
    backup = page.evaluate('ER.buildBackup()')
    before = page.evaluate('JSON.stringify(ER.getVocab().map(v=>v.srs))')
    page.evaluate('localStorage.clear()')
    page.reload(); page.wait_for_selector('#statDue')
    page.evaluate('b=>ER.applyBackup(b,"replace")', backup)
    after = page.evaluate('JSON.stringify(ER.getVocab().map(v=>v.srs))')
    check('backup round-trip preserves skill schedules and history', before == after)
    ctx.close()

    ctx, page = profile(mobile=True)
    seed(page, [old('resilience', '韧性；恢复力')])
    start(page)
    check('mobile review has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
    page.locator('#btnReveal').tap()
    check('mobile rating buttons have comfortable targets', all(page.locator(sel).bounding_box()['height'] >= 40 for sel in ['#btnRecallGood','#btnRecallHard','#btnRecallAgain']))
    page.locator('#btnRecallHard').tap()
    check('mobile hard response is saved', word(page,'resilience')['srs']['history'][-1]['rating'] == 'hard')
    out = ROOT / 'output' / 'playwright'
    out.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out/'review-mobile.png'), full_page=True)
    ctx.close()
    browser.close()

check('no JavaScript runtime errors', not errors, '; '.join(errors[:5]))
print(f'\n{sum(checks)}/{len(checks)} checks passed')
sys.exit(0 if all(checks) else 1)
