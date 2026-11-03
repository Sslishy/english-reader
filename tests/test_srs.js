'use strict';
const assert=require('node:assert/strict');
const {SRS}=require('../js/srs.js');
const day='2026-11-02';
const rec=(s,rating,date=day,extra={})=>SRS.record(s,{skill:'meaning',rating,date,...extra});
let tests=0;
function test(name,fn){fn();tests++;console.log('✓ '+name);}

test('legacy migration preserves progress, metadata, and backup round trip',()=>{
 const old={stage:4,due:'2026-11-10',last:'2026-10-26',reps:12,lapses:2,qn:17,added:'2026-10-01',custom:{kept:true}};
 const s=SRS.normalize(old,day);
 assert.equal(s.stage,4);assert.equal(s.due,old.due);assert.equal(s.skills.meaning.lastScored,old.last);
 assert.equal(s.skills.usage.active,false);assert.equal(s.skills.spelling.active,false);assert.equal(s.reps,12);
 assert.deepEqual(s.custom,old.custom);assert.deepEqual(SRS.normalize(JSON.parse(JSON.stringify(s)),day),s);
 assert.equal(SRS.isMastered(s),false);assert.equal(old.skills,undefined);
});
test('meaning and spelling schedules are independent',()=>{
 let s=SRS.normalize({stage:4,due:'2026-11-15',last:'2026-10-20'},day);
 const before={...s.skills.meaning};
 s=rec(s,'again',day,{skill:'spelling'});
 assert.deepEqual(s.skills.meaning,before);assert.equal(s.stage,4);assert.equal(s.due,'2026-11-03');
 assert.equal(s.skills.spelling.stage,0);assert.equal(s.skills.spelling.lapses,1);
 assert.equal(SRS.dueDate(s,false),'2026-11-15');assert.equal(SRS.isDue(s,'2026-11-03',false),false);
 assert.equal(SRS.nextSkill(s,'2026-11-03',true),'spelling');
});
test('assisted success and uncertainty never advance or confirm mastery',()=>{
 let s=SRS.normalize({stage:3,due:day},day);
 s=rec(s,'good',day,{assisted:true});
 assert.equal(s.stage,3);assert.equal(s.due,'2026-11-04');assert.equal(s.skills.meaning.successDates.length,0);
 assert.equal(s.history[0].assisted,true);assert.equal(s.history[0].rating,'good');
 s=rec(s,'hard','2026-11-04');assert.equal(s.stage,3);assert.equal(s.due,'2026-11-06');
});
test('first encounters promote once per day and same-day hinted then good cannot game progress',()=>{
 let s=rec(SRS.init(day),'good');assert.equal(s.stage,1);
 s=rec(s,'good');s=rec(s,'good');assert.equal(s.stage,1);assert.equal(s.skills.meaning.successDates.length,1);
 assert.equal(s.history[1].first,false);assert.equal(s.history[1].elapsed,null);
 let h=rec(SRS.init(day),'hard');h=rec(h,'good');assert.equal(h.stage,0);
});
test('failure decreases only one stage and later retry cannot postpone next review',()=>{
 let s=rec(SRS.normalize({stage:5,due:day},day),'again');
 assert.equal(s.stage,4);assert.equal(s.due,'2026-11-03');assert.equal(s.lapses,1);
 s=rec(s,'good',day,{practice:true});assert.equal(s.stage,4);assert.equal(s.due,'2026-11-03');
 s=rec(s,'again');assert.equal(s.stage,4);assert.equal(s.lapses,1);
});
test('practice cannot hide an overdue assessment or create mastery evidence',()=>{
 let s=SRS.normalize({stage:2,due:'2026-10-20',last:'2026-10-16'},day);
 s=rec(s,'good',day,{practice:true});
 assert.equal(s.due,'2026-10-20');assert.equal(s.stage,2);assert.equal(s.skills.meaning.lastScored,'2026-10-16');
 assert.equal(s.history[0].first,false);assert.equal(s.history[0].elapsed,null);
 s=rec(s,'good');assert.equal(s.history[1].elapsed,17);assert.equal(s.stage,3);
});
test('mastery requires separate days and a delayed success; lapse invalidates confidence',()=>{
 let s=rec(SRS.init(day),'good');
 s=rec(s,'good','2026-11-03',{self:true});s=rec(s,'good','2026-11-05');
 assert.equal(SRS.isMastered(s),false);
 s=rec(s,'good','2026-11-12');assert.equal(SRS.isMastered(s),true);
 s.skills.meaning.learningPending=true;assert.equal(SRS.isMastered(s),false);
 s=SRS.normalize(JSON.parse(JSON.stringify(s)),'2026-11-12');assert.equal(SRS.isMastered(s),false);
 s.skills.meaning.learningPending=false;assert.equal(SRS.isMastered(s),true);
 s=rec(s,'again','2026-11-27');assert.equal(SRS.isMastered(s),false);
});
test('known words remain scheduled for a seven-day check without false mastery',()=>{
 const old={stage:4,due:day,reps:12,custom:'keep'};
 const s=SRS.markKnown(old,day);
 assert.equal(s.due,'2026-11-09');assert.equal(s.reps,12);assert.equal(s.custom,'keep');assert.equal(SRS.isMastered(s),false);
 assert.equal(SRS.stageLabel(s),'待抽查');
});
test('due ordering and forecast count one word once, even with several overdue skills',()=>{
 let a=SRS.normalize({stage:2,due:'2026-11-01'},day);
 a.skills.spelling.active=true;a.skills.spelling.due='2026-10-20';a=SRS.normalize(a,day);
 const b=SRS.normalize({stage:1,due:day},day),c=SRS.normalize({stage:0,due:'2026-11-04'},day);
 const words=[{word:'b',srs:b},{word:'c',srs:c},{word:'a',srs:a}];
 assert.deepEqual(SRS.dueList(words,day,30).map(x=>x.word),['a','b']);
 assert.deepEqual(SRS.forecast(words,day,3).map(x=>x.count),[2,0,1]);
 assert.equal(SRS.nextSkill(a,day,true),'spelling');
 a.skills.spelling.due=a.skills.meaning.due;assert.equal(SRS.nextSkill(a,day,true),'meaning');
});
test('history is bounded and source objects are not mutated',()=>{
 const original=SRS.init(day);let s=original;
 for(let i=0;i<220;i++)s=rec(s,'good',day,{practice:true});
 assert.equal(s.history.length,200);assert.equal(original.history.length,0);assert.equal(original.reps,0);
});
test('invalid calendar dates are rejected and malformed old counters are repaired',()=>{
 assert.equal(SRS.isYmd('2026-02-31'),false);assert.equal(SRS.isYmd('2024-02-29'),true);
 assert.throws(()=>rec({},'good','2026-02-31'),/valid date/);
 const s=SRS.normalize({stage:999,reps:-3,due:'broken',skills:{usage:{active:true,successDates:'broken'}}},day);
 assert.equal(s.stage,6);assert.equal(s.reps,0);assert.equal(s.due,day);assert.deepEqual(s.skills.usage.successDates,[]);
});
test('written recall evidence is bounded and survives normalization and backup',()=>{
 const s=rec(SRS.init(day),'good',day,{self:true,response:'恢复能力',task:'recall'});
 assert.equal(s.history[0].response,'恢复能力');assert.equal(s.history[0].task,'recall');
 assert.deepEqual(SRS.normalize(JSON.parse(JSON.stringify(s)),day).history,s.history);
 const long=rec(s,'good',day,{practice:true,response:'词'.repeat(600)});
 assert.equal(long.history.at(-1).response.length,500);assert.equal(long.history.at(-1).first,false);
});
console.log(tests+' SRS tests passed');
