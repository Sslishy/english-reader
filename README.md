# 📖 雅思阅读器 · 每日阅读 + 背单词

一个纯静态的英语学习小网站（为 IELTS 6.5 备考，适合 CET-4 / 雅思 5–5.5 水平的中文学习者）。
不需要后端、不需要构建，直接放到 GitHub Pages 即可使用；所有学习数据保存在浏览器 localStorage。

## 功能

| 页面 | 说明 |
|---|---|
| 📰 **今日阅读** | 打开即显示最新一篇文章（`articles/index.json` 第一项），带中文导读、重点词汇、原报道链接；下方是往期文章列表（`#/read/YYYY-MM-DD`）。 |
| 🔁 **复习** | 按艾宾浩斯遗忘曲线安排复习：答对后间隔 1 → 2 → 4 → 7 → 15 → 30 天，连续答对 6 次 = 已掌握（之后每 60 天抽查）；答错回到阶段 0、明天再复习，并在本轮稍后再考一次。每天自动取出到期词（最多 30 个，最早到期的优先）+ 约 10 个没学过的四级新词（可勾选「包含六级」，每天新词数可调）。新词先出卡片（单词、音标、中文、发音、例句），再测试，然后进入复习计划。题型 **拼写 / 英译汉 / 汉译英** 每个词轮换。结束后显示本轮总结和未来 14 天复习量。导航上的红色数字 = 今天到期的复习数。 |
| 📒 **生词本** | 搜索、排序、遮住中文、显示每个词的复习阶段和下次复习日期；导出 CSV；**导出 / 导入 JSON 备份**（合并或覆盖），用于手机 ⇄ 电脑迁移。 |
| ✏️ **自己粘贴** | 粘贴任意英文文章进入阅读模式（保留原来的功能和两篇示例）。 |

所有阅读模式中：电脑**双击**、手机**轻点**单词 → 弹出音标、中文释义、英文释义、例句、发音，可一键加入生词本（加入后当天就会出现在复习里）。

查词来源：Free Dictionary API（dictionaryapi.dev）→ 英文维基词典兜底；中文释义依次来自内置四六级词库、中文维基词典、MyMemory 翻译、英文维基词典译词。发音优先用词典音频，其次浏览器语音合成。

## 目录结构

```
index.html               页面骨架（导航 + 四个视图）
css/style.css            样式（移动端优先）
js/srs.js                间隔重复调度（纯函数）
js/app.js                工具、设置、查词、阅读、生词本、备份、路由
js/review.js             每日复习会话
articles/index.json      文章索引（新 → 旧）
articles/YYYY-MM-DD.json 每日文章
data/cet4.json           四级词表（4544 词）
data/cet6.json           六级词表（2118 词，不含四级已有词）
data/LICENSE-english-vocabulary.txt  词表来源许可证
scripts/add_article.py   校验并添加文章、更新索引
scripts/build_wordlists.py  从上游数据集重新生成 data/cet*.json
tests/test_site.py       Playwright 端到端测试
```

## 本地运行

浏览器不允许 `file://` 页面读取 JSON，所以请用本地服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

部署：把仓库推到 GitHub，Settings → Pages → Deploy from branch → `main` / root。所有路径都是相对路径。

## 每日文章 JSON 格式

`articles/YYYY-MM-DD.json`：

```json
{
  "date": "2026-10-23",                 // YYYY-MM-DD，也是文件名
  "title": "English title",
  "title_zh": "中文标题",
  "source_name": "媒体名称 / 原文标题",
  "source_url": "https://…",            // 原始报道链接
  "level": "B1–B2 · 雅思 5.5–6.5",
  "summary_zh": "中文导读",
  "paragraphs": ["段落 1", "段落 2"],     // 非空字符串数组
  "key_words": [                         // 可为空数组
    {"word": "emission", "phonetic": "/iˈmɪʃn/", "meaning_zh": "n. 排放；排放物"}
  ]
}
```

所有字符串字段必填且非空（`key_words[].phonetic` 可以是空字符串）。

`articles/index.json`：`[{"date": "2026-10-23", "title": "…", "file": "2026-10-23.json"}, …]`，按日期**从新到旧**排列，日期不重复。

### 添加文章

```bash
python3 scripts/add_article.py path/to/my-article.json   # 校验 → 复制为 articles/<date>.json → 更新 index.json（同日期覆盖，新→旧排序）
python3 scripts/add_article.py --validate-only file.json # 只校验
python3 scripts/add_article.py --check                   # 校验 index.json 中的全部文章
```

只用 Python 标准库。文章应为根据新闻**原创改写**的学习材料，`source_url` 指向真实报道。

## 数据与备份

localStorage 键：`er_vocab`（生词 + 每词的 `srs` 进度：`stage`、`due`、`reps`、`lapses`、`last`、`qn`）、`er_cet_seen`（已学/已标记认识的四六级词）、`er_daily`（今日已学新词数）、`er_settings`、`er_cache`（查词缓存）。
「导出备份」生成 `{"app":"english-reader","version":2,"data":{vocab, cetSeen, daily, settings}}`。
「导入（合并）」：两边都有的词保留最近复习过的那份进度；「导入（覆盖本地）」：完全用备份替换。

旧版单文件阅读器的生词本（同一个 `er_vocab` 键）会自动迁移：旧词进入阶段 0，当天到期。

## 四六级词表来源与许可

`data/cet4.json`、`data/cet6.json` 由 `scripts/build_wordlists.py` 从
[KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)（`full_line_jsonl/sentence/正序/四级.jsonl`、`六级.jsonl`）生成，
该数据集采用 **BSD 3-Clause License**（Copyright (c) 2022-2026, KyleBing），允许在保留版权声明和许可条款的前提下再分发，
许可证全文见 `data/LICENSE-english-vocabulary.txt`。
处理：去重（四级 7508 条 → 4544 个不同单词；六级 5651 条 → 3992 个，去掉与四级重复的后为 2118 个），
每词只保留：单词、音标（英音优先）、中文释义（≤60 字）、一条例句及其翻译。格式：
`{"meta":{…},"fields":["w","p","zh","ex","exzh"],"words":[[…],…]}`。新词按数据集原顺序出现（开头是高频核心词）。

## 测试

```bash
pip install playwright && playwright install chromium   # 或设置 CHROME=/path/to/chrome
python3 tests/test_site.py          # 查词接口被 mock，结果确定
python3 tests/test_site.py --live   # 额外做一次真实联网查词
```

测试通过 `?today=YYYY-MM-DD` 参数模拟日期（这个参数在正式使用中也可用来“穿越”调试，不影响数据格式），覆盖：文章载入、查词弹窗、加入生词本 → 进入复习、三种题型、答对晋级、答错重置并在本轮重现、四/六级新词、多日间隔 1/2/4/7/15/30 天 → 已掌握、导出/导入往返、粘贴模式、手机触屏、无 JS 错误。

## 已知限制

- 查词依赖第三方免费接口（dictionaryapi.dev、Wiktionary、MyMemory），偶尔会不可用或限额；会自动降级，四六级词库内的词离线也有中文释义。
- 发音依赖设备的语音合成；部分安卓浏览器没有英文语音时改用有道词典发音链接。
- 数据只在当前浏览器；清除浏览器数据会丢失，请定期导出备份。
- 每日文章需要手动（或由助手）用 `add_article.py` 添加，网站本身不会自动抓取新闻。
