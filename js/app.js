/* 雅思阅读器：工具、设置、查词、阅读、生词本、备份、路由 */
(function(){
'use strict';
var ER = window.ER = window.ER || {};
ER.views = ER.views || {};

/* ========== 示例文章（原创） ========== */
var SAMPLES = {
  s1: "Farming in the Sky: The Rise of Urban Agriculture\n\n" +
"As cities continue to expand, planners are searching for new ways to feed rapidly growing populations. One increasingly popular solution is urban agriculture, which involves growing fruit and vegetables on rooftops, in abandoned warehouses, and even inside specially designed vertical towers.\n\n" +
"Supporters argue that the benefits are considerable. Food grown close to consumers travels shorter distances, which reduces transport costs and lowers carbon emissions. In addition, vertical farms use artificial lighting and carefully controlled water systems, allowing crops to be harvested throughout the year regardless of the weather. Some studies suggest that these systems consume up to ninety percent less water than traditional fields.\n\n" +
"However, critics point out several significant drawbacks. The electricity required to power lights and climate controls is expensive, and unless it comes from renewable sources, the environmental advantages may be largely cancelled out. Furthermore, only a limited range of crops, mainly leafy greens and herbs, can currently be produced profitably in this way.\n\n" +
"Despite these concerns, many experts believe urban farming will play a complementary role rather than replace conventional agriculture entirely. As technology improves and energy becomes cheaper, it may gradually become an essential feature of the modern city.",
  s2: "Why Sleep Matters for Memory\n\n" +
"For centuries, sleep was regarded as a passive state in which the brain simply rested. Recent research, however, has revealed that sleep is a remarkably active process that plays a crucial role in learning and memory.\n\n" +
"During the day, new information is temporarily stored in a region of the brain called the hippocampus. Scientists believe that while we sleep, particularly during the deep stages of sleep, this information is gradually transferred to the cortex, where it can be retained for much longer periods. This process, known as memory consolidation, helps explain why students who stay up all night before an exam often perform worse than those who get adequate rest.\n\n" +
"In one widely cited experiment, participants were asked to memorise a list of word pairs. Half of them were then allowed to sleep, while the others remained awake. When tested twelve hours later, the group that had slept recalled significantly more pairs.\n\n" +
"These findings have important implications for education. Rather than sacrificing sleep to study longer, learners may achieve better results by reviewing material in the evening and allowing their brains to process it overnight. Consistent sleep habits, it seems, are not a luxury but a genuine academic advantage."
};

/* ========== 工具 ========== */
var $ = ER.$ = function(id){return document.getElementById(id);};
var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.documentElement.classList.add('touch');
var esc = ER.esc = function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
function stripHtml(h){var d=document.createElement('div');d.innerHTML=h;return (d.textContent||'').replace(/\s+/g,' ').trim();}
var toast = ER.toast = function(msg){var t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(function(){t.classList.remove('show');},1800);};
var lsGet = ER.lsGet = function(k,d){try{var v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}};
var lsSet = ER.lsSet = function(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){toast('本地存储已满或不可用，数据可能未保存');}};
function fetchJson(url,ms){
  var ctl = ('AbortController' in window)? new AbortController():null;
  var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, ms||9000);
  return fetch(url, ctl?{signal:ctl.signal}:{}).then(function(r){
    clearTimeout(timer);
    if(!r.ok){var e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
    return r.json();
  },function(e){clearTimeout(timer);e.network=true;throw e;});
}
ER.fetchJson = fetchJson;

/* ========== 日期（支持 ?today=YYYY-MM-DD 覆盖，便于测试） ========== */
var fakeToday = null;
(function(){ var q=new URLSearchParams(location.search).get('today'); if(q && SRS.isYmd(q)) fakeToday=q; })();
function realToday(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
var today = ER.today = function(){ return fakeToday || realToday(); };
ER.setToday = function(d){ fakeToday = d && SRS.isYmd(d) ? d : null; updateBadge(); };

/* ========== 设置 ========== */
var settings = ER.settings = Object.assign({accent:'en-US',auto:false,size:'20',email:'',text:'',newPerDay:10,cet6:false}, lsGet('er_settings',{}));
var saveSettings = ER.saveSettings = function(){lsSet('er_settings',settings);};
function applySettingsUI(){
  $('optAccent').value=settings.accent; $('optAuto').checked=!!settings.auto; $('optSize').value=settings.size; $('optEmail').value=settings.email||'';
  document.documentElement.style.setProperty('--read-size',settings.size+'px');
}
applySettingsUI();
$('optAccent').onchange=function(){settings.accent=this.value;saveSettings();};
$('optAuto').onchange=function(){settings.auto=this.checked;saveSettings();};
$('optSize').onchange=function(){settings.size=this.value;document.documentElement.style.setProperty('--read-size',this.value+'px');saveSettings();};
$('optEmail').onchange=function(){settings.email=this.value.trim();saveSettings();};
$('btnSettings').onclick=function(){hidePop();$('settingsPanel').hidden=false;};
$('btnCloseSettings').onclick=function(){$('settingsPanel').hidden=true;};
$('settingsPanel').addEventListener('click',function(e){if(e.target===this)this.hidden=true;});

/* ========== 生词本数据 ========== */
var vocab = [];
function loadVocab(){
  vocab = lsGet('er_vocab',[]);
  if(!Array.isArray(vocab)) vocab=[];
  var t=today();
  vocab = vocab.filter(function(v){return v&&typeof v.word==='string'&&v.word;}).map(function(v){
    v.srs = SRS.normalize(v.srs, t); if(!v.source) v.source='reading'; if(!v.date) v.date=t; return v;
  });
}
loadVocab();
ER.getVocab = function(){return vocab;};
ER.findWord = function(w){w=String(w).toLowerCase();return vocab.find(function(v){return v.word.toLowerCase()===w;});};
var saveVocab = ER.saveVocab = function(){lsSet('er_vocab',vocab);updateCount();refreshHighlights();updateBadge();};
ER.addWord = function(item){
  if(ER.findWord(item.word)) return ER.findWord(item.word);
  var t=today();
  var v=Object.assign({word:'',forms:[],phonetic:'',zh:'',en:'',sentence:'',date:t,audio:'',source:'reading'},item);
  v.word=v.word.toLowerCase()===v.word?v.word:v.word; v.srs=SRS.init(t);
  vocab.push(v); saveVocab(); return v;
};
ER.removeWord = function(w){ vocab=vocab.filter(function(v){return v.word!==w;}); saveVocab(); };
function inVocab(word){return !!ER.findWord(word);}
function updateCount(){$('vocabCount').textContent=vocab.length;$('vocabCount2').textContent='（'+vocab.length+' 个）';}
var updateBadge = ER.updateBadge = function(){
  var n=vocab.filter(function(v){return SRS.isDue(v.srs,today());}).length;
  var b=$('dueBadge'); b.textContent=n; b.hidden=!n; b.title='今天有 '+n+' 个词待复习';
};
function vocabKeys(){var s={};vocab.forEach(function(v){s[v.word.toLowerCase()]=1;(v.forms||[]).forEach(function(f){s[f]=1;});});return s;}
function refreshHighlights(){
  var keys=vocabKeys();
  var spans=document.querySelectorAll('.reader .w');
  for(var i=0;i<spans.length;i++){
    var w=spans[i].getAttribute('data-w'); var hit=!!keys[w];
    if(!hit){ var c=candidates(w); for(var j=1;j<c.length;j++){ if(keys[c[j]]){hit=true;break;} } }
    spans[i].classList.toggle('known',hit);
  }
}
ER.refreshHighlights = refreshHighlights;
updateCount();

/* ========== 四六级词库（data/cet4.json, data/cet6.json） ========== */
var cetCache = {}, cetDict = {};
ER.loadCet = function(level){
  if(!cetCache[level]){
    cetCache[level] = fetchJson('data/'+level+'.json',30000).then(function(d){
      var rows=(d&&d.words)||[];
      var list=rows.map(function(r){return {word:r[0],phonetic:r[1]||'',zh:r[2]||'',ex:r[3]||'',exzh:r[4]||'',level:level};});
      list.forEach(function(x){var k=x.word.toLowerCase(); if(!cetDict[k]) cetDict[k]=x;});
      return list;
    }).catch(function(e){ delete cetCache[level]; throw e; });
  }
  return cetCache[level];
};
ER.cetLookup = function(w){return cetDict[String(w).toLowerCase()]||null;};
function loadAllCet(){return Promise.all([ER.loadCet('cet4').catch(function(){return [];}),ER.loadCet('cet6').catch(function(){return [];})]);}
ER.fmtIpa = function(p){ p=String(p||'').trim(); if(!p) return ''; return /^[\/\[]/.test(p)?p:'/'+p+'/'; };

/* ========== 分词渲染 ========== */
var WORD_RE = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
function tokenize(p){
  var sents = p.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g) || [p];
  return sents.map(function(s){
    var out='',last=0; s.replace(WORD_RE,function(m,off){
      out+=esc(s.slice(last,off))+'<span class="w" data-w="'+esc(m.toLowerCase().replace(/’/g,"'"))+'">'+esc(m)+'</span>';
      last=off+m.length; return m;});
    out+=esc(s.slice(last));
    return '<span class="sent">'+out+'</span>';
  }).join('');
}
function renderReader(text, el){
  var paras = text.replace(/\r/g,'').split(/\n\s*\n|\n/).map(function(p){return p.trim();}).filter(Boolean);
  var html='';
  paras.forEach(function(p,i){
    var isTitle = i===0 && paras.length>1 && p.length<90 && !/[.!?]$/.test(p);
    html += isTitle? '<h2>'+tokenize(p)+'</h2>' : '<p>'+tokenize(p)+'</p>';
  });
  el.innerHTML=html;
  refreshHighlights();
}

/* ========== 今日阅读 ========== */
var articleIndex = null, currentArticle = null;
function loadIndex(){
  return fetchJson('articles/index.json?'+Date.now(),15000).then(function(d){articleIndex=Array.isArray(d)?d:[];return articleIndex;});
}
function showArticle(date){
  var box=$('articleBox');
  var p = articleIndex? Promise.resolve(articleIndex) : loadIndex();
  return p.then(function(idx){
    renderArchive(idx, date);
    if(!idx.length){ box.innerHTML='<div class="card"><p class="muted">还没有文章。用 scripts/add_article.py 添加第一篇吧。</p></div>'; return; }
    var entry = date? idx.find(function(e){return e.date===date;}) : idx[0];
    if(!entry){ box.innerHTML='<div class="card"><p class="err">找不到 '+esc(date)+' 的文章。</p><p><a href="#/read">← 回到最新文章</a></p></div>'; return; }
    if(currentArticle && currentArticle.date===entry.date && box.querySelector('.reader')) { renderArchive(idx, entry.date); return; }
    box.innerHTML='<p class="muted"><span class="spinner"></span>正在载入文章…</p>';
    return fetchJson('articles/'+entry.file,15000).then(function(a){ currentArticle=a; renderArticle(a, entry===idx[0]); renderArchive(idx, a.date); });
  }).catch(function(e){
    box.innerHTML='<div class="card"><p class="err">文章载入失败：'+esc(e.message||e)+'</p>'+
      (location.protocol==='file:'?'<p class="hint">直接双击打开 index.html（file://）时浏览器不允许读取 JSON。请部署到 GitHub Pages，或在本目录运行 <code>python3 -m http.server</code> 后访问 http://localhost:8000 。你仍可使用「自己粘贴」和「生词本」。</p>':'<p class="hint">请检查网络后刷新页面。</p>')+'</div>';
  });
}
function renderArticle(a, isNewest){
  var h='<div class="card">';
  h+='<div class="art-meta"><span class="tag">'+(isNewest?'今日阅读':'往期')+' · '+esc(a.date)+'</span><span class="tag">'+esc(a.level||'')+'</span><span>'+wordCount(a)+' 词</span></div>';
  h+='<article class="reader" id="articleReader"><h2>'+tokenize(a.title)+'</h2>';
  h+='<div class="art-title-zh">'+esc(a.title_zh||'')+'</div>';
  h+='<details class="summary"><summary>中文导读（建议读完英文后再看）</summary><div style="margin-top:6px;font-family:-apple-system,\'PingFang SC\',sans-serif;font-size:15px;line-height:1.7">'+esc(a.summary_zh||'')+'</div></details>';
  (a.paragraphs||[]).forEach(function(p){ h+='<p>'+tokenize(p)+'</p>'; });
  h+='</article>';
  h+='<p class="hint">来源：<a href="'+esc(a.source_url)+'" target="_blank" rel="noopener">'+esc(a.source_name||a.source_url)+'</a>（本文为根据该报道改写的原创学习文章）</p>';
  h+='<p class="hint">双击 / 轻点任意单词查词 · <span class="hl-sample">黄色</span> = 生词本中的词</p></div>';
  if(a.key_words&&a.key_words.length){
    h+='<div class="card"><h3 class="card-title">🔑 重点词汇</h3><div class="kw-list">';
    a.key_words.forEach(function(k){
      var saved=inVocab(k.word);
      h+='<div class="kw"><div class="kw-top"><span class="kw-w">'+esc(k.word)+'</span><span class="ipa">'+esc(k.phonetic||'')+'</span></div>'+
        '<div class="kw-zh">'+esc(k.meaning_zh)+'</div><div class="kw-ops"><button data-kwsay="'+esc(k.word)+'">🔊</button>'+
        '<button data-kwadd="'+esc(k.word)+'" class="'+(saved?'':'primary')+'">'+(saved?'✓ 已在生词本':'＋ 生词本')+'</button></div></div>';
    });
    h+='</div><div class="row"><button id="btnAddAllKw">全部加入生词本</button></div></div>';
  }
  $('articleBox').innerHTML=h;
  refreshHighlights();
}
function wordCount(a){return (a.paragraphs||[]).join(' ').split(/\s+/).filter(function(x){return /[A-Za-z]/.test(x);}).length;}
function sentenceFor(word, root){
  var forms=candidates(word); var sp=root.querySelectorAll('.w');
  for(var i=0;i<sp.length;i++){ var w=sp[i].getAttribute('data-w'); if(w===word||candidates(w).indexOf(word)>=0||forms.indexOf(w)>=0){ var s=sp[i].closest('.sent'); if(s&&!s.closest('h2')) return s.textContent.replace(/\s+/g,' ').trim(); } }
  return '';
}
function addKeyWord(k){
  if(inVocab(k.word)) return false;
  var root=$('articleReader')||document;
  ER.addWord({word:k.word.toLowerCase(),phonetic:k.phonetic||'',zh:k.meaning_zh||'',sentence:sentenceFor(k.word.toLowerCase(),root),source:'reading',article:currentArticle&&currentArticle.date});
  return true;
}
$('articleBox').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b||!currentArticle) return;
  var kws=currentArticle.key_words||[];
  if(b.dataset.kwsay){ speak(b.dataset.kwsay); }
  else if(b.dataset.kwadd){
    var k=kws.find(function(x){return x.word===b.dataset.kwadd;});
    if(inVocab(k.word)){ toast('「'+k.word+'」已在生词本'); return; }
    addKeyWord(k); toast('已加入生词本，今天就会出现在复习里'); b.textContent='✓ 已在生词本'; b.classList.remove('primary');
  } else if(b.id==='btnAddAllKw'){
    var n=0; kws.forEach(function(k){ if(addKeyWord(k)) n++; });
    toast(n?'已加入 '+n+' 个重点词':'重点词都已在生词本'); renderArticle(currentArticle, articleIndex&&articleIndex[0]&&articleIndex[0].date===currentArticle.date);
  }
});
function renderArchive(idx, cur){
  $('archiveList').innerHTML = idx.map(function(e){
    return '<li><a href="#/read/'+esc(e.date)+'" class="'+(e.date===cur?'cur':'')+'"><span class="d">'+esc(e.date)+'</span><span>'+esc(e.title)+'</span></a></li>';
  }).join('') || '<li class="muted">暂无</li>';
}
ER.views.read = { show: function(arg){ showArticle(arg||null); } };

/* ========== 自己粘贴 ========== */
var src=$('src');
src.value = settings.text || SAMPLES.s1;
src.addEventListener('input',function(){settings.text=src.value;saveSettings();});
$('btnSample1').onclick=function(){src.value=SAMPLES.s1;settings.text=src.value;saveSettings();};
$('btnSample2').onclick=function(){src.value=SAMPLES.s2;settings.text=src.value;saveSettings();};
$('btnClear').onclick=function(){src.value='';settings.text='';saveSettings();src.focus();};
$('btnRead').onclick=function(){
  var t=src.value.trim();
  if(!t){ t=SAMPLES.s1; src.value=t; settings.text=t; saveSettings(); toast('未输入文章，已载入示例 1'); }
  renderReader(t,$('pasteReader')); showPasteRead(true);
};
$('btnEdit').onclick=function(){showPasteRead(false);};
function showPasteRead(on){ $('inputView').hidden=on; $('readView').hidden=!on; hidePop(); window.scrollTo(0,0); }
ER.views.paste = { show: function(){} };

/* ========== 生词本页面 ========== */
$('vocabFilter').oninput=renderVocab; $('vocabSort').onchange=renderVocab; $('vocabSrc').onchange=renderVocab;
var hideZh=false;
$('btnHideZh').onclick=function(){hideZh=!hideZh;this.textContent=hideZh?'显示中文':'遮住中文';renderVocab();};
function srsPill(v){
  var s=v.srs, t=today(); if(!s) return '';
  if(s.stage>=SRS.MAX_STAGE && s.due>t) return '<span class="stage done">已掌握 · '+s.due.slice(5)+' 抽查</span>';
  if(s.due<=t) return '<span class="stage due">'+SRS.stageLabel(s)+' · 今天复习</span>';
  return '<span class="stage">'+SRS.stageLabel(s)+' · '+s.due.slice(5)+' 复习</span>';
}
function renderVocab(){
  var q=$('vocabFilter').value.trim().toLowerCase();
  var list=vocab.slice();
  var sort=$('vocabSort').value, srcF=$('vocabSrc').value;
  if(sort==='new') list.reverse(); else if(sort==='az') list.sort(function(a,b){return a.word.localeCompare(b.word);});
  else if(sort==='due') list.sort(function(a,b){return a.srs.due<b.srs.due?-1:a.srs.due>b.srs.due?1:0;});
  if(srcF==='reading') list=list.filter(function(v){return v.source==='reading';});
  else if(srcF==='cet') list=list.filter(function(v){return /^cet/.test(v.source);});
  if(q) list=list.filter(function(v){return v.word.toLowerCase().indexOf(q)>=0||(v.zh||'').indexOf(q)>=0;});
  if(!list.length){$('vocabList').innerHTML='<p class="muted" style="text-align:center;margin:30px 0">'+(vocab.length?'没有匹配的生词':'生词本还是空的。<br>在阅读时查词，点击「加入生词本」即可收藏；复习页每天也会带你学新的四六级词。')+'</p>';return;}
  $('vocabList').innerHTML=list.map(function(v){
    var srcTag = v.source==='cet4'?'四级':v.source==='cet6'?'六级':'阅读';
    return '<div class="vitem'+(hideZh?' hide-zh':'')+'"><div class="top"><span class="vw">'+esc(v.word)+'</span><span class="pop-ipa">'+esc(ER.fmtIpa(v.phonetic))+'</span>'+srsPill(v)+
      '<span class="ops"><button data-say="'+esc(v.word)+'">🔊</button><button class="danger" data-del="'+esc(v.word)+'">删除</button></span></div>'+
      '<div class="vzh">'+esc(v.zh||'（无中文释义）')+'</div>'+
      (v.sentence?'<div class="vs">'+highlightIn(v.sentence,v)+'</div>':'')+
      '<div class="vd">'+esc(v.date||'')+' · 来源：'+srcTag+' · 已复习 '+(v.srs.reps||0)+' 次'+(v.srs.lapses?'，答错 '+v.srs.lapses+' 次':'')+'</div></div>';
  }).join('');
}
ER.renderVocab = renderVocab;
function highlightIn(sentence,v){
  var forms=[v.word.toLowerCase()].concat(v.forms||[]);
  return esc(sentence).replace(WORD_RE,function(m){var l=m.toLowerCase();var hit=forms.indexOf(l)>=0||candidates(l).some(function(c){return forms.indexOf(c)>=0;});return hit?'<b>'+m+'</b>':m;});
}
$('vocabList').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  if(b.dataset.del){ if(confirm('从生词本删除「'+b.dataset.del+'」？（复习进度也会删除）')){ ER.removeWord(b.dataset.del); renderVocab(); } }
  else if(b.dataset.say){ var v=ER.findWord(b.dataset.say); speak(b.dataset.say, v&&v.audio); }
});
function download(name, text, type){
  var blob=new Blob([text],{type:type});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);
}
$('btnExport').onclick=function(){
  if(!vocab.length){toast('生词本为空');return;}
  var rows=[['单词','音标','中文释义','英文释义','原句','日期','复习阶段','下次复习']];
  vocab.forEach(function(v){rows.push([v.word,v.phonetic||'',v.zh||'',v.en||'',v.sentence||'',v.date||'',v.srs.stage,v.srs.due]);});
  var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
  download('生词本_'+today()+'.csv','\ufeff'+csv,'text/csv;charset=utf-8');
  toast('已导出 '+vocab.length+' 个生词');
};
ER.views.vocab = { show: renderVocab };

/* ========== 备份：导出 / 导入 ========== */
ER.buildBackup = function(){
  var s=Object.assign({},settings); delete s.text;
  return {app:'english-reader',version:2,exportedAt:new Date().toISOString(),today:today(),
    data:{vocab:vocab, cetSeen:lsGet('er_cet_seen',{}), daily:lsGet('er_daily',{}), settings:s}};
};
ER.applyBackup = function(b, mode){
  if(!b||b.app!=='english-reader'||!b.data||!Array.isArray(b.data.vocab)) throw new Error('不是有效的备份文件');
  var t=today();
  var inc=b.data.vocab.filter(function(v){return v&&typeof v.word==='string'&&v.word;}).map(function(v){v.srs=SRS.normalize(v.srs,t);if(!v.source)v.source='reading';return v;});
  var seen=lsGet('er_cet_seen',{});
  if(mode==='replace'){
    vocab=inc; seen=b.data.cetSeen||{};
    if(b.data.settings){ Object.assign(settings,b.data.settings); saveSettings(); applySettingsUI(); }
    if(b.data.daily) lsSet('er_daily',b.data.daily);
  } else {
    var map={}; vocab.forEach(function(v){map[v.word.toLowerCase()]=v;});
    inc.forEach(function(v){
      var k=v.word.toLowerCase(), cur=map[k];
      if(!cur){ vocab.push(v); map[k]=v; return; }
      var newer = (v.srs.last||'') > (cur.srs.last||'') || ((v.srs.last||'')===(cur.srs.last||'') && (v.srs.reps||0)>(cur.srs.reps||0));
      if(newer){ var i=vocab.indexOf(cur); vocab[i]=v; map[k]=v; }
    });
    Object.keys(b.data.cetSeen||{}).forEach(function(k){ if(!seen[k]) seen[k]=b.data.cetSeen[k]; });
  }
  lsSet('er_cet_seen',seen);
  saveVocab();
  return vocab.length;
};
$('btnBackup').onclick=function(){
  download('雅思阅读器备份_'+today()+'.json', JSON.stringify(ER.buildBackup(),null,1), 'application/json');
  toast('已导出备份（'+vocab.length+' 个词）');
};
var importMode='merge';
$('btnImportMerge').onclick=function(){importMode='merge';$('importFile').value='';$('importFile').click();};
$('btnImportReplace').onclick=function(){
  if(!confirm('覆盖导入会用备份文件替换本机的生词本和复习进度，确定吗？')) return;
  importMode='replace';$('importFile').value='';$('importFile').click();
};
$('importFile').onchange=function(){
  var f=this.files&&this.files[0]; if(!f) return;
  var r=new FileReader();
  r.onload=function(){
    try{ var n=ER.applyBackup(JSON.parse(r.result), importMode); toast((importMode==='replace'?'已覆盖导入':'已合并导入')+'，生词本现有 '+n+' 个词'); renderVocab(); if(ER.views.review.refresh) ER.views.review.refresh(); }
    catch(e){ toast('导入失败：'+(e.message||e)); }
  };
  r.readAsText(f);
};

/* ========== 词形还原（简易） ========== */
function candidates(w){
  w=(w||'').toLowerCase().replace(/’/g,"'").replace(/^[^a-z]+|[^a-z]+$/g,'');
  var out=[w], add=function(x){if(x&&x.length>=2&&out.indexOf(x)<0)out.push(x);};
  var b=w.replace(/'s$|s'$/,''); add(b); w=b;
  var dbl=function(s){return s.length>2&&s[s.length-1]===s[s.length-2]&&!/[aeiouls]/.test(s[s.length-1])?s.slice(0,-1):null;};
  if(/ies$/.test(w)) add(w.slice(0,-3)+'y');
  if(/(ses|xes|zes|ches|shes|oes)$/.test(w)) add(w.slice(0,-2));
  if(/s$/.test(w)&&!/ss$/.test(w)) add(w.slice(0,-1));
  if(/ied$/.test(w)) add(w.slice(0,-3)+'y');
  if(/ed$/.test(w)){ var s=w.slice(0,-2); add(dbl(s)); add(s); add(w.slice(0,-1)); }
  if(/ing$/.test(w)){ var s2=w.slice(0,-3); add(dbl(s2)); add(s2); add(s2+'e'); if(/y$/.test(s2)) add(s2); }
  if(/ily$/.test(w)) add(w.slice(0,-3)+'y');
  if(/ly$/.test(w)){ add(w.slice(0,-2)); add(w.slice(0,-2)+'e'); if(/ally$/.test(w)) add(w.slice(0,-4)); if(/bly$/.test(w)) add(w.slice(0,-1)+'e'); }
  if(/ier$/.test(w)) add(w.slice(0,-3)+'y');
  if(/iest$/.test(w)) add(w.slice(0,-4)+'y');
  if(/er$/.test(w)){ add(dbl(w.slice(0,-2))); add(w.slice(0,-2)); add(w.slice(0,-1)); }
  if(/est$/.test(w)){ add(dbl(w.slice(0,-3))); add(w.slice(0,-3)); add(w.slice(0,-2)); }
  if(w.indexOf('-')>0) w.split('-').forEach(add);
  return out;
}
ER.candidates = candidates;

/* ========== 英文词典：Free Dictionary API → 维基词典 兜底 ========== */
var cache = lsGet('er_cache',{});
function cachePut(k,v){cache[k]=v;var ks=Object.keys(cache);if(ks.length>600){delete cache[ks[0]];}lsSet('er_cache',cache);}
var dictApiDown=false;
function fromDictApi(w){
  if(dictApiDown) return Promise.resolve(null);
  return fetchJson('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(w),7000).then(function(data){
    if(!Array.isArray(data)||!data.length) return null;
    var res={word:data[0].word||w,phonetic:'',audio:'',meanings:[],source:'Free Dictionary API'};
    var audios=[];
    data.forEach(function(e){
      if(!res.phonetic&&e.phonetic) res.phonetic=e.phonetic;
      (e.phonetics||[]).forEach(function(p){ if(!res.phonetic&&p.text) res.phonetic=p.text; if(p.audio) audios.push(p.audio); });
      (e.meanings||[]).forEach(function(m){
        res.meanings.push({pos:m.partOfSpeech,defs:(m.definitions||[]).slice(0,3).map(function(d){return {def:d.definition,ex:d.example||''};})});
      });
    });
    var pref = settings.accent==='en-GB'?/-uk\.|-gb\./:/-us\./;
    res.audio = audios.find(function(a){return pref.test(a);}) || audios[0] || '';
    if(res.audio && res.audio.indexOf('//')===0) res.audio='https:'+res.audio;
    res.audios=audios;
    return res.meanings.length?res:null;
  }).catch(function(e){
    if(e.status===404) return null;
    dictApiDown=true;
    return null;
  });
}
var POS_MAP={noun:'noun',verb:'verb',adjective:'adjective',adverb:'adverb',pronoun:'pronoun',preposition:'preposition',conjunction:'conjunction',interjection:'interjection',determiner:'determiner',article:'article',numeral:'numeral',particle:'particle',prefix:'prefix',suffix:'suffix',phrase:'phrase',idiom:'idiom',proverb:'proverb','proper noun':'proper noun'};
function fromWiktionary(w){
  return fetchJson('https://en.wiktionary.org/api/rest_v1/page/definition/'+encodeURIComponent(w)+'?redirect=true',9000).then(function(data){
    var en=data&&data.en; if(!en||!en.length) return null;
    var res={word:w,phonetic:'',audio:'',meanings:[],source:'Wiktionary',formOf:null};
    var formOnly=true;
    en.forEach(function(sec){
      var defs=[];
      (sec.definitions||[]).forEach(function(d){
        if(!d.definition) return;
        var isForm=/form-of-definition/.test(d.definition);
        if(isForm){ var m=d.definition.match(/form-of-definition-link[\s\S]*?href="\/wiki\/([^"#?]+)/); if(m&&!res.formOf) res.formOf=decodeURIComponent(m[1]).replace(/_/g,' '); }
        else formOnly=false;
        var t=stripHtml(d.definition); if(!t) return;
        defs.push({def:t,ex:(d.examples&&d.examples[0])?stripHtml(d.examples[0]):''});
      });
      if(defs.length) res.meanings.push({pos:(POS_MAP[(sec.partOfSpeech||'').toLowerCase()]||(sec.partOfSpeech||'').toLowerCase()),defs:defs.slice(0,3)});
    });
    if(!res.meanings.length) return null;
    res.formOnly=formOnly;
    return res;
  }).catch(function(){return null;});
}
function wiktExtras(w){
  return fetchJson('https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&prop=wikitext&redirects=1&page='+encodeURIComponent(w),9000).then(function(d){
    var t=d&&d.parse&&d.parse.wikitext; if(!t) return {};
    var i=t.indexOf('==English=='); if(i<0) return {}; t=t.slice(i);
    var j=t.slice(12).search(/\n==[^=]/); if(j>=0) t=t.slice(0,j+12);
    var ipas=[],m,re=/\{\{IPA\|en\|([^}]*)\}\}/g;
    while((m=re.exec(t))){ var parts=m[1].split('|'); var acc=(parts.filter(function(p){return /^a=/.test(p);})[0]||'').slice(2); parts.filter(function(p){return /^[\/\[]/.test(p);}).forEach(function(p){ipas.push({ipa:p,acc:acc});}); }
    var gbRe=/RP|UK|GB/, usRe=/GA|US/;
    var pick=function(rx){var x=ipas.find(function(p){return rx.test(p.acc);});return x&&x.ipa;};
    var phon = settings.accent==='en-GB'? (pick(gbRe)||pick(usRe)) : (pick(usRe)||pick(gbRe));
    phon = phon || (ipas[0]&&ipas[0].ipa) || '';
    var auds=[],ar=/\{\{audio\|en\|([^|}]+)/g; while((m=ar.exec(t))) auds.push(m[1].trim());
    var pa = settings.accent==='en-GB'? auds.find(function(a){return /^en-(uk|gb)/i.test(a);}) : auds.find(function(a){return /^en-us/i.test(a);});
    pa = pa || auds[0];
    var zh=[],zr=/\{\{t\+?\|cmn\|([^|}]+)/g; while((m=zr.exec(t))){ var z=m[1].replace(/\[\[|\]\]/g,'').trim(); if(z&&zh.indexOf(z)<0) zh.push(z); }
    return {phonetic:phon, audio: pa? 'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(pa.charAt(0).toUpperCase()+pa.slice(1)) : '', zh:zh.slice(0,6)};
  }).catch(function(){return {};});
}
function fromZhWiktionary(w){
  return fetchJson('https://zh.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&prop=text&redirects=1&variant=zh-cn&disableeditsection=1&disabletoc=1&page='+encodeURIComponent(w),9000).then(function(d){
    var h=d&&d.parse&&d.parse.text; if(!h) return null;
    var i=h.indexOf('id="英語"'); if(i<0) i=h.indexOf('id="英语"'); if(i<0) return null;
    var seg=h.slice(i); var j=seg.indexOf('<h2',10); if(j>0) seg=seg.slice(0,j);
    seg=seg.slice(seg.indexOf('>')+1);
    var doc=new DOMParser().parseFromString('<div>'+seg+'</div>','text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('style,script,audio,video,.k-player,sup,.IPA,.mw-heading,.NavHead'),function(n){n.remove();});
    var out=[];
    var skip=/國際音標|国际音标|韻部|韵部|斷字|断字|音頻|音频|發音|发音|正體|正体|繁體|繁体|本词条|本詞條|CC-CEDICT|Source|許可|许可|幫助|帮助/;
    Array.prototype.forEach.call(doc.querySelectorAll('p,li,dd'),function(n){
      if(n.querySelector('li')) return;
      var t=(n.textContent||'').replace(/\s+/g,' ').trim();
      if(!t||skip.test(t)) return;
      t=t.replace(/^\[?简体\]?\s*[:：]\s*/,'').replace(/^简体中文\s*[:：]\s*/,'').replace(/&quot;|"/g,'').replace(/\[[^\]]*\]/g,'').trim();
      var cjk=(t.match(/[\u4e00-\u9fff]/g)||[]).length;
      if(cjk<1||cjk<t.replace(/[\s，,；;、。.()（）]/g,'').length*0.5) return;
      if(t.length>40) t=t.slice(0,40)+'…';
      if(out.indexOf(t)<0) out.push(t);
    });
    if(!out.length) return null;
    var joined=[],len=0; out.forEach(function(t){ if(len<45&&joined.length<6){joined.push(t);len+=t.length;} });
    return joined.join('；');
  }).catch(function(){return null;});
}
function zhWithFallback(list){ var i=0; function next(){ if(i>=list.length||i>=3) return Promise.resolve(null); return fromZhWiktionary(list[i++]).then(function(r){return r||next();}); } return next(); }
var myMemoryQuotaOut=false;
function fromMyMemory(w){
  if(myMemoryQuotaOut) return Promise.resolve(null);
  var url='https://api.mymemory.translated.net/get?langpair=en|zh-CN&q='+encodeURIComponent(w)+(settings.email?'&de='+encodeURIComponent(settings.email):'');
  return fetchJson(url,9000).then(function(d){
    if(!d) return null;
    if(d.responseStatus==429||d.quotaFinished||/MYMEMORY WARNING/i.test((d.responseData&&d.responseData.translatedText)||'')){myMemoryQuotaOut=true;return null;}
    var list=[];
    var push=function(s){ if(!s) return; s=String(s).replace(/<[^>]+>/g,'').trim(); if(!/[\u4e00-\u9fff]/.test(s)) return; if(s.length>40) return; if(list.indexOf(s)<0) list.push(s); };
    push(d.responseData&&d.responseData.translatedText);
    (d.matches||[]).slice().sort(function(a,b){return (+b.quality||0)-(+a.quality||0);}).forEach(function(m){ if(m.segment&&m.segment.trim().toLowerCase()===w.toLowerCase()) push(m.translation); });
    return list.length? list.slice(0,4).join('；') : null;
  }).catch(function(e){ if(e.status===429) myMemoryQuotaOut=true; return null; });
}
function cetFor(list){ for(var i=0;i<list.length;i++){ var x=ER.cetLookup(list[i]); if(x) return x; } return null; }

/* ========== 综合查词 ========== */
function lookup(raw){
  var cands=candidates(raw);
  var key=cands[0];
  if(cache[key]) return Promise.resolve(cache[key]);
  var i=0, chosen=null;
  function tryNext(){
    if(i>=cands.length) return Promise.resolve(null);
    var c=cands[i++];
    return fromDictApi(c).then(function(r){ return r || fromWiktionary(c); }).then(function(r){
      if(!r) return tryNext();
      if(r.formOnly && r.formOf && r.formOf.toLowerCase()!==c){
        var formNote=r.meanings[0]&&r.meanings[0].defs[0]&&r.meanings[0].defs[0].def;
        var lem=r.formOf.toLowerCase();
        return fromDictApi(lem).then(function(x){return x||fromWiktionary(lem);}).then(function(x){
          if(x){ x.note=formNote; x.surface=raw; return x; } return r;
        });
      }
      return r;
    });
  }
  var cetP = loadAllCet();
  return Promise.all([tryNext(), cetP]).then(function(a){
    var r=a[0];
    if(!r){
      // 在线词典都没有结果：用内置四六级词库兜底
      var c=cetFor(cands); if(!c) return null;
      return {word:c.word,phonetic:ER.fmtIpa(c.phonetic),audio:'',meanings:c.ex?[{pos:'例句',defs:[{def:c.ex,ex:''}]}]:[],source:'内置四六级词库（在线词典暂不可用）',zhList:[{t:c.zh,src:'四六级词库'}],zh:c.zh};
    }
    chosen=r; var lemma=(r.word||key).toLowerCase();
    return Promise.all([ fromMyMemory(lemma), wiktExtras(lemma), zhWithFallback([lemma].concat(cands.filter(function(c){return c!==lemma;}))) ]).then(function(arr){
      var mm=arr[0], ex=arr[1]||{}, zw=arr[2];
      var cet=cetFor([lemma].concat(cands));
      if(!chosen.phonetic && ex.phonetic) chosen.phonetic=ex.phonetic;
      if(!chosen.phonetic && cet && cet.phonetic) chosen.phonetic=ER.fmtIpa(cet.phonetic);
      if(!chosen.audio && ex.audio) chosen.audio=ex.audio;
      chosen.zhList=[];
      if(cet) chosen.zhList.push({t:cet.zh,src:'四六级词库'});
      if(zw) chosen.zhList.push({t:zw,src:'中文维基词典'});
      if(mm) chosen.zhList.push({t:mm,src:'MyMemory 机器翻译'});
      if((!chosen.zhList.length || (!mm && !cet && zw && zw.length<6)) && ex.zh&&ex.zh.length && ex.zh.join('').indexOf(zw||'@@')<0) chosen.zhList.push({t:ex.zh.join('；'),src:'英文维基词典（可能为繁体）'});
      chosen.zh = chosen.zhList.length? chosen.zhList[0].t : '';
      if(!cet && zw&&mm&&mm.length<20&&zw.indexOf(mm.split('；')[0])<0) chosen.zh=zw+'；'+mm.split('；')[0];
      if(chosen.zh) cachePut(key,chosen);
      return chosen;
    });
  });
}
ER.lookup = lookup;

/* ========== 发音 ========== */
var audioEl=new Audio();
var speak = ER.speak = function(word,audioUrl){
  var fallbackUrl='https://dict.youdao.com/dictvoice?audio='+encodeURIComponent(word)+'&type='+(settings.accent==='en-GB'?1:2);
  var playUrl=function(u,onFail){
    try{ audioEl.pause(); audioEl.onerror=function(){onFail&&onFail();}; audioEl.src=u; var p=audioEl.play(); if(p&&p.catch) p.catch(function(){onFail&&onFail();}); }
    catch(e){onFail&&onFail();}
  };
  var tts=function(){
    if(!('speechSynthesis' in window)){ playUrl(fallbackUrl,function(){toast('此浏览器不支持发音');}); return; }
    try{
      speechSynthesis.cancel();
      var u=new SpeechSynthesisUtterance(word); u.lang=settings.accent; u.rate=0.9;
      var vs=speechSynthesis.getVoices(); var v=vs.find(function(x){return x.lang===settings.accent;})||vs.find(function(x){return x.lang&&x.lang.replace('_','-').indexOf(settings.accent)===0;});
      if(v) u.voice=v;
      else if(vs.length===0 && isTouch){ playUrl(fallbackUrl,null); return; }
      speechSynthesis.speak(u);
    }catch(e){toast('发音失败');}
  };
  if(audioUrl) playUrl(audioUrl,tts); else tts();
};
if('speechSynthesis' in window){ try{speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged=function(){};}catch(e){} }

/* ========== 弹窗 ========== */
var pop=$('pop'), activeSpan=null, current=null, reqId=0;
function hidePop(){pop.classList.remove('show');if(activeSpan)activeSpan.classList.remove('active');activeSpan=null;current=null;}
ER.hidePop = hidePop;
function placePop(span){
  var narrow=window.innerWidth<600;
  pop.classList.toggle('sheet',narrow);
  if(narrow){pop.style.left='';pop.style.top='';return;}
  var r=span.getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight;
  var left=r.left+window.scrollX+r.width/2-pw/2;
  left=Math.max(window.scrollX+10,Math.min(left,window.scrollX+document.documentElement.clientWidth-pw-10));
  var top=r.bottom+window.scrollY+8;
  if(r.bottom+ph+16>window.innerHeight && r.top-ph-8>0) top=r.top+window.scrollY-ph-8;
  pop.style.left=left+'px'; pop.style.top=top+'px';
}
function openFor(span){
  if(activeSpan)activeSpan.classList.remove('active');
  activeSpan=span; span.classList.add('active');
  var raw=span.getAttribute('data-w');
  var sentEl=span.closest('.sent'); var sentence=sentEl?sentEl.textContent.replace(/\s+/g,' ').trim():'';
  var my=++reqId;
  pop.innerHTML='<button class="pop-close" aria-label="关闭">×</button><div class="pop-head"><span class="pop-word">'+esc(span.textContent)+'</span></div><p class="muted"><span class="spinner"></span>查询中…</p>';
  pop.classList.add('show'); placePop(span);
  lookup(raw).then(function(r){
    if(my!==reqId) return;
    if(!r){
      pop.innerHTML='<button class="pop-close" aria-label="关闭">×</button><div class="pop-head"><span class="pop-word">'+esc(span.textContent)+'</span></div>'+
        '<p class="err">未找到该词的释义。可能是专有名词、拼写变体，或网络/词典服务暂时不可用。</p>'+
        '<div class="pop-actions"><button data-act="say">🔊 发音</button><button data-act="retry">重试</button></div>';
      current={word:raw,sentence:sentence,res:null};
      placePop(span); return;
    }
    current={word:(r.word||raw).toLowerCase(),surface:raw,sentence:sentence,res:r};
    renderPop(r); placePop(span);
    if(settings.auto) speak(r.word||raw,r.audio);
  }).catch(function(e){
    if(my!==reqId) return;
    pop.innerHTML='<button class="pop-close">×</button><p class="err">查询出错：'+esc(e.message||e)+'<br>请检查网络后重试。</p><div class="pop-actions"><button data-act="retry">重试</button></div>';
    current={word:raw,sentence:sentence,res:null};
  });
}
function renderPop(r){
  var saved=inVocab(current.word);
  var h='<button class="pop-close" aria-label="关闭">×</button>';
  h+='<div class="pop-head"><span class="pop-word">'+esc(r.word)+'</span><span class="pop-ipa">'+esc(r.phonetic||'')+'</span></div>';
  if(r.note && current.surface && current.surface!==r.word) h+='<div class="muted" style="font-size:13px">'+esc(current.surface)+'：'+esc(r.note)+'</div>';
  h+='<div class="pop-actions"><button data-act="say">🔊 发音</button><button data-act="add" class="'+(saved?'':'primary')+'">'+(saved?'✓ 已在生词本（点击移除）':'＋ 加入生词本')+'</button></div>';
  h+= (r.zhList&&r.zhList.length) ? r.zhList.map(function(z){return '<div class="zh">'+esc(z.t)+'<span class="src">'+esc(z.src)+'</span></div>';}).join('') : '<div class="err">中文释义暂不可用（翻译服务额度用完或网络问题），请参考英文释义。</div>';
  (r.meanings||[]).slice(0,4).forEach(function(m){
    m.defs.forEach(function(d,k){
      h+='<div class="def">'+(k===0?'<span class="pos">'+esc(m.pos)+'</span>':'<span style="display:inline-block;width:6px"></span>')+esc(d.def)+(d.ex?'<div class="ex">'+esc(d.ex)+'</div>':'')+'</div>';
    });
  });
  h+='<div class="muted" style="font-size:11px;margin-top:8px">英文释义：'+esc(r.source)+'</div>';
  pop.innerHTML=h;
}
pop.addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  if(b.classList.contains('pop-close')){hidePop();return;}
  var act=b.getAttribute('data-act');
  if(act==='say'){ speak(current.res?current.res.word:current.word, current.res&&current.res.audio); }
  else if(act==='retry'){ dictApiDown=false; myMemoryQuotaOut=false; if(activeSpan) openFor(activeSpan); }
  else if(act==='add'){
    var r=current.res; if(!r) return;
    if(inVocab(current.word)){ ER.removeWord(current.word); toast('已从生词本移除'); }
    else{
      var en=r.meanings&&r.meanings[0]&&r.meanings[0].defs[0]? r.meanings[0].pos+'. '+r.meanings[0].defs[0].def : '';
      ER.addWord({word:current.word,forms:current.surface&&current.surface!==current.word?[current.surface]:[],phonetic:r.phonetic||'',zh:r.zh||'',en:en,sentence:current.sentence,audio:r.audio||'',source:'reading',article:currentArticle&&$('articleReader')&&activeSpan&&activeSpan.closest('#articleReader')?currentArticle.date:undefined});
      toast('已加入生词本，今天就会出现在复习里');
    }
    renderPop(r);
  }
});

/* 事件：桌面双击；触屏轻点（对所有 .reader 生效） */
var lastPointer='mouse';
document.addEventListener('dblclick',function(e){
  var s=e.target.closest&&e.target.closest('.reader .w'); if(!s) return;
  e.preventDefault(); if(window.getSelection) window.getSelection().removeAllRanges();
  openFor(s);
});
document.addEventListener('pointerdown',function(e){lastPointer=e.pointerType||'mouse';},true);
document.addEventListener('touchstart',function(){lastPointer='touch';},{passive:true,capture:true});
document.addEventListener('click',function(e){
  var s=e.target.closest&&e.target.closest('.reader .w');
  if(s && lastPointer!=='mouse'){ openFor(s); return; }
  if(!pop.classList.contains('show')) return;
  if(pop.contains(e.target)||s) return;
  hidePop();
});
document.addEventListener('contextmenu',function(e){ var s=e.target.closest&&e.target.closest('.reader .w'); if(lastPointer!=='mouse'&&s){e.preventDefault();openFor(s);} });
document.addEventListener('keydown',function(e){if(e.key==='Escape'){hidePop();$('settingsPanel').hidden=true;}});
window.addEventListener('resize',function(){if(activeSpan&&pop.classList.contains('show'))placePop(activeSpan);});

/* ========== 路由 ========== */
function route(){
  var h=(location.hash||'').replace(/^#\/?/,'');
  var parts=h.split('/'); var tab=parts[0]||'read'; var arg=parts[1]||'';
  if(!ER.views[tab]){ tab='read'; arg=''; }
  hidePop();
  ['read','review','vocab','paste'].forEach(function(t){ $('view-'+t).hidden = t!==tab; });
  Array.prototype.forEach.call(document.querySelectorAll('#tabs a'),function(a){a.classList.toggle('on',a.dataset.tab===tab);});
  ER.currentTab=tab;
  ER.views[tab].show(arg);
}
ER.start = function(){
  window.addEventListener('hashchange',route);
  updateBadge();
  route();
};
// 跨标签页同步（同一浏览器多个窗口）
window.addEventListener('storage',function(e){ if(e.key==='er_vocab'){ loadVocab(); updateCount(); updateBadge(); refreshHighlights(); } });
})();
