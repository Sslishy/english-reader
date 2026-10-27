/* 间隔重复（艾宾浩斯遗忘曲线）调度——纯函数，无 DOM 依赖。
 * stage = 连续答对次数（0..6）。答对后按 INTERVALS[stage] 天后再复习，然后 stage+1。
 * stage 达到 6 = 已掌握，之后每 MASTERED_INTERVAL 天抽查一次。答错：stage 归 0，明天再复习。
 * 日期一律用 'YYYY-MM-DD' 字符串，按 UTC 计算，避免时区/夏令时误差。 */
(function (root) {
  'use strict';
  var INTERVALS = [1, 2, 4, 7, 15, 30];
  var MAX_STAGE = INTERVALS.length;      // 6 = mastered
  var MASTERED_INTERVAL = 60;
  var TYPES = ['spell', 'en2zh', 'zh2en', 'cloze', 'gaps'];
  function pad(n) { return String(n).padStart(2, '0'); }
  function parse(ymd) { var p = String(ymd).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fmt(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(ymd, n) { return fmt(parse(ymd) + n * 864e5); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s)); }
  function init(today) { return { stage: 0, due: today, reps: 0, lapses: 0, last: '', added: today, qn: 0 }; }
  function normalize(s, today) {
    s = Object.assign(init(today), s || {});
    s.stage = Math.max(0, Math.min(MAX_STAGE, s.stage | 0));
    if (!isYmd(s.due)) s.due = today;
    return s;
  }
  /* 首次作答：答对晋级，答错重置 */
  function answer(srs, correct, today) {
    var s = Object.assign({}, srs);
    s.reps = (s.reps || 0) + 1; s.qn = (s.qn || 0) + 1; s.last = today;
    if (correct) {
      if (s.stage >= MAX_STAGE) { s.stage = MAX_STAGE; s.due = addDays(today, MASTERED_INTERVAL); }
      else { s.due = addDays(today, INTERVALS[s.stage]); s.stage += 1; }
    } else {
      s.stage = 0; s.lapses = (s.lapses || 0) + 1; s.due = addDays(today, 1);
    }
    return s;
  }
  /* 同一轮里答错后的重练：不改变进度，只轮换题型 */
  function practice(srs) { var s = Object.assign({}, srs); s.qn = (s.qn || 0) + 1; return s; }
  function isDue(srs, today) { return !!srs && srs.due <= today; }
  function dueList(vocab, today, cap) {
    var list = vocab.filter(function (v) { return isDue(v.srs, today); });
    list.sort(function (a, b) { return a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : (a.srs.stage - b.srs.stage); });
    return cap ? list.slice(0, cap) : list;
  }
  /* 未来 days 天每天到期数量（逾期计入今天） */
  function forecast(vocab, today, days) {
    var out = [];
    for (var i = 0; i < days; i++) out.push({ date: addDays(today, i), count: 0 });
    vocab.forEach(function (v) {
      if (!v.srs) return;
      var d = Math.max(0, diffDays(today, v.srs.due));
      if (d < days) out[d].count++;
    });
    return out;
  }
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  /* 每个词的题型按 拼写 → 英译汉 → 汉译英 → 句子填空 → 补全字母 轮换；起点由单词决定 */
  function qtype(word, srs) { return TYPES[(hash(word) + ((srs && srs.qn) || 0)) % TYPES.length]; }
  function stageLabel(srs, today) {
    if (!srs) return '';
    if (srs.stage >= MAX_STAGE) return '已掌握';
    return '阶段 ' + srs.stage + '/' + MAX_STAGE;
  }
  root.SRS = { INTERVALS: INTERVALS, MAX_STAGE: MAX_STAGE, MASTERED_INTERVAL: MASTERED_INTERVAL, TYPES: TYPES,
    addDays: addDays, diffDays: diffDays, isYmd: isYmd, init: init, normalize: normalize, answer: answer, practice: practice,
    isDue: isDue, dueList: dueList, forecast: forecast, qtype: qtype, stageLabel: stageLabel, hash: hash };
})(typeof window !== 'undefined' ? window : this);
