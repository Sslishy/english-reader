/* ✍️ 翻译练习：每段下面写自己的中文译文 → 提交 → DeepSeek 批改（用户自己的 API 密钥）。
 * 密钥只存在本机 localStorage（er_ds_key），不进 gist 同步、不进备份、不打印到控制台。
 * 草稿和最近一次批改存在 er_tr：{"日期#段号": {text, fb, fbFor, fbAt, updatedAt}}，随 GitHub 同步逐条合并（updatedAt 新的优先）。 */
(function(){
'use strict';
var ER = window.ER, $ = ER.$, esc = ER.esc;
var KEY_LS = 'er_ds_key', TR_LS = 'er_tr';
var API = 'https://api.deepseek.com';
var MODEL = 'deepseek-chat', MAX_TOKENS = 900;
ER.DS_TIMEOUT = 60000;           // 60 秒内没有收到任何数据就算超时（流式输出时每收到一段就重新计时）

/* ---------- 密钥（仅本机） ---------- */
function getKey(){ try{ return (localStorage.getItem(KEY_LS)||'').trim(); }catch(e){ return ''; } }
function setKey(k){ try{ if(k) localStorage.setItem(KEY_LS,k); else localStorage.removeItem(KEY_LS); return true; }catch(e){ return false; } }
function maskKey(k){ return k ? (k.slice(0,3)+'…'+k.slice(-4)) : ''; }

/* ---------- 草稿 / 批改存储 ---------- */
function load(){ var o=ER.lsGet(TR_LS,{}); return (o&&typeof o==='object'&&!Array.isArray(o))?o:{}; }
var store = load();
function save(){ ER.lsSet(TR_LS, store); }
function idOf(date,i){ return date+'#'+i; }
function entry(date,i){ return store[idOf(date,i)]||null; }
function update(date,i,patch){
  var id=idOf(date,i), cur=Object.assign({text:'',fb:'',fbFor:'',fbAt:0}, store[id]||{}, patch);
  cur.updatedAt=Math.max(Date.now(), (store[id]&&store[id].updatedAt||0)+1);
  store[id]=cur; save(); if(ER.syncSoon) ER.syncSoon();
  return cur;
}
function validItem(v){ return v&&typeof v==='object'&&typeof (v.text==null?'':v.text)==='string'; }
ER.getTranslations = function(){ return store; };
/* 合并别处（gist / 备份）来的译文：逐条，updatedAt 新的优先；返回本机是否有变化 */
ER.mergeTranslations = function(other){
  if(!other||typeof other!=='object'||Array.isArray(other)) return false;
  var changed=false;
  Object.keys(other).forEach(function(id){
    var v=other[id]; if(!/^\d{4}-\d{2}-\d{2}#\d+$/.test(id)||!validItem(v)) return;
    var cur=store[id];
    if(!cur || (+v.updatedAt||0) > (+cur.updatedAt||0)){ store[id]=v; changed=true; }
  });
  if(changed){ save(); refreshOpen(); }
  return changed;
};
window.addEventListener('storage',function(e){ if(e.key===TR_LS||e.key===null){ store=load(); refreshOpen(); } });

/* ---------- 安全的简易 Markdown（先整体转义，再只加我们自己的标签） ---------- */
function inline(s){
  return s.replace(/`([^`]+)`/g,'<code>$1</code>')
          .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
          .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g,'$1<em>$2</em>');
}
function md(src){
  var lines=String(src||'').replace(/\r/g,'').split('\n'), out=[], list=null, para=[], quote=[];
  function flushPara(){ if(para.length){ out.push('<p>'+para.map(inline).join('<br>')+'</p>'); para=[]; } }
  function flushList(){ if(list){ out.push('<'+list.t+'>'+list.items.map(function(x){return '<li>'+inline(x)+'</li>';}).join('')+'</'+list.t+'>'); list=null; } }
  function flushQuote(){ if(quote.length){ out.push('<blockquote>'+quote.map(inline).join('<br>')+'</blockquote>'); quote=[]; } }
  function flushAll(){ flushPara(); flushList(); flushQuote(); }
  lines.forEach(function(raw){
    var l=esc(raw), t=l.trim(), m;
    if(!t){ flushAll(); return; }
    if((m=t.match(/^#{1,6}\s+(.*)$/))){ flushAll(); out.push('<h4>'+inline(m[1])+'</h4>'); return; }
    if(/^(-{3,}|\*{3,}|_{3,})$/.test(t)){ flushAll(); out.push('<hr>'); return; }
    if((m=t.match(/^&gt;\s?(.*)$/))){ flushPara(); flushList(); quote.push(m[1]); return; }
    flushQuote();
    if((m=t.match(/^[-*•]\s+(.*)$/))){ flushPara(); if(!list||list.t!=='ul'){ flushList(); list={t:'ul',items:[]}; } list.items.push(m[1]); return; }
    if((m=t.match(/^\d+[.)、]\s*(.*)$/))){ flushPara(); if(!list||list.t!=='ol'){ flushList(); list={t:'ol',items:[]}; } list.items.push(m[1]); return; }
    if(list && /^\s{2,}/.test(raw)){ list.items[list.items.length-1]+=' '+t; return; }
    flushList(); para.push(t);
  });
  flushAll();
  return out.join('');
}
ER.renderMarkdown = md;

/* ---------- 提示词 ---------- */
var SYSTEM = [
'你是一位耐心、严谨的英汉翻译老师。学生是中文母语者，英语大约大学英语四级水平，正在备考雅思（目标 6.5 分）。',
'学生会给你一段英文原文和他自己写的中文译文（可能还附有一份参考译文，只给你做判断用）。请用简体中文批改，语气鼓励但要准确、具体。',
'',
'批改重点（按重要性）：1) 意思错误或理解错误（尤其是主语 / 代词指代、被省略的主语、否定、比例和倍数如 one in three、twice as likely as、数字和单位）；2) 漏译、多译；3) 中文语序和句子结构（英文长句、后置定语、从句、插入语在中文里怎么拆、怎么调整顺序）；4) 关键词和搭配的准确译法；5) 中文是否通顺自然。标点、个别字词的小问题可以合并简单提一句。',
'',
'严格按下面的 Markdown 格式输出，不要输出其他内容：',
'## 总评',
'一两句话：先具体肯定做得好的地方，再点出最主要的问题。',
'## 逐句点评',
'只挑有问题的句子，按原文顺序，每处这样写：',
'> 引用有问题的英文原句（原文照抄）',
'- **问题**：引用学生的译法，说明错在哪里（误译 / 漏译 / 语序 / 用词 / 指代……）',
'- **怎么译**：讲清这句的结构（主干是什么、从句或修饰成分修饰谁）、中文里该怎么调整语序，以及关键词在这里的意思',
'- **改为**：这一句更好的译法',
'如果所有句子都译得准确，就写“没有明显错误”，再挑一处可以更地道的地方说明。',
'## 参考译文',
'整段的通顺、准确的中文译文。',
'## 小结',
'1–3 条可以用到别的句子上的翻译技巧或关键搭配，每条一行。',
'',
'注意：',
'- 不要说“请对照参考译文”这类话，必须自己把问题和改法讲清楚。参考译文只是一种译法：学生意思准确、只是说法不同，不算错误，不要扣分。',
'- 学生只翻译了一部分时，指出漏掉的是哪几句，但只点评他翻译了的部分；译文为空或与原文无关时，简短提醒后直接给出讲解和参考译文。',
'- 全部内容控制在 700 字以内，不要寒暄，不要重复原文全文。'
].join('\n');
function userMsg(en, ref, mine){
  return '【英文原文】\n'+en+'\n\n'+(ref?'【参考译文（仅供你判断对错，不要让学生自己去对照）】\n'+ref+'\n\n':'')+'【学生译文】\n'+mine;
}
ER.practicePrompt = {system:SYSTEM, user:userMsg};

/* ---------- 调用 DeepSeek ---------- */
function dsError(status, body){
  var e=new Error('HTTP '+status); e.status=status; e.body=body||''; return e;
}
function errText(e){
  if(e.noKey) return '还没有填写 DeepSeek API 密钥：点右上角 ⚙️ 设置 → 「DeepSeek 翻译批改」粘贴密钥。';
  if(e.status===401) return 'DeepSeek 密钥无效（401）：请检查是否复制完整，或在 platform.deepseek.com 重新创建一个密钥。';
  if(e.status===402) return 'DeepSeek 账户余额不足（402）：请到 platform.deepseek.com 充值后再试。';
  if(e.status===429) return '请求太频繁（429），DeepSeek 暂时限流了，请等半分钟再提交。';
  if(e.status===400||e.status===422) return '请求格式有误（'+e.status+'），请刷新页面后重试。';
  if(e.status>=500) return 'DeepSeek 服务器繁忙（'+e.status+'），请稍后再试。';
  if(e.timeout) return '等待 DeepSeek 回复超时（60 秒没有响应），可能是网络慢或服务繁忙，请重试。';
  if(e.network) return '网络连接失败，连不上 DeepSeek（api.deepseek.com），请检查网络后重试。';
  if(e.empty) return 'DeepSeek 没有返回内容，请重试。';
  return '批改失败：'+(e.message||e);
}
ER.dsErrText = errText;
/* 发送请求；onDelta(全部已收到文本) 用于流式显示；返回 Promise<{text, truncated}> */
function callDeepSeek(messages, onDelta, ctl){
  var key=getKey();
  if(!key){ var ne=new Error('no key'); ne.noKey=true; return Promise.reject(ne); }
  var canStream = !!(window.ReadableStream && window.TextDecoder && 'body' in Response.prototype);
  var timer=null, timedOut=false;
  function arm(){ clearTimeout(timer); timer=setTimeout(function(){ timedOut=true; try{ ctl.abort(); }catch(e){} }, ER.DS_TIMEOUT); }
  arm();
  var body={model:MODEL, messages:messages, max_tokens:MAX_TOKENS, temperature:0.5, stream:canStream};
  return fetch(API+'/chat/completions', {method:'POST', signal:ctl.signal, cache:'no-store',
      headers:{'Authorization':'Bearer '+key, 'Content-Type':'application/json'}, body:JSON.stringify(body)})
  .then(function(r){
    arm();
    if(!r.ok) return r.text().catch(function(){return '';}).then(function(t){ throw dsError(r.status,t); });
    var ct=r.headers.get('content-type')||'';
    if(!canStream || !r.body || ct.indexOf('event-stream')<0){
      return r.json().then(function(j){
        var c=j&&j.choices&&j.choices[0];
        return {text:(c&&c.message&&c.message.content)||'', truncated:!!(c&&c.finish_reason==='length')};
      });
    }
    var reader=r.body.getReader(), dec=new TextDecoder('utf-8'), buf='', text='', truncated=false;
    function handle(line){
      line=line.trim(); if(line.indexOf('data:')!==0) return;
      var d=line.slice(5).trim(); if(!d||d==='[DONE]') return;
      var j; try{ j=JSON.parse(d); }catch(e){ return; }
      var c=j.choices&&j.choices[0]; if(!c) return;
      if(c.delta&&typeof c.delta.content==='string'){ text+=c.delta.content; if(onDelta) onDelta(text); }
      if(c.finish_reason==='length') truncated=true;
    }
    function pump(){
      return reader.read().then(function(res){
        arm();
        if(res.done){ buf+=dec.decode(); buf.split('\n').forEach(handle); return {text:text, truncated:truncated}; }
        buf+=dec.decode(res.value,{stream:true});
        var parts=buf.split('\n'); buf=parts.pop(); parts.forEach(handle);
        return pump();
      });
    }
    return pump();
  }).then(function(res){
    clearTimeout(timer);
    if(!res.text.trim()){ var e=new Error('empty'); e.empty=true; throw e; }
    return res;
  }, function(e){
    clearTimeout(timer);
    if(e&&e.status) throw e;
    if(e&&e.empty) throw e;
    var x=new Error(timedOut?'timeout':(e&&e.name==='AbortError'?'aborted':'network'));
    x.timeout=timedOut; x.aborted=!timedOut&&e&&e.name==='AbortError'; x.network=!timedOut&&!x.aborted;
    throw x;
  });
}
ER.callDeepSeek = callDeepSeek;

/* ---------- 界面：每段的「我来翻译」 ---------- */
var openSet={}, busy={};   // openSet[id]=true 表示该段练习框展开；busy[id]=AbortController
function curArt(){ return ER.currentArticle&&ER.currentArticle(); }
ER.practiceButton = function(a,i){
  var e=entry(a.date,i), has=e&&(e.text||e.fb), on=!!openSet[idOf(a.date,i)];
  return '<button type="button" class="tp-btn'+(has?' has':'')+'" data-tp="'+i+'" aria-controls="tp'+i+'" aria-expanded="'+(on?'true':'false')+'" title="自己翻译这一段，提交后由 AI 批改">我来翻译</button>';
};
ER.practiceBox = function(a,i){
  var id=idOf(a.date,i), e=entry(a.date,i)||{}, on=!!openSet[id];
  return '<div class="tp" id="tp'+i+'" data-i="'+i+'"'+(on?'':' hidden')+'>'+
    '<label class="tp-label" for="tpIn'+i+'">✍️ 我的译文 · 第 '+(i+1)+' 段</label>'+
    '<textarea class="tp-in" id="tpIn'+i+'" data-i="'+i+'" rows="3" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="先自己把上面这段英文翻成中文（不用一次写完，会自动保存），写好后点「提交」让 AI 批改。">'+esc(e.text||'')+'</textarea>'+
    '<div class="tp-row"><button type="button" class="primary tp-send" data-tpsend="'+i+'">提交</button>'+
    '<button type="button" class="tp-stop" data-tpstop="'+i+'" hidden>停止</button>'+
    '<span class="tp-st hint" id="tpSt'+i+'" aria-live="polite">'+statusFor(e)+'</span></div>'+
    '<div class="tp-err err" id="tpErr'+i+'" hidden></div>'+
    '<div class="tp-fb" id="tpFb'+i+'"'+(e.fb?'':' hidden')+'>'+fbHtml(e)+'</div>'+
  '</div>';
};
function statusFor(e){
  if(!e||!e.text) return '自动保存在本机'+(syncOn()?'，并同步到 GitHub':'');
  return '草稿已保存';
}
function syncOn(){ try{ return !!localStorage.getItem('er_sync_token'); }catch(e){ return false; } }
function fbHtml(e){
  if(!e||!e.fb) return '';
  var stale = e.fbFor!=null && e.fbFor!==e.text;
  return '<div class="tp-fb-head">🤖 AI 批改'+(e.fbAt?' · '+esc(fmt(e.fbAt)):'')+(stale?' <span class="tp-stale">（针对上次提交的版本，改完可再提交）</span>':'')+'</div>'+
         '<div class="tp-md">'+md(e.fb)+'</div>'+(e.truncated?'<p class="hint">（回复较长，末尾被截断了）</p>':'');
}
function fmt(ms){ try{ return new Date(ms).toLocaleString('zh-CN',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
function grow(ta){ if(!ta) return; ta.style.height='auto'; ta.style.height=Math.min(Math.max(ta.scrollHeight+2, 84), 600)+'px'; }
ER.practiceAfterRender = function(){
  Array.prototype.forEach.call(document.querySelectorAll('#articleReader .tp:not([hidden]) .tp-in'), grow);
};
function setOpen(i,on){
  var a=curArt(); if(!a) return;
  var id=idOf(a.date,i), box=$('tp'+i), b=document.querySelector('#articleReader .tp-btn[data-tp="'+i+'"]');
  if(!box) return;
  if(on) openSet[id]=true; else delete openSet[id];
  box.hidden=!on; if(b) b.setAttribute('aria-expanded',on?'true':'false');
  if(on){
    // 先自己写：打开练习时把这段的参考译文收起来（提交后可以再点「译」对照）
    var z=$('pzh'+i), e=entry(a.date,i);
    if(z && !z.hidden && !(e&&e.fb) && ER.setParaZh){ ER.setParaZh(i,false); toastOnce(); }
    var ta=$('tpIn'+i); grow(ta);
    if(ta && !ta.value) try{ ta.focus({preventScroll:true}); }catch(err){}
  }
}
var toasted=false;
function toastOnce(){ if(toasted) return; toasted=true; ER.toast('先自己翻译：这段的参考译文已收起，提交后可以再点「译」对照'); }
function refreshOpen(){
  var a=curArt(); if(!a) return;
  Array.prototype.forEach.call(document.querySelectorAll('#articleReader .tp'), function(box){
    var i=+box.dataset.i, e=entry(a.date,i)||{}, ta=$('tpIn'+i);
    if(ta && document.activeElement!==ta && ta.value!==(e.text||'')){ ta.value=e.text||''; grow(ta); }
    if(!busy[idOf(a.date,i)]){ var fb=$('tpFb'+i); fb.innerHTML=fbHtml(e); fb.hidden=!e.fb; }
    var b=document.querySelector('#articleReader .tp-btn[data-tp="'+i+'"]'); if(b) b.classList.toggle('has', !!(e.text||e.fb));
  });
}
ER.practiceRefresh = refreshOpen;
var saveTimers={};
document.addEventListener('input',function(ev){
  var ta=ev.target; if(!ta.classList||!ta.classList.contains('tp-in')) return;
  var a=curArt(); if(!a) return;
  var i=+ta.dataset.i, date=a.date;
  grow(ta);
  clearTimeout(saveTimers[i]);
  saveTimers[i]=setTimeout(function(){
    update(date,i,{text:ta.value});
    var st=$('tpSt'+i); if(st) st.textContent='草稿已保存';
    var fb=$('tpFb'+i), e=entry(date,i); if(fb&&e&&e.fb&&!busy[idOf(date,i)]) fb.innerHTML=fbHtml(e);
    var b=document.querySelector('#articleReader .tp-btn[data-tp="'+i+'"]'); if(b) b.classList.toggle('has', !!(ta.value||e.fb));
  }, 400);
});
function submit(i){
  var a=curArt(); if(!a) return;
  var ta=$('tpIn'+i), mine=(ta.value||'').trim(), id=idOf(a.date,i);
  var err=$('tpErr'+i), st=$('tpSt'+i), fb=$('tpFb'+i), send=document.querySelector('#articleReader [data-tpsend="'+i+'"]'), stop=document.querySelector('#articleReader [data-tpstop="'+i+'"]');
  err.hidden=true; err.textContent='';
  if(!mine){ err.hidden=false; err.textContent='先写下你的译文再提交（写一部分也可以）。'; ta.focus(); return; }
  if(!/[\u4e00-\u9fff]/.test(mine)){ err.hidden=false; err.textContent='译文里没有中文，请用中文翻译这段。'; return; }
  if(!getKey()){ err.hidden=false; err.innerHTML=esc(errText({noKey:true}))+' <button type="button" data-tpsettings="1">打开设置</button>'; return; }
  if(busy[id]) return;
  clearTimeout(saveTimers[i]); update(a.date,i,{text:ta.value});
  var en=a.paragraphs[i], ref=(Array.isArray(a.paragraphs_zh)&&a.paragraphs_zh.length===a.paragraphs.length)?a.paragraphs_zh[i]:'';
  var ctl=('AbortController' in window)?new AbortController():{abort:function(){},signal:undefined};
  busy[id]=ctl; send.disabled=true; send.textContent='批改中…'; stop.hidden=false;
  st.innerHTML='<span class="spinner"></span>AI 正在批改（通常 10–30 秒）…';
  fb.hidden=false; fb.innerHTML='<div class="tp-fb-head">🤖 AI 批改中…</div><div class="tp-md"></div>';
  var mdBox=fb.querySelector('.tp-md'), pending=null, raf=window.requestAnimationFrame||function(f){return setTimeout(f,50);};
  callDeepSeek([{role:'system',content:SYSTEM},{role:'user',content:userMsg(en,ref,mine)}], function(text){
    pending=text;
    raf(function(){ if(pending!=null&&busy[id]===ctl){ mdBox.innerHTML=md(pending); pending=null; } });
  }, ctl).then(function(res){
    delete busy[id];
    var e=update(a.date,i,{fb:res.text, fbFor:ta.value, fbAt:Date.now(), truncated:res.truncated});
    fb.innerHTML=fbHtml(e); st.textContent='已批改 · 草稿和批改都已保存';
  }, function(e){
    delete busy[id];
    var old=entry(a.date,i)||{};
    fb.innerHTML=fbHtml(old); fb.hidden=!old.fb;
    st.textContent='';
    if(e.aborted){ st.textContent='已停止'; return; }
    err.hidden=false; err.innerHTML=esc(errText(e))+(e.noKey||e.status===401?' <button type="button" data-tpsettings="1">打开设置</button>':' <button type="button" data-tpsend="'+i+'">重试</button>');
  }).then(function(){
    send.disabled=false; send.textContent='提交'; stop.hidden=true;
  });
}
ER.practiceSubmit = submit;
$('articleBox').addEventListener('click',function(ev){
  var b=ev.target.closest('button'); if(!b) return;
  if(b.dataset.tp!=null){ ev.preventDefault(); var i=+b.dataset.tp; setOpen(i, $('tp'+i).hidden); }
  else if(b.dataset.tpsend!=null){ ev.preventDefault(); submit(+b.dataset.tpsend); }
  else if(b.dataset.tpstop!=null){ var a=curArt(), c=a&&busy[idOf(a.date,+b.dataset.tpstop)]; if(c) c.abort(); }
  else if(b.dataset.tpsettings){ openSettings(); }
});
function openSettings(){ $('settingsPanel').hidden=false; var k=$('optDsKey'); if(k) setTimeout(function(){ try{ k.focus(); }catch(e){} }, 50); }

/* ---------- 设置：DeepSeek 密钥 ---------- */
function renderKeyStatus(msg, cls){
  var el=$('dsStatus'); if(!el) return;
  var k=getKey();
  el.className='hint '+(cls||'');
  el.innerHTML = msg!=null ? msg : (k ? '✓ 已保存密钥（'+esc(maskKey(k))+'），只存在这台设备。' : '未填写：提交翻译前需要先保存密钥。');
  $('btnDsClear').hidden=!k; $('btnDsTest').disabled=!k&&!$('optDsKey').value.trim();
}
$('btnDsSave').onclick=function(){
  var v=$('optDsKey').value.trim();
  if(!v){ ER.toast('请先粘贴 DeepSeek API 密钥'); $('optDsKey').focus(); return; }
  if(!/^sk-[A-Za-z0-9_\-]{8,}$/.test(v) && !confirm('这看起来不像 DeepSeek 密钥（通常以 sk- 开头），仍然保存吗？')) return;
  if(!setKey(v)){ ER.toast('无法保存（浏览器存储不可用）'); return; }
  $('optDsKey').value=''; renderKeyStatus(); ER.toast('密钥已保存在本机');
};
$('btnDsClear').onclick=function(){ setKey(''); renderKeyStatus(); ER.toast('已从本机删除 DeepSeek 密钥'); };
$('optDsKey').addEventListener('input',function(){ $('btnDsTest').disabled=!getKey()&&!this.value.trim(); });
/* 测试密钥：查询余额接口（GET /user/balance），不消耗额度 */
$('btnDsTest').onclick=function(){
  var typed=$('optDsKey').value.trim(), k=typed||getKey();
  if(!k){ ER.toast('请先粘贴密钥'); return; }
  var btn=this; btn.disabled=true; renderKeyStatus('<span class="spinner"></span>正在测试…');
  var ctl=('AbortController' in window)?new AbortController():null, timer=setTimeout(function(){ if(ctl) ctl.abort(); }, 20000);
  fetch(API+'/user/balance',{headers:{'Authorization':'Bearer '+k,'Accept':'application/json'},cache:'no-store',signal:ctl&&ctl.signal}).then(function(r){
    clearTimeout(timer);
    if(!r.ok) throw dsError(r.status);
    return r.json();
  }).then(function(j){
    var infos=(j&&j.balance_infos)||[], bal=infos.map(function(b){ return (b.currency==='CNY'?'¥':b.currency==='USD'?'$':(b.currency+' '))+b.total_balance; }).join(' / ');
    if(j&&j.is_available===false) renderKeyStatus('⚠️ 密钥有效，但余额不足'+(bal?'（'+esc(bal)+'）':'')+'：请到 platform.deepseek.com 充值后才能批改。'+(typed?' 记得点「保存」。':''),'err');
    else renderKeyStatus('✓ 密钥有效'+(bal?'，余额 '+esc(bal):'')+'。'+(typed?' 点「保存」后即可使用。':''),'ok');
  }, function(e){
    clearTimeout(timer);
    if(!e.status){ e.network=true; if(e.name==='AbortError') e.timeout=true; }
    renderKeyStatus('⚠️ '+esc(errText(e)).replace('60 秒','20 秒'),'err');
  }).then(function(){ btn.disabled=false; });
};
$('btnSettings').addEventListener('click',function(){ renderKeyStatus(); });
renderKeyStatus();
})();
