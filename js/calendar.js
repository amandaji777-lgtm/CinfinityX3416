// 日历：轻量的按天自由文字备注（例假/吃药提醒/任何想记的事），不是完整的日程管理——
// 没有分类、没有重复规则、没有提醒推送，就是"点一天，写一句话"。
const Calendar = (() => {
  let container;
  let notes = []; // 全部备注
  let cursor = todayStr(); // 当前月历指针（月份第一天）

  async function init(rootEl) {
    container = rootEl;
    await refresh();
    render();
  }

  async function refresh() {
    notes = await DB.getAll('calendar_notes');
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
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
    const firstWeekday = new Date(year, month, 1).getDay(); // 0=周日
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const pad = (v) => String(v).padStart(2, '0');
    const dates = [];
    for (let i = 0; i < firstWeekday; i++) dates.push(null); // 补前面的空格
    for (let i = 1; i <= daysInMonth; i++) dates.push(`${year}-${pad(month + 1)}-${pad(i)}`);
    return dates;
  }

  function formatDateHuman(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function notesForDate(dateStr) {
    return notes.filter((n) => n.date === dateStr).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function render() {
    const d = new Date(cursor + 'T00:00:00');
    const dates = monthDatesOf(cursor);
    const upcoming = notes
      .filter((n) => n.date >= todayStr())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
    container.innerHTML = `
      <div class="calendar-view">
        <div class="view-header"><h2>日历</h2></div>
        <div class="cal-scroll">
          <div class="day-nav">
            <button class="btn-icon" id="cal-prev">‹</button>
            <div class="day-label">${d.getFullYear()} 年 ${d.getMonth() + 1} 月</div>
            <button class="btn-icon" id="cal-next">›</button>
          </div>
          <div class="cal-weekdays">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<span>${w}</span>`).join('')}</div>
          <div class="cal-grid">
            ${dates.map((dateStr) => calCell(dateStr)).join('')}
          </div>
          <div class="cal-upcoming">
            <div class="cal-upcoming-title">近期备注</div>
            ${upcoming.length === 0 ? '<div class="empty-sub">还没有备注，点日历上的某一天加一条</div>' : upcoming.map(upcomingRow).join('')}
          </div>
        </div>
      </div>
    `;
    container.querySelector('#cal-prev').addEventListener('click', () => { cursor = shiftMonth(cursor, -1); render(); });
    container.querySelector('#cal-next').addEventListener('click', () => { cursor = shiftMonth(cursor, 1); render(); });
    container.querySelectorAll('.cal-cell[data-date]').forEach((el) => {
      el.addEventListener('click', () => openDayEditor(el.dataset.date));
    });
    container.querySelectorAll('.cal-upcoming-row[data-date]').forEach((el) => {
      el.addEventListener('click', () => openDayEditor(el.dataset.date));
    });
  }

  function calCell(dateStr) {
    if (!dateStr) return '<div class="cal-cell is-blank"></div>';
    const dayNotes = notesForDate(dateStr);
    const isToday = dateStr === todayStr();
    return `
      <button type="button" class="cal-cell ${isToday ? 'is-today' : ''} ${dayNotes.length ? 'has-note' : ''}" data-date="${dateStr}">
        <span class="cal-cell-num">${Number(dateStr.slice(8, 10))}</span>
        ${dayNotes.length ? '<span class="cal-cell-dot"></span>' : ''}
      </button>
    `;
  }

  function upcomingRow(n) {
    return `
      <div class="cal-upcoming-row" data-date="${n.date}">
        <span class="cal-upcoming-date">${formatDateHuman(n.date)}</span>
        <span class="cal-upcoming-text">${escapeHtml(n.text)}</span>
      </div>
    `;
  }

  function openDayEditor(dateStr) {
    const dayNotes = notesForDate(dateStr);
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${formatDateHuman(dateStr)}</h3>
        <div id="cal-day-notes">${dayNotes.map(dayNoteRow).join('')}</div>
        <form id="cal-note-form">
          <label class="field"><span>加一条备注</span><input name="text" maxlength="60" placeholder="例如：例假第一天 / 吃药" required></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="cal-close">关闭</button>
            <button type="submit" class="btn-primary">添加</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#cal-close').addEventListener('click', () => dialog.remove());
    bindDayNoteDeletes(dialog);
    dialog.querySelector('#cal-note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const text = fd.get('text')?.trim();
      if (!text) return;
      await DB.put('calendar_notes', { id: uuid(), date: dateStr, text, createdAt: nowISO() });
      await refresh();
      dialog.querySelector('#cal-day-notes').innerHTML = notesForDate(dateStr).map(dayNoteRow).join('');
      bindDayNoteDeletes(dialog);
      e.target.reset();
      render();
    });
  }

  function dayNoteRow(n) {
    return `
      <div class="cal-day-note-row" data-id="${n.id}">
        <span>${escapeHtml(n.text)}</span>
        <button type="button" class="msg-act" data-act="delete">删除</button>
      </div>
    `;
  }

  function bindDayNoteDeletes(dialog) {
    dialog.querySelectorAll('.cal-day-note-row[data-id]').forEach((el) => {
      el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!await UIDialog.confirm('删除这条备注？', { danger: true, okLabel: '删除' })) return;
        await DB.delete('calendar_notes', el.dataset.id);
        await refresh();
        el.remove();
        render();
      });
    });
  }

  return { init, refresh };
})();
window.Calendar = Calendar;
