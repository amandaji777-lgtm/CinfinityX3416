// 第8部分：独立长记忆。允许聊天模型和总结模型使用不同连接，按 N 条自动总结或手动总结，
// 只提取稳定偏好/重要信息/重要事件/关系变化/约定和禁忌，不编造；用户可查看/编辑/合并/确认/停用/删除。
const Memory = (() => {
  let cache = [];

  async function refresh(conversationId) {
    cache = conversationId ? await DB.getAllByIndex('ai_memories', 'conversationId', conversationId) : await DB.getAll('ai_memories');
  }

  function getInjectableMemories(conv, recentMessages) {
    const cap = conv.longMemory?.injectionCap ?? 6;
    if (!cap) return [];
    const pool = cache.filter((m) => m.conversationId === conv.id && m.userConfirmed && !m.stale);
    const recentText = recentMessages.slice(-6).map((m) => m.content).join('\n').toLowerCase();
    const scored = pool.map((m) => {
      const keywordHits = (m.keywords || []).filter((k) => k && recentText.includes(k.toLowerCase())).length;
      const ageDays = (Date.now() - new Date(m.generatedAt).getTime()) / 86400000;
      const recencyScore = Math.max(0, 30 - ageDays);
      return { m, score: keywordHits * 10 + recencyScore };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, cap).map((s) => s.m);
  }

  async function markStaleForMessages(conversationId, archivedMessageIds) {
    const rows = await DB.getAllByIndex('ai_memories', 'conversationId', conversationId);
    for (const m of rows) {
      if ((m.sourceMessageIds || []).some((id) => archivedMessageIds.includes(id))) {
        m.stale = true;
        await DB.put('ai_memories', m);
      }
    }
    await refresh(conversationId);
  }

  async function maybeAutoSummarize(conv) {
    const lm = conv.longMemory;
    if (!lm || !lm.enabled || !lm.summarizeEveryN) return;
    const messages = await DB.getAllByIndex('messages', 'conversationId', conv.id);
    const visibleCount = messages.filter((m) => !m.archived).length;
    const last = lm.lastSummarizedCount || 0;
    if (visibleCount - last >= lm.summarizeEveryN) {
      try {
        await summarizeNow(conv);
      } catch (_) { /* 自动总结失败不打断正常聊天，用户可以手动重试 */ }
    }
  }

  async function summarizeNow(conv) {
    const connId = conv.longMemory?.summaryConnectionId || conv.connectionId;
    const connections = await DB.getAll('connections');
    const connection = connections.find((c) => c.id === connId);
    if (!connection) throw new Error('还没有配置总结连接（或聊天连接）');
    const provider = Providers[connection.provider];
    const apiKey = connection.apiKeyCipher ? await CryptoUtils.decryptText(connection.apiKeyCipher, connection.apiKeyIv) : '';

    const messages = await DB.getAllByIndex('messages', 'conversationId', conv.id);
    const visible = messages.filter((m) => !m.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const lm = conv.longMemory || {};
    const sinceIdx = Math.max(0, visible.length - Math.max(lm.summarizeEveryN || 20, 20));
    const slice = visible.slice(sinceIdx);
    if (slice.length === 0) throw new Error('还没有足够的对话内容可以总结');

    const transcript = slice.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n');
    const instruction = (lm.summaryPrompt ? lm.summaryPrompt + '\n' : '') +
      '只提取稳定偏好、重要信息、重要事件、关系变化、约定和禁忌，不要编造没有出现过的内容。' +
      '用 JSON 格式回复，且只回复 JSON，不要任何其他文字：{"content":"一段总结文字","keywords":["关键词1","关键词2"],"object":"这段记忆关于谁/什么"}';

    const promptMessages = [{ role: 'user', content: `${instruction}\n\n对话记录：\n${transcript}` }];
    let raw = '';
    if (connection.provider === 'anthropic' || connection.provider === 'gemini') {
      for await (const chunk of provider.streamChat(connection, apiKey, promptMessages, undefined, '')) raw += chunk;
    } else {
      for await (const chunk of provider.streamChat(connection, apiKey, promptMessages, undefined)) raw += chunk;
    }

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (_) {
      parsed = { content: raw.trim(), keywords: [], object: '' };
    }

    const record = {
      id: uuid(),
      conversationId: conv.id,
      content: parsed.content || raw.trim(),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      object: parsed.object || '',
      timeRangeFrom: slice[0].createdAt,
      timeRangeTo: slice[slice.length - 1].createdAt,
      sourceMessageIds: slice.map((m) => m.id),
      generatedAt: nowISO(),
      userConfirmed: false,
      stale: false,
    };
    await DB.put('ai_memories', record);

    conv.longMemory = { ...lm, lastSummarizedCount: visible.length };
    await DB.put('conversations', conv);

    await enforceMaxCount(conv);
    await refresh(conv.id);
    return record;
  }

  async function enforceMaxCount(conv) {
    const maxCount = conv.longMemory?.maxCount || 200;
    const rows = (await DB.getAllByIndex('ai_memories', 'conversationId', conv.id)).sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
    while (rows.length > maxCount) {
      const oldest = rows.shift();
      await DB.delete('ai_memories', oldest.id);
    }
  }

  function openManager(conv) {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `<div class="modal-card"><h3>长记忆管理 · ${escapeHtml(conv.title)}</h3><div id="mem-list"></div>
      <div class="modal-actions"><button type="button" class="btn-secondary" id="mem-close">关闭</button></div></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#mem-close').addEventListener('click', () => dialog.remove());
    renderMemoryList(dialog, conv);
  }

  async function renderMemoryList(dialog, conv) {
    const rows = (await DB.getAllByIndex('ai_memories', 'conversationId', conv.id)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    const listEl = dialog.querySelector('#mem-list');
    listEl.innerHTML = rows.length === 0 ? '<div class="empty-sub">还没有自动总结的长记忆</div>' : rows.map(memRow).join('');
    listEl.querySelectorAll('.mem-row').forEach((el) => {
      const id = el.dataset.id;
      const m = rows.find((r) => r.id === id);
      el.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => { m.userConfirmed = true; await DB.put('ai_memories', m); await refresh(conv.id); renderMemoryList(dialog, conv); });
      el.querySelector('[data-act="disable"]')?.addEventListener('click', async () => { m.stale = !m.stale; await DB.put('ai_memories', m); await refresh(conv.id); renderMemoryList(dialog, conv); });
      el.querySelector('[data-act="edit"]')?.addEventListener('click', () => openMemEditor(dialog, conv, m));
      el.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        if (!await UIDialog.confirm('删除这条长记忆？', { danger: true, okLabel: '删除' })) return;
        await DB.delete('ai_memories', m.id);
        await refresh(conv.id);
        renderMemoryList(dialog, conv);
      });
    });
  }

  function memRow(m) {
    return `
      <div class="mem-row ${m.stale ? 'is-stale' : ''}" data-id="${m.id}">
        <div class="mem-top">
          <span class="tag ${m.userConfirmed ? 'tag-confirmed' : 'tag-pending'}">${m.userConfirmed ? '已确认' : '待确认'}</span>
          ${m.stale ? '<span class="tag">已停用</span>' : ''}
          <span class="bm-time">${formatRelativeTime(m.generatedAt)}</span>
        </div>
        <div class="bm-content">${escapeHtml(m.content)}</div>
        ${m.keywords?.length ? `<div class="bm-tags">${m.keywords.map((k) => `<span class="tag">#${escapeHtml(k)}</span>`).join('')}</div>` : ''}
        <div class="bm-card-actions">
          ${!m.userConfirmed ? '<button class="msg-act" data-act="confirm">确认</button>' : ''}
          <button class="msg-act" data-act="edit">编辑</button>
          <button class="msg-act" data-act="disable">${m.stale ? '恢复' : '停用'}</button>
          <button class="msg-act" data-act="delete">删除</button>
        </div>
      </div>
    `;
  }

  function openMemEditor(parentDialog, conv, m) {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>编辑长记忆</h3>
        <form id="mem-edit-form">
          <label class="field"><span>内容</span><textarea name="content" rows="4">${escapeHtml(m.content)}</textarea></label>
          <label class="field"><span>关键词（逗号分隔）</span><input name="keywords" value="${escapeAttr((m.keywords || []).join(', '))}"></label>
          <label class="field"><span>关于（对象）</span><input name="object" value="${escapeAttr(m.object || '')}"></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="mem-edit-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#mem-edit-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#mem-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      m.content = fd.get('content').trim();
      m.keywords = String(fd.get('keywords') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      m.object = fd.get('object').trim();
      await DB.put('ai_memories', m);
      dialog.remove();
      await refresh(conv.id);
      renderMemoryList(parentDialog, conv);
    });
  }

  return { refresh, getInjectableMemories, markStaleForMessages, maybeAutoSummarize, summarizeNow, openManager };
})();
window.Memory = Memory;
