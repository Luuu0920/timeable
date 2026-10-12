/* app.js 集成测试：在 jsdom 里真实加载 index.html + core.js + app.js，
   捕获运行时错误，并模拟关键用户流程。
   运行： NODE_PATH=<workspace>/node_modules node test/app.test.js
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; console.log('  \u2717 ' + name + '\n      ' + (e && e.message)); }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** 起一个干净的、已加载 core.js + app.js 的 jsdom 环境。
 *  opts.storage   —— 在脚本运行前预置 localStorage，用来模拟"这台设备此前用过"。
 *  opts.stubFetch —— 装上 fetch 桩（每拼一次 seed.json 就调用一次）。桩返回永不 resolve 的
 *                    Promise，避免异步回调污染同步断言。（jsdom 30 默认没有 window.fetch，
 *                    所以不装桩时 tryLoadSeed 会直接跳过。） */
function makeDom(opts) {
  opts = opts || {};
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/index.html',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.addEventListener('error', e => errors.push('window.error: ' + (e.message || e.error)));
      const origErr = win.console.error;
      win.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origErr.apply(win.console, a); };
      if (opts.storage) Object.keys(opts.storage).forEach(k => win.localStorage.setItem(k, opts.storage[k]));
      if (opts.stubFetch) {
        win.fetch = function (url) {
          // 记录调用；桩返回什么就用什么（默认给一个永不 resolve 的 Promise，
          // 这样只做"有没有发请求"的断言时不会有异步回调跑出来）
          var ret = opts.stubFetch(String(url));
          return ret === undefined ? new Promise(function () {}) : ret;
        };
      }
    }
  });
  const win = dom.window;
  ['core.js', 'app.js'].forEach(file => {
    const s = win.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, file), 'utf8');
    win.document.body.appendChild(s);
  });
  dom.__errors = errors;
  return dom;
}

// 主环境：供绝大多数用例共用
const mainDom = makeDom();
const win = mainDom.window;
const errors = mainDom.__errors;
const doc = win.document;
const $ = s => doc.querySelector(s);

// 手动注入脚本（jsdom 默认不加载同源外部 script，除非 resources:'usable'）
function evalScript(file) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const s = win.document.createElement('script');
  s.textContent = code;
  win.document.body.appendChild(s);
}

console.log('\n[app.js 加载]');

t('core.js 与 app.js 无语法/初始化错误', () => {
  if (!$('#hdTitle')) throw new Error('页面未初始化');
});

t('未产生 window 错误', () => {
  const real = errors.filter(e => !/Not implemented|Not supported/.test(e) &&
    !/serviceWorker|Notification/.test(e));
  if (real.length) throw new Error(real.join(' | '));
});

console.log('\n[首屏渲染]');

t('顶部标题渲染为"第 X 周"', () => {
  const txt = $('#hdTitle').textContent;
  if (!/第\s*-?\d+\s*周|学期/.test(txt)) throw new Error('实际标题: ' + txt);
});

t('周视图网格已生成（表头 7 列 + 时间轴）', () => {
  if (!$('.wk-head')) throw new Error('缺少 .wk-head');
  const cols = doc.querySelectorAll('.daycol');
  if (cols.length !== 7 && cols.length !== 5) throw new Error('daycol 数量=' + cols.length);
  const hours = doc.querySelectorAll('.hour');
  if (hours.length < 10) throw new Error('时间轴行数=' + hours.length);
});

t('底部导航 5 个入口都在（日历/课表/计划/说明/设置）', () => {
  const nav = doc.querySelectorAll('nav button');
  if (nav.length !== 5) throw new Error('导航按钮数=' + nav.length);
  const ps = Array.from(nav).map(b => b.dataset.p).join(',');
  if (ps !== 'week,course,plan,help,set') throw new Error('导航项顺序不对: ' + ps);
});

console.log('\n[注入课表数据 -> 周视图]');

// 用 2026-09-07 作为第1周周一（周一）
const sample = {
  version: 1,
  settings: {
    termStart: '2026-09-07', totalWeeks: 18, showWeekend: true,
    tableName: '测试学期',
    timeTable: win.Core.DEFAULT_TIME_TABLE
  },
  courses: [{
    id: 'c1', name: '高等数学', teacher: '张老师', color: '#4c6ef5',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 16, weekType: 'all', location: '教三201' }],
    overrides: []
  }, {
    id: 'c2', name: '大学英语', teacher: '李老师', color: '#12b886',
    sessions: [{ day: 3, startNode: 3, endNode: 4, startWeek: 1, endWeek: 16, weekType: 'odd', location: '外语楼A101' }],
    overrides: []
  }],
  events: [{
    id: 'e1', name: '健身', type: 'gym', date: '2026-09-07', start: '18:00', end: '19:00',
    location: '健身房', note: '', repeat: { mode: 'weekly', days: [1, 3, 5] }, reminders: [15]
  }, {
    id: 'e2', name: '高数期中考试', type: 'exam', date: '2026-10-22', start: '14:00', end: '16:00',
    location: '教三201', note: '', repeat: { mode: 'none' }, reminders: [30]
  }]
};

t('__ttDebug 能注入数据并触发重渲染', () => {
  if (typeof win.__ttDebug !== 'function') throw new Error('未暴露 __ttDebug');
  win.__ttDebug(sample);
});

t('周视图出现课程卡片', () => {
  const evs = doc.querySelectorAll('#weekWrap .ev');
  const names = Array.from(evs).map(e => e.querySelector('b').textContent);
  if (!names.some(n => n.includes('高等数学'))) throw new Error('未渲染高等数学: ' + names.join(','));
  if (!names.some(n => n.includes('健身'))) throw new Error('未渲染健身: ' + names.join(','));
});

t('考试倒计时横幅出现且含"还有 N 天"', () => {
  const cards = doc.querySelectorAll('#examBanner .examcard');
  if (!cards.length) throw new Error('没有考试横幅（可能今天>考试日？）');
  const all = Array.from(cards).map(c => c.textContent).join(' ');
  if (!/还有\s*\d+\s*天|今天/.test(all)) throw new Error('倒计天文案异常: ' + all);
});

t('课程数统计进入课表页', () => {
  const btn = Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.p === 'course');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const txt = $('#courseCount').textContent;
  if (!txt.includes('2')) throw new Error('实际: ' + txt);
});

t('课表页列出课程与时段描述', () => {
  const items = doc.querySelectorAll('#courseList .li');
  if (items.length !== 2) throw new Error('课程条数=' + items.length);
  const txt = items[0].textContent;
  if (!/周[一二三四五六日]/.test(txt) || !/第\d+-\d+节/.test(txt)) throw new Error('时段文案异常: ' + txt);
});

t('计划页列出计划并标注类型', () => {
  const btn = Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.p === 'plan');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const items = doc.querySelectorAll('#planList .li');
  if (items.length !== 2) throw new Error('计划条数=' + items.length);
  const all = Array.from(items).map(i => i.textContent).join(' ');
  if (!all.includes('健身') || !all.includes('高数期中考试')) throw new Error(all);
  if (!all.includes('每周')) throw new Error('未显示每周重复描述: ' + all);
});

t('计划页筛选"考试"只剩考试', () => {
  const f = doc.querySelector('#planFilter button[data-f="exam"]');
  f.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const items = doc.querySelectorAll('#planList .li');
  if (items.length !== 1) throw new Error('筛选后条数=' + items.length);
  if (!items[0].textContent.includes('高数期中考试')) throw new Error(items[0].textContent);
  // 复位
  doc.querySelector('#planFilter button[data-f="all"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
});

console.log('\n[添加计划流程]');

win.__ttDebug(sample); // 复位

t('打开"新建计划"弹层', () => {
  const add = $('#addPlanBtn');
  // 先切到计划页
  Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.p === 'plan')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  add.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if (!$('#mask').classList.contains('on')) throw new Error('弹层未打开');
  if (!$('#pName')) throw new Error('缺少名称输入框');
});

t('弹层默认有类型/重复方式选择', () => {
  if (!doc.querySelector('#typeSeg') || !doc.querySelector('#modeSeg')) throw new Error('缺少分段控件');
});

t('切换为"每周重复"后出现星期选择与结束日期', () => {
  const btn = doc.querySelector('#modeSeg button[data-m="weekly"]');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if (!$('#dayPick')) throw new Error('未出现星期选择');
  if (!$('#pUntil')) throw new Error('未出现重复截止日期');
});

t('切换为"隔周重复"后出现单双周选择', () => {
  const btn = doc.querySelector('#modeSeg button[data-m="biweekly"]');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if (!$('#paritySeg')) throw new Error('未出现单双周选择');
});

t('填写并保存新计划 -> 列表增加', () => {
  $('#pName').value = '线性代数考试';
  doc.querySelector('#typeSeg button[data-t="exam"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  doc.querySelector('#modeSeg button[data-m="none"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  $('#pDate').value = '2026-11-05';
  $('#pStart').value = '09:00';
  $('#pEnd').value = '11:00';
  $('#savePlanBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const items = doc.querySelectorAll('#planList .li');
  const all = Array.from(items).map(i => i.textContent).join(' ');
  if (items.length !== 3) throw new Error('保存后条数=' + items.length);
  if (!all.includes('线性代数考试')) throw new Error('未出现新计划: ' + all);
});

t('保存的计划带上了"考试"类型标签', () => {
  const item = Array.from(doc.querySelectorAll('#planList .li'))
    .find(i => i.textContent.includes('线性代数考试'));
  if (!item.textContent.includes('考试')) throw new Error(item.textContent);
});

t('新考试进入首页倒计时横幅', () => {
  Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.p === 'week')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const text = $('#examBanner').textContent;
  if (!text.includes('线性代数考试')) throw new Error('横幅未含新考试: ' + text);
});

console.log('\n[周次导航]');

/** 把周视图导航到第 n 周。
 *  不要用"点一次下一周就假设到了第 2 周"：__ttDebug 把 cursor 复位到「今天」所在周，
 *  于是断言会随真实日期漂移。2026-10-12 就踩中了——当天是第 6 周，下一周是第 7 周（单周），
 *  单周的英语课照样显示，测试假报警。改成显式导航，测试就与"今天几号"解耦。 */
function gotoWeek(n) {
  for (let i = 0; i < 60; i++) {
    const m = ($('#hdTitle').textContent.match(/第\s*(\d+)\s*周/) || [])[1];
    if (!m) return false;
    const cur = Number(m);
    if (cur === n) return true;
    $(cur < n ? '#nextBtn' : '#prevBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  }
  return false;
}

t('点"下一周"标题周次 +1', () => {
  win.__ttDebug(sample);
  if (!gotoWeek(3)) throw new Error('无法导航到第 3 周，当前: ' + $('#hdTitle').textContent);
  $('#nextBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const after = $('#hdTitle').textContent;
  if (!/第\s*4\s*周/.test(after)) throw new Error('期望第 4 周，实际: ' + after);
});

t('周切换后课程仍正确（第2周周三英语是单周 -> 不显示）', () => {
  win.__ttDebug(sample);
  if (!gotoWeek(2)) throw new Error('无法导航到第 2 周，当前: ' + $('#hdTitle').textContent);
  const names = Array.from(doc.querySelectorAll('#weekWrap .ev b')).map(b => b.textContent);
  if (names.some(n => n.includes('大学英语'))) {
    throw new Error('第2周(双周)不应出现单周的英语课: ' + names.join(','));
  }
});

t('单周课在第1周（奇数周）会出现', () => {
  win.__ttDebug(sample);
  if (!gotoWeek(1)) throw new Error('无法导航到第 1 周，当前: ' + $('#hdTitle').textContent);
  const names = Array.from(doc.querySelectorAll('#weekWrap .ev b')).map(b => b.textContent);
  if (!names.some(n => n.includes('大学英语'))) {
    throw new Error('第1周(单周)应出现英语课: ' + names.join(','));
  }
});

t('切到"日视图"渲染当日列表', () => {
  win.__ttDebug(sample);
  $('#mDay').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if ($('#weekWrap').style.display !== 'none') throw new Error('周视图未隐藏');
  if ($('#dayWrap').style.display === 'none') throw new Error('日视图未显示');
  if (!$('#dayWrap').textContent.length) throw new Error('日视图为空');
});

console.log('\n[设置页]');

t('设置页回填学期信息与作息表', () => {
  Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.p === 'set')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if ($('#setTermStart').value !== '2026-09-07') throw new Error('学期起始日=' + $('#setTermStart').value);
  if ($('#setTotalWeeks').value !== '18') throw new Error('总周数=' + $('#setTotalWeeks').value);
  const tt = doc.querySelectorAll('#ttList input');
  if (tt.length < 20) throw new Error('作息表输入框数=' + tt.length);
});

t('修改总周数并保存生效', () => {
  $('#setTotalWeeks').value = '16';
  $('#saveSettingsBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if (win.__dumpSettings().totalWeeks !== 16) throw new Error('未保存');
});

t('作息表改动写回 settings', () => {
  const inp = doc.querySelector('#ttList input.tt-s[data-i="0"]');
  inp.value = '07:30';
  inp.dispatchEvent(new win.Event('change', { bubbles: true }));
  if (win.__dumpSettings().timeTable[0].start !== '07:30') throw new Error('未写回');
});

console.log('\n[批量文本录入]');

t('粘贴文本 -> 预览 -> 导入课程', () => {
  win.__ttDebug(sample);
  const before = win.__dumpData().courses.length;

  // 通过界面打开"批量粘贴录入"
  Array.from(doc.querySelectorAll('nav button')).find(b => b.dataset.p === 'course')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  $('#pasteCourseBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const ta = $('#ptxt');
  if (!ta) throw new Error('未打开批量录入弹层');
  ta.value = '大学物理 周二 3-4节 1-16周 理科楼B201\n线性代数 周四 1-2节 单周 教二105';
  $('#pCheck').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const prev = $('#pPrev').textContent;
  if (!prev.includes('2')) throw new Error('预览未识别到 2 门课: ' + prev);

  $('#pOk').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const after = win.__dumpData().courses.length;
  if (after !== before + 2) throw new Error('导入后课程数=' + after + '，期望 ' + (before + 2));
});

t('批量导入的课程能出现在周视图', () => {
  // 用干净的页面验证（避免前面用例留下的 cursor 状态干扰）
  const d2 = makeDom();
  const w2 = d2.window, doc2 = w2.document;
  const C2 = w2.Core;
  const anchor = C2.mondayOf(C2.today());
  const base = C2.emptyData();
  base.settings.termStart = anchor;
  base.settings.totalWeeks = 20;
  const r = C2.parseCourseText('大学物理 周二 3-4节 1-16周 理科楼B201');
  base.courses = base.courses.concat(r.courses);
  w2.__ttDebug(base);
  const names = Array.from(doc2.querySelectorAll('#weekWrap .ev b')).map(b => b.textContent);
  if (!names.some(n => n.includes('大学物理'))) throw new Error('当前周未渲染大学物理: ' + names.join(','));
});

console.log('\n[编辑已有课程]');

t('点击课程列表项能打开编辑器并回填内容', () => {
  const d = makeDom();
  const win = d.window, doc = win.document;
  const C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  base.courses = [{
    id: 'c1', name: '高等数学', teacher: '赵老师', location: '教A楼101', color: '#4c6ef5',
    sessions: [{ day: 1, startNode: 3, endNode: 4, startWeek: 2, endWeek: 16, weekType: 'all', location: '教A楼101' }],
    overrides: []
  }];
  win.__ttDebug(base);

  doc.querySelector('nav button[data-p="course"]').click();
  const li = doc.querySelector('#courseList .li');
  if (!li) throw new Error('课程列表没有条目');
  li.click();   // 曾经这里抛 overrideRows is not defined

  const sheet = doc.querySelector('#sheet');
  if (!sheet.querySelector('#cName')) throw new Error('编辑器未打开（没有课程名输入框）');
  if (sheet.querySelector('#cName').value !== '高等数学') throw new Error('课程名未回填');
  // 已有课程才有的区块
  if (!sheet.querySelector('#delCourseBtn')) throw new Error('缺少删除课程按钮');
  if (!sheet.querySelector('#ovBox')) throw new Error('缺少调课区块');
  if (sheet.querySelector('#ovBox').textContent.length === 0) throw new Error('调课区块为空');
});

t('编辑课程后保存能改写数据', () => {
  const d = makeDom();
  const win = d.window, doc = win.document;
  const C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  base.courses = [{
    id: 'c1', name: '高等数学', teacher: '', location: '', color: '#4c6ef5',
    sessions: [{ day: 1, startNode: 3, endNode: 4, startWeek: 2, endWeek: 16, weekType: 'all', location: '' }],
    overrides: []
  }];
  win.__ttDebug(base);
  doc.querySelector('nav button[data-p="course"]').click();
  doc.querySelector('#courseList .li').click();

  const sheet = doc.querySelector('#sheet');
  sheet.querySelector('#cName').value = '高等数学B';
  // 用虚构教师名：这个文件会随目录部署到公网，别把真人姓名写进测试夹具
  sheet.querySelector('#cTeacher').value = '张明';
  sheet.querySelector('#saveCourseBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const after = win.__dumpData().courses[0];
  if (after.name !== '高等数学B') throw new Error('课程名未保存: ' + after.name);
  if (after.teacher !== '张明') throw new Error('教师未保存: ' + after.teacher);
});

console.log('\n[周视图时间轴与配色]');

t('时间轴按作息表节次渲染（不是整点）', () => {
  const d = makeDom();
  const win = d.window, doc = win.document;
  const C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  // 自定义 3 节作息，时间故意不用整点
  base.settings.timeTable = [
    { start: '08:05', end: '08:50' },
    { start: '09:10', end: '09:55' },
    { start: '10:15', end: '11:00' }
  ];
  win.__ttDebug(base);

  const hours = Array.from(doc.querySelectorAll('#weekWrap .hours .hour'));
  if (hours.length !== 3) throw new Error('时间轴节数=' + hours.length + '，期望 3');
  const txt = hours.map(h => h.textContent).join('|');
  if (!txt.includes('第1节') || !txt.includes('08:05')) throw new Error('未按节次渲染: ' + txt);
  if (!txt.includes('第3节') || !txt.includes('10:15')) throw new Error('第3节缺失: ' + txt);
});

t('节次轴与课程卡片同一原点（第一节前的空档有占位）', () => {
  const d = makeDom();
  const win = d.window, doc = win.document;
  const C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  // 第一节 08:05 开始，而轴从 7:00 起画 → 顶部必须有 65 分钟的占位，
  // 否则整条节次轴上移，看起来「第 1 节的课排到了第 2 节」
  base.settings.timeTable = [
    { start: '08:05', end: '08:50' },
    { start: '09:10', end: '09:55' }
  ];
  base.courses = [{
    id: 'c1', name: '第一节演示课', teacher: '', location: '', color: '#4c6ef5',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 20, weekType: 'all', location: '' }],
    overrides: []
  }];
  win.__ttDebug(base);

  const pad = doc.querySelector('#weekWrap .hours .hourPad');
  if (!pad) throw new Error('缺少 .hourPad 占位块');
  const expected = ((8 * 60 + 5) / 60 - 7) * 56;   // (08:05 - 07:00) * HOUR_H
  const got = parseFloat(pad.style.height);
  if (Math.abs(got - expected) > 1) throw new Error('占位高度 ' + got + 'px，期望约 ' + expected.toFixed(1) + 'px');

  // 第一张课程卡片（第1-2节）的 top 应等于占位高度（都从 08:05 起算）
  const ev = doc.querySelector('#weekWrap .ev');
  if (!ev) throw new Error('周视图未渲染出课程卡片');
  const evTop = parseFloat(ev.style.top);
  if (Math.abs(evTop - expected) > 1) throw new Error('卡片 top ' + evTop + 'px 与节次轴原点 ' + expected.toFixed(1) + 'px 不对齐');
});


t('每门课程使用自己的颜色', () => {
  const d = makeDom();
  const win = d.window, doc = win.document;
  const C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  base.courses = [
    { id: 'a', name: '语文', teacher: '', location: '', color: '#ff0000',
      sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 20, weekType: 'all', location: '' }], overrides: [] },
    { id: 'b', name: '数学', teacher: '', location: '', color: '#00ff00',
      sessions: [{ day: 2, startNode: 1, endNode: 2, startWeek: 1, endWeek: 20, weekType: 'all', location: '' }], overrides: [] }
  ];
  win.__ttDebug(base);

  const evs = Array.from(doc.querySelectorAll('#weekWrap .ev'));
  if (evs.length < 2) throw new Error('事件数不足: ' + evs.length);
  const colors = evs.map(e => e.style.background || e.style.backgroundColor);
  if (!colors.some(c => c.includes('255, 0, 0') || c.includes('#ff0000') || c.includes('rgb(255, 0, 0)')))
    throw new Error('未应用自定义颜色: ' + JSON.stringify(colors));
  if (colors[0] === colors[1]) throw new Error('两门课颜色相同: ' + colors[0]);
});

/* ------------------------------------------------------------ 待办 */
console.log('\n[待办类型]');

/** 造一个"今天有一个待办"的环境 */
function makeTodoDom(extra) {
  const d = makeDom();
  const win = d.window, doc = win.document;
  const C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  base.events = [Object.assign({
    id: 'td1', name: '交实验报告', type: 'todo', date: C.today(),
    start: '09:00', end: '09:00', repeat: { mode: 'none' }, reminders: [], doneDays: []
  }, extra || {})];
  win.__ttDebug(base);
  return { d, win, doc, C };
}

t('计划筛选栏出现"待办"入口', () => {
  const d = makeDom();
  const doc = d.window.document;
  const btn = doc.querySelector('#planFilter button[data-f="todo"]');
  if (!btn) throw new Error('缺少待办筛选按钮');
  if (btn.textContent.trim() !== '待办') throw new Error('文案不符: ' + btn.textContent);
});

t('新建计划弹层里"待办"是第一个类型选项', () => {
  const d = makeDom();
  const doc = d.window.document, win = d.window;
  doc.querySelector('nav button[data-p="plan"]').click();
  doc.querySelector('#addPlanBtn').click();
  const btns = Array.from(doc.querySelectorAll('#typeSeg button')).map(b => b.textContent);
  if (btns[0] !== '待办') throw new Error('类型顺序: ' + btns.join(','));
  if (!btns.includes('健身') || !btns.includes('考试')) throw new Error('缺少原有类型: ' + btns.join(','));
});

t('选"待办"后隐藏开始/结束时间输入', () => {
  const d = makeDom();
  const doc = d.window.document;
  doc.querySelector('nav button[data-p="plan"]').click();
  doc.querySelector('#addPlanBtn').click();
  // 新建默认就是"待办" -> 没有时间输入
  if (doc.querySelector('#sheet #pStart')) throw new Error('待办不该有开始时间输入框');
  if (doc.querySelector('#sheet #pEnd')) throw new Error('待办不该有结束时间输入框');
  // 切到"考试" -> 时间行出现
  const examBtn = Array.from(doc.querySelectorAll('#typeSeg button')).find(b => b.textContent === '考试');
  examBtn.click();
  if (!doc.querySelector('#sheet #pStart')) throw new Error('切到考试后应出现时间输入框');
  if (!doc.querySelector('#sheet #pEnd')) throw new Error('切到考试后应出现结束时间输入框');
  // 再切回"待办" -> 时间行又消失
  const todoBtn = Array.from(doc.querySelectorAll('#typeSeg button')).find(b => b.textContent === '待办');
  todoBtn.click();
  if (doc.querySelector('#sheet #pStart')) throw new Error('切回待办后时间框应消失');
});

t('保存一个待办 -> 计划页出现并带待办标签', () => {
  const d = makeDom();
  const win = d.window, doc = win.document;
  doc.querySelector('nav button[data-p="plan"]').click();
  doc.querySelector('#addPlanBtn').click();
  doc.querySelector('#sheet #pName').value = '买教材';
  doc.querySelector('#sheet #savePlanBtn').click();

  const data = win.__dumpData();
  const todo = data.events.filter(e => e.type === 'todo')[0];
  if (!todo) throw new Error('待办没有保存');
  if (todo.name !== '买教材') throw new Error('名称不对: ' + todo.name);
  if (!Array.isArray(todo.doneDays)) throw new Error('doneDays 未初始化为数组');

  const lis = Array.from(doc.querySelectorAll('#planList .li'));
  const hit = lis.find(li => li.textContent.includes('买教材'));
  if (!hit) throw new Error('计划页没有这条待办');
  if (!hit.querySelector('.tag.t-todo')) throw new Error('缺少待办标签');
  if (!hit.querySelector('.todoTick')) throw new Error('缺少勾选圆点');
});

t('点勾选圆点 -> 变为已完成（列表加删除线）', () => {
  const { doc, win, C } = makeTodoDom();
  doc.querySelector('nav button[data-p="plan"]').click();
  const li = doc.querySelector('#planList .li');
  const tick = li.querySelector('.todoTick');
  if (tick.classList.contains('on')) throw new Error('初始不该是已完成');

  tick.click();

  const after = doc.querySelector('#planList .li');
  if (!after.classList.contains('todo-done')) throw new Error('未加上完成样式');
  if (!after.querySelector('.todoTick').classList.contains('on')) throw new Error('勾选态未更新');
  const ev = win.__dumpData().events[0];
  if (C.isDoneOn(ev.doneDays, C.today()) !== true) throw new Error('完成状态没写进数据');
});

t('再点一次 -> 取消完成', () => {
  const { doc, win, C } = makeTodoDom({ doneDays: ['x'] });   // doneDays 用今天
  const C2 = win.Core;
  // 先把数据改成"今天已完成"
  const data = win.__dumpData();
  data.events[0].doneDays = [C2.today()];
  win.__ttDebug(data);
  doc.querySelector('nav button[data-p="plan"]').click();
  const li = doc.querySelector('#planList .li');
  if (!li.classList.contains('todo-done')) throw new Error('前置条件失败：应为已完成');
  li.querySelector('.todoTick').click();
  if (doc.querySelector('#planList .li').classList.contains('todo-done'))
    throw new Error('取消勾选后仍有完成样式');
  const ev = win.__dumpData().events[0];
  if (C.isDoneOn(ev.doneDays, C.today()) !== false) throw new Error('取消勾选没写回数据');
});

t('点勾选圆点不会打开编辑器', () => {
  const { doc } = makeTodoDom();
  doc.querySelector('nav button[data-p="plan"]').click();
  doc.querySelector('#planList .li .todoTick').click();
  const sheetText = doc.querySelector('#sheet').textContent;
  if (sheetText.includes('编辑计划')) throw new Error('点勾选圈不该打开编辑器');
});

t('点待办卡片其它区域 -> 打开编辑器', () => {
  const { doc } = makeTodoDom();
  doc.querySelector('nav button[data-p="plan"]').click();
  // 点标题区域（不是勾选圈）
  doc.querySelector('#planList .li .ttl').click();
  if (!doc.querySelector('#sheet #pName')) throw new Error('未打开编辑器');
  if (doc.querySelector('#sheet #pName').value !== '交实验报告') throw new Error('名称未回填');
});

t('周视图待办卡片有勾选圈，勾完后加 done 类', () => {
  const { doc, C, win } = makeTodoDom();
  // 切回周视图
  doc.querySelector('nav button[data-p="week"]').click();
  const ev = Array.from(doc.querySelectorAll('#weekWrap .ev')).find(e => e.dataset.id === 'td1');
  if (!ev) throw new Error('周视图没有待办卡片');
  if (!ev.classList.contains('todo')) throw new Error('缺少 todo class（配色用）');
  const box = ev.querySelector('[data-tick]');
  if (!box) throw new Error('周视图卡片缺少勾选圈');

  box.click();
  const ev2 = Array.from(doc.querySelectorAll('#weekWrap .ev')).find(e => e.dataset.id === 'td1');
  if (!ev2.classList.contains('done')) throw new Error('勾完后未加 done 类');
  const saved = win.__dumpData().events[0];
  if (C.isDoneOn(saved.doneDays, C.today()) !== true) throw new Error('完成状态没写进数据');
});

t('日视图待办显示"待办"而非时间段 + 可勾选', () => {
  const { doc, win, C } = makeTodoDom();
  // 切到日视图（模式切换按钮 id 是 #mDay / #mWeek）
  doc.querySelector('#mDay').click();
  const row = Array.from(doc.querySelectorAll('#dayWrap .dayrow')).find(r => r.dataset.id === 'td1');
  if (!row) throw new Error('日视图没有待办行');
  if (!row.querySelector('.tm').textContent.includes('待办')) throw new Error('时间列没显示"待办"');
  const tick = row.querySelector('[data-tick]');
  if (!tick) throw new Error('日视图缺少勾选圆点');
  tick.click();
  if (C.isDoneOn(win.__dumpData().events[0].doneDays, C.today()) !== true) throw new Error('日视图勾选未生效');
});

t('待办筛选只看待办', () => {
  const d = makeDom();
  const win = d.window, doc = win.document, C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  base.events = [
    { id: 'x1', name: '待办甲', type: 'todo', date: C.today(), start: '09:00', end: '09:00', repeat: { mode: 'none' }, reminders: [], doneDays: [] },
    { id: 'x2', name: '考试乙', type: 'exam', date: C.today(), start: '09:00', end: '11:00', repeat: { mode: 'none' }, reminders: [] }
  ];
  win.__ttDebug(base);
  doc.querySelector('nav button[data-p="plan"]').click();
  doc.querySelector('#planFilter button[data-f="todo"]').click();
  const txt = doc.querySelector('#planList').textContent;
  if (!txt.includes('待办甲')) throw new Error('待办没显示');
  if (txt.includes('考试乙')) throw new Error('非待办被显示出来了');
  if (doc.querySelector('#planCount').textContent !== '1 项') throw new Error('计数不对: ' + doc.querySelector('#planCount').textContent);
});

t('待办不参加首页考试倒计时', () => {
  const d = makeDom();
  const win = d.window, doc = win.document, C = win.Core;
  const base = C.emptyData();
  base.settings.termStart = C.mondayOf(C.today());
  base.events = [
    { id: 'y1', name: '交作业', type: 'todo', date: C.addDays(C.today(), 3), start: '09:00', end: '09:00', repeat: { mode: 'none' }, reminders: [], doneDays: [] }
  ];
  win.__ttDebug(base);
  const banner = doc.querySelector('#examBanner').textContent;
  if (banner.includes('交作业')) throw new Error('待办不应进考试倒计时');
});

t('重复待办：本周勾完不影响下周', () => {
  const d = makeDom();
  const win = d.window, doc = win.document, C = win.Core;
  const base = C.emptyData();
  // 让第 1 周锚定到本周，保证"本周一"存在
  base.settings.termStart = C.mondayOf(C.today());
  base.events = [{
    id: 'r1', name: '每周交总结', type: 'todo', date: C.mondayOf(C.today()),
    start: '20:00', end: '20:00', repeat: { mode: 'weekly', days: [1] }, reminders: [], doneDays: []
  }];
  win.__ttDebug(base);

  const thisMon = C.mondayOf(C.today());
  const nextMon = C.addDays(thisMon, 7);

  // 先在本天勾选
  const ev = Array.from(doc.querySelectorAll('#weekWrap .ev')).find(e => e.dataset.id === 'r1');
  ev.querySelector('[data-tick]').click();

  const saved = win.__dumpData().events[0];
  if (C.isDoneOn(saved.doneDays, thisMon) !== true) throw new Error('本周一未记录完成');
  if (C.isDoneOn(saved.doneDays, nextMon) !== false) throw new Error('下周被误标记为完成');
});

console.log('\n[首启引导 / 分享给别人用]');

const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed.json'), 'utf8'));

/** 同步 thenable：让 app.js 里 fetch().then().catch().then() 这条链在**同一次同步调用**里
 *  跑完，这样"已载入内置课表"那条分支也能用同步断言覆盖。
 *  只支持 app.js 实际用到的那几种调用形态，不要当通用 Promise 用。 */
function syncThenable(v0) {
  function api(v, failed) {
    return {
      then(fn) {
        if (failed) return api(v, true);
        try { return api(fn(v), false); } catch (e) { return api(e, true); }
      },
      catch(fn) {
        if (!failed) return api(v, false);
        try { return api(fn(v), false); } catch (e) { return api(e, true); }
      }
    };
  }
  return api(v0, false);
}
/** 装一个"立刻返回 seed.json 内容"的 fetch 桩 */
function seedFetch(seed) {
  return function () {
    return syncThenable({ ok: true, json: function () { return seed; } });
  };
}

t('全新设备打开 → 弹出首启说明，并提示"添加到主屏幕"', () => {
  const d = makeDom();
  const doc2 = d.window.document;
  if (!doc2.querySelector('#mask').classList.contains('on')) throw new Error('首启说明未弹出');
  const txt = doc2.querySelector('#sheet').textContent;
  if (!txt.includes('欢迎使用课表日历')) throw new Error('弹窗标题不对: ' + txt.slice(0, 50));
  if (!txt.includes('只存在你自己这台设备上')) throw new Error('未说明数据只存在本地');
  if (!txt.includes('添加到主屏幕')) throw new Error('缺少"添加到主屏幕"引导');
  if (d.window.localStorage.getItem('tt.guided') !== '1') throw new Error('未记录"已看过引导"标记');
});

t('已经有数据的设备打开 → 不弹首启说明（不骚扰老用户）', () => {
  const base = win.Core.emptyData();
  base.courses = [{ id: 'k1', name: '我自己的课', teacher: '', color: '#4c6ef5', sessions: [], overrides: [] }];
  const d = makeDom({ storage: { 'timetable.data.v1': JSON.stringify(base) } });
  const doc2 = d.window.document;
  if (doc2.querySelector('#mask').classList.contains('on')) throw new Error('不该弹却弹了');
  if (doc2.querySelector('#sheet').textContent.trim().length) throw new Error('弹层不该有内容');
});

t('全新设备会尝试载入 seed.json', () => {
  const calls = [];
  makeDom({ stubFetch: u => { calls.push(u); } });
  if (calls.indexOf('seed.json') < 0) throw new Error('没有请求 seed.json：' + JSON.stringify(calls));
});

t('清空过数据后刷新 → 不再重新载入示例课表（seed 不复活）', () => {
  const calls = [];
  // 用户点「清空所有数据」之后，本地就是一份空数据
  makeDom({
    storage: { 'timetable.data.v1': JSON.stringify(win.Core.emptyData()) },
    stubFetch: u => { calls.push(u); }
  });
  if (calls.length) throw new Error('不该再请求 seed.json，实际请求了：' + JSON.stringify(calls));
});

t('载入内置课表后 → 首启说明写明"这是示例课表"并给出一键清空', () => {
  const d = makeDom({ stubFetch: seedFetch(SEED) });
  const doc2 = d.window.document;
  if (!doc2.querySelector('#mask').classList.contains('on')) throw new Error('首启说明未弹出');
  const txt = doc2.querySelector('#sheet').textContent;
  if (!txt.includes('预置的示例课表')) throw new Error('未说明这是示例课表: ' + txt.slice(0, 80));
  if (!txt.includes('虚构')) throw new Error('未说明示例是虚构的、不是真人课表');
  if (!txt.includes(String(SEED.courses.length))) throw new Error('未写出课程门数');
  if (!txt.includes('说明')) throw new Error('没把用户引到 App 内的「说明」页');
  if (!doc2.querySelector('#gKeep')) throw new Error('缺少「就用这份示例」按钮');
  if (!doc2.querySelector('#gWipe')) throw new Error('缺少「清空，我要录自己的」按钮');
});

t('点「清空，我要录自己的」→ 课程真被清空、跳到课表页、作息表保留', () => {
  const d = makeDom({ stubFetch: seedFetch(SEED) });
  const win2 = d.window, doc2 = win2.document;
  win2.confirm = () => true;           // 绕过确认框
  doc2.querySelector('#gWipe').dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));

  const saved = win2.__dumpData();
  if (saved.courses.length !== 0) throw new Error('课程没清空，还有 ' + saved.courses.length + ' 门');
  if (saved.events.length !== 0) throw new Error('计划没清空');
  if (saved.settings.timeTable.length < 10) throw new Error('作息表被误清掉，应保留');
  if (!doc2.querySelector('#page-course').classList.contains('on')) throw new Error('未跳到课表页');
});

console.log('\n[App 内使用说明（独立页面）]');

/** 造一个"已有数据"的环境：这样首启引导不会弹，测说明书时不会被它干扰 */
function domWithData() {
  return makeDom({
    storage: { 'timetable.data.v1': JSON.stringify(win.Core.emptyData()) }
  });
}

t('底部导航有「说明」项，且存在 #page-help 页面', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  if (!doc2.querySelector('nav button[data-p="help"]')) throw new Error('底部导航没有「说明」入口');
  if (!doc2.querySelector('#page-help')) throw new Error('缺少 #page-help 页面');
});

t('点底部「说明」→ 切到说明页（走页面，不再走弹层）', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  doc2.querySelector('nav button[data-p="help"]')
    .dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  if (!doc2.querySelector('#page-help').classList.contains('on')) throw new Error('说明页没打开');
  if (doc2.querySelector('#mask').classList.contains('on')) throw new Error('不该再走弹层');
  if (!doc2.querySelector('nav button[data-p="help"]').classList.contains('on')) throw new Error('导航没有高亮「说明」');
});

t('设置页仍保留「使用说明」入口（≥2 个），点击也切到说明页', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  const entries = Array.from(doc2.querySelectorAll('#page-set [data-help]'));
  if (entries.length < 2) throw new Error('设置页入口只有 ' + entries.length + ' 个，至少要 2 个');
  entries[0].dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  if (!doc2.querySelector('#page-help').classList.contains('on')) throw new Error('点入口没切到说明页');
});

t('说明页覆盖：产品功能 / 五个模块 / 装桌面 / 录课 / 日常增删 / 备份 / FAQ', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const txt = doc2.querySelector('#page-help').textContent;

  // 章节标题
  ['这款 App 能做什么', '五个页面分别管什么', '装到手机桌面', '录入你自己的课表',
   '让 AI 帮你转格式', '日常使用', '备份 / 换手机', '常见问题']
    .forEach(k => { if (!txt.includes(k)) throw new Error('说明页缺章节：' + k); });

  // 只说"去哪哪哪"没用，必须把用户要点的按钮名写出来
  ['添加到主屏幕', '学期起始日', '清空所有数据', '批量粘贴录入', '手动添加课程',
   '导出 JSON 备份', '恢复 JSON 备份']
    .forEach(k => { if (!txt.includes(k)) throw new Error('说明页缺关键操作名：' + k); });

  if (!txt.includes('周一 1-2节')) throw new Error('没给批量粘贴的格式示例');
  if (!txt.includes('Safari')) throw new Error('没写清 iPhone 必须用 Safari');
});

t('说明页提供"让 AI 转格式"的提示词，并带复制按钮', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const pre = doc2.querySelector('#aiPrompt');
  if (!pre) throw new Error('没有 #aiPrompt 提示词文本框');
  const ptxt = pre.textContent;
  ['一行一门课', '周一 周二 周三', '单周', '示例输出']
    .forEach(k => { if (!ptxt.includes(k)) throw new Error('提示词缺关键内容：' + k); });

  const btn = doc2.querySelector('#copyAiPrompt');
  if (!btn) throw new Error('没有复制按钮');
  if (!/复制/.test(btn.textContent)) throw new Error('复制按钮文案不对');
});

t('点「复制这段话」→ 把提示词写进剪贴板', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  let copied = null;
  // jsdom 默认没有 navigator.clipboard，装个桩
  Object.defineProperty(win2.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: v => { copied = v; return Promise.resolve(); } }
  });
  doc2.querySelector('#copyAiPrompt').dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  if (copied === null) throw new Error('没有调用剪贴板');
  if (!copied.includes('一行一门课')) throw new Error('复制的内容不对');
});

t('说明页提供"让 AI 转 .ics"的第二段提示词，步骤手把手', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const pre = doc2.querySelector('#aiPromptIcs');
  if (!pre) throw new Error('没有 #aiPromptIcs 提示词文本框');
  ['BEGIN:VCALENDAR', 'DTSTART', 'RRULE', '第 1 周的星期一']
    .forEach(k => { if (!pre.textContent.includes(k)) throw new Error('.ics 提示词缺关键内容：' + k); });

  const txt = doc2.querySelector('#page-help').textContent;
  ['更快的一条路', '导入 ICS', 'course.ics', '存成文件']
    .forEach(k => { if (!txt.includes(k)) throw new Error('.ics 教学缺关键步骤词：' + k); });
});

t('点 .ics 提示词的「复制这段话」→ 也能写进剪贴板', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  let copied = null;
  Object.defineProperty(win2.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: v => { copied = v; return Promise.resolve(); } }
  });
  const btn = doc2.querySelector('#copyAiPromptIcs');
  if (!btn) throw new Error('没有 .ics 提示词的复制按钮');
  btn.dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  if (copied === null) throw new Error('没有调用剪贴板');
  if (!copied.includes('BEGIN:VCALENDAR')) throw new Error('复制的内容不对');
});

t('设置页导入区引导用 AI 转 .ics；FAQ 教用系统日历提醒', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const setPageTxt = doc2.querySelector('#page-set').textContent;
  if (!setPageTxt.includes('转成 .ics') || !setPageTxt.includes('说明'))
    throw new Error('导入区没有引导用户用 AI 转 .ics / 指向说明页');

  const faq = doc2.querySelector('#page-help').textContent;
  if (!faq.includes('导出 ICS')) throw new Error('FAQ 没教用导出 ICS 导进系统日历');
});

t('通知功能已彻底移除：设置页无权限按钮、无提前量、计划编辑器无提醒字段', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  if (doc2.querySelector('#notifyPermBtn')) throw new Error('设置页还有通知权限按钮');
  if (doc2.querySelector('#setReminder')) throw new Error('设置页还有默认提前量选择');
  const setTxt = doc2.querySelector('#page-set').textContent;
  if (setTxt.includes('通知权限') || setTxt.includes('提前提醒'))
    throw new Error('设置页还有通知相关文案');

  // 打开计划编辑器，确认没有「提前提醒」下拉
  doc2.querySelector('nav button[data-p="plan"]')
    .dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  doc2.querySelector('#addPlanBtn')
    .dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  if (doc2.querySelector('#pRemind')) throw new Error('计划编辑器还有提前提醒字段');
});

t('重大说明用红色警示标出（学期起始日 / 备份）', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const hotboxes = doc2.querySelectorAll('#page-help .hotbox');
  if (hotboxes.length < 2) throw new Error('红色警示条少于 2 处：' + hotboxes.length);
  const txt = doc2.querySelector('#page-help').textContent;
  if (!txt.includes('第 1 周的星期一')) throw new Error('红色警示没覆盖学期起始日');
  if (!txt.includes('导出 JSON 备份')) throw new Error('红色警示没覆盖备份');
  const hot = doc2.querySelector('#page-help .hot');
  if (!hot) throw new Error('iPhone 必须用 Safari 这句没标红');
});

t('说明页目录：每个锚点都指向真实存在的小节', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const items = Array.from(doc2.querySelectorAll('#page-help [data-goto]'));
  if (items.length < 6) throw new Error('目录项太少：' + items.length);
  items.forEach(b => {
    if (!doc2.getElementById(b.dataset.goto)) throw new Error('目录指向不存在的锚点：' + b.dataset.goto);
  });
});

t('说明页是通用文案：不含任何学校名 / 校区 / 楼栋字样', () => {
  const d = domWithData();
  const doc2 = d.window.document;
  const txt = doc2.querySelector('#page-help').textContent;
  // 只列「机构 / 地点」级别的通用词，**不写任何真人姓名** ——
  // 这个测试文件本身也会随目录部署到公网，装进断言里的真实信息等于二次泄露。
  ['师范大学', '师大', '校区', '教学楼', '学院']
    .forEach(k => { if (txt.includes(k)) throw new Error('说明页出现机构/地点字样：' + k); });
});

console.log('\n[作息表：一天几节课 & 节次不跑位]');

/** 注入一份"作息表只有 10 节、课却排在第 11-13 节"的课表。
 *  termStart 取"本周一"，这样不管哪天跑测试，周一第 1 节都落在当前周。 */
function lateData() {
  return {
    settings: {
      termStart: win.Core.mondayOf(win.Core.today()), totalWeeks: 20,
      showWeekend: true, tableName: '测试',
      timeTable: win.Core.DEFAULT_TIME_TABLE.slice()
    },
    courses: [{
      id: 'late', name: '晚课', color: '#4c6ef5', teacher: '', location: '教三201',
      sessions: [{ day: 1, startNode: 11, endNode: 13, startWeek: 1, endWeek: 20, weekType: 'all', location: '' }],
      overrides: []
    }],
    events: []
  };
}

function gotoSet(win2, doc2) {
  doc2.querySelector('nav button[data-p="set"]')
    .dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
}

t('设置页有「一天几节课」控件，默认渲染出全部节次行', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  gotoSet(win2, doc2);
  ['#ttCount', '#ttPlus', '#ttMinus', '#ttHint', '#ttList'].forEach(sel => {
    if (!doc2.querySelector(sel)) throw new Error('缺少 ' + sel);
  });
  const rows = doc2.querySelectorAll('#ttList .ttrow');
  if (rows.length !== 10) throw new Error('默认应渲染 10 行，实际 ' + rows.length);
  if (doc2.querySelector('#ttCount').value !== '10') {
    throw new Error('节数输入框值不对: ' + doc2.querySelector('#ttCount').value);
  }
});

t('点「＋」→ 一天多一节，新增那行标「自动」', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  gotoSet(win2, doc2);
  doc2.querySelector('#ttPlus').dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));

  const tt = win2.__dumpSettings().timeTable;
  if (tt.length !== 11) throw new Error('节数没变: ' + tt.length);
  if (!tt[10].auto) throw new Error('新增节次没标 auto');
  if (doc2.querySelectorAll('#ttList .ttrow').length !== 11) throw new Error('界面没重渲染');
  if (!/自动/.test(doc2.querySelector('#ttList').textContent)) throw new Error('界面没标"自动"');
});

t('点「−」→ 一天少一节（只动末尾）', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  gotoSet(win2, doc2);
  doc2.querySelector('#ttMinus').dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  const tt = win2.__dumpSettings().timeTable;
  if (tt.length !== 9) throw new Error('节数没变: ' + tt.length + ' | ' + JSON.stringify(tt));
  if (tt[0].start !== '08:00') throw new Error('不该动到第一节的时间: ' + JSON.stringify(tt));
});

t('★ 关键回归：课在第 11-13 节 → 卡片落在第 11 节的时间上，不是 08:00', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  win2.__ttDebug(lateData());

  const card = doc2.querySelector('#weekWrap .ev');
  if (!card) throw new Error('没渲染出课程卡片');
  const txt = card.textContent;
  if (txt.includes('08:00')) throw new Error('又是"第 11 节跑到第 1 节"的 bug: ' + txt);

  // 卡片上的时间必须等于"第 11 节"那一行的时间（不写死具体钟点，跟着作息表走）
  const tt = win2.__dumpSettings().timeTable;
  if (tt.length !== 13) throw new Error('作息表没补到 13 节，实际 ' + tt.length);
  if (!txt.includes(tt[10].start)) {
    throw new Error('卡片时间不对: ' + txt + '（应为第 11 节的 ' + tt[10].start + '）');
  }
});

t('★ 关键回归：设置页提示"你的一天几节 / 用到了第几节 / 自动补的"', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  win2.__ttDebug(lateData());
  gotoSet(win2, doc2);

  const hint = doc2.querySelector('#ttHint').textContent;
  if (!/你的一天有\s*13\s*节/.test(hint)) throw new Error('没写清一天几节: ' + hint);
  if (!/用到了第\s*13\s*节/.test(hint)) throw new Error('没写清课表用到第几节: ' + hint);
  if (!/自动补/.test(hint)) throw new Error('没提示"自动补出来的": ' + hint);
});

t('课程编辑器：节次超出作息表时就提前提示（不用等保存后才懵）', () => {
  const d = domWithData();
  const win2 = d.window, doc2 = win2.document;
  doc2.querySelector('nav button[data-p="course"]')
    .dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));
  doc2.querySelector('#addCourseBtn').dispatchEvent(new win2.MouseEvent('click', { bubbles: true }));

  const en = doc2.querySelector('#sheet .s-en');
  if (!en) throw new Error('课程编辑器没打开');
  en.value = '13';
  en.dispatchEvent(new win2.Event('input', { bubbles: true }));

  const hint = doc2.querySelector('#snHint').textContent;
  if (!/只到第\s*10\s*节/.test(hint)) throw new Error('没提示节次超范围: ' + hint);
});

console.log('\n' + '='.repeat(46));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
