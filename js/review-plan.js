/* Daily workload policy: one shared budget, no fabricated rescheduling of deferred words. */
(function(root){
'use strict';
var SRS=root.SRS||(typeof require==='function'?require('./srs.js').SRS:null);
function key(w){return String(w||'').toLowerCase().replace(/\s+/g,' ').trim();}
function limit(settings){return Math.max(5,Math.min(30,Math.floor(+settings.reviewLimit||15)));}
function dictation(settings){return settings.reviewMode==='dictation';}
function dueDate(v,settings){
  if(dictation(settings)){var sk=v.srs.skills.spelling;return sk.active?sk.due:v.srs.added;}
  return SRS.dueDate(v.srs,settings.reviewMode==='balanced');
}
function used(vocab,date,daily){
  var out=new Set(daily&&daily.date===date?(daily.reviewWords||[]).map(key):[]);
  vocab.forEach(function(v){if((v.srs.history||[]).some(function(h){return h.date===date&&h.first&&!h.practice;}))out.add(key(v.word));});
  return out;
}
function plan(vocab,date,settings,daily){
  var cap=limit(settings),done=used(vocab,date,daily),left=Math.max(0,cap-done.size),old=[],first=[],fresh=[];
  vocab.forEach(function(v){
    if(done.has(key(v.word))||dueDate(v,settings)>date)return;
    if(!v.srs.reps&&!v.srs.skills.meaning.known){fresh.push(v);return;}
    if(dictation(settings)&&!v.srs.skills.spelling.active)first.push(v);else old.push(v);
  });
  old.sort(function(a,b){
    var skill=dictation(settings)?'spelling':'meaning',ra=SRS.retrievability(a.srs,skill,date),rb=SRS.retrievability(b.srs,skill,date);
    if(ra!=null&&rb!=null&&ra!==rb)return ra-rb;
    var da=dueDate(a,settings),db=dueDate(b,settings);return da<db?-1:da>db?1:0;
  });
  function byAdded(a,b){return a.srs.added.localeCompare(b.srs.added)||key(a.word).localeCompare(key(b.word));}
  first.sort(byAdded);fresh.sort(byAdded);
  var reserve=Math.min(first.length,Math.max(1,Math.floor(left/4))),oldBatch=old.slice(0,Math.max(0,left-reserve));
  var selected=oldBatch.concat(first.slice(0,left-oldBatch.length));
  selected=selected.concat(old.slice(oldBatch.length,oldBatch.length+left-selected.length));
  var requested=Math.max(0,(+settings.newPerDay||0)-((daily&&daily.date===date&&+daily.newDone)||0));
  var newSlots=Math.min(requested,Math.max(0,left-selected.length));
  var introductions=fresh.slice(0,newSlots);selected=selected.concat(introductions);
  return {limit:cap,used:done.size,remaining:left,items:selected,newSlots:newSlots-introductions.length,newWords:introductions.length,newLeft:newSlots,
    due:old.length+first.length,firstSpelling:first.length,unlearned:fresh.length,pending:Math.max(0,old.length+first.length+fresh.length-selected.length),total:vocab.length};
}
function forecast(vocab,date,settings,days,daily){
  var out=[],cap=limit(settings),buckets=new Array(days).fill(0),freshBuckets=new Array(days).fill(0),waiting=0,fresh=0;
  vocab.forEach(function(v){var d=Math.max(0,SRS.diffDays(date,dueDate(v,settings)));if(d<days)(!v.srs.reps&&!v.srs.skills.meaning.known?freshBuckets:buckets)[d]++;});
  for(var i=0;i<days;i++){
    waiting+=buckets[i];fresh+=freshBuckets[i];var capacity=i===0?Math.max(0,cap-used(vocab,date,daily).size):cap,n=Math.min(capacity,waiting);waiting-=n;
    var allowance=Math.max(0,(+settings.newPerDay||0)-(i===0&&daily&&daily.date===date?(+daily.newDone||0):0)),introduced=Math.min(capacity-n,allowance,fresh);fresh-=introduced;
    out.push({date:SRS.addDays(date,i),count:n+introduced,pending:waiting+fresh});
  }
  return out;
}
root.ReviewPlan={limit:limit,dictation:dictation,dueDate:dueDate,used:used,plan:plan,forecast:forecast};
})(typeof window!=='undefined'?window:globalThis);
