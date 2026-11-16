/* App data integration tests. Run: node tests/test_storage.js
 * The DOM stub only hosts app initialization; all persistence code is real. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

function app(seed = {}, raw = {}) {
  const stored = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  for (const [key, value] of Object.entries(raw)) stored.set(key, String(value));
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', hidden: false, dataset: {},
      classList: {add() {}, remove() {}, toggle() {}, contains() {return false;}},
      style: {setProperty() {}}, addEventListener() {},
      querySelectorAll() {return [];}, querySelector() {return null;}, focus() {}
    });
    return elements.get(id);
  }
  const ctx = vm.createContext({
    console, URLSearchParams, Date, setTimeout() {return 1;}, clearTimeout() {},
    location: {search: '?today=2026-11-02', hash: '#/vocab', protocol: 'http:'},
    navigator: {maxTouchPoints: 0}, Audio: function () {},
    document: {getElementById: element, documentElement: element('html'),
      addEventListener() {}, querySelectorAll() {return [];}, createElement: element},
    localStorage: {getItem: key => stored.has(key) ? stored.get(key) : null,
      setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key)},
    addEventListener() {}
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/vendor/ts-fsrs-5.2.3.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/srs.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/review-plan.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), ctx);
  return {ER: ctx.ER, SRS: ctx.SRS, stored, element};
}

let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }

test('New defaults and explicit stored study settings', () => {
  const fresh = app();
  assert.equal(fresh.ER.settings.newPerDay, 3);
  assert.equal(fresh.ER.settings.reviewMode, 'dictation');
  assert.equal(fresh.ER.settings.reviewLimit, 30);
  assert.deepEqual(clone(fresh.ER.settings.reviewLimits),{dictation:30,reading:30,balanced:30});
  const previous = app({er_settings: {newPerDay: 0, reviewMode: 'balanced'}});
  assert.equal(previous.ER.settings.newPerDay, 0);
  assert.equal(previous.ER.settings.reviewMode, 'dictation');
  const explicit = app({er_settings:{newPerDay:0,reviewMode:'balanced',reviewPolicy:7,reviewLimit:10}});
  assert.equal(explicit.ER.settings.reviewMode,'balanced');assert.equal(explicit.ER.settings.reviewLimit,10);
  const v6=app({er_settings:{newPerDay:0,reviewMode:'reading',reviewPolicy:6,reviewLimit:15}});
  assert.equal(v6.ER.settings.newPerDay,0);assert.equal(v6.ER.settings.reviewMode,'reading');assert.equal(v6.ER.settings.reviewLimits.reading,30);
});

test('Nested skill progress and history survive backup, replacement, and reload', () => {
  const a = app();
  const v = a.ER.addWord({word: 'retain', zh: '记住；保留'});
  v.srs = a.SRS.record(v.srs, {skill: 'meaning', rating: 'good', date: '2026-11-02', self: true});
  v.srs = a.SRS.record(v.srs, {skill: 'spelling', rating: 'again', date: '2026-11-02'});
  v.srs.customMetadata = {source: 'future-extension'};
  a.ER.saveVocab();
  const expected = clone(v.srs);
  const b = app();
  b.ER.applyBackup(clone(a.ER.buildBackup()), 'replace');
  assert.deepEqual(clone(b.ER.findWord('retain').srs), expected);
  const reloaded = app({er_vocab: JSON.parse(b.stored.get('er_vocab'))});
  assert.deepEqual(clone(reloaded.ER.findWord('retain').srs), expected);
});

test('Higher independent mode limits survive backup and reload without resetting the budget', () => {
  const cfg={reviewPolicy:7,reviewMode:'dictation',reviewLimit:30,reviewLimits:{dictation:100,reading:50,balanced:70},newPerDay:0};
  const daily={date:'2026-11-02',newDone:0,modes:{dictation:{reviewWords:['retain']}}};
  const a=app({er_settings:cfg,er_daily:daily});
  const b=app();b.ER.applyBackup(clone(a.ER.buildBackup()),'replace');
  const c=app({er_settings:JSON.parse(b.stored.get('er_settings')),er_daily:JSON.parse(b.stored.get('er_daily'))});
  assert.deepEqual(clone(c.ER.settings.reviewLimits),cfg.reviewLimits);
  assert.deepEqual(JSON.parse(c.stored.get('er_daily')).modes.dictation.reviewWords,['retain']);
});

test('Policy 7 startup keeps stored study data and leaves device-local keys out of backup and sync', () => {
  const fsrs = {version:6,stability:4.5,difficulty:5.1,reps:2,lapses:0,scheduled_days:21,last_review:'2026-10-30'};
  const vocab = [{word:'retain', type:'word', zh:'记住', source:'manual', date:'2026-10-20', updatedAt:10, srs:{
    stage:2,due:'2026-11-20',reps:2,lapses:0,last:'2026-10-30',added:'2026-10-20',qn:2,
    skills:{
      meaning:{active:true,stage:2,due:'2026-11-20',reps:2,lapses:0,last:'2026-10-30',fsrs},
      spelling:{active:true,stage:2,due:'2026-11-20',reps:2,lapses:0,last:'2026-10-30',fsrs}
    }
  }}];
  const settings = {accent:'en-US',auto:false,size:'20',email:'',newPerDay:3,cet6:false,reviewMode:'dictation',reviewPolicy:7,reviewLimit:15,reviewLimits:{dictation:15,reading:20,balanced:5},retention:.9};
  const daily = {date:'2026-11-02',newDone:1,reviewWords:['retain'],introducedWords:['retain'],modes:{dictation:{reviewWords:['retain']},reading:{reviewWords:['other']}}};
  const session = {version:5,date:'2026-11-02',sessions:{dictation:{limit:15,session:{queue:[{word:'retain',skill:'spelling'}],targets:{},mode:'dictation',marker:'session-only-marker'}}}};
  const learning = {'lesson:2026-11-02:0':{updatedAt:5,lesson:'kept lesson'}};
  const translations = {'2026-11-02#0':{text:'draft',updatedAt:4}};
  const snapshot = {date:'2026-11-01',at:'2026-11-01T00:00:00.000Z',n:1,vocab};
  const seed = {
    er_vocab: vocab,
    er_vocab_backup: snapshot,
    er_vocab_deleted: {gone: 100},
    er_tr: translations,
    er_settings: settings,
    er_settings_at: 123456,
    er_daily: daily,
    er_cet_seen: {alpha:'known'},
    er_para_zh: true,
    er_cache: {retain:'cache-marker-only'},
    er_learning: learning,
    er_review_session: session,
    er_sync_meta: {gistId:'gist-kept',state:'ok',marker:'sync-meta-marker'}
  };
  const raw = {er_ds_key:'sk-test-only-compat', er_sync_token:'device-sync-token-test-only'};
  const before = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  for (const [key, value] of Object.entries(raw)) before.set(key, value);
  const a = app(seed, raw);
  for (const [key, value] of before) assert.equal(a.stored.get(key), value, key);
  assert.equal(a.ER.settings.reviewPolicy, 7);
  assert.equal(a.ER.settings.reviewMode, 'dictation');
  assert.equal(a.ER.settings.reviewLimit, 15);
  assert.equal(a.ER.settings.retention, 0.9);
  assert.deepEqual(clone(a.ER.settings.reviewLimits), settings.reviewLimits);
  assert.equal(a.ER.findWord('retain').srs.skills.meaning.fsrs.stability, 4.5);
  assert.equal(a.ER.findWord('retain').srs.skills.spelling.fsrs.stability, 4.5);
  const exported = JSON.stringify(a.ER.buildBackup());
  const synced = JSON.stringify(a.ER.syncState());
  for (const blob of [exported, synced]) {
    assert.equal(blob.includes('sk-test-only-compat'), false);
    assert.equal(blob.includes('device-sync-token-test-only'), false);
    assert.equal(blob.includes('session-only-marker'), false);
    assert.equal(blob.includes('cache-marker-only'), false);
    assert.equal(blob.includes('sync-meta-marker'), false);
  }
  assert.equal(a.ER.syncState().settings.reviewPolicy, 7);
  assert.deepEqual(clone(a.ER.syncState().settings.reviewLimits), settings.reviewLimits);
  assert.deepEqual(clone(a.ER.syncState().daily.modes.dictation.reviewWords), ['retain']);
});

test('Empty in-memory vocabulary cannot replace a stored list', () => {
  const a = app({er_vocab:[{word:'retain',zh:'记住',srs:{added:'2026-11-02'}}]});
  a.ER.getVocab().length = 0;
  assert.equal(a.ER.saveVocab(), false);
  assert.equal(JSON.parse(a.stored.get('er_vocab'))[0].word, 'retain');
});

test('Remote merge keeps the newer whole skill record and its history', () => {
  const a = app();
  a.ER.addWord({word: 'retain', zh: '记住'});
  const remote = clone(a.ER.syncState());
  remote.vocab[0].srs = a.SRS.record(remote.vocab[0].srs, {
    skill: 'usage', rating: 'hard', date: '2026-11-02', assisted: true
  });
  remote.vocab[0].updatedAt += 100;
  a.ER.mergeRemoteState(remote);
  assert.deepEqual(clone(a.ER.findWord('retain').srs), clone(remote.vocab[0].srs));
  assert.deepEqual(clone(a.ER.syncState().vocab[0].srs.history), clone(remote.vocab[0].srs.history));
});

test('Old known words return as spot checks and survive stale remote tombstones', () => {
  const tomb = Date.now() + 1000;
  const a = app({er_cet_seen: {retain: 'known', existing: 'known'}, er_vocab_deleted: {retain: tomb}});
  a.ER.addWord({word: 'existing', zh: '现有的'});
  const entries = [{word: 'retain', level: 'cet4', zh: '记住', ex: 'We retain the key facts.'},
    {word: 'existing', level: 'cet4', zh: '现有的'}];
  assert.equal(a.ER.restoreKnownWords(entries), 1);
  const restored = a.ER.findWord('retain');
  assert.equal(restored.srs.skills.meaning.due, '2026-11-09');
  assert.equal(a.SRS.isMastered(restored.srs), false);
  assert.ok(restored.updatedAt > tomb);
  assert.equal(JSON.parse(a.stored.get('er_cet_seen')).retain, 'learn');
  assert.equal(a.ER.restoreKnownWords(entries), 0);
  a.ER.mergeRemoteState({app: 'english-reader', vocab: [], tombstones: {retain: tomb}});
  assert.ok(a.ER.findWord('retain'));
  assert.ok(a.ER.findWord('existing'));
});

test('Badge counts available mode practice even if only another skill is due', () => {
  const a = app();
  const v = a.ER.addWord({word: 'retain', zh: '记住'});
  v.srs = a.SRS.record(v.srs, {skill: 'meaning', rating: 'good', date: '2026-11-02'});
  v.srs = a.SRS.record(v.srs, {skill: 'spelling', rating: 'again', date: '2026-11-01'});
  v.srs.skills.meaning.due='2026-11-15';a.ER.setToday('2026-11-03');
  a.ER.saveVocab();
  a.ER.settings.reviewMode = 'reading'; a.ER.updateBadge();
  assert.equal(a.element('dueBadge').hidden, false);
  a.ER.settings.reviewMode = 'balanced'; a.ER.updateBadge();
  assert.equal(a.element('dueBadge').hidden, false);
  assert.equal(a.element('dueBadge').textContent, 1);
});
test('Daily admissions merge independently for each mode across devices',()=>{
  const a=app({er_daily:{date:'2026-11-02',newDone:1,reviewWords:['alpha'],introducedWords:['alpha'],modes:{dictation:{reviewWords:['alpha']}}}});
  a.ER.mergeRemoteState({app:'english-reader',daily:{date:'2026-11-02',newDone:1,reviewWords:['beta'],introducedWords:['beta'],modes:{reading:{reviewWords:['beta']},dictation:{reviewWords:['gamma']}}}});
  const d=JSON.parse(a.stored.get('er_daily'));
  assert.deepEqual(d.reviewWords.sort(),['alpha','beta']);assert.deepEqual(d.introducedWords.sort(),['alpha','beta']);
  assert.deepEqual(d.modes.dictation.reviewWords.sort(),['alpha','gamma']);assert.deepEqual(d.modes.reading.reviewWords,['beta']);
});

console.log(`${count} storage integration tests passed.`);
