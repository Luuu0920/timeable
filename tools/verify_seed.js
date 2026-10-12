/* 验证 seed.json 能否被 core.js 正确展开成课程实例 */
const path = require('path');
const C = require(path.join('D:/AI工厂/timetable', 'core.js'));
const seed = require('D:/AI工厂/timetable/seed.json');

const d = C.migrate(seed);
console.log('学期起始:', d.settings.termStart, '  总周数:', d.settings.totalWeeks);
console.log('作息节数:', d.settings.timeTable.length);
console.log('课程数:', d.courses.length);
console.log('='.repeat(90));

// 打印每门课的时段
d.courses.forEach(c => {
  console.log('\n■ ' + c.name + '  (' + c.teacher + ')');
  c.sessions.forEach(s => {
    const day = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][s.day];
    const t = C.nodesToTime(d.settings.timeTable, s.startNode, s.endNode);
    console.log('   ' + day + ' 第' + s.startNode + '-' + s.endNode + '节 ' +
      t.start + '-' + t.end + '  ' + s.startWeek + '~' + s.endWeek + '周' +
      (s.weekType !== 'all' ? '(' + s.weekType + ')' : '') + '  ' + (s.location || ''));
  });
});

console.log('\n' + '='.repeat(90));
// 展开某几周的实例做抽查
[1, 2, 3, 4, 5].forEach(w => {
  const monday = C.weekStartDate(d.settings.termStart, w);
  const wk = C.agendaForWeek(d, monday);
  let total = 0;
  const lines = [];
  Object.keys(wk.days).sort().forEach(k => {
    (wk.days[k] || []).forEach(it => { total++; lines.push('   ' + k + ' ' + it.start + '-' + it.end + '  ' + it.name + ' @' + (it.location || '-') + '  [' + (it.teacher || '-') + ']'); });
  });
  console.log('\n【第' + w + '周】' + monday + ' 起，共 ' + total + ' 节课');
  lines.forEach(l => console.log(l));
});
