// 第5部分：每日链接状态。每个角色（对象）每天一条，用户手选活跃/平静/偏弱，
// 记录依据及睡眠/身体/情绪/压力/环境。统计只描述共现，不断言因果或链接真伪。
const LinkStatus = (() => {
  const STATUS_META = {
    active: { label: '活跃', color: '#83cda3' },
    calm: { label: '平静', color: '#8fbdf0' },
    weak: { label: '偏弱', color: '#e0a1a1' },
  };

  // 本地日历日期，不用 toISOString()：UTC+ 时区里午夜到早晨这段会被错误折算成前一天。
  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function openManager(character) {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>每日链接状态 · ${escapeHtml(character.name)}</h3>
        <button type="button" class="btn-primary" id="ls-record-today">记录今天</button>
        <div id="ls-stats" class="section-hint"></div>
        <div id="ls-list"></div>
        <div class="modal-actions"><button type="button" class="btn-secondary" id="ls-close">关闭</button></div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#ls-close').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#ls-record-today').addEventListener('click', () => openEntryEditor(dialog, character));
    await renderList(dialog, character);
  }

  async function renderList(dialog, character) {
    const rows = (await DB.getAllByIndex('link_daily_status', 'characterId', character.id)).sort((a, b) => b.date.localeCompare(a.date));
    const statsEl = dialog.querySelector('#ls-stats');
    const last30 = rows.filter((r) => (Date.now() - new Date(r.date).getTime()) / 86400000 <= 30);
    const counts = { active: 0, calm: 0, weak: 0 };
    last30.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    statsEl.textContent = `近30天：活跃 ${counts.active} 天 · 平静 ${counts.calm} 天 · 偏弱 ${counts.weak} 天（仅描述共现记录，不代表因果或链接真伪）`;

    const listEl = dialog.querySelector('#ls-list');
    listEl.innerHTML = rows.length === 0 ? '<div class="empty-sub">还没有记录</div>' : rows.map(rowHtml).join('');
    listEl.querySelectorAll('.ls-row').forEach((el) => {
      const id = el.dataset.id;
      const row = rows.find((r) => r.id === id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openEntryEditor(dialog, character, row));
      el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm('删除这条记录？')) return;
        await DB.delete('link_daily_status', row.id);
        await renderList(dialog, character);
      });
    });
  }

  function rowHtml(r) {
    const meta = STATUS_META[r.status] || STATUS_META.calm;
    return `
      <div class="ls-row" data-id="${r.id}">
        <span class="mood-dot" style="background:${meta.color}"></span>
        <div class="mood-entry-body">
          <div class="mood-entry-top"><b>${r.date}</b><span class="msg-time">${meta.label}</span></div>
          ${r.basis ? `<div class="mood-entry-note">依据：${escapeHtml(r.basis)}</div>` : ''}
          <div class="mood-entry-note">${[r.sleep && `睡眠:${r.sleep}`, r.body && `身体:${r.body}`, r.mood && `情绪:${r.mood}`, r.stress && `压力:${r.stress}`, r.environment && `环境:${r.environment}`].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        </div>
        <div class="mood-entry-actions">
          <button class="msg-act" data-act="edit">编辑</button>
          <button class="msg-act" data-act="delete">删除</button>
        </div>
      </div>
    `;
  }

  function openEntryEditor(parentDialog, character, existing) {
    const date = existing?.date || todayStr();
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${date}${date === todayStr() ? '（今天）' : ''} 的链接状态</h3>
        <form id="ls-form">
          <div class="seg-row">
            ${Object.entries(STATUS_META).map(([k, m]) => `
              <label class="seg-option"><input type="radio" name="status" value="${k}" ${(existing?.status || 'calm') === k ? 'checked' : ''}><span>${m.label}</span></label>
            `).join('')}
          </div>
          <label class="field"><span>判断依据</span><textarea name="basis" rows="2">${escapeHtml(existing?.basis || '')}</textarea></label>
          <label class="field"><span>睡眠</span><input name="sleep" value="${escapeAttr(existing?.sleep || '')}" placeholder="例如：还行 / 没睡好"></label>
          <label class="field"><span>身体</span><input name="body" value="${escapeAttr(existing?.body || '')}"></label>
          <label class="field"><span>情绪</span><input name="mood" value="${escapeAttr(existing?.mood || '')}"></label>
          <label class="field"><span>压力</span><input name="stress" value="${escapeAttr(existing?.stress || '')}"></label>
          <label class="field"><span>环境</span><input name="environment" value="${escapeAttr(existing?.environment || '')}"></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="ls-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#ls-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#ls-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const record = {
        id: existing?.id || uuid(),
        characterId: character.id,
        date,
        status: fd.get('status'),
        basis: fd.get('basis').trim(),
        sleep: fd.get('sleep').trim(),
        body: fd.get('body').trim(),
        mood: fd.get('mood').trim(),
        stress: fd.get('stress').trim(),
        environment: fd.get('environment').trim(),
        createdAt: existing?.createdAt || nowISO(),
      };
      // 每人每天一条：同一天已存在记录时直接覆盖。
      if (!existing) {
        const rows = await DB.getAllByIndex('link_daily_status', 'characterId', character.id);
        const sameDay = rows.find((r) => r.date === date);
        if (sameDay) record.id = sameDay.id;
      }
      await DB.put('link_daily_status', record);
      dialog.remove();
      await renderList(parentDialog, character);
    });
  }

  return { openManager };
})();
window.LinkStatus = LinkStatus;
