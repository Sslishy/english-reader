/* AI 翻译共用：安全的 Markdown、DeepSeek 流式调用、密钥设置和旧段落记录。
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

/* ---------- 调用 DeepSeek ---------- */
function dsError(status, body){
  var e=new Error('HTTP '+status); e.status=status; e.body=body||''; return e;
}
function errText(e){
  if(e.noKey) return '还没有填写 DeepSeek API 密钥：点右上角 ⚙️ 设置 → 「DeepSeek 逐句翻译讲解」粘贴密钥。';
  if(e.status===401) return 'DeepSeek 密钥无效（401）：请检查是否复制完整，或在 platform.deepseek.com 重新创建一个密钥。';
  if(e.status===402) return 'DeepSeek 账户余额不足（402）：请到 platform.deepseek.com 充值后再试。';
  if(e.status===429) return '请求太频繁（429），DeepSeek 暂时限流了，请等半分钟再提交。';
  if(e.status===400||e.status===422) return '请求格式有误（'+e.status+'），请刷新页面后重试。';
  if(e.status>=500) return 'DeepSeek 服务器繁忙（'+e.status+'），请稍后再试。';
  if(e.timeout) return '等待 DeepSeek 回复超时（60 秒没有响应），可能是网络慢或服务繁忙，请重试。';
  if(e.network) return '网络连接失败，连不上 DeepSeek（api.deepseek.com），请检查网络后重试。';
  if(e.empty) return 'DeepSeek 没有返回内容，请重试。';
  return 'AI 请求失败：'+(e.message||e);
}
ER.dsErrText = errText;
/* 发送请求；onDelta(全部已收到文本) 用于流式显示；返回 Promise<{text, truncated}> */
function callDeepSeek(messages, onDelta, ctl, options){
  var key=getKey();
  if(!key){ var ne=new Error('no key'); ne.noKey=true; return Promise.reject(ne); }
  var canStream = !!(window.ReadableStream && window.TextDecoder && 'body' in Response.prototype);
  var timer=null, timedOut=false;
  function arm(){ clearTimeout(timer); timer=setTimeout(function(){ timedOut=true; try{ ctl.abort(); }catch(e){} }, ER.DS_TIMEOUT); }
  arm();
  var body={model:MODEL, messages:messages, max_tokens:options&&options.maxTokens||MAX_TOKENS, temperature:0.5, stream:canStream};
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

/* Old paragraph drafts remain readable and can still supply existing error drills. */
function legacyContent(a,i){
  var e=entry(a.date,i);if(!e||(!e.text&&!e.fb))return '';
  return '<details class="legacy-translation"><summary>查看此前的整段翻译记录</summary><div class="legacy-draft">'+esc(e.text||'')+'</div><div class="tp-md">'+md(e.fb||'')+'</div><div id="tpDrill'+i+'">'+(ER.translationDrillControls?ER.translationDrillControls(a,i,e):'')+'</div></details>';
}
ER.legacyTranslationHtml=function(a,i){return '<div id="legacyTranslation'+i+'">'+legacyContent(a,i)+'</div>';};
function refreshOpen(){
  var a=ER.currentArticle&&ER.currentArticle();if(!a)return;
  (a.paragraphs||[]).forEach(function(p,i){var host=$('legacyTranslation'+i);if(host)host.innerHTML=legacyContent(a,i);});
}
ER.practiceRefresh=refreshOpen;

/* ---------- 设置：DeepSeek 密钥 ---------- */
function renderKeyStatus(msg, cls){
  var el=$('dsStatus'); if(!el) return;
  var k=getKey();
  el.className='hint '+(cls||'');
  el.innerHTML = msg!=null ? msg : (k ? '✓ 已保存密钥（'+esc(maskKey(k))+'），只存在这台设备。' : '未填写：使用 AI 讲解前需要先保存密钥。');
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
    if(j&&j.is_available===false) renderKeyStatus('⚠️ 密钥有效，但余额不足'+(bal?'（'+esc(bal)+'）':'')+'：请到 platform.deepseek.com 充值后才能生成讲解。'+(typed?' 记得点「保存」。':''),'err');
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
