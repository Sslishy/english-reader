#!/usr/bin/env python3
"""Retries complete only after each selected word is spelled correctly; isolated browser data."""
import atexit,json,os,socket,subprocess,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];DAY='2026-11-10';checks=[];errors=[]
def check(name,ok):checks.append(bool(ok));print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def old(word):return {'word':word,'zh':'测试词义','sentence':'They discussed '+word+' yesterday.','sentence_zh':'他们昨天讨论了这个词。','srs':{'stage':2,'due':DAY,'reps':2,'last':'2026-11-06','added':'2026-10-20'}}
def seed(pg,words):
    pg.evaluate('v=>{localStorage.clear();localStorage.setItem("er_vocab",JSON.stringify(v));localStorage.setItem("er_settings",JSON.stringify({reviewPolicy:7,reviewMode:"dictation",reviewLimit:5,newPerDay:0}));}',[old(w) for w in words]);pg.reload();pg.wait_for_selector('#btnStart')
def state(pg):return pg.evaluate('ER.views.review.state()')
def current(pg):s=state(pg);return s['queue'][s['idx']]
def start(pg):pg.click('#btnStart');pg.wait_for_selector('#spellInput')
def submit(pg,text):pg.fill('#spellInput',text);pg.keyboard.press('Enter');pg.wait_for_selector('#btnNext:not([hidden])')
def next_(pg):pg.keyboard.press('Enter');pg.wait_for_selector('#spellInput,#summaryCard')
def skills(pg,word):return pg.evaluate('w=>ER.findWord(w).srs.skills',word)
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
server=subprocess.Popen([sys.executable,'-m','http.server',str(port),'--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
atexit.register(server.terminate);time.sleep(.4);base=f'http://127.0.0.1:{port}/?today={DAY}#/review'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'),args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1050,'height':900})
    ctx.add_init_script('window.__spoken=[];window.SpeechSynthesisUtterance=function(t){this.text=t;};speechSynthesis.speak=u=>__spoken.push(u.text);speechSynthesis.cancel=()=>{};speechSynthesis.getVoices=()=>[{lang:"en-US"}];')
    ctx.route('https://**/*',lambda r:r.fulfill(status=204,body=''))
    pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(base);pg.wait_for_selector('#btnStart')
    words=['retain','benefit','figure','hesitate','sufficient'];seed(pg,words);start(pg);order=[q['word'] for q in state(pg)['queue']];wrong={order[0],order[2]}
    for name in order:
        check('first pass keeps the planned word '+name,current(pg)['word']==name)
        submit(pg,'wrong' if name in wrong else name);next_(pg)
    check('two failed words return after the remaining first-pass words',current(pg)['word']==order[0] and current(pg)['dictationRetry'] and pg.locator('#summaryCard').count()==0)
    check('progress counts correctly spelled words rather than attempted questions','已拼对 3 / 5' in pg.inner_text('#spellingProgress'))
    before={w:skills(pg,w) for w in wrong};submit(pg,'stillwrong');next_(pg)
    check('a second failure rotates behind the other pending word',current(pg)['word']==order[2])
    check('each failed word has only one pending retry',all(len([q for q in state(pg)['queue'] if not q.get('done') and q['word']==w])==1 for w in wrong))
    pg.fill('#spellInput','unfinished draft');pg.reload();pg.wait_for_selector('#btnResume');pg.click('#btnResume');pg.wait_for_selector('#spellInput')
    check('reload restores retry position and draft',current(pg)['word']==order[2] and pg.input_value('#spellInput')=='unfinished draft')
    submit(pg,order[2]);next_(pg);check('a corrected word leaves the pending set',current(pg)['word']==order[0] and '已拼对 4 / 5' in pg.inner_text('#spellingProgress'))
    submit(pg,'wrongagain');next_(pg)
    check('a lone remaining word repeats until correct',current(pg)['word']==order[0] and pg.locator('#summaryCard').count()==0)
    check('retry input is blank and English feedback is hidden',pg.input_value('#spellInput')=='' and order[0] not in pg.inner_text('#qCard'))
    out=ROOT/'output/playwright';out.mkdir(parents=True,exist_ok=True);pg.screenshot(path=str(out/'dictation-retry-progress-v8.png'),full_page=False)
    submit(pg,order[0]);next_(pg)
    check('session completes only when all five words have been spelled correctly','5 个词已全部拼对' in pg.inner_text('#summaryCard') and '已拼对 5 / 5' in pg.inner_text('#spellingSummary'))
    check('repeated practice preserves the original skill schedules and failure evidence',all(skills(pg,w)==before[w] for w in wrong))
    check('first wrong grade survives while retries are marked as practice',pg.evaluate('ws=>ws.every(w=>{let h=ER.findWord(w).srs.history;return h[0].rating==="again"&&h[0].first&&h.slice(1).every(x=>x.practice&&!x.first)&&h.at(-1).rating==="good";})',list(wrong)))
    check('correct first-pass words do not repeat',pg.evaluate('ws=>ws.every(w=>ER.findWord(w).srs.history.length===1)',[w for w in order if w not in wrong]))
    check('all retries still consume only five daily word slots',pg.evaluate('JSON.parse(localStorage.getItem("er_daily")).modes.dictation.reviewWords.length')==5)
    pg.screenshot(path=str(out/'dictation-retry-complete-v8.png'),full_page=False)
    seed(pg,['retain']);start(pg);pg.keyboard.press('Alt+n');next_(pg)
    check('looking at the answer also schedules a retry',current(pg).get('dictationRetry') and '待拼对 1' in pg.inner_text('#spellingProgress'))
    pg.keyboard.press('Alt+h');submit(pg,'retain');next_(pg)
    check('a correct spelling with a hint completes practice without becoming mastery',pg.locator('#summaryCard').count()==1 and pg.evaluate('ER.findWord("retain").srs.history.at(-1).assisted') and pg.evaluate('ER.findWord("retain").srs.skills.spelling.learningPending'))
    seed(pg,['retain']);pg.evaluate('()=>{let v=ER.findWord("retain");v.srs.skills.spelling={...v.srs.skills.meaning,active:true,due:"2026-12-01"};v.srs.skills.meaning.due="2026-12-01";ER.saveVocab();}');pg.reload();pg.wait_for_selector('#btnStart');start(pg);future=skills(pg,'retain');submit(pg,'wrong');next_(pg);submit(pg,'retain');next_(pg)
    check('extra practice errors and retries preserve a future FSRS schedule',skills(pg,'retain')==future)
    seed(pg,['retain']);start(pg);submit(pg,'wrong')
    pg.evaluate('()=>{let s=ER.views.review.state();s.queue=s.queue.slice(0,s.mainEnd);delete s.spellingResults;ER.lsSet("er_review_session",{version:5,date:ER.today(),sessions:{dictation:{limit:5,session:s}}});}')
    pg.reload();pg.wait_for_selector('#btnResume');pg.click('#btnResume');pg.wait_for_selector('#spellInput')
    check('an unfinished session from the previous version gains its missing retry',current(pg).get('dictationRetry') and current(pg)['word']=='retain')
    submit(pg,'retain');next_(pg)
    seed(pg,words);start(pg)
    for _ in range(5):submit(pg,'wrong');next_(pg)
    snapshot=pg.evaluate('ER.getVocab().map(v=>({word:v.word,skills:v.srs.skills}))')
    pg.evaluate('localStorage.removeItem("er_review_session")');pg.reload();pg.wait_for_selector('#btnRepairSpelling')
    check('today\'s old unfinished errors remain available even at the daily cap',pg.inner_text('#statDue')=='0' and '5 个词' in pg.inner_text('#btnRepairSpelling'))
    pg.click('#btnRepairSpelling');pg.wait_for_selector('#spellInput')
    for _ in range(5):submit(pg,current(pg)['word']);next_(pg)
    check('repairing old errors completes the full set without changing its schedules','5 个词已全部拼对' in pg.inner_text('#summaryCard') and snapshot==pg.evaluate('ER.getVocab().map(v=>({word:v.word,skills:v.srs.skills}))'))
    pg.click('#btnHome');check('corrected words no longer appear as unfinished errors',pg.locator('#btnRepairSpelling').count()==0)
    ctx.close();browser.close()
check('no JavaScript runtime errors',not errors)
if errors:print(errors)
print(f'{sum(checks)}/{len(checks)} dictation retry checks passed');sys.exit(0 if all(checks) else 1)
