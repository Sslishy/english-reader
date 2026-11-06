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
test('not-due learned words can fill the mode quota without becoming due',()=>{
 const v=old('retain');v.srs.skills.meaning.due='2026-12-01';const before=JSON.stringify(v.srs);
 const p=P.plan([v],day,{reviewMode:'reading',newPerDay:0},{});assert.equal(p.items.length,1);assert.deepEqual(p.practiceWords,['retain']);assert.equal(JSON.stringify(v.srs),before);
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
