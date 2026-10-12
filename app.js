/* =========================================================================
 * app.js — 界面与交互层（依赖 core.js）
 * ========================================================================= */
(function () {
  'use strict';
  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------- 存储层 */

  var KEY = 'timetable.data.v1';
  var LS_KEY = 'timetable.fallback.v1';

  var Store = {
    // 优先 localStorage：个人数据量小，同步读写最简单，也没有 IndexedDB 的异步竞态
    save: function (data) {
      data.updatedAt = new Date().toISOString();
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) {
        alert('保存失败：本地存储空间不足或被禁用。\n' + e.message);
      }
    },
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        return C.migrate(JSON.parse(raw));
      } catch (e) {
        console.warn('读取失败', e);
        return null;
      }
    },
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };

  /* --------------------------------------------------------------- 状态 */

  // 「这台设备是不是第一次用」——必须在 tryLoadSeed() 之前取一次快照，
  // 因为载入内置课表时会 persist()，之后 KEY 就存在了。
  // 注意判据是「启动时本地一条数据都没有」，**不是**「data 为空」：
  // data 为空是常态（用户点了「清空所有数据」之后也是空的），拿它当判据
  // 会导致两个 bug：① 有内置课表时首启引导永远弹不出来；② 清空刷新后示例课表自己复活。
  var _saved = Store.load();
  var firstOpen = !_saved;
  var data = _saved || C.emptyData();
  var cursor = C.today();          // 当前查看的日期
  var mode = 'week';               // week | day
  var page = 'week';
  var planFilter = 'all';

  function persist() {
    // 保存前先让作息表覆盖到课表实际用到的节次。
    // 导入/编辑后都可能超出（比如课在第 11-13 节、而作息表只有 10 节），
    // 不补的话周视图会把"第 11 节"按第 1 节的时间画上去。详见 core.fitTimeTable。
    data = C.fitTimeTable(data);
    Store.save(data);
  }

  /* ------------------------------------------------------- 文件下载/读取 */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var el = $('#filePicker');
      el.value = '';
      el.accept = accept || '';
      el.onchange = function () {
        var f = el.files && el.files[0];
        if (!f) return resolve(null);
        var fr = new FileReader();
        fr.onload = function () { resolve({ name: f.name, text: String(fr.result) }); };
        fr.onerror = function () { alert('读取文件失败'); resolve(null); };
        fr.readAsText(f, 'utf-8');
      };
      el.click();
    });
  }

  function stamp() {
    var d = new Date();
    return C.toKey(d) + '_' + C.pad2(d.getHours()) + C.pad2(d.getMinutes());
  }

  /* ------------------------------------------------------------ 弹层控制 */

  var mask = $('#mask'), sheet = $('#sheet');
  function openSheet(html, onMount) {
    sheet.innerHTML = html;
    mask.classList.add('on');
    if (onMount) onMount(sheet);
  }
  function closeSheet() { mask.classList.remove('on'); sheet.innerHTML = ''; }
  mask.addEventListener('click', function (e) { if (e.target === mask) closeSheet(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + var(--sab));transform:translateX(-50%);' +
      'background:rgba(26,29,33,.92);color:#fff;padding:9px 16px;border-radius:20px;font-size:13px;' +
      'z-index:99;max-width:86vw;text-align:center;line-height:1.45';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .35s'; t.style.opacity = '0'; }, 1800);
    setTimeout(function () { t.remove(); }, 2300);
  }

  /* ------------------------------------------------------------ 导航切换 */

  function go(p) {
    page = p;
    $$('.page').forEach(function (el) { el.classList.remove('on'); });
    $('#page-' + p).classList.add('on');
    $$('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p); });
    $('#fab').style.display = (p === 'course' || p === 'plan' || p === 'week') ? 'flex' : 'none';
    window.scrollTo(0, 0);
    render();
  }

  $$('nav button').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.p); });
  });

  /* ============================================================ 周视图 */

  var HOUR_H = 56;         // 每小时像素高
  var DAY_START = 7;       // 早上 7 点开始画
  var DAY_END = 23;        // 看板默认画到 23 点（renderWeek 会按当天的作息表往后延）

  function renderTop() {
    var weekNo = C.weekIndexOf(data.settings.termStart, cursor);
    var total = data.settings.totalWeeks;
    var monday = C.mondayOf(cursor);

    var title;
    if (mode === 'week') {
      title = '第 ' + weekNo + ' 周';
      if (weekNo < 1) title = '学期前';
      else if (weekNo > total) title = '学期已结束';
    } else {
      title = C.toKey(C.fromKey(cursor)).replace(/^\d{4}-/, '').replace('-', '月') + '日 ' + C.weekdayName(C.weekdayOf(cursor));
    }
    $('#hdTitle').textContent = title;
    $('#todayBtn').style.display = (C.mondayOf(cursor) === C.mondayOf(C.today())) && mode === 'week' ? 'none' : 'flex';

    var parity = C.parityOf(weekNo);
    var html = '<span class="chip">' + monday.replace(/-/g, '/') + ' ~ ' + C.addDays(monday, 6).replace(/-/g, '/') + '</span>';
    if (mode === 'week' && weekNo >= 1 && weekNo <= total) {
      html += '<span class="chip on">' + (parity === 'odd' ? '单周' : '双周') + '</span>';
    }
    html += '<span class="chip">共 ' + total + ' 周</span>';
    $('#termBar').innerHTML = html;
  }

  function renderExamBanner() {
    var box = $('#examBanner');
    if (page !== 'week') { box.innerHTML = ''; return; }
    var list = C.upcomingExams(data, C.today(), 3);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map(function (e) {
      var when = e.date.slice(5).replace('-', '/') + (e.start ? ' ' + e.start : '');
      var cd = e.daysLeft === 0 ? '今天！' : '还有 ' + e.daysLeft + ' 天';
      return '<div class="examcard" data-exam="' + e.id + '">' +
        '<span class="nm">★ ' + esc(e.name) + '</span>' +
        '<span class="when">' + when + '</span>' +
        '<span class="cd">' + cd + '</span></div>';
    }).join('');
    $$('#examBanner .examcard').forEach(function (el) {
      el.addEventListener('click', function () {
        var ev = data.events.filter(function (x) { return x.id === el.dataset.exam; })[0];
        if (ev) openPlanEditor(ev);
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // 把 "HH:MM" 换算成相对 DAY_START 的偏移（小时，可为小数）
  function timeOffset(hhmm) {
    return C.timeToMinutes(hhmm) / 60 - DAY_START;
  }

  // 周视图卡片宽度有限：去掉「XX校区」这种每节课都一样的冗余前缀，只留楼名+房间。
  // 刻意不写死具体校区名 —— 写死等于把"人在哪所学校"泄漏进公开的 app.js。
  function shortLoc(loc) {
    return String(loc || '')
      .replace(/^[^\s（）()]{1,8}?校区\s*/, '')
      .replace(/校区\s*/, '')
      .trim();
  }

  function renderWeek() {
    var showWe = data.settings.showWeekend !== false;
    var monday = C.mondayOf(cursor);
    var wk = C.agendaForWeek(data, cursor);
    var todayKey = C.today();

    var days = [1, 2, 3, 4, 5];
    if (showWe) days.push(6, 7);

    // 表头
    var head = '<div class="wk-head"><div></div>';
    days.forEach(function (d) {
      var key = C.addDays(monday, d - 1);
      var cls = (key === todayKey ? ' today' : '') + (d >= 6 ? ' we' : '');
      head += '<div class="' + cls.trim() + '"><div class="wd">' + C.weekdayName(d) + '</div>' +
        '<div class="dd">' + (+key.slice(8)) + '</div></div>';
    });
    head += '</div>';

    // 时间轴：按「节次」画，而不是按整点画——每节标出真实起止时间
    var tt = data.settings.timeTable && data.settings.timeTable.length
      ? data.settings.timeTable : C.DEFAULT_TIME_TABLE;

    // 看板底部跟着**这张作息表**走，而不是写死 23 点：
    // 别人学校一天可能有 13 节，最后一节 21:15 结束，也可能排到 23 点以后。
    var dayEnd = DAY_END;
    tt.forEach(function (p) {
      dayEnd = Math.max(dayEnd, Math.ceil(C.timeToMinutes(p.end) / 60));
    });
    dayEnd = Math.min(24, dayEnd);          // 一天最多画到 24:00

    var body = '<div class="wk-body"><div class="hours">';
    // 只画作息表里落在显示范围内的节次
    var shown = [];
    tt.forEach(function (p, i) {
      var s = C.timeToMinutes(p.start);
      if (s < DAY_START * 60 || s >= dayEnd * 60) return;
      shown.push({ idx: i + 1, start: p.start, end: p.end, top: s / 60 - DAY_START });
    });
    // 节次之间的空隙也画出分隔线
    // ★ 节次轴必须与右侧卡片/网格线共用同一原点（DAY_START=7:00 那条线）：
    //   第一节若不是 7:00 开始（通常是 8:00），得先用占位块把这段空档补出来，
    //   否则整条节次轴会比卡片上移一小时，看起来「第 1 节的课排到了第 2 节」。
    if (shown.length && shown[0].top > 0) {
      body += '<div class="hourPad" style="height:' +
        (shown[0].top * HOUR_H).toFixed(1) + 'px"></div>';
    }
    shown.forEach(function (p, k) {
      var h = k + 1 < shown.length
        ? shown[k + 1].top - p.top
        : (C.timeToMinutes(p.end) / 60 - DAY_START) - p.top;
      body += '<div class="hour" style="height:' + (h * HOUR_H).toFixed(1) + 'px">' +
        '<span>第' + p.idx + '节</span>' +
        '<em>' + p.start + '</em>' +
        '</div>';
    });
    body += '</div>';

    days.forEach(function (d) {
      var key = C.addDays(monday, d - 1);
      var items = wk.days[key] || [];
      var colH = (dayEnd - DAY_START) * HOUR_H;
      var c = '<div class="daycol' + (d >= 6 ? ' we' : '') + '" data-date="' + key + '" style="height:' + colH + 'px">';
      // 横向网格线对齐到每一节的顶部（与左侧时间轴一致）
      shown.forEach(function (p) {
        c += '<div class="gridline" style="top:' + (p.top * HOUR_H).toFixed(1) + 'px"></div>';
      });

      // 重叠事件做简单的横向分栏
      var laid = layout(items);
      laid.forEach(function (o) {
        var it = o.it;
        var top = timeOffset(it.start) * HOUR_H;
        var hgt = Math.max(22, (C.timeToMinutes(it.end) - C.timeToMinutes(it.start)) / 60 * HOUR_H - 2);
        var wPct = 100 / o.cols;
        var leftPct = o.col * wPct;
        var cls = it.type === 'exam' ? 'exam' : (it.type || 'course');
        if (it.isMoved || it.isMakeup) cls += ' moved';
        // 待办：已完成时整块变淡 + 删除线
        if (it.type === 'todo' && it.done) cls += ' done';
        // 分栏过多（重叠）或极矮 → tiny（只留课名）；
        // 矮块（单节课）放不下「课名/地点/起/止」四行 → short（地点让位，起止仍是两行小字）
        var colPx = (o.cols > 1 ? (340 / 7) / o.cols : 340 / 7);
        var narrow = o.cols >= 2 || hgt < 34;
        var shortBlk = !narrow && hgt < 56;
        if (narrow) cls += ' tiny';
        else if (shortBlk) cls += ' short';
        // 每门课程用自己的颜色（考试/健身/活动/待办仍按类型配色）
        var bg = (it.type === 'course' || !it.type) && it.color
          ? 'background:' + it.color + ';'
          : '';
        // 待办在卡片右上角放勾选圆点（点它切换完成，点卡片其他位置=编辑）
        // ✓ 由 CSS ::before 提供，未勾选时 visibility:hidden
        var tick = it.type === 'todo'
          ? '<em class="todoBox' + (it.done ? ' on' : '') + '" data-tick="1"></em>'
          : '';
        // 卡面信息层级：课名（第1行）/ 地点（第2行）/ 起·止（第3、4行，更小字）。
        // 矮块放不下四行 → 地点让位（起止仍是两行小字）；极窄/极矮只留课名。
        var inner = tick + '<b>' + esc(it.name) + '</b>';
        if (it.type !== 'todo' && !narrow) {
          if (!shortBlk && it.location) inner += '<i class="loc">' + esc(shortLoc(it.location)) + '</i>';
          inner += '<i class="t1">' + it.start + '</i><i class="t2">' + it.end + '</i>';
        }
        c += '<div class="ev ' + cls + '" data-kind="' + it.kind + '" data-id="' + it.id + '" ' +
          'data-date="' + key + '" style="' + bg + 'top:' + top.toFixed(1) + 'px;height:' + hgt.toFixed(1) +
          'px;left:calc(' + leftPct.toFixed(1) + '% + 1px);right:auto;width:calc(' + wPct.toFixed(1) + '% - 2px)">' +
          inner +
          '</div>';
      });
      c += '</div>';
      body += c;
    });
    body += '</div>';

    $('#weekWrap').innerHTML = head + body;

    // 点空白格 = 在该时段新建
    $$('#weekWrap .daycol').forEach(function (col) {
      col.addEventListener('click', function (e) {
        if (e.target.closest('.ev')) return;
        var key = col.dataset.date;
        var rect = col.getBoundingClientRect();
        var hour = Math.floor((e.clientY - rect.top) / HOUR_H) + DAY_START;
        hour = Math.max(DAY_START, Math.min(dayEnd - 1, hour));
        openPlanEditor(null, { date: key, start: C.pad2(hour) + ':00', end: C.pad2(hour + 1) + ':00' });
      });
    });

    // 点事件 = 编辑；点待办的勾选圈 = 切换完成
    $$('#weekWrap .ev').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.target.closest('[data-tick]')) {
          toggleTodo(el.dataset.id, el.dataset.date);
          return;
        }
        openEditorFor(el.dataset.kind, el.dataset.id, el.dataset.date);
      });
    });
  }

  /**
   * 把同一天的items按时间重叠分栏，避免互相盖住
   * 返回 [{it, col, cols}]
   */
  function layout(items) {
    if (!items.length) return [];
    var sorted = items.slice().sort(function (a, b) {
      return C.timeToMinutes(a.start) - C.timeToMinutes(b.start);
    });
    var groups = [], cur = [], curEnd = -1;
    sorted.forEach(function (it) {
      var s = C.timeToMinutes(it.start);
      if (cur.length && s >= curEnd) { groups.push(cur); cur = []; curEnd = -1; }
      cur.push(it);
      curEnd = Math.max(curEnd, C.timeToMinutes(it.end));
    });
    if (cur.length) groups.push(cur);

    var out = [];
    groups.forEach(function (g) {
      // 组内列分配
      var cols = 0, assign = [];
      g.forEach(function (it) {
        var placed = false;
        for (var ci = 0; ci < cols; ci++) {
          var last = assign[ci][assign[ci].length - 1];
          if (C.timeToMinutes(last.end) <= C.timeToMinutes(it.start)) {
            assign[ci].push(it); it.__col = ci; placed = true; break;
          }
        }
        if (!placed) { assign.push([it]); it.__col = cols; cols++; }
      });
      g.forEach(function (it) { out.push({ it: it, col: it.__col, cols: cols }); });
    });
    return out;
  }

  /* ============================================================ 日视图 */

  function renderDay() {
    var key = cursor;
    var items = C.agendaForDate(data, key);
    var weekNo = C.weekIndexOf(data.settings.termStart, key);
    var head = '<div class="today-hd"><div class="big">' +
      (+key.slice(5, 7)) + ' 月 ' + (+key.slice(8)) + ' 日 ' + C.weekdayName(C.weekdayOf(key)) + '</div>' +
      '<div class="sub">第 ' + weekNo + ' 周 · ' +
      (weekNo % 2 === 1 ? '单周' : '双周') + ' · ' + items.length + ' 项安排</div></div>';

    if (!items.length) {
      $('#dayWrap').innerHTML = head + '<div class="empty">今天没有安排 🎉</div>';
      return;
    }
    var body = '<div class="daylist">' + items.map(function (it) {
      var tagCls = 't-' + (it.type || 'course');
      var tag = C.TYPE_META[it.type] ? C.TYPE_META[it.type].label : '课程';
      var extra = it.isMoved ? '<span class="tag t-move">调课</span>'
        : it.isMakeup ? '<span class="tag t-move">补课</span>' : '';
      var isTodo = it.type === 'todo';
      // 待办用勾选圆点代替时间；点圆点=勾完，点其他地方=编辑
      // ✓ 由 CSS ::before 提供，未勾选时 visibility:hidden（见 index.html 注释）
      var tick = isTodo
        ? '<div class="todoTick' + (it.done ? ' on' : '') + '" data-tick="1"></div>'
        : '';
      var tm = isTodo ? '<div class="tm">待办</div>'
        : '<div class="tm">' + it.start + '<br>' + it.end + '</div>';
      return '<div class="dayrow' + (isTodo && it.done ? ' todo-done' : '') + '" data-kind="' +
        it.kind + '" data-id="' + it.id + '" data-date="' + key + '">' +
        tick +
        '<div class="bar" style="background:' + (it.color || C.TYPE_META[it.type].color) + '"></div>' +
        tm +
        '<div class="bd"><div class="ttl">' + esc(it.name) +
        '<span class="tag ' + tagCls + '">' + tag + '</span>' + extra + '</div>' +
        '<div class="meta">' +
        (it.location ? esc(it.location) : '') +
        (it.teacher ? ' · ' + esc(it.teacher) : '') +
        (it.note ? '<br>' + esc(it.note) : '') +
        '</div></div></div>';
    }).join('') + '</div>';

    $('#dayWrap').innerHTML = head + body;
    $$('#dayWrap .dayrow').forEach(function (el) {
      el.addEventListener('click', function (e) {
        // 点待办的勾选圆点 -> 切换完成状态，不打开编辑器
        if (e.target.closest('[data-tick]')) {
          e.stopPropagation();
          toggleTodo(el.dataset.id, el.dataset.date);
          return;
        }
        openEditorFor(el.dataset.kind, el.dataset.id, el.dataset.date);
      });
    });
  }

  /**
   * 勾选/取消勾选一个待办在某一天的完成状态，然后重绘。
   * 待办按"天"记录完成情况：重复待办可以这周勾了、下周没勾。
   */
  function toggleTodo(id, dateKey) {
    var ev = data.events.filter(function (x) { return x.id === id; })[0];
    if (!ev) return;
    ev.doneDays = C.toggleTodoDone(ev.doneDays, dateKey);
    persist();
    render();
  }

  /* ==================================================== 点击事件 -> 编辑器 */

  function openEditorFor(kind, id, dateKey) {
    if (kind === 'course') {
      var course = data.courses.filter(function (c) { return c.id === id; })[0];
      if (course) openCourseEditor(course, dateKey);
    } else {
      var ev = data.events.filter(function (e) { return e.id === id; })[0];
      if (ev) openPlanEditor(ev, { date: dateKey });
    }
  }

  /* ==================================================== 课程编辑器 */

  var WEEK_TYPE_SEG = [['all', '每周'], ['odd', '单周'], ['even', '双周']];
  var PALETTE = ['#4c6ef5', '#12b886', '#f59f00', '#e8590c', '#ae3ec9',
                 '#1098ad', '#d6336c', '#74b816'];

  function openCourseEditor(course, focusDate) {
    var isNew = !course;
    var c = course || {
      id: C.uid('c'), name: '', teacher: '', location: '',
      color: PALETTE[data.courses.length % PALETTE.length],
      sessions: [], overrides: []
    };

    // 若从周视图某天点进来，默认补一条该天的 session
    if (isNew) {
      c.sessions = [{
        day: focusDate ? C.weekdayOf(focusDate) : 1,
        startNode: 1, endNode: 2, startWeek: 1, endWeek: data.settings.totalWeeks,
        weekType: 'all', location: ''
      }];
    }

    function sessionRows() {
      return c.sessions.map(function (s, i) {
        return '<div class="session" data-i="' + i + '" style="border:1px solid var(--line);' +
          'border-radius:8px;padding:9px;margin-bottom:8px">' +
          '<div class="row3"><div class="fld" style="margin:0">' +
          '<label>星期</label><select class="s-day">' +
          [1, 2, 3, 4, 5, 6, 7].map(function (d) {
            return '<option value="' + d + '"' + (s.day === d ? ' selected' : '') + '>' + C.weekdayName(d) + '</option>';
          }).join('') + '</select></div>' +
          '<div class="fld" style="margin:0"><label>起始节</label>' +
          '<input type="number" class="s-sn" min="1" max="20" value="' + s.startNode + '"></div>' +
          '<div class="fld" style="margin:0"><label>结束节</label>' +
          '<input type="number" class="s-en" min="1" max="20" value="' + s.endNode + '"></div></div>' +
          '<div class="row3" style="margin-top:8px">' +
          '<div class="fld" style="margin:0"><label>起始周</label>' +
          '<input type="number" class="s-sw" min="1" max="30" value="' + s.startWeek + '"></div>' +
          '<div class="fld" style="margin:0"><label>结束周</label>' +
          '<input type="number" class="s-ew" min="1" max="30" value="' + s.endWeek + '"></div>' +
          '<div class="fld" style="margin:0"><label>周次类型</label>' +
          '<select class="s-wt">' + WEEK_TYPE_SEG.map(function (w) {
            return '<option value="' + w[0] + '"' + (s.weekType === w[0] ? ' selected' : '') + '>' + w[1] + '</option>';
          }).join('') + '</select></div></div>' +
          '<div class="fld" style="margin:8px 0 0"><label>地点</label>' +
          '<input type="text" class="s-loc" value="' + esc(s.location || '') + '" placeholder="如 教三201"></div>' +
          (c.sessions.length > 1
            ? '<div class="btnrow" style="margin-top:6px"><button class="btn danger" data-del-session="' + i + '">删除该时段</button></div>'
            : '') +
          '</div>';
      }).join('');
    }

    openSheet(
      '<h3><span>' + (isNew ? '添加课程' : '编辑课程') + '</span>' +
      '<button class="iconbtn" data-close>✕</button></h3>' +
      '<div class="fld"><label>课程名</label><input type="text" id="cName" value="' + esc(c.name) + '" placeholder="如 高等数学"></div>' +
      '<div class="row2">' +
      '<div class="fld"><label>教师</label><input type="text" id="cTeacher" value="' + esc(c.teacher || '') + '"></div>' +
      '<div class="fld"><label>颜色</label><select id="cColor">' + PALETTE.map(function (p) {
        return '<option value="' + p + '"' + (c.color === p ? ' selected' : '') + ' style="background:' + p + '">' + p + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="fld"><label>上课时段（一门课可有多个）</label><div id="sessionBox">' + sessionRows() + '</div>' +
      '<button class="btn ghost block" id="addSessionBtn" style="margin-top:4px">+ 增加一个时段</button>' +
      '<div class="hint" id="snHint"></div></div>' +
      (isNew ? '' : '<div class="fld"><label>调课 / 停课（只影响某一天）</label>' +
        '<div id="ovBox"></div>' +
        '<button class="btn ghost block" id="addOvBtn" style="margin-top:4px">+ 添加调课</button></div>') +
      '<div class="btnrow">' +
      (isNew ? '' : '<button class="btn danger" id="delCourseBtn">删除课程</button>') +
      '<button class="btn" id="saveCourseBtn">保存</button></div>',
      function (root) {
        $$('[data-close]', root).forEach(function (b) { b.addEventListener('click', closeSheet); });

        function readSessions() {
          return $$('.session', root).map(function (el) {
            return {
              day: +$('.s-day', el).value,
              startNode: +$('.s-sn', el).value || 1,
              endNode: +$('.s-en', el).value || 1,
              startWeek: +$('.s-sw', el).value || 1,
              endWeek: +$('.s-ew', el).value || 20,
              weekType: $('.s-wt', el).value,
              location: $('.s-loc', el).value.trim()
            };
          });
        }

        // 保存前把界面上所有 session / override 输入回写到对象上
        function commitSessions() {
          var prev = c.sessions;
          c.sessions = readSessions();
          // session 数量没变时才回写（避免"增加时段"流程里把旧数据覆盖成新行）
          if (!c.sessions.length) c.sessions = prev;
          if (typeof root.__collectOverrides === 'function') root.__collectOverrides();
        }

        $('#addSessionBtn', root).addEventListener('click', function () {
          commitSessions();
          c.sessions.push({
            day: 1, startNode: 1, endNode: 2,
            startWeek: 1, endWeek: data.settings.totalWeeks, weekType: 'all', location: ''
          });
          $('#sessionBox', root).innerHTML = sessionRows();
          bindSession(root);
        });

        // 节次一旦超出作息表就提前说清楚：保存后会自动补齐，但时间要自己核对。
        // 不这么说，用户会以为"第 11 节被吞了 / 跑到第 1 节去了"。
        function updateSnHint() {
          var el = $('#snHint', root);
          if (!el) return;
          var maxN = 0;
          $$('.session', root).forEach(function (row) {
            maxN = Math.max(maxN, +$('.s-en', row).value || 0);
          });
          var len = (data.settings.timeTable || []).length;
          if (maxN > len) {
            el.innerHTML = '<span style="color:#d9480f">作息表现在只到第 ' + len + ' 节。' +
              '保存后会照你的作息节奏补到第 ' + maxN + ' 节，' +
              '请到「设置 → 上课时间表」核对时间。</span>';
          } else {
            el.textContent = '节次对应的时间由「设置 → 上课时间表」决定。';
          }
        }

        function bindSession(root) {
          $$('[data-del-session]', root).forEach(function (b) {
            b.addEventListener('click', function () {
              commitSessions();
              c.sessions.splice(+b.dataset.delSession, 1);
              $('#sessionBox', root).innerHTML = sessionRows();
              bindSession(root);
            });
          });
          $$('.s-sn, .s-en', root).forEach(function (inp) {
            inp.addEventListener('input', updateSnHint);
            inp.addEventListener('change', updateSnHint);
          });
          updateSnHint();
        }
        bindSession(root);

        if (!isNew) bindOverrides(root, c);

        $('#delCourseBtn', root) && $('#delCourseBtn', root).addEventListener('click', function () {
          if (!confirm('删除课程「' + c.name + '」？其所有时段与调课记录都会移除。')) return;
          data.courses = data.courses.filter(function (x) { return x.id !== c.id; });
          persist(); closeSheet(); render(); toast('已删除');
        });

        $('#saveCourseBtn', root).addEventListener('click', function () {
          var name = $('#cName', root).value.trim();
          if (!name) { toast('请填写课程名'); return; }
          commitSessions();
          if (!c.sessions.length) { toast('至少需要一个上课时段'); return; }
          c.sessions.forEach(function (s) {
            if (s.endNode < s.startNode) { var t = s.startNode; s.startNode = s.endNode; s.endNode = t; }
            if (s.endWeek < s.startWeek) { var u = s.startWeek; s.startWeek = s.endWeek; s.endWeek = u; }
          });
          c.name = name;
          c.teacher = $('#cTeacher', root).value.trim();
          c.color = $('#cColor', root).value;
          if (isNew) data.courses.push(c);
          persist(); closeSheet(); render(); toast('已保存');
        });
      }
    );
  }

  /* ------------------------------------------- 调课 / 停课 子界面 */

  var ACTIONS = [['cancel', '停课'], ['move', '调到其他时间'], ['add', '补课']];

  function bindOverrides(root, c) {
    var box = $('#ovBox', root);
    if (!box) return;

    function paint() {
      box.innerHTML = (c.overrides || []).map(function (o, i) {
        return '<div class="ov" data-i="' + i + '" style="border:1px solid var(--line);border-radius:8px;' +
          'padding:9px;margin-bottom:8px">' +
          '<div class="row2"><div class="fld" style="margin:0"><label>日期</label>' +
          '<input type="date" class="o-date" value="' + o.date + '"></div>' +
          '<div class="fld" style="margin:0"><label>操作</label><select class="o-act">' +
          ACTIONS.map(function (a) {
            return '<option value="' + a[0] + '"' + (o.action === a[0] ? ' selected' : '') + '>' + a[1] + '</option>';
          }).join('') + '</select></div></div>' +
          (o.action === 'cancel' ? '' :
            '<div class="row3" style="margin-top:8px">' +
            '<div class="fld" style="margin:0"><label>起始节</label><input type="number" class="o-sn" min="1" value="' + (o.startNode || 1) + '"></div>' +
            '<div class="fld" style="margin:0"><label>结束节</label><input type="number" class="o-en" min="1" value="' + (o.endNode || 2) + '"></div>' +
            '<div class="fld" style="margin:0"><label>地点</label><input type="text" class="o-loc" value="' + esc(o.location || '') + '"></div>' +
            '</div>') +
          '<div class="btnrow" style="margin-top:6px"><button class="btn danger" data-del-ov="' + i + '">删除</button></div>' +
          '</div>';
      }).join('') || '<div class="hint">暂无调课记录。</div>';

      $$('[data-del-ov]', box).forEach(function (b) {
        b.addEventListener('click', function () {
          collect(); c.overrides.splice(+b.dataset.delOv, 1); paint();
        });
      });
      $$('.o-act', box).forEach(function (sel) {
        sel.addEventListener('change', function () { collect(); paint(); });
      });
    }

    function collect() {
      if (!c.overrides) c.overrides = [];
      $$('.ov', box).forEach(function (el) {
        var i = +el.dataset.i;
        if (!c.overrides[i]) return;
        c.overrides[i].date = $('.o-date', el).value;
        c.overrides[i].action = $('.o-act', el).value;
        var sn = $('.o-sn', el), en = $('.o-en', el), loc = $('.o-loc', el);
        if (sn) c.overrides[i].startNode = +sn.value;
        if (en) c.overrides[i].endNode = +en.value;
        if (loc) c.overrides[i].location = loc.value.trim();
      });
    }

    root.__collectOverrides = collect;
    $('#addOvBtn', root).addEventListener('click', function () {
      collect();
      c.overrides.push({ date: C.today(), action: 'cancel' });
      paint();
    });
    paint();
  }

  /* ==================================================== 计划编辑器 */

  function openPlanEditor(ev, preset) {
    var isNew = !ev;
    var e = ev || {
      id: C.uid('e'), name: '', type: 'todo',
      date: (preset && preset.date) || C.today(),
      endDate: null,
      start: (preset && preset.start) || '09:00',
      end: (preset && preset.end) || '10:00',
      location: '', note: '',
      repeat: { mode: 'none' }, reminders: [], doneDays: []
    };
    var rep = e.repeat || { mode: 'none' };
    // 用户在弹层里的实时编辑态。所有分段控件的选中态都从它读，
    // 保存时再一次性写回 e。必须在下面的 seg 函数被调用之前声明。
    var editing = {
      type: e.type,
      mode: rep.mode || 'none',
      days: rep.days ? rep.days.slice() : null,
      parity: rep.parity || null
    };

    function typeSeg() {
      return ['todo', 'gym', 'exam', 'activity'].map(function (t) {
        return '<button data-t="' + t + '" class="' + (e.type === t ? 'on' : '') + '">' +
          C.TYPE_META[t].label + '</button>';
      }).join('');
    }
    // 注意：以下 seg 一律读 editing（用户实时编辑态），不能读 rep（打开弹层时的快照）
    function modeSeg() {
      return [['none', '一次性'], ['weekly', '每周重复'], ['biweekly', '隔周重复']].map(function (m) {
        return '<button data-m="' + m[0] + '" class="' + (editing.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>';
      }).join('');
    }
    function daySeg() {
      var days = editing.days || [C.weekdayOf(e.date)];
      return [1, 2, 3, 4, 5, 6, 7].map(function (d) {
        return '<button data-d="' + d + '" class="' + (days.indexOf(d) > -1 ? 'on' : '') + '">' +
          C.WEEK_CN[d - 1] + '</button>';
      }).join('');
    }
    function paritySeg() {
      return [['odd', '单周'], ['even', '双周']].map(function (p) {
        return '<button data-p="' + p[0] + '" class="' + (editing.parity === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
      }).join('');
    }

    function repBlock() {
      if (editing.mode === 'none') return '';
      return '<div class="fld"><label>重复的星期</label><div class="daypick" id="dayPick">' + daySeg() + '</div></div>' +
        (editing.mode === 'biweekly'
          ? '<div class="fld"><label>只在单周还是双周</label><div class="seg" id="paritySeg">' + paritySeg() + '</div></div>'
          : '') +
        '<div class="fld"><label>重复到（留空 = 一直重复）</label>' +
        '<input type="date" id="pUntil" value="' + (rep.until || '') + '"></div>';
    }

    // 待办是"某天要做的事"，不占具体时段，所以隐藏开始/结束时间
    function timeBlock() {
      if (editing.type === 'todo') return '';
      return '<div class="row2" id="timeRow">' +
        '<div class="fld"><label>开始时间</label><input type="time" id="pStart" value="' + e.start + '"></div>' +
        '<div class="fld"><label>结束时间</label><input type="time" id="pEnd" value="' + e.end + '"></div></div>';
    }

    openSheet(
      '<h3><span>' + (isNew ? '新建计划' : '编辑计划') + '</span>' +
      '<button class="iconbtn" data-close>✕</button></h3>' +
      '<div class="fld"><label>类型</label><div class="seg" id="typeSeg">' + typeSeg() + '</div>' +
      '<div class="hint" id="typeHint">' +
      (editing.type === 'todo'
        ? '待办不占具体时段，只记「这一天要做」；在日历上点圆圈即可勾完'
        : '考试类型会在日历顶部显示倒计天数 ★') + '</div></div>' +
      '<div class="fld"><label>名称</label><input type="text" id="pName" value="' + esc(e.name) + '" placeholder="如 高数期中考试 / 健身"></div>' +
      '<div class="fld"><label>重复方式</label><div class="seg" id="modeSeg">' + modeSeg() + '</div></div>' +
      '<div id="repBox">' + repBlock() + '</div>' +
      '<div class="fld" id="dateFld"><label>' + (rep.mode === 'none' ? '日期' : '首次日期') + '</label>' +
      '<input type="date" id="pDate" value="' + e.date + '"></div>' +
      '<div id="timeBox">' + timeBlock() + '</div>' +
      '<div class="fld"><label>地点（可选）</label><input type="text" id="pLoc" value="' + esc(e.location || '') + '"></div>' +
      '<div class="fld"><label>备注（可选）</label><textarea id="pNote" rows="2">' + esc(e.note || '') + '</textarea></div>' +
      '<div class="btnrow">' +
      (isNew ? '' : '<button class="btn danger" id="delPlanBtn">删除</button>') +
      '<button class="btn" id="savePlanBtn">保存</button></div>',
      function (root) {
        $$('[data-close]', root).forEach(function (b) { b.addEventListener('click', closeSheet); });

        function repaintRep() {
          $('#repBox', root).innerHTML = repBlock();
          $('#dateFld', root).querySelector('label').textContent = editing.mode === 'none' ? '日期' : '首次日期';
          bindRep();
        }
        function bindRep() {
          $$('#dayPick button', root).forEach(function (b) {
            b.addEventListener('click', function () {
              var d = +b.dataset.d;
              editing.days = editing.days || [];
              var i = editing.days.indexOf(d);
              if (i > -1) editing.days.splice(i, 1); else editing.days.push(d);
              b.classList.toggle('on');
            });
          });
          $$('#paritySeg button', root).forEach(function (b) {
            b.addEventListener('click', function () {
              editing.parity = b.dataset.p;
              $$('#paritySeg button', root).forEach(function (x) { x.classList.remove('on'); });
              b.classList.add('on');
            });
          });
        }
        bindRep();

        $$('#typeSeg button', root).forEach(function (b) {
          b.addEventListener('click', function () {
            editing.type = b.dataset.t;
            $$('#typeSeg button', root).forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
            // 待办没有起止时段 —— 切换类型时即时重画时间行
            $('#timeBox', root).innerHTML = timeBlock();
            var hint = $('#typeHint', root);
            if (hint) {
              hint.textContent = editing.type === 'todo'
                ? '待办不占具体时段，只记「这一天要做」；在日历上点圆圈即可勾完'
                : '考试类型会在日历顶部显示倒计天数 ★';
            }
          });
        });

        $$('#modeSeg button', root).forEach(function (b) {
          b.addEventListener('click', function () {
            editing.mode = b.dataset.m;
            $$('#modeSeg button', root).forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
            if (editing.mode !== 'none' && (!editing.days || !editing.days.length)) {
              editing.days = [C.weekdayOf($('#pDate', root).value)];
            }
            if (editing.mode === 'biweekly' && !editing.parity) {
              var wk = C.weekIndexOf(data.settings.termStart, $('#pDate', root).value);
              editing.parity = C.parityOf(wk);
            }
            repaintRep();
          });
        });

        $('#delPlanBtn', root) && $('#delPlanBtn', root).addEventListener('click', function () {
          if (!confirm('删除「' + e.name + '」？')) return;
          data.events = data.events.filter(function (x) { return x.id !== e.id; });
          persist(); closeSheet(); render(); toast('已删除');
        });

        $('#savePlanBtn', root).addEventListener('click', function () {
          var name = $('#pName', root).value.trim();
          if (!name) { toast('请填写名称'); return; }
          var date = $('#pDate', root).value || C.today();
          var isTodo = editing.type === 'todo';
          // 待办没有时间输入框，给一组占位值（不入日历时间轴，仅保证数据结构完整）
          var startEl = $('#pStart', root), endEl = $('#pEnd', root);
          var start = (startEl && startEl.value) || e.start || '09:00';
          var end = (endEl && endEl.value) || e.end || '10:00';
          if (!isTodo && C.timeToMinutes(end) < C.timeToMinutes(start)) {
            toast('结束时间不能早于开始时间'); return;
          }

          e.name = name;
          e.type = editing.type;
          e.date = date;
          e.start = start;
          e.end = isTodo ? start : end;   // 待办退化为"零时长"，日历上按点显示
          e.location = $('#pLoc', root).value.trim();
          e.note = $('#pNote', root).value.trim();
          delete e.endDate;
          // 待办保留已有完成记录；从别的类型改成待办时补一个空数组
          if (isTodo) { if (e.doneDays === undefined) e.doneDays = []; }
          else { delete e.doneDays; }

          if (editing.mode === 'none') {
            e.repeat = { mode: 'none' };
          } else {
            var days = (editing.days && editing.days.length) ? editing.days.slice() : [C.weekdayOf(date)];
            e.repeat = {
              mode: editing.mode,
              days: days,
              parity: editing.mode === 'biweekly' ? (editing.parity || C.parityOf(C.weekIndexOf(data.settings.termStart, date))) : undefined,
              until: $('#pUntil', root) ? ($('#pUntil', root).value || null) : null
            };
          }
          if (isNew) data.events.push(e);
          persist(); closeSheet(); render(); toast('已保存');
        });
      }
    );
  }

  /* ==================================================== 课程页 & 计划页 */

  function renderCoursePage() {
    $('#courseCount').textContent = data.courses.length + ' 门课程';
    var box = $('#courseList');
    if (!data.courses.length) {
      box.innerHTML = '<div class="empty">还没有课程。<br>可以「批量粘贴录入」，或导入 WakeUp 课表。</div>';
      return;
    }
    box.innerHTML = data.courses.map(function (c) {
      var sess = c.sessions.map(function (s) {
        return C.weekdayName(s.day) + ' 第' + s.startNode + '-' + s.endNode + '节 ' +
          s.startWeek + '-' + s.endWeek + '周' +
          (s.weekType === 'odd' ? '单周' : s.weekType === 'even' ? '双周' : '') +
          (s.location ? ' @' + s.location : '');
      }).join('<br>');
      var t = c.sessions[0] ? C.nodesToTime(data.settings.timeTable, c.sessions[0].startNode, c.sessions[0].endNode) : { start: '', end: '' };
      return '<div class="li" data-cid="' + c.id + '"><div class="bar" style="background:' + c.color + '"></div>' +
        '<div class="bd"><div class="ttl">' + esc(c.name) + (c.teacher ? ' <span style="font-weight:400;color:var(--muted);font-size:12px">' + esc(c.teacher) + '</span>' : '') + '</div>' +
        '<div class="meta">' + sess + (c.overrides && c.overrides.length ? '<br><span style="color:#e67700">调课 ' + c.overrides.length + ' 次</span>' : '') + '</div></div>' +
        '<div style="font-size:11px;color:var(--muted2);flex:0 0 auto">' + t.start + '</div></div>';
    }).join('');
    $$('#courseList .li').forEach(function (el) {
      el.addEventListener('click', function () {
        var c = data.courses.filter(function (x) { return x.id === el.dataset.cid; })[0];
        if (c) openCourseEditor(c);
      });
    });
  }

  function renderPlanPage() {
    var list = data.events.filter(function (e) { return planFilter === 'all' || e.type === planFilter; });
    $('#planCount').textContent = list.length + ' 项';
    var box = $('#planList');
    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有计划。<br>点右下角 + 添加待办、健身、考试或活动。</div>';
      return;
    }
    var order = { exam: 0, todo: 1, gym: 2, activity: 3 };
    list = list.slice().sort(function (a, b) {
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    box.innerHTML = list.map(function (e) {
      var isTodo = e.type === 'todo';
      var repTxt = '一次性';
      if (e.repeat && e.repeat.mode === 'weekly') {
        repTxt = '每周 ' + (e.repeat.days || []).map(function (d) { return C.WEEK_CN[d - 1]; }).join('') +
          (e.repeat.until ? '（至 ' + e.repeat.until + '）' : '');
      } else if (e.repeat && e.repeat.mode === 'biweekly') {
        repTxt = '隔周' + (e.repeat.parity === 'odd' ? '单周' : '双周') + ' ' +
          (e.repeat.days || []).map(function (d) { return C.WEEK_CN[d - 1]; }).join('');
      }
      var extra = '';
      if (e.type === 'exam') {
        var left = C.diffDays(C.today(), e.date);
        extra = left >= 0 ? ' · <span style="color:#e03131;font-weight:600">还有 ' + left + ' 天</span>' : ' · 已结束';
      }
      // 待办：勾选状态 + 进度（重复待办显示已完成天数）
      var tick = '';
      var doneCls = '';
      if (isTodo) {
        var done = C.isDoneOn(e.doneDays, C.today());
        var doneCount = e.doneDays === true ? 1 : ((e.doneDays || []).length);
        tick = '<div class="todoTick' + (done ? ' on' : '') + '" data-tick="1">✓</div>';
        if (done) doneCls = ' todo-done';
        if (e.repeat && e.repeat.mode !== 'none' && doneCount) {
          extra += ' · <span style="color:var(--c-todo)">已勾 ' + doneCount + ' 次</span>';
        }
      }
      var when = isTodo ? '待办' : (e.date + ' ' + e.start + '-' + e.end);
      return '<div class="li' + doneCls + '" data-eid="' + e.id + '">' +
        tick +
        '<div class="bar" style="background:' + C.TYPE_META[e.type].color + '"></div>' +
        '<div class="bd"><div class="ttl">' + esc(e.name) +
        '<span class="tag t-' + e.type + '" style="margin-left:6px">' + C.TYPE_META[e.type].label + '</span></div>' +
        '<div class="meta">' + when +
        (e.location ? ' @' + esc(e.location) : '') + '<br>' + repTxt + extra + '</div></div></div>';
    }).join('');
    $$('#planList .li').forEach(function (el) {
      el.addEventListener('click', function (e) {
        // 点勾选圈 -> 勾完（以今天为准）；点其他地方 -> 编辑
        if (e.target.closest('[data-tick]')) {
          e.stopPropagation();
          toggleTodo(el.dataset.eid, C.today());
          return;
        }
        var ev = data.events.filter(function (x) { return x.id === el.dataset.eid; })[0];
        if (ev) openPlanEditor(ev);
      });
    });
  }

  function renderSettings() {
    var s = data.settings;
    $('#setTermStart').value = s.termStart;
    $('#setTotalWeeks').value = s.totalWeeks;
    $('#setTableName').value = s.tableName || '';
    $$('#setWe button').forEach(function (b) {
      b.classList.toggle('on', (s.showWeekend !== false ? '1' : '0') === b.dataset.v);
    });
    if (!$('#icsFrom').value) $('#icsFrom').value = C.today();

    // 作息表：一天几节、每节几点 —— 这是"各人各自的学校情况"，所以做成可加减的
    var tt = s.timeTable;
    var used = C.maxNodeUsed(data);
    $('#ttCount').value = tt.length;
    $('#ttList').innerHTML = tt.map(function (t, i) {
      return '<div class="ttrow">' +
        '<div class="ttno">第 ' + (i + 1) + ' 节' +
        (t.auto ? '<i title="按你的课表节奏自动补的，请核对时间">自动</i>' : '') + '</div>' +
        '<input type="time" class="tt-s" data-i="' + i + '" value="' + t.start + '">' +
        '<input type="time" class="tt-e" data-i="' + i + '" value="' + t.end + '">' +
        '</div>';
    }).join('');

    var hint = '你的一天有 <b>' + tt.length + '</b> 节。';
    if (used) hint += '课表用到了第 <b>' + used + '</b> 节。';
    var autoRows = [];
    tt.forEach(function (t, i) { if (t.auto) autoRows.push(i + 1); });
    if (autoRows.length) {
      hint += '<br><span style="color:#d9480f">第 ' + autoRows.join('、') +
        ' 节是照你的作息节奏自动补出来的，请核对时间对不对。</span>';
    }
    $('#ttHint').innerHTML = hint;

    $$('#ttList input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var i = +inp.dataset.i;
        var isStart = inp.classList.contains('tt-s');
        var val = inp.value || (isStart ? '08:00' : '08:45');
        data.settings.timeTable[i][isStart ? 'start' : 'end'] = val;
        delete data.settings.timeTable[i].auto;   // 人手改过就不再算"自动补的"
        persist(); renderSettings(); toast('作息表已更新');
      });
    });
  }

  /** 调整「一天几节课」。只动末尾，减不下去时会给出提示（见 core.resizeTimeTable） */
  function applyTimeTableCount(n) {
    var r = C.resizeTimeTable(data, n);
    data = r.data;
    persist();
    renderSettings();
    render();
    var msg = r.notes.length ? r.notes[0]
      : r.added ? '已补到 ' + data.settings.timeTable.length + ' 节，新增的请核对时间'
        : r.removed ? '已减到 ' + data.settings.timeTable.length + ' 节'
          : '';
    if (msg) toast(msg);
  }

  $('#ttPlus').addEventListener('click', function () {
    applyTimeTableCount(data.settings.timeTable.length + 1);
  });
  $('#ttMinus').addEventListener('click', function () {
    applyTimeTableCount(data.settings.timeTable.length - 1);
  });
  $('#ttCount').addEventListener('change', function () { applyTimeTableCount(+this.value); });

  /* ==================================================== 新建入口 */

  $('#fab').addEventListener('click', function () {
    if (page === 'course') openCourseEditor(null, C.mondayOf(cursor));
    else if (page === 'plan') openPlanEditor(null, {
      date: cursor,
      start: '09:00', end: '10:00'
    });
    else {
      openSheet('<h3><span>新建</span><button class="iconbtn" data-close>✕</button></h3>' +
        '<div class="btnrow"><button class="btn" id="nPlan">计划（健身/考试/活动）</button>' +
        '<button class="btn ghost" id="nCourse">课程</button></div>',
        function (root) {
          $('[data-close]', root).addEventListener('click', closeSheet);
          $('#nPlan', root).addEventListener('click', function () {
            closeSheet(); openPlanEditor(null, { date: cursor, start: '09:00', end: '10:00' });
          });
          $('#nCourse', root).addEventListener('click', function () {
            closeSheet(); openCourseEditor(null, cursor);
          });
        });
    }
  });

  /* ==================================================== 导入 / 导出 */

  function mergeCourses(incoming, replace) {
    var added = 0;
    incoming.forEach(function (nc) {
      var same = data.courses.filter(function (c) { return c.name === nc.name; })[0];
      if (same && !replace) {
        // 同名合并时段
        nc.sessions.forEach(function (s) {
          var dup = same.sessions.some(function (x) {
            return x.day === s.day && x.startNode === s.startNode && x.startWeek === s.startWeek;
          });
          if (!dup) same.sessions.push(s);
        });
      } else {
        data.courses.push(nc); added++;
      }
    });
    return added;
  }

  function applyImport(parsed, opts) {
    var replace = opts && opts.replace;
    if (parsed.settings) {
      if (parsed.settings.termStart) data.settings.termStart = parsed.settings.termStart;
      if (parsed.settings.totalWeeks) data.settings.totalWeeks = parsed.settings.totalWeeks;
      if (parsed.settings.tableName) data.settings.tableName = parsed.settings.tableName;
      if (parsed.settings.timeTable && parsed.settings.timeTable.length) {
        data.settings.timeTable = parsed.settings.timeTable;
      }
      if (typeof parsed.settings.showWeekend === 'boolean') {
        data.settings.showWeekend = parsed.settings.showWeekend;
      }
    }
    if (replace) {
      data.courses = parsed.courses || [];
      data.events = parsed.events || [];
    } else {
      var before = data.courses.length;
      mergeCourses(parsed.courses || [], false);
      (parsed.events || []).forEach(function (e) { data.events.push(e); });
    }
    // persist() 内部会把作息表补到课表用到的节次。返回补了几节，
    // 好让调用方提示用户"新增的节次时间要自己核对"。
    var beforeNodes = (data.settings.timeTable || []).length;
    persist();
    return data.settings.timeTable.length - beforeNodes;
  }

  $('#courseImportBtn').addEventListener('click', function () {
    openSheet(
      '<h3><span>导入课表</span><button class="iconbtn" data-close>✕</button></h3>' +
      '<div class="hint" style="margin-bottom:12px">' +
      '· <b>WakeUp 课表</b>：在 App 里点右上角分享 → 「导出为备份」，会得到 <code>.wakeup_schedule</code> 文件，选它即可。<br>' +
      '· <b>ICS</b>：从系统日历或其他课表 App 导出的 .ics 文件。</div>' +
      '<div class="btnrow"><button class="btn" id="ipWake">选择 .wakeup_schedule</button>' +
      '<button class="btn ghost" id="ipIcs">选择 .ics</button></div>' +
      '<div class="fld" style="margin-top:12px"><label>导入方式</label>' +
      '<div class="seg" id="ipMode"><button data-r="0" class="on">合并到现有课表</button>' +
      '<button data-r="1">清空后替换</button></div></div>',
      function (root) {
        var replace = false;
        $('[data-close]', root).addEventListener('click', closeSheet);
        $$('#ipMode button', root).forEach(function (b) {
          b.addEventListener('click', function () {
            replace = b.dataset.r === '1';
            $$('#ipMode button', root).forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
          });
        });

        $('#ipWake', root).addEventListener('click', function () {
          pickFile('.wakeup_schedule,.txt,.json').then(function (f) {
            if (!f) return;
            try {
              var parsed = C.parseWakeup(f.text);
              var grew = applyImport(parsed, { replace: replace });
              closeSheet(); go('course');
              toast('导入成功：' + parsed.courses.length + ' 门课程' +
                (parsed.warnings && parsed.warnings.length ? '（' + parsed.warnings[0] + '）' : '') +
                (grew ? '；作息表已补到 ' + data.settings.timeTable.length + ' 节，请核对时间' : ''));
            } catch (err) {
              alert('导入失败\n\n' + err.message +
                '\n\n请确认选择的是 WakeUp 的「导出为备份」文件（.wakeup_schedule）。');
            }
          });
        });

        $('#ipIcs', root).addEventListener('click', function () {
          pickFile('.ics,.txt').then(function (f) {
            if (!f) return;
            try {
              var parsed = C.parseICS(f.text);
              if (!parsed.events.length) { alert('这个 ICS 里没有找到任何事件。'); return; }
              applyImport(parsed, { replace: false });
              closeSheet(); go('plan');
              toast('导入成功：' + parsed.events.length + ' 个事件');
            } catch (err) {
              alert('导入失败\n\n' + err.message);
            }
          });
        });
      });
  });

  $('#importWakeBtn').addEventListener('click', function () { $('#courseImportBtn').click(); });

  $('#importIcsBtn').addEventListener('click', function () {
    pickFile('.ics,.txt').then(function (f) {
      if (!f) return;
      try {
        var parsed = C.parseICS(f.text);
        applyImport(parsed, { replace: false });
        toast('已导入 ' + parsed.events.length + ' 个事件');
        go('plan');
      } catch (err) { alert('导入失败\n\n' + err.message); }
    });
  });

  $('#importJsonBtn').addEventListener('click', function () {
    pickFile('.json').then(function (f) {
      if (!f) return;
      try {
        var obj = JSON.parse(f.text);
        if (!obj.courses && !obj.events) throw new Error('文件里没有 courses / events 字段');
        if (!confirm('恢复备份会覆盖当前全部数据，继续？')) return;
        data = C.migrate(obj);
        persist(); closeSheet(); render();
        toast('恢复成功：' + data.courses.length + ' 门课程、' + data.events.length + ' 个计划');
      } catch (err) { alert('恢复失败\n\n' + err.message); }
    });
  });

  $('#exportJsonBtn').addEventListener('click', function () {
    download('课表备份_' + stamp() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('已导出 JSON 备份');
  });

  $('#exportIcsBtn').addEventListener('click', function () {
    var from = $('#icsFrom').value || C.today();
    var n = Math.max(1, Math.min(30, +$('#icsWeeks').value || 20));
    download('课表_' + stamp() + '.ics', C.exportICS(data, from, n), 'text/calendar');
    toast('已导出 ' + n + ' 周的 ICS');
  });

  $('#clearAllBtn').addEventListener('click', function () {
    if (!confirm('确定清空所有课程与计划？此操作不可恢复。\n建议先导出 JSON 备份。')) return;
    if (!confirm('再次确认：真的要清空吗？')) return;
    data = C.emptyData();
    persist(); render(); toast('已清空');
  });

  /* ==================================================== 批量粘贴录入 */

  $('#pasteCourseBtn').addEventListener('click', function () {
    openSheet(
      '<h3><span>批量粘贴录入</span><button class="iconbtn" data-close>✕</button></h3>' +
      '<div class="hint" style="margin-bottom:8px">每行一门课，格式：<br>' +
      '<code>课程名 周X 第几节-第几节 第几周-第几周 地点</code><br>' +
      '示例：<br><code>高等数学 周一 1-2节 1-16周 教三201</code><br>' +
      '<code>大学英语 周三 3-4节 单周 外语楼A101</code><br>' +
      '<code>体育 周五 5-6节 1-18周 操场</code></div>' +
      '<div class="fld"><textarea id="ptxt" rows="8" placeholder="高等数学 周一 1-2节 1-16周 教三201"></textarea></div>' +
      '<div id="pPrev"></div>' +
      '<div class="btnrow"><button class="btn ghost" id="pCheck">先检查一下</button>' +
      '<button class="btn" id="pOk">导入</button></div>',
      function (root) {
        $('[data-close]', root).addEventListener('click', closeSheet);
        $('#pCheck', root).addEventListener('click', function () {
          var r = C.parseCourseText($('#ptxt', root).value);
          var html = '<div class="preview">识别到 <b>' + r.courses.length + '</b> 门课程、' +
            r.courses.reduce(function (n, c) { return n + c.sessions.length; }, 0) + ' 个时段。';
          if (r.errors.length) html += '<br><span style="color:#d9480f">' + r.errors.length + ' 行未识别：</span><br>' +
            r.errors.map(esc).join('<br>');
          html += '</div>';
          $('#pPrev', root).innerHTML = html;
        });
        $('#pOk', root).addEventListener('click', function () {
          var r = C.parseCourseText($('#ptxt', root).value);
          if (!r.courses.length) { toast('没有识别到课程'); return; }
          var grew = applyImport({ courses: r.courses }, { replace: false });
          closeSheet(); go('course');
          toast('已导入 ' + r.courses.length + ' 门课程' +
            (r.errors.length ? '，' + r.errors.length + ' 行跳过' : '') +
            (grew ? '；作息表已补到 ' + data.settings.timeTable.length + ' 节，请到设置里核对时间' : ''));
        });
      });
  });

  $('#addCourseBtn').addEventListener('click', function () { openCourseEditor(null); });
  $('#addPlanBtn').addEventListener('click', function () {
    openPlanEditor(null, { date: C.today(), start: '09:00', end: '10:00' });
  });

  $$('#planFilter button').forEach(function (b) {
    b.addEventListener('click', function () {
      planFilter = b.dataset.f;
      $$('#planFilter button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      renderPlanPage();
    });
  });

  /* ==================================================== 设置交互 */

  $('#saveSettingsBtn').addEventListener('click', function () {
    var ts = $('#setTermStart').value;
    if (ts && C.weekdayOf(ts) !== 1) {
      var mon = C.mondayOf(ts);
      if (!confirm('选择的日期不是星期一。\n是否自动改为该周的星期一（' + mon + '）？\n（教学周以周一为起点）')) return;
      ts = mon;
      $('#setTermStart').value = mon;
    }
    data.settings.termStart = ts || data.settings.termStart;
    data.settings.totalWeeks = Math.max(1, +$('#setTotalWeeks').value || 20);
    data.settings.tableName = $('#setTableName').value.trim();
    persist(); render(); toast('设置已保存');
  });

  $$('#setWe button').forEach(function (b) {
    b.addEventListener('click', function () {
      data.settings.showWeekend = b.dataset.v === '1';
      persist();
      $$('#setWe button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      renderWeek();
    });
  });

  /* ==================================================== 视图切换 */

  $('#mWeek').addEventListener('click', function () {
    mode = 'week'; $('#mWeek').classList.add('on'); $('#mDay').classList.remove('on');
    $('#weekWrap').style.display = ''; $('#dayWrap').style.display = 'none';
    renderTop(); renderExamBanner();
  });
  $('#mDay').addEventListener('click', function () {
    mode = 'day'; $('#mDay').classList.add('on'); $('#mWeek').classList.remove('on');
    $('#weekWrap').style.display = 'none'; $('#dayWrap').style.display = '';
    renderTop(); $('#examBanner').innerHTML = ''; renderDay();
  });
  $('#prevBtn').addEventListener('click', function () {
    cursor = mode === 'week' ? C.addDays(cursor, -7) : C.addDays(cursor, -1);
    render();
  });
  $('#nextBtn').addEventListener('click', function () {
    cursor = mode === 'week' ? C.addDays(cursor, 7) : C.addDays(cursor, 1);
    render();
  });
  $('#todayBtn').addEventListener('click', function () { cursor = C.today(); render(); });

  // 左右滑动手势
  (function () {
    var x0 = null, y0 = null;
    var target = $('.page.on') || document.body;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (x0 === null || page !== 'week') { x0 = null; return; }
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
      if (mask.classList.contains('on')) return;
      cursor = C.addDays(cursor, dx < 0 ? (mode === 'week' ? 7 : 1) : (mode === 'week' ? -7 : -1));
      render();
    }, { passive: true });
  })();

  /* ==================================================== 界面刷新 */

  // 从后台切回来时重画一次（浏览器定时器在后台会被降频）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });

  /* ==================================================== 渲染总入口 */

  function render() {
    renderTop();
    renderExamBanner();
    if (mode === 'week') renderWeek(); else renderDay();
    $('#weekWrap').style.display = mode === 'week' ? '' : 'none';
    $('#dayWrap').style.display = mode === 'day' ? '' : 'none';
    if (page === 'course') renderCoursePage();
    if (page === 'plan') renderPlanPage();
    if (page === 'set') renderSettings();
  }

  /* ==================================================== 使用说明 */

  // 「使用说明」是一个独立页面（底部导航「说明」→ #page-help），不再是弹层。
  // 正文写在 index.html 里（静态 HTML：好维护，也能单独打开看）。
  // 这里只负责三件事：① 设置页里的入口接到该页；② 目录跳转；③ 复制"让 AI 转格式"的提示词。

  $$('[data-help]').forEach(function (b) {
    b.addEventListener('click', function () { go('help'); });
  });

  // 说明页顶部的目录：点一下滚到对应小节
  $$('#page-help [data-goto]').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = document.getElementById(b.dataset.goto);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // 「复制这段话」：把"让 AI 把课表转成本 App 格式"的提示词放进剪贴板
  // （说明页有两段提示词：批量粘贴格式 + .ics 格式，共用同一套复制逻辑）
  (function () {
    function fallback(text) {
      // http://<IP> 等非安全上下文里 navigator.clipboard 不可用，退回 execCommand
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        toast(ok ? '已复制，去粘给你的 AI 吧' : '复制失败，请长按框内文字手动复制');
      } catch (e) {
        toast('复制失败，请长按框内文字手动复制');
      }
    }

    function bindCopy(btnId, preId) {
      var btn = $('#' + btnId);
      if (!btn) return;
      btn.addEventListener('click', function () {
        var pre = $('#' + preId);
        var text = pre ? pre.textContent : '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { toast('已复制，去粘给你的 AI 吧'); },
            function () { fallback(text); }
          );
        } else {
          fallback(text);
        }
      });
    }

    bindCopy('copyAiPrompt', 'aiPrompt');
    bindCopy('copyAiPromptIcs', 'aiPromptIcs');
  })();

  /* ==================================================== 初始化 */

  window.__ttDebug = function (d) {
    data = C.migrate(d);
    cursor = C.today();   // 复位到本周，避免测试相互影响
    persist();
    render();
  };
  window.__dumpData = function () { return JSON.parse(JSON.stringify(data)); };
  window.__dumpSettings = function () { return JSON.parse(JSON.stringify(data.settings)); };

  // 首次打开（本机没有任何数据）时，自动加载随 App 附带的 seed.json（本学期课表）
  function tryLoadSeed(done) {
    // 只在"这台设备从没用过"时载入内置课表。
    // 不要用「data 为空」判断：用户点「清空所有数据」后 data 也是空的，
    // 那样一刷新示例课表就会自己冒出来。
    if (!firstOpen) return done();
    if (location.protocol === 'file:') return done();   // file:// 下 fetch 受限，跳过
    if (typeof fetch !== 'function') return done();     // 老环境无 fetch，跳过
    fetch('seed.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (obj) {
        if (!obj || !obj.courses) return;
        data = C.migrate(obj);
        persist();
        toast('已载入本学期课表：' + data.courses.length + ' 门课程');
      })
      .catch(function () { /* 没有 seed.json 就安静跳过 */ })
      .then(function () { done(); });
  }

  render();

  // 首次打开：先尝试自动载入内置课表(seed.json)，再决定是否显示引导
  tryLoadSeed(function () {
    render();
    showFirstRunGuide(firstOpen);
  });

  // 首次在新设备上打开时弹一次说明。
  // 判据是 firstOpen（启动时本地无数据），所以：自己已被数据的不弹、点过清空的不弹、
  // 只有真正第一次打开这台设备的人（比如被分享链接的朋友）会看到。
  function showFirstRunGuide(firstOpen) {
    if (!firstOpen) return;
    if (localStorage.getItem('tt.guided')) return;
    try { localStorage.setItem('tt.guided', '1'); } catch (e) {}

    var hasSample = !!(data.courses.length || data.events.length);
    var body, buttons;

    if (hasSample) {
      // 随 App 附带的示例课表（seed.json）已载入 —— 对"课表不一样"的人，必须说清可以清空重来
      body =
        '这是一个纯本地的小工具：<b>数据只存在你自己这台设备上</b>，不会上传，别人也看不到。<br><br>' +
        '你现在看到的是一份<b>预置的示例课表</b>（虚构的演示数据，' + data.courses.length + ' 门课，' +
        '不是任何人的真实课表）。如果你的课表不一样，点「清空，我要录自己的」清掉它，' +
        '再照下面的说明录你自己的。<br><br>' +
        '<b>装到手机桌面：</b>浏览器菜单 →「添加到主屏幕」，之后就能像 App 一样全屏打开。<br><br>' +
        '<span style="color:var(--muted2)">详细步骤见底部「说明」页。</span>';
      buttons =
        '<button class="btn" id="gKeep">就用这份示例</button>' +
        '<button class="btn ghost" id="gWipe">清空，我要录自己的</button>';
    } else {
      body =
        '这是一个纯本地的小工具：<b>数据只存在你自己这台设备上</b>，不会上传，别人也看不到。<br><br>' +
        '<b>建议顺序：</b><br>' +
        '1. 去「设置」把学期起始日（第 1 周星期一）确认为本学期的真实日期<br>' +
        '2. 去「课表」导入 WakeUp 备份，或批量粘贴录入<br>' +
        '3. 去「计划」加待办 / 健身 / 考试 / 活动<br><br>' +
        '<b>装到手机桌面：</b>浏览器菜单 →「添加到主屏幕」，之后就能像 App 一样全屏打开。<br><br>' +
        '<b>备份：</b>记得导出一次 JSON 备份，换设备时用它恢复。<br><br>' +
        '<span style="color:var(--muted2)">详细步骤见底部「说明」页。</span>';
      buttons =
        '<button class="btn" id="gSet">先去设置学期</button>' +
        '<button class="btn ghost" id="gCourse">先去导入课表</button>';
    }

    openSheet(
      '<h3><span>欢迎使用课表日历</span><button class="iconbtn" data-close>✕</button></h3>' +
      '<div class="hint" style="margin-bottom:12px;font-size:12.5px">' + body + '</div>' +
      '<div class="btnrow">' + buttons + '</div>',
      function (root) {
        $('[data-close]', root).addEventListener('click', closeSheet);

        var keep = $('#gKeep', root);
        if (keep) keep.addEventListener('click', function () {
          closeSheet();
          toast('好的，随时可以在「设置」里清空');
        });

        var wipe = $('#gWipe', root);
        if (wipe) wipe.addEventListener('click', function () {
          if (!confirm('清空后示例课表就没了，确定吗？\n（想留个底的话，先去「设置」导出 JSON 备份）')) return;
          data = C.emptyData();
          persist();
          render();
          closeSheet();
          go('course');
          toast('已清空，去「课表」页录你自己的吧');
        });

        var gs = $('#gSet', root);
        if (gs) gs.addEventListener('click', function () { closeSheet(); go('set'); });

        var gc = $('#gCourse', root);
        if (gc) gc.addEventListener('click', function () { closeSheet(); go('course'); });
      });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
