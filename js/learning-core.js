/* Learning helpers: pure functions for passage exercises, feedback and listening. */
(function(root){
'use strict';
function words(s){return String(s||'').toLowerCase().replace(/[’‘]/g,"'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g)||[];}
function normal(s){return words(s).join(' ');}
function hash(s){var h=2166136261;Array.from(String(s)).forEach(function(c){h=Math.imul(h^c.charCodeAt(0),16777619);});return (h>>>0).toString(36);}
function sentences(a){
  var out=[],segmenter;
  try{if(typeof Intl!=='undefined'&&Intl.Segmenter)segmenter=new Intl.Segmenter('en',{granularity:'sentence'});}catch(e){}
  (a.paragraphs||[]).forEach(function(p,pi){
    var parts=segmenter?Array.from(segmenter.segment(p),function(x){return x.segment;}):String(p).split(/(?<=[.!?])\s+(?=[A-Z"“])/);
    parts.forEach(function(s){s=s.trim();if(s)out.push({text:s,paragraph:pi,index:out.length,id:hash(s)});});
  });return out;
}
function compare(user,expected){
  var a=words(user).slice(0,300),b=words(expected).slice(0,300),m=a.length,n=b.length,L=[];
  for(var i=0;i<=m;i++)L.push(new Array(n+1).fill(0));
  for(i=m-1;i>=0;i--)for(var j=n-1;j>=0;j--)L[i][j]=a[i]===b[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  var parts=[];i=0;j=0;
  while(i<m||j<n){
    if(i<m&&j<n&&a[i]===b[j]){parts.push({kind:'equal',text:b[j]});i++;j++;}
    else if(i<m&&(j===n||L[i+1][j]>=L[i][j+1])){parts.push({kind:'extra',text:a[i++]});}
    else parts.push({kind:'missing',text:b[j++]});
  }
  return {exact:m===n&&L[0][0]===n,score:Math.round(100*L[0][0]/Math.max(m,n,1)),parts:parts};
}
function clean(s){return String(s||'').replace(/\*\*|`/g,'').trim();}
function category(issue){
  if(/指代|代词|主语/.test(issue))return '指代与主语';
  if(/否定|not|否认/.test(issue))return '否定关系';
  if(/数字|比例|倍|单位|数量/.test(issue))return '数字与比例';
  if(/从句|结构|语序|长句|修饰/.test(issue))return '句子结构';
  if(/漏译|漏掉|遗漏/.test(issue))return '信息完整性';
  return '词义与搭配';
}
function extract(feedback,source){
  var blocks=String(feedback||'').split(/(?=^>\s*)/m),out=[],seen={};
  blocks.forEach(function(block){
    var lines=block.split('\n'),quote=[];
    while(lines.length&&/^>/.test(lines[0]))quote.push(lines.shift().replace(/^>\s*/,''));
    var original=clean(quote.join(' '));if(words(original).length<3||!normal(source).includes(normal(original)))return;
    var rest=lines.join('\n');
    var correction=rest.match(/^\s*[-*]?\s*(?:\*\*)?改为(?:\*\*)?\s*[:：]\s*(.+)$/m);
    var problem=rest.match(/^\s*[-*]?\s*(?:\*\*)?问题(?:\*\*)?\s*[:：]\s*(.+)$/m);
    if(!correction||!problem)return;
    var answer=clean(correction[1]),issue=clean(problem[1]);
    if(!/[\u4e00-\u9fff]/.test(answer)||/没有明显错误|无需修改|译得准确/.test(issue))return;
    var key=hash(normal(original));if(seen[key])return;seen[key]=1;
    out.push({original:original,answer:answer,issue:issue,category:category(issue)});
  });return out.slice(0,6);
}
var BASIC=new Set(('a an the and or but so if then as at by for from in into of off on out over to up with without about after before between during through under above is am are was were be been being have has had do does did will would can could may might must should shall not no yes it its they them their we us our you your he him his she her i me my this that these those there here who whom whose what which when where why how all any each every some many much more most less few little other another one two first new also very just only than too now even such both either neither while although because until still already once again same own part well way make made get got go went come came take took give gave use used people year years day days time world country countries says said say according however per cent percent million billion about around almost nearly through including together').split(' '));
function analyze(a,knowledge,forms){
  var all=words((a.paragraphs||[]).join(' ')),unique=Array.from(new Set(all.filter(function(w){return /^[a-z]/.test(w)&&w.length>2&&!BASIC.has(w);}))),known=[],unknown=[],unrated=[];
  unique.forEach(function(w){
    var candidates=forms?forms(w):[w],status;
    for(var i=0;i<candidates.length;i++){if(knowledge[candidates[i]]!=null){status=knowledge[candidates[i]];break;}}
    if(status===true)known.push(w);else if(status===false)unknown.push(w);else unrated.push(w);
  });
  var knownSet=new Set(unknown),burden=all.filter(function(w){return knownSet.has(w);}).length*100/Math.max(all.length,1);
  var sent=sentences(a),avg=all.length/Math.max(sent.length,1);
  return {wordCount:all.length,sentenceLength:Math.round(avg),known:known,unknown:unknown,unrated:unrated,observed:known.length+unknown.length,total:unique.length,
    burden:Math.round(burden*10)/10,score:burden*4+avg*.6+all.length/90};
}
function validQuestions(a){
  return (Array.isArray(a.questions)?a.questions:[]).filter(function(q){
    return q&&typeof q.id==='string'&&/^[A-Za-z0-9_-]+$/.test(q.id)&&typeof q.prompt==='string'&&Array.isArray(q.options)&&q.options.length>=2&&q.options.length<=6&&q.options.every(function(x){return typeof x==='string';})&&Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length&&Array.isArray(q.evidence)&&q.evidence.length>0&&q.evidence.every(function(e){return e&&Number.isInteger(e.paragraph)&&typeof e.quote==='string'&&e.quote.length>0&&typeof a.paragraphs[e.paragraph]==='string'&&a.paragraphs[e.paragraph].includes(e.quote);});
  });
}
root.LearningCore={words:words,normal:normal,hash:hash,sentences:sentences,compare:compare,extract:extract,category:category,analyze:analyze,validQuestions:validQuestions};
})(typeof window!=='undefined'?window:globalThis);
