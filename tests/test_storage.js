/* App data integration tests. Run: node tests/test_storage.js
 * The DOM stub only hosts app initialization; all persistence code is real. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

function app(seed = {}) {
  const stored = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
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
  assert.equal(fresh.ER.settings.reviewLimit, 15);
  const previous = app({er_settings: {newPerDay: 0, reviewMode: 'balanced'}});
  assert.equal(previous.ER.settings.newPerDay, 0);
  assert.equal(previous.ER.settings.reviewMode, 'dictation');
  const explicit = app({er_settings:{newPerDay:0,reviewMode:'balanced',reviewPolicy:6,reviewLimit:10}});
  assert.equal(explicit.ER.settings.reviewMode,'balanced');assert.equal(explicit.ER.settings.reviewLimit,10);
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

test('Reading badge excludes spelling-only backlog, balanced mode includes it', () => {
  const a = app();
  const v = a.ER.addWord({word: 'retain', zh: '记住'});
  v.srs = a.SRS.record(v.srs, {skill: 'meaning', rating: 'good', date: '2026-11-02'});
  v.srs = a.SRS.record(v.srs, {skill: 'spelling', rating: 'again', date: '2026-11-01'});
  v.srs.skills.meaning.due='2026-11-15';a.ER.setToday('2026-11-03');
  a.ER.saveVocab();
  a.ER.settings.reviewMode = 'reading'; a.ER.updateBadge();
  assert.equal(a.element('dueBadge').hidden, true);
  a.ER.settings.reviewMode = 'balanced'; a.ER.updateBadge();
  assert.equal(a.element('dueBadge').hidden, false);
  assert.equal(a.element('dueBadge').textContent, 1);
});
test('Daily admissions merge across devices instead of resetting the shared budget',()=>{
  const a=app({er_daily:{date:'2026-11-02',newDone:1,reviewWords:['alpha'],introducedWords:['alpha']}});
  a.ER.mergeRemoteState({app:'english-reader',daily:{date:'2026-11-02',newDone:1,reviewWords:['beta'],introducedWords:['beta']}});
  const d=JSON.parse(a.stored.get('er_daily'));
  assert.deepEqual(d.reviewWords.sort(),['alpha','beta']);assert.deepEqual(d.introducedWords.sort(),['alpha','beta']);
});

console.log(`${count} storage integration tests passed.`);
