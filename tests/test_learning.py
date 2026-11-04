#!/usr/bin/env python3
"""Learning features browser regression. Uses isolated data and mocked speech / AI."""
import atexit, json, os, socket, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with socket.socket() as s:
    s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
server=subprocess.Popen([sys.executable,'-m','http.server',str(port),'--bind','127.0.0.1'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
atexit.register(server.terminate);time.sleep(.6)
BASE=f'http://127.0.0.1:{port}/?today=2026-11-02'
checks=[];errors=[]
def check(name,ok):
    checks.append(bool(ok));print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def saved(p):return p.evaluate('ER.getLearningState()')
SPEECH='''window.__speech={spoken:[],cancels:0};window.SpeechSynthesisUtterance=class {constructor(t){this.text=t;}};
Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'en-US'}],cancel:()=>{window.__speech.cancels++;},speak:u=>{window.__speech.spoken.push({text:u.text,rate:u.rate});setTimeout(()=>{if(u.onstart)u.onstart();if(u.onend)u.onend();},20);}},configurable:true});'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME','/usr/bin/google-chrome'),args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1100,'height':900});ctx.add_init_script(SPEECH)
    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'#/read');page.wait_for_selector('#quiz-q1');page.wait_for_selector('.recommend-card')
    article=page.evaluate('ER.currentArticle()');qs=article['questions']
    check('each current article renders three comprehension questions',page.locator('.quiz-question').count()==3)
    check('evidence and correct answers stay hidden until submission',page.locator('.quiz-explanation').count()==0)
    page.click('#btnCheckQuiz');check('unanswered questions cannot be submitted',bool(page.inner_text('#quizStatus')) and not any(k.startswith('quiz:') for k in saved(page)))
    for i,q in enumerate(qs):page.check(f'[name="quiz-{q["id"]}"][value="{(q["answer"]+1)%4 if i==0 else q["answer"]}"]')
    page.click('#btnCheckQuiz');check('score and supporting evidence are shown after submission','首次 2 / 3' in page.inner_text('.quiz-score') and page.locator('.quiz-explanation blockquote').count()==3)
    page.locator('[data-evidence="0:0"]').click();check('evidence button highlights the source paragraph',page.locator('#articleReader .evidence-focus').count()==1)
    page.reload();page.wait_for_selector('#btnRetryQuiz');check('quiz answers persist on refresh','首次 2 / 3' in page.inner_text('.quiz-score'))
    page.click('#btnRetryQuiz')
    for q in qs:page.check(f'[name="quiz-{q["id"]}"][value="{q["answer"]}"]')
    page.click('#btnCheckQuiz');check('retry keeps the first score while updating latest score','首次 2 / 3 · 最近 3 / 3' in page.inner_text('.quiz-score'))
    check('recommendations offer three other articles',page.locator('.recommend-card').count()==3)
    check('unobserved vocabulary is labelled as unknown evidence, not confirmed unfamiliar','熟悉度数据还少' in page.inner_text('#recommendations') and '种待判断' in page.inner_text('#recommendations'))
    page.locator('.familiarity summary').click();sample=page.locator('[data-familiar][data-known="true"]').first;w=sample.get_attribute('data-familiar');sample.click()
    page.wait_for_function('w=>Object.values(ER.getLearningState()).some(x=>x.type==="known"&&x.word===w&&x.known)',arg=w)
    check('calibration saves explicit word familiarity',any(x.get('word')==w and x.get('known') for x in saved(page).values()))
    page.locator('[data-fit="hard"]').click();page.wait_for_selector('[data-fit="hard"][aria-pressed="true"]')
    check('article difficulty feedback is saved',saved(page)['fit:'+article['date']]['value']=='hard')
    page.select_option('#recommendGoal','comfortable');check('reading goal persists in settings',page.evaluate('ER.settings.readingGoal')=='comfortable')

    page.locator('.listen-tools>summary').click();page.select_option('#listenRate','0.6');page.select_option('#listenRepeat','2');page.click('#btnListenPlay')
    page.wait_for_function('window.__speech.spoken.length===2',timeout=5000)
    check('speed and repeat controls reach speech engine',page.evaluate('__speech.spoken.every(x=>x.rate===0.6)'))
    page.check('#listenDictation')
    check('dictation hides both transcript and full article',not page.locator('#listenTranscript').is_visible() and not page.locator('#articleReader').is_visible())
    page.click('#btnCheckDictation');check('empty dictation is rejected','先写下' in page.inner_text('#listenStatus'))
    first_sentence=page.evaluate('LearningCore.sentences(ER.currentArticle())[0].text')
    page.fill('#dictationInput','wrong words');page.click('#btnCheckDictation')
    check('dictation reports missing and extra words',page.locator('.listening-diff del').count()>0 and page.locator('.listening-diff ins').count()>0)
    check('dictation attempt saved separately',any(x.get('type')=='listen' and x['score']<100 for x in saved(page).values()))
    page.click('#btnListenNext');page.click('#btnRevealTranscript');correct=page.evaluate('LearningCore.sentences(ER.currentArticle())[1].text')
    page.fill('#dictationInput',correct);page.click('#btnCheckDictation')
    check('viewing transcript is recorded as assistance',any(x.get('type')=='listen' and x['score']==100 and x['assisted'] for x in saved(page).values()))
    page.locator('.listen-tools>summary').click();page.wait_for_selector('#articleReader',state='visible');check('closing listening panel restores the reading text',page.locator('#articleReader').is_visible())
    before=page.evaluate('__speech.cancels');page.click('a[data-tab="review"]');page.wait_for_selector('#translationReviewBox');check('navigation stops active speech',page.evaluate('__speech.cancels')>before)

    # New AI feedback is mocked; no API key or personal text is transmitted.
    page.click('a[data-tab="read"]');page.wait_for_selector('#articleReader')
    sentence=page.evaluate('LearningCore.sentences(ER.currentArticle())[0].text')
    fb='## 总评\n需要核对主语。\n## 逐句点评\n> '+sentence+'\n- **问题**：主语和报告内容漏译。\n- **怎么译**：先确认谁报告，再译内容。\n- **改为**：刚果民主共和国卫生官员报告称，该国当前疫情已成为有记录以来规模最大的一次。\n## 参考译文\n参考。\n## 小结\n先找主语。'
    page.route('https://api.deepseek.com/chat/completions',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'message':{'content':fb},'finish_reason':'stop'}]})))
    page.evaluate("localStorage.setItem('er_ds_key','sk-test-only-learning')")
    page.evaluate('([date,fb])=>ER.mergeTranslations({[date+"#0"]:{text:"疫情正在增长。",fb:fb,updatedAt:Date.now()}})',[article['date'],fb])
    page.locator('.legacy-translation>summary').first.click()
    page.click('[data-import-errors="0"]')
    page.wait_for_function('Object.values(ER.getLearningState()).some(x=>x.type==="drill")')
    ds=[x for x in saved(page).values() if x.get('type')=='drill']
    check('saved legacy feedback still imports a next-day drill',len(ds)==1 and ds[0]['due']=='2026-11-03')
    check('old feedback exposes an import and manual-edit path',page.locator('[data-import-errors="0"]').is_visible() and page.locator('[data-save-error="0"]').count()==1)
    page.click('[data-import-errors="0"]');check('importing same correction does not create duplicates',len([k for k in saved(page) if k.startswith('drill:')])==1)
    page.click('a[data-tab="review"]');check('new mistakes do not become due on the day of creation',page.locator('#btnStartDrills').count()==0)
    page.evaluate("ER.setToday('2026-11-03');ER.renderTranslationReview()")
    page.click('#btnStartDrills');check('next-day drill begins with answer hidden',page.locator('.drill-answer').count()==0)
    page.fill('#drillTranslation','卫生官员报告称，这次疫情已是该国规模最大的一次。');page.click('#btnRevealDrill')
    check('drill reveals original error and corrected translation','主语和报告内容漏译' in page.inner_text('.drill-answer'))
    page.click('#btnDrillGood');ds=[x for x in saved(page).values() if x.get('type')=='drill']
    check('independent repair schedules a later review',ds[0]['lastGood'] and ds[0]['due']=='2026-11-06')
    page.click('#btnNextDrill');check('completed repair disappears from due queue',page.locator('#btnStartDrills').count()==0)

    backup=page.evaluate('ER.buildBackup()');data=saved(page)
    check('new study records are included in backups',backup['data']['learning']==data)
    check('API key never appears in learning backup','sk-test-only-learning' not in json.dumps(backup))
    page.evaluate('localStorage.clear()');page.reload();page.wait_for_function("window.ER&&typeof ER.mergeLearningState==='function'")
    page.evaluate('b=>ER.applyBackup(b,"replace")',backup)
    check('backup roundtrip retains all four learning record types',saved(page)==data)
    remote=json.loads(json.dumps(data));qkey=next(k for k in remote if k.startswith('quiz:'));remote[qkey]['updatedAt']+=1000;remote[qkey]['attempts']+=1
    page.evaluate('r=>ER.mergeRemoteState({app:"english-reader",learning:r})',remote)
    check('remote merge accepts newer per-exercise records',saved(page)[qkey]['attempts']==remote[qkey]['attempts'])
    check('sync payload includes learning records',page.evaluate('JSON.stringify(ER.syncState().learning)')==page.evaluate('JSON.stringify(ER.getLearningState())'))
    ctx.close()

    mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);mobile.add_init_script(SPEECH)
    mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)));mp.goto(BASE+'#/read');mp.wait_for_selector('.recommend-card')
    check('reading and recommendations fit mobile width',mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    mp.locator('.listen-tools>summary').tap();mp.check('#listenDictation');mp.fill('#dictationInput','Health officials report an outbreak.');mp.click('#btnCheckDictation')
    check('mobile listening controls and feedback fit width',mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    out=ROOT/'output'/'playwright';out.mkdir(parents=True,exist_ok=True)
    mp.screenshot(path=str(out/'learning-listening-mobile.png'),full_page=False)
    mp.uncheck('#listenDictation')
    for q in qs:mp.check(f'[name="quiz-{q["id"]}"][value="{q["answer"]}"]')
    mp.click('#btnCheckQuiz');mp.locator('#readingQuiz').scroll_into_view_if_needed();mp.screenshot(path=str(out/'learning-quiz-mobile.png'),full_page=False)
    check('mobile quiz submits successfully','首次 3 / 3' in mp.inner_text('.quiz-score'))
    # Absence of synthesis must be visible, never a false successful playback.
    mp.evaluate("Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true})")
    mp.click('#btnListenPlay');check('unsupported speech shows a clear fallback message','不支持语音合成' in mp.inner_text('#listenStatus'))
    mobile.close();browser.close()
check('no learning UI JavaScript errors',not errors)
if errors:print(errors)
print(f'{sum(checks)}/{len(checks)} learning browser checks passed')
sys.exit(0 if all(checks) else 1)
