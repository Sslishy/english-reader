/* ☁️ GitHub 同步：把全部学习数据保存到用户自己的一个 secret gist（english-reader-data.json）。
 * 纯前端：token 只存在本机 localStorage（er_sync_token），只需要 gist 权限。
 * 每次同步：读取 gist → 与本机逐条合并（并集 + updatedAt 新的优先 + 删除记录）→ 有变化再写回。
 * 网络失败 / 401 / 限流 / 超时都不会改动本机数据，稍后自动重试。 */
(function(){
'use strict';
var ER = window.ER, $ = ER.$, esc = ER.esc;
var API = ER.GITHUB_API || 'https://api.github.com';
var FILE = 'english-reader-data.json';
var TOKEN_KEY = 'er_sync_token', META_KEY = 'er_sync_meta';
var TIMEOUT = 20000, DEBOUNCE = 4000;
var busy = null, pending = false, debTimer = null, retryTimer = null, fails = 0, dirty = false, lastRemote = null;

function token(){ try{ return localStorage.getItem(TOKEN_KEY)||''; }catch(e){ return ''; } }
function meta(){ return ER.lsGet(META_KEY,{}) || {}; }
function setMeta(m){ ER.lsSet(META_KEY, Object.assign(meta(), m), true); renderStatus(); }

function gh(method, path, body, ms){
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, ms||TIMEOUT);
  var opt = {method:method, headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token()}, cache:'no-store'};
  if(body!==undefined){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body); }
  if(ctl) opt.signal = ctl.signal;
  return fetch(path.indexOf('http')===0 ? path : API+path, opt).then(function(r){
    clearTimeout(timer);
    if(!r.ok){
      var e = new Error('HTTP '+r.status); e.status = r.status;
      e.rate = r.status===429 || (r.status===403 && r.headers.get('x-ratelimit-remaining')==='0');
      e.reset = +r.headers.get('x-ratelimit-reset')||0;
      throw e;
    }
    return r.status===204 ? null : r.json();
  }, function(e){ clearTimeout(timer); var x = new Error(e&&e.name==='AbortError' ? 'timeout' : 'network'); x.network = true; x.timeout = e&&e.name==='AbortError'; throw x; });
}
function errText(e){
  if(e.status===401) return 'token 无效或已过期，请重新生成并粘贴';
  if(e.rate) return 'GitHub 请求太频繁（限流），稍后自动重试';
  if(e.status===403) return 'token 没有 gist 权限（创建 token 时请勾选 gist）';
  if(e.status===404) return '找不到同步用的 gist，下次同步会重新查找';
  if(e.status===422) return 'GitHub 拒绝了数据（'+e.message+'）';
  if(e.timeout) return '连接 GitHub 超时（国内网络有时较慢），稍后自动重试';
  if(e.network) return '网络连接失败（离线或无法访问 GitHub），稍后自动重试';
  return '同步失败：'+(e.message||e);
}

/* 找到已有的同步 gist（第二台设备会自动找到同一个），没有就新建一个 secret gist */
function findGist(){
  var page = 1, best = null;
  function next(){
    return gh('GET','/gists?per_page=100&page='+page).then(function(list){
      (list||[]).forEach(function(g){ if(g&&g.files&&g.files[FILE] && (!best || g.updated_at>best.updated_at)) best=g; });
      if(list && list.length===100 && page<10){ page++; return next(); }
      return best && best.id;
    });
  }
  return next();
}
function createGist(content){
  return gh('POST','/gists',{description:'english-reader 学习数据同步（请勿删除）',public:false,files:(function(){var f={};f[FILE]={content:content};return f;})()})
    .then(function(g){ return g.id; });
}
function readGist(id){
  return gh('GET','/gists/'+id).then(function(g){
    var f = g && g.files && g.files[FILE];
    if(!f) return {data:null};
    var p = f.truncated && f.raw_url ? fetchRaw(f.raw_url) : Promise.resolve(f.content);
    return p.then(function(txt){ var d=null; try{ d=JSON.parse(txt||'null'); }catch(e){ var x=new Error('gist 里的数据不是有效 JSON，已停止同步以免覆盖'); x.bad=true; throw x; } return {data:d}; });
  });
}
function fetchRaw(url){
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, TIMEOUT);
  return fetch(url, ctl?{signal:ctl.signal,cache:'no-store'}:{}).then(function(r){ clearTimeout(timer); if(!r.ok){var e=new Error('HTTP '+r.status);e.status=r.status;throw e;} return r.text(); },
    function(){ clearTimeout(timer); var x=new Error('network'); x.network=true; throw x; });
}
function stripVolatile(s){ var o=JSON.parse(JSON.stringify(s)); delete o.updatedAt; delete o.device; return JSON.stringify(o); }
function payload(state){ state=Object.assign({}, state, {updatedAt:new Date().toISOString()}); return JSON.stringify(state); }

/* 一次完整同步 */
function syncNow(reason){
  if(!token()) return Promise.resolve(false);
  if(busy){ pending = true; return busy; }
  clearTimeout(retryTimer);
  setMeta({state:'syncing'});
  var m = meta(), gistId = m.gistId;
  var wasDirty = dirty; dirty = false;
  busy = Promise.resolve().then(function(){
    if(gistId) return gistId;
    return findGist().then(function(id){
      if(id) return id;
      return createGist(payload(ER.syncState())).then(function(nid){ m.created = true; return nid; });
    });
  }).then(function(id){
    gistId = id; setMeta({gistId:id});
    return readGist(id);
  }).then(function(res){
    var remote = res.data;
    var merged = ER.mergeRemoteState(remote);
    lastRemote = merged;
    if(remote && stripVolatile(Object.assign({},remote,{settingsAt:+remote.settingsAt||0})) === stripVolatile(merged)) return false;
    var files = {}; files[FILE] = {content: payload(merged)};
    return gh('PATCH','/gists/'+gistId,{files:files}).then(function(){ return true; });
  }).then(function(pushed){
    fails = 0;
    setMeta({state:'ok', lastSync:Date.now(), lastError:'', pushed:!!pushed});
    return true;
  }, function(e){
    dirty = dirty || wasDirty;
    if(e.status===404 && gistId){ setMeta({gistId:''}); }
    fails++;
    setMeta({state:'error', lastError: e.bad ? e.message : errText(e), lastErrorAt:Date.now()});
    if(e.status!==401 && e.status!==403 || e.rate){
      var wait = e.rate && e.reset ? Math.max(60000, e.reset*1000-Date.now()) : Math.min(10*60000, 30000*Math.pow(2, fails-1));
      retryTimer = setTimeout(function(){ syncNow('retry'); }, wait);
    }
    return false;
  }).then(function(r){
    busy = null;
    if(pending){ pending = false; setTimeout(function(){ syncNow('pending'); }, 50); }
    return r;
  });
  return busy;
}
ER.syncNow = syncNow;
/* 本机数据有改动：几秒后同步（合并多次改动） */
ER.syncSoon = function(){
  if(!token()) return;
  dirty = true;
  clearTimeout(debTimer);
  debTimer = setTimeout(function(){ syncNow('change'); }, ER.SYNC_DEBOUNCE!=null ? ER.SYNC_DEBOUNCE : DEBOUNCE);
};
/* 离开页面时：若有未同步的改动，用 keepalive 尽量把（本机 + 上次读到的远端）合并结果写回 */
function flushOnLeave(){
  if(!token() || !dirty) return;
  clearTimeout(debTimer);
  var id = meta().gistId;
  if(!id || !lastRemote){ syncNow('leave'); return; }
  var files = {}; files[FILE] = {content: payload(ER.syncState())};
  var body = JSON.stringify({files:files});
  if(body.length > 60000){ syncNow('leave'); return; }
  try{
    fetch(API+'/gists/'+id, {method:'PATCH', keepalive:true, headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token(),'Content-Type':'application/json'}, body:body})
      .then(function(r){ if(r.ok){ dirty=false; setMeta({state:'ok', lastSync:Date.now(), lastError:''}); } }).catch(function(){});
  }catch(e){}
}
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState==='hidden'){ if(dirty){ clearTimeout(debTimer); syncNow('hidden'); } }
  else if(token() && Date.now()-(meta().lastSync||0) > 60000) syncNow('visible');
});
window.addEventListener('pagehide', flushOnLeave);
window.addEventListener('online', function(){ if(token()) syncNow('online'); });

/* ---------- 界面 ---------- */
function fmtTime(ms){ try{ return new Date(ms).toLocaleString('zh-CN',{hour12:false}); }catch(e){ return String(ms); } }
function renderStatus(){
  var el = $('syncStatus'); if(!el) return;
  var on = !!token(), m = meta();
  $('syncConnected').hidden = !on; $('syncSetup').hidden = on;
  if(!on){ el.className='hint'; el.textContent='未开启同步：数据只保存在本浏览器。'; return; }
  var h = '';
  if(m.state==='syncing') h = '<span class="spinner"></span>正在同步…';
  else if(m.state==='error') h = '<span class="err">⚠️ '+esc(m.lastError||'同步失败')+'</span>'+(m.lastSync?'<br>上次成功同步：'+esc(fmtTime(m.lastSync)):'')+'<br><span class="muted">本机数据没有受影响。</span>';
  else if(m.lastSync) h = '✓ 已同步 · 上次同步：'+esc(fmtTime(m.lastSync));
  else h = '已连接，等待第一次同步…';
  if(m.gistId) h += '<br><span class="muted">gist：<a href="https://gist.github.com/'+esc(m.gistId)+'" target="_blank" rel="noopener">'+esc(m.gistId.slice(0,8))+'…</a></span>';
  el.className = 'hint sync-status'+(m.state==='error'?' is-err':'');
  el.innerHTML = h;
}
ER.renderSyncStatus = renderStatus;
$('btnSyncConnect').onclick = function(){
  var t = $('syncToken').value.trim();
  if(!t){ ER.toast('请先粘贴 GitHub token'); $('syncToken').focus(); return; }
  if(!/^(ghp_|github_pat_|gho_|ghu_)[A-Za-z0-9_]+$/.test(t) && !confirm('这看起来不像 GitHub token，仍然使用吗？')) return;
  try{ localStorage.setItem(TOKEN_KEY, t); }catch(e){ ER.toast('无法保存 token'); return; }
  $('syncToken').value = '';
  ER.lsSet(META_KEY, {}, true);
  renderStatus();
  syncNow('connect').then(function(ok){ ER.toast(ok ? '☁️ 已连接并同步' : '连接失败：'+(meta().lastError||'')); });
};
$('btnSyncNow').onclick = function(){ syncNow('manual').then(function(ok){ ER.toast(ok ? '☁️ 同步完成' : (meta().lastError||'同步失败')); }); };
$('btnSyncOff').onclick = function(){
  if(!confirm('断开同步？本机数据会保留，gist 里的数据也不会删除；只是删掉本机保存的 token。')) return;
  try{ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(META_KEY); }catch(e){}
  clearTimeout(debTimer); clearTimeout(retryTimer); dirty = false; lastRemote = null;
  renderStatus(); ER.toast('已断开同步');
};
renderStatus();
ER.startSync = function(){ if(token()) syncNow('load'); };
})();
