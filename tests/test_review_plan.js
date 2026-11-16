'use strict';
const assert=require('node:assert/strict'),{SRS}=require('../js/srs.js');
globalThis.SRS=SRS;require('../js/review-plan.js');const P=globalThis.ReviewPlan;
const day='2026-11-05',settings={reviewMode:'dictation',reviewLimit:15,newPerDay:3};let n=0;
function test(name,f){f();console.log('PASS '+name);n++;}
function old(word){return {word,srs:SRS.normalize({stage:2,due:day,reps:2,last:'2026-10-30',added:'2026-10-20'},day)};}
const record=(s,date,rating='good',extra={})=>SRS.record(s,{skill:'spelling',date,rating,scheduler:'fsrs',...extra});
test('daily total includes introductions and never appends extra new words',()=>{
 const words=Array.from({length:40},(_,i)=>old('word'+i)),copy=JSON.stringify(words);
 const p=P.plan(words,day,settings,{});assert.equal(p.items.length,15);assert.equal(p.newSlots,0);assert.equal(p.firstSpelling,40);assert.equal(JSON.stringify(words),copy);
 const fresh=Array.from({length:20},(_,i)=>({word:'new'+i,srs:SRS.init(day)}));
 const q=P.plan(fresh,day,settings,{});assert.equal(q.items.length,3);assert.equal(q.newSlots,0);assert.equal(q.newLeft,3);
});
test('each mode owns its budget and cross-mode words become schedule-preserving practice',()=>{
 const words=Array.from({length:20},(_,i)=>old('word'+i));words[0].srs=record(words[0].srs,day);
 const daily={date:day,modes:{dictation:{reviewWords:Array.from({length:14},(_,i)=>'word'+(i+1))}}};
 const own=P.plan(words,day,settings,daily);assert.equal(own.used,15);assert.equal(own.items.length,0);
 for(const mode of ['reading','balanced']){const p=P.plan(words,day,{...settings,reviewMode:mode},daily);assert.equal(p.used,0);assert.equal(p.items.length,15);assert(p.practiceWords.includes('word0'));}
 assert(P.plan(words,SRS.addDays(day,1),settings,daily).items.length>0);
});
test('all three modes default to thirty, with independent configurable limits',()=>{
 const words=Array.from({length:40},(_,i)=>old('word'+i));
 for(const mode of ['dictation','reading','balanced']){assert.equal(P.limit({reviewMode:mode}),30);assert.equal(P.plan(words,day,{reviewMode:mode,newPerDay:0},{}).items.length,30);}
 assert.equal(P.limit({reviewMode:'reading',reviewLimit:30,reviewLimits:{reading:10,dictation:30}}),10);
});
test('each mode supports thirty through one hundred without sharing its allowance',()=>{
 const words=Array.from({length:130},(_,i)=>old('word'+i));
 for(const mode of ['dictation','reading','balanced'])for(const cap of [30,40,50,60,70,80,90,100]){
  const cfg={reviewMode:mode,reviewLimits:{[mode]:cap},newPerDay:0},p=P.plan(words,day,cfg,{});
  assert.equal(p.limit,cap);assert.equal(p.items.length,cap);assert.equal(new Set(p.items.map(v=>v.word)).size,cap);
 }
 assert.equal(P.limit({reviewMode:'reading',reviewLimits:{reading:1000}}),100);
 const cfg={reviewMode:'dictation',reviewLimits:{dictation:100,reading:40},newPerDay:0};
 const daily={date:day,modes:{dictation:{reviewWords:words.slice(0,30).map(v=>v.word)}}};
 assert.equal(P.plan(words,day,cfg,daily).items.length,70);
 assert.equal(P.plan(words,day,{...cfg,reviewMode:'reading'},daily).items.length,40);
});
test('legacy per-mode caps below thirty stay in force and are not raised',()=>{
 for(const cap of [5,10,15,20]){
  assert.equal(P.limit({reviewMode:'dictation',reviewLimit:30,reviewLimits:{dictation:cap}}),cap);
  const words=Array.from({length:40},(_,i)=>old('legacy'+cap+'-'+i));
  assert.equal(P.plan(words,day,{reviewMode:'dictation',reviewLimits:{dictation:cap},newPerDay:0},{}).items.length,cap);
 }
});
test('not-due learned words can fill the mode quota without becoming due',()=>{
 const v=old('retain');v.srs.skills.meaning.due='2026-12-01';const before=JSON.stringify(v.srs);
 const p=P.plan([v],day,{reviewMode:'reading',newPerDay:0},{});assert.equal(p.items.length,1);assert.deepEqual(p.practiceWords,['retain']);assert.equal(JSON.stringify(v.srs),before);
});
function futureWords(n){return Array.from({length:n},(_,i)=>{
 const v=old('word'+String(i).padStart(3,'0'));
 for(const k of ['meaning','usage','spelling'])Object.assign(v.srs.skills[k],{active:true,due:i<30?'2026-12-01':'2026-12-02'});
 return v;
});}
function practiceBatch(batch,date,mode){
 for(const v of batch){const skill=mode==='dictation'?'spelling':'meaning',prior=JSON.parse(JSON.stringify(v.srs.skills));
  v.srs=SRS.record(v.srs,{skill,date,rating:'good',mode,practice:true});v.srs.skills=prior;
 }
}
test('extra practice rotates across days in every mode and preserves original schedules',()=>{
 for(const mode of ['dictation','reading','balanced']){
  const words=futureWords(60),cfg={reviewMode:mode,newPerDay:0},before=words.map(v=>JSON.stringify(v.srs.skills));
  const a=P.plan(words,day,cfg,{});practiceBatch(a.items,day,mode);
  const b=P.plan(words,SRS.addDays(day,1),cfg,{});assert.equal(b.items.length,30);assert(!b.items.some(v=>a.items.includes(v)));
  practiceBatch(b.items,SRS.addDays(day,1),mode);
  const c=P.plan(words,SRS.addDays(day,2),cfg,{});assert.deepEqual(c.items.map(v=>v.word),a.items.map(v=>v.word));
  assert.deepEqual(words.map(v=>JSON.stringify(v.srs.skills)),before);assert.equal(a.dueSelected,0);assert.equal(a.practiceWords.length,30);
 }
});
test('rotation uses mode history, counts retries as exposure, and ignores future records',()=>{
 const words=futureWords(60),cfg={reviewMode:'dictation',newPerDay:0};
 practiceBatch(words.slice(0,30),SRS.addDays(day,-1),'dictation');
 practiceBatch(words.slice(30),SRS.addDays(day,-1),'reading');
 const p=P.plan(words,day,cfg,{});assert(p.items.every(v=>words.slice(30).includes(v)));
 words[30].srs.history.push({skill:'spelling',mode:'dictation',date:'2027-01-01',rating:'good',practice:true});
 assert(P.plan(words,day,cfg,{}).items.includes(words[30]));
});
test('due reviews stay ahead of rotation and an insufficient pool is not duplicated',()=>{
 const words=futureWords(60),cfg={reviewMode:'dictation',newPerDay:0};
 practiceBatch(words.slice(0,30),SRS.addDays(day,-1),'dictation');
 words[0].srs.skills.spelling.due=day;
 const p=P.plan(words,day,cfg,{});assert.equal(p.items[0],words[0]);assert.equal(p.dueSelected,1);assert.equal(p.practiceWords.length,29);
 const small=P.plan(words.slice(0,4),day,{...cfg,reviewLimit:100},{});assert.equal(small.items.length,4);assert.equal(new Set(small.items).size,4);
});
test('rotation order is deterministic for imported or reordered vocabulary',()=>{
 const words=futureWords(60),cfg={reviewMode:'dictation',newPerDay:0},before=JSON.stringify(words);
 assert.deepEqual(P.plan(words,day,cfg,{}).items.map(v=>v.word),P.plan(words.slice().reverse(),day,cfg,{}).items.map(v=>v.word));
 assert.equal(JSON.stringify(words),before);
});
test('unheard words have reserved slots even with a persistent overdue backlog',()=>{
 const words=Array.from({length:40},(_,i)=>old('unheard'+i));
 for(let i=0;i<40;i++){let v=old('due'+i);v.srs.skills.spelling.active=true;v.srs.skills.spelling.due=day;words.push(v);}
 const remaining=new Set(words.slice(0,40).map(v=>v.word));
 for(let d=0;d<20;d++){const date=SRS.addDays(day,d),p=P.plan(words,date,settings,{});assert(p.items.length<=15);assert.equal(new Set(p.items.map(v=>v.word)).size,p.items.length);for(const v of p.items){remaining.delete(v.word);v.srs=record(v.srs,date);}}
 assert.equal(remaining.size,0);
});
test('FSRS adapts intervals and retains memory state across JSON backup',()=>{
 let s=record(SRS.init(day),day);let first=SRS.diffDays(day,s.skills.spelling.due);assert(s.skills.spelling.fsrs.stability>0);
 let next=s.skills.spelling.due;s=record(JSON.parse(JSON.stringify(s)),next);const second=SRS.diffDays(next,s.skills.spelling.due);assert(second>first);
 const stable=s.skills.spelling.fsrs.stability;s=record(s,s.skills.spelling.due,'again');assert(s.skills.spelling.fsrs.stability<stable);assert.equal(SRS.diffDays(s.skills.spelling.lastScored,s.skills.spelling.due),1);
});
test('stricter retention means shorter intervals and model recall falls over time',()=>{
 let s=record(SRS.init(day),day),date=s.skills.spelling.due;
 const low=record(s,date,'good',{retention:.85}),high=record(s,date,'good',{retention:.95});assert(low.skills.spelling.due>high.skills.spelling.due);
 assert(SRS.retrievability(s,'spelling',day)>SRS.retrievability(s,'spelling',SRS.addDays(day,20)));
});
test('hints and same-day practice cannot train a false FSRS success',()=>{
 let s=record(SRS.init(day),day),date=s.skills.spelling.due,mem=JSON.stringify(s.skills.spelling.fsrs);
 let assisted=record(s,date,'good',{assisted:true});assert.equal(JSON.stringify(assisted.skills.spelling.fsrs),mem);
 let practice=record(s,day,'good',{practice:true});assert.equal(JSON.stringify(practice.skills.spelling.fsrs),mem);assert.equal(practice.skills.spelling.due,s.skills.spelling.due);
});
test('old dates and other abilities survive starting the spelling schedule',()=>{
 const v=old('retain'),before=JSON.stringify(v.srs.skills.meaning);const result=record(v.srs,day);
 assert.equal(JSON.stringify(result.skills.meaning),before);assert.equal(v.srs.skills.spelling.active,false);assert(result.skills.spelling.active);
});
test('forecast spreads existing backlog over daily capacity without editing due dates',()=>{
 const words=Array.from({length:40},(_,i)=>old('word'+i)),before=JSON.stringify(words),forecast=P.forecast(words,day,settings,4,{});
 assert.deepEqual(forecast.map(d=>d.count),[15,15,10,0]);assert.equal(JSON.stringify(words),before);
});
console.log(n+' review planning tests passed');
