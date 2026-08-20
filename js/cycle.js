// 潮汐：例假/生理周期记录。记周期开始日期估算当前阶段与下一次预测日期，
// 每日可记流量/疼痛/心情标签/欲望。纯本地记录，不做任何医学诊断或建议。
const Cycle = (() => {
  const MOOD_TAGS = [
    { key: 'joy', label: '愉悦', color: '#e79fc4' },
    { key: 'happy', label: '快乐', color: '#e0a24e' },
    { key: 'bitter', label: '苦涩', color: '#c2597a' },
    { key: 'anxious', label: '焦虑', color: '#8f7fd6' },
    { key: 'calm', label: '平静', color: '#6fa89a' },
  ];

  let container;
  let logs = [];
  let startDates = []; // 周期开始日期，倒序（最近的在前）
  let cycleLength = 28;

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
    container.innerHTML = `
      <div class="cycle-view">
        ${info ? cycleHeaderHTML(info) : cycleEmptyHTML()}
        <div class="cycle-actions">
          <button class="btn-secondary" id="btn-new-cycle">${info ? '今天是新周期第一天' : '记录第一次周期开始'}</button>
          <button class="btn-primary" id="btn-log-today">＋ 记录今天</button>
        </div>
        ${startDates.length ? cycleProgressHTML(info) : ''}
        <div class="cycle-history">
          <div class="cycle-history-title">最近记录</div>
          ${logs.length === 0 ? emptyState('还没有每日记录', '点上面"记录今天"开始') : logs.slice(0, 14).map(logRow).join('')}
        </div>
        ${startDates.length ? startDatesManagerHTML() : ''}
      </div>
    `;
    bindEvents();
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
        <div class="cycle-sub">还没有记录周期开始日期，记一次就能看到进度和预测。</div>
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

  function logRow(log) {
    const tags = (log.moodTags || []).map((k) => MOOD_TAGS.find((t) => t.key === k)?.label).filter(Boolean).join(' · ');
    return `
      <div class="cycle-log-row" data-id="${log.id}">
        <div class="cycle-log-date">${formatDateHuman(log.date)}</div>
        <div class="cycle-log-body">
          <div class="cycle-log-meta">流量 ${log.flow ?? 0} · 疼 ${log.pain ?? 0}${tags ? ' · ' + escapeHtml(tags) : ''}</div>
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

  function bindEvents() {
    container.querySelector('#btn-new-cycle').addEventListener('click', startNewCycle);
    container.querySelector('#btn-log-today').addEventListener('click', () => openLogEditor(null));
    container.querySelectorAll('.cycle-log-row[data-id]').forEach((el) => {
      const log = logs.find((l) => l.id === el.dataset.id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openLogEditor(log));
    });
    container.querySelectorAll('.cycle-log-row[data-start]').forEach((el) => {
      el.querySelector('[data-act="remove-start"]').addEventListener('click', () => removeStartDate(el.dataset.start));
    });
  }

  async function startNewCycle() {
    if (!confirm('记录今天为新一次周期的开始？')) return;
    const today = todayStr();
    startDates = [today, ...startDates.filter((d) => d !== today)].sort((a, b) => b.localeCompare(a));
    await DB.setSetting('periodStartDates', startDates);
    render();
  }

  async function removeStartDate(dateStr) {
    if (!confirm('删除这条周期开始日期记录？')) return;
    startDates = startDates.filter((d) => d !== dateStr);
    await DB.setSetting('periodStartDates', startDates);
    render();
  }

  function openLogEditor(item) {
    const isNew = !item;
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const flow = item?.flow ?? 0;
    const pain = item?.pain ?? 0;
    const libido = item?.libido ?? 0;
    const tags = item?.moodTags || [];
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${isNew ? '记录今天' : '编辑记录'}</h3>
        <form id="cycle-log-form">
          <label class="field"><span>日期</span><input type="date" name="date" value="${item?.date || todayStr()}" required></label>
          <div class="field"><span>流量（0 没有 · 4 很多）</span>
            <div class="btn-scale" data-name="flow">${[0, 1, 2, 3, 4].map((n) => `<button type="button" class="btn-scale-opt ${n === flow ? 'active' : ''}" data-val="${n}">${n}</button>`).join('')}</div>
          </div>
          <div class="field"><span>疼（0 不疼 · 3 很疼）</span>
            <div class="btn-scale" data-name="pain">${[0, 1, 2, 3].map((n) => `<button type="button" class="btn-scale-opt ${n === pain ? 'active' : ''}" data-val="${n}">${n}</button>`).join('')}</div>
          </div>
          <div class="field"><span>心情</span>
            <div class="chip-row" data-name="moodTags">${MOOD_TAGS.map((t) => `<button type="button" class="chip-opt ${tags.includes(t.key) ? 'active' : ''}" data-val="${t.key}" style="--chip-color:${t.color}">${t.label}</button>`).join('')}</div>
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

    let flowVal = flow, painVal = pain, tagVals = [...tags];
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
    dialog.querySelector('[data-name="moodTags"]').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-opt');
      if (!btn) return;
      const val = btn.dataset.val;
      if (tagVals.includes(val)) { tagVals = tagVals.filter((v) => v !== val); btn.classList.remove('active'); }
      else { tagVals.push(val); btn.classList.add('active'); }
    });
    dialog.querySelector('#libido-range').addEventListener('input', (e) => {
      dialog.querySelector('#libido-value').textContent = e.target.value;
    });

    dialog.querySelector('#cycle-log-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#cycle-log-delete')?.addEventListener('click', async () => {
      if (!confirm('删除这条记录？')) return;
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
        moodTags: tagVals,
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
