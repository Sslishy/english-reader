/* 每日复习：间隔重复 + 每日四六级新词 */
(function(){
'use strict';
var ER = window.ER, $ = ER.$, esc = ER.esc;
var DUE_CAP = 30;
var TYPE_NAME = {spell:'拼写', en2zh:'英译汉', zh2en:'汉译英', order:'连词成句'};
var ORDER_OVER = 6;      // 超过 6 个词的短语 / 句子：拼写题改为「连词成句」
var box = $('reviewBox');
var S = null;            // 当前会话
var cetLists = {};       // level -> list

function today(){ return ER.today(); }
function daily(){ var d=ER.lsGet('er_daily',{}); if(d.date!==today()) d={date:today(),newDone:0}; return d; }
function saveDaily(d){ ER.lsSet('er_daily',d); }
function seen(){ return ER.lsGet('er_cet_seen',{}); }
function markSeen(w,how){ var s=seen(); s[w.toLowerCase()]=how; ER.lsSet('er_cet_seen',s); }
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
/* 挑选今天的新词：四级优先；勾选六级后四六级交替 */
function pickNew(n){
  if(n<=0) return [];
  var s=seen(), out=[], used={};
  ER.getVocab().forEach(function(v){used[v.word.toLowerCase()]=1;});
  var iters=[{list:cetLists.cet4||[],i:0}]; if(ER.settings.cet6&&cetLists.cet6) iters.push({list:cetLists.cet6,i:0});
  var k=0, guard=0;
  while(out.length<n && guard<20000){
    guard++;
    var it=iters[k%iters.length]; k++;
    while(it.i<it.list.length){ var x=it.list[it.i++]; var w=x.word.toLowerCase(); if(!s[w]&&!used[w]){ used[w]=1; out.push(x); break; } }
    if(iters.every(function(t){return t.i>=t.list.length;})) break;
  }
  return out;
}
function counts(){
  var v=ER.getVocab(), t=today();
  var due=v.filter(function(x){return SRS.isDue(x.srs,t);}).length;
  var mastered=v.filter(function(x){return x.srs.stage>=SRS.MAX_STAGE;}).length;
  var d=daily(); var newLeft=Math.max(0,(+ER.settings.newPerDay||0)-d.newDone);
  return {due:due, mastered:mastered, total:v.length, newLeft:newLeft, newDone:d.newDone};
}

/* ---------- 首页 / 仪表盘 ---------- */
function calendarHtml(){
  var fc=SRS.forecast(ER.getVocab(), today(), 14), wk='日一二三四五六';
  return '<div class="cal">'+fc.map(function(d,i){
    var dt=new Date(d.date+'T00:00:00Z');
    return '<div class="'+(d.count?'has ':'')+(i===0?'today':'')+'" title="'+d.date+'"><span>'+(i===0?'今天':d.date.slice(5))+' 周'+wk[dt.getUTCDay()]+'</span><b>'+d.count+'</b></div>';
  }).join('')+'</div>';
}
function renderHome(msg){
  S=null;
  var c=counts();
  var h='<div class="card"><div class="rv-head"><h2 style="margin:0;font-size:18px">🔁 今日复习 <span class="muted" style="font-size:13px;font-weight:normal">'+esc(today())+'</span></h2></div>';
  if(msg) h+=msg;
  h+='<div class="stats"><div class="stat"><b id="statDue">'+c.due+'</b>待复习'+(c.due>DUE_CAP?'<div class="hint">本轮最多 '+DUE_CAP+' 个</div>':'')+'</div>'+
     '<div class="stat"><b id="statNew">'+c.newLeft+'</b>今日新词（已学 '+c.newDone+'）</div>'+
     '<div class="stat"><b>'+c.total+'</b>生词本总数</div><div class="stat"><b>'+c.mastered+'</b>已掌握</div></div>';
  var nothing = !c.due && !c.newLeft;
  h+='<div class="row">'+(nothing?'<span class="feedback ok">🎉 今天的复习任务完成了！</span><button id="btnMoreNew">再学 10 个新词</button>':'<button class="primary big" id="btnStart">开始复习 →</button>')+'</div>';
  h+='<div class="row"><label class="opt"><input type="checkbox" id="optCet6"'+(ER.settings.cet6?' checked':'')+'> 新词包含六级（CET-6）</label>'+
     '<label class="opt">每天新词 <select id="optNewPer">'+[0,5,10,15,20,30].map(function(n){return '<option value="'+n+'"'+(+ER.settings.newPerDay===n?' selected':'')+'>'+n+'</option>';}).join('')+'</select></label></div>';
  h+='<p class="hint">复习间隔（艾宾浩斯遗忘曲线）：答对后 1 → 2 → 4 → 7 → 15 → 30 天再复习，连续答对 6 次即「已掌握」（之后每 60 天抽查一次）；答错则回到第 0 阶段，明天重来，并在本轮稍后再考一次。题型（拼写 / 英译汉 / 汉译英）每个词轮换；短语 / 短句同样参与复习：拼写题变成听写（不计大小写和标点），超过 6 个词的改为「连词成句」。</p></div>';
  h+='<div class="card"><h3 class="card-title">📅 未来 14 天复习量</h3>'+calendarHtml()+'</div>';
  box.innerHTML=h;
  var st=$('btnStart'); if(st) st.onclick=function(){ startSession(false); };
  var mn=$('btnMoreNew'); if(mn) mn.onclick=function(){ startSession(true); };
  $('optCet6').onchange=function(){ ER.settings.cet6=this.checked; ER.saveSettings(); };
  $('optNewPer').onchange=function(){ ER.settings.newPerDay=+this.value; ER.saveSettings(); renderHome(); };
}

/* ---------- 会话 ---------- */
function startSession(extraNew){
  box.innerHTML='<div class="card"><p class="muted"><span class="spinner"></span>正在准备今天的单词…</p></div>';
  loadLists().then(function(){
    var t=today();
    var due=SRS.dueList(ER.getVocab(), t, DUE_CAP);
    var c=counts();
    var nNew = extraNew? 10 : c.newLeft;
    var news=pickNew(nNew);
    var q=[];
    due.forEach(function(v){ q.push({kind:'test',word:v.word,first:true,retry:0}); });
    // 新词：卡片 → 隔一张卡片后测试
    news.forEach(function(x,i){
      q.push({kind:'card',cet:x});
      if(i>0) q.push({kind:'test',word:news[i-1].word,first:true,retry:0,isNew:true});
    });
    if(news.length) q.push({kind:'test',word:news[news.length-1].word,first:true,retry:0,isNew:true});
    if(!q.length){ renderHome('<p class="feedback ok">今天没有需要复习的词了。</p>'); return; }
    S={queue:q, idx:0, correct:0, wrong:0, reset:[], advanced:[], learned:[], known:[], retryOk:0, startDue:due.length};
    next();
  }).catch(function(e){
    box.innerHTML='<div class="card"><p class="err">词库载入失败：'+esc(e.message||e)+'</p><p class="hint">请通过 http(s) 访问本页（GitHub Pages 或 python3 -m http.server），file:// 下无法读取词库。</p><button id="btnBackHome">返回</button></div>';
    $('btnBackHome').onclick=function(){renderHome();};
  });
}
function progressHtml(){
  var n=S.queue.length, i=Math.min(S.idx,n);
  return '<div class="rv-head"><span class="muted">第 '+(i+1)+' / '+n+' 项 · ✓ '+S.correct+' · ✗ '+S.wrong+'</span><button id="btnQuit">结束本轮</button></div><div class="progress"><i style="width:'+(n?Math.round(i/n*100):0)+'%"></i></div>';
}
function bindQuit(){ var b=$('btnQuit'); if(b) b.onclick=function(){ summary(true); }; }
function next(){
  if(!S) return renderHome();
  // 跳过已被标记为“太简单”的新词测试 / 已被删除的词
  while(S.idx<S.queue.length){
    var it=S.queue[S.idx];
    if(it.done || (it.kind==='test' && !ER.findWord(it.word))) { S.idx++; continue; }
    break;
  }
  if(S.idx>=S.queue.length) return summary(false);
  var it2=S.queue[S.idx];
  if(it2.kind==='card') renderCard(it2); else renderTest(it2);
  window.scrollTo(0,0);
}
function advance(){ S.idx++; next(); }

/* 新词卡片 */
function renderCard(it){
  var x=it.cet;
  var h='<div class="card">'+progressHtml()+'<div class="qcard"><span class="qtype newcard">新词 · '+(x.level==='cet6'?'六级':'四级')+'</span>'+
    '<div class="qword" id="qWord">'+esc(x.word)+'</div><div class="ipa">'+esc(ER.fmtIpa(x.phonetic))+' <button id="btnSay" title="发音">🔊</button></div>'+
    '<div class="qzh">'+esc(x.zh)+'</div>'+
    (x.ex?'<div class="qex">'+esc(x.ex)+'</div><div class="qexzh">'+esc(x.exzh)+'</div>':'')+
    '<div class="row" style="justify-content:center;margin-top:20px"><button class="primary big" id="btnGotIt">记住了，稍后测试 →</button><button id="btnKnown">太简单，我认识</button></div>'+
    '</div></div>';
  box.innerHTML=h; bindQuit();
  $('btnSay').onclick=function(){ ER.speak(x.word); };
  ER.speak(x.word);
  // 展示即加入生词本（第 0 阶段，今天到期），保证中途退出也不会丢
  if(!ER.findWord(x.word)){
    ER.addWord({word:x.word,phonetic:x.phonetic,zh:x.zh,sentence:x.ex,sentence_zh:x.exzh,source:x.level});
    markSeen(x.word,'learn'); var d=daily(); d.newDone++; saveDaily(d);
  }
  $('btnGotIt').onclick=function(){ it.done=true; S.learned.push(x.word); advance(); };
  $('btnKnown').onclick=function(){
    it.done=true; ER.removeWord(x.word); markSeen(x.word,'known'); S.known.push(x.word);
    ER.toast('已标记为认识，以后不再出现'); advance();
  };
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
function renderTest(it){
  var v=ER.findWord(it.word);
  var type=SRS.qtype(v.word, v.srs), ph=isPhrase(v), toks=tokens(v.word);
  if(type==='spell' && ph && toks.length>ORDER_OVER) type='order';
  it.type=type; it.phrase=ph;
  var tag='<span class="qtype">'+(ph?'短语 · ':'')+(type==='spell'&&ph?'听写':TYPE_NAME[type])+(it.first?(it.isNew?' · 新词测试':' · 阶段 '+v.srs.stage):' · 再练一次')+'</span>';
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
  h+='<div class="feedback" id="feedback"></div><div class="row" style="justify-content:center"><button class="primary" id="btnNext" hidden>下一题 →</button></div></div></div>';
  box.innerHTML=h; bindQuit();
  var say=$('btnSay'); if(say) say.onclick=function(){ ER.speak(v.word, v.audio); };
  if(type==='spell'){
    ER.speak(v.word, v.audio);
    var inp=$('spellInput'); setTimeout(function(){ try{inp.focus();}catch(e){} },50);
    $('btnHint').onclick=function(){ inp.placeholder= ph? toks.map(function(t){var c=t.replace(/^[^\p{L}\p{N}]+/u,''); return (c[0]||t[0])+'…';}).join(' ') : v.word[0]+' _ _ _'; this.disabled=true; };
    var check=function(){
      if(inp.readOnly) return;
      var ok= ph? normPhrase(inp.value)===normPhrase(v.word) : norm(inp.value)===norm(v.word);
      if(!inp.value.trim()){ inp.focus(); return; }
      inp.readOnly=true; inp.classList.add(ok?'right':'wrong'); $('btnCheck').disabled=true;
      if(ph&&!ok) it.diff=diffHtml(inp.value, v.word);
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
  } else {
    Array.prototype.forEach.call(box.querySelectorAll('.opts button'),function(b){
      b.onclick=function(){
        if(box.querySelector('.opts').dataset.done) return;
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
function grade(it, v, ok){
  if(it.done) return;
  it.done=true;
  var t=today(), fb=$('feedback'), before=v.srs.stage;
  if(it.first){
    v.srs=SRS.answer(v.srs, ok, t);
    if(ok){ S.correct++; S.advanced.push(v.word); }
    else { S.wrong++; if(S.reset.indexOf(v.word)<0) S.reset.push(v.word); }
  } else {
    v.srs=SRS.practice(v.srs);
    if(ok) S.retryOk++;
  }
  ER.saveVocab();
  var nextTxt = v.srs.stage>=SRS.MAX_STAGE? '已掌握，'+v.srs.due+' 抽查' : '下次复习：'+v.srs.due+'（阶段 '+v.srs.stage+'）';
  if(ok){
    fb.className='feedback ok';
    fb.innerHTML='✓ 正确！'+(it.first?'<span class="hint">'+esc(nextTxt)+'</span>':'');
  } else {
    fb.className='feedback bad';
    fb.innerHTML='✗ 正确答案：<span class="answer">'+esc(v.word)+'</span> <span class="ipa">'+esc(ER.fmtIpa(v.phonetic))+'</span><div style="color:#0d3d8a">'+esc(v.zh||'')+'</div>'+
      (it.diff||'')+
      (v.sentence?'<div class="qex" style="font-size:14px">'+esc(v.sentence)+'</div>':(v.note?'<div class="qexzh">📝 '+esc(v.note)+'</div>':''))+
      '<div class="hint">'+(it.first&&before>0?'进度已重置为阶段 0，':'')+'明天再复习；本轮稍后会再考一次</div>';
    // 本轮稍后再出现（最多重练 2 次）
    if(it.retry<2){
      var pos=Math.min(S.queue.length, S.idx+4);
      S.queue.splice(pos,0,{kind:'test',word:v.word,first:false,retry:it.retry+1,isNew:it.isNew});
    }
  }
  var nb=$('btnNext'); nb.hidden=false; nb.onclick=advance;
  if(ok && it.type!=='spell' && it.type!=='order'){ /* 选择题答对：稍后自动进入下一题 */ setTimeout(function(){ if(S && S.queue[S.idx]===it && !nb.dataset.clicked){ nb.dataset.clicked='1'; advance(); } },900); nb.onclick=function(){ nb.dataset.clicked='1'; advance(); }; }
  else setTimeout(function(){ try{nb.focus();}catch(e){} },30);
}

/* 本轮总结 */
function summary(early){
  if(!S) return renderHome();
  var c=counts();
  var h='<div class="card" id="summaryCard"><h2 style="margin:0 0 6px;font-size:18px">'+(early?'⏸ 本轮已结束':'🎉 本轮完成！')+'</h2>'+
    '<div class="stats"><div class="stat"><b id="sumCorrect">'+S.correct+'</b>首次答对</div><div class="stat"><b id="sumWrong">'+S.wrong+'</b>答错</div>'+
    '<div class="stat"><b>'+S.learned.length+'</b>新学单词</div><div class="stat"><b>'+c.due+'</b>仍待复习</div></div>';
  if(S.reset.length) h+='<div><b>需要加强（已重置，明天再复习）：</b><div class="pill-list" id="sumReset">'+S.reset.map(function(w){return '<span>'+esc(w)+'</span>';}).join('')+'</div></div>';
  if(S.advanced.length) h+='<div style="margin-top:8px"><b>进阶的词：</b><div class="pill-list ok">'+S.advanced.map(function(w){return '<span>'+esc(w)+'</span>';}).join('')+'</div></div>';
  if(S.known.length) h+='<p class="hint">标记为认识（不再出现）：'+S.known.map(esc).join(', ')+'</p>';
  h+='<div class="row">'+(c.due?'<button class="primary" id="btnAgain">继续复习剩余 '+c.due+' 个</button>':'')+'<button id="btnHome">返回复习首页</button></div></div>';
  h+='<div class="card"><h3 class="card-title">📅 未来 14 天复习量</h3>'+calendarHtml()+'</div>';
  S=null;
  box.innerHTML=h;
  $('btnHome').onclick=function(){ renderHome(); };
  var a=$('btnAgain'); if(a) a.onclick=function(){ startSession(false); };
}

ER.views.review = {
  show: function(){ if(S) next(); else renderHome(); },
  refresh: function(){ if(!S && ER.currentTab==='review') renderHome(); },
  state: function(){ return S; }
};
})();
