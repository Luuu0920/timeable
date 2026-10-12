/* core.js 单元测试  ——  node test/core.test.js */
const assert = require('assert');
const Core = require('../core.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  \u2713 ' + name); }
  catch (e) { fail++; console.log('  \u2717 ' + name + '\n      ' + e.message); }
}

console.log('\n[日期与周次]');

t('weekdayOf 周一=1 周日=7', () => {
  assert.strictEqual(Core.weekdayOf('2026-10-05'), 1); // 周一
  assert.strictEqual(Core.weekdayOf('2026-10-10'), 6); // 周六
  assert.strictEqual(Core.weekdayOf('2026-10-11'), 7); // 周日
});

t('mondayOf 周日应回到本周一而非下周一', () => {
  assert.strictEqual(Core.mondayOf('2026-10-11'), '2026-10-05');
  assert.strictEqual(Core.mondayOf('2026-10-05'), '2026-10-05');
});

t('diffDays 跨月正确', () => {
  assert.strictEqual(Core.diffDays('2026-09-30', '2026-10-02'), 2);
});

t('教学周换算：termStart 当天=第1周', () => {
  assert.strictEqual(Core.weekIndexOf('2026-09-07', '2026-09-07'), 1);
});

t('教学周换算：第1周周日仍属第1周', () => {
  assert.strictEqual(Core.weekIndexOf('2026-09-07', '2026-09-13'), 1);
});

t('教学周换算：第2周周一=2', () => {
  assert.strictEqual(Core.weekIndexOf('2026-09-07', '2026-09-14'), 2);
});

t('教学周换算：学期开始前为 0 或负数', () => {
  assert.ok(Core.weekIndexOf('2026-09-07', '2026-08-31') <= 0);
});

t('学期跨年（9月开学 -> 次年1月）', () => {
  // 2026-09-07 是第1周周一，2027-01-04 应为第 18 周
  assert.strictEqual(Core.weekIndexOf('2026-09-07', '2027-01-04'), 18);
});

t('weekStartDate 反算回周一', () => {
  assert.strictEqual(Core.weekStartDate('2026-09-07', 3), '2026-09-21');
});

t('单双周判定', () => {
  assert.strictEqual(Core.parityOf(1), 'odd');
  assert.strictEqual(Core.parityOf(2), 'even');
  assert.strictEqual(Core.parityOf(16), 'even');
});

t('节次 -> 时间', () => {
  const tt = Core.DEFAULT_TIME_TABLE;
  assert.deepStrictEqual(Core.nodesToTime(tt, 1, 2), { start: '08:00', end: '09:40' });
});

console.log('\n[课程展开]');

const base = () => ({
  settings: { termStart: '2026-09-07', totalWeeks: 20, timeTable: Core.DEFAULT_TIME_TABLE },
  courses: [], events: []
});

t('课程在正确的星期与周次出现', () => {
  const d = base();
  d.courses.push({
    id: 'c1', name: '高等数学', color: '#4c6ef5',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 16, weekType: 'all', location: '教三201' }],
    overrides: []
  });
  const mon = Core.agendaForDate(d, '2026-09-07');
  assert.strictEqual(mon.length, 1);
  assert.strictEqual(mon[0].name, '高等数学');
  assert.strictEqual(mon[0].start, '08:00');
  assert.strictEqual(mon[0].location, '教三201');
  // 周二不应有课
  assert.strictEqual(Core.agendaForDate(d, '2026-09-08').length, 0);
});

t('超出 endWeek 不再出现', () => {
  const d = base();
  d.courses.push({
    id: 'c1', name: '限时课',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 2, weekType: 'all' }],
    overrides: []
  });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-07').length, 1);  // 第1周
  assert.strictEqual(Core.agendaForDate(d, '2026-09-21').length, 0);  // 第3周
});

t('单周课只在奇数周出现', () => {
  const d = base();
  d.courses.push({
    id: 'c1', name: '单周课',
    sessions: [{ day: 1, startNode: 5, endNode: 6, startWeek: 1, endWeek: 16, weekType: 'odd' }],
    overrides: []
  });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-07').length, 1);  // 第1周=单
  assert.strictEqual(Core.agendaForDate(d, '2026-09-14').length, 0);  // 第2周=双
  assert.strictEqual(Core.agendaForDate(d, '2026-09-21').length, 1);  // 第3周=单
});

t('双周课只在偶数周出现', () => {
  const d = base();
  d.courses.push({
    id: 'c1', name: '双周课',
    sessions: [{ day: 1, startNode: 5, endNode: 6, startWeek: 1, endWeek: 16, weekType: 'even' }],
    overrides: []
  });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-07').length, 0);
  assert.strictEqual(Core.agendaForDate(d, '2026-09-14').length, 1);
});

t('调课：某天停课', () => {
  const d = base();
  d.courses.push({
    id: 'c1', name: '英语',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 16, weekType: 'all' }],
    overrides: [{ date: '2026-09-14', action: 'cancel' }]
  });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-07').length, 1);
  assert.strictEqual(Core.agendaForDate(d, '2026-09-14').length, 0);
});

t('调课：某天改时间与地点', () => {
  const d = base();
  d.courses.push({
    id: 'c1', name: '英语',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 16, weekType: 'all' }],
    overrides: [{ date: '2026-09-14', action: 'move', start: '10:00', end: '11:40', location: '教四101' }]
  });
  const items = Core.agendaForDate(d, '2026-09-14');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].start, '10:00');
  assert.strictEqual(items[0].location, '教四101');
  assert.strictEqual(items[0].isMoved, true);
});

console.log('\n[计划重复]');

t('一次性事件只在那天出现', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '讲座', type: 'activity', date: '2026-10-08', start: '14:00', end: '16:00', repeat: { mode: 'none' } });
  assert.strictEqual(Core.agendaForDate(d, '2026-10-08').length, 1);
  assert.strictEqual(Core.agendaForDate(d, '2026-10-15').length, 0);
});

t('跨天事件覆盖每一天', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '比赛', type: 'activity', date: '2026-10-08', endDate: '2026-10-10', start: '09:00', end: '17:00', repeat: { mode: 'none' } });
  assert.strictEqual(Core.agendaForDate(d, '2026-10-09').length, 1);
});

t('每周重复（周一三五）', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '健身', type: 'gym', date: '2026-09-07', start: '18:00', end: '19:00', repeat: { mode: 'weekly', days: [1, 3, 5], until: null } });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-07').length, 1);
  assert.strictEqual(Core.agendaForDate(d, '2026-09-09').length, 1);
  assert.strictEqual(Core.agendaForDate(d, '2026-09-08').length, 0);
  assert.strictEqual(Core.agendaForDate(d, '2026-10-05').length, 1); // 5 周后仍在
});

t('每周重复受 until 限制', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '健身', type: 'gym', date: '2026-09-07', start: '18:00', end: '19:00', repeat: { mode: 'weekly', days: [1], until: '2026-09-20' } });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-14').length, 1);
  assert.strictEqual(Core.agendaForDate(d, '2026-10-05').length, 0);
});

t('每次重复不能早于起始日期', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '健身', type: 'gym', date: '2026-09-07', start: '18:00', end: '19:00', repeat: { mode: 'weekly', days: [5] } });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-04').length, 0);
});

t('隔周重复：单周', () => {
  const d = base();
  // 起始 2026-09-07 是第1周（单周）
  d.events.push({ id: 'e1', name: '隔周健身', type: 'gym', date: '2026-09-07', start: '18:00', end: '19:00', repeat: { mode: 'biweekly', days: [1], parity: 'odd' } });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-07').length, 1); // 第1周
  assert.strictEqual(Core.agendaForDate(d, '2026-09-14').length, 0); // 第2周
  assert.strictEqual(Core.agendaForDate(d, '2026-09-21').length, 1); // 第3周
});

t('隔周重复：parity 不填时由起始日期自动推断', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '隔周', type: 'gym', date: '2026-09-14', start: '18:00', end: '19:00', repeat: { mode: 'biweekly', days: [1] } });
  assert.strictEqual(Core.agendaForDate(d, '2026-09-14').length, 1); // 第2周=双
  assert.strictEqual(Core.agendaForDate(d, '2026-09-21').length, 0); // 第3周=单
  assert.strictEqual(Core.agendaForDate(d, '2026-09-28').length, 1); // 第4周=双
});

t('课程与计划在同一时间轴混排并按时间排序', () => {
  const d = base();
  d.courses.push({ id: 'c1', name: '高数', color: '#333', sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 16, weekType: 'all' }], overrides: [] });
  d.events.push({ id: 'e1', name: '晨跑', type: 'gym', date: '2026-09-07', start: '07:00', end: '07:40', repeat: { mode: 'none' } });
  const items = Core.agendaForDate(d, '2026-09-07');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].name, '晨跑');   // 07:00 在前
  assert.strictEqual(items[1].name, '高数');
});

console.log('\n[整周展开]');

t('agendaForWeek 返回 7 天且以周一开头', () => {
  const d = base();
  const w = Core.agendaForWeek(d, '2026-10-08'); // 周四
  assert.strictEqual(w.monday, '2026-10-05');
  assert.strictEqual(Object.keys(w.days).length, 7);
  assert.ok(w.days['2026-10-11']); // 周日存在
});

console.log('\n[考试倒计时]');

t('upcomingExams 过滤非考试并按日期排序', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '高数考试', type: 'exam', date: '2026-10-22', start: '14:00', end: '16:00' });
  d.events.push({ id: 'e2', name: '英语考试', type: 'exam', date: '2026-10-12', start: '09:00', end: '11:00' });
  d.events.push({ id: 'e3', name: '聚会', type: 'activity', date: '2026-10-13', start: '18:00', end: '20:00' });
  d.events.push({ id: 'e4', name: '过去的考试', type: 'exam', date: '2026-09-01' });
  const list = Core.upcomingExams(d, '2026-10-10');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].name, '英语考试');
  assert.strictEqual(list[0].daysLeft, 2);
  assert.strictEqual(list[1].daysLeft, 12);
});

t('考试倒计时：当天为 0 天', () => {
  const d = base();
  d.events.push({ id: 'e1', name: '今日考试', type: 'exam', date: '2026-10-10', start: '09:00', end: '11:00' });
  assert.strictEqual(Core.upcomingExams(d, '2026-10-10')[0].daysLeft, 0);
});

console.log('\n[WakeUp 备份解析]');

const wakeupSample = [
  JSON.stringify({ courseLen: 45, id: 1, name: '默认', sameBreakLen: false, sameLen: true, theBreakLen: 10 }),
  JSON.stringify([
    { endTime: '08:45', node: 1, startTime: '08:00', timeTable: 1 },
    { endTime: '09:40', node: 2, startTime: '08:55', timeTable: 1 },
    { endTime: '10:45', node: 3, startTime: '10:00', timeTable: 1 },
    { endTime: '11:40', node: 4, startTime: '10:55', timeTable: 1 },
    { endTime: '14:45', node: 5, startTime: '14:00', timeTable: 1 }
  ]),
  JSON.stringify({ id: 1, maxWeek: 18, nodes: 5, showOtherWeekCourse: true, showSat: true, showSun: false, sundayFirst: false, startDate: '2026-09-07', tableName: '2026秋', timeTable: 1 }),
  JSON.stringify([
    { courseName: '高等数学', credit: 5, id: 101, note: '', tableId: 1 },
    { courseName: '大学英语', credit: 3, id: 102, note: '', tableId: 1 }
  ]),
  JSON.stringify([
    { day: 1, endWeek: 16, id: 101, level: 1, ownTime: false, room: '教三201', startNode: 1, startWeek: 1, step: 2, tableId: 1, teacher: '张老师', type: 0 },
    { day: 3, endWeek: 16, id: 101, level: 1, ownTime: false, room: '教三201', startNode: 3, startWeek: 1, step: 2, tableId: 1, teacher: '张老师', type: 0 },
    { day: 5, endWeek: 16, id: 102, level: 1, ownTime: false, room: '外语楼A101', startNode: 5, startWeek: 1, step: 2, tableId: 1, teacher: '李老师', type: 1 }
  ])
].join('\n');

t('解析出学期开始日期与总周数', () => {
  const r = Core.parseWakeup(wakeupSample);
  assert.strictEqual(r.settings.termStart, '2026-09-07');
  assert.strictEqual(r.settings.totalWeeks, 18);
  assert.strictEqual(r.settings.tableName, '2026秋');
});

t('节次时间表按 node 排序还原', () => {
  const r = Core.parseWakeup(wakeupSample);
  assert.strictEqual(r.settings.timeTable.length, 5);
  assert.deepStrictEqual(r.settings.timeTable[0], { start: '08:00', end: '08:45' });
  assert.deepStrictEqual(r.settings.timeTable[1], { start: '08:55', end: '09:40' });
});

t('同一课程名的多个时段合并为一门课的两个 session', () => {
  const r = Core.parseWakeup(wakeupSample);
  const math = r.courses.filter(c => c.name === '高等数学')[0];
  assert.ok(math, '应存在高等数学');
  assert.strictEqual(math.sessions.length, 2);
  assert.strictEqual(math.sessions[0].day, 1);
  assert.strictEqual(math.sessions[1].day, 3);
});

t('step=2 由 startNode 换算为 endNode', () => {
  const r = Core.parseWakeup(wakeupSample);
  const math = r.courses.filter(c => c.name === '高等数学')[0];
  assert.strictEqual(math.sessions[0].startNode, 1);
  assert.strictEqual(math.sessions[0].endNode, 2);
  assert.strictEqual(math.sessions[1].startNode, 3);
  assert.strictEqual(math.sessions[1].endNode, 4);
});

t('type 1/2 映射为单周/双周', () => {
  const r = Core.parseWakeup(wakeupSample);
  const eng = r.courses.filter(c => c.name === '大学英语')[0];
  assert.strictEqual(eng.sessions[0].weekType, 'odd');
});

t('ownTime 的条目被跳过', () => {
  const withOwn = wakeupSample.split('\n');
  const cls = JSON.parse(withOwn[4]);
  cls.push({ day: 2, endWeek: 16, id: 102, ownTime: true, room: 'x', startNode: 1, startWeek: 1, step: 1, tableId: 1, teacher: '', type: 0 });
  withOwn[4] = JSON.stringify(cls);
  const r = Core.parseWakeup(withOwn.join('\n'));
  const eng = r.courses.filter(c => c.name === '大学英语')[0];
  assert.strictEqual(eng.sessions.length, 1);
});

t('导入结果能直接用于渲染（端到端）', () => {
  const r = Core.parseWakeup(wakeupSample);
  const data = Core.migrate({ settings: r.settings, courses: r.courses, events: r.events });
  // 2026-09-07 周一，应有高等数学 1-2 节
  const mon = Core.agendaForDate(data, '2026-09-07');
  assert.strictEqual(mon.length, 1);
  assert.strictEqual(mon[0].name, '高等数学');
  assert.strictEqual(mon[0].start, '08:00');
  assert.strictEqual(mon[0].end, '09:40');
  // 2026-09-11 周五，大学英语是单周 -> 第1周是单周，应出现
  const fri = Core.agendaForDate(data, '2026-09-11');
  assert.strictEqual(fri.length, 1);
  assert.strictEqual(fri[0].name, '大学英语');
  // 下一周周五（第2周=双周）不应出现
  assert.strictEqual(Core.agendaForDate(data, '2026-09-18').length, 0);
});

t('非法文件给出可读报错', () => {
  assert.throws(() => Core.parseWakeup('这不是JSON'), /WakeUp/);
  assert.throws(() => Core.parseWakeup('{"a":1}'), /5 段|结构异常/);
});

console.log('\n[ICS]');

const icsSample = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:abc-123',
  'SUMMARY:高数期中考试',
  'LOCATION:教三201',
  'DTSTART:20261022T140000',
  'DTEND:20261022T160000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:def-456',
  'SUMMARY:健身',
  'DTSTART:20260907T180000',
  'DTEND:20260907T190000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

t('解析 ICS 事件的时间与地点', () => {
  const r = Core.parseICS(icsSample);
  const exam = r.events.filter(e => e.name === '高数期中考试')[0];
  assert.ok(exam);
  assert.strictEqual(exam.date, '2026-10-22');
  assert.strictEqual(exam.start, '14:00');
  assert.strictEqual(exam.end, '16:00');
  assert.strictEqual(exam.location, '教三201');
});

t('解析 ICS 的 RRULE 为每周重复并带 until', () => {
  const r = Core.parseICS(icsSample);
  const gym = r.events.filter(e => e.name === '健身')[0];
  assert.strictEqual(gym.repeat.mode, 'weekly');
  assert.deepStrictEqual(gym.repeat.days, [1, 3]);
  assert.strictEqual(gym.repeat.until, '2026-12-31');
});

t('ICS 解析结果可渲染且重复生效', () => {
  const r = Core.parseICS(icsSample);
  const data = Core.migrate({ settings: r.settings, courses: r.courses, events: r.events });
  assert.ok(Core.agendaForDate(data, '2026-09-07').some(i => i.name === '健身'));
  assert.ok(Core.agendaForDate(data, '2026-09-09').some(i => i.name === '健身'));
  assert.ok(!Core.agendaForDate(data, '2026-09-08').some(i => i.name === '健身'));
});

t('ICS 支持续行（折行 SUMMARY）', () => {
  const folded = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'SUMMARY:很长很长的活动名', ' 称后半段',
    'DTSTART:20261022T140000', 'DTEND:20261022T160000',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const r = Core.parseICS(folded);
  assert.strictEqual(r.events[0].name, '很长很长的活动名称后半段');
});

t('ICS 导出结构合法且能被自己解析回来', () => {
  const d = Core.emptyData();
  d.settings.termStart = '2026-09-07';
  d.courses.push({ id: 'c1', name: '高等数学', color: '#4c6ef5',
    sessions: [{ day: 1, startNode: 1, endNode: 2, startWeek: 1, endWeek: 16, weekType: 'all', location: '教三201' }], overrides: [] });
  d.events.push({ id: 'e1', name: '高数考试', type: 'exam', date: '2026-10-22', start: '14:00', end: '16:00', location: '教三201', repeat: { mode: 'none' } });
  // 窗口需覆盖到考试日期（10-22），故导出 8 周
  const ics = Core.exportICS(d, '2026-09-07', 8);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.endsWith('END:VCALENDAR'));
  assert.ok(ics.indexOf('SUMMARY:高数考试【考试】') > -1);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 8 /*8周高数*/ + 1 /*考试*/);
  const back = Core.parseICS(ics);
  assert.ok(back.events.some(e => e.name.indexOf('高数考试') > -1));
});

t('ICS 特殊字符转义', () => {
  const d = Core.emptyData();
  d.events.push({ id: 'e1', name: '讲座, 主题;A', type: 'activity', date: '2026-10-22', start: '14:00', end: '16:00', repeat: { mode: 'none' } });
  const ics = Core.exportICS(d, '2026-10-20', 1);
  assert.ok(ics.indexOf('讲座\\, 主题\\;A') > -1);
});

console.log('\n[批量文本录入]');

t('解析 "高数 周一 1-2节 1-16周 教三201"', () => {
  const r = Core.parseCourseText('高数 周一 1-2节 1-16周 教三201');
  assert.strictEqual(r.errors.length, 0);
  const c = r.courses[0];
  assert.strictEqual(c.name, '高数');
  assert.strictEqual(c.sessions[0].day, 1);
  assert.strictEqual(c.sessions[0].startNode, 1);
  assert.strictEqual(c.sessions[0].endNode, 2);
  assert.strictEqual(c.sessions[0].startWeek, 1);
  assert.strictEqual(c.sessions[0].endWeek, 16);
  assert.strictEqual(c.sessions[0].location, '教三201');
});

t('识别单双周', () => {
  const r = Core.parseCourseText('大学英语 周三 3-4节 单周 外语楼A101');
  assert.strictEqual(r.courses[0].sessions[0].weekType, 'odd');
  const r2 = Core.parseCourseText('大学英语 周三 3-4节 2-16周 双周');
  assert.strictEqual(r2.courses[0].sessions[0].weekType, 'even');
});

t('同名课程合并为多时段', () => {
  const r = Core.parseCourseText('高数 周一 1-2节 1-16周 教三201\n高数 周三 3-4节 1-16周 教三201');
  assert.strictEqual(r.courses.length, 1);
  assert.strictEqual(r.courses[0].sessions.length, 2);
});

t('无法识别的行给出错误提示', () => {
  const r = Core.parseCourseText('高数 周一 1-2节 1-16周\n乱写的行');
  assert.strictEqual(r.errors.length, 1);
});

t('空行与注释行被忽略', () => {
  const r = Core.parseCourseText('\n# 这是我大二的课表\n高数 周一 1-2节 1-16周\n\n');
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.courses.length, 1);
});

console.log('\n[数据健壮性]');

t('migrate 补全残缺数据不崩溃', () => {
  const d = Core.migrate({ courses: [{ name: 'x' }], events: [{ name: 'y' }] });
  assert.ok(d.settings.termStart);
  assert.deepStrictEqual(d.courses[0].sessions, []);
  assert.strictEqual(d.events[0].type, 'activity');
});

t('migrate 处理 null / 垃圾输入', () => {
  assert.ok(Core.migrate(null).settings.termStart);
  assert.ok(Core.migrate('abc').settings.termStart);
});

t('JSON 备份往返不丢数据', () => {
  const d = Core.emptyData();
  d.courses.push({ id: 'c1', name: '高数', color: '#111',
    sessions: [{ day: 2, startNode: 1, endNode: 2, startWeek: 3, endWeek: 9, weekType: 'odd', location: 'A' }],
    overrides: [{ date: '2026-10-01', action: 'cancel' }] });
  d.events.push({ id: 'e1', name: '考试', type: 'exam', date: '2026-11-01', start: '09:00', end: '11:00',
    repeat: { mode: 'biweekly', days: [5], parity: 'even' }, reminders: [15, 30] });
  const clone = Core.migrate(JSON.parse(JSON.stringify(d)));
  assert.strictEqual(clone.courses[0].sessions[0].startWeek, 3);
  assert.strictEqual(clone.courses[0].overrides[0].action, 'cancel');
  assert.strictEqual(clone.events[0].repeat.mode, 'biweekly');
  assert.deepStrictEqual(clone.events[0].reminders, [15, 30]);
});

t('uid 唯一', () => {
  const s = new Set();
  for (let i = 0; i < 500; i++) s.add(Core.uid('c'));
  assert.strictEqual(s.size, 500);
});

/* ---------------------------------------------------------------- 待办 */
console.log('\n[待办类型]');

t('TYPE_META 含 todo，颜色与其它类型不重复', () => {
  assert.ok(Core.TYPE_META.todo, '缺少 todo 类型');
  assert.strictEqual(Core.TYPE_META.todo.label, '待办');
  const colors = Object.keys(Core.TYPE_META).map(k => Core.TYPE_META[k].color);
  assert.strictEqual(new Set(colors).size, colors.length, '有类型配色重复');
});

t('isDoneOn：true / 数组 / 空值三种形态', () => {
  assert.strictEqual(Core.isDoneOn(true, '2026-10-10'), true);
  assert.strictEqual(Core.isDoneOn(['2026-10-10'], '2026-10-10'), true);
  assert.strictEqual(Core.isDoneOn(['2026-10-09'], '2026-10-10'), false);
  assert.strictEqual(Core.isDoneOn([], '2026-10-10'), false);
  assert.strictEqual(Core.isDoneOn(undefined, '2026-10-10'), false);
});

t('toggleTodoDone 勾选 / 取消勾选', () => {
  let d = Core.toggleTodoDone([], '2026-10-10');
  assert.deepStrictEqual(d, ['2026-10-10'], '勾选失败');
  d = Core.toggleTodoDone(d, '2026-10-10');
  assert.deepStrictEqual(d, [], '取消勾选失败');
  // 同一天反复切换不应残留重复项
  d = Core.toggleTodoDone(Core.toggleTodoDone(Core.toggleTodoDone([], 'X'), 'X'), 'X');
  assert.deepStrictEqual(d, ['X']);
});

t('toggleTodoDone 不改动原数组（纯函数）', () => {
  const orig = ['2026-10-01'];
  Core.toggleTodoDone(orig, '2026-10-02');
  assert.deepStrictEqual(orig, ['2026-10-01'], '原数组被修改了');
});

t('toggleTodoDone 对 true（全部完成）取反为空', () => {
  assert.deepStrictEqual(Core.toggleTodoDone(true, '2026-10-10'), []);
});

t('重复待办按天记录完成状态', () => {
  const d = Core.emptyData();
  d.settings.termStart = '2026-09-14';
  d.events.push({
    id: 't1', name: '交作业', type: 'todo', date: '2026-10-05',
    start: '09:00', end: '09:00',
    repeat: { mode: 'weekly', days: [1] }, reminders: [],
    doneDays: ['2026-10-05']          // 第一周的周一勾完了
  });
  const m = Core.migrate(JSON.parse(JSON.stringify(d)));
  // 10-05 完成
  const a = Core.agendaForDate(m, '2026-10-05').filter(x => x.type === 'todo');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].done, true, '10-05 应为已完成');
  // 下一周的周一（10-12）未勾选，且不应被上一周的完成状态影响
  const b = Core.agendaForDate(m, '2026-10-12').filter(x => x.type === 'todo');
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].done, false, '10-12 应为未完成');
});

t('eventInstance 带出 done / isTodo 字段', () => {
  const d = Core.emptyData();
  d.events.push({ id: 't2', name: '买书', type: 'todo', date: '2026-10-10',
    start: '09:00', end: '09:00', repeat: { mode: 'none' }, reminders: [], doneDays: ['2026-10-10'] });
  const m = Core.migrate(d);
  const items = Core.agendaForDate(m, '2026-10-10');
  assert.strictEqual(items[0].isTodo, true);
  assert.strictEqual(items[0].done, true);
});

t('migrate 给待办补 doneDays、其它类型不受影响', () => {
  const m = Core.migrate({
    events: [
      { id: 'a', name: '待办A', type: 'todo', date: '2026-10-10', start: '09:00', end: '09:00' },
      { id: 'b', name: '活动B', type: 'activity', date: '2026-10-10', start: '09:00', end: '10:00' }
    ]
  });
  assert.deepStrictEqual(m.events[0].doneDays, [], '待办应补空数组');
  assert.strictEqual(m.events[1].doneDays, undefined, '非待办不该有 doneDays');
});

t('待办参与当日日程排序（混在课程/活动里）', () => {
  const d = Core.emptyData();
  d.events.push(
    { id: 't3', name: '待办-晚', type: 'todo', date: '2026-10-10', start: '20:00', end: '20:00',
      repeat: { mode: 'none' }, reminders: [], doneDays: [] },
    { id: 't4', name: '待办-早', type: 'todo', date: '2026-10-10', start: '08:00', end: '08:00',
      repeat: { mode: 'none' }, reminders: [], doneDays: [] }
  );
  const m = Core.migrate(d);
  const items = Core.agendaForDate(m, '2026-10-10').filter(x => x.type === 'todo');
  assert.deepStrictEqual(items.map(x => x.name), ['待办-早', '待办-晚']);
});

console.log('\n[作息表自适应（各校节次不同）]');

/** 造一份"作息表只有 10 节、但课排在第 11-13 节"的数据 */
function lateCourseData() {
  return {
    settings: {
      termStart: '2026-09-07', totalWeeks: 20, showWeekend: true,
      tableName: '测试', timeTable: Core.DEFAULT_TIME_TABLE.slice()
    },
    courses: [{
      id: 'late', name: '晚课', color: '#4c6ef5',
      sessions: [{ day: 1, startNode: 11, endNode: 13, startWeek: 1, endWeek: 16, weekType: 'all', location: '' }],
      overrides: []
    }],
    events: []
  };
}

t('DEFAULT_TIME_TABLE 是 10 节（默认值的边界就在这）', () => {
  assert.strictEqual(Core.DEFAULT_TIME_TABLE.length, 10);
});

t('nextPeriod：照作息节奏续下一节，不被午休/晚饭的大空档带跑', () => {
  // 默认表最后一节是 19:55-20:40（45 分钟），相邻节次最小的开始间隔是 55 分钟
  // → 第 11 节 = 20:50-21:35。
  // 这条断言同时在防退化：若改用"最后一次间隔"（19:55 - 17:40 = 135 分钟），
  // 就会算出 22:10 —— 那是被晚饭空档带跑了。
  const p = Core.nextPeriod(Core.DEFAULT_TIME_TABLE);
  assert.strictEqual(p.start, '20:50');
  assert.strictEqual(p.end, '21:35');
});

t('nextPeriod：不越过 24:00', () => {
  const tt = [{ start: '23:00', end: '23:45' }, { start: '23:50', end: '23:59' }];
  const p = Core.nextPeriod(tt);
  assert.ok(Core.timeToMinutes(p.start) <= 24 * 60 - 1, 'start 越界: ' + p.start);
  assert.ok(Core.timeToMinutes(p.end) <= 24 * 60 - 1, 'end 越界: ' + p.end);
});

t('maxNodeUsed：取课程与调课的最大结束节次', () => {
  const d = lateCourseData();
  assert.strictEqual(Core.maxNodeUsed(d), 13);
  assert.strictEqual(Core.maxNodeUsed({ courses: [], events: [] }), 0);
  d.courses[0].overrides.push({ date: '2026-09-21', action: 'move', startNode: 15, endNode: 16 });
  assert.strictEqual(Core.maxNodeUsed(d), 16);
});

t('fitTimeTable：课排到第 13 节 → 作息表自动补到 13 节，补的标 auto', () => {
  const d = lateCourseData();
  const out = Core.fitTimeTable(d);
  assert.strictEqual(out.settings.timeTable.length, 13);
  // 从 19:55-20:40 起，55 分钟一节 + 10 分钟课间
  // → 第 11 / 12 / 13 节 = 20:50-21:35 / 21:45-22:30 / 22:40-23:25
  assert.strictEqual(out.settings.timeTable[10].start, '20:50');
  assert.strictEqual(out.settings.timeTable[11].start, '21:45');
  assert.strictEqual(out.settings.timeTable[12].start, '22:40');
  assert.strictEqual(out.settings.timeTable[12].end, '23:25');
  assert.strictEqual(out.settings.timeTable[10].auto, true, '补出来的节次要标 auto');
  assert.strictEqual(out.settings.timeTable[9].auto, undefined, '原有节次不该被标 auto');
});

t('fitTimeTable 是纯函数：不动入参', () => {
  const d = lateCourseData();
  const before = JSON.stringify(d);
  Core.fitTimeTable(d);
  assert.strictEqual(JSON.stringify(d), before, 'fitTimeTable 改了入参');
});

t('fitTimeTable：不需要补时原样返回（同一引用），不制造无谓复制', () => {
  const d = lateCourseData();
  d.courses[0].sessions[0].endNode = 8;
  assert.strictEqual(Core.fitTimeTable(d), d);
});

t('★ migrate：读进来就补足节次，不会把第 11 节的课按第 1 节画', () => {
  const d = Core.migrate(lateCourseData());
  assert.strictEqual(d.settings.timeTable.length, 13, 'migrate 后作息表应有 13 节');

  const wk = Core.agendaForWeek(d, '2026-09-07');
  const c = (wk.days['2026-09-07'] || []).filter(x => x.kind === 'course')[0];
  assert.ok(c, '第 11-13 节的课没出现在周视图里');
  // 关键：必须是第 11 节的时间，而不是回落成第 1 节的 08:00
  assert.strictEqual(c.start, d.settings.timeTable[10].start);
  assert.notStrictEqual(c.start, '08:00');
  assert.strictEqual(c.startNode, 11);
  assert.strictEqual(c.endNode, 13);
});

t('★ 没补之前就是坏的：nodesToTime 越界会回落成第 1 节时间（这就是原 bug）', () => {
  const t = Core.nodesToTime(Core.DEFAULT_TIME_TABLE, 11, 13);
  // 用这条断言把"为什么必须 fitTimeTable"钉住：越界时回落成 08:00-09:40
  assert.strictEqual(t.start, '08:00');
  assert.strictEqual(t.end, '09:40');
});

t('resizeTimeTable：加到 13 节，added=3', () => {
  const d = { settings: { timeTable: Core.DEFAULT_TIME_TABLE.slice() }, courses: [], events: [] };
  const r = Core.resizeTimeTable(d, 13);
  assert.strictEqual(r.data.settings.timeTable.length, 13);
  assert.strictEqual(r.added, 3);
  assert.strictEqual(r.removed, 0);
});

t('resizeTimeTable：减到 6 节', () => {
  const d = { settings: { timeTable: Core.DEFAULT_TIME_TABLE.slice() }, courses: [], events: [] };
  const r = Core.resizeTimeTable(d, 6);
  assert.strictEqual(r.data.settings.timeTable.length, 6);
  assert.strictEqual(r.removed, 4);
});

t('★ resizeTimeTable：不能减到把已有的课弄丢，会被夹回 need 并给出提示', () => {
  const r = Core.resizeTimeTable(lateCourseData(), 5);
  assert.strictEqual(r.data.settings.timeTable.length, 13, '应被夹到课表用到的 13 节');
  assert.strictEqual(r.added, 3);
  assert.ok(r.notes.length, '应给出提示');
  assert.ok(/第 13 节/.test(r.notes[0]), '提示里应写明第几节: ' + r.notes[0]);
});

t('resizeTimeTable：上限 24 节、下限 1 节', () => {
  const d = { settings: { timeTable: Core.defaultTimeTable() }, courses: [], events: [] };
  assert.strictEqual(Core.resizeTimeTable(d, 99).data.settings.timeTable.length, 24);
  assert.strictEqual(Core.resizeTimeTable(d, 0).data.settings.timeTable.length, 1);
});

t('★ emptyData / migrate 给的是深拷贝：改它不会污染全局默认作息', () => {
  const before = JSON.stringify(Core.DEFAULT_TIME_TABLE);

  const d = Core.emptyData();
  d.settings.timeTable[0].start = '07:30';
  assert.strictEqual(JSON.stringify(Core.DEFAULT_TIME_TABLE), before,
    'emptyData() 是浅拷贝，改一份数据把全局 DEFAULT_TIME_TABLE 也改了');

  const m = Core.migrate({ settings: { timeTable: Core.DEFAULT_TIME_TABLE }, courses: [], events: [] });
  m.settings.timeTable[0].start = '06:00';
  assert.strictEqual(JSON.stringify(Core.DEFAULT_TIME_TABLE), before,
    'migrate() 是浅拷贝，读一份数据把全局 DEFAULT_TIME_TABLE 改了');

  // 清空重来后必须拿回"出厂"的作息，而不是上一个人改过的
  assert.strictEqual(Core.emptyData().settings.timeTable[0].start, '08:00');
});

console.log('\n' + '='.repeat(46));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
