#!/usr/bin/env python3
"""Daily-cap and listen-and-spell regression; isolated data and mocked audio/network."""
import atexit,json,os,socket,subprocess,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];DAY='2026-11-05';checks=[];errors=[]
def check(name,ok):checks.append(bool(ok));print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def old(word):return {'word':word,'zh':'测试词义','sentence':'They discussed '+word+' yesterday.','sentence_zh':'他们昨天讨论了这个词。','srs':{'stage':2,'due':DAY,'reps':2,'last':'2026-10-30','added':'2026-10-20'}}
def seed(pg,entries,**settings):
    cfg={'reviewPolicy':7,'reviewMode':'dictation','reviewLimit':15,'newPerDay':0,**settings}
    pg.evaluate('([v,s])=>{localStorage.clear();localStorage.setItem("er_vocab",JSON.stringify(v));localStorage.setItem("er_settings",JSON.stringify(s));}',[entries,cfg]);pg.reload();pg.wait_for_selector('#statDue')
def state(pg):return pg.evaluate('ER.views.review.state()')
def start(pg):pg.click('#btnStart');pg.wait_for_selector('#qCard,#btnGotIt,#statDue')
def answer(pg,value):pg.fill('#spellInput',value);pg.keyboard.press('Enter');pg.wait_for_selector('#btnNext:not([hidden])')
def finish(pg):
    words=[]
    for _ in range(50):
        if pg.locator('#summaryCard').count():return words
        if pg.locator('#btnGotIt').count():pg.click('#btnGotIt');continue
        s=state(pg);it=s['queue'][s['idx']];word=it['word'];words.append(word)
        if it['type']=='recall':
            pg.fill('#recallInput','测试词义');pg.click('#btnReveal');pg.click('#btnRecallGood')
        elif it['type']=='cloze':
            pg.fill('#clozeInput',it['answer']);pg.click('#btnCheck')
        else:answer(pg,word)
        pg.keyboard.press('Enter')
    raise AssertionError('Review did not terminate')
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
server=subprocess.Popen([sys.executable,'-m','http.server',str(port),'--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
atexit.register(server.terminate);time.sleep(.4);base=f'http://127.0.0.1:{port}/?today={DAY}#/review'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'),args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1050,'height':900})
    ctx.add_init_script('''window.__spoken=[];window.SpeechSynthesisUtterance=function(t){this.text=t;};speechSynthesis.speak=u=>__spoken.push(u.text);speechSynthesis.cancel=()=>{};speechSynthesis.getVoices=()=>[{lang:'en-US'}];''')
    ctx.route('https://**/*',lambda r:r.fulfill(status=204,body=''))
    pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(base);pg.wait_for_selector('#statDue')
    check('default is listen-and-spell with thirty per mode and three new at most',pg.input_value('#optReviewMode')=='dictation' and pg.input_value('#optReviewLimit')=='30' and pg.input_value('#optNewPer')=='3')
    seed(pg,[old('word'+str(i)) for i in range(40)],newPerDay=3)
    check('large backlog is shown separately from today\'s fifteen',pg.inner_text('#statDue')=='15' and '25 个词' in pg.inner_text('#reviewBacklog') and pg.inner_text('#statNew')=='0')
    out=ROOT/'output/playwright';out.mkdir(parents=True,exist_ok=True);pg.screenshot(path=str(out/'daily-review-plan-v6.png'),full_page=False)
    start(pg);s=state(pg)
    check('queue contains fifteen unique spelling tasks',len(s['queue'])==15 and len({q['word'] for q in s['queue']})==15 and all(q['skill']=='spelling' for q in s['queue']))
    first=s['queue'][s['idx']]['word']
    check('word auto-plays while its English spelling stays hidden',pg.evaluate('__spoken')==[first] and first not in pg.inner_text('#qCard'))
    pg.fill('#spellInput','未完成');pg.locator('#spellInput').dispatch_event('keydown',{'key':'Enter','isComposing':True,'keyCode':229})
    check('IME confirmation cannot submit an unfinished spelling',pg.locator('#btnNext').is_hidden() and not pg.locator('#spellInput').get_attribute('readonly'))
    pg.fill('#spellInput','draft');pg.reload();pg.wait_for_selector('#btnResume');pg.click('#btnResume');pg.wait_for_selector('#spellInput')
    check('reload resumes the same word and spelling draft',state(pg)['queue'][state(pg)['idx']]['word']==first and pg.input_value('#spellInput')=='draft')
    words=finish(pg)
    check('all fifteen finish once without same-day loops',len(words)==15 and len(set(words))==15 and pg.locator('#retryIntro').count()==0 and pg.locator('#btnAgain').count()==0)
    learned=pg.evaluate('ER.getVocab().filter(v=>v.srs.skills.spelling.active)')
    check('every practiced word has independent FSRS spelling memory and its actual response',len(learned)==15 and all(v['srs']['skills']['spelling'].get('fsrs') and v['srs']['history'][-1]['response']==v['word'] for v in learned))
    check('spelling does not rewrite meaning progress or postpone its old due date',all(v['srs']['skills']['meaning']['stage']==2 and v['srs']['skills']['meaning']['due']==DAY for v in learned))
    pg.click('#btnHome');pg.reload();pg.wait_for_selector('#statDue')
    check('daily cap survives refresh',pg.inner_text('#statDue')=='0' and pg.inner_text('#statTodayDone')=='15 / 15')
    pg.select_option('#optReviewMode','reading')
    check('reading has its own daily allowance after dictation is full',pg.inner_text('#statDue')=='15' and pg.inner_text('#statTodayDone')=='0 / 15')
    pg.select_option('#optReviewMode','dictation');start(pg)
    check('starting another round cannot reopen a full daily workload',pg.locator('#qCard').count()==0 and pg.inner_text('#statDue')=='0')
    pg.goto(base.replace(DAY,'2026-11-06'));pg.wait_for_selector('#statDue');start(pg);tomorrow=finish(pg)
    check('next day gives new first-pass words rather than repeating today\'s correct words',len(tomorrow)==15 and not set(tomorrow)&set(words))
    pg.goto(base);pg.wait_for_selector('#statDue');phrase='take the time to think about the whole problem';seed(pg,[old(phrase)])
    start(pg)
    check('long phrases use full typed dictation rather than word-order choices',pg.locator('#spellInput').count()==1 and pg.locator('#orderPool').count()==0 and phrase not in pg.inner_text('#qCard'))
    pg.keyboard.press('Alt+h');answer(pg,phrase)
    check('first-letter hints are recorded as assisted and cannot create FSRS mastery',pg.evaluate('ER.getVocab()[0].srs.history.at(-1).assisted') and pg.evaluate('ER.getVocab()[0].srs.skills.spelling.fsrs') is None)
    pg.keyboard.press('Enter');check('hinted word ends for today',pg.locator('#summaryCard').count()==1)
    seed(pg,[old('retain')]);start(pg);answer(pg,'wrong');pg.keyboard.press('Enter')
    check('wrong spelling returns tomorrow and does not loop today',pg.evaluate('ER.findWord("retain").srs.skills.spelling.due')=='2026-11-06' and pg.locator('#summaryCard').count()==1)
    seed(pg,[{'word':'retain','zh':'保留','srs':{'added':DAY}}],newPerDay=1)
    start(pg);pg.wait_for_selector('#btnGotIt')
    check('new words learn first and cannot skip their spelling task with known shortcut',pg.locator('#btnKnown').count()==0 and len(state(pg)['queue'])==2)
    pg.click('#btnGotIt');answer(pg,'retain');pg.keyboard.press('Enter')
    check('same-day new-word dictation is practice rather than delayed evidence',pg.evaluate('ER.findWord("retain").srs.history.at(-1).assisted') and pg.evaluate('JSON.parse(localStorage.getItem("er_daily")).newDone')==1)
    backup=pg.evaluate('ER.buildBackup()');before=pg.evaluate('ER.getVocab()')
    pg.evaluate('localStorage.clear()');pg.reload();pg.wait_for_selector('#statDue');pg.evaluate('b=>ER.applyBackup(b,"replace")',backup)
    after=pg.evaluate('ER.getVocab()')
    for records in [before,after]:
        for v in records:v.pop('updatedAt',None)
    check('backup preserves the daily budget and complete vocabulary records',after==before and pg.evaluate('JSON.parse(localStorage.getItem("er_daily")).reviewWords.length')==1)
    seed(pg,[old('word'+str(i)) for i in range(30)],reviewLimit=30)
    start(pg);first_mode=finish(pg);snapshot=pg.evaluate('ER.getVocab().map(v=>({word:v.word,skills:v.srs.skills}))')
    pg.click('#btnHome');pg.select_option('#optReviewMode','reading');pg.locator('.review-home').screenshot(path=str(out/'independent-modes-v7.png'));start(pg);second_mode=finish(pg)
    pg.click('#btnHome');pg.select_option('#optReviewMode','balanced');start(pg);third_mode=finish(pg)
    check('each mode can complete thirty words on the same day',all(len(w)==30 and len(set(w))==30 for w in [first_mode,second_mode,third_mode]))
    check('cross-mode extra practice preserves every original skill schedule and memory state',snapshot==pg.evaluate('ER.getVocab().map(v=>({word:v.word,skills:v.srs.skills}))'))
    check('practice histories retain each mode without false independent grades',pg.evaluate("ER.getVocab().every(v=>['dictation','reading','balanced'].every(m=>v.srs.history.some(h=>h.mode===m))&&v.srs.history.filter(h=>h.mode!=='dictation').every(h=>h.practice&&!h.first))"))
    pg.click('#btnHome');pg.reload();pg.wait_for_selector('#statDue')
    check('all three independent counters survive refresh',pg.evaluate("Object.values(JSON.parse(localStorage.getItem('er_daily')).modes).every(m=>m.reviewWords.length===30)"))
    pg.select_option('#optReviewMode','dictation');check('completed dictation remains full after other modes',pg.inner_text('#statDue')=='0')
    seed(pg,[old('word'+str(i)) for i in range(8)],reviewLimit=30)
    start(pg);pg.fill('#spellInput','saved dictation draft');pg.keyboard.press('Escape');pg.click('#btnHome');pg.select_option('#optReviewMode','reading');start(pg)
    pg.fill('#recallInput','保存的中文草稿');pg.keyboard.press('Escape');pg.click('#btnHome');pg.select_option('#optReviewMode','dictation');pg.click('#btnResume');pg.wait_for_selector('#spellInput')
    check('switching modes preserves the dictation session and draft',pg.input_value('#spellInput')=='saved dictation draft')
    pg.keyboard.press('Escape');pg.click('#btnHome');pg.select_option('#optReviewMode','reading');pg.click('#btnResume');pg.wait_for_selector('#recallInput')
    check('reading also retains its own paused session and draft',pg.input_value('#recallInput')=='保存的中文草稿')
    ctx.close()
    mob=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);mob.route('https://**/*',lambda r:r.fulfill(status=204,body=''));mp=mob.new_page();mp.on('pageerror',lambda e:errors.append(str(e)));mp.goto(base);mp.wait_for_selector('#statDue');seed(mp,[old('retain')]);mp.click('#btnStart');mp.wait_for_selector('#spellInput')
    check('mobile spelling and daily controls fit the viewport',mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1') and mp.locator('#btnCheck').bounding_box()['height']>=36)
    mp.screenshot(path=str(out/'daily-review-dictation-v6.png'),full_page=False);mob.close();browser.close()
check('no runtime errors',not errors)
if errors:print(errors)
print(f'{sum(checks)}/{len(checks)} daily review checks passed');sys.exit(0 if all(checks) else 1)
