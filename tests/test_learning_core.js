const fs=require('fs'),path=require('path'),assert=require('assert');
require('../js/learning-core.js');const C=globalThis.LearningCore;let n=0;
function test(name,f){f();console.log('PASS '+name);n++;}
test('all passages have three valid evidence-linked questions',()=>{
 let passages=fs.readdirSync(path.join(__dirname,'../articles')).filter(x=>/^20.*\.json$/.test(x));assert.ok(passages.length>=11);
 for(const file of passages){let a=JSON.parse(fs.readFileSync(path.join(__dirname,'../articles',file)));assert.equal(C.validQuestions(a).length,3,file);assert.equal(new Set(a.questions.map(q=>q.id)).size,3);assert.deepEqual(a.questions.map(q=>q.type),['main','detail','inference']);}
});
test('invalid evidence and unsafe question ids are rejected',()=>{let a={paragraphs:['The ocean absorbs heat.'],questions:[{id:'q1',prompt:'Why?',options:['A','B'],answer:0,evidence:[{paragraph:0,quote:'Invented quote'}]}]};assert.equal(C.validQuestions(a).length,0);a.questions[0].evidence[0].quote='absorbs heat';a.questions[0].id='q1"]';assert.equal(C.validQuestions(a).length,0);});
test('sentence segmentation keeps decimals, paragraph attribution and text',()=>{let s=C.sentences({paragraphs:['The goal is 1.5°C. It matters.','Doctors still decide.']});assert.equal(s.length,3);assert.equal(s[0].text,'The goal is 1.5°C.');assert.equal(s[2].paragraph,1);});
test('dictation ignores case and punctuation but marks missing and extra words',()=>{assert(C.compare("They're ready!","they’re ready.").exact);let r=C.compare('People ready now','People are ready.');assert(!r.exact);assert(r.parts.some(x=>x.kind==='missing'&&x.text==='are'));assert(r.parts.some(x=>x.kind==='extra'&&x.text==='now'));assert(C.compare('','Actual words').score===0);});
test('translation mistakes are extracted only from grounded quotes and explicit corrections',()=>{
 const fb='## 逐句点评\n> Health professionals still make the final decision.\n- **问题**：你漏译了 still，弱化了主语。\n- **怎么译**：保留仍然的含义。\n- **改为**：医护人员仍然作出最终决定。\n## 小结\n认真核对';
 let r=C.extract(fb,'Health professionals still make the final decision.');assert.equal(r.length,1);assert.equal(r[0].category,'指代与主语');assert.equal(r[0].answer,'医护人员仍然作出最终决定。');assert.equal(C.extract(fb,'Another unrelated sentence.').length,0);assert.equal(C.extract('没有明显错误','A valid sentence.').length,0);
});
test('unrated vocabulary is not counted as unfamiliar',()=>{let a={paragraphs:['Marine ecosystems absorb carbon.']};let m=C.analyze(a,{});assert.equal(m.unknown.length,0);assert(m.unrated.length>=3);m=C.analyze(a,{marine:false,ecosystems:true});assert(m.unknown.includes('marine'));assert(m.known.includes('ecosystems'));assert(m.unrated.includes('carbon'));});
test('known inflected forms reduce uncertainty without treating all vocabulary as known',()=>{let m=C.analyze({paragraphs:['Workers restored habitats.']},{restore:true},w=>w==='restored'?['restored','restore']:[w]);assert(m.known.includes('restored'));assert(m.unrated.includes('habitats'));});
console.log(n+' learning core tests passed');
