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
var lsSet = ER.lsSet = function(k,v,quiet){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){if(!quiet)toast('本地存储已满或不可用，数据可能未保存');return false;}};
function lsRaw(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function fetchJson(url,ms,opts){
  var ctl = ('AbortController' in window)? new AbortController():null;
  var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, ms||9000);
  var o = opts? Object.assign({}, opts):{}; if(ctl) o.signal=ctl.signal;
  return fetch(url, o).then(function(r){
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
function settingsSig(){ var o=Object.assign({},settings); delete o.text; return JSON.stringify(o); }
var lastSettingsSig = settingsSig();
var saveSettings = ER.saveSettings = function(noStamp){
  lsSet('er_settings',settings);
  var sg=settingsSig();
  if(sg!==lastSettingsSig){ lastSettingsSig=sg; if(!noStamp) lsSet('er_settings_at',Date.now(),true); if(ER.syncSoon) ER.syncSoon(); }
};
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

/* ========== 生词本数据 ==========
 * 每条：{word, type:'word'|'phrase', zh, phonetic, en, sentence, note, forms, date, source, srs, …}
 * 短语 / 短句与单词共用同一套结构和复习进度；旧数据没有 type 字段时按是否含空格自动判断。 */
var vocab = [];
var VKEY='er_vocab', BKEY='er_vocab_backup', BKEY_PREV='er_vocab_backup_prev', CKEY='er_vocab_corrupt';
var lastRaw = null;        // 本页面最后一次读取 / 写入的 er_vocab 原文，用来发现别的标签页（或从后退缓存恢复的旧页面）写过数据
var TKEY='er_vocab_deleted';   // 删除记录（墓碑）：{规范化词: 删除时间戳}，用于多标签页 / 多设备同步时不把删掉的词找回来
var allowEmptyOnce = false;
var keyOf = ER.keyOf = function(s){ return String(s==null?'':s).toLowerCase().replace(/[’‘`]/g,"'").replace(/[^\p{L}\p{N}'\- ]+/gu,' ').replace(/\s+/g,' ').trim(); };
var isPhraseText = ER.isPhraseText = function(s){ return /\s/.test(String(s||'').trim()); };
function fixType(v){ if(v.type!=='word'&&v.type!=='phrase') v.type=isPhraseText(v.word)?'phrase':'word'; return v; }
function cleanList(list){
  var t=today();
  return (Array.isArray(list)?list:[]).filter(function(v){return v&&typeof v.word==='string'&&v.word;}).map(function(v){
    v.srs = SRS.normalize(v.srs, t); if(!v.source) v.source='reading'; if(!v.date) v.date=t; return fixType(v);
  });
}
/* 读取 er_vocab；解析失败时把原文另存到 er_vocab_corrupt，绝不直接丢掉 */
function readStored(raw){
  if(raw==null) return [];
  try{ var v=JSON.parse(raw); if(Array.isArray(v)) return v; }catch(e){}
  try{ if(!localStorage.getItem(CKEY)) localStorage.setItem(CKEY, raw); }catch(e){}
  return null;
}
function loadVocab(){
  var raw=lsRaw(VKEY), list=readStored(raw);
  vocab = cleanList(list||[]);
  lastRaw = raw;
}
loadVocab();
ER.getVocab = function(){return vocab;};
ER.findWord = function(w){var k=keyOf(w);if(!k)return undefined;return vocab.find(function(v){return v.word.toLowerCase()===String(w).toLowerCase()||keyOf(v.word)===k;});};
/* 每条词都有 updatedAt（毫秒时间戳；旧数据没有 = 0）。合并规则：按规范化的词对齐，并集；两边都有取 updatedAt 新的
 * （相同再比复习进度）；墓碑时间 ≥ 词的 updatedAt 则视为已删除。 */
function newerSrs(a,b){ return (a.srs.last||'') > (b.srs.last||'') || ((a.srs.last||'')===(b.srs.last||'') && (a.srs.reps||0)>(b.srs.reps||0)); }
function newerItem(a,b){ var ua=a.updatedAt||0, ub=b.updatedAt||0; return ua!==ub ? ua>ub : newerSrs(a,b); }
var getTombs = ER.getTombs = function(){ var t=lsGet(TKEY,{}); return (t&&typeof t==='object'&&!Array.isArray(t))?t:{}; };
function mergeTombs(a,b){ var o=Object.assign({},a); Object.keys(b||{}).forEach(function(k){ if(!(o[k]>=b[k])) o[k]=+b[k]||0; }); return o; }
function mergeLists(base, other){
  var out=base.slice(), map={}; out.forEach(function(v,i){ map[keyOf(v.word)]=i; });
  cleanList(other).forEach(function(v){
    if(v.updatedAt==null) v.updatedAt=0;
    var k=keyOf(v.word);
    if(map[k]==null){ out.push(v); map[k]=out.length-1; }
    else if(newerItem(v, out[map[k]])) out[map[k]]=v;
  });
  return out;
}
function applyTombs(list, tombs){ return list.filter(function(v){ var d=tombs[keyOf(v.word)]; return !(d && d>=(v.updatedAt||0)); }); }
function itemSig(v){ var o=Object.assign({},v); delete o.updatedAt; return JSON.stringify(o); }
/* 和本页上次读到 / 写入的版本比较：内容变了的词打上新的 updatedAt */
function stampChanged(){
  var prev={}, now=Date.now();
  cleanList(readStored(lastRaw)||[]).forEach(function(p){ prev[keyOf(p.word)]=p; });
  vocab.forEach(function(v){
    var p=prev[keyOf(v.word)];
    if(!p){ if(v.updatedAt==null) v.updatedAt=now; }
    else if((v.updatedAt||0)===(p.updatedAt||0) && itemSig(v)!==itemSig(p)) v.updatedAt=now;
  });
}
var saveVocab = ER.saveVocab = function(opt){
  var raw=lsRaw(VKEY);
  stampChanged();
  var tombs=getTombs();
  if(opt&&opt.tombs) tombs=mergeTombs(tombs,opt.tombs);
  if(raw!==lastRaw){
    // 另一个标签页 / 另一个页面实例在我们之后写过：先合并，避免用旧数据覆盖新数据
    var other=readStored(raw); if(other&&other.length) vocab=mergeLists(vocab, other);
  }
  vocab=applyTombs(vocab, tombs);
  if(opt&&opt.tombs) lsSet(TKEY,tombs,true);
  if(!vocab.length && !allowEmptyOnce){
    var cur=readStored(raw);
    if(cur===null || cur.length){ console.warn('拒绝用空生词本覆盖已有数据'); afterVocabChange(); return false; }
  }
  allowEmptyOnce=false;
  var json=JSON.stringify(vocab), ok=false;
  try{ localStorage.setItem(VKEY,json); ok=true; }catch(e){
    // 存储满了：先清掉可再生的查词缓存再试一次
    try{ localStorage.removeItem('er_cache'); cache={}; localStorage.setItem(VKEY,json); ok=true; }catch(e2){}
  }
  if(ok){ lastRaw=json; if(vocab.length) snapshot(json); if(ER.syncSoon&&!(opt&&opt.fromSync)) ER.syncSoon(); }
  else toast('本地存储已满或不可用，生词本未保存！请尽快导出备份');
  afterVocabChange();
  return ok;
};
function afterVocabChange(){ updateCount(); refreshHighlights(); updateBadge(); }
/* 自动备份：er_vocab_backup = 最近一次非空的生词本；跨天时把旧的那份挪到 er_vocab_backup_prev */
function snapshot(json){
  var t=today(), cur=lsGet(BKEY,null);
  if(cur && cur.date && cur.date!==t && cur.n) lsSet(BKEY_PREV,cur,true);
  try{ localStorage.setItem(BKEY,'{"date":'+JSON.stringify(t)+',"at":'+JSON.stringify(new Date().toISOString())+',"n":'+vocab.length+',"vocab":'+json+'}'); }catch(e){}
}
ER.autoBackups = function(){
  var out=[];
  [BKEY,BKEY_PREV].forEach(function(k){ var b=lsGet(k,null); if(b&&Array.isArray(b.vocab)&&b.vocab.length) out.push({key:k,date:b.date,at:b.at,n:b.vocab.length,vocab:b.vocab}); });
  var c=lsRaw(CKEY); if(c){ try{ var cv=JSON.parse(c); if(Array.isArray(cv)&&cv.length) out.push({key:CKEY,n:cv.length,vocab:cv}); }catch(e){} }
  out.sort(function(a,b){ return b.n-a.n; });
  return out;
};
ER.restoreAutoBackup = function(){
  var b=ER.autoBackups()[0]; if(!b) return 0;
  vocab=mergeLists(vocab, b.vocab);
  // 恢复是用户的明确操作：清掉这些词的删除记录
  var tb=getTombs(); b.vocab.forEach(function(v){ if(v&&v.word){ delete tb[keyOf(v.word)]; } }); lsSet(TKEY,tb,true);
  vocab.forEach(function(v){ v.updatedAt=Date.now(); });
  saveVocab(); return vocab.length;
};
/* 从后退缓存恢复 / 切回标签页时，如果别处改过生词本就重新读取，避免内存里的旧数据 */
function resync(){ if(lsRaw(VKEY)!==lastRaw){ loadVocab(); afterVocabChange(); if(ER.currentTab==='vocab') renderVocab(); } }
window.addEventListener('pageshow',function(e){ if(e.persisted) resync(); });
document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') resync(); });
ER.addWord = function(item){
  if(ER.findWord(item.word)) return ER.findWord(item.word);
  var t=today();
  var v=Object.assign({word:'',forms:[],phonetic:'',zh:'',en:'',sentence:'',date:t,audio:'',source:'reading'},item);
  v.word=String(v.word).replace(/\s+/g,' ').trim(); fixType(v); v.srs=SRS.init(t); v.updatedAt=Date.now();
  vocab.push(v); saveVocab(); return v;
};
ER.removeWord = function(w){ var tb={}; tb[keyOf(w)]=Date.now(); vocab=vocab.filter(function(v){return v.word!==w;}); allowEmptyOnce=true; saveVocab({tombs:tb}); };
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
  highlightPhrases();
}
/* 已收藏的短语：在文中连续匹配的单词上加 .ph（同一段落内，忽略中间的标点） */
function phraseTokens(s){ return String(s||'').toLowerCase().replace(/’/g,"'").match(WORD_RE)||[]; }
function highlightPhrases(){
  var phrases=vocab.filter(function(v){return v.type==='phrase';}).map(function(v){return phraseTokens(v.word);}).filter(function(t){return t.length>1;});
  var blocks=document.querySelectorAll('.reader p, .reader h2');
  for(var b=0;b<blocks.length;b++){
    var sp=blocks[b].querySelectorAll('.w'), ws=[];
    for(var i=0;i<sp.length;i++){ sp[i].classList.remove('ph','ph-s','ph-e'); ws.push(sp[i].getAttribute('data-w')); }
    phrases.forEach(function(tk){
      for(var i=0;i+tk.length<=ws.length;i++){
        if(ws[i]!==tk[0]) continue;
        var ok=true; for(var j=1;j<tk.length;j++){ if(ws[i+j]!==tk[j]){ok=false;break;} }
        if(!ok) continue;
        for(var j2=0;j2<tk.length;j2++) sp[i+j2].classList.add('ph');
        sp[i].classList.add('ph-s'); sp[i+tk.length-1].classList.add('ph-e');
      }
    });
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
var READ_HINT='双击 / 轻点单词查词 · 拖选多个词（手机：长按后拖动选择柄）可收藏短语或短句 · <span class="hl-sample">黄色</span> = 生词本中的词 · <span class="ph-sample">绿色下划线</span> = 已收藏的短语';
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
  h+='<p class="hint">'+READ_HINT+'</p></div>';
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
  else if(srcF==='manual') list=list.filter(function(v){return v.source==='manual';});
  else if(srcF==='phrase') list=list.filter(function(v){return v.type==='phrase';});
  else if(srcF==='word') list=list.filter(function(v){return v.type!=='phrase';});
  if(q) list=list.filter(function(v){return v.word.toLowerCase().indexOf(q)>=0||(v.zh||'').indexOf(q)>=0||(v.note||'').toLowerCase().indexOf(q)>=0;});
  if(!list.length){
    var bk=!vocab.length&&ER.autoBackups()[0];
    $('vocabList').innerHTML='<p class="muted" style="text-align:center;margin:30px 0">'+(vocab.length?'没有匹配的生词':'生词本还是空的。<br>在阅读时查词，点击「加入生词本」即可收藏；复习页每天也会带你学新的四六级词。')+'</p>'+
      (bk?'<div class="restore-box" id="restoreBox"><p>发现本机的自动备份：<b>'+bk.n+'</b> 条'+(bk.at?'（保存于 '+esc(new Date(bk.at).toLocaleString('zh-CN'))+'）':'')+'</p><button class="primary" id="btnRestoreAuto">♻️ 从自动备份恢复</button></div>':'');
    var rb=$('btnRestoreAuto'); if(rb) rb.onclick=function(){ var n=ER.restoreAutoBackup(); toast('已从自动备份恢复，生词本现有 '+n+' 条'); renderVocab(); if(ER.views.review.refresh) ER.views.review.refresh(); };
    return;
  }
  $('vocabList').innerHTML=list.map(function(v){
    var srcTag = v.source==='cet4'?'四级':v.source==='cet6'?'六级':v.source==='manual'?'手动添加':'阅读';
    var ph=v.type==='phrase';
    return '<div class="vitem'+(ph?' is-phrase':'')+(hideZh?' hide-zh':'')+'" data-key="'+esc(v.word)+'"><div class="top">'+(ph?'<span class="ptag">短语</span>':'')+'<span class="vw">'+esc(v.word)+'</span><span class="pop-ipa">'+esc(ER.fmtIpa(v.phonetic))+'</span>'+srsPill(v)+
      '<span class="ops"><button data-say="'+esc(v.word)+'" title="发音">🔊</button><button data-edit="'+esc(v.word)+'" title="修改中文意思">✏️</button><button class="danger" data-del="'+esc(v.word)+'">删除</button></span></div>'+
      '<div class="vzh">'+esc(v.zh||'（无中文释义）')+'</div>'+
      (v.sentence?'<div class="vs">'+highlightIn(v.sentence,v)+'</div>':'')+
      (v.note?'<div class="vnote">📝 '+esc(v.note)+'</div>':'')+
      '<div class="vd">'+esc(v.date||'')+' · 来源：'+srcTag+' · 已复习 '+(v.srs.reps||0)+' 次'+(v.srs.lapses?'，答错 '+v.srs.lapses+' 次':'')+'</div></div>';
  }).join('');
}
ER.renderVocab = renderVocab;
function highlightIn(sentence,v){
  if(v.type==='phrase'||isPhraseText(v.word)){
    var tk=String(v.word).match(WORD_RE)||[];
    if(tk.length){
      var re=new RegExp(tk.map(function(t){return t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/'/g,"['’]");}).join("[^A-Za-z0-9]+"),'i');
      var m=re.exec(sentence);
      if(m) return esc(sentence.slice(0,m.index))+'<b>'+esc(m[0])+'</b>'+esc(sentence.slice(m.index+m[0].length));
    }
    return esc(sentence);
  }
  var forms=[v.word.toLowerCase()].concat(v.forms||[]);
  return esc(sentence).replace(WORD_RE,function(m){var l=m.toLowerCase();var hit=forms.indexOf(l)>=0||candidates(l).some(function(c){return forms.indexOf(c)>=0;});return hit?'<b>'+m+'</b>':m;});
}
$('vocabList').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  if(b.dataset.del){ if(confirm('从生词本删除「'+b.dataset.del+'」？（复习进度也会删除）')){ ER.removeWord(b.dataset.del); renderVocab(); } }
  else if(b.dataset.say){ var v=ER.findWord(b.dataset.say); speak(b.dataset.say, v&&v.audio); }
  else if(b.dataset.edit){
    var item=b.closest('.vitem'), ve=ER.findWord(b.dataset.edit); if(!item||!ve) return;
    var z=item.querySelector('.vzh'); if(item.querySelector('.vedit')) return;
    z.outerHTML='<div class="vedit"><textarea class="vedit-zh" rows="2" placeholder="中文意思">'+esc(ve.zh||'')+'</textarea>'+
      '<div class="row" style="margin-top:4px"><button class="primary" data-save="'+esc(ve.word)+'">保存</button><button data-cancel="1">取消</button></div></div>';
    var ta=item.querySelector('.vedit-zh'); try{ta.focus();ta.select();}catch(err){}
  }
  else if(b.dataset.save){
    var vs=ER.findWord(b.dataset.save), val=b.closest('.vitem').querySelector('.vedit-zh').value.replace(/\s+/g,' ').trim();
    if(!val){ toast('中文意思不能为空'); return; }
    if(vs){ vs.zh=val; saveVocab(); toast('已保存中文意思'); }
    renderVocab();
  }
  else if(b.dataset.cancel){ renderVocab(); }
});
function download(name, text, type){
  var blob=new Blob([text],{type:type});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);
}
$('btnExport').onclick=function(){
  if(!vocab.length){toast('生词本为空');return;}
  var rows=[['单词/短语','类型','音标','中文释义','英文释义','原句','备注','日期','复习阶段','下次复习']];
  vocab.forEach(function(v){rows.push([v.word,v.type==='phrase'?'短语':'单词',v.phonetic||'',v.zh||'',v.en||'',v.sentence||'',v.note||'',v.date||'',v.srs.stage,v.srs.due]);});
  var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
  download('生词本_'+today()+'.csv','\ufeff'+csv,'text/csv;charset=utf-8');
  toast('已导出 '+vocab.length+' 条');
};
ER.views.vocab = { show: renderVocab };

/* 手动添加：英文单词 / 短语 + 中文（可自动翻译）+ 备注 */
var manLook=null;   // 自动翻译单词时顺带拿到的音标 / 发音
$('manTrans').onclick=function(){
  var en=$('manEn').value.replace(/\s+/g,' ').trim(); if(!en){ toast('先输入英文'); $('manEn').focus(); return; }
  var st=$('manStatus'), btn=this; btn.disabled=true; st.className='hint'; st.innerHTML='<span class="spinner"></span>翻译中…';
  ER.translate(en).then(function(r){
    btn.disabled=false;
    if($('manEn').value.replace(/\s+/g,' ').trim()!==en) { st.textContent=''; return; }
    if(r&&r.zh){ $('manZh').value=r.zh; manLook={en:en,phonetic:r.phonetic||'',audio:r.audio||''}; st.textContent='来源：'+(r.src||'自动翻译')+'（可修改）'; }
    else { st.className='err'; st.textContent='自动翻译暂不可用，请自己填写中文意思'; }
  });
};
$('manSay').onclick=function(){ var en=$('manEn').value.trim(); if(en) speak(en); };
$('manAdd').onclick=function(){
  var en=$('manEn').value.replace(/\s+/g,' ').trim(), zh=$('manZh').value.replace(/\s+/g,' ').trim(), note=$('manNote').value.trim();
  var n=(en.match(WORD_RE)||[]).length;
  if(!en||!n){ toast('请输入英文单词或短语'); $('manEn').focus(); return; }
  if(n>MAX_PHRASE_WORDS){ toast('太长了（'+n+' 个词），请控制在 '+MAX_PHRASE_WORDS+' 个词以内'); return; }
  if(!zh){ toast('请填写中文意思（或点「自动翻译」）'); $('manZh').focus(); return; }
  var ex=ER.findWord(en);
  if(ex){ toast('「'+ex.word+'」已在生词本，可在列表里点 ✏️ 修改中文'); return; }
  var lk=manLook&&manLook.en===en?manLook:{};
  ER.addWord({word:en,type:isPhraseText(en)?'phrase':'word',zh:zh,note:note,phonetic:lk.phonetic||'',audio:lk.audio||'',source:'manual'});
  $('manEn').value=''; $('manZh').value=''; $('manNote').value=''; $('manStatus').textContent=''; manLook=null;
  toast('已加入生词本，今天就会出现在复习里'); renderVocab();
};

/* ========== 备份：导出 / 导入 ========== */
ER.buildBackup = function(){
  var s=Object.assign({},settings); delete s.text;
  return {app:'english-reader',version:2,exportedAt:new Date().toISOString(),today:today(),
    data:{vocab:vocab, cetSeen:lsGet('er_cet_seen',{}), daily:lsGet('er_daily',{}), settings:s}};
};
ER.applyBackup = function(b, mode){
  if(!b||b.app!=='english-reader'||!b.data||!Array.isArray(b.data.vocab)) throw new Error('不是有效的备份文件');
  var t=today();
  var inc=b.data.vocab.filter(function(v){return v&&typeof v.word==='string'&&v.word;}).map(function(v){v.srs=SRS.normalize(v.srs,t);if(!v.source)v.source='reading';return fixType(v);});
  var seen=lsGet('er_cet_seen',{}), applyOpt=null;
  if(mode==='replace'){
    var keep={}, now=Date.now(), tbr={}; inc.forEach(function(v){ keep[keyOf(v.word)]=1; v.updatedAt=now; });
    vocab.forEach(function(v){ var k=keyOf(v.word); if(!keep[k]) tbr[k]=now; });
    var tb0=getTombs(); Object.keys(keep).forEach(function(k){ delete tb0[k]; }); lsSet(TKEY,tb0,true);
    vocab=inc; allowEmptyOnce=true; lastRaw=lsRaw(VKEY); seen=b.data.cetSeen||{};
    applyOpt={tombs:tbr};
    if(b.data.settings){ Object.assign(settings,b.data.settings); saveSettings(); applySettingsUI(); }
    if(b.data.daily) lsSet('er_daily',b.data.daily);
  } else {
    var map={}; vocab.forEach(function(v){map[keyOf(v.word)]=v;});
    inc.forEach(function(v){
      var k=keyOf(v.word), cur=map[k];
      if(!cur){ vocab.push(v); map[k]=v; return; }
      var newer = (v.srs.last||'') > (cur.srs.last||'') || ((v.srs.last||'')===(cur.srs.last||'') && (v.srs.reps||0)>(cur.srs.reps||0));
      if(newer){ var i=vocab.indexOf(cur); vocab[i]=v; map[k]=v; }
    });
    Object.keys(b.data.cetSeen||{}).forEach(function(k){ if(!seen[k]) seen[k]=b.data.cetSeen[k]; });
  }
  lsSet('er_cet_seen',seen);
  saveVocab(applyOpt);
  return vocab.length;
};
$('btnBackup').onclick=function(){
  download('雅思阅读器备份_'+today()+'.json', JSON.stringify(ER.buildBackup(),null,1), 'application/json');
  toast('已导出备份（'+vocab.length+' 条）');
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
    try{ var n=ER.applyBackup(JSON.parse(r.result), importMode); toast((importMode==='replace'?'已覆盖导入':'已合并导入')+'，生词本现有 '+n+' 条'); renderVocab(); if(ER.views.review.refresh) ER.views.review.refresh(); }
    catch(e){ toast('导入失败：'+(e.message||e)); }
  };
  r.readAsText(f);
};
/* ========== 同步用：导出 / 合并整份学习数据 ========== */
function mergeDaily(a,b){ a=a||{}; b=b||{}; if(!b.date) return a; if(!a.date||b.date>a.date) return {date:b.date,newDone:+b.newDone||0}; if(b.date===a.date) return {date:a.date,newDone:Math.max(+a.newDone||0,+b.newDone||0)}; return a; }
ER.syncState = function(){
  var s=Object.assign({},settings); delete s.text;
  return {app:'english-reader',format:1,vocab:vocab,tombstones:getTombs(),daily:lsGet('er_daily',{}),cetSeen:lsGet('er_cet_seen',{}),settings:s,settingsAt:+lsGet('er_settings_at',0)||0};
};
/* 把远端数据并入本机（只增不丢），返回合并后的整份数据 */
ER.mergeRemoteState = function(r){
  if(!r||r.app!=='english-reader') return ER.syncState();
  var tombs=mergeTombs(getTombs(), r.tombstones||{});
  if(Array.isArray(r.vocab)) vocab=mergeLists(vocab, r.vocab);
  saveVocab({tombs:tombs, fromSync:true});
  var d=mergeDaily(lsGet('er_daily',{}), r.daily); lsSet('er_daily',d,true);
  var seen=lsGet('er_cet_seen',{}); Object.keys(r.cetSeen||{}).forEach(function(k){ if(!seen[k]) seen[k]=r.cetSeen[k]; }); lsSet('er_cet_seen',seen,true);
  var la=+lsGet('er_settings_at',0)||0;
  if(r.settings && (+r.settingsAt||0)>la){
    var keepText=settings.text; Object.assign(settings,r.settings); settings.text=keepText;
    lsSet('er_settings',settings,true); lsSet('er_settings_at',+r.settingsAt,true); lastSettingsSig=settingsSig(); applySettingsUI();
  }
  if(ER.currentTab==='vocab') renderVocab();
  if(ER.views.review&&ER.views.review.refresh) ER.views.review.refresh();
  return ER.syncState();
};

/* 备份码：复制 / 粘贴文本，适合手机（不用下载文件） */
$('btnCopyCode').onclick=function(){
  var ta=$('backupCode'); ta.value=JSON.stringify(ER.buildBackup()); ta.hidden=false;
  try{ ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); }catch(e){}
  var done=function(){ toast('备份码已复制（'+vocab.length+' 条），粘贴到备忘录 / 微信文件传输助手保存'); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done,function(){ try{document.execCommand('copy');}catch(e){} toast('已选中备份码，请手动复制'); });
  else { try{document.execCommand('copy'); done();}catch(e){ toast('已选中备份码，请手动复制'); } }
};
$('btnPasteImport').onclick=function(){
  var ta=$('backupCode');
  if(ta.hidden||!ta.value.trim()){ ta.hidden=false; ta.value=''; ta.placeholder='把备份码粘贴到这里，然后再点一次「粘贴备份码导入」'; ta.focus(); return; }
  try{ var n=ER.applyBackup(JSON.parse(ta.value.trim()),'merge'); toast('已合并导入，生词本现有 '+n+' 条'); ta.value=''; ta.hidden=true; renderVocab(); if(ER.views.review.refresh) ER.views.review.refresh(); }
  catch(e){ toast('导入失败：备份码不完整或格式不对'); }
};
$('btnGoBackup').onclick=function(){ var c=$('backupCard'); if(c) c.scrollIntoView({behavior:'smooth',block:'start'}); };
/* 请求浏览器持久保存本站数据（不会被自动清理） */
function updatePersistHint(on){ var el=$('persistHint'); if(el) el.textContent = on? '✓ 浏览器已允许持久保存本站数据。' : '浏览器未授予持久存储；清理浏览数据、无痕窗口或关闭浏览器时清除站点数据都会删掉生词本，请定期备份。'; }
ER.requestPersist = function(){
  try{
    if(navigator.storage&&navigator.storage.persist){
      return navigator.storage.persisted().then(function(p){ return p||navigator.storage.persist(); }).then(function(p){ updatePersistHint(!!p); return !!p; }).catch(function(){ updatePersistHint(false); return false; });
    }
  }catch(e){}
  updatePersistHint(false); return Promise.resolve(false);
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
/* 短语 / 句子翻译：依次尝试多个免 key、支持 CORS 的机器翻译（每个最多等 5 秒），成功结果缓存在 er_cache
   顺序：有道（国内可直连）→ MyMemory → Google（国内通常连不上，放最后） */
function decodeEntities(t){ try{ return new DOMParser().parseFromString('<!doctype html><body>'+t,'text/html').body.textContent||''; }catch(e){ return t; } }
var TR_TIMEOUT=5000, trDown={};
function cleanZh(t){ t=decodeEntities(String(t||'')).replace(/\s+/g,' ').trim(); return (/[\u4e00-\u9fff]/.test(t)&&t.length<=300)? t:null; }
var TRANSLATORS=[
  {id:'youdao',src:'有道机器翻译',run:function(text){
    return fetchJson('https://aidemo.youdao.com/trans',TR_TIMEOUT,{method:'POST',body:new URLSearchParams({q:text,from:'en',to:'zh-CHS'})}).then(function(d){
      return d&&String(d.errorCode)==='0'&&d.translation? cleanZh([].concat(d.translation).join('')) : null; });
  }},
  {id:'mymemory',src:'MyMemory 机器翻译',run:function(text){
    if(myMemoryQuotaOut) return Promise.resolve(null);
    var url='https://api.mymemory.translated.net/get?langpair=en|zh-CN&q='+encodeURIComponent(text)+(settings.email?'&de='+encodeURIComponent(settings.email):'');
    return fetchJson(url,TR_TIMEOUT).then(function(d){
      var t=d&&d.responseData&&d.responseData.translatedText;
      if(!d) return null;
      if(d.responseStatus==429||d.quotaFinished||/MYMEMORY WARNING/i.test(t||'')){ myMemoryQuotaOut=true; return null; }
      return cleanZh(t);
    },function(e){ if(e.status===429) myMemoryQuotaOut=true; throw e; });
  }},
  {id:'google',src:'Google 机器翻译',run:function(text){
    return fetchJson('https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=zh-CN&q='+encodeURIComponent(text),TR_TIMEOUT).then(function(d){
      if(!Array.isArray(d)) return null;
      return cleanZh(d.map(function(x){ return Array.isArray(x)? x[0] : x; }).join(''));
    });
  }}
];
ER.TRANSLATORS = TRANSLATORS;
function translateText(text){
  var k='t:'+keyOf(text);
  if(cache[k]) return Promise.resolve(cache[k]);
  var i=0;
  function next(){
    if(i>=TRANSLATORS.length) return Promise.resolve(null);
    var t=TRANSLATORS[i++];
    if(trDown[t.id]&&Date.now()-trDown[t.id]<10*60*1000) return next();   // 连不上的服务 10 分钟内先跳过
    return t.run(text).then(function(zh){
      delete trDown[t.id];
      if(!zh) return next();
      var out={zh:zh,src:t.src}; cachePut(k,out); return out;
    },function(e){ if(e&&(e.network||e.name==='AbortError'||e.status>=500)) trDown[t.id]=Date.now(); return next(); });
  }
  return next();
}
function resetTranslators(){ trDown={}; myMemoryQuotaOut=false; }

/* 本文短语表 / 重点词：在线翻译之前先查（忽略大小写和标点；选区包含或被包含于某个短语也给出提示） */
function phNorm(s){ return keyOf(s).replace(/-/g,' ').replace(/'/g,'').replace(/\s+/g,' ').trim(); }
function phLoose(s){ return phNorm(s).split(' ').map(function(w){ return w.length>3? w.replace(/(ies|es|s)$/,''):w; }).join(' '); }
function glossaryFor(art){
  if(!art) return [];
  var out=[];
  (Array.isArray(art.phrases)?art.phrases:[]).forEach(function(p){ if(p&&p.text&&p.meaning_zh) out.push({text:String(p.text),zh:String(p.meaning_zh),src:'本文短语表'}); });
  (Array.isArray(art.key_words)?art.key_words:[]).forEach(function(k){ if(k&&k.word&&k.meaning_zh) out.push({text:String(k.word),zh:String(k.meaning_zh),src:'本文重点词'}); });
  return out;
}
function glossaryMatch(text, art){
  var g=glossaryFor(art), n=phNorm(text), l=phLoose(text), res={exact:null,related:[]};
  if(!n) return res;
  var pad=function(s){ return ' '+s+' '; };
  for(var i=0;i<g.length;i++){ var gn=phNorm(g[i].text), gl=phLoose(g[i].text);
    if(gn===n||gl===l){ if(!res.exact) res.exact=g[i]; continue; }
    if(gn.indexOf(' ')<0&&n.indexOf(' ')>=0) continue;   // 单个重点词只用于逐词提示，不当作相关短语
    if(pad(l).indexOf(pad(gl))>=0||pad(gl).indexOf(pad(l))>=0) res.related.push(g[i]);
  }
  res.related=res.related.slice(0,4);
  return res;
}
ER.glossaryMatch = function(text){ return glossaryMatch(text, currentArticle); };

/* 整句翻译失败时，给出逐词中文意思作参考（本文重点词 → 四六级词库 → 查词缓存 → 在线查词） */
var HINT_STOP={a:1,an:1,the:1,of:1,to:1,in:1,on:1,at:1,and:1,or:1,for:1,with:1,by:1,is:1,are:1,was:1,were:1,be:1,been:1,it:1,its:1,'this':1,that:1,as:1,from:1,but:1,not:1};
function wordHints(text, art){
  var words=[]; (String(text).match(/[A-Za-z][A-Za-z'’-]*/g)||[]).forEach(function(w){ var lw=w.toLowerCase().replace(/’/g,"'"); if(!HINT_STOP[lw]&&words.indexOf(lw)<0) words.push(lw); });
  words=words.slice(0,8);
  var kw={}; ((art&&art.key_words)||[]).forEach(function(k){ if(k&&k.word&&k.meaning_zh) kw[String(k.word).toLowerCase()]=k.meaning_zh; });
  return loadAllCet().then(function(){
    return Promise.all(words.map(function(w){
      var cands=candidates(w);
      for(var i=0;i<cands.length;i++){ if(kw[cands[i]]) return {w:w,zh:kw[cands[i]]}; }
      var c=cetFor(cands); if(c&&c.zh) return {w:w,zh:c.zh};
      if(cache[cands[0]]&&cache[cands[0]].zh) return {w:w,zh:cache[cands[0]].zh};
      return lookup(w).then(function(r){ return {w:w,zh:r&&r.zh||''}; },function(){ return {w:w,zh:''}; });
    }));
  }).then(function(list){ return list.filter(function(x){ return x.zh; }).map(function(x){ return {w:x.w,zh:String(x.zh).split(/[；;]/).slice(0,2).join('；')}; }); });
}
/* 单词走完整查词链（四六级词库 / 维基词典 / MyMemory），短语走 MyMemory */
ER.translate = function(text){
  text=String(text||'').replace(/\s+/g,' ').trim();
  if(!text) return Promise.resolve(null);
  if(isPhraseText(text)) return translateText(text);
  return lookup(text).then(function(r){
    if(r&&r.zh) return {zh:r.zh,src:(r.zhList&&r.zhList[0]&&r.zhList[0].src)||'',phonetic:r.phonetic||'',audio:r.audio||''};
    return translateText(text);
  },function(){ return translateText(text); });
};
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
var pop=$('pop'), activeSpan=null, activeRange=null, current=null, reqId=0;
var MAX_PHRASE_WORDS=20;
function hidePop(){pop.classList.remove('show','phrase');document.body.classList.remove('sheet-open');if(activeSpan)activeSpan.classList.remove('active');activeSpan=null;activeRange=null;current=null;}
ER.hidePop = hidePop;
function placePop(span){
  var narrow=window.innerWidth<600;
  pop.classList.toggle('sheet',narrow);
  if(narrow){pop.style.left='';pop.style.top='';return;}
  var r=span.getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight;   // span: 元素或 Range
  var left=r.left+window.scrollX+r.width/2-pw/2;
  left=Math.max(window.scrollX+10,Math.min(left,window.scrollX+document.documentElement.clientWidth-pw-10));
  var top=r.bottom+window.scrollY+8;
  if(r.bottom+ph+16>window.innerHeight && r.top-ph-8>0) top=r.top+window.scrollY-ph-8;
  pop.style.left=left+'px'; pop.style.top=top+'px';
}
function openFor(span){
  if(activeSpan)activeSpan.classList.remove('active');
  activeRange=null; pop.classList.remove('phrase'); document.body.classList.remove('sheet-open');
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
  else if(act==='retry'){ dictApiDown=false; resetTranslators(); if(activeSpan) openFor(activeSpan); }
  else if(act==='psay'){ speak(current.word); }
  else if(act==='ptrans'){ resetTranslators(); translatePhrasePop(); }
  else if(act==='puse'&&current&&current.phrase&&current.related){ var gx=current.related[+b.getAttribute('data-i')]; if(gx){ current.zh=gx.zh; current.src=gx.src+'：'+gx.text; current.dirty=true; renderPhrasePop(); var sv0=ER.findWord(current.word); if(sv0){ sv0.zh=gx.zh; saveVocab(); } } }
  else if(act==='padd'){
    var sv=ER.findWord(current.word);
    if(sv){ ER.removeWord(sv.word); toast('已从生词本移除'); }
    else{
      var zh=(current.zh||'').replace(/\s+/g,' ').trim();
      if(!zh){ toast('请先填写中文意思'); var ta=$('phraseZh'); if(ta) ta.focus(); return; }
      ER.addWord({word:current.word,type:'phrase',zh:zh,sentence:current.sentence,source:'reading',article:current.article});
      toast('已加入生词本，今天就会出现在复习里');
    }
    renderPhrasePop();
  }
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

/* ========== 短语 / 短句：选中多个词 ========== */
function wSpan(n){ var e=n&&(n.nodeType===1?n:n.parentElement); return e&&e.closest?e.closest('.reader .w'):null; }
function readerOf(n){ var e=n&&(n.nodeType===1?n:n.parentElement); return e&&e.closest?e.closest('.reader'):null; }
/* 把选区扩展到完整单词（桌面拖选常常只选到半个词） */
function snapRange(r0){
  var r=r0.cloneRange(), sw=wSpan(r.startContainer), ew=wSpan(r.endContainer);
  if(sw){ if(r.startContainer.nodeType===3&&r.startOffset>=r.startContainer.length&&sw!==ew) r.setStartAfter(sw); else r.setStartBefore(sw); }
  if(ew){ if(r.endContainer.nodeType===3&&r.endOffset===0&&sw!==ew) r.setEndBefore(ew); else r.setEndAfter(ew); }
  return r;
}
function cleanSel(t){ return String(t||'').replace(/\s+/g,' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').trim(); }
function sentencesFor(r, reader){
  var out=[], ss=reader.querySelectorAll('.sent');
  for(var i=0;i<ss.length;i++){ if(r.intersectsNode(ss[i])) out.push(ss[i].textContent.replace(/\s+/g,' ').trim()); }
  return out.join(' ');
}
function openPhrase(text, n, sentence, range, reader){
  if(activeSpan) activeSpan.classList.remove('active'); activeSpan=null;
  activeRange=range; ++reqId;
  var saved=ER.findWord(text);
  current={phrase:true,word:text,n:n,sentence:sentence,zh:saved?saved.zh||'':'',src:saved?'生词本':'',tooLong:n>MAX_PHRASE_WORDS,
    loading:false,failed:false,dirty:false,article:currentArticle&&reader.id==='articleReader'?currentArticle.date:undefined,related:[],hints:null};
  var gm=current.article? glossaryMatch(text, currentArticle) : {exact:null,related:[]};
  current.related=gm.related;
  if(gm.exact&&!saved){ current.zh=gm.exact.zh; current.src=gm.exact.src; current.glossary=true; }
  renderPhrasePop();
  pop.classList.add('show','phrase'); placePop(range);
  if(pop.classList.contains('sheet')) keepAboveSheet(range);
  if(!current.tooLong && !saved && !current.glossary) translatePhrasePop();
}
function translatePhrasePop(){
  var c=current; if(!c||!c.phrase) return;
  var my=++reqId; c.loading=true; c.failed=false; renderPhrasePop();
  translateText(c.word).then(function(t){
    if(my!==reqId||current!==c) return;
    c.loading=false;
    if(t){ c.src=t.src; if(!c.dirty) c.zh=t.zh; renderPhrasePop(); return; }
    c.failed=true; renderPhrasePop();
    var art=c.article&&currentArticle&&currentArticle.date===c.article? currentArticle : null;
    wordHints(c.word, art).then(function(h){ if(current!==c) return; c.hints=h; renderPhrasePop(); });
  });
}
function renderPhrasePop(){
  var c=current; if(!c||!c.phrase) return;
  var h='<button class="pop-close" aria-label="关闭">×</button><div class="pop-kind">短语 / 短句 · '+c.n+' 个词</div>';
  if(c.tooLong){
    h+='<div class="pop-phrase">'+esc(c.word.split(' ').slice(0,MAX_PHRASE_WORDS).join(' '))+' …</div>'+
       '<p class="err">选中的内容太长（'+c.n+' 个词）。短语 / 短句请控制在 '+MAX_PHRASE_WORDS+' 个词以内——拖动选择柄缩短选区即可。</p>';
    pop.innerHTML=h; return;
  }
  var saved=ER.findWord(c.word);
  var focused=document.activeElement&&document.activeElement.id==='phraseZh';
  h+='<div class="pop-phrase" id="phraseText">'+esc(c.word)+'</div>';
  h+='<div class="pop-actions"><button data-act="psay">🔊 朗读</button><button data-act="padd" class="'+(saved?'':'primary')+'">'+(saved?'✓ 已在生词本（点击移除）':'＋ 加入生词本')+'</button></div>';
  h+='<label class="pz-label" for="phraseZh">中文意思'+(c.src?'<span class="src">'+esc(c.src)+(saved?'':'，可修改')+'</span>':'')+'</label>';
  h+='<textarea id="phraseZh" rows="2" placeholder="'+(c.loading?'正在翻译…':'在这里输入 / 修改中文意思')+'">'+esc(c.zh)+'</textarea>';
  h+='<div id="phraseStatus" class="pz-status '+(c.failed?'err':'muted')+'">'+(c.loading?'<span class="spinner"></span>正在自动翻译…':c.failed?'在线翻译暂时连不上（已试有道、MyMemory、Google），请参考下面的逐词意思自己填写。<button data-act="ptrans">重试翻译</button>':(saved?'修改后自动保存':''))+'</div>';
  if(c.related&&c.related.length) h+='<div id="phraseRelated" class="pz-hint"><b>本文相关短语：</b>'+c.related.map(function(g,i){ return '<span class="pz-gl">'+esc(g.text)+' = '+esc(g.zh)+' <button data-act="puse" data-i="'+i+'">用这个</button></span>'; }).join('')+'</div>';
  if(c.failed&&c.hints) h+='<div id="phraseHint" class="pz-hint"><b>逐词意思（仅供参考）：</b>'+(c.hints.length? c.hints.map(function(x){ return '<span class="pz-wd">'+esc(x.w)+' '+esc(x.zh)+'</span>'; }).join(' · ') : '没查到')+'</div>';
  if(c.sentence) h+='<div class="pz-sent">'+highlightIn(c.sentence,{word:c.word,type:'phrase'})+'</div>';
  pop.innerHTML=h;
  if(focused){ var ta=$('phraseZh'); if(ta) try{ta.focus();}catch(e){} }
}
pop.addEventListener('input',function(e){ if(e.target.id==='phraseZh'&&current&&current.phrase){ current.zh=e.target.value; current.dirty=true; } });
pop.addEventListener('change',function(e){
  if(e.target.id!=='phraseZh'||!current||!current.phrase) return;
  var sv=ER.findWord(current.word), z=e.target.value.replace(/\s+/g,' ').trim();
  if(sv&&z&&z!==sv.zh){ sv.zh=z; saveVocab(); toast('已更新中文意思'); }
});
/* 手机底部弹层：如果选区会被弹层挡住，把页面往上滚一点 */
function keepAboveSheet(range){
  document.body.classList.add('sheet-open');
  try{
    var r=range.getBoundingClientRect(), limit=window.innerHeight-pop.offsetHeight-16;
    if(r.bottom>limit) window.scrollBy(0, r.bottom-limit);
  }catch(e){}
}
var selTimer=null, touching=false, touchT=0, mouseDown=false, lastSelKey='';
function scheduleSel(ms){ clearTimeout(selTimer); selTimer=setTimeout(checkSelection, ms); }
function checkSelection(){
  if(mouseDown) return;
  // 手指还按着（长按 / 拖动选择柄）就先不弹；有的浏览器拖动选择柄时不发 touchend，所以 3 秒后不再等
  if(touching && Date.now()-touchT<3000){ scheduleSel(400); return; }
  var sel=window.getSelection&&window.getSelection();
  if(!sel||!sel.rangeCount||sel.isCollapsed){ lastSelKey=''; return; }
  var r0=sel.getRangeAt(0), reader=readerOf(r0.startContainer);
  if(!reader||reader!==readerOf(r0.endContainer)) return;
  var r=snapRange(r0), text=cleanSel(r.toString()), words=text.match(WORD_RE)||[];
  if(!words.length) return;
  var key=(words.length>1?'p:':'w:')+text;
  if(key===lastSelKey && pop.classList.contains('show')) return;
  lastSelKey=key;
  if(words.length===1){
    // 单个词：桌面上和以前一样什么都不做（双击查词）；触屏长按选中一个词 → 查词弹窗
    if(lastPointer==='mouse') return;
    var sp=reader.querySelectorAll('.w'), hit=null;
    for(var i=0;i<sp.length;i++){ if(r.intersectsNode(sp[i])&&cleanSel(sp[i].textContent)){ hit=sp[i]; break; } }
    if(hit && hit!==activeSpan) openFor(hit);
    return;
  }
  openPhrase(text, words.length, sentencesFor(r,reader), r, reader);
}
document.addEventListener('selectionchange',function(){ if(mouseDown) return; scheduleSel(lastPointer==='mouse'?350:600); });
document.addEventListener('mousedown',function(e){ if(e.button===0 && !(pop.contains(e.target))) mouseDown=true; },true);
document.addEventListener('mouseup',function(){ if(!mouseDown) return; mouseDown=false; scheduleSel(30); },true);
document.addEventListener('touchend',function(){ touching=false; scheduleSel(450); },{passive:true,capture:true});
document.addEventListener('touchcancel',function(){ touching=false; scheduleSel(450); },{passive:true,capture:true});

/* 事件：桌面双击；触屏轻点（对所有 .reader 生效） */
var lastPointer='mouse';
document.addEventListener('dblclick',function(e){
  var s=e.target.closest&&e.target.closest('.reader .w'); if(!s) return;
  e.preventDefault(); if(window.getSelection) window.getSelection().removeAllRanges();
  openFor(s);
});
document.addEventListener('pointerdown',function(e){lastPointer=e.pointerType||'mouse';},true);
document.addEventListener('touchstart',function(){lastPointer='touch';touching=true;touchT=Date.now();},{passive:true,capture:true});
document.addEventListener('click',function(e){
  var s=e.target.closest&&e.target.closest('.reader .w');
  if(s && lastPointer!=='mouse'){ openFor(s); return; }
  if(!pop.classList.contains('show')) return;
  if(pop.contains(e.target)||s) return;
  // 刚拖选完（click 紧跟在 mouseup 之后）时不要关掉短语弹窗
  if(current&&current.phrase){ var sl=window.getSelection(); if(sl&&!sl.isCollapsed&&readerOf(sl.anchorNode)) return; }
  hidePop();
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){hidePop();$('settingsPanel').hidden=true;}});
window.addEventListener('resize',function(){ if(!pop.classList.contains('show')) return; if(activeSpan) placePop(activeSpan); else if(activeRange) placePop(activeRange); });

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
  ER.requestPersist();
  updateBadge();
  route();
};
// 跨标签页同步（同一浏览器多个窗口）
window.addEventListener('storage',function(e){ if(e.key===VKEY || e.key===null){ loadVocab(); updateCount(); updateBadge(); refreshHighlights(); if(ER.currentTab==='vocab') renderVocab(); } });
})();
