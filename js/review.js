/* 每日复习：间隔重复 + 每日四六级新词 */
(function(){
'use strict';
var ER = window.ER, $ = ER.$, esc = ER.esc;
var DUE_CAP = 30;
var TYPE_NAME = {recall:'主动回忆', spell:'拼写', en2zh:'英译汉', zh2en:'汉译英', order:'连词成句', cloze:'句子填空', gaps:'补全字母'};
var ORDER_OVER = 6;      // 超过 6 个词的短语 / 句子：拼写题改为「连词成句」
var box = $('reviewBox');
var S = null;            // 当前会话
var cetLists = {};       // level -> list

function today(){ return ER.today(); }
function daily(){ var d=ER.lsGet('er_daily',{}); if(d.date!==today()) d={date:today(),newDone:0}; return d; }
function saveDaily(d){ ER.lsSet('er_daily',d); if(ER.syncSoon) ER.syncSoon(); }
function seen(){ return ER.lsGet('er_cet_seen',{}); }
function markSeen(w,how){ var s=seen(); s[w.toLowerCase()]=how; ER.lsSet('er_cet_seen',s); if(ER.syncSoon) ER.syncSoon(); }
function shuffle(a){ for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;} return a; }
function norm(s){ return String(s||'').toLowerCase().replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim(); }
function shortZh(z){ z=String(z||''); return z.length>34? z.slice(0,34)+'…' : z; }
function isPhrase(v){ return v.type==='phrase' || /\s/.test(String(v.word).trim()); }
function tokens(s){ return String(s||'').trim().split(/\s+/).filter(Boolean); }
/* 短语比较：忽略大小写、标点和多余空格（连字符当空格） */
function normPhrase(s){ return String(s||'').toLowerCase().replace(/[’‘`]/g,"'").replace(/[-‐–—_\/]/g,' ').replace(/[^\p{L}\p{N}\s]+/gu,'').replace(/\s+/g,' ').trim(); }
/* 逐词对比（LCS）：del = 写错 / 多写的词，ins = 漏写的词 */
function diffHtml(user, answer){
  var a=normPhrase(user).split(' ').filter(Boolean), b=normPhrase(answer).split(' ').filter(Boolean), m=a.length, n=b.length, L=[], i, j;
  for(i=0;i<=m;i++){ L.push(new Array(n+1).fill(0)); }
  for(i=m-1;i>=0;i--) for(j=n-1;j>=0;j--) L[i][j]= a[i]===b[j]? L[i+1][j+1]+1 : Math.max(L[i+1][j],L[i][j+1]);
  var ua=[], ab=[]; i=0; j=0;
  while(i<m&&j<n){
    if(a[i]===b[j]){ ua.push(esc(a[i])); ab.push(esc(b[j])); i++; j++; }
    else if(L[i+1][j]>=L[i][j+1]){ ua.push('<del>'+esc(a[i])+'</del>'); i++; }
    else { ab.push('<ins>'+esc(b[j])+'</ins>'); j++; }
  }
  for(;i<m;i++) ua.push('<del>'+esc(a[i])+'</del>');
  for(;j<n;j++) ab.push('<ins>'+esc(b[j])+'</ins>');
  return '<div class="diff" id="diff"><div>你的答案：'+(ua.join(' ')||'（空）')+'</div><div>正确答案：'+ab.join(' ')+'</div><div class="hint">红色划线 = 写错 / 多写的词，绿色 = 漏掉的词</div></div>';
}

function loadLists(){
  var need=['cet4']; if(ER.settings.cet6) need.push('cet6');
  return Promise.all(need.map(function(l){ return ER.loadCet(l).then(function(x){cetLists[l]=x;}); }));
}
/* 挑选今天的新词：按「词 + 固定盐」的稳定哈希排序（非字母序，各设备一致）；四级优先，勾选六级后四六级交替 */
var CET_ORDER_SALT = 'er-cet-order-v1';
function cetHash(w){
  var h = 2166136261 >>> 0, s = CET_ORDER_SALT + '\0' + String(w).toLowerCase();
  for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function cetEligible(x){
  var w = String(x && x.word || '');
  if(w.length < 2) return false;                 // 单字母
  if(/\s/.test(w)) return false;                 // 含空格
  if(w.charAt(0) !== w.charAt(0).toLowerCase()) return false; // 专有名词 / 月份等
  if(!/[a-z]/.test(w)) return false;             // 全大写缩写如 FALSE
  return true;
}
function orderedPool(list, seenMap, used){
  return (list||[]).filter(function(x){
    if(!cetEligible(x)) return false;
    var w=x.word.toLowerCase();
    return !seenMap[w] && !used[w];
  }).sort(function(a,b){
    var ha=cetHash(a.word), hb=cetHash(b.word);
    if(ha!==hb) return ha<hb ? -1 : 1;
    var aw=a.word.toLowerCase(), bw=b.word.toLowerCase();
    return aw<bw ? -1 : aw>bw ? 1 : 0;
  });
}
function pickNew(n){
  if(n<=0) return [];
  var s=seen(), out=[], used={};
  ER.getVocab().forEach(function(v){used[v.word.toLowerCase()]=1;});
  var pools=[orderedPool(cetLists.cet4, s, used)];
  if(ER.settings.cet6 && cetLists.cet6) pools.push(orderedPool(cetLists.cet6, s, used));
  var idx=pools.map(function(){return 0;}), k=0, guard=0;
  while(out.length<n && guard<20000){
    guard++;
    var pi=k % pools.length; k++;
    var pool=pools[pi];
    while(idx[pi]<pool.length){
      var x=pool[idx[pi]++];
      var w=x.word.toLowerCase();
      if(used[w]||s[w]) continue;
      used[w]=1; out.push(x); break;
    }
    if(pools.every(function(p,i){ return idx[i]>=p.length; })) break;
  }
  return out;
}
ER.cetHash = cetHash;
ER.cetEligible = cetEligible;
ER.pickNewCet = function(n){ return loadLists().then(function(){ return pickNew(n); }); };
ER.gapMask = function(text, stage, day){ return gapMask(text, stage, day); };
ER.resolveSentence = resolveSentence;
ER.clozeBlank = clozeBlank;
var SESSION_KEY='er_review_session';
var SKILL_NAME={meaning:'词义',usage:'语境',spelling:'拼写'};
var MAX_ATTEMPTS=4, RETRY_GAP=3;
function balanced(){ return ER.settings.reviewMode==='balanced'; }
function saveSession(){ if(S) ER.lsSet(SESSION_KEY,{version:2,date:today(),session:S},true); }
function clearSession(){ try{localStorage.removeItem(SESSION_KEY);}catch(e){} }
function savedSession(){
  var d=ER.lsGet(SESSION_KEY,null);
  return d&&d.version===2&&d.date===today()&&d.session&&Array.isArray(d.session.queue)&&d.session.targets?d.session:null;
}
function counts(){
  var v=ER.getVocab(), t=today(), d=daily();
  var due=v.filter(function(x){return SRS.isDue(x.srs,t,balanced());}).length;
  var requested=Math.max(0,(+ER.settings.newPerDay||0)-d.newDone);
  var newLeft=due>=30?0:due>=15?Math.min(2,requested):requested;
  return {due:due,mastered:v.filter(function(x){return SRS.isMastered(x.srs);}).length,total:v.length,
    newLeft:newLeft,requested:requested,newDone:d.newDone};
}
function retentionHtml(){
  var t=today(), yesterday=SRS.addDays(t,-1), week=SRS.addDays(t,-6);
  var young={total:0,checked:0,ok:0}, long={checked:0,ok:0}, weak={meaning:[],usage:[],spelling:[]};
  ER.getVocab().forEach(function(v){
    var hist=(v.srs.history||[]).filter(function(e){return e.skill==='meaning'&&e.first&&!e.practice;});
    if(v.srs.added===yesterday){
      young.total++;
      var e=hist.find(function(e){return e.date===t;});
      if(e){young.checked++;if(e.rating==='good'&&!e.assisted) young.ok++;}
    }
    var e7=hist.filter(function(e){return e.date>=week&&e.date<=t&&e.elapsed>=7;}).pop();
    if(e7){long.checked++;if(e7.rating==='good'&&!e7.assisted) long.ok++;}
    Object.keys(weak).forEach(function(k){
      var sk=v.srs.skills&&v.srs.skills[k];
      if(sk&&sk.active&&sk.lapses>0&&sk.stage<3) weak[k].push(v.word);
    });
  });
  function result(o){return o.checked?o.ok+' / '+o.checked:'待验证';}
  return '<div class="card"><h3 class="card-title">真正留下了多少</h3><div class="retention-grid">'+
    '<div><b>'+result(young)+'</b><span>昨日新词 · 今日无提示想起</span><small>已测 '+young.checked+' / '+young.total+' 个</small></div>'+
    '<div><b>'+result(long)+'</b><span>间隔至少 7 天 · 无提示想起</span><small>最近 7 天抽查，每词计最近一次</small></div></div>'+
    '<p class="hint">词义回忆包含你的自评；选择题、用提示和当天重练不计为无提示通过。旧记录不足时显示「待验证」。</p>'+
    '<div class="weak-list">'+Object.keys(weak).map(function(k){return '<div><b>'+SKILL_NAME[k]+'待加强</b> '+(weak[k].length?esc(weak[k].slice(0,5).join(' · '))+(weak[k].length>5?' 等 '+weak[k].length+' 个':''):'暂无记录')+'</div>';}).join('')+'</div></div>';
}
function calendarHtml(){
  var fc=SRS.forecast(ER.getVocab(), today(), 14, balanced()), wk='日一二三四五六';
  return '<div class="cal">'+fc.map(function(d,i){
    var dt=new Date(d.date+'T00:00:00Z');
    return '<div class="'+(d.count?'has ':'')+(i===0?'today':'')+'" title="'+d.date+'"><span>'+(i===0?'今天':d.date.slice(5))+' 周'+wk[dt.getUTCDay()]+'</span><b>'+d.count+'</b></div>';
  }).join('')+'</div>';
}
function renderHome(msg){
  S=null;
  var c=counts(), resume=savedSession(), seenMap=seen(), oldKnown=Object.keys(seenMap).filter(function(w){return seenMap[w]==='known'&&!ER.findWord(w);}).length;
  var h='<div class="card review-home"><div class="rv-head"><h2 style="margin:0;font-size:20px">今日复习</h2><span class="muted">'+esc(today())+'</span></div>';
  if(msg) h+=msg;
  h+='<p class="review-intro">先自己想起来，再核对答案。今天学会的词，隔天再验证。</p>'+
    '<div class="stats"><div class="stat"><b id="statDue">'+c.due+'</b>到期旧词 / 收藏词</div>'+
    '<div class="stat"><b id="statNew">'+c.newLeft+'</b>建议补充新词</div>'+
    '<div class="stat"><b>'+c.mastered+'</b>词义已通过延迟验证</div></div>'+
    '<div class="row">'+(resume?'<button class="primary big" id="btnResume">继续上次复习 →</button>':'')+
    '<button class="'+(resume?'':'primary ')+'big" id="btnStart">'+(resume?'重新安排一轮':c.due||c.newLeft?'开始今日复习 →':'今日已完成 · 查看收尾')+'</button></div>'+
    '<p class="hint">每轮最多 30 个到期词。新词先试每天 5 个，约 10–15 分钟；用时随练习量变化。'+(c.requested>c.newLeft?'旧词较多，今天暂减新词，完成旧词后再补充。':'')+'</p>'+
    '<div class="review-settings"><label>学习重点 <select id="optReviewMode"><option value="reading"'+(!balanced()?' selected':'')+'>阅读：词义 + 语境</option><option value="balanced"'+(balanced()?' selected':'')+'>综合：加练拼写</option></select></label>'+
    '<label>每天新词 <select id="optNewPer">'+[0,5,10,15,20,30].map(function(n){return '<option value="'+n+'"'+(+ER.settings.newPerDay===n?' selected':'')+'>'+n+'</option>';}).join('')+'</select></label>'+
    '<label class="opt"><input type="checkbox" id="optCet6"'+(ER.settings.cet6?' checked':'')+'> 包含六级</label></div>'+
    '<details class="review-help"><summary>这一轮会怎样帮助记忆？</summary><p>先复习到期和易忘的旧词，再学阅读收藏词，最后补充四六级词。词义、语境、拼写分别记录；提示答对不会晋级。新词或错词要隔开至少 3 个其他词的练习，再尝试两次独立回忆，每项最多尝试 4 次。间隔不足或仍未记牢，会留到明天。</p><p>阅读模式暂不安排单独的拼写到期任务，切回综合模式可继续。语境填空需要写出词形，错误只记入语境进度。所有数据保存在当前浏览器，仍可通过原来的备份和同步迁移。</p></details>'+
    (oldKnown?'<div class="known-recover"><p>旧版有 '+oldKnown+' 个词曾标记「我认识」而不再出现。</p><button id="btnRestoreKnown">恢复这些词的低频抽查</button></div>':'')+'</div>';
  h+=retentionHtml()+'<div class="card"><h3 class="card-title">未来 14 天复习量</h3>'+calendarHtml()+'</div>';
  box.innerHTML=h;
  $('btnStart').onclick=function(){ startSession(false); };
  if(resume) $('btnResume').onclick=function(){
    S=resume; box.innerHTML='<div class="card">正在恢复复习…</div>';
    Promise.all([loadLists(),ensureExamples()]).then(next).catch(function(){renderHome('<p class="err">恢复失败，请重试。</p>');});
  };
  $('optReviewMode').onchange=function(){ER.settings.reviewMode=this.value;ER.saveSettings();ER.updateBadge();renderHome();};
  $('optCet6').onchange=function(){ER.settings.cet6=this.checked;ER.saveSettings();};
  $('optNewPer').onchange=function(){ER.settings.newPerDay=+this.value;ER.saveSettings();renderHome();};
  if(oldKnown) $('btnRestoreKnown').onclick=function(){
    this.disabled=true;
    Promise.all(['cet4','cet6'].map(function(l){return ER.loadCet(l).then(function(a){cetLists[l]=a;return a;});})).then(function(lists){
      var n=ER.restoreKnownWords([].concat.apply([],lists)); renderHome('<p class="feedback ok">已恢复 '+n+' 个词，7 天后开始抽查。</p>');
    }).catch(function(){renderHome('<p class="err">词库载入失败，请重试。</p>');});
  };
}
function targetKey(it){return it.word.toLowerCase()+'|'+it.skill;}
function addTest(q,v,skill,isNew){q.push({kind:'test',word:v.word,skill:skill,first:true,retry:0,isNew:!!isNew});}
function startSession(){
  box.innerHTML='<div class="card"><p class="muted"><span class="spinner"></span>正在准备今天的单词…</p></div>';
  Promise.all([loadLists(),ensureExamples()]).then(function(){
    var t=today(), c=counts(), q=[], news=pickNew(c.newLeft);
    var due=SRS.dueList(ER.getVocab(),t,0,balanced()).sort(function(a,b){
      var freshA=!(a.srs.reps||0), freshB=!(b.srs.reps||0);
      if(freshA!==freshB) return freshA?1:-1;
      var da=SRS.dueDate(a.srs,balanced()), db=SRS.dueDate(b.srs,balanced());
      return da<db?-1:da>db?1:(b.srs.lapses||0)-(a.srs.lapses||0);
    }).slice(0,DUE_CAP);
    due.forEach(function(v){
      if(!(v.srs.reps||0)&&!v.srs.skills.meaning.known){q.push({kind:'card',word:v.word});addTest(q,v,'meaning',true);return;}
      var skills=v.srs.skills;
      ['meaning','usage','spelling'].forEach(function(k){
        if(k==='spelling'&&!balanced()) return;
        if(skills[k].active&&skills[k].due<=t) addTest(q,v,k,false);
      });
      var mr=skills.meaning.reps||0;
      if(!skills.usage.active&&mr>=2&&mr%3===2&&resolveSentence(v)&&clozeBlank(v,resolveSentence(v).en)) addTest(q,v,'usage',false);
      if(balanced()&&!skills.spelling.active&&mr>=1) addTest(q,v,'spelling',false);
    });
    news.forEach(function(x){q.push({kind:'card',cet:x,word:x.word});addTest(q,x,'meaning',true);});
    // Round-robin by word keeps its card/meaning/usage/spelling apart where possible.
    var groups=Object.create(null), order=[];
    q.forEach(function(it){if(!groups[it.word]){groups[it.word]=[];order.push(it.word);}groups[it.word].push(it);});
    q=[];
    while(order.some(function(w){return groups[w].length;})){
      order.forEach(function(w){if(groups[w].length)q.push(groups[w].shift());});
    }
    if(!q.length){clearSession();renderHome('<p class="feedback ok">今天的到期词和新词任务已完成。明天回来看看还能想起多少。</p>');return;}
    S={date:t,queue:q,idx:0,correct:0,wrong:0,assisted:0,reset:[],advanced:[],learned:[],known:[],retryOk:0,targets:{},exposures:{},startDue:due.length};
    saveSession();next();
  }).catch(function(e){renderHome('<p class="err">准备失败：'+esc(e.message||e)+'。请通过 http(s) 打开网站后重试。</p>');});
}
function progressHtml(){
  var n=S.queue.length,i=Math.min(S.idx,n);
  return '<div class="rv-head"><span class="muted">第 '+(i+1)+' / '+n+' 项 · 无提示 '+S.correct+' · 待加强 '+S.wrong+'</span><button id="btnQuit">暂停 / 结束本轮</button></div><div class="progress"><i style="width:'+Math.round(i/n*100)+'%"></i></div>';
}
function bindQuit(){ $('btnQuit').onclick=function(){saveSession();summary(true);}; }
function next(){
  if(!S)return renderHome();
  if(S.date!==today()){clearSession();renderHome('<p class="hint">已进入新的一天，按最新到期情况重新安排。</p>');return;}
  while(S.idx<S.queue.length){var it=S.queue[S.idx];if(it.done||(it.kind==='test'&&!ER.findWord(it.word))){S.idx++;continue;}break;}
  if(S.idx>=S.queue.length)return summary(false);
  saveSession();var cur=S.queue[S.idx];if(cur.kind==='card')renderCard(cur);else renderTest(cur);window.scrollTo(0,0);
}
function advance(){if(!S)return;S.idx++;saveSession();next();}
function correctionHtml(v,it){
  var sent=resolveSentence(v), chunk='';
  if(v.collocation) chunk=String(v.collocation);
  else if(sent){
    var hit=clozeBlank(v,sent.en);
    if(hit){var before=sent.en.slice(0,hit.start).trim().split(/\s+/).slice(-2).join(' '),after=sent.en.slice(hit.end).trim().split(/\s+/).slice(0,2).join(' ');chunk=(before+' '+hit.form+' '+after).trim();}
  }
  return '<div class="memory-card"><div class="answer">'+esc(v.word)+' <span class="ipa">'+esc(ER.fmtIpa(v.phonetic))+'</span></div>'+
    '<div class="memory-meaning">'+esc(v.zh||v.en||'暂无释义，可在生词本补充')+'</div>'+
    (chunk?'<div class="memory-chunk"><span>'+(v.collocation?'常用搭配':'原句记忆片段')+'</span> '+esc(chunk)+'</div>':'')+
    (sent?'<div class="qex">'+esc(sent.en)+'</div>'+(sent.zh?'<div class="qexzh">'+esc(sent.zh)+'</div>':''):'')+
    (v.note?'<div class="qexzh">笔记：'+esc(v.note)+'</div>':'')+(it&&it.diff?it.diff:'')+'</div>';
}
function renderCard(it){
  var v=ER.findWord(it.word),x=it.cet;
  if(!v&&x){
    v=ER.addWord({word:x.word,phonetic:x.phonetic,zh:x.zh,sentence:x.ex,sentence_zh:x.exzh,source:x.level});
    markSeen(x.word,'learn');var d=daily();d.newDone++;saveDaily(d);
  }
  if(!v){it.done=true;advance();return;}
  S.exposures=S.exposures||{};S.exposures['word:'+v.word]=S.idx;saveSession();
  box.innerHTML='<div class="card">'+progressHtml()+'<div class="qcard"><span class="qtype newcard">'+(x?'补充新词':'阅读 / 手动收藏')+'</span>'+correctionHtml(v)+
    '<p class="hint">先抓住一个核心意思，读一遍原句。稍后会收起答案，让你自己回忆。</p><div class="row recall-actions"><button id="btnSay">🔊 听发音</button><button class="primary big" id="btnGotIt">开始记忆，稍后回忆 →</button><button id="btnKnown">已认识，改为 7 天后抽查</button></div></div></div>';
  bindQuit();$('btnSay').onclick=function(){ER.speak(v.word,v.audio);};
  $('btnGotIt').onclick=function(){it.done=true;if(S.learned.indexOf(v.word)<0)S.learned.push(v.word);saveSession();advance();};
  $('btnKnown').onclick=function(){
    v.srs=SRS.markKnown(v.srs,today());ER.saveVocab();markSeen(v.word,'learn');it.done=true;S.known.push(v.word);
    S.queue.forEach(function(q){if(q.kind==='test'&&q.word===v.word)q.done=true;});saveSession();advance();
  };
}
function renderRecall(it,v){
  it.type='recall';it.skill=it.skill||'meaning';
  box.innerHTML='<div class="card">'+progressHtml()+'<div class="qcard" id="qCard" data-type="recall"><span class="qtype">词义 · 主动回忆'+(!it.first?' · 隔开再练':'')+'</span>'+
    '<div class="qword" id="qPrompt">'+esc(v.word)+'</div><p class="recall-instruction">先在心里说出它的意思，再看答案核对。</p>'+
    '<div class="row recall-actions"><button id="btnSay">🔊 发音</button><button id="btnRecallHint">给我原句提示</button><button class="primary big" id="btnReveal">想好了，看答案</button></div>'+
    '<div id="recallHint" class="hint" hidden></div><div id="recallAnswer" hidden></div><div id="recallRating" class="recall-ratings" hidden>'+ 
    '<button id="btnRecallAgain">没想起来</button><button id="btnRecallHard">模糊 / 猜的</button><button class="primary" id="btnRecallGood">独立想起来了</button></div>'+
    '<div class="feedback" id="feedback" aria-live="polite"></div><div class="row recall-actions"><button class="primary" id="btnNext" hidden>下一题 →</button></div></div></div>';
  bindQuit();$('btnSay').onclick=function(){ER.speak(v.word,v.audio);};
  function hint(){
    it.assisted=true;var sent=resolveSentence(v);$('recallHint').hidden=false;$('recallHint').textContent=sent?sent.en:'这个词暂时没有原句，点击「看答案」重新学习。';
    $('btnRecallHint').disabled=true;$('btnRecallGood').textContent='提示后想起来了';saveSession();
  }
  function reveal(){
    it.revealed=true;$('recallAnswer').innerHTML=correctionHtml(v);$('recallAnswer').hidden=false;$('recallRating').hidden=false;
    $('btnReveal').hidden=true;$('btnRecallHint').disabled=true;saveSession();
  }
  $('btnRecallHint').onclick=hint;$('btnReveal').onclick=reveal;
  if(it.assisted){if(it.recentExposure){$('recallHint').hidden=false;$('recallHint').textContent='刚刚看过这个词，本题算热身；隔开再测才计独立回忆。';$('btnRecallGood').textContent='这次想起来了';}else hint();}if(it.revealed)reveal();
  [['btnRecallGood','good'],['btnRecallHard','hard'],['btnRecallAgain','again']].forEach(function(a){$(a[0]).onclick=function(){
    Array.prototype.forEach.call($('recallRating').querySelectorAll('button'),function(b){b.disabled=true;});grade(it,v,a[1]);
  };});
}

/* ---------- 例句来源（句子填空） ---------- */
var exCache = {};   // level -> {wordLower: {en,zh}}
function loadExamples(level){
  var cur=exCache[level];
  if(cur && typeof cur.then!=='function') return Promise.resolve(cur);
  if(cur && typeof cur.then==='function') return cur;
  exCache[level] = ER.fetchJson('data/examples-'+level+'.json',20000).then(function(d){
    var ex=(d && d.examples) || {};
    exCache[level]=ex;
    return ex;
  }).catch(function(){ exCache[level]={}; return {}; });
  return exCache[level];
}
function ensureExamples(){
  return Promise.all([loadExamples('cet4'), loadExamples('cet6')]);
}
function cetEntry(w){
  var k=String(w||'').toLowerCase();
  var lists=[cetLists.cet4, cetLists.cet6];
  for(var i=0;i<lists.length;i++){ var L=lists[i]||[]; for(var j=0;j<L.length;j++){ if(L[j].word.toLowerCase()===k) return L[j]; } }
  return null;
}
function exampleLookup(w){
  var k=String(w||'').toLowerCase();
  var levels=['cet4','cet6'];
  for(var i=0;i<levels.length;i++){
    var p=exCache[levels[i]];
    if(p && typeof p.then!=='function' && p[k]) return p[k];
  }
  return null;
}
/** Resolve {en, zh, src} for cloze; null if none. */
function resolveSentence(v){
  if(!v) return null;
  if(v.sentence && String(v.sentence).trim()){
    return {en:String(v.sentence).trim(), zh:String(v.sentence_zh||'').trim(), src:'收藏语境'};
  }
  var ce=cetEntry(v.word);
  if(ce && ce.ex) return {en:ce.ex, zh:ce.exzh||'', src:'四六级例句'};
  var ex=exampleLookup(v.word);
  if(ex && ex.en) return {en:ex.en, zh:ex.zh||'', src:'补充例句'};
  return null;
}
function simpleForms(word){
  var w=String(word||''), out=[w], low=w.toLowerCase();
  if(!/\s/.test(w) && /^[A-Za-z][A-Za-z'-]*$/.test(w)){
    var base=low;
    ['s','es','ed','ing','er','est','ly'].forEach(function(suf){ out.push(base+suf); });
    if(base.endsWith('e')){ out.push(base+'s'); out.push(base+'d'); out.push(base.slice(0,-1)+'ing'); }
    else if(base.endsWith('y') && base.length>2 && !/[aeiou]y$/.test(base)){
      out.push(base.slice(0,-1)+'ies'); out.push(base.slice(0,-1)+'ied');
    } else {
      out.push(base+'s');
      if(/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(base)) out.push(base+base.slice(-1)+'ed', base+base.slice(-1)+'ing');
      else { out.push(base+'ed'); out.push(base+'ing'); }
    }
  }
  return out;
}
/** Find which surface form of the target appears in the sentence; return {form, start, end, htmlBlank, accept}. */
function clozeBlank(v, sentEn){
  var en=String(sentEn||'');
  if(!en) return null;
  var cands=[];
  if(isPhrase(v)){
    cands.push(v.word);
    tokens(v.word).forEach(function(t){ if(/[A-Za-z]/.test(t) && t.length>2) cands.push(t); });
  } else {
    cands=cands.concat(simpleForms(v.word));
    (v.forms||[]).forEach(function(f){ cands=cands.concat(simpleForms(f)); });
  }
  // unique, longer first
  var seen={}, list=[];
  cands.forEach(function(c){ var k=c.toLowerCase(); if(!k||seen[k]) return; seen[k]=1; list.push(c); });
  list.sort(function(a,b){ return b.length-a.length; });
  for(var i=0;i<list.length;i++){
    var form=list[i];
    var re=new RegExp('(^|[^A-Za-z])('+form.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')(?![A-Za-z])','i');
    var m=re.exec(en);
    if(m){
      var start=m.index+m[1].length, end=start+m[2].length, surface=m[2];
      var blankHtml=esc(en.slice(0,start))+'<span class="cloze-blank" id="clozeBlank">______</span>'+esc(en.slice(end));
      return {form:surface, start:start, end:end, html:blankHtml, accept:surface};
    }
  }
  return null;
}

/* ---------- 补全字母 ---------- */
function gapMask(text, stage, day){
  /* Keep first letter of each word; hide ~40–60% of the rest (more at higher stages). Deterministic per word+day. */
  var ratio=0.4+0.2*Math.min(Math.max(+stage||0,0),5)/5;
  var seed=SRS.hash(String(text).toLowerCase()+'|'+String(day||''));
  var out=[], hide=[], i, ch, rnd, letters=[], letterIdx=[];
  for(i=0;i<text.length;i++){
    ch=text.charAt(i);
    if(/[A-Za-z]/.test(ch)){ letters.push(i); }
  }
  // group by words (split on non-letters)
  var words=[], cur=null;
  for(i=0;i<text.length;i++){
    if(/[A-Za-z]/.test(text.charAt(i))){
      if(!cur){ cur={start:i, idx:[]}; words.push(cur); }
      cur.idx.push(i);
    } else cur=null;
  }
  var hideSet={};
  words.forEach(function(w,wi){
    var idxs=w.idx.slice(1); // keep first letter
    var nHide=Math.round(idxs.length*ratio);
    if(idxs.length && nHide<1 && ratio>=0.4) nHide=1;
    if(nHide>idxs.length) nHide=idxs.length;
    // pick deterministic subset
    var pool=idxs.slice(), picks=[];
    for(var k=0;k<nHide;k++){
      seed=(seed*1103515245+12345)&0x7fffffff;
      var j=seed%pool.length;
      picks.push(pool.splice(j,1)[0]);
    }
    picks.forEach(function(p){ hideSet[p]=1; });
  });
  var gaps=[];
  for(i=0;i<text.length;i++){
    ch=text.charAt(i);
    if(hideSet[i]){ gaps.push({i:i, ch:ch}); out.push('_'); hide.push(true); }
    else { out.push(ch); hide.push(false); }
  }
  return {display:out.join(''), hide:hide, gaps:gaps, text:text};
}

/* 选项干扰项 */
function distractors(target, field, n){
  var pool=[], pri=[], seenTxt={}, tgtTxt=norm(target[field]), tPh=isPhrase(target);
  seenTxt[tgtTxt]=1; seenTxt[norm(field==='zh'?shortZh(target.zh||target.en):target.word)]=1;
  var addTo=function(arr){ return function(o){ var t=field==='zh'?shortZh(o.zh):o.word; var k=norm(t); if(!t||seenTxt[k]) return; if(o===target||o.word.toLowerCase()===target.word.toLowerCase()) return; seenTxt[k]=1; arr.push(t); }; };
  var add=addTo(pool);
  // 短语题优先用其他短语做干扰项，不够再用单词；单词题不用短语（太容易排除）
  if(tPh){ shuffle(ER.getVocab().filter(isPhrase)).forEach(addTo(pri)); if(pri.length>=n) return shuffle(pri).slice(0,n); }
  shuffle(ER.getVocab().filter(function(o){return !isPhrase(o);})).slice(0,40).forEach(add);
  var cl=(cetLists.cet4||[]).concat(cetLists.cet6||[]);
  for(var i=0;i<60&&cl.length;i++) add(cl[Math.floor(Math.random()*cl.length)]);
  // 汉译英优先挑首字母相同的英文干扰项，更有区分度
  if(field==='word'){ var f=target.word[0].toLowerCase(); pool.sort(function(a,b){return (b[0].toLowerCase()===f)-(a[0].toLowerCase()===f);}); }
  return pri.concat(shuffle(pool.slice(0, n+3)).slice(0,n-pri.length));
}

/* 测试题 */
function pickType(v,it){
  if(it.keepType) return it.keepType;
  if(it.skill==='spelling') return isPhrase(v)&&tokens(v.word).length>ORDER_OVER?'order':'spell';
  if(it.skill==='usage'){
    var sent=resolveSentence(v);
    if(sent&&clozeBlank(v,sent.en))return 'cloze';
    return 'context';
  }
  // An occasional recognition question checks self-rating, but never counts as independent recall.
  if(it.first&&!it.isNew&&(v.srs.history||[]).filter(function(e){return e.skill==='meaning'&&e.first&&e.self;}).length>=3&&(v.srs.skills.meaning.reps+SRS.hash(v.word))%4===3&&distractors(v,'zh',3).length>=2) return 'en2zh';
  return 'recall';
}
function checkExposure(it){
  if(it.exposureChecked)return;
  it.exposureChecked=true;
  var last=S.exposures&&S.exposures['word:'+it.word];
  if(last==null)return;
  var other=Object.create(null);
  for(var i=last+1;i<S.idx;i++){var q=S.queue[i];if(q.done&&q.word!==it.word)other[q.word]=1;}
  if(Object.keys(other).length<RETRY_GAP){it.assisted=true;it.recentExposure=true;}
}
function renderTest(it){
  var v=ER.findWord(it.word);
  var ph=isPhrase(v), toks=tokens(v.word);
  checkExposure(it);
  var type=pickType(v, it);
  if(type==='recall'){renderRecall(it,v);return;}
  if(type==='context'){renderContext(it,v);return;}
  it.type=type; it.phrase=ph;
  if(type==='en2zh'||type==='zh2en'||type==='gaps'||type==='order')it.assisted=true;
  saveSession();
  var tag='<span class="qtype">'+SKILL_NAME[it.skill]+' · '+(ph?'短语 · ':'')+(type==='spell'&&ph?'听写':TYPE_NAME[type])+(type==='en2zh'?' · 选项校验（有提示）':'')+(it.first?(it.isNew?' · 新词测试':''):' · 隔开再练')+'</span>';
  var zh=v.zh||v.en||'（无释义）';
  var h='<div class="card">'+progressHtml()+'<div class="qcard" data-type="'+type+'" id="qCard">'+tag;
  if(type==='spell' && ph){
    h+='<div class="qzh" id="qPrompt">'+esc(zh)+'</div><div class="hint">听发音，写出这个短语（共 '+toks.length+' 个词，不计大小写和标点）<button id="btnSay">🔊 再听一次</button> <button id="btnHint">提示首字母</button></div>'+
       '<div class="spell phrase"><input type="text" id="spellInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="输入英文短语"><button class="primary" id="btnCheck">确认</button></div>';
  } else if(type==='spell'){
    h+='<div class="qzh" id="qPrompt">'+esc(zh)+'</div><div class="hint">听发音，拼写这个单词（共 '+v.word.length+' 个字符）<button id="btnSay">🔊 再听一次</button> <button id="btnHint">提示首字母</button></div>'+
       '<div class="spell"><input type="text" id="spellInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="输入英文单词"><button class="primary" id="btnCheck">确认</button></div>';
  } else if(type==='order'){
    var order=toks.map(function(t,i){return i;});
    for(var tries=0;tries<6;tries++){ shuffle(order); if(normPhrase(order.map(function(i){return toks[i];}).join(' '))!==normPhrase(v.word)) break; }
    h+='<div class="qzh" id="qPrompt">'+esc(zh)+'</div><div class="hint">听发音，按顺序点击下面的词，拼出这个句子 / 短语（点上面的词可放回）<button id="btnSay">🔊 再听一次</button></div>'+
       '<div class="order-ans" id="orderAns"></div><div class="order-pool" id="orderPool">'+order.map(function(i){return '<button class="tile" data-i="'+i+'">'+esc(toks[i])+'</button>';}).join('')+'</div>'+
       '<div class="row" style="justify-content:center"><button id="btnReset">↺ 重来</button><button class="primary" id="btnCheck">确认</button></div>';
    it.answer=v.word;
  } else if(type==='cloze'){
    var sent=resolveSentence(v), blank=clozeBlank(v, sent.en);
    it.answer=blank.accept; it.baseWord=v.word; it.sentZh=sent.zh; it.sentSrc=sent.src;
    h+='<div class="hint">根据句子写出空缺的英文'+(ph?'短语':'单词')+'（填句子里出现的形式） · '+esc(sent.src)+'</div>'+
       '<div class="cloze-sent" id="clozeSent">'+blank.html+'</div>'+
       '<button id="btnClozeHint">提示中文</button><div class="qexzh" id="clozeZh" hidden>'+esc(sent.zh||zh)+'</div>'+ 
       '<div class="spell cloze"><input type="text" id="clozeInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="填入空缺内容"><button class="primary" id="btnCheck">确认</button></div>';
  } else if(type==='gaps'){
    var mask=gapMask(v.word, v.srs.stage, today());
    it.answer=v.word; it.gaps=mask.gaps;
    h+='<div class="qzh" id="qPrompt">'+esc(zh)+'</div>'+
       '<div class="hint">补全缺失的字母（首字母已给出）<button id="btnSay">🔊 发音</button></div>'+
       '<div class="gaps" id="gapsBox" aria-label="补全字母">';
    h+='<span class="gap-word">';
    for(var gi=0;gi<mask.text.length;gi++){
      var ch=mask.text.charAt(gi);
      if(ch===' '){ h+='</span><span class="gap-space"> </span><span class="gap-word">'; continue; }
      if(mask.hide[gi]) h+='<input type="text" class="gap-in" data-i="'+gi+'" inputmode="text" enterkeyhint="done" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="缺失的字母">';
      else if(ch===' ') h+='<span class="gap-space"> </span>';
      else h+='<span class="gap-ch">'+esc(ch)+'</span>';
    }
    h+='</span></div>'+
       '<div class="spell gaps-act"><button class="primary" id="btnCheck">确认</button></div>';
  } else if(type==='en2zh'){
    var opts=shuffle([shortZh(zh)].concat(distractors(v,'zh',3)));
    h+='<div class="qword'+(ph?' qphrase':'')+'" id="qPrompt">'+esc(v.word)+'</div><div class="ipa">'+esc(ER.fmtIpa(v.phonetic))+' <button id="btnSay">🔊</button></div>'+
       '<div class="opts">'+opts.map(function(o){return '<button data-opt="'+esc(o)+'">'+esc(o)+'</button>';}).join('')+'</div>';
    it.answer=shortZh(zh);
  } else {
    var opts2=shuffle([v.word].concat(distractors(v,'word',3)));
    h+='<div class="qzh" id="qPrompt">'+esc(zh)+'</div><div class="hint">选出对应的英文'+(ph?'短语':'单词')+'</div>'+
       '<div class="opts">'+opts2.map(function(o){return '<button data-opt="'+esc(o)+'" style="font-family:Georgia,serif">'+esc(o)+'</button>';}).join('')+'</div>';
    it.answer=v.word;
  }
  h+='<div class="row recall-actions"><button id="btnDontKnow">没想起来，看答案</button></div><div class="feedback" id="feedback" aria-live="polite"></div><div class="row" style="justify-content:center"><button class="primary" id="btnNext" hidden>下一题 →</button></div></div></div>';
  box.innerHTML=h; bindQuit();
  $('btnDontKnow').onclick=function(){if(it.done)return;Array.prototype.forEach.call(box.querySelectorAll('#qCard input,#qCard button'),function(el){el.disabled=true;});grade(it,v,false);};
  var say=$('btnSay'); if(say) say.onclick=function(){ ER.speak(v.word, v.audio); };
  if(type==='spell'){
    ER.speak(v.word, v.audio);
    var inp=$('spellInput'); setTimeout(function(){ try{inp.focus();}catch(e){} },50);
    $('btnHint').onclick=function(){ it.assisted=true; saveSession(); inp.placeholder= ph? toks.map(function(t){var c=t.replace(/^[^\p{L}\p{N}]+/u,''); return (c[0]||t[0])+'…';}).join(' ') : v.word[0]+' _ _ _'; this.disabled=true; };
    var check=function(){
      if(it.done||inp.readOnly) return;
      var ok= ph? normPhrase(inp.value)===normPhrase(v.word) : norm(inp.value)===norm(v.word);
      if(!inp.value.trim()){ inp.focus(); return; }
      inp.readOnly=true; inp.classList.add(ok?'right':'wrong'); $('btnCheck').disabled=true;
      if(!ok) it.diff=ph?diffHtml(inp.value,v.word):letterDiff(inp.value,v.word);
      grade(it, v, ok);
    };
    $('btnCheck').onclick=check;
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); if(inp.readOnly){ var n=$('btnNext'); if(n&&!n.hidden) n.click(); } else check(); } });
  } else if(type==='order'){
    ER.speak(v.word, v.audio);
    var ans=$('orderAns'), pool=$('orderPool');
    var done=function(){ return !!ans.dataset.done; };
    pool.onclick=function(e){ var t=e.target.closest('.tile'); if(t&&!done()) ans.appendChild(t); };
    ans.onclick=function(e){ var t=e.target.closest('.tile'); if(t&&!done()) pool.appendChild(t); };
    $('btnReset').onclick=function(){ if(done()) return; Array.prototype.slice.call(ans.querySelectorAll('.tile')).sort(function(a,b){return a.dataset.i-b.dataset.i;}).forEach(function(t){pool.appendChild(t);}); };
    $('btnCheck').onclick=function(){
      if(done()) return;
      var left=pool.querySelectorAll('.tile').length;
      if(left){ ER.toast('还有 '+left+' 个词没放'); return; }
      var said=Array.prototype.map.call(ans.querySelectorAll('.tile'),function(t){return t.textContent;}).join(' ');
      var ok=normPhrase(said)===normPhrase(v.word);
      ans.dataset.done='1'; ans.classList.add(ok?'right':'wrong'); this.disabled=true; $('btnReset').disabled=true;
      if(!ok) it.diff=diffHtml(said, v.word);
      grade(it, v, ok);
    };
  } else if(type==='cloze'){
    $('btnClozeHint').onclick=function(){it.assisted=true;$('clozeZh').hidden=false;this.disabled=true;saveSession();};
    if(it.assisted){$('clozeZh').hidden=false;$('btnClozeHint').disabled=true;}
    var cin=$('clozeInput'); setTimeout(function(){ try{cin.focus();}catch(e){} },50);
    var checkC=function(){
      if(it.done||cin.readOnly) return;
      if(!cin.value.trim()){ cin.focus(); return; }
      var ok= ph? normPhrase(cin.value)===normPhrase(it.answer) : norm(cin.value)===norm(it.answer);
      cin.readOnly=true; cin.classList.add(ok?'right':'wrong'); $('btnCheck').disabled=true;
      if(!ok){
        it.diff='<div class="hint">句子中的形式：<b>'+esc(it.answer)+'</b>'+(it.baseWord && norm(it.baseWord)!==norm(it.answer)?'（原词 '+esc(it.baseWord)+'）':'')+'</div>';
      }
      grade(it, v, ok);
    };
    $('btnCheck').onclick=checkC;
    cin.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); if(cin.readOnly){ var n=$('btnNext'); if(n&&!n.hidden) n.click(); } else checkC(); } });
  } else if(type==='gaps'){
    ER.speak(v.word, v.audio);
    var inputs=Array.prototype.slice.call(box.querySelectorAll('.gap-in'));
    var locked=false;
    var readGaps=function(){
      var chars=v.word.split('');
      inputs.forEach(function(inp){ chars[+inp.dataset.i]=inp.value?inp.value.charAt(0):'_'; });
      return chars.join('');
    };
    var checkG=function(){
      if(locked) return;
      var empty=inputs.filter(function(inp){return !inp.value;});
      if(empty.length){ empty[0].focus(); ER.toast('还有 '+empty.length+' 个字母没填'); return; }
      var ok= ph? normPhrase(readGaps())===normPhrase(v.word) : norm(readGaps())===norm(v.word);
      locked=true; $('btnCheck').disabled=true;
      inputs.forEach(function(inp){ inp.readOnly=true; var want=v.word.charAt(+inp.dataset.i); inp.classList.add(norm(inp.value)===norm(want)?'right':'wrong'); });
      grade(it, v, ok);
    };
    inputs.forEach(function(inp, idx){
      inp.addEventListener('focus',function(){ if(!locked) try{ inp.select(); }catch(e){} });
      inp.addEventListener('input',function(){
        if(locked) return;
        var val=inp.value.replace(/[^A-Za-z'-]/g,'');
        if(val.length>1){   // 粘贴 / 键盘一次输入多个字母：依次填到后面的格子
          var j=idx; for(var k=0;k<val.length && j<inputs.length;k++,j++) inputs[j].value=val.charAt(k).toLowerCase();
          (inputs[Math.min(j,inputs.length-1)]).focus(); return;
        }
        inp.value=val.toLowerCase();
        if(inp.value && idx+1<inputs.length) inputs[idx+1].focus();
      });
      inp.addEventListener('keydown',function(e){
        if(locked){ if(e.key==='Enter'){ e.preventDefault(); var n=$('btnNext'); if(n&&!n.hidden) n.click(); } return; }
        if(e.key==='Backspace' && !inp.value && idx>0){ e.preventDefault(); inputs[idx-1].value=''; inputs[idx-1].focus(); }
        else if(e.key==='Enter'){ e.preventDefault(); checkG(); }
        else if(e.key==='ArrowLeft' && idx>0){ e.preventDefault(); inputs[idx-1].focus(); }
        else if(e.key==='ArrowRight' && idx+1<inputs.length){ e.preventDefault(); inputs[idx+1].focus(); }
      });
    });
    $('btnCheck').onclick=checkG;
    setTimeout(function(){ try{ if(inputs[0]) inputs[0].focus(); }catch(e){} },50);
  } else {
    Array.prototype.forEach.call(box.querySelectorAll('.opts button'),function(b){
      b.onclick=function(){
        if(it.done||box.querySelector('.opts').dataset.done) return;
        box.querySelector('.opts').dataset.done='1';
        var ok=b.dataset.opt===it.answer;
        Array.prototype.forEach.call(box.querySelectorAll('.opts button'),function(x){ if(x.dataset.opt===it.answer) x.classList.add('right'); });
        if(!ok) b.classList.add('wrong');
        grade(it, v, ok);
      };
    });
    if(type==='en2zh') ER.speak(v.word, v.audio);
  }
}

function letterDiff(user,answer){
  var a=Array.from(norm(user)),b=Array.from(norm(answer)),outA=[],outB=[];
  for(var i=0;i<Math.max(a.length,b.length);i++){
    outA.push(a[i]===b[i]?esc(a[i]||''):'<del>'+esc(a[i]||'∅')+'</del>');
    outB.push(a[i]===b[i]?esc(b[i]||''):'<ins>'+esc(b[i]||'∅')+'</ins>');
  }
  return '<div class="diff">你的拼写：'+outA.join('')+'<br>正确拼写：'+outB.join('')+'</div>';
}
function renderContext(it,v){
  // Missing/edited examples must not accidentally grade the meaning track as usage.
  it.type='context';var sent=resolveSentence(v);
  box.innerHTML='<div class="card">'+progressHtml()+'<div class="qcard" id="qCard" data-type="context"><span class="qtype">语境待补充</span>'+correctionHtml(v)+'<p class="hint">'+(sent?'原句未匹配到这个词，请在生词本笔记中检查词形。':'这个词暂无可用例句，先练词义。')+'</p><button class="primary" id="btnSkipContext">暂缓语境题</button></div></div>';
  bindQuit();$('btnSkipContext').onclick=function(){it.done=true;v.srs.skills.usage.due=SRS.addDays(today(),1);v.srs=SRS.normalize(v.srs,today());ER.saveVocab();saveSession();advance();};
}
function scheduleRetry(it,target){
  if(target.attempts>=MAX_ATTEMPTS){target.reason='已到本轮上限';return false;}
  var pos=S.idx+1,others=Object.create(null);
  while(pos<S.queue.length&&Object.keys(others).length<RETRY_GAP){
    var q=S.queue[pos];if(!q.done&&q.word!==it.word)others[q.word]=1;pos++;
  }
  if(Object.keys(others).length<RETRY_GAP){target.reason='本轮间隔不足';return false;}
  S.queue.splice(pos,0,{kind:'test',word:it.word,skill:it.skill,first:false,retry:(it.retry||0)+1,isNew:it.isNew,
    keepType:it.skill==='meaning'?'recall':it.type==='order'?'spell':it.type});return true;
}
function grade(it,v,result){
  if(it.done||!S)return;
  it.done=true;
  var rating=typeof result==='string'?result:result?'good':'again';
  var independent=rating==='good'&&!it.assisted;
  var key=targetKey(it),target=S.targets[key]||(S.targets[key]={word:v.word,skill:it.skill,attempts:0,streak:0,required:!!it.isNew||!!v.srs.skills[it.skill].learningPending||['again','hard'].indexOf(v.srs.skills[it.skill].lastRating)>=0,done:false});
  target.attempts++;
  if(independent)target.streak++;else{target.streak=0;target.required=true;}
  target.done=independent&&(!target.required||target.streak>=2);
  v.srs=SRS.record(v.srs,{skill:it.skill,rating:rating,date:today(),assisted:!!it.assisted,practice:!it.first,self:it.type==='recall'});
  v.srs.skills[it.skill].learningPending=!target.done;
  var queued=false;
  if(!target.done){
    queued=scheduleRetry(it,target);
    // Unfinished learning stays due tomorrow even if the first attempt was correct.
    var track=v.srs.skills[it.skill],tomorrow=SRS.addDays(today(),1);
    if(track.due>tomorrow)track.due=tomorrow;
    v.srs=SRS.normalize(v.srs,today());
  }
  if(it.first){
    if(independent){S.correct++;if(S.advanced.indexOf(v.word)<0)S.advanced.push(v.word);}
    else if(rating==='good'){S.assisted++;}
    else {S.wrong++;if(S.reset.indexOf(v.word)<0)S.reset.push(v.word);}
  }else if(independent)S.retryOk++;
  S.exposures=S.exposures||{};S.exposures['word:'+v.word]=S.idx;
  var live=ER.findWord(v.word);if(live&&live!==v)live.srs=v.srs;
  ER.saveVocab();saveSession();
  var fb=$('feedback');fb.className='feedback '+(independent?'ok':rating==='again'?'bad':'');
  var title=independent?(it.type==='recall'?'✓ 已记录：独立想起（自评）':'✓ 无提示答对'):rating==='good'?(it.recentExposure?'刚看过后答对 · 不计独立通过':'有提示答对 · 不计独立通过'):rating==='hard'?'还不够稳 · 已加入加强':'没关系，先把这次记清楚';
  fb.innerHTML='<b>'+title+'</b>'+(it.type==='recall'?'':correctionHtml(v,it))+
    '<p class="hint">'+(target.done?(target.required?'本轮已完成两次隔开回忆。':'')+SKILL_NAME[it.skill]+'下次验证：'+esc(v.srs.skills[it.skill].due):queued?'稍后隔开至少 3 个其他词再练，目标是两次独立想起。':(target.reason||'仍需加强')+'，已留待明天继续。')+'</p>';
  var dont=$('btnDontKnow');if(dont)dont.hidden=true;
  var nb=$('btnNext');nb.disabled=false;nb.hidden=false;nb.onclick=advance;
}
function summary(early){
  if(!S)return renderHome();
  var state=S,c=counts(),pending=Object.keys(S.targets).map(function(k){return S.targets[k];}).filter(function(x){return !x.done;}),completed=Object.keys(S.targets).map(function(k){return S.targets[k];}).filter(function(x){return x.done;});
  if(!early)clearSession();
  var h='<div class="card" id="summaryCard"><h2 style="margin:0 0 6px;font-size:20px">'+(early?'本轮已暂停，可继续':'今天又多记住了一点')+'</h2>'+
    '<p class="hint">今天通过只是第一步，隔天还能想起才更稳。词义自评与客观练习分别保存在记录中。</p><div class="stats">'+
    '<div class="stat"><b id="sumCorrect">'+S.correct+'</b>首次无提示通过</div><div class="stat"><b>'+S.assisted+'</b>提示后答对</div><div class="stat"><b id="sumWrong">'+S.wrong+'</b>首次模糊 / 忘记</div><div class="stat"><b>'+S.learned.length+'</b>初步学习的新词</div></div>';
  if(completed.length)h+='<p><b>本轮已通过</b></p><div class="pill-list ok">'+completed.map(function(x){return '<span>'+esc(x.word)+' · '+SKILL_NAME[x.skill]+'</span>';}).join('')+'</div>';
  if(pending.length)h+='<p><b>仍需加强'+(early?'':'，明天再验证')+'</b></p><div class="pill-list" id="sumReset">'+pending.map(function(x){return '<span>'+esc(x.word)+' · '+SKILL_NAME[x.skill]+'</span>';}).join('')+'</div>';
  if(S.known.length)h+='<p class="hint">已保留低频抽查：'+S.known.map(esc).join('、')+'</p>';
  h+='<div class="row" style="margin-top:20px">'+(early?'<button class="primary" id="btnContinue">继续这一轮</button>':'')+(c.due?'<button id="btnAgain">继续剩余 '+c.due+' 个到期词</button>':'')+'<button id="btnHome">返回复习首页</button></div></div>'+retentionHtml();
  S=null;box.innerHTML=h;$('btnHome').onclick=function(){renderHome();};
  if(early)$('btnContinue').onclick=function(){S=state;next();};
  if($('btnAgain'))$('btnAgain').onclick=function(){startSession();};
}
ER.views.review={show:function(){if(S)next();else renderHome();},refresh:function(){if(!S&&ER.currentTab==='review')renderHome();},state:function(){return S;}};
})();
