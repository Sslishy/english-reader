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
    page.wait_for_selector('#btnGotIt, #qCard, #summaryCard, #retryIntro, #statDue')


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
        page.fill('#recallInput', '未记清' if rating == 'again' else word(page, name)['zh'])
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
    page.wait_for_selector('#btnGotIt, #qCard, #summaryCard, #retryIntro, #statDue')


def finish(page, wrong_first=(), limit=180):
    log = []
    for _ in range(limit):
        if page.locator('#retryIntro').count():
            page.click('#btnStartRetry')
            continue
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
        ctx.add_init_script('''window.__spoken=[];window.__speechStops=0;window.SpeechSynthesisUtterance=function(text){this.text=text;};if(window.speechSynthesis){speechSynthesis.speak=u=>__spoken.push(u.text);speechSynthesis.cancel=()=>__speechStops++;speechSynthesis.getVoices=()=>[{lang:'en-US'}];}''')
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
    check('word meaning prompt automatically pronounces the word once',page.evaluate('__spoken')==['resilience'])
    check('translation and scoring hidden before reveal', '韧性；恢复力' not in page.inner_text('#qCard') and not page.locator('#btnRecallGood').is_visible())
    page.click('#btnReveal')
    check('empty response cannot reveal answers or self-grade', not page.locator('#recallAnswer').is_visible() and not page.locator('#btnRecallGood').is_visible())
    page.fill('#recallInput', 'resilience')
    page.click('#btnReveal')
    check('copying the English prompt does not count as explaining meaning', not page.locator('#recallAnswer').is_visible())
    page.fill('#recallInput', '恢复能力')
    page.click('#btnReveal')
    check('reveal shows meaning and three recall ratings', '韧性；恢复力' in page.inner_text('#qCard') and all(page.locator(x).is_visible() for x in ['#btnRecallGood','#btnRecallHard','#btnRecallAgain']))
    page.click('#btnRecallGood')
    check('revealing and grading meaning does not restart the pronunciation',page.evaluate('__spoken')==['resilience'])
    good = word(page, 'resilience')['srs']
    check('independent recall advances only meaning', good['skills']['meaning']['stage'] == 3 and good['skills']['spelling']['stage'] == 0)
    check('history preserves the pre-reveal answer and self-rating', good['history'][-1]['self'] and not good['history'][-1]['assisted'] and good['history'][-1]['response']=='恢复能力' and page.locator('#recallInput').get_attribute('readonly') is not None)

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
    check('spelling prompt still plays automatically',page.evaluate('__spoken')==['resilience'])
    step(page, 'again')
    spelling = word(page, 'resilience')['srs']
    check('spelling error does not erase meaning progress', spelling['skills']['meaning']['stage'] == 2 and spelling['skills']['meaning']['due'] == '2026-11-15' and spelling['skills']['spelling']['lapses'] > 0)
    next_(page)

    seed(page, [old('contribute', '贡献')])
    page.evaluate('''()=>{var v=ER.findWord('contribute');v.sentence='She contributed a lot to the project.';
      v.srs.skills.meaning.due='2026-11-15';v.srs.skills.usage=Object.assign({},v.srs.skills.meaning,{stage:0,due:ER.today(),active:true,last:'2026-11-01'});
      v.srs=SRS.normalize(v.srs,ER.today());ER.saveVocab();}''')
    page.reload(); page.wait_for_selector('#btnStart'); start(page)
    repeated=page.evaluate("ER.clozeBlank({word:'contribute'},'They contribute today and contributed yesterday.').html")
    check('context hides repeated target forms instead of leaking the answer', 'contribute' not in repeated.lower() and repeated.count('id=\"clozeBlank\"')==1 and '〔同词〕' in repeated)
    check('usage prompt blanks inflected form', item(page)['type'] == 'cloze' and item(page)['answer'].lower() == 'contributed')
    check('cloze waits for submission before speaking its hidden answer',page.evaluate('__spoken')==[])
    step(page)
    check('cloze feedback automatically reads the answer in its sentence form',page.evaluate('__spoken')==['contributed'])
    page.keyboard.press('Alt+p')
    check('Alt+P replays the cloze answer after submission',page.evaluate('__spoken')==['contributed','contributed'])
    check('Chinese-supported production records usage without treating the normal cue as a penalty', word(page, 'contribute')['srs']['history'][-1]['skill'] == 'usage' and word(page, 'contribute')['srs']['history'][-1]['task']=='cloze_zh' and not word(page, 'contribute')['srs']['history'][-1]['assisted'])

    # Different abilities are spread over days, not three prompts for one word.
    seed(page, [old('resilience', '韧性；恢复力')], mode='balanced')
    start(page)
    step(page)
    next_(page)
    check('one-word session finishes after one assessment', page.locator('#summaryCard').count()==1)
    track=word(page,'resilience')['srs']
    check('other abilities are deferred without invented success', track['skills']['usage']['due']=='2026-11-03' and track['skills']['spelling']['due']=='2026-11-03' and track['skills']['usage']['stage']==0 and len(track['history'])==1)

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
    check('cloze includes Chinese meaning as a normal prompt', page.locator('#clozeZh').is_visible() and '贡献' in page.inner_text('#clozeZh'))
    page.click('#btnClozeHint')
    step(page)
    check('extra English-letter hint cannot promote usage', word(page,'contribute')['srs']['skills']['usage']['stage']==1 and word(page,'contribute')['srs']['history'][-1]['assisted'])

    seed(page,[old('withoutcontext')])
    page.evaluate("""()=>{var v=ER.findWord('withoutcontext');v.sentence='This sentence has no target.';
      v.srs.skills.usage.active=true;v.srs.skills.usage.due=ER.today();ER.saveVocab();ER.views.review.show();}""")
    start(page)
    check('unusable context has an explicit skip instead of false scoring', item(page)['type']=='context')
    page.click('#btnSkipContext')
    check('skipping missing context finishes and creates no score', page.locator('#summaryCard').count()==1 and len(word(page,'withoutcontext')['srs']['history'])==0)
    page.click('#btnHome')
    check('missing context cannot trap same-day restarting', page.inner_text('#statDue')=='0')

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

    # Chinese context is available without spending an extra hint.
    seed(page,[dict(old('slip','逐渐远离；滑落'),sentence='5°C Goal Slips Away, but the Door Is Not Closed',article='2026-10-23')])
    start(page);step(page)
    check('old decimal-split title is repaired with Chinese context', 'The 1.5°C Goal Slips Away' in page.inner_text('#recallAnswer') and '标题中文' in page.inner_text('#recallAnswer') and '1.5' in page.inner_text('.context-zh'))
    phr=page.evaluate("ER.clozeBlank({word:'premature deaths',type:'phrase'},'The plan reduced deaths, while rules cut premature deaths linked to pollution.')")
    check('phrase cloze blanks the entire phrase and leaves unrelated occurrences intact', phr['accept']=='premature deaths' and 'reduced deaths' in phr['html'] and '〔同词〕' not in phr['html'])
    check('partial phrase match cannot create an arbitrary one-word answer', page.evaluate("ER.clozeBlank({word:'premature deaths',type:'phrase'},'The plan reduced deaths.')") is None)

    seed(page,[dict(old('localcontext','目标意思'),sentence_zh='')])
    page.evaluate("ER.translateSentenceText=()=>Promise.resolve({zh:'他们昨天讨论了这个目标。',src:'test'})")
    start(page);step(page);page.wait_for_function("document.querySelector('.context-zh').textContent.includes('他们昨天讨论了这个目标')")
    check('missing example Chinese is fetched and saved with the original sentence',word(page,'localcontext')['sentence_zh']=='他们昨天讨论了这个目标。')
    page.reload();page.wait_for_selector('#statDue')
    seed(page,[dict(old('stress','强调'),article='2026-10-27',sentence='The authors stress that the situation is not hopeless.',sentence_zh='')])
    page.evaluate("ER.translateSentenceText=()=>Promise.resolve(null)")
    start(page);step(page);page.wait_for_function("document.querySelector('.context-zh').textContent.includes('语境参考')")
    check('failed sentence translation falls back to labelled article context', '所在段落中文（语境参考）' in page.inner_text('.context-zh') and '并非' in page.inner_text('.context-zh'))
    page.reload();page.wait_for_selector('#statDue')

    # A full review can be completed without mouse clicks.
    seed(page,[old('resilience','恢复力'),old('contribute','贡献')])
    page.keyboard.press('Enter');page.wait_for_selector('#recallInput')
    check('Enter starts review and focuses the answer box', page.locator('#recallInput').evaluate('(e)=>document.activeElement===e'))
    page.keyboard.type('123')
    check('number shortcuts do not intercept typing', page.input_value('#recallInput')=='123' and len(word(page,'resilience')['srs']['history'])==0)
    page.fill('#recallInput','恢复能力')
    page.locator('#recallInput').dispatch_event('keydown',{'key':'Enter','isComposing':True,'bubbles':True})
    check('IME Enter does not reveal or submit a composition', not page.locator('#recallAnswer').is_visible())
    page.keyboard.press('Enter')
    check('Enter reveals the written answer', page.locator('#recallAnswer').is_visible())
    page.keyboard.press('Enter')
    check('Enter cannot silently award a self-rating', len(word(page,'resilience')['srs']['history'])==0)
    page.keyboard.press('3');page.keyboard.press('Enter');page.wait_for_selector('#clozeInput')
    check('3 grades meaning and Enter proceeds to context with Chinese visible', word(page,'resilience')['srs']['history'][-1]['rating']=='good' and page.locator('#clozeZh').is_visible())
    page.fill('#clozeInput',item(page)['answer']);page.keyboard.press('Enter');page.keyboard.press('Enter')
    check('keyboard-only mixed round reaches the summary', page.locator('#summaryCard').count()==1)
    seed(page,[old('resilience')]);start(page)
    page.keyboard.press('Alt+h');check('Alt+H requests and records a hint while typing', item(page).get('assisted'))
    page.keyboard.press('Alt+n');page.keyboard.press('Enter')
    check('Alt+N skips an unknown word with a failure record', word(page,'resilience')['srs']['history'][-1]['rating']=='again')
    seed(page,[old('resilience')]);start(page)
    page.evaluate("document.getElementById('settingsPanel').hidden=false;document.getElementById('optDsKey').focus()")
    page.keyboard.press('Escape')
    check('closing settings with Escape does not pause review', page.locator('#qCard').count()==1 and page.locator('#summaryCard').count()==0)
    page.locator('#recallInput').focus();page.keyboard.press('Escape')
    check('Escape pauses the active round', page.locator('#summaryCard').count()==1)
    check('pause stops active pronunciation',page.evaluate('__speechStops')>0)
    audio_race=page.evaluate('''async()=>{
      const play=HTMLMediaElement.prototype.play;window.__spoken=[];
      let rejectOld;HTMLMediaElement.prototype.play=()=>new Promise((_,reject)=>{rejectOld=reject;});
      ER.speak('old word','https://example.test/old.mp3');ER.speak('current word');rejectOld(new Error('late failure'));
      await Promise.resolve();const latest=__spoken.slice();
      ER.speak('stopped word','https://example.test/stopped.mp3');ER.stopWordAudio();rejectOld(new Error('stopped'));
      await Promise.resolve();HTMLMediaElement.prototype.play=play;
      return {latest,afterStop:__spoken.slice()};
    }''')
    check('late audio failures cannot replay a previous or paused word',audio_race=={'latest':['current word'],'afterStop':['current word']})

    # A word marked familiar remains in the vocabulary and will be spot-checked.
    seed(page, [], new=5)
    start(page)
    page.wait_for_selector('#btnKnown')
    known_name = item(page)['word']
    check('new-word learning card automatically reads its word',page.evaluate('__spoken')==[known_name])
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
    check('main round contains only one assessment per distinct word', len(state(page)['queue'])==13)
    log = finish(page, wrong_first={'resilience'})
    check('review mixes written meaning and context production', {x['type'] for x in log}=={'recall','cloze'})
    attempts = [x for x in log if x['word'] == 'resilience' and x['skill'] == 'meaning']
    check('wrong word gets at most one optional final retry', len(attempts) == 2 and not attempts[1]['first'], str([(x['type'],x['index']) for x in attempts]))
    check('retry comes after all first tests with eight other words between', len(attempts) == 2 and attempts[1]['index'] == 13 and len({x['word'] for x in log[1:13]})>=8)
    hist = word(page, 'resilience')['srs']['history']
    check('same-session corrections do not double-promote or erase error', hist[-1]['practice'] and word(page,'resilience')['srs']['skills']['meaning']['due'] == '2026-11-03')

    # Small sets must finish, even when every answer is wrong.
    for size in (3,4):
        names=['small'+str(i) for i in range(size)]
        seed(page,[old(w) for w in names])
        start(page)
        small_log=finish(page,wrong_first=set(names))
        check(f'{size}-word set never loops after errors', len(small_log)==size and len({x['word'] for x in small_log})==size)
        page.click('#btnHome')
        check(f'{size}-word set stays finished on same-day restart', page.inner_text('#statDue')=='0' and page.locator('#btnResume').count()==0)
        start(page)
        check(f'{size}-word set cannot immediately re-enter the old queue', page.locator('#qCard').count()==0)
        page.evaluate("ER.setToday('2026-11-03');ER.views.review.show()")
        check(f'{size}-word errors are scheduled for tomorrow', page.inner_text('#statDue')==str(size))
        page.reload();page.wait_for_selector('#statDue')

    seed(page,[old('batch'+str(i)) for i in range(12)])
    start(page)
    batch=[]
    while not page.locator('#retryIntro').count():
        batch.append(item(page)['word']);step(page,'again');next_(page)
    check('all twelve distinct words finish before optional corrections', len(batch)==12 and len(set(batch))==12)
    page.reload();page.wait_for_selector('#btnResume');page.click('#btnResume');page.wait_for_selector('#retryIntro')
    check('refresh keeps the optional retry boundary', page.locator('#btnStartRetry').is_visible())
    page.click('#btnStartRetry')
    retries=[]
    while not page.locator('#summaryCard').count():
        retries.append(item(page)['word']);step(page,'again');next_(page)
    check('all-wrong retries terminate without growing another loop', len(retries)==4 and len(set(retries))==4)
    check('failed retry keeps original schedule and no fabricated mastery', all(word(page,w)['srs']['history'][-1]['practice'] and word(page,w)['srs']['skills']['meaning']['learningPending'] for w in retries if word(page,w)['srs']['history'][-1]['skill']=='meaning'))

    seed(page,[old('skip'+str(i)) for i in range(10)])
    start(page)
    while not page.locator('#retryIntro').count():
        step(page,'again');next_(page)
    page.click('#btnFinishReview')
    check('optional correction can be skipped without losing tomorrow tasks', page.locator('#summaryCard').count()==1 and all(word(page,'skip'+str(i))['srs']['due']=='2026-11-03' for i in range(10)))

    seed(page,[],new=5)
    start(page)
    new_log=finish(page)
    check('five new words get one written practice each', len(new_log)==5 and len({x['word'] for x in new_log})==5 and all(x['first'] for x in new_log))
    check('new-word practice cannot masquerade as delayed mastery', all(word(page,x['word'])['srs']['stage']==0 and word(page,x['word'])['srs']['history'][-1]['assisted'] for x in new_log))
    page.evaluate("ER.setToday('2026-11-03');ER.settings.newPerDay=0;ER.views.review.show()")
    start(page)
    check('yesterday new words get cold meaning recall today', item(page)['type']=='recall' and not item(page).get('assisted'))
    cold_log=finish(page)
    check('one next-day independent answer resolves pending without repeats', len(cold_log)==5 and all(not word(page,x['word'])['srs']['skills']['meaning']['learningPending'] for x in cold_log))
    page.reload();page.wait_for_selector('#statDue')

    seed(page,[old('resilience')])
    start(page)
    page.fill('#recallInput','坚持并从挫折中恢复')
    page.reload();page.wait_for_selector('#btnResume');page.click('#btnResume');page.wait_for_selector('#recallInput')
    check('refresh preserves the written answer before reveal', page.input_value('#recallInput')=='坚持并从挫折中恢复' and not page.locator('#recallAnswer').is_visible())
    page.click('#btnReveal')
    page.reload();page.wait_for_selector('#btnResume');page.click('#btnResume');page.wait_for_selector('#recallRating:not([hidden])')
    check('refresh after reveal retains locked original answer without grading', page.input_value('#recallInput')=='坚持并从挫折中恢复' and page.locator('#recallInput').get_attribute('readonly') is not None and len(word(page,'resilience')['srs']['history'])==0)
    page.click('#btnRecallGood');next_(page)

    seed(page,[old('resilience')])
    start(page)
    page.click('#btnRecallSkip');next_(page)
    check('cannot-recall shortcut records failure without self-awarding success', word(page,'resilience')['srs']['history'][-1]['rating']=='again' and page.locator('#summaryCard').count()==1)

    seed(page,[old('resilience')])
    page.evaluate("localStorage.setItem('er_review_session',JSON.stringify({version:2,date:ER.today(),session:{queue:Array(12).fill({word:'resilience',kind:'test',skill:'meaning'}),targets:{}}}))")
    page.reload();page.wait_for_selector('#statDue')
    check('obsolete looping queue is retired without erasing vocabulary', page.locator('#btnResume').count()==0 and word(page,'resilience')['srs']['stage']==2)
    start(page)
    check('replacement session has only one test for a legacy word', len(state(page)['queue'])==1)

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
    out = ROOT / 'output' / 'playwright'
    out.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out/'review-written-mobile.png'), full_page=True)
    check('mobile review has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
    page.fill('#recallInput', '恢复能力')
    page.locator('#btnReveal').tap()
    check('mobile rating buttons have comfortable targets', all(page.locator(sel).bounding_box()['height'] >= 40 for sel in ['#btnRecallGood','#btnRecallHard','#btnRecallAgain']))
    page.locator('#btnRecallHard').tap()
    check('mobile hard response is saved', word(page,'resilience')['srs']['history'][-1]['rating'] == 'hard')
    out = ROOT / 'output' / 'playwright'
    out.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out/'review-mobile.png'), full_page=True)
    seed(page,[old('resilience'),old('contribute','贡献')])
    page.evaluate("()=>{var v=ER.findWord('contribute');v.sentence='She contributed a lot to the project.';v.sentence_zh='她为这个项目贡献了很多。';ER.saveVocab();}")
    start(page);step(page);next_(page)
    check('mobile context task hides target word and accepts typed production', item(page)['type']=='cloze' and 'contribute' not in page.inner_text('#qCard'))
    page.screenshot(path=str(out/'review-context-mobile.png'), full_page=True)
    step(page);next_(page)
    check('mobile mixed review finishes without looping', page.locator('#summaryCard').count()==1)
    ctx.close()
    browser.close()

check('no JavaScript runtime errors', not errors, '; '.join(errors[:5]))
print(f'\n{sum(checks)}/{len(checks)} checks passed')
sys.exit(0 if all(checks) else 1)
