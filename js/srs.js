/* 分能力间隔复习。词义、语境、拼写各自调度；兼容旧版单一阶段数据。
 * 同一天的重试只用于练习，不构成新的长期记忆证据。纯函数，无 DOM 依赖。 */
(function (root) {
  'use strict';
  var INTERVALS = [1, 2, 4, 7, 15, 30];
  var MAX_STAGE = INTERVALS.length;
  var MASTERED_INTERVAL = 60;
  var TYPES = ['spell', 'en2zh', 'zh2en', 'cloze', 'gaps'];
  var SKILLS = ['meaning', 'usage', 'spelling'];
  var HISTORY_LIMIT = 200;
  var FS = root.FSRS || (typeof require==='function' ? require('./vendor/ts-fsrs-5.2.3.js') : null);
  var engines=Object.create(null);
  function engine(retention){var r=Math.max(.8,Math.min(.95,+retention||.9));return engines[r]||(engines[r]=FS.fsrs({request_retention:r,enable_fuzz:false,enable_short_term:false,maximum_interval:365}));}
  function memoryCard(sk,date){
    var f=sk.fsrs,card=FS.createEmptyCard(new Date(date+'T00:00:00Z'));
    if(f&&Number.isFinite(f.stability)&&f.stability>0&&Number.isFinite(f.difficulty)&&f.difficulty>=1&&f.difficulty<=10&&isYmd(f.last_review)){
      Object.assign(card,{stability:f.stability,difficulty:f.difficulty,state:FS.State.Review,reps:count(f.reps),lapses:count(f.lapses),scheduled_days:count(f.scheduled_days),last_review:new Date(f.last_review+'T00:00:00Z'),due:new Date(sk.due+'T00:00:00Z')});
    }
    return card;
  }
  function scheduleMemory(s,skill,rating,date,retention){
    if(!FS)throw new Error('FSRS 调度组件未加载，请刷新页面');
    var sk=s.skills[skill],f=engine(retention),card=memoryCard(sk,date);
    if(!card.last_review){
      s.history.filter(function(h){return h.skill===skill&&h.first&&!h.practice&&!h.assisted&&h.date<date;}).forEach(function(h){
        card=f.next(card,new Date(h.date+'T00:00:00Z'),h.rating==='good'?FS.Rating.Good:h.rating==='hard'?FS.Rating.Hard:FS.Rating.Again).card;
      });
    }
    var next=f.next(card,new Date(date+'T00:00:00Z'),rating==='good'?FS.Rating.Good:rating==='hard'?FS.Rating.Hard:FS.Rating.Again).card;
    var interval=rating==='again'?1:Math.max(1,Math.min(365,diffDays(date,next.due.toISOString().slice(0,10))));
    sk.fsrs={version:6,stability:next.stability,difficulty:next.difficulty,reps:next.reps,lapses:next.lapses,scheduled_days:interval,last_review:date};
    sk.due=addDays(date,interval);
  }
  function retrievability(srs,skill,date){
    var sk=srs&&srs.skills&&srs.skills[skill];if(!sk||!sk.fsrs||!FS)return null;
    var card=memoryCard(sk,date);if(!card.last_review)return null;
    return engine(.9).get_retrievability(card,new Date(date+'T00:00:00Z'),false);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function parse(ymd) { var p = String(ymd).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fmt(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(ymd, n) { return fmt(parse(ymd) + n * 864e5); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s; }
  function count(n) { return Math.max(0, Math.floor(+n || 0)); }
  function stage(n) { return Math.min(MAX_STAGE, count(n)); }
  function skillState(source, today, active) {
    var s = Object.assign({stage:0, due:today, reps:0, lapses:0, last:'', lastScored:'', lastPromoted:'', lastLapse:'', lastRating:'', successDates:[], delayedSuccess:false, known:false}, source || {});
    s.active = active;
    s.stage = stage(s.stage); s.reps = count(s.reps); s.lapses = count(s.lapses);
    if (!isYmd(s.due)) s.due = today;
    ['last','lastScored','lastPromoted','lastLapse'].forEach(function(k){ if(!isYmd(s[k])) s[k]=''; });
    s.successDates = Array.isArray(s.successDates) ? s.successDates.filter(isYmd).filter(function(d,i,a){return a.indexOf(d)===i;}).sort().slice(-30) : [];
    s.delayedSuccess = !!s.delayedSuccess; s.known = !!s.known;
    return s;
  }
  function syncLegacy(s) {
    s.stage = s.skills.meaning.stage;
    s.due = dueDate(s);
    return s;
  }
  function init(today) { return normalize({added:today}, today); }
  function normalize(source, today) {
    var src = source && typeof source === 'object' ? source : {};
    var s = Object.assign({stage:0,due:today,reps:0,lapses:0,last:'',added:today,qn:0}, src);
    var old = src.skills && typeof src.skills === 'object' ? src.skills : {};
    var legacy = {stage:s.stage,due:s.due,reps:s.reps,lapses:s.lapses,last:s.last,lastScored:s.last};
    s.skills = Object.assign({}, old, {
      meaning:skillState(old.meaning || legacy, today, true),
      usage:skillState(old.usage, today, !!(old.usage && old.usage.active)),
      spelling:skillState(old.spelling, today, !!(old.spelling && old.spelling.active))
    });
    s.version=2; s.reps=count(s.reps); s.lapses=count(s.lapses); s.qn=count(s.qn);
    if(!isYmd(s.last)) s.last='';
    if(!isYmd(s.added)) s.added=today;
    s.history=Array.isArray(src.history) ? src.history.filter(function(e){return e && isYmd(e.date) && SKILLS.indexOf(e.skill)>=0;}).slice(-HISTORY_LIMIT).map(function(e){return Object.assign({},e);}) : [];
    return syncLegacy(s);
  }
  function dueDate(srs, includeSpelling) {
    if(!srs) return '';
    if(!srs.skills || !srs.skills.meaning) return srs.due || '';
    var dates=SKILLS.filter(function(k){return (includeSpelling!==false || k!=='spelling') && srs.skills[k] && srs.skills[k].active;}).map(function(k){return srs.skills[k].due;}).filter(isYmd);
    return dates.sort()[0] || srs.due || '';
  }
  function record(srs, input) {
    var opt=input || {}, date=opt.date;
    if(!isYmd(date)) throw new Error('SRS.record requires a valid date');
    var skill=SKILLS.indexOf(opt.skill)>=0 ? opt.skill : 'meaning';
    var rating=['good','hard','again'].indexOf(opt.rating)>=0 ? opt.rating : 'again';
    var s=normalize(srs,date), sk=s.skills[skill];
    var practice=!!opt.practice, assisted=!!opt.assisted;
    var first=!practice && sk.lastScored!==date;
    var elapsed=first && sk.lastScored ? Math.max(0,diffDays(sk.lastScored,date)) : null;
    // 允许旧备份的日期模拟；倒退日期不产生晋级或掌握证据。
    if(sk.lastScored && date<sk.lastScored){ first=false; elapsed=null; }
    sk.active=true; sk.reps++; sk.last=date;
    s.reps++; s.qn++; s.last=date;
    s.history.push({date:date,skill:skill,rating:rating,assisted:assisted,practice:practice,self:!!opt.self,first:first,elapsed:elapsed});
    if(typeof opt.response==='string')s.history[s.history.length-1].response=opt.response.slice(0,500);
    if(typeof opt.task==='string')s.history[s.history.length-1].task=opt.task.slice(0,30);
    s.history=s.history.slice(-HISTORY_LIMIT);
    if(first){
      sk.lastScored=date;
      sk.lastRating=assisted && rating==='good' ? 'hard' : rating;
      sk.known=false;
      if(rating==='good' && !assisted){
        var interval=sk.stage>=MAX_STAGE ? MASTERED_INTERVAL : INTERVALS[sk.stage];
        sk.due=addDays(date,interval);
        sk.stage=Math.min(MAX_STAGE,sk.stage+1); sk.lastPromoted=date;
        if(sk.successDates.indexOf(date)<0) sk.successDates.push(date);
        sk.successDates=sk.successDates.slice(-30);
        if(elapsed>=7) sk.delayedSuccess=true;
      } else if(rating==='again'){
        sk.stage=Math.max(0,sk.stage-1); sk.lapses++; s.lapses++; sk.lastLapse=date;
        sk.due=addDays(date,1);
        sk.successDates=[]; sk.delayedSuccess=false;
      } else {
        sk.due=addDays(date,sk.stage>1 ? 2 : 1);
      }
    } else if(!practice && rating==='again' && (!sk.lastScored || date>=sk.lastScored)){
      // 同日先答对后发现没记住：收紧日期，但最多每天降级一次。
      if(sk.lastLapse!==date){ sk.stage=Math.max(0,sk.stage-1); sk.lapses++; s.lapses++; sk.lastLapse=date; }
      sk.due=sk.due<addDays(date,1) ? sk.due : addDays(date,1);
      sk.lastRating='again'; sk.successDates=[]; sk.delayedSuccess=false; sk.known=false;
    }
    if(first&&!assisted&&(opt.scheduler==='fsrs'||sk.fsrs))scheduleMemory(s,skill,rating,date,opt.retention);
    // practice 不改变 due/stage；即使先做补练，也不能把已经逾期的正式复习推迟。
    return syncLegacy(s);
  }
  function nextSkill(srs, today, includeSpelling) {
    var s=normalize(srs,today);
    var keys=SKILLS.filter(function(k){return (includeSpelling!==false || k!=='spelling') && s.skills[k].active && s.skills[k].due<=today;});
    keys.sort(function(a,b){return s.skills[a].due<s.skills[b].due ? -1 : s.skills[a].due>s.skills[b].due ? 1 : SKILLS.indexOf(a)-SKILLS.indexOf(b);});
    return keys[0] || 'meaning';
  }
  function isMastered(srs) {
    var m=srs && srs.skills && srs.skills.meaning;
    return !!(m && !m.known && !m.learningPending && m.stage>=3 && m.successDates && m.successDates.length>=3 && m.delayedSuccess && m.lastRating==='good');
  }
  function markKnown(srs, today) {
    var s=normalize(srs,today);
    s.skills.meaning.known=true;
    s.skills.meaning.due=addDays(today,7);
    return syncLegacy(s);
  }
  /* 老调用方兼容入口；新复习页应显式传入能力和提示情况。 */
  function answer(srs, correct, today) { return record(srs,{skill:'meaning',rating:correct?'good':'again',date:today}); }
  function practice(srs) { var s=normalize(srs,(srs && (srs.last || srs.added || srs.due)) || '2000-01-01'); s.qn++; return s; }
  function isDue(srs, today, includeSpelling) { var d=dueDate(srs,includeSpelling); return !!d && d<=today; }
  function dueList(vocab, today, cap, includeSpelling) {
    var list=vocab.filter(function(v){return isDue(v.srs,today,includeSpelling);});
    list.sort(function(a,b){var da=dueDate(a.srs,includeSpelling),db=dueDate(b.srs,includeSpelling); return da<db ? -1 : da>db ? 1 : (a.srs.stage-b.srs.stage);});
    return cap ? list.slice(0,cap) : list;
  }
  function forecast(vocab, today, days, includeSpelling) {
    var out=[];
    for(var i=0;i<days;i++) out.push({date:addDays(today,i),count:0});
    vocab.forEach(function(v){
      var due=dueDate(v.srs,includeSpelling); if(!isYmd(due)) return;
      var d=Math.max(0,diffDays(today,due)); if(d<days) out[d].count++;
    });
    return out;
  }
  function hash(s) { var h=0; s=String(s); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))|0; return Math.abs(h); }
  function qtype(word,srs) { return TYPES[(hash(word)+((srs && srs.qn)||0))%TYPES.length]; }
  function stageLabel(srs) {
    if(!srs) return '';
    if(isMastered(srs)) return '词义较稳';
    if(srs.skills && srs.skills.meaning.known) return '待抽查';
    return '词义阶段 '+stage(srs.stage)+'/'+MAX_STAGE;
  }
  root.SRS={INTERVALS:INTERVALS,MAX_STAGE:MAX_STAGE,MASTERED_INTERVAL:MASTERED_INTERVAL,TYPES:TYPES,SKILLS:SKILLS,HISTORY_LIMIT:HISTORY_LIMIT,
    addDays:addDays,diffDays:diffDays,isYmd:isYmd,init:init,normalize:normalize,record:record,nextSkill:nextSkill,isMastered:isMastered,markKnown:markKnown,
    answer:answer,practice:practice,dueDate:dueDate,isDue:isDue,dueList:dueList,forecast:forecast,stageLabel:stageLabel,hash:hash,qtype:qtype,retrievability:retrievability};
})(typeof window !== 'undefined' ? window : this);
