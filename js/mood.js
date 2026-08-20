// 能量波动图：记录当下心情颜色，按日/周/月/年查看颜色的波动。
const Mood = (() => {
  const DEFAULT_COLOR = '#b8965a';

  let container;
  let entries = [];
  let range = 'day'; // day | week | month | year
  let anchorDate = todayStr();
  let dayCursor = todayStr();

  async function init(rootEl) {
    container = rootEl;
    await refresh();
    render();
  }

  async function refresh() {
    entries = await DB.getAll('moods');
    entries.sort(byTimeThenCreated);
  }

  // "time" 精确到分钟（来自 datetime-local 输入），短时间内连续添加多条记录时
  // 可能撞在同一分钟——用创建时间（毫秒精度）兜底，保证顺序确定、不随机跳动。
  function byTimeThenCreated(a, b) {
    return (a.time || '').localeCompare(b.time || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
  }

  function render() {
    container.innerHTML = `
      <div class="mood-view">
        <div class="view-header"><h2>能量波动</h2></div>
        <div class="mood-add-row"><button class="btn-secondary" id="btn-add-mood">＋ 记录此刻</button></div>
        <div class="seg-row range-tabs">
          ${['day', 'week', 'month', 'year'].map((r) => `
            <label class="seg-option"><input type="radio" name="range" value="${r}" ${range === r ? 'checked' : ''}><span>${rangeLabel(r)}</span></label>
          `).join('')}
        </div>
        <div id="mood-body">${renderBody()}</div>
      </div>
    `;
    container.querySelector('#btn-add-mood').addEventListener('click', () => openEntryEditor(null));
    container.querySelectorAll('input[name=range]').forEach((el) => {
      el.addEventListener('change', (e) => { range = e.target.value; render(); });
    });
    bindBodyEvents();
  }

  function rangeLabel(r) {
    return { day: '日', week: '周', month: '月', year: '年' }[r];
  }

  function renderBody() {
    if (range === 'day') return renderDay(dayCursor);
    if (range === 'week') return renderHeatmap(weekDates(dayCursor), '本周');
    if (range === 'month') return renderHeatmap(monthDates(dayCursor), '本月');
    return renderYear(dayCursor);
  }

  function bindBodyEvents() {
    const body = container.querySelector('#mood-body');
    body.querySelectorAll('.hm-cell[data-date]').forEach((el) => {
      el.addEventListener('click', () => { dayCursor = el.dataset.date; range = 'day'; render(); });
    });
    body.querySelectorAll('.mood-entry-row').forEach((el) => {
      const id = el.dataset.id;
      const item = entries.find((e) => e.id === id);
      el.querySelector('[data-act="edit"]')?.addEventListener('click', () => openEntryEditor(item));
      el.querySelector('[data-act="delete"]')?.addEventListener('click', () => removeEntry(item));
    });
    body.querySelector('#day-prev')?.addEventListener('click', () => { dayCursor = shiftDate(dayCursor, -1); render(); });
    body.querySelector('#day-next')?.addEventListener('click', () => { dayCursor = shiftDate(dayCursor, 1); render(); });
  }

  function entriesForDate(dateStr) {
    return entries.filter((e) => e.date === dateStr);
  }

  function renderDay(dateStr) {
    const dayEntries = entriesForDate(dateStr).sort(byTimeThenCreated);
    const gradient = buildDayGradient(dayEntries);
    return `
      <div class="day-nav">
        <button class="btn-icon" id="day-prev">‹</button>
        <div class="day-label">${formatDateHuman(dateStr)}${dateStr === todayStr() ? '（今天）' : ''}</div>
        <button class="btn-icon" id="day-next">›</button>
      </div>
      <div class="day-strip" style="background:${gradient}"></div>
      <div class="mood-entries">
        ${dayEntries.length === 0 ? emptyState('这天还没有记录', '点右上角 ＋ 记录当下的心情颜色') : dayEntries.map(entryRow).join('')}
      </div>
    `;
  }

  // 分层显示：每条记录占等宽的一段，而不是按时间点在 24 小时轴上定位——
  // 后者在记录时间挨得很近（比如测试时几分钟内连续加了好几条）时，色块会被挤成
  // 几乎看不见的窄条，超过两三条颜色就"消失"了。等宽分层保证每种颜色都占得到看得见的宽度。
  function buildDayGradient(dayEntries) {
    if (dayEntries.length === 0) return 'var(--surface-2)';
    if (dayEntries.length === 1) return dayEntries[0].color;
    const n = dayEntries.length;
    const stops = [];
    dayEntries.forEach((e, i) => {
      const from = (i / n * 100).toFixed(2);
      const to = ((i + 1) / n * 100).toFixed(2);
      stops.push(`${e.color} ${from}%`, `${e.color} ${to}%`);
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  function entryRow(e) {
    return `
      <div class="mood-entry-row" data-id="${e.id}">
        <span class="mood-dot" style="background:${e.color}"></span>
        <div class="mood-entry-body">
          <div class="mood-entry-top"><b>${escapeHtml(e.label || '未命名心情')}</b><span class="mood-entry-time">${formatTime(e.time)}</span></div>
          ${e.note ? `<div class="mood-entry-note">${escapeHtml(e.note)}</div>` : ''}
        </div>
        <div class="mood-entry-actions">
          <button class="msg-act" data-act="edit">编辑</button>
          <button class="msg-act" data-act="delete">删除</button>
        </div>
      </div>
    `;
  }

  function heatmapCell(d, sizeClass) {
    const dayEntries = entriesForDate(d);
    const stripes = dayEntries.map((e) => `<span class="hm-stripe" style="background:${e.color}"></span>`).join('');
    const label = sizeClass ? '' : `<span class="hm-cell-label">${d.slice(8, 10)}</span>`;
    return `<div class="hm-cell ${sizeClass || ''} ${d === todayStr() ? 'is-today' : ''}" data-date="${d}">
      <span class="hm-stripes">${stripes}</span>${label}
    </div>`;
  }

  function renderHeatmap(dates, title) {
    return `
      <div class="hm-title">${title}</div>
      <div class="hm-grid">
        ${dates.map((d) => heatmapCell(d)).join('')}
      </div>
      <div class="hm-hint">点击某一天可查看当天详情；一天记录多种颜色时会分层显示</div>
    `;
  }

  function renderYear(dateStr) {
    const year = Number(dateStr.slice(0, 4));
    const months = [];
    for (let m = 0; m < 12; m++) months.push(monthDates(`${year}-${String(m + 1).padStart(2, '0')}-01`));
    return `
      <div class="hm-title">${year} 年</div>
      ${months.map((dates, i) => `
        <div class="year-month-block">
          <div class="year-month-label">${i + 1} 月</div>
          <div class="hm-grid hm-grid-compact">
            ${dates.map((d) => heatmapCell(d, 'hm-cell-sm')).join('')}
          </div>
        </div>
      `).join('')}
    `;
  }

  function openEntryEditor(item) {
    const isNew = !item;
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const now = new Date();
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${isNew ? '记录此刻的心情' : '编辑心情记录'}</h3>
        <form id="mood-form">
          <label class="field field-color"><span>选择颜色</span>
            <input type="color" name="colorPicker" value="${item?.color || DEFAULT_COLOR}">
          </label>
          <label class="field"><span>这个颜色代表什么</span><input name="label" maxlength="12" value="${escapeAttr(item?.label || '')}" placeholder="自己起个名字，例如：平和 / 有点累"></label>
          <label class="field"><span>备注（可选）</span><textarea name="note" rows="2">${escapeHtml(item?.note || '')}</textarea></label>
          <label class="field"><span>时间</span><input type="datetime-local" name="time" value="${toLocalInputValue(item?.time || now.toISOString())}"></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="mood-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#mood-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#mood-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const timeLocal = fd.get('time');
      const iso = new Date(timeLocal).toISOString();
      const record = {
        id: item?.id || uuid(),
        // 用输入框里的本地日期直接分桶，不经过 toISOString()（那会按 UTC 折算，
        // 在 UTC+8 这类时区里午夜到早上这段时间会被错误地划到前一天）。
        date: timeLocal.slice(0, 10),
        time: iso,
        color: fd.get('colorPicker'),
        label: fd.get('label')?.trim() || '',
        note: fd.get('note')?.trim() || '',
        createdAt: item?.createdAt || nowISO(),
      };
      await DB.put('moods', record);
      dialog.remove();
      await refresh();
      if (window.Ambience) Ambience.refreshCorner();
      dayCursor = record.date;
      range = 'day';
      render();
    });
  }

  async function removeEntry(item) {
    if (!await UIDialog.confirm('删除这条心情记录？', { danger: true, okLabel: '删除' })) return;
    await DB.delete('moods', item.id);
    await refresh();
    if (window.Ambience) Ambience.refreshCorner();
    render();
  }

  // ---- 工具函数 ----
  // 本地日历日期（年-月-日），不用 toISOString()：那是 UTC 折算，在东八区这类
  // UTC+ 时区里，本地午夜到早晨这段时间会被错误地划到前一天。
  function toDateStr(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function todayStr() { return toDateStr(new Date()); }
  function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return toDateStr(d);
  }
  function weekDates(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // 周一为一周开始
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(monday);
      x.setDate(monday.getDate() + i);
      return toDateStr(x);
    });
  }
  function monthDates(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear(), month = d.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: last }, (_, i) => toDateStr(new Date(year, month, i + 1)));
  }
  function formatDateHuman(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function toLocalInputValue(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return { init, refresh };
})();
