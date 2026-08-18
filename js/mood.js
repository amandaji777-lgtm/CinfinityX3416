// 能量波动图：记录当下心情颜色，按日/周/月/年查看颜色的波动。
const Mood = (() => {
  const PRESETS = [
    { label: '平和', color: '#cdbfe0' },
    { label: '开心', color: '#ffd166' },
    { label: '安稳', color: '#9fd8b8' },
    { label: '兴奋', color: '#ff8fa3' },
    { label: '疲惫', color: '#9aa5c9' },
    { label: '低落', color: '#7f9cc4' },
    { label: '焦虑', color: '#f4a261' },
    { label: '烦躁', color: '#e76f51' },
  ];

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
    entries.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }

  function render() {
    container.innerHTML = `
      <div class="mood-view">
        <div class="view-header">
          <h2>能量波动</h2>
          <button class="btn-icon" id="btn-add-mood" title="记录此刻">＋</button>
        </div>
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
    const dayEntries = entriesForDate(dateStr).sort((a, b) => a.time.localeCompare(b.time));
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

  function buildDayGradient(dayEntries) {
    if (dayEntries.length === 0) return 'var(--surface-2)';
    if (dayEntries.length === 1) return dayEntries[0].color;
    const stops = dayEntries.map((e) => {
      const pct = minutesOfDay(e.time) / 1440 * 100;
      return `${e.color} ${pct.toFixed(1)}%`;
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

  function renderHeatmap(dates, title) {
    return `
      <div class="hm-title">${title}</div>
      <div class="hm-grid">
        ${dates.map((d) => {
          const dayEntries = entriesForDate(d);
          const blend = blendColors(dayEntries.map((e) => e.color));
          return `<div class="hm-cell ${d === todayStr() ? 'is-today' : ''}" data-date="${d}" style="background:${blend || 'var(--surface-2)'}">
            <span class="hm-cell-label">${d.slice(8, 10)}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="hm-hint">点击某一天可查看当天详情</div>
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
            ${dates.map((d) => {
              const blend = blendColors(entriesForDate(d).map((e) => e.color));
              return `<div class="hm-cell hm-cell-sm" data-date="${d}" style="background:${blend || 'var(--surface-2)'}"></div>`;
            }).join('')}
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
          <div class="field">
            <span>选择颜色</span>
            <div class="swatch-row">
              ${PRESETS.map((p) => `
                <label class="swatch-option">
                  <input type="radio" name="preset" value="${p.color}|${p.label}">
                  <span class="swatch" style="background:${p.color}"></span>
                  <span class="swatch-label">${p.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
          <label class="field"><span>微调颜色（可选，覆盖上面的预设）</span>
            <input type="color" name="colorPicker" value="${item?.color || PRESETS[0].color}">
          </label>
          <label class="field"><span>标签</span><input name="label" maxlength="12" value="${escapeAttr(item?.label || '')}" placeholder="例如：平和 / 有点累"></label>
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
    dialog.querySelectorAll('input[name=preset]').forEach((r) => {
      r.addEventListener('change', () => {
        const [color, label] = r.value.split('|');
        dialog.querySelector('input[name=colorPicker]').value = color;
        const labelInput = dialog.querySelector('input[name=label]');
        if (!labelInput.value) labelInput.value = label;
      });
    });
    dialog.querySelector('#mood-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const timeLocal = fd.get('time');
      const iso = new Date(timeLocal).toISOString();
      const record = {
        id: item?.id || uuid(),
        date: iso.slice(0, 10),
        time: iso,
        color: fd.get('colorPicker'),
        label: fd.get('label')?.trim() || '',
        note: fd.get('note')?.trim() || '',
        createdAt: item?.createdAt || nowISO(),
      };
      await DB.put('moods', record);
      dialog.remove();
      await refresh();
      dayCursor = record.date;
      range = 'day';
      render();
    });
  }

  async function removeEntry(item) {
    if (!confirm('删除这条心情记录？')) return;
    await DB.delete('moods', item.id);
    await refresh();
    render();
  }

  // ---- 工具函数 ----
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function weekDates(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // 周一为一周开始
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(monday);
      x.setDate(monday.getDate() + i);
      return x.toISOString().slice(0, 10);
    });
  }
  function monthDates(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear(), month = d.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: last }, (_, i) => {
      const x = new Date(year, month, i + 1);
      return x.toISOString().slice(0, 10);
    });
  }
  function minutesOfDay(iso) {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }
  function blendColors(colors) {
    if (!colors || colors.length === 0) return null;
    let r = 0, g = 0, b = 0;
    colors.forEach((c) => {
      const [rr, gg, bb] = hexToRgb(c);
      r += rr; g += gg; b += bb;
    });
    const n = colors.length;
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  }
  function hexToRgb(hex) {
    const m = hex.replace('#', '');
    const bigint = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
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
