/* 检查 PWA 资产完整性与引用一致性 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let bad = 0;
const need = [];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function check(label, p) {
  const ok = fs.existsSync(path.join(ROOT, p));
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + '  ' + p);
  if (!ok) bad++;
}

console.log('\n[PWA 资产]');
need.push('index.html', 'app.js', 'core.js', 'manifest.webmanifest', 'sw.js',
  'favicon.ico', 'apple-touch-icon.png', 'seed.json');
need.forEach(f => check('存在', f));
manifest.icons.forEach(i => check('图标 ' + i.sizes, i.src));

console.log('\n[引用一致性]');
// manifest 里的图标是否都被 html 或 manifest 引用存在
const missIcon = manifest.icons.filter(i => !fs.existsSync(path.join(ROOT, i.src)));
console.log((missIcon.length ? '  ✗ ' : '  ✓ ') + 'manifest 图标全部可解析');
if (missIcon.length) bad++;

// sw 缓存清单里的文件是否都存在
const listed = sw.match(/'\.\/[^']+'/g) || [];
const missing = listed.map(s => s.replace(/'/g, '')).filter(u => {
  const p = u === './' ? 'index.html' : u.replace('./', '');
  return !fs.existsSync(path.join(ROOT, p));
});
console.log((missing.length ? '  ✗ ' : '  ✓ ') + 'Service Worker 缓存清单文件全部存在' +
  (missing.length ? ' -> ' + missing.join(', ') : ''));
if (missing.length) bad++;

// html 引用的脚本
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
scripts.forEach(s => check('html 引用脚本', s));

// html 引用的 css/manifest
const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1])
  .filter(h => !/^https?:/.test(h));
links.forEach(s => check('html 引用资源', s));

console.log('\n[关键元信息]');
console.log('  · 名称: ' + manifest.name);
console.log('  · 显示模式: ' + manifest.display);
console.log('  · 主题色: ' + manifest.theme_color);
console.log('  · 图标数: ' + manifest.icons.length);

console.log('\n[内置示例课表 seed.json]');
const seedPath = path.join(ROOT, 'seed.json');
if (fs.existsSync(seedPath)) {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const core = require(path.join(ROOT, 'core.js'));
  const d = core.migrate(seed);
  const sess = d.courses.reduce((n, c) => n + c.sessions.length, 0);
  const noTeacher = d.courses.filter(c => !c.teacher).length;
  const noColor = d.courses.filter(c => !c.color).length;
  console.log('  · 课程数: ' + d.courses.length + '，时段数: ' + sess);
  console.log('  · 学期起始: ' + d.settings.termStart + '，总周数: ' + d.settings.totalWeeks);
  console.log('  · 作息节数: ' + d.settings.timeTable.length);
  console.log('  · 课表名: ' + d.settings.tableName);

  // 示例课表要"能看"：有课、有作息、每门课都有教师与颜色；不要求门数多
  const shapeOk = d.courses.length >= 4 && sess >= 4 &&
    d.settings.timeTable.length === 14 && noTeacher === 0 && noColor === 0;
  console.log((shapeOk ? '  ✓ ' : '  ✗ ') +
    '示例数据完整（≥4 门课 / ≥4 时段 / 14 节作息 / 教师与颜色齐备）');
  if (!shapeOk) bad++;

  // ★ 隐私闸门：seed.json 是随 App 公开分发的文件，绝不能再装进真人课表。
  // 判据用「课表名必须自称示例」——比逐个比对教师姓名可靠，也好维护。
  const labeled = /示例|演示|样例|demo|sample/i.test(d.settings.tableName || '');
  console.log((labeled ? '  ✓ ' : '  ✗ ') + 'seed 明确标注为示例（tableName 含"示例"）');
  if (!labeled) bad++;

  const noEvents = !d.events || d.events.length === 0;
  console.log((noEvents ? '  ✓ ' : '  ✗ ') + 'seed 不含个人计划（events 为空）');
  if (!noEvents) bad++;

  // ★★ 硬闸门：seed.json 会随 App 公开在公网上（/seed.json 谁都能 fetch）。
  // 这份 deny list 是"绝不能出现在公开文件里"的真人姓名（陸屿真实课表的教师）。
  // 哪天有人重跑课表导入流程把 seed.json 覆盖回真实课表，这里会立刻红。
  // ★★ 硬闸门：seed.json 会随 App 公开在公网上（/seed.json 谁都能 fetch），
  // 所以它的教师名与地点**只允许**出现下面这些虚构值。
  //
  // 为什么用「白名单」而不是「黑名单」：黑名单得把真人姓名写进这个文件，
  // 而这个文件同样会被部署（/test/pwa.check.js 可下载）——
  // 那就等于为了防泄露又制造一次泄露。白名单达到同样的守卫效果，且零真实信息。
  // 谁重跑课表导入流程把 seed.json 覆盖回真实课表，这里会立刻红。
  const FAKE_TEACHERS = ['张明', '李静', '王浩', '刘芳', '陈刚', '赵磊'];
  const FAKE_LOCATIONS = ['教一101', '外语楼B203', '计算机楼机房A', '理教205',
    '体育馆', '教学三楼301'];

  const usedTeachers = Array.from(new Set(d.courses.map(c => c.teacher).filter(Boolean)));
  const badTeachers = usedTeachers.filter(t => FAKE_TEACHERS.indexOf(t) < 0);
  console.log((badTeachers.length ? '  ✗ ' : '  ✓ ') +
    'seed 教师仅限虚构白名单（' + usedTeachers.length + ' 个）' +
    (badTeachers.length ? ' → 越界: ' + badTeachers.join('、') : ''));
  if (badTeachers.length) bad++;

  const usedLocations = Array.from(new Set(
    d.courses.reduce((a, c) => a.concat(c.sessions.map(s => s.location)), []).filter(Boolean)
  ));
  const badLocations = usedLocations.filter(l => FAKE_LOCATIONS.indexOf(l) < 0);
  console.log((badLocations.length ? '  ✗ ' : '  ✓ ') +
    'seed 地点仅限虚构白名单（' + usedLocations.length + ' 个）' +
    (badLocations.length ? ' → 越界: ' + badLocations.join('、') : ''));
  if (badLocations.length) bad++;
} else {
  console.log('  ✗ 缺少 seed.json');
  bad++;
}

console.log('\n' + (bad ? '✗ 有 ' + bad + ' 项问题' : '✓ 全部通过') + '\n');
process.exit(bad ? 1 : 0);
