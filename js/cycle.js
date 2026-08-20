// 潮汐：例假/生理周期记录，独立分区。内部分三块：概览（当前阶段+快速操作）、
// 日历（按月看哪几天记录过、流量强弱）、记录（历史列表+周期开始日期管理）。
// 纯本地记录，不做任何医学诊断或建议。
const Cycle = (() => {
  let container;
  let logs = [];
  let startDates = []; // 周期开始日期，倒序（最近的在前）
  let cycleLength = 28;
  let subview = 'overview'; // overview | calendar | history
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
    container.innerHTML = `
      <div class="cycle-view">
        <div class="view-header"><h2>潮汐</h2></div>
        <div class="seg-row sub-tabs">
          <label class="seg-option"><input type="radio" name="cyclesub" value="overview" ${subview === 'overview' ? 'checked' : ''}><span>概览</span></label>
          <label class="seg-option"><input type="radio" name="cyclesub" value="calendar" ${subview === 'calendar' ? 'checked' : ''}><span>日历</span></label>
          <label class="seg-option"><input type="radio" name="cyclesub" value="history" ${subview === 'history' ? 'checked' : ''}><span>记录</span></label>
        </div>
        <div class="cycle-body" id="cycle-body">${renderSub()}</div>
      </div>
    `;
    container.querySelectorAll('input[name=cyclesub]').forEach((el) => {
      el.addEventListener('change', (e) => { subview = e.target.value; render(); });
    });
    bindSubEvents();
  }

  function renderSub() {
    if (subview === 'calendar') return renderCalendar();
    if (subview === 'history') return renderHistory();
    return renderOverview();
  }

  function renderOverview() {
    const info = cycleInfo();
    return `
      ${info ? cycleHeaderHTML(info) : cycleEmptyHTML()}
      <div class="cycle-actions">
        <button class="btn-primary" id="btn-log-today">＋ 记录今天</button>
      </div>
      ${startDates.length ? cycleProgressHTML(info) : ''}
      <div class="cycle-start-row">
        <button class="btn-secondary" id="btn-new-cycle">📅 ${info ? '今天是新一次周期第一天' : '标记周期第一天'}</button>
        <p class="section-hint">这个按钮只用来标记"这次周期从哪天开始"，用来估算当前阶段和预测下一次日期。跟上面"记录今天"是两回事——"记录今天"写的是流量/疼痛等每日细节，跟今天是不是周期第一天无关，两个都可以记、互不影响。</p>
      </div>
    `;
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

  function renderCalendar() {
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

  function calCell(dateStr) {
    const log = logs.find((l) => l.date === dateStr);
    const dotColor = log ? FLOW_COLORS[Math.min(log.flow ?? 0, 4)] : '';
    return `<div class="hm-cell ${dateStr === todayStr() ? 'is-today' : ''}" data-cal-date="${dateStr}">
      ${dotColor ? `<span class="cal-dot" style="background:${dotColor}"></span>` : ''}
      <span class="hm-cell-label">${dateStr.slice(8, 10)}</span>
    </div>`;
  }

  function renderHistory() {
    return `
      <div class="cycle-history">
        <div class="cycle-history-title">最近记录</div>
        ${logs.length === 0 ? emptyState('还没有每日记录', '去"概览"点"记录今天"开始') : logs.slice(0, 20).map(logRow).join('')}
      </div>
      ${startDates.length ? startDatesManagerHTML() : ''}
    `;
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

  function bindSubEvents() {
    const body = container.querySelector('#cycle-body');
    body.querySelector('#btn-new-cycle')?.addEventListener('click', startNewCycle);
    body.querySelector('#btn-log-today')?.addEventListener('click', () => openLogEditor(null));
    body.querySelector('#cal-prev')?.addEventListener('click', () => { calCursor = shiftMonth(calCursor, -1); render(); });
    body.querySelector('#cal-next')?.addEventListener('click', () => { calCursor = shiftMonth(calCursor, 1); render(); });
    body.querySelectorAll('.hm-cell[data-cal-date]').forEach((el) => {
      el.addEventListener('click', () => {
        const date = el.dataset.calDate;
        const existing = logs.find((l) => l.date === date);
        openLogEditor(existing || null, date);
      });
    });
    body.querySelectorAll('.cycle-log-row[data-id]').forEach((el) => {
      const log = logs.find((l) => l.id === el.dataset.id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openLogEditor(log));
    });
    body.querySelectorAll('.cycle-log-row[data-start]').forEach((el) => {
      el.querySelector('[data-act="remove-start"]').addEventListener('click', () => removeStartDate(el.dataset.start));
    });
  }

  async function startNewCycle() {
    if (!await UIDialog.confirm('标记今天为新一次周期的开始？')) return;
    const today = todayStr();
    startDates = [today, ...startDates.filter((d) => d !== today)].sort((a, b) => b.localeCompare(a));
    await DB.setSetting('periodStartDates', startDates);
    render();
  }

  async function removeStartDate(dateStr) {
    if (!await UIDialog.confirm('删除这条周期开始日期记录？', { danger: true, okLabel: '删除' })) return;
    startDates = startDates.filter((d) => d !== dateStr);
    await DB.setSetting('periodStartDates', startDates);
    render();
  }

  function openLogEditor(item, presetDate) {
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
      toast('已保存');
    });
  }

  return { init, refresh };
})();
window.Cycle = Cycle;
