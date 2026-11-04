#!/usr/bin/env python3
"""Local browser checks; DeepSeek, dictionary and translation requests are mocked."""
import atexit
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
checks=[];errors=[]
def check(name,ok):
    checks.append(bool(ok));print(('PASS ' if ok else 'FAIL ')+name,flush=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
server=subprocess.Popen([sys.executable,'-m','http.server',str(port),'--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
atexit.register(server.terminate);time.sleep(.4)
BASE=f'http://127.0.0.1:{port}/?today=2026-11-03#/read/2026-10-27'
KEY='sk-mocked-sentence-coach-only'
LESSON='''## 参考译文
研究人员指出，气候变化正在影响人们的健康。
## 句子主干
先识别主语 **researchers** 和谓语，确定是谁在说什么。
## 翻译顺序
1. researchers → 研究人员；先确定主语。
2. 然后译出动作及其内容，再补充时间和范围。
## 实用短语
- **climate change**：气候变化；用于讨论环境问题。
## 迁移提示
留意数字、否定和修饰范围。
<img src=x onerror="window.__coachXss=1">
'''
class Fake:
    def __init__(self):self.calls=[];self.mode='ok';self.hung=[];self.lesson=LESSON
    def handle(self,r):
        if r.request.method=='OPTIONS':r.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'});return
        if r.request.url.endswith('/user/balance'):
            r.fulfill(status=200,content_type='application/json',body=json.dumps({'is_available':True,'balance_infos':[]}));return
        self.calls.append(json.loads(r.request.post_data or '{}'))
        if self.mode=='hang':self.hung.append(r);return
        if self.mode=='offline':r.abort('internetdisconnected');return
        if self.mode.isdigit():r.fulfill(status=int(self.mode),body='{}');return
        reason='length' if self.mode=='truncated' else 'stop'
        if self.mode=='json':r.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'message':{'content':self.lesson},'finish_reason':reason}]}));return
        chunks=[self.lesson[i:i+17] for i in range(0,len(self.lesson),17)]
        body=''.join('data: '+json.dumps({'choices':[{'delta':{'content':x}}]},ensure_ascii=False)+'\n\n' for x in chunks)
        body+='data: '+json.dumps({'choices':[{'delta':{},'finish_reason':reason}]})+'\n\ndata: [DONE]\n\n'
        r.fulfill(status=200,content_type='text/event-stream; charset=utf-8',body=body)
    def release(self):
        for r in self.hung:
            try:r.abort()
            except Exception:pass
        self.hung=[]
def records(page):return page.evaluate('ER.getLearningState()')
def wait_done(page,i=0):
    page.wait_for_function('(i)=>{var x=document.getElementById("coach"+i);return x&&!x.querySelector(".spinner")}',arg=i,timeout=15000)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'),args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1100,'height':900});fake=Fake()
    ctx.route('https://**/*',lambda r:r.fulfill(status=204,body=''))
    ctx.route('https://api.deepseek.com/**',fake.handle)
    pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE);pg.wait_for_selector('.coach-btn')
    count=pg.evaluate('LearningCore.sentences(ER.currentArticle()).length')
    check('one translation-teaching button follows each sentence',pg.locator('.coach-btn').count()==count)
    check('paragraph submission is replaced and AI is not called on page load',pg.locator('.tp-btn,.tp-in').count()==0 and not fake.calls)
    pg.click('[data-coach="0"]');wait_done(pg)
    check('no key prompts settings without an API request','API 密钥' in pg.inner_text('#coach0') and not fake.calls)
    pg.click('[data-coach-settings]');pg.fill('#optDsKey',KEY);pg.click('#btnDsSave');pg.click('#btnCloseSettings')
    pg.click('[data-coach-retry="0"]');wait_done(pg)
    req=fake.calls[-1];msgs=req['messages'];first=pg.evaluate('LearningCore.sentences(ER.currentArticle())[0].text')
    check('AI receives the selected sentence and its surrounding paragraph',first in msgs[1]['content'] and '所在段落' in msgs[1]['content'])
    check('prompt teaches ordering, structure and phrases without demanding a student draft',all(x in msgs[0]['content'] for x in ['翻译顺序','句子主干','实用短语','没有提交译文']) and '学生译文' not in msgs[1]['content'])
    check('existing API transport streams a bounded teaching response',req['model']=='deepseek-chat' and req['stream'] and req['max_tokens']==2200)
    check('streamed Chinese lesson renders all teaching sections',pg.locator('#coach0 h4').count()==5 and '研究人员指出' in pg.inner_text('#coach0'))
    check('model HTML is escaped',pg.locator('#coach0 img,#coach0 script').count()==0 and pg.evaluate('window.__coachXss') is None)
    lesson=next(x for x in records(pg).values() if x.get('type')=='lesson')
    check('lesson and sentence translation are saved with source provenance',lesson['original']==first and lesson['translation']=='研究人员指出，气候变化正在影响人们的健康。' and lesson['context'])
    calls=len(fake.calls);pg.click('[data-coach="0"]');pg.click('[data-coach="0"]');wait_done(pg)
    check('reopening cached explanation makes no paid request',len(fake.calls)==calls)
    pg.reload();pg.wait_for_selector('.coach-btn.has');pg.click('[data-coach="0"]');wait_done(pg)
    check('cached teaching survives reload',len(fake.calls)==calls and pg.locator('#coach0 h4').count()==5)
    collect=pg.locator('#coach0 .coach-save-phrase')
    check('cached useful phrase gets a collection button without another AI call',collect.count()==1 and '加入生词本' in collect.inner_text() and len(fake.calls)==calls)
    collect.click();saved_phrase=pg.evaluate("ER.findWord('climate change')")
    check('phrase collection saves meaning, source sentence and its translation',saved_phrase['type']=='phrase' and saved_phrase['zh']=='气候变化' and saved_phrase['sentence']==first and saved_phrase['sentence_zh']==lesson['translation'] and saved_phrase['article']=='2026-10-27')
    check('saved phrases show a disabled collected state',collect.is_disabled() and '已加入' in collect.inner_text())
    pg.click('[data-coach="0"]');pg.click('[data-coach="0"]');wait_done(pg)
    check('reopening cannot create duplicate vocabulary or reset progress',pg.evaluate("ER.getVocab().filter(v=>v.word==='climate change').length")==1 and pg.evaluate("ER.findWord('climate change').srs")==saved_phrase['srs'])
    pg.goto(BASE.replace('#/read/2026-10-27','#/review'));pg.wait_for_selector('#btnStart');pg.click('#btnStart');pg.wait_for_selector('#btnGotIt')
    check('collected phrase is scheduled for review with its original context','climate change' in pg.inner_text('#reviewBox') and first in pg.inner_text('#reviewBox'))
    pg.goto(BASE);pg.wait_for_selector('.coach-btn')
    if pg.locator('[data-coach="0"]').get_attribute('aria-expanded')!='true':pg.click('[data-coach="0"]')
    wait_done(pg)
    original_lessons=records(pg);cache_key=next(k for k,v in original_lessons.items() if v.get('original')==first)
    variants=LESSON.replace('- **climate change**：气候变化；用于讨论环境问题。','### 1. **rising seas**\n- 此处意思：海平面上升\n\n### 2. **failed harvests**\n- 此处意思：歉收')
    pg.evaluate('([k,r,text])=>{ER.saveLearningRecord(k,{...r,lesson:text});ER.refreshSentenceLessons();}',[cache_key,original_lessons[cache_key],variants])
    check('older numbered phrase subheadings each receive their own button',pg.locator('#coach0 .coach-save-phrase').count()==2)
    pg.evaluate('([k,r])=>{ER.saveLearningRecord(k,r);ER.refreshSentenceLessons();}',[cache_key,original_lessons[cache_key]])
    pg.click('[data-coach-practice="0"]')
    ds=[x for x in records(pg).values() if x.get('type')=='drill']
    check('learned sentence can become a next-day translation practice',len(ds)==1 and ds[0]['due']=='2026-11-04' and ds[0]['original']==first)
    pg.click('[data-coach-practice="0"]');check('practice action deduplicates',len([x for x in records(pg).values() if x.get('type')=='drill'])==1)
    for mode,want in [('401','无效'),('402','余额不足'),('429','太频繁'),('500','繁忙'),('offline','网络连接失败')]:
        fake.mode=mode;pg.click('[data-coach-retry="0"]');wait_done(pg)
        check('request error '+mode+' keeps previous lesson and supports retry',want in pg.inner_text('#coach0 .coach-status') and pg.locator('#coach0 h4').count()==5)
    fake.mode='hang';pg.evaluate('ER.DS_TIMEOUT=600');pg.click('[data-coach-retry="0"]');wait_done(pg)
    check('timeout exits loading and keeps cached explanation','超时' in pg.inner_text('#coach0 .coach-status'));fake.release()
    pg.evaluate('ER.DS_TIMEOUT=60000');pg.click('[data-coach-retry="0"]');pg.wait_for_selector('[data-coach-stop="0"]');pg.click('[data-coach-stop="0"]')
    check('stop cancels generation without erasing the previous lesson','已停止' in pg.inner_text('#coach0') and pg.locator('#coach0 h4').count()==5);fake.release()
    fake.mode='json';pg.click('[data-coach-retry="0"]');wait_done(pg)
    check('nonstreaming response works through the same UI',pg.locator('#coach0 h4').count()==5 and '已保存' in pg.inner_text('#coach0 .coach-status'))
    fake.mode='truncated';pg.click('[data-coach-retry="0"]');wait_done(pg)
    check('truncated teaching is labelled and not offered as a complete practice answer','被截断' in pg.inner_text('#coach0') and pg.locator('[data-coach-practice="0"]').count()==0)
    fake.mode='ok';pg.click('[data-coach-retry="0"]');wait_done(pg)
    pg.locator('[data-coach="0"]').focus();pg.keyboard.press('Alt+ArrowDown')
    check('keyboard moves focus to the next sentence',pg.evaluate('document.activeElement.dataset.coach')=='1')
    pg.keyboard.press('Alt+t');wait_done(pg,1)
    check('Alt+T opens the focused sentence explanation',pg.locator('#coach1').is_visible())
    n=len(fake.calls);pg.keyboard.press('Alt+t');pg.keyboard.press('Alt+t');wait_done(pg,1)
    check('keyboard reopening also reuses the cache',len(fake.calls)==n)
    # Save/merge compatibility and old paragraph history remain available.
    pg.evaluate('ER.mergeTranslations({"2026-10-27#0":{text:"旧的译文",fb:"## 总评\\n以前的批改。",updatedAt:10}})')
    pg.locator('#legacyTranslation0 > .legacy-translation > summary').click()
    check('old paragraph drafts and feedback remain readable','旧的译文' in pg.inner_text('#legacyTranslation0') and '以前的批改' in pg.inner_text('#legacyTranslation0'))
    backup=pg.evaluate('ER.buildBackup()');before=records(pg)
    check('backup and sync include lessons but exclude the API key',any(x.get('type')=='lesson' for x in backup['data']['learning'].values()) and KEY not in json.dumps(backup) and KEY not in pg.evaluate('JSON.stringify(ER.syncState())'))
    check('backup carries the collected AI phrase with its review progress',any(v['word']=='climate change' and v['sentence']==first and v.get('srs') for v in backup['data']['vocab']))
    pg.evaluate('localStorage.clear()');pg.reload();pg.wait_for_selector('.coach-btn');pg.evaluate('x=>ER.applyBackup(x,"replace")',backup)
    check('backup import restores teaching and old paragraph records',records(pg)==before and pg.evaluate('ER.getTranslations()["2026-10-27#0"].text')=='旧的译文')
    pg.click('[data-coach="0"]');wait_done(pg)
    check('restored cached lesson needs no new API key','研究人员指出' in pg.inner_text('#coach0'))
    changed=json.loads(json.dumps(before));lk=next(k for k in changed if k.startswith('lesson:'));changed[lk]['updatedAt']+=100000;changed[lk]['lesson']=LESSON+'\n同步的新讲解。'
    pg.evaluate('x=>ER.mergeRemoteState({app:"english-reader",learning:x})',changed)
    check('remote lesson merge uses per-record timestamps',records(pg)[lk]['lesson'].endswith('同步的新讲解。'))
    pg.evaluate('k=>localStorage.setItem("er_ds_key",k)',KEY);fake.mode='hang';pg.click('[data-coach-retry="0"]');pg.wait_for_selector('[data-coach-stop="0"]')
    pg.click('#btnAddAllKw');pg.wait_for_selector('[data-coach-stop="0"]')
    check('article rerender preserves a pending request and usable stop control',pg.locator('#coach0 .spinner').count()==1)
    pg.click('[data-coach-stop="0"]');fake.release()
    fake.mode='hang';pg.click('[data-coach-retry="0"]');pg.wait_for_selector('[data-coach-stop="0"]');old=records(pg)[lk]['lesson']
    pg.goto(BASE.replace('2026-10-27','2026-10-23'));pg.wait_for_selector('.coach-btn');fake.release()
    check('navigation cancels old request without replacing cached learning',records(pg)[lk]['lesson']==old and pg.locator('.coach-panel:not([hidden])').count()==0)
    title=pg.inner_text('#articleReader h2')
    check('title tokenization preserves decimal temperatures',title.startswith('The 1.5°C') and pg.locator('#articleReader h2 .sent').count()==1)
    ctx.close()
    mob=browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True);mf=Fake();mob.route('https://**/*',lambda r:r.fulfill(status=204,body=''));mob.route('https://api.deepseek.com/**',mf.handle)
    mf.lesson='''## 参考译文
当人们谈论气候变化的影响时，通常会提到海平面上升、庄稼歉收或房屋受损。
## 句子主干
they usually mention … → 他们通常提到……，后面接三个并列的影响。
## 翻译顺序
1. When people talk about … → 当人们谈论……时，先交代背景。
2. they usually mention … → 他们通常提到……，译出主干。
3. rising seas, failed harvests or damaged homes → 海平面上升、庄稼歉收或房屋受损，顺译三个并列宾语。
## 实用短语
- **climate change**：气候变化；用于讨论环境问题。
- **rising seas**：海平面上升；用于描述气候变化的影响。
- **failed harvests**：庄稼歉收；用于描述农业损失。
## 迁移提示
遇到并列成分，先找共同支配它们的动词，再依次翻译。
'''
    mp=mob.new_page();mp.on('pageerror',lambda e:errors.append(str(e)));mp.goto(BASE);mp.wait_for_selector('.coach-btn');mp.evaluate('k=>localStorage.setItem("er_ds_key",k)',KEY)
    mp.locator('[data-coach="0"]').tap();wait_done(mp)
    check('sentence coaching fits mobile width',mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    check('mobile translation buttons remain easy to tap',mp.locator('[data-coach="0"]').bounding_box()['height']>=36)
    check('each mobile useful phrase has a comfortable collection button',mp.locator('#coach0 .coach-save-phrase').count()==3 and all(b.bounding_box()['height']>=36 for b in mp.locator('#coach0 .coach-save-phrase').all()))
    out=ROOT/'output'/'playwright';out.mkdir(parents=True,exist_ok=True)
    mp.get_by_role('heading',name='实用短语',exact=True).scroll_into_view_if_needed();mp.screenshot(path=str(out/'sentence-coach-collect-mobile.png'),full_page=False)
    mp.locator('#coach0 .coach-save-phrase').first.tap()
    check('mobile phrase collection works',mp.evaluate("ER.findWord('climate change').zh")=='气候变化')
    out=ROOT/'output'/'playwright';out.mkdir(parents=True,exist_ok=True);mp.locator('#coach0').scroll_into_view_if_needed();mp.screenshot(path=str(out/'sentence-coach-mobile.png'),full_page=False)
    mob.close();browser.close()
check('no runtime JavaScript errors',not errors)
if errors:print(errors)
print(f'{sum(checks)}/{len(checks)} sentence coach checks passed');sys.exit(0 if all(checks) else 1)
