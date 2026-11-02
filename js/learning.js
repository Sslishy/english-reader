/* Reading comprehension, translation repair, listening, and article recommendations. */
(function(){
'use strict';
var ER=window.ER,C=window.LearningCore,$=ER.$,esc=ER.esc,KEY='er_learning';
function read(){var x=ER.lsGet(KEY,{}),out=Object.create(null);if(x&&typeof x==='object'&&!Array.isArray(x))Object.keys(x).forEach(function(k){if(/^(quiz|drill|listen|known|lookup|fit):/.test(k)&&x[k]&&typeof x[k]==='object')out[k]=x[k];});return out;}
var records=read();
function merge(other){var changed=false;if(!other||typeof other!=='object'||Array.isArray(other))return false;Object.keys(other).forEach(function(k){var v=other[k];if(!/^(quiz|drill|listen|known|lookup|fit):/.test(k)||!v||typeof v!=='object')return;if(!records[k]||(+v.updatedAt||0)>(+records[k].updatedAt||0)){records[k]=v;changed=true;}});return changed;}
function put(id,patch){merge(read());var prev=records[id]||{};records[id]=Object.assign({},prev,patch,{updatedAt:Math.max(Date.now(),(+prev.updatedAt||0)+1)});ER.lsSet(KEY,records);if(ER.syncSoon)ER.syncSoon();return records[id];}
ER.getLearningState=function(){merge(read());return records;};
ER.mergeLearningState=function(other,replace){if(replace)records=Object.create(null);if(merge(other)||replace)ER.lsSet(KEY,records);if(ER.currentTab==='review'&&!activeDrill)renderDrills();if(ER.currentTab==='read'&&article())renderRecommendations();};
window.addEventListener('storage',function(e){if(e.key===KEY||e.key===null){records=read();if(ER.currentTab==='review'&&!activeDrill)renderDrills();}});
function article(){return ER.currentArticle&&ER.currentArticle();}
function quizId(a,q){return 'quiz:'+a.date+':'+q.id;}
function sig(q){return C.hash(JSON.stringify([q.prompt,q.options,q.answer,q.evidence]));}
function quizRecord(a,q){var r=records[quizId(a,q)];return r&&r.signature===sig(q)?r:null;}
var quizRetry=false;
ER.learningArticleHtml=function(a){
  var qs=C.validQuestions(a);
  return '<section class="card learning-quiz" id="readingQuiz" aria-label="阅读理解"><div class="learning-heading"><h3>读懂了吗？</h3><span>主旨 · 细节 · 推断</span></div><p class="hint">先独立回答，再核对原文依据。题目只考这篇文章表达的信息。</p><div id="quizBody">'+(qs.length?'':'<p class="hint">这篇文章暂未配理解题，可先使用逐句听读和翻译练习。</p>')+'</div></section>';
};
function renderQuiz(){
  var a=article(),host=$('quizBody');if(!a||!host)return;
  var qs=C.validQuestions(a);if(!qs.length)return;
  var answered=qs.every(function(q){return quizRecord(a,q);}),first=0,latest=0;
  qs.forEach(function(q){var r=quizRecord(a,q);if(r){if(r.firstCorrect)first++;if(r.correct)latest++;}});
  var h=(answered?'<p class="quiz-score">首次 '+first+' / '+qs.length+' · 最近 '+latest+' / '+qs.length+'<span class="hint"> 重做保留首次成绩</span></p>':'');
  qs.forEach(function(q,i){
    var r=quizRetry?null:quizRecord(a,q),label={main:'主旨',detail:'细节',inference:'推断'}[q.type]||'理解';
    h+='<fieldset class="quiz-question" id="quiz-'+esc(q.id)+'"><legend><span class="tag">'+label+'</span> '+(i+1)+'. '+esc(q.prompt)+'</legend>'+
      q.options.map(function(o,j){return '<label class="quiz-option'+(r?(j===q.answer?' is-correct':j===r.choice?' is-wrong':''):'')+'"><input type="radio" name="quiz-'+esc(q.id)+'" value="'+j+'"'+(r&&r.choice===j?' checked':'')+(r?' disabled':'')+'> <span>'+String.fromCharCode(65+j)+'. '+esc(o)+'</span></label>';}).join('');
    if(r)h+='<div class="quiz-explanation"><b>'+(r.correct?'✓ 答对了':'正确答案：'+String.fromCharCode(65+q.answer))+'</b><p>'+esc(q.explanation||'请对照下方原文依据。')+'</p>'+q.evidence.map(function(e,j){return '<blockquote>'+esc(e.quote)+'</blockquote><button data-evidence="'+i+':'+j+'">定位原文第 '+(e.paragraph+1)+' 段</button>';}).join('')+'</div>';
    h+='</fieldset>';
  });
  h+='<p class="hint" id="quizStatus" aria-live="polite"></p><button class="primary" id="'+(answered&&!quizRetry?'btnRetryQuiz':'btnCheckQuiz')+'">'+(answered&&!quizRetry?'重新练习':'提交并查看原文依据')+'</button>';
  host.innerHTML=h;
  if($('btnRetryQuiz'))$('btnRetryQuiz').onclick=function(){quizRetry=true;renderQuiz();};
  if($('btnCheckQuiz'))$('btnCheckQuiz').onclick=function(){
    var responses=[];
    for(var i=0;i<qs.length;i++){var q=qs[i],el=document.querySelector('[name="quiz-'+q.id+'"]:checked');if(!el){$('quizStatus').textContent='还有第 '+(i+1)+' 题没选，请先作答。';$('quiz-'+q.id).scrollIntoView({block:'center'});return;}responses.push(+el.value);}
    qs.forEach(function(q,i){var prev=quizRecord(a,q),ok=responses[i]===q.answer;put(quizId(a,q),{type:'quiz',article:a.date,signature:sig(q),choice:responses[i],correct:ok,firstCorrect:prev?prev.firstCorrect:ok,attempts:(prev&&prev.attempts||0)+1,date:ER.today()});});
    quizRetry=false;renderQuiz();
  };
  host.querySelectorAll('[data-evidence]').forEach(function(b){b.onclick=function(){var ij=b.dataset.evidence.split(':').map(Number),q=qs[ij[0]],e=q.evidence[ij[1]];showEvidence(e);};});
}
function showEvidence(e){
  if(listen&&listen.dictation){listen.dictation=false;stopAudio();renderListen();}
  var root=$('articleReader');if(!root)return;root.hidden=false;
  root.querySelectorAll('.evidence-focus,.evidence-sentence').forEach(function(n){n.classList.remove('evidence-focus','evidence-sentence');});
  var p=root.querySelector('[data-pi="'+e.paragraph+'"]');if(!p)return;
  p.classList.add('evidence-focus');p.querySelectorAll('.sent').forEach(function(s){if(C.normal(s.textContent).includes(C.normal(e.quote)))s.classList.add('evidence-sentence');});
  p.scrollIntoView({behavior:'smooth',block:'center'});p.setAttribute('tabindex','-1');p.focus({preventScroll:true});
}

/* Sentence listening and dictation. Playback is explicitly initiated by the learner. */
var listen=null,utterance=null,audioToken=0,audioTimer=null,audioGuard=null;
function stopAudio(){audioToken++;clearTimeout(audioTimer);clearTimeout(audioGuard);if(window.speechSynthesis)try{speechSynthesis.cancel();}catch(e){}utterance=null;if(listen)listen.playing=false;var b=$('btnListenPlay');if(b)b.textContent='▶ 播放这一句';}
ER.stopLearningAudio=stopAudio;
function listenKey(){return 'listen:'+listen.article+':'+listen.sentences[listen.index].id;}
function renderListen(){
  var host=$('listenPanel');if(!host||!listen)return;
  var x=listen.sentences[listen.index],r=records[listenKey()]||{},hidden=listen.dictation&&!listen.revealed;
  $('articleReader').hidden=listen.dictation;
  host.innerHTML='<details class="listen-tools"'+(listen.open?' open':'')+'><summary>逐句听读 / 听写 <span class="hint">共 '+listen.sentences.length+' 句</span></summary><div class="listen-content">'+
    '<div class="listen-top"><label>句子 <select id="listenSentence" aria-label="选择听读句子">'+listen.sentences.map(function(s,i){return '<option value="'+i+'"'+(i===listen.index?' selected':'')+'>第 '+(i+1)+' 句 · 第 '+(s.paragraph+1)+' 段</option>';}).join('')+'</select></label><label>速度 <select id="listenRate">'+[.6,.8,1,1.2].map(function(n){return '<option value="'+n+'"'+(listen.rate===n?' selected':'')+'>'+n+'×</option>';}).join('')+'</select></label><label>重复 <select id="listenRepeat">'+[1,2,3].map(function(n){return '<option'+(listen.repeat===n?' selected':'')+'>'+n+'</option>';}).join('')+'</select> 次</label></div>'+
    '<div class="listen-transcript" id="listenTranscript"'+(hidden?' hidden':'')+'>'+esc(x.text)+'</div>'+
    '<div class="row"><button id="btnListenPrev"'+(listen.index===0?' disabled':'')+'>← 上一句</button><button class="primary" id="btnListenPlay">▶ 播放这一句</button><button id="btnListenStop">停止</button><button id="btnListenNext"'+(listen.index===listen.sentences.length-1?' disabled':'')+'>下一句 →</button></div>'+
    '<label class="opt"><input type="checkbox" id="listenDictation"'+(listen.dictation?' checked':'')+'> 听写模式：作答前收起正文和原句</label>'+
    (listen.dictation?'<div class="dictation"><label for="dictationInput">写下你听到的英文</label><textarea id="dictationInput" rows="3" maxlength="1500" autocomplete="off" spellcheck="false" placeholder="可以重复听，再提交核对">'+esc(listen.draft||'')+'</textarea><div class="row"><button class="primary" id="btnCheckDictation">核对听写</button><button id="btnRevealTranscript">'+(listen.revealed?'已显示原句':'看原句提示')+'</button></div><div id="dictationFeedback" aria-live="polite">'+(listen.feedback||'')+'</div></div>':'<p class="hint">每次重复间留 2 秒，可跟读。切换句子或离开页面会停止播放。</p>')+
    '<p class="hint" id="listenStatus" aria-live="polite">'+(r.attempts?'本句已练 '+r.attempts+' 次，最近词语匹配 '+r.score+'%'+(r.assisted?'（看过原句）':'')+'。':'使用设备的英语语音合成；实际声音取决于浏览器和已安装语音。')+'</p></div></details>';
  host.querySelector('details').ontoggle=function(){listen.open=this.open;$('articleReader').hidden=listen.dictation&&this.open;if(!this.open)stopAudio();};
  $('listenSentence').onchange=function(){moveListen(+this.value);};$('btnListenPrev').onclick=function(){moveListen(listen.index-1);};$('btnListenNext').onclick=function(){moveListen(listen.index+1);};
  $('listenRate').onchange=function(){stopAudio();listen.rate=+this.value;ER.settings.listenRate=listen.rate;ER.saveSettings();};
  $('listenRepeat').onchange=function(){stopAudio();listen.repeat=+this.value;};
  $('btnListenPlay').onclick=playSentence;$('btnListenStop').onclick=stopAudio;
  $('listenDictation').onchange=function(){stopAudio();listen.dictation=this.checked;listen.revealed=false;listen.assisted=false;listen.feedback='';listen.open=true;renderListen();};
  if(listen.dictation){
    $('dictationInput').oninput=function(){listen.draft=this.value;};
    $('btnRevealTranscript').onclick=function(){listen.revealed=true;listen.assisted=true;renderListen();};
    $('btnCheckDictation').onclick=function(){
      var mine=$('dictationInput').value;if(!C.words(mine).length){$('listenStatus').textContent='先写下听到的内容，再核对。';return;}
      var result=C.compare(mine,x.text),prev=records[listenKey()]||{};
      put(listenKey(),{type:'listen',article:listen.article,sentence:x.text,score:result.score,assisted:!!listen.assisted,attempts:(prev.attempts||0)+1,date:ER.today(),firstScore:prev.firstScore==null?result.score:prev.firstScore});
      listen.feedback='<p><b>'+(result.exact?'✓ 内容一致':'词语匹配 '+result.score+'%')+'</b> '+(listen.assisted?'本次看过原句，属于辅助练习。':'')+'</p><p class="listening-diff">'+result.parts.map(function(p){return p.kind==='extra'?'<del>'+esc(p.text)+'</del>':p.kind==='missing'?'<ins>'+esc(p.text)+'</ins>':esc(p.text);}).join(' ')+'</p><p class="hint">红色：多写 / 写错；绿色：漏写。忽略大小写和标点，词语匹配不代表听力等级。</p>';
      listen.revealed=true;listen.assisted=true;renderListen();
    };
  }
}
function moveListen(i){if(!listen||i<0||i>=listen.sentences.length)return;stopAudio();listen.index=i;listen.revealed=false;listen.assisted=false;listen.draft='';listen.feedback='';listen.open=true;renderListen();}
function playSentence(){
  if(!listen)return;stopAudio();
  if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){$('listenStatus').textContent='当前浏览器不支持语音合成，请使用支持英语语音的浏览器。';return;}
  var token=audioToken,remaining=listen.repeat,x=listen.sentences[listen.index],rate=listen.rate,accent=ER.settings.accent||'en-US';listen.playing=true;
  $('btnListenPlay').textContent='正在播放…';
  function say(){
    if(token!==audioToken)return;
    try{
      utterance=new SpeechSynthesisUtterance(x.text);utterance.lang=accent;utterance.rate=rate;
      var voices=speechSynthesis.getVoices(),voice=voices.find(function(v){return v.lang===accent;})||voices.find(function(v){return /^en[-_]/i.test(v.lang);});if(voice)utterance.voice=voice;
      utterance.onstart=function(){if(token===audioToken)$('listenStatus').textContent='正在播放第 '+(listen.index+1)+' 句…';};
      utterance.onend=function(){if(token!==audioToken)return;clearTimeout(audioGuard);remaining--;if(remaining>0){$('listenStatus').textContent='跟读停顿 2 秒…';audioTimer=setTimeout(say,2000);}else{listen.playing=false;$('btnListenPlay').textContent='▶ 播放这一句';$('listenStatus').textContent='播放结束，可以跟读或核对听写。';}};
      utterance.onerror=function(){if(token!==audioToken)return;stopAudio();if($('listenStatus'))$('listenStatus').textContent='语音播放失败，请检查设备英语语音后重试。';};
      audioGuard=setTimeout(function(){if(token===audioToken){stopAudio();if($('listenStatus'))$('listenStatus').textContent='语音未正常完成，请检查设备的英语语音或重试。';}},Math.max(30000,x.text.length*180/rate));
      speechSynthesis.speak(utterance);
    }catch(e){stopAudio();$('listenStatus').textContent='语音播放失败，请检查浏览器语音设置。';}
  }say();
}
window.addEventListener('pagehide',stopAudio);
document.addEventListener('visibilitychange',function(){if(document.hidden)stopAudio();});

/* Translation errors become small next-day retranslation exercises. */
var activeDrill=null,drillRevealed=false,drillHinted=false,drillGraded=false;
function addDrill(a,i,x){
  var id='drill:'+a.date+':'+i+':'+C.hash(C.normal(x.original)),old=records[id];
  if(old&&old.answer===x.answer&&old.issue===x.issue)return false;
  put(id,{type:'drill',article:a.date,paragraph:i,original:x.original,answer:x.answer,issue:x.issue,category:x.category||C.category(x.issue),due:SRS.addDays(ER.today(),1),added:old&&old.added||ER.today(),stage:0,last:'',draft:'',attempts:old&&old.attempts||0});return true;
}
ER.captureTranslationMistakes=function(a,i,feedback){var items=C.extract(feedback,a.paragraphs[i]),n=0;items.forEach(function(x){if(addDrill(a,i,x))n++;});return {found:items.length,added:n};};
ER.translationDrillControls=function(a,i,e){
  if(!e||!e.fb)return '';
  var sentences=C.sentences({paragraphs:[a.paragraphs[i]]});
  return '<div class="translation-drill-tools"><button data-import-errors="'+i+'">从这次批改提取次日错题</button><span class="hint" id="tpDrillStatus'+i+'"></span><details><summary>手动保存一个需要复练的句子</summary><label>英文原句<select id="drillSource'+i+'">'+sentences.map(function(s,j){return '<option value="'+j+'">'+esc(s.text)+'</option>';}).join('')+'</select></label><label>这次错在哪里<textarea rows="2" maxlength="600" id="drillIssue'+i+'" placeholder="例如：误解了否定范围"></textarea></label><label>正确译法 / 参考改法<textarea rows="2" maxlength="1000" id="drillAnswer'+i+'"></textarea></label><button data-save-error="'+i+'">加入明天复练</button></details></div>';
};
ER.renderTranslationDrillControls=function(a,i,e){var host=$('tpDrill'+i);if(host)host.innerHTML=ER.translationDrillControls(a,i,e);};
function drillEntries(){return Object.keys(records).filter(function(k){var x=records[k];return k.indexOf('drill:')===0&&x.original&&x.answer&&x.due;}).map(function(k){return {id:k,data:records[k]};}).sort(function(a,b){return a.data.due.localeCompare(b.data.due);});}
function renderDrills(){
  var host=$('translationReviewBox');if(!host)return;
  var all=drillEntries(),due=all.filter(function(x){return x.data.due<=ER.today();});
  host.innerHTML='<section class="card"><div class="learning-heading"><h3>翻译错题复练</h3><span>'+due.length+' 项到期 · 共 '+all.length+' 项</span></div><p class="hint">把批改里的问题句重新译一遍，再对照改法。新错题从第二天开始，先自己想，再看提示。</p>'+
    (due.length?'<button class="primary" id="btnStartDrills">开始今天的错题复练</button>':all.length?'<p class="hint">下一次：'+esc(all[0].data.due)+'</p>':'<p class="hint">在阅读页使用「我来翻译」，批改后会自动提取有明确原句和改法的错误；也可手动保存。</p>')+'<div id="drillExercise"></div></section>';
  if($('btnStartDrills'))$('btnStartDrills').onclick=function(){activeDrill=due[0].id;drillRevealed=false;drillHinted=records[activeDrill].exposedOn===ER.today();drillGraded=false;renderDrill();};
}
function renderDrill(){
  var d=records[activeDrill],host=$('drillExercise');if(!d||!host)return;
  var tips={'指代与主语':'先找主句的主语，再确认代词指的是谁。','否定关系':'圈出否定词，确认它否定的动作或范围。','数字与比例':'分别核对基数、比例、比较对象和单位。','句子结构':'先译主干，再补从句和修饰成分。','信息完整性':'逐个核对动作、条件、时间和限制。','词义与搭配':'根据原句语境核对词义和固定搭配。'};
  host.innerHTML='<div class="drill-card"><span class="tag">'+esc(d.category)+'</span><p class="drill-original">'+esc(d.original)+'</p><label for="drillTranslation">重新写出中文译文</label><textarea id="drillTranslation" rows="3" maxlength="1500"'+(drillGraded?' disabled':'')+'>'+esc(d.draft||'')+'</textarea>'+
    '<div class="row"><button id="btnDrillHint"'+(drillRevealed?' disabled':'')+'>提示这次要注意什么</button><button class="primary" id="btnRevealDrill"'+(drillRevealed?' hidden':'')+'>写好了，查看对照</button></div>'+
    (drillHinted?'<p class="hint">'+esc(tips[d.category]||tips['词义与搭配'])+'</p>':'')+
    (drillRevealed?'<div class="drill-answer"><p><b>原来的问题：</b>'+esc(d.issue)+'</p><p><b>参考改法：</b>'+esc(d.answer)+'</p><p class="hint">意思准确的其他译法也可以。下面是自评，不是 AI 自动判分。</p></div><div class="row"><button id="btnDrillAgain"'+(drillGraded?' disabled':'')+'>仍需练习</button><button class="primary" id="btnDrillGood"'+(drillGraded?' disabled':'')+'>'+(drillHinted?'提示后想通了':'独立想通了')+'</button></div>':'')+
    '<p id="drillStatus" class="hint" aria-live="polite"></p><button id="btnNextDrill"'+(drillGraded?'':' hidden')+'>下一项 / 完成</button></div>';
  $('drillTranslation').oninput=function(){put(activeDrill,{draft:this.value});};
  $('btnDrillHint').onclick=function(){drillHinted=true;put(activeDrill,{exposedOn:ER.today()});renderDrill();};
  if($('btnRevealDrill'))$('btnRevealDrill').onclick=function(){if(!/[\u4e00-\u9fff]/.test(($('drillTranslation').value||'').trim())){$('drillStatus').textContent='先用中文尝试翻译，再看参考改法。';return;}drillRevealed=true;put(activeDrill,{exposedOn:ER.today()});renderDrill();};
  function grade(ok){
    if(drillGraded)return;drillGraded=true;var t=ER.today(),stage=d.stage||0,good=ok&&!drillHinted,first=d.last!==t;
    if(first)stage=good?Math.min(stage+1,4):0;
    var days=good?[1,3,7,14,30][stage]:1;
    put(activeDrill,{stage:stage,due:SRS.addDays(t,days),last:t,attempts:(d.attempts||0)+1,lastGood:good,assisted:drillHinted});
    renderDrill();$('drillStatus').textContent=(good?'已记录独立回忆':'已加入加强')+'，下次：'+records[activeDrill].due;
  }
  if(drillRevealed){$('btnDrillGood').onclick=function(){grade(true);};$('btnDrillAgain').onclick=function(){grade(false);};}
  $('btnNextDrill').onclick=function(){var due=drillEntries().filter(function(x){return x.data.due<=ER.today();});activeDrill=due.length?due[0].id:null;drillRevealed=false;drillHinted=!!(activeDrill&&records[activeDrill].exposedOn===ER.today());drillGraded=false;if(activeDrill)renderDrill();else renderDrills();};
}
ER.renderTranslationReview=renderDrills;
$('articleBox').addEventListener('click',function(e){
  var b=e.target.closest('button'),a=article();if(!b||!a)return;
  if(b.dataset.importErrors!=null){var i=+b.dataset.importErrors,tr=ER.getTranslations()[a.date+'#'+i]||{},r=ER.captureTranslationMistakes(a,i,tr.fb);$('tpDrillStatus'+i).textContent=r.found?'已识别 '+r.found+' 项，新增 / 更新 '+r.added+' 项。':'未识别到完整的原句和改法，可手动保存下方错题。';}
  if(b.dataset.saveError!=null){var pi=+b.dataset.saveError,ss=C.sentences({paragraphs:[a.paragraphs[pi]]}),source=ss[+$('drillSource'+pi).value],issue=$('drillIssue'+pi).value.trim(),answer=$('drillAnswer'+pi).value.trim();if(!source||!issue||!/[\u4e00-\u9fff]/.test(answer)){$('tpDrillStatus'+pi).textContent='请填写错误原因和中文参考改法。';return;}addDrill(a,pi,{original:source.text,issue:issue,answer:answer});$('tpDrillStatus'+pi).textContent='已加入明天复练。';}
});

/* Personal recommendations distinguish unfamiliar from unobserved vocabulary. */
var corpus=Object.create(null),corpusPromise=null,recommendVersion=0;
function knowledge(){
  var out=Object.create(null);
  ER.getVocab().forEach(function(v){var s=v.srs.skills&&v.srs.skills.meaning;if(!s)return;var status=s.learningPending||s.lastRating==='again'||s.lastRating==='hard'?false:s.successDates&&s.successDates.length>=2?true:null;if(status!=null)out[v.word.toLowerCase()]=status;});
  Object.keys(records).forEach(function(k){var r=records[k];if(k.indexOf('lookup:')===0&&r.date>=SRS.addDays(ER.today(),-14)&&out[r.word]==null)out[r.word]=false;});
  Object.keys(records).forEach(function(k){var r=records[k];if(k.indexOf('known:')===0&&typeof r.known==='boolean')out[r.word]=r.known;});
  return out;
}
ER.noteLearningLookup=function(date,word){word=String(word||'').toLowerCase();if(!date||!word)return;var id='lookup:'+date+':'+C.hash(word),old=records[id];if(old&&old.date===ER.today())return;put(id,{type:'lookup',article:date,word:word,date:ER.today()});};
function loadCorpus(){
  if(corpusPromise)return corpusPromise;
  corpusPromise=ER.getArticleIndex().then(function(idx){return Promise.allSettled(idx.map(function(e){if(corpus[e.date])return Promise.resolve(corpus[e.date]);return ER.fetchJson('articles/'+e.file,15000).then(function(a){corpus[a.date]=a;return a;});}));}).then(function(){return Object.keys(corpus).map(function(k){return corpus[k];});}).catch(function(e){corpusPromise=null;throw e;});return corpusPromise;
}
function renderRecommendations(){
  var host=$('recommendations'),a=article();if(!host||!a)return;
  var generation=++recommendVersion;host.innerHTML='<p class="hint">正在比较文章篇幅和词汇熟悉度…</p>';
  loadCorpus().then(function(list){
    if(generation!==recommendVersion)return;
    var known=knowledge(),metrics=C.analyze(a,known,ER.candidates),goal=ER.settings.readingGoal||'balanced';
    var feedback=records['fit:'+a.date],offset=feedback?(feedback.value==='hard'?-8:feedback.value==='easy'?8:0):0;
    var target=metrics.score+offset,ranked=list.filter(function(x){return x.date!==a.date;}).map(function(x){return {article:x,m:C.analyze(x,known,ER.candidates)};});
    ranked.sort(function(x,y){return goal==='comfortable'?x.m.score-y.m.score:goal==='challenge'?y.m.score-x.m.score:Math.abs(x.m.score-target)-Math.abs(y.m.score-target);});
    var sample=metrics.unrated.slice(0,8),enough=metrics.observed>=5;
    var h='<div class="learning-heading"><h3>下一篇，选适合自己的</h3><label>阅读目标 <select id="recommendGoal"><option value="balanced"'+(goal==='balanced'?' selected':'')+'>接近当前难度</option><option value="comfortable"'+(goal==='comfortable'?' selected':'')+'>轻松巩固</option><option value="challenge"'+(goal==='challenge'?' selected':'')+'>挑战一下</option></select></label></div>'+
      '<p class="hint">'+(enough?'已结合你的词汇标记、复习和最近查词记录。':'熟悉度数据还少，暂以篇幅和平均句长作初步推荐。')+' 本文内容词已判断 '+metrics.observed+' / '+metrics.total+' 种，其中 '+metrics.unknown.length+' 种暂不熟；其余尚未判断。</p>'+
      '<div class="recommend-cards">'+ranked.slice(0,3).map(function(x){var e=x.article,m=x.m;return '<a class="recommend-card" href="#/read/'+esc(e.date)+'"><b>'+esc(e.title_zh||e.title)+'</b><span>'+m.wordCount+' 词 · 平均句长 '+m.sentenceLength+' 词</span><small>'+m.unknown.length+' 种已知不熟词 · '+m.unrated.length+' 种待判断</small></a>';}).join('')+'</div>'+
      '<div class="difficulty-feedback"><span>这篇读起来：</span>'+[['easy','偏轻松'],['right','刚刚好'],['hard','偏吃力']].map(function(x){return '<button data-fit="'+x[0]+'" aria-pressed="'+!!(feedback&&feedback.value===x[0])+'">'+x[1]+'</button>';}).join('')+'</div>'+
      (sample.length?'<details class="familiarity"><summary>用 8 个词校准推荐（不显示释义）</summary><p class="hint">根据你能否直接想起意思来标记。没标记的词保持「未判断」。</p>'+sample.map(function(w){return '<div><b>'+esc(w)+'</b><button data-familiar="'+esc(w)+'" data-known="true">熟悉</button><button data-familiar="'+esc(w)+'" data-known="false">不熟</button></div>';}).join('')+'</details>':'')+
      '<details class="recommend-method"><summary>推荐依据</summary><p class="hint">比较已标不熟的词在文章中的出现次数、平均句长和总词数；你的难度反馈会调整「接近当前难度」的目标。未观察到的词不会直接算作生词，也不会据此推断雅思分数。标记可在下方修改。</p><div class="familiarity-edits">'+Object.keys(known).filter(function(w){return records['known:'+C.hash(w)];}).slice(-20).map(function(w){return '<button data-familiar="'+esc(w)+'" data-known="'+(!known[w])+'">'+esc(w)+'：'+(known[w]?'熟悉':'不熟')+' · 切换</button>';}).join('')+'</div></details>';
    host.innerHTML=h;
    $('recommendGoal').onchange=function(){ER.settings.readingGoal=this.value;ER.saveSettings();renderRecommendations();};
    host.querySelectorAll('[data-fit]').forEach(function(b){b.onclick=function(){put('fit:'+a.date,{type:'fit',article:a.date,value:b.dataset.fit});renderRecommendations();};});
    host.querySelectorAll('[data-familiar]').forEach(function(b){b.onclick=function(){var wasOpen=host.querySelector('.familiarity')&&host.querySelector('.familiarity').open;put('known:'+C.hash(b.dataset.familiar),{type:'known',word:b.dataset.familiar,known:b.dataset.known==='true'});renderRecommendations();if(wasOpen)Promise.resolve().then(function(){var d=host.querySelector('.familiarity');if(d)d.open=true;});};});
  }).catch(function(){if(generation===recommendVersion)host.innerHTML='<p class="hint">文章比较暂时载入失败，仍可从下方往期列表选择。</p><button id="retryRecommendations">重试推荐</button>';var b=$('retryRecommendations');if(b)b.onclick=renderRecommendations;});
}
ER.learningAfterRender=function(a){
  stopAudio();corpus[a.date]=a;quizRetry=false;
  var ss=C.sentences(a);listen=ss.length?{article:a.date,sentences:ss,index:0,rate:+ER.settings.listenRate||.8,repeat:1,dictation:false,revealed:false,assisted:false,open:false,draft:'',feedback:''}:null;
  if(listen)renderListen();renderQuiz();renderRecommendations();
};
ER.learningRoute=function(tab){stopAudio();if(tab==='review'){activeDrill=null;renderDrills();}if(tab==='read'&&article())renderRecommendations();};
})();
