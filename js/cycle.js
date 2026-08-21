// 潮汐：例假/生理周期记录，独立分区。主屏是当前阶段概览+快速记录，
// "日历"和"记录历史"是点进去才展开的独立窗口（仿更多页的抽屉模式），
// 不再是藏在同一屏里、切换后旧内容消失不见的三个子 tab。
// 纯本地记录，不做任何医学诊断或建议。
const Cycle = (() => {
  let container;
  let logs = [];
  let startDates = []; // 周期开始日期，倒序（最近的在前）
  let cycleLength = 28;
  let calCursor = todayStr();

  async function init(rootEl) {
    container = rootEl;
    await refresh();
    render();
  }

  async function refresh() {
    logs = await DB.getAll('cycle_logs');
    logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    startDates = (await DB.getSetting('periodStartDates')) || [];
    cycleLength = (await DB.getSetting('cycleAvgLength')) || 28;
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function daysBetween(a, b) {
    const da = new Date(a + 'T00:00:00');
    const db_ = new Date(b + 'T00:00:00');
    return Math.round((db_ - da) / 86400000);
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const pad = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function shiftMonth(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMonth(d.getMonth() + n, 1);
    const pad = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  }

  function monthDatesOf(cursorDateStr) {
    const d = new Date(cursorDateStr + 'T00:00:00');
    const year = d.getFullYear(), month = d.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    const pad = (v) => String(v).padStart(2, '0');
    return Array.from({ length: last }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`);
  }

  function formatDateHuman(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // 粗略阶段估算，仅供个人参考记录，不构成任何医学判断。
  function phaseForDay(day, len) {
    const periodLen = 5;
    const ovulation = Math.max(periodLen + 1, len - 14);
    if (day <= periodLen) return '月经期';
    if (day < ovulation) return '卵泡期';
    if (day === ovulation) return '排卵期';
    return '黄体期';
  }

  function cycleInfo() {
    if (startDates.length === 0) return null;
    const start = startDates[0];
    const today = todayStr();
    const day = Math.max(1, daysBetween(start, today) + 1);
    const phase = phaseForDay(day, cycleLength);
    const nextStart = addDays(start, cycleLength);
    return { start, day, phase, nextStart };
  }

  function render() {
    const info = cycleInfo();
    const todayLog = logs.find((l) => l.date === todayStr());
    container.innerHTML = `
      <div class="cycle-view">
        <div class="view-header"><h2>潮汐</h2></div>
        <div class="cycle-scroll">
          ${info ? cycleHeaderHTML(info) : cycleEmptyHTML()}
          <div class="cycle-actions">
            <button class="btn-primary" id="btn-log-today">${todayLog ? '＋ 更新今天的记录' : '＋ 记录今天'}</button>
          </div>
          ${todayLog ? todayLogSummaryHTML(todayLog) : ''}
          ${startDates.length ? cycleProgressHTML(info) : ''}
          <button type="button" class="cycle-mark-link" id="btn-mark-start">
            ${cycleIcon('mark')}<span>${info ? '今天是新一次周期第一天' : '标记周期第一天'}</span>
          </button>
          <p class="section-hint">"标记周期第一天"只用来估算当前阶段、预测下一次日期；"记录今天"写的是流量/疼痛等每日细节，跟今天是不是周期第一天无关——两个都可以记，互不影响。</p>
          <nav class="more-glass-list cycle-nav-list">
            <button type="button" class="more-row" id="row-cal">
              <span class="more-row-icon">${cycleIcon('calendar')}</span>
              <span class="more-row-body"><div class="more-row-label">日历</div><div class="more-row-sub">See the whole month</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-history">
              <span class="more-row-icon">${cycleIcon('history')}</span>
              <span class="more-row-body"><div class="more-row-label">记录历史</div><div class="more-row-sub">${logs.length ? `${logs.length} 条每日记录` : 'Nothing logged yet'}</div></span>
              <span class="more-row-chevron">›</span>
            </button>
          </nav>
        </div>
      </div>
    `;
    container.querySelector('#btn-log-today').addEventListener('click', () => openLogEditor(todayLog || null));
    container.querySelector('#row-cal').addEventListener('click', openCalendarPage);
    container.querySelector('#row-history').addEventListener('click', openHistoryPage);
    container.querySelector('#btn-mark-start').addEventListener('click', startNewCycle);
  }

  function todayLogSummaryHTML(log) {
    return `
      <div class="cycle-today-log">
        <span class="cycle-today-log-dot" style="background:${FLOW_COLORS[Math.min(log.flow ?? 0, 4)] || 'var(--surface-2)'}"></span>
        <span>今天已记录 · 流量 ${log.flow ?? 0} · 疼 ${log.pain ?? 0}</span>
      </div>
    `;
  }

  function cycleIcon(name) {
    const icons = {
      calendar: '<rect x="3.4" y="4.8" width="17.2" height="15.2" rx="2"/><path d="M3.4 9.4h17.2M8 3.4v3M16 3.4v3"/>',
      history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.4l3 2"/>',
      mark: '<path d="M12 3.6c4.2 1.3 6.6 2.3 6.6 2.3v6c0 4-2.7 6.5-6.6 7.7-3.9-1.2-6.6-3.7-6.6-7.7v-6S7.8 4.9 12 3.6Z"/><path d="M9.2 12l1.9 1.9 3.7-3.9"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
  }

  // ---------------- 日历：独立窗口 ----------------
  function openCalendarPage() {
    calCursor = todayStr(); // 每次从主屏点进来都回到当前月份，翻月只在窗口内部有效
    const dialog = Pages.open('日历', calendarBodyHTML());
    bindCalendarEvents(dialog);
  }

  function refreshCalendarPageInPlace(dialog) {
    const body = dialog.querySelector('.page-body');
    if (!body) return;
    body.innerHTML = calendarBodyHTML();
    bindCalendarEvents(dialog);
  }

  function cycleHeaderHTML(info) {
    return `
      <div class="cycle-card">
        <div class="cycle-phase">${info.phase} · 第 ${info.day} 天</div>
        <div class="cycle-sub">${formatDateHuman(info.start)}起 · 下一次预计 ${formatDateHuman(info.nextStart)}（${Math.max(0, daysBetween(todayStr(), info.nextStart))} 天后）</div>
      </div>
    `;
  }

  function cycleEmptyHTML() {
    return `
      <div class="cycle-card cycle-card-empty">
        <div class="cycle-sub">还没有记录周期开始日期，标记一次就能看到进度和预测。</div>
      </div>
    `;
  }

  function cycleProgressHTML(info) {
    const today = todayStr();
    const cells = Array.from({ length: cycleLength }, (_, i) => {
      const day = i + 1;
      const phase = phaseForDay(day, cycleLength);
      const dateForDay = addDays(info.start, i);
      const isToday = dateForDay === today;
      const cls = phase === '月经期' ? 'is-period' : phase === '排卵期' ? 'is-ovulation' : phase === '卵泡期' ? 'is-follicular' : 'is-luteal';
      return `<span class="cycle-dot ${cls} ${isToday ? 'is-today' : ''}" title="第${day}天 · ${phase}"></span>`;
    }).join('');
    return `<div class="cycle-progress">${cells}</div>`;
  }

  const FLOW_COLORS = ['', '#f3c8d6', '#e79fc4', '#c2597a', '#8f3355'];

  function calendarBodyHTML() {
    const dates = monthDatesOf(calCursor);
    const d = new Date(calCursor + 'T00:00:00');
    return `
      <div class="day-nav">
        <button class="btn-icon" id="cal-prev">‹</button>
        <div class="day-label">${d.getFullYear()} 年 ${d.getMonth() + 1} 月</div>
        <button class="btn-icon" id="cal-next">›</button>
      </div>
      <div class="hm-grid">${dates.map(calCell).join('')}</div>
      <div class="hm-hint">圆点颜色代表当天记录的流量强弱；点击某一天可以记录/编辑当天详情。</div>
    `;
  }

  function bindCalendarEvents(dialog) {
    const body = dialog.querySelector('.page-body');
    body.querySelector('#cal-prev').addEventListener('click', () => { calCursor = shiftMonth(calCursor, -1); refreshCalendarPageInPlace(dialog); });
    body.querySelector('#cal-next').addEventListener('click', () => { calCursor = shiftMonth(calCursor, 1); refreshCalendarPageInPlace(dialog); });
    body.querySelectorAll('.hm-cell[data-cal-date]').forEach((el) => {
      el.addEventListener('click', () => {
        const date = el.dataset.calDate;
        const existing = logs.find((l) => l.date === date);
        openLogEditor(existing || null, date, () => refreshCalendarPageInPlace(dialog));
      });
    });
  }

  function calCell(dateStr) {
    const log = logs.find((l) => l.date === dateStr);
    const dotColor = log ? FLOW_COLORS[Math.min(log.flow ?? 0, 4)] : '';
    return `<div class="hm-cell ${dateStr === todayStr() ? 'is-today' : ''}" data-cal-date="${dateStr}">
      ${dotColor ? `<span class="cal-dot" style="background:${dotColor}"></span>` : ''}
      <span class="hm-cell-label">${dateStr.slice(8, 10)}</span>
    </div>`;
  }

  // ---------------- 记录历史：独立窗口 ----------------
  function openHistoryPage() {
    const dialog = Pages.open('记录历史', historyBodyHTML());
    bindHistoryEvents(dialog);
  }

  function refreshHistoryPageInPlace(dialog) {
    const body = dialog.querySelector('.page-body');
    if (!body) return;
    body.innerHTML = historyBodyHTML();
    bindHistoryEvents(dialog);
  }

  function historyBodyHTML() {
    return `
      <div class="cycle-history">
        <div class="cycle-history-title">最近记录</div>
        ${logs.length === 0 ? emptyState('还没有每日记录', '回到潮汐主页点"记录今天"开始') : logs.slice(0, 20).map(logRow).join('')}
      </div>
      ${startDates.length ? startDatesManagerHTML() : ''}
    `;
  }

  function bindHistoryEvents(dialog) {
    const body = dialog.querySelector('.page-body');
    body.querySelectorAll('.cycle-log-row[data-id]').forEach((el) => {
      const log = logs.find((l) => l.id === el.dataset.id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openLogEditor(log, null, () => refreshHistoryPageInPlace(dialog)));
    });
    body.querySelectorAll('.cycle-log-row[data-start]').forEach((el) => {
      el.querySelector('[data-act="remove-start"]').addEventListener('click', () => removeStartDate(el.dataset.start, dialog));
    });
  }

  function logRow(log) {
    return `
      <div class="cycle-log-row" data-id="${log.id}">
        <div class="cycle-log-date">${formatDateHuman(log.date)}</div>
        <div class="cycle-log-body">
          <div class="cycle-log-meta">流量 ${log.flow ?? 0} · 疼 ${log.pain ?? 0}</div>
          ${log.note ? `<div class="cycle-log-note">${escapeHtml(log.note)}</div>` : ''}
        </div>
        <button class="msg-act" data-act="edit">编辑</button>
      </div>
    `;
  }

  function startDatesManagerHTML() {
    return `
      <div class="cycle-history">
        <div class="cycle-history-title">周期开始日期</div>
        ${startDates.slice(0, 6).map((d) => `
          <div class="cycle-log-row" data-start="${d}">
            <div class="cycle-log-date">${formatDateHuman(d)}</div>
            <div class="cycle-log-body"></div>
            <button class="msg-act" data-act="remove-start">删除</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function startNewCycle() {
    if (!await UIDialog.confirm('标记今天为新一次周期的开始？')) return;
    const today = todayStr();
    startDates = [today, ...startDates.filter((d) => d !== today)].sort((a, b) => b.localeCompare(a));
    await DB.setSetting('periodStartDates', startDates);
    render();
  }

  async function removeStartDate(dateStr, parentDialog) {
    if (!await UIDialog.confirm('删除这条周期开始日期记录？', { danger: true, okLabel: '删除' })) return;
    startDates = startDates.filter((d) => d !== dateStr);
    await DB.setSetting('periodStartDates', startDates);
    render();
    if (parentDialog) refreshHistoryPageInPlace(parentDialog);
  }

  function openLogEditor(item, presetDate, onSaved) {
    const isNew = !item;
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const flow = item?.flow ?? 0;
    const pain = item?.pain ?? 0;
    const libido = item?.libido ?? 0;
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${isNew ? '记录今天' : '编辑记录'}</h3>
        <form id="cycle-log-form">
          <label class="field"><span>日期</span><input type="date" name="date" value="${item?.date || presetDate || todayStr()}" required></label>
          <div class="field"><span>流量（0 没有 · 4 很多）</span>
            <div class="btn-scale" data-name="flow">${[0, 1, 2, 3, 4].map((n) => `<button type="button" class="btn-scale-opt ${n === flow ? 'active' : ''}" data-val="${n}">${n}</button>`).join('')}</div>
          </div>
          <div class="field"><span>疼（0 不疼 · 3 很疼）</span>
            <div class="btn-scale" data-name="pain">${[0, 1, 2, 3].map((n) => `<button type="button" class="btn-scale-opt ${n === pain ? 'active' : ''}" data-val="${n}">${n}</button>`).join('')}</div>
          </div>
          <label class="field"><span>我的欲望（0-10）</span>
            <input type="range" name="libido" min="0" max="10" value="${libido}" id="libido-range">
            <div class="range-value" id="libido-value">${libido}</div>
          </label>
          <label class="field"><span>备注（可选）</span><textarea name="note" rows="2">${escapeHtml(item?.note || '')}</textarea></label>
          <div class="modal-actions">
            ${!isNew ? '<button type="button" class="btn-danger" id="cycle-log-delete">删除</button>' : ''}
            <button type="button" class="btn-secondary" id="cycle-log-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);

    let flowVal = flow, painVal = pain;
    dialog.querySelector('[data-name="flow"]').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-scale-opt');
      if (!btn) return;
      flowVal = Number(btn.dataset.val);
      dialog.querySelectorAll('[data-name="flow"] .btn-scale-opt').forEach((b) => b.classList.toggle('active', b === btn));
    });
    dialog.querySelector('[data-name="pain"]').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-scale-opt');
      if (!btn) return;
      painVal = Number(btn.dataset.val);
      dialog.querySelectorAll('[data-name="pain"] .btn-scale-opt').forEach((b) => b.classList.toggle('active', b === btn));
    });
    dialog.querySelector('#libido-range').addEventListener('input', (e) => {
      dialog.querySelector('#libido-value').textContent = e.target.value;
    });

    dialog.querySelector('#cycle-log-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#cycle-log-delete')?.addEventListener('click', async () => {
      if (!await UIDialog.confirm('删除这条记录？', { danger: true, okLabel: '删除' })) return;
      await DB.delete('cycle_logs', item.id);
      dialog.remove();
      await refresh();
      render();
      if (onSaved) onSaved();
    });
    dialog.querySelector('#cycle-log-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const date = fd.get('date');
      const record = {
        id: item?.id || uuid(),
        date,
        flow: flowVal,
        pain: painVal,
        libido: Number(fd.get('libido')) || 0,
        note: fd.get('note')?.trim() || '',
        createdAt: item?.createdAt || nowISO(),
      };
      await DB.put('cycle_logs', record);
      dialog.remove();
      await refresh();
      render();
      if (onSaved) onSaved();
      toast('已保存');
    });
  }

  return { init, refresh };
})();
window.Cycle = Cycle;
