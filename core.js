/* =========================================================================
 * core.js — 纯逻辑层（无 DOM 依赖，可直接被 node 单测）
 * 负责：教学周换算 / 事件展开 / WakeUp 解析 / ICS 解析与导出 / 存储与备份
 * ========================================================================= */
(function (root, factory) {
  var Core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.Core = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- 日期工具 */

  // 全部日期以本地时区的 "YYYY-MM-DD" 字符串为唯一表示，避免任何 UTC 偏移坑
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // "YYYY-MM-DD" -> Date（本地 00:00）
  function fromKey(key) {
    var p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function today(now) { return toKey(now || new Date()); }

  function addDays(key, n) {
    var d = fromKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  function diffDays(a, b) {
    // b - a，按自然日计算
    return Math.round((fromKey(b) - fromKey(a)) / 86400000);
  }

  // 1=周一 ... 7=周日
  function weekdayOf(key) {
    var w = fromKey(key).getDay();
    return w === 0 ? 7 : w;
  }

  // 给定日期所在周的周一
  function mondayOf(key) {
    return addDays(key, -(weekdayOf(key) - 1));
  }

  var WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
  function weekdayName(day) { return '周' + WEEK_CN[day - 1]; }

  /* ------------------------------------------------------------ 教学周换算 */

  /**
   * 教学周第 1 周的星期一 -> 某日期属于第几教学周
   * 返回值可能 <=0（学期前）或 >总周数（学期后），调用方自行判断
   */
  function weekIndexOf(termStart, key) {
    var monday = mondayOf(key);
    return Math.floor(diffDays(mondayOf(termStart), monday) / 7) + 1;
  }

  // 第 n 教学周的周一日期
  function weekStartDate(termStart, weekNo) {
    return addDays(mondayOf(termStart), (weekNo - 1) * 7);
  }

  // 判断某教学周是否为单/双周
  function parityOf(weekNo) { return weekNo % 2 === 1 ? 'odd' : 'even'; }

  /* -------------------------------------------------------- 作息表 / 节次 */

  var DEFAULT_TIME_TABLE = [
    { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
    { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
    { start: '14:00', end: '14:45' }, { start: '14:55', end: '15:40' },
    { start: '16:00', end: '16:45' }, { start: '16:55', end: '17:40' },
    { start: '19:00', end: '19:45' }, { start: '19:55', end: '20:40' }
  ];

  // ★ DEFAULT_TIME_TABLE 是**只读基准**。要给某份 data 一份能改的作息表，
  // 必须用这个函数取**深拷贝**：早期 emptyData() 直接写 `.slice()`，
  // 那是浅拷贝 —— 数组是新的，但每个 {start,end} 还是同一批对象。
  // 后果：用户在设置页改第 1 节的时间，会顺着共享引用把全局基准也改掉，
  // 之后「清空所有数据」拿到的就不再是默认作息，而是他最后改过的那份。
  function defaultTimeTable() {
    return DEFAULT_TIME_TABLE.map(function (p) { return { start: p.start, end: p.end }; });
  }

  // 节次区间 -> {start,end}；节次从 1 开始
  function nodesToTime(timeTable, startNode, endNode) {
    var tt = timeTable && timeTable.length ? timeTable : DEFAULT_TIME_TABLE;
    var s = tt[startNode - 1], e = tt[endNode - 1];
    return { start: s ? s.start : '08:00', end: e ? e.end : '09:40' };
  }

  function timeToMinutes(hhmm) {
    var p = String(hhmm).split(':').map(Number);
    return (p[0] || 0) * 60 + (p[1] || 0);
  }

  function minutesToTime(min) {
    min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
    return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  }

  function addMinutes(hhmm, delta) { return minutesToTime(timeToMinutes(hhmm) + delta); }

  /* ------------------------------------- 作息表的自适应（按课表补足节次） */

  /**
   * 照现有作息表的「节奏」续出下一节：
   *   步长 = 相邻节次之间**最小**的开始间隔（自动跳过午休/晚饭那种大空档），
   *   时长 = 沿用最后一节。
   * 例：默认表是 55 分钟一节 + 10 分钟课间，第 10 节是 19:00-19:45，
   *     续出来的第 11 节就是 19:55-20:40 —— 而不会被"午饭那 3 小时空档"带跑。
   */
  function nextPeriod(tt) {
    var last = (tt && tt[tt.length - 1]) || { start: '08:00', end: '08:45' };
    var dur = timeToMinutes(last.end) - timeToMinutes(last.start);
    if (!(dur > 0)) dur = 45;

    var stride = 0;
    for (var i = 1; i < tt.length; i++) {
      var d = timeToMinutes(tt[i].start) - timeToMinutes(tt[i - 1].start);
      if (d > 0 && (!stride || d < stride)) stride = d;
    }
    if (!stride) stride = dur + 10;

    var LIMIT = 24 * 60 - 1;                 // 不越过午夜
    var start = Math.min(timeToMinutes(last.start) + stride, LIMIT);
    return { start: minutesToTime(start), end: minutesToTime(Math.min(start + dur, LIMIT)) };
  }

  /** 一天用到的最大「结束节次」（课程时段 + 调课），没有课返回 0 */
  function maxNodeUsed(data) {
    var m = 0;
    ((data && data.courses) || []).forEach(function (c) {
      ((c && c.sessions) || []).forEach(function (s) { m = Math.max(m, +s.endNode || 0); });
      ((c && c.overrides) || []).forEach(function (o) {
        if (o && o.endNode) m = Math.max(m, +o.endNode || 0);
      });
    });
    return m;
  }

  /**
   * ★ 让作息表至少覆盖到 maxNodeUsed 节；返回**新的** data（纯函数，不改入参）。
   *
   * 为什么非做不可：课表里存的是「第几节」，而周视图要按"具体时间"落位。
   * 一旦课程用到的节次超过作息表长度，nodesToTime 就取不到值 → 回落成第 1 节的时间，
   * 表现就是「第 11-13 节的课跑到第 1 节的位置」（时间显示 08:00-09:40）。
   * 补出来的节次带 auto:true，设置页会据此提示"这是自动补的，请核对时间"。
   */
  function fitTimeTable(data) {
    if (!data || !data.settings) return data;
    var src = data.settings.timeTable;
    var tt = (src && src.length) ? src.slice() : DEFAULT_TIME_TABLE.slice();
    var need = maxNodeUsed(data);
    var grew = false;
    while (tt.length < need && tt.length < 24) {
      var p = nextPeriod(tt);
      tt.push({ start: p.start, end: p.end, auto: true });
      grew = true;
    }
    if (!grew && src && src.length === tt.length) return data;   // 没动过就原样返回，避免无谓复制
    return Object.assign({}, data, {
      settings: Object.assign({}, data.settings, { timeTable: tt })
    });
  }

  /**
   * 把「一天几节课」调整到 n 节。
   *
   * 只动**末尾**：从中间删掉一节会让它后面所有课程的"第几节"整体前移一位，
   * 那等于在悄悄改用户的课表，所以不做。
   * 下限受"课表实际用到的节次"约束 —— 不能删到把已有的课弄丢。
   *
   * 返回 { data, added, removed, notes }；notes 是给用户看的提示。
   */
  function resizeTimeTable(data, n) {
    var need = maxNodeUsed(data);
    var want = Math.max(1, Math.min(24, Math.round(+n) || 1));
    var notes = [];

    if (want < need) {
      want = need;
      notes.push('课表里有课排到第 ' + need + ' 节，作息表不能少于 ' + need + ' 节，已按 ' + need + ' 节保留。');
    }

    var tt = ((data.settings && data.settings.timeTable) || DEFAULT_TIME_TABLE).slice();
    var added = 0, removed = 0;
    while (tt.length < want) {
      var p = nextPeriod(tt);
      tt.push({ start: p.start, end: p.end, auto: true });
      added++;
    }
    while (tt.length > want) { tt.pop(); removed++; }

    return {
      data: Object.assign({}, data, {
        settings: Object.assign({}, data.settings, { timeTable: tt })
      }),
      added: added, removed: removed, notes: notes
    };
  }

  /* -------------------------------------------------- 课程 -> 某日实例展开 */

  /**
   * 把一门课在指定日期展开成实例（不含 overrides 处理）
   * 返回 null 表示当天不上这门课
   */
  function courseSessionOnDate(course, dateKey, ctx) {
    var weekNo = weekIndexOf(ctx.termStart, dateKey);
    if (weekNo < 1 || weekNo > (ctx.totalWeeks || 20)) return null;

    var day = weekdayOf(dateKey);
    var parity = parityOf(weekNo);
    var out = [];

    (course.sessions || []).forEach(function (s) {
      if (s.day !== day) return;
      if (weekNo < s.startWeek || weekNo > s.endWeek) return;
      if (s.weekType === 'odd' && parity !== 'odd') return;
      if (s.weekType === 'even' && parity !== 'even') return;

      var t = (s.start && s.end)
        ? { start: s.start, end: s.end }
        : nodesToTime(ctx.timeTable, s.startNode, s.endNode);

      out.push({
        kind: 'course',
        id: course.id,
        name: course.name,
        type: 'course',
        date: dateKey,
        start: t.start,
        end: t.end,
        location: s.location || course.location || '',
        teacher: s.teacher || course.teacher || '',
        color: course.color || '#4c6ef5',
        startNode: s.startNode,
        endNode: s.endNode,
        weekNo: weekNo,
        sessionRef: s.id || null
      });
    });
    return out.length ? out : null;
  }

  /* ------------------------------------------------ 个人计划 -> 重复展开 */

  /**
   * 判断一个计划是否在指定日期发生
   * mode: none | weekly | biweekly
   */
  function eventOnDate(ev, dateKey, ctx) {
    var rep = ev.repeat || { mode: 'none' };

    if (rep.mode === 'none' || !rep.mode) {
      // 一次性：支持跨天（endDate）
      if (ev.endDate && ev.endDate !== ev.date) {
        return dateKey >= ev.date && dateKey <= ev.endDate;
      }
      return dateKey === ev.date;
    }

    if (rep.until && dateKey > rep.until) return false;
    if (dateKey < ev.date) return false;

    var days = (rep.days && rep.days.length) ? rep.days : [weekdayOf(ev.date)];
    if (days.indexOf(weekdayOf(dateKey)) === -1) return false;

    if (rep.mode === 'weekly') return true;

    if (rep.mode === 'biweekly') {
      var weekNo = weekIndexOf(ctx.termStart, dateKey);
      var anchorParity = rep.parity || parityOf(weekIndexOf(ctx.termStart, ev.date));
      return parityOf(weekNo) === anchorParity;
    }
    return false;
  }

  function eventInstance(ev, dateKey) {
    return {
      kind: 'event',
      id: ev.id,
      name: ev.name,
      type: ev.type || 'activity',
      date: dateKey,
      start: ev.start,
      end: ev.end,
      location: ev.location || '',
      note: ev.note || '',
      color: ev.color || null,
      // 待办专用：doneDays 记录哪些天已勾完（数组；true = 所有出现都完成，兼容旧数据）
      done: ev.type === 'todo' ? isDoneOn(ev.doneDays, dateKey) : false,
      // 待办用带框的多选圆点代替"第 X 节"这种时段感——由界面层决定样式
      isTodo: ev.type === 'todo'
    };
  }

  /**
   * 判断某个待办在指定日期是否已完成。
   * doneDays 为 true 时视为恒定完成（旧数据 / 一次性待办）；
   * 为数组时看是否包含该日期。
   */
  function isDoneOn(doneDays, dateKey) {
    if (doneDays === true) return true;
    if (!doneDays || !doneDays.length) return false;
    return doneDays.indexOf(dateKey) > -1;
  }

  /** 切换某个待办在指定日期的完成状态，返回新的 doneDays（不改原对象） */
  function toggleTodoDone(doneDays, dateKey) {
    if (doneDays === true) return [];                 // 原来是"全部完成" -> 取消完成
    var arr = (doneDays || []).slice();
    var i = arr.indexOf(dateKey);
    if (i > -1) arr.splice(i, 1); else arr.push(dateKey);
    return arr;
  }

  /* ------------------------------------------------------------ 总展开入口 */

  /**
   * 展开某一天的完整日程（课程 + 计划），处理调课/停课覆盖，按开始时间排序
   */
  function agendaForDate(data, dateKey) {
    var ctx = {
      termStart: data.settings.termStart,
      totalWeeks: data.settings.totalWeeks,
      timeTable: data.settings.timeTable
    };
    var items = [];

    (data.courses || []).forEach(function (course) {
      var list = courseSessionOnDate(course, dateKey, ctx) || [];
      // 调课/停课覆盖
      (course.overrides || []).forEach(function (ov) {
        if (ov.date !== dateKey) return;
        if (ov.action === 'cancel') {
          // 停课：移除当天来自该课的所有实例
          items = items.filter(function (it) {
            return !(it.kind === 'course' && it.id === course.id);
          });
          list = [];
        } else if (ov.action === 'move') {
          list = [];
          var t = (ov.start && ov.end)
            ? { start: ov.start, end: ov.end }
            : nodesToTime(ctx.timeTable, ov.startNode, ov.endNode);
          items.push({
            kind: 'course', id: course.id, name: course.name, type: 'course',
            date: dateKey, start: t.start, end: t.end,
            location: ov.location || course.location || '',
            teacher: course.teacher || '', color: course.color || '#4c6ef5',
            startNode: ov.startNode, endNode: ov.endNode,
            weekNo: weekIndexOf(ctx.termStart, dateKey), isMoved: true
          });
        } else if (ov.action === 'add') {
          // 补课：在原本没课的日期加一节
          var t2 = (ov.start && ov.end)
            ? { start: ov.start, end: ov.end }
            : nodesToTime(ctx.timeTable, ov.startNode, ov.endNode);
          list.push({
            kind: 'course', id: course.id, name: course.name, type: 'course',
            date: dateKey, start: t2.start, end: t2.end,
            location: ov.location || course.location || '',
            teacher: course.teacher || '', color: course.color || '#4c6ef5',
            startNode: ov.startNode, endNode: ov.endNode,
            weekNo: weekIndexOf(ctx.termStart, dateKey), isMakeup: true
          });
        }
      });
      items = items.concat(list);
    });

    (data.events || []).forEach(function (ev) {
      if (eventOnDate(ev, dateKey, ctx)) items.push(eventInstance(ev, dateKey));
    });

    items.sort(function (a, b) {
      var d = timeToMinutes(a.start) - timeToMinutes(b.start);
      return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
    });
    return items;
  }

  /**
   * 展开一整周 -> { "YYYY-MM-DD": [items...] }
   */
  function agendaForWeek(data, anyDateKey) {
    var monday = mondayOf(anyDateKey);
    var map = {};
    for (var i = 0; i < 7; i++) {
      var k = addDays(monday, i);
      map[k] = agendaForDate(data, k);
    }
    return { monday: monday, days: map };
  }

  /** 未来考试 + 倒计时 */
  function upcomingExams(data, fromKey, limit) {
    var from = fromKey || today();
    var horizon = addDays(from, 180);
    var out = [];
    (data.events || []).forEach(function (ev) {
      if ((ev.type || '') !== 'exam') return;
      var d = ev.date;
      // 重复的考试也取最近一次
      if (d < from) {
        if (!ev.repeat || ev.repeat.mode === 'none') return;
        for (var i = 0; i < 180; i++) {
          var k = addDays(from, i);
          if (eventOnDate(ev, k, {
            termStart: data.settings.termStart,
            totalWeeks: data.settings.totalWeeks
          })) { d = k; break; }
        }
      }
      if (d >= from && d <= horizon) {
        out.push({ id: ev.id, name: ev.name, date: d, start: ev.start, location: ev.location || '',
                   daysLeft: diffDays(from, d), event: ev });
      }
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return limit ? out.slice(0, limit) : out;
  }

  /* --------------------------------------------------- WakeUp 备份解析器 */

  /**
   * 解析 .wakeup_schedule
   * 该文件是「JSON Lines」纯文本：每行一个 JSON 对象，依次为
   *   1. timeMetadata   2. timeEntries[]   3. scheduleMetadata
   *   4. courseEntries[] 5. classEntries[]
   * 注意：它不是 ZIP。
   */
  function parseWakeup(text) {
    if (!text || !text.trim()) throw new Error('文件内容为空');
    var lines = String(text).split(/\r?\n/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });

    var arr;
    try {
      arr = lines.map(function (l) { return JSON.parse(l); });
    } catch (e) {
      throw new Error('不是合法的 WakeUp 备份文件（JSON 解析失败）：' + e.message);
    }
    if (arr.length < 5) {
      throw new Error('WakeUp 备份结构异常：期望 5 段数据，实际 ' + arr.length + ' 段');
    }

    var timeEntries = arr[1] || [];
    var meta = arr[2] || {};
    var courseEntries = arr[3] || [];
    var classEntries = arr[4] || [];

    var courseMap = {};
    courseEntries.forEach(function (c) { courseMap[c.id] = c; });

    // 按 day 排序保证节次表顺序正确
    var timeTable = timeEntries
      .slice()
      .sort(function (a, b) { return a.node - b.node; })
      .filter(function (e) { return e.node <= (meta.nodes || 99); })
      .map(function (e) { return { start: e.startTime, end: e.endTime }; });

    var TYPE_MAP = { 0: 'all', 1: 'odd', 2: 'even' };
    var PALETTE = ['#4c6ef5', '#12b886', '#f59f00', '#e8590c', '#ae3ec9',
                   '#1098ad', '#d6336c', '#74b816'];

    // 按课程名分组，一门课 -> 多个 session
    var byName = {};
    classEntries.forEach(function (cls) {
      if (cls.ownTime) return; // ownTime 表示自定义时间，跳过
      var meta2 = courseMap[cls.id];
      var name = (meta2 && meta2.courseName) || '未命名课程';
      if (!byName[name]) byName[name] = { name: name, sessions: [], teacher: '' };
      byName[name].sessions.push({
        day: cls.day,
        startNode: cls.startNode,
        endNode: cls.startNode + (cls.step || 1) - 1,
        startWeek: cls.startWeek,
        endWeek: cls.endWeek,
        weekType: TYPE_MAP[cls.type] || 'all',
        location: cls.room || '',
        teacher: cls.teacher || ''
      });
      if (!byName[name].teacher && cls.teacher) byName[name].teacher = cls.teacher;
    });

    var courses = Object.keys(byName).map(function (name, i) {
      var c = byName[name];
      return {
        id: 'c_' + Math.random().toString(36).slice(2, 10) + i,
        name: c.name,
        teacher: c.teacher,
        location: '',
        color: PALETTE[i % PALETTE.length],
        sessions: c.sessions,
        overrides: []
      };
    });

    var startDate = meta.startDate || '';
    // WakeUp 的 startDate 是第 1 周周一
    var termStart = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate : mondayOf(today());

    return {
      settings: {
        termStart: termStart,
        totalWeeks: meta.maxWeek || 20,
        showWeekend: !!(meta.showSat || meta.showSun),
        tableName: meta.tableName || '我的课表',
        timeTable: timeTable.length ? timeTable : defaultTimeTable()
      },
      courses: courses,
      events: [],
      warnings: timeTable.length ? [] : ['备份中没有作息表，已使用默认节次时间']
    };
  }

  /* ------------------------------------------------------- ICS 解析 / 导出 */

  function unfoldICS(text) {
    // RFC5545：续行以空格或 tab 开头
    return String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  }

  function parseICSProp(line) {
    var idx = line.indexOf(':');
    if (idx < 0) return null;
    var left = line.slice(0, idx), value = line.slice(idx + 1);
    var parts = left.split(';');
    var name = parts[0].toUpperCase();
    var params = {};
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length === 2) params[kv[0].toUpperCase()] = kv[1];
    }
    return { name: name, params: params, value: value };
  }

  // 20261010T080000 / 20261010 -> "2026-10-10" + 可选 "08:00"
  function parseICSDate(value) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(value);
    if (!m) return null;
    var date = m[1] + '-' + m[2] + '-' + m[3];
    var time = (m[4] !== undefined) ? (m[4] + ':' + m[5]) : null;
    return { date: date, time: time, isUTC: !!m[7] };
  }

  var ICS_DAY = { SU: 7, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  /**
   * 解析 ICS。课程类事件（SUMMARY 含课程特征或带 RRULE+LOCATION）归入 courses，
   * 其余归入 events。返回 { settings, courses, events }
   */
  function parseICS(text) {
    var lines = unfoldICS(text);
    var vevents = [], cur = null, inEvent = false;

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (line.toUpperCase() === 'BEGIN:VEVENT') { inEvent = true; cur = {}; return; }
      if (line.toUpperCase() === 'END:VEVENT') {
        if (cur) vevents.push(cur);
        inEvent = false; cur = null; return;
      }
      if (!inEvent) return;
      var p = parseICSProp(line);
      if (!p) return;
      if (p.name === 'SUMMARY') cur.summary = p.value;
      else if (p.name === 'LOCATION') cur.location = p.value;
      else if (p.name === 'DESCRIPTION') cur.description = p.value;
      else if (p.name === 'DTSTART') cur.dtstart = p.value;
      else if (p.name === 'DTEND') cur.dtend = p.value;
      else if (p.name === 'RRULE') cur.rrule = p.value;
      else if (p.name === 'EXDATE') cur.exdate = (cur.exdate || []).concat(p.value.split(','));
      else if (p.name === 'UID') cur.uid = p.value;
    });

    var courses = [], events = [];
    var termStart = null;

    vevents.forEach(function (v, i) {
      var ds = parseICSDate(v.dtstart || '');
      if (!ds) return;
      var de = v.dtend ? parseICSDate(v.dtend) : null;

      // 解析 RRULE
      var rrule = {};
      if (v.rrule) {
        v.rrule.split(';').forEach(function (seg) {
          var kv = seg.split('=');
          rrule[kv[0].toUpperCase()] = kv[1];
        });
      }

      var isWeekly = rrule.FREQ === 'WEEKLY';
      var byDay = rrule.BYDAY ? rrule.BYDAY.split(',').map(function (d) {
        return ICS_DAY[d.replace(/^[+-]?\d+/, '').toUpperCase()];
      }).filter(Boolean) : [weekdayOf(ds.date)];
      var interval = parseInt(rrule.INTERVAL || '1', 10);
      var until = rrule.UNTIL ? (parseICSDate(rrule.UNTIL) || {}).date : null;

      // 判断是否当作"课程"
      var looksLikeCourse = isWeekly && interval === 1 && !!v.location &&
        /课|课设|实验|体育|英语|数学|物理|化学|思政|导论|设计|原理/.test(v.summary || '') === false
        ? false : false;

      if (looksLikeCourse) {
        // 保留扩展位（当前不外置）
      }

      var weekType = 'all';
      if (interval === 2) weekType = 'odd'; // 以起始周为基准，奇偶由 startWeek 决定

      events.push({
        id: 'e_' + Math.random().toString(36).slice(2, 10) + i,
        name: v.summary || '未命名事件',
        type: 'activity',
        date: ds.date,
        endDate: de ? de.date : null,
        start: ds.time || '09:00',
        end: de && de.time ? de.time : (ds.time ? addMinutes(ds.time, 60) : '10:00'),
        location: v.location || '',
        note: (v.description || '').replace(/\\n/g, '\n').slice(0, 500),
        repeat: isWeekly
          ? { mode: interval === 2 ? 'biweekly' : 'weekly', days: byDay, until: until }
          : { mode: 'none' },
        reminders: [15]
      });

      if (isWeekly && ds.time) {
        // 记录最早日期，用于推断学期开始（第 1 周周一）
        if (!termStart || ds.date < termStart) termStart = ds.date;
      }
    });

    return {
      settings: {
        termStart: termStart ? mondayOf(termStart) : mondayOf(today()),
        totalWeeks: 20,
        timeTable: DEFAULT_TIME_TABLE.slice()
      },
      courses: courses,
      events: events
    };
  }

  /* ------------------------------------------------------------ ICS 导出 */

  function icsEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function icsDateTime(dateKey, hhmm) {
    return dateKey.replace(/-/g, '') + 'T' + String(hhmm || '09:00').replace(':', '') + '00';
  }

  function icsDayCode(day) {
    return ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][day - 1];
  }

  /** 把某一周展开后导出为 ICS（最稳妥：不依赖对方对 RRULE 的支持度） */
  function exportICS(data, fromKey, weeks) {
    var start = fromKey || today();
    var n = weeks || 20;
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//timetable//CN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'
    ];
    var stamp = toKey(new Date()).replace(/-/g, '') + 'T000000Z';
    var seq = 0;

    for (var w = 0; w < n; w++) {
      for (var d = 0; d < 7; d++) {
        var key = addDays(start, w * 7 + d);
        agendaForDate(data, key).forEach(function (it) {
          seq++;
          var uid = 'tt-' + seq + '-' + key.replace(/-/g, '') + '@local';
          lines.push('BEGIN:VEVENT');
          lines.push('UID:' + uid);
          lines.push('DTSTAMP:' + stamp);
          lines.push('DTSTART:' + icsDateTime(key, it.start));
          lines.push('DTEND:' + icsDateTime(key, it.end));
          var title = it.name + (it.type === 'exam' ? '【考试】' : '');
          lines.push('SUMMARY:' + icsEscape(title));
          if (it.location) lines.push('LOCATION:' + icsEscape(it.location));
          if (it.teacher) lines.push('DESCRIPTION:' + icsEscape(it.teacher + (it.note ? ' / ' + it.note : '')));
          else if (it.note) lines.push('DESCRIPTION:' + icsEscape(it.note));
          lines.push('END:VEVENT');
        });
      }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /* --------------------------------------------- 快捷批量文本录入（课表） */

  /**
   * 解析粘贴的课表文本，每行一门课：
   *   高数 周一 1-2节 1-16周 教三201
   *   大学英语 周三 3-4节 单周 A101
   *   体育 周五 5-6节 1-18周 操场
   * 返回 {courses, errors}
   */
  function parseCourseText(text) {
    var courses = [], errors = [];
    var DAY_MAP = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
    };
    var PALETTE = ['#4c6ef5', '#12b886', '#f59f00', '#e8590c', '#ae3ec9',
                   '#1098ad', '#d6336c', '#74b816'];

    var lines = String(text).split(/\r?\n/);
    lines.forEach(function (raw, idx) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;

      var day = null, m;
      m = /(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/.exec(line);
      if (m) day = DAY_MAP[m[1]];

      var startNode = null, endNode = null;
      m = /(\d+)\s*[-~—]\s*(\d+)\s*节/.exec(line);
      if (m) { startNode = +m[1]; endNode = +m[2]; }
      else {
        m = /第?\s*(\d+)\s*节/.exec(line);
        if (m) { startNode = endNode = +m[1]; }
      }

      if (!day || !startNode) {
        errors.push('第 ' + (idx + 1) + ' 行无法识别（需要"周X"和"N节"）：' + line);
        return;
      }

      var startWeek = 1, endWeek = 20, weekType = 'all';
      m = /(\d+)\s*[-~—]\s*(\d+)\s*周/.exec(line);
      if (m) { startWeek = +m[1]; endWeek = +m[2]; }
      else {
        m = /第?\s*(\d+)\s*周/.exec(line);
        if (m) { startWeek = endWeek = +m[1]; }
      }
      if (/单周/.test(line)) weekType = 'odd';
      else if (/双周/.test(line)) weekType = 'even';

      // 课程名 = 去掉所有已识别的片段后剩下的第一段
      var rest = line
        .replace(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, ' ')
        .replace(/\d+\s*[-~—]\s*\d+\s*节/g, ' ')
        .replace(/第?\s*\d+\s*节/g, ' ')
        .replace(/\d+\s*[-~—]\s*\d+\s*周/g, ' ')
        .replace(/第?\s*\d+\s*周/g, ' ')
        .replace(/单周|双周/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      var tokens = rest.split(' ').filter(Boolean);
      var name = tokens.shift() || '未命名课程';
      var location = tokens.join(' ');

      var exist = courses.filter(function (c) { return c.name === name; })[0];
      var session = {
        day: day, startNode: startNode, endNode: endNode,
        startWeek: startWeek, endWeek: endWeek, weekType: weekType, location: location
      };
      if (exist) exist.sessions.push(session);
      else courses.push({
        id: 'c_' + Math.random().toString(36).slice(2, 10) + idx,
        name: name, teacher: '', location: '', color: PALETTE[courses.length % PALETTE.length],
        sessions: [session], overrides: []
      });
    });

    return { courses: courses, errors: errors };
  }

  /* ------------------------------------------------------------ 校验 / 汇总 */

  function emptyData() {
    return {
      version: 1,
      settings: {
        termStart: mondayOf(today()),
        totalWeeks: 20,
        showWeekend: true,
        tableName: '我的课表',
        timeTable: defaultTimeTable(),
        reminderEnabled: true,
        defaultReminder: 15
      },
      courses: [],
      events: [],
      updatedAt: new Date().toISOString()
    };
  }

  /** 兼容/修复读入的数据，防止旧备份缺字段导致崩溃 */
  function migrate(data) {
    var base = emptyData();
    if (!data || typeof data !== 'object') return base;
    var out = {
      version: 1,
      settings: Object.assign({}, base.settings, data.settings || {}),
      courses: Array.isArray(data.courses) ? data.courses : [],
      events: Array.isArray(data.events) ? data.events : [],
      updatedAt: data.updatedAt || new Date().toISOString()
    };
    // 总是给一份自己的深拷贝：界面改时间只改这份 data，
    // 不会顺着共享引用改到 DEFAULT_TIME_TABLE（见 defaultTimeTable 的注释）。
    out.settings.timeTable = (out.settings.timeTable && out.settings.timeTable.length)
      ? out.settings.timeTable.map(function (p) {
        var o = { start: p.start, end: p.end };
        if (p.auto) o.auto = true;
        return o;
      })
      : defaultTimeTable();
    out.courses.forEach(function (c) {
      c.sessions = c.sessions || [];
      c.overrides = c.overrides || [];
      c.color = c.color || '#4c6ef5';
    });
    out.events.forEach(function (e) {
      e.type = e.type || 'activity';
      e.repeat = e.repeat || { mode: 'none' };
      e.reminders = e.reminders || [];
      // 待办的完成记录：未初始化时给空数组（不改变既有数据语义）
      if (e.type === 'todo' && e.doneDays === undefined) e.doneDays = [];
    });
    // 读进来的课表如果用到作息表之外的节次，这里就补足，
    // 免得老备份/别人的课表一打开就是"第 11 节的课跑到第 1 节"。
    return fitTimeTable(out);
  }

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  var TYPE_META = {
    course:   { label: '课程', color: '#4c6ef5' },
    gym:      { label: '健身', color: '#12b886' },
    exam:     { label: '考试', color: '#e03131' },
    activity: { label: '活动', color: '#f59f00' },
    todo:     { label: '待办', color: '#ae3ec9' }
  };

  return {
    // 日期
    pad2: pad2, toKey: toKey, fromKey: fromKey, today: today, addDays: addDays,
    diffDays: diffDays, weekdayOf: weekdayOf, mondayOf: mondayOf,
    weekdayName: weekdayName, WEEK_CN: WEEK_CN,
    // 周次
    weekIndexOf: weekIndexOf, weekStartDate: weekStartDate, parityOf: parityOf,
    // 节次与时间
    DEFAULT_TIME_TABLE: DEFAULT_TIME_TABLE, defaultTimeTable: defaultTimeTable,
    nodesToTime: nodesToTime,
    timeToMinutes: timeToMinutes, minutesToTime: minutesToTime, addMinutes: addMinutes,
    nextPeriod: nextPeriod, maxNodeUsed: maxNodeUsed,
    fitTimeTable: fitTimeTable, resizeTimeTable: resizeTimeTable,
    // 展开
    courseSessionOnDate: courseSessionOnDate, eventOnDate: eventOnDate,
    agendaForDate: agendaForDate, agendaForWeek: agendaForWeek, upcomingExams: upcomingExams,
    // 待办完成状态
    isDoneOn: isDoneOn, toggleTodoDone: toggleTodoDone,
    // 解析
    parseWakeup: parseWakeup, parseICS: parseICS, parseCourseText: parseCourseText,
    // 导出
    exportICS: exportICS,
    // 其他
    emptyData: emptyData, migrate: migrate, uid: uid, TYPE_META: TYPE_META
  };
});
