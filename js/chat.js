// AI 对话模块（第6部分完整版）：会话绑定对方角色卡(0-1)/我的角色卡(0-1)/预设(0-1)/
// 世界书(0-多)/手工长记忆(0-多) + 聊天连接与总结连接。上下文编排顺序按指令 6.2 实现。
const Chat = (() => {
  let container;
  let state = {
    view: 'list', // 'list' | 'room'
    conversations: [],
    connections: [],
    currentConversationId: null,
    messages: [],
    showArchived: false,
    showContextPreview: false,
    streaming: false,
    abortController: null,
    avatarUrls: {}, // 'user' -> url | 角色资源id -> url，同步渲染模板用，靠 refreshAvatarUrls() 预取
  };

  async function init(rootEl) {
    container = rootEl;
    await refreshConversations();
    state.connections = await DB.getAll('connections');
    await refreshAvatarUrls();
    window.__chatOpenConversation = async (conversationId, messageId) => {
      await openConversation(conversationId);
      if (messageId) highlightMessage(messageId);
    };
    render();
  }

  function highlightMessage(messageId) {
    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-id="${messageId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('is-highlighted');
      setTimeout(() => el.classList.remove('is-highlighted'), 1600);
    });
  }

  async function refreshConversations() {
    const all = await DB.getAll('conversations');
    all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    state.conversations = all;
  }

  // 预取用户头像 + 当前列表/房间里会用到的所有角色头像，存进 state.avatarUrls 供模板同步读取。
  async function refreshAvatarUrls() {
    const charIds = state.conversations.map((c) => c.characterResourceId).filter(Boolean);
    state.avatarUrls = await Avatars.preload(charIds);
  }

  function render() {
    if (state.view === 'list') renderList();
    else renderRoom();
  }

  function renderList() {
    container.innerHTML = `
      <div class="chat-list-view">
        <div class="view-header">
          <h2>Home</h2>
          <div class="header-actions">
            <button class="btn-icon" id="btn-res-lib" title="AI 资料库">${roseFlourish(18)}</button>
            <button class="btn-icon" id="btn-new-conv" title="新建对话">＋</button>
          </div>
        </div>
        ${state.connections.length === 0 ? `
          <div class="hint-banner">
            还没有配置任何 API 连接。去"更多 → API 连接"里添加一个（可以先用测试用的假信息，功能界面都能正常操作，只是真正发消息时会提示连接失败）。
          </div>` : ''}
        <div class="conv-list" id="conv-list">
          ${state.conversations.length === 0 ? emptyState('还没有对话', '点右上角 ＋ 开始第一段对话') :
            state.conversations.map(convItem).join('')}
        </div>
      </div>
    `;
    container.querySelector('#btn-new-conv').addEventListener('click', openNewConversationDialog);
    container.querySelector('#btn-res-lib').addEventListener('click', () => window.App.switchTab('resources'));
    container.querySelectorAll('.conv-row').forEach((el) => {
      el.addEventListener('click', () => openConversation(el.dataset.id));
    });
  }

  function characterOf(conv) {
    return conv.characterResourceId ? Resources.all.find((r) => r.id === conv.characterResourceId) : null;
  }

  function avatarInner(url, letterSource) {
    return url ? `<img src="${url}" alt="">` : escapeHtml((letterSource || '拾').slice(0, 1));
  }

  function convItem(c) {
    const character = characterOf(c);
    const pendingDraft = window.Proactive?.getPendingDraft(c.id);
    const avatarUrl = character ? state.avatarUrls[character.id] : null;
    return `
      <div class="conv-row" data-id="${c.id}">
        <div class="conv-avatar">${avatarInner(avatarUrl, character?.name || c.title || '对')}</div>
        <div class="conv-meta">
          <div class="conv-title">${escapeHtml(c.title || character?.name || '未命名对话')} ${pendingDraft ? '<span class="tag draft-tag">主动消息草稿</span>' : ''}</div>
          <div class="conv-sub">${escapeHtml(c.lastMessagePreview || '还没有消息')}</div>
        </div>
        <div class="conv-time">${formatRelativeTime(c.updatedAt)}</div>
      </div>
    `;
  }

  function resourceOptions(kind, selectedId, allowEmpty) {
    const list = Resources.byKind(kind);
    return (allowEmpty ? `<option value="">（不设定）</option>` : '') +
      list.map((r) => `<option value="${r.id}" ${selectedId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
  }

  function resourceCheckboxes(kind, selectedIds, name) {
    const list = Resources.byKind(kind);
    if (list.length === 0) return `<div class="empty-sub">还没有${Resources.KIND_META[kind].label}，可以去资料库新建</div>`;
    return list.map((r) => `
      <label class="field-inline-sm">
        <input type="checkbox" name="${name}" value="${r.id}" ${selectedIds.includes(r.id) ? 'checked' : ''}> ${escapeHtml(r.name)}
      </label>
    `).join('');
  }

  function bindingFieldsHTML(conv) {
    const c = conv || {};
    const connOptions = state.connections.map((cn) =>
      `<option value="${cn.id}" ${c.connectionId === cn.id ? 'selected' : ''}>${escapeHtml(cn.name)}</option>`).join('');
    return `
      <label class="field"><span>使用的连接</span>
        <select name="connectionId"><option value="">（未绑定）</option>${connOptions}</select>
      </label>
      <label class="field"><span>对方角色卡（0-1，来自资料库）</span>
        <select name="characterResourceId">${resourceOptions('character', c.characterResourceId, true)}</select>
      </label>
      <label class="field"><span>我的角色卡（0-1）</span>
        <select name="personaResourceId">${resourceOptions('persona', c.personaResourceId, true)}</select>
      </label>
      <label class="field"><span>预设（0-1）</span>
        <select name="presetResourceId">${resourceOptions('preset', c.presetResourceId, true)}</select>
      </label>
      <fieldset class="fieldset"><legend>世界书（0-多）</legend>${resourceCheckboxes('lorebook', c.lorebookResourceIds || [], 'lorebookResourceIds')}</fieldset>
      <fieldset class="fieldset"><legend>手工长记忆（0-多）</legend>${resourceCheckboxes('longMemory', c.manualMemoryResourceIds || [], 'manualMemoryResourceIds')}</fieldset>
      <label class="field"><span>额外系统提示词（可选）</span><textarea name="systemPromptExtra" rows="2">${escapeHtml(c.systemPromptExtra || '')}</textarea></label>
      <p class="section-hint">还没有想要的资料？去"资料库"里新建后再回来选。</p>
    `;
  }

  function collectBindingFields(dialog) {
    const fd = new FormData(dialog.querySelector('form'));
    return {
      connectionId: fd.get('connectionId') || null,
      characterResourceId: fd.get('characterResourceId') || null,
      personaResourceId: fd.get('personaResourceId') || null,
      presetResourceId: fd.get('presetResourceId') || null,
      lorebookResourceIds: fd.getAll('lorebookResourceIds'),
      manualMemoryResourceIds: fd.getAll('manualMemoryResourceIds'),
      systemPromptExtra: (fd.get('systemPromptExtra') || '').trim(),
      title: (fd.get('title') || '').trim(),
    };
  }

  async function openNewConversationDialog() {
    await Resources.refresh();
    const dialog = Pages.open('新建对话', `
      <form id="new-conv-form">
        <label class="field"><span>对话标题</span><input name="title" maxlength="24" placeholder="例如：晚安聊天"></label>
        ${bindingFieldsHTML(null)}
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="cancel-new-conv">取消</button>
          <button type="submit" class="btn-primary">创建并进入</button>
        </div>
      </form>
    `);
    dialog.querySelector('#cancel-new-conv').addEventListener('click', () => Pages.close(dialog));
    dialog.querySelector('#new-conv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = collectBindingFields(dialog);
      const id = uuid();
      const now = nowISO();
      const character = fields.characterResourceId ? Resources.all.find((r) => r.id === fields.characterResourceId) : null;
      const conversation = {
        id,
        title: fields.title || character?.name || '未命名对话',
        ...fields,
        longMemory: { enabled: false, summarizeEveryN: 0, maxCount: 200, summaryPrompt: '', injectionPrompt: '', injectionCap: 6, lastSummarizedCount: 0 },
        proactive: { mode: 'off', quietStart: '23:00', quietEnd: '08:00', minCooldownMinutes: 120, dailyCap: 3, paused: false, dailyCount: 0, dailyCountDate: '', lastTriggeredAt: '' },
        lastMessagePreview: '',
        createdAt: now,
        updatedAt: now,
      };
      await DB.put('conversations', conversation);
      if (character?.data?.openingLine) {
        await DB.put('messages', {
          id: uuid(),
          conversationId: id,
          role: 'assistant',
          content: character.data.openingLine,
          createdAt: now,
          archived: false,
          bookmarked: false,
          isGreeting: true,
        });
      }
      Pages.close(dialog);
      await refreshConversations();
      openConversation(id);
    });
  }

  async function openConversation(id) {
    state.currentConversationId = id;
    state.view = 'room';
    state.showArchived = false;
    await Resources.refresh();
    await refreshAvatarUrls();
    if (window.Memory) await window.Memory.refresh(id);
    await loadMessages();
    render();
  }

  async function loadMessages() {
    const all = await DB.getAllByIndex('messages', 'conversationId', state.currentConversationId);
    all.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    state.messages = all;
  }

  function visibleMessages() {
    return state.showArchived ? state.messages : state.messages.filter((m) => !m.archived);
  }

  function currentConversation() {
    return state.conversations.find((c) => c.id === state.currentConversationId);
  }

  function renderRoom() {
    const conv = currentConversation();
    if (!conv) { state.view = 'list'; return render(); }
    const msgs = visibleMessages();
    const character = characterOf(conv);
    const draft = window.Proactive?.getPendingDraft(conv.id);
    container.innerHTML = `
      <div class="chat-room-view">
        <div class="room-header">
          <button class="btn-icon" id="btn-back">←</button>
          <div class="room-title">
            <div class="room-name">${escapeHtml(conv.title)}</div>
            <div class="room-sub">${character ? 'AI 生成角色 · ' + escapeHtml(character.name) : '无角色人设'}</div>
          </div>
          <button class="btn-icon" id="btn-room-settings" title="对话设置">⚙</button>
        </div>
        ${!navigator.onLine ? '<div class="hint-banner warn">当前处于离线状态，暂时无法连接 AI 服务。</div>' : ''}
        ${draft ? `
          <div class="hint-banner draft-banner">
            <b>${escapeHtml(character?.name || '角色')}</b> 主动想对你说：「${escapeHtml(truncate(draft.content, 60))}」
            <div class="draft-actions">
              <button class="msg-act" id="btn-draft-send">发送</button>
              <button class="msg-act" id="btn-draft-discard">忽略</button>
            </div>
          </div>` : ''}
        ${state.messages.some((m) => m.archived) ? `
          <div class="archived-toggle">
            <label><input type="checkbox" id="toggle-archived" ${state.showArchived ? 'checked' : ''}> 显示已封存的消息（回溯/重说产生的历史分支）</label>
          </div>` : ''}
        <div class="context-preview-wrap">
          <button class="context-preview-toggle" id="toggle-context">${state.showContextPreview ? '▾' : '▸'} 本轮上下文预览</button>
          ${state.showContextPreview ? `<pre class="context-preview-body">${escapeHtml(buildContext(conv, visibleMessages()).systemText || '（空）')}</pre>` : ''}
        </div>
        <div class="message-list" id="message-list">
          ${msgs.length === 0 ? emptyState('开始聊天吧', '在下方输入框发送第一条消息') :
            msgs.map((m, i) => messageBubble(m, !msgs[i + 1] || msgs[i + 1].role !== m.role, character)).join('')}
        </div>
        <div class="composer">
          <textarea id="composer-input" rows="1" placeholder="输入消息…"></textarea>
          ${state.streaming
            ? '<button class="btn-primary btn-stop" id="btn-stop">停止</button>'
            : '<button class="btn-primary" id="btn-send">发送</button>'}
        </div>
      </div>
    `;
    container.querySelector('#btn-back').addEventListener('click', () => { state.view = 'list'; render(); });
    container.querySelector('#btn-room-settings').addEventListener('click', () => openRoomSettings(conv));
    container.querySelector('#toggle-context').addEventListener('click', () => { state.showContextPreview = !state.showContextPreview; render(); });
    if (draft) {
      container.querySelector('#btn-draft-send').addEventListener('click', async () => { await window.Proactive.sendDraft(draft.id); await loadMessages(); await refreshConversations(); render(); });
      container.querySelector('#btn-draft-discard').addEventListener('click', () => { window.Proactive.discardDraft(draft.id); render(); });
    }
    const archivedToggle = container.querySelector('#toggle-archived');
    if (archivedToggle) archivedToggle.addEventListener('change', (e) => { state.showArchived = e.target.checked; render(); });

    const list = container.querySelector('#message-list');
    list.scrollTop = list.scrollHeight;
    list.querySelectorAll('.msg-bubble').forEach((el) => bindMessageActions(el, conv));

    if (state.streaming) {
      container.querySelector('#btn-stop').addEventListener('click', () => {
        state.abortController?.abort();
      });
    } else {
      const sendBtn = container.querySelector('#btn-send');
      const input = container.querySelector('#composer-input');
      sendBtn.addEventListener('click', () => sendMessage(conv, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(conv, input.value);
        }
      });
      if (window.__pendingComposerText) {
        input.value = window.__pendingComposerText;
        window.__pendingComposerText = null;
        input.focus();
      }
    }
  }

  // isGroupLast：连续同一发言方的最后一条消息才保留完整圆角（尾部），
  // 其余在群组中间的消息用方一点的角，视觉上"粘"在一起，参考 Tidal_Echo 的分组气泡。
  function messageBubble(m, isGroupLast, character) {
    const isUser = m.role === 'user';
    const avatarUrl = isUser ? state.avatarUrls.user : (character ? state.avatarUrls[character.id] : null);
    const avatarHtml = `<div class="msg-avatar">${avatarInner(avatarUrl, isUser ? '你' : character?.name)}</div>`;
    const bubbleHtml = `
        <div class="msg-bubble ${isUser ? 'from-user' : 'from-ai'} ${m.archived ? 'is-archived' : ''} ${isGroupLast ? 'is-group-last' : 'is-group-mid'}" data-id="${m.id}">
          <div class="msg-content">${renderMarkdownish(m.content)}</div>
          <div class="msg-meta">
            <span class="msg-time">${formatTime(m.createdAt)}</span>
          </div>
          <div class="msg-actions">
            <button class="msg-act" data-act="copy" title="复制">复制</button>
            <button class="msg-act ${m.bookmarked ? 'active' : ''}" data-act="bookmark" title="收藏">${m.bookmarked ? '★ 已收藏' : '☆ 收藏'}</button>
            ${isUser && !m.archived ? '<button class="msg-act" data-act="edit" title="回溯编辑">回溯编辑</button>' : ''}
            ${!isUser && !m.archived && !m.isGreeting ? '<button class="msg-act" data-act="retry" title="让他重说">让他重说</button>' : ''}
          </div>
        </div>
    `;
    return `
      <div class="msg-row ${isUser ? 'from-user' : 'from-ai'}">
        ${isUser ? bubbleHtml + avatarHtml : avatarHtml + bubbleHtml}
      </div>
    `;
  }

  function bindMessageActions(el, conv) {
    const id = el.dataset.id;
    el.querySelectorAll('.msg-act').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const msg = state.messages.find((m) => m.id === id);
        const act = btn.dataset.act;
        if (act === 'copy') {
          await copyToClipboard(msg.content);
          toast('已复制');
        } else if (act === 'bookmark') {
          await toggleBookmarkMessage(conv, msg);
          await loadMessages();
          render();
        } else if (act === 'edit') {
          await archiveFrom(msg.createdAt, true);
          window.__pendingComposerText = msg.content;
          await loadMessages();
          render();
        } else if (act === 'retry') {
          // 封存这条回复本身（以及它之后的任何消息），再重新生成一次。
          await archiveFrom(msg.createdAt, true);
          await loadMessages();
          render();
          await requestAssistantReply(conv);
        }
      });
    });
  }

  // 把 fromTime 之后（inclusive 由 includeSelf 决定）的消息标记为已封存，物理保留、可恢复。
  async function archiveFrom(fromTime, includeSelf) {
    const toArchive = state.messages.filter((m) => includeSelf ? m.createdAt >= fromTime : m.createdAt > fromTime);
    for (const m of toArchive) {
      m.archived = true;
      await DB.put('messages', m);
    }
    const archivedIds = toArchive.map((m) => m.id);
    // 关联到这些消息的记忆收藏 / 自动长记忆标记为 stale，而不是删除。
    const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', state.currentConversationId);
    for (const b of bookmarks) {
      if (b.messageId && archivedIds.includes(b.messageId)) {
        b.stale = true;
        await DB.put('bookmarks', b);
      }
    }
    if (window.Memory) await window.Memory.markStaleForMessages(state.currentConversationId, archivedIds);
  }

  async function toggleBookmarkMessage(conv, msg) {
    msg.bookmarked = !msg.bookmarked;
    await DB.put('messages', msg);
    if (msg.bookmarked) {
      await DB.put('bookmarks', {
        id: uuid(),
        type: 'message',
        conversationId: conv.id,
        messageId: msg.id,
        title: conv.title,
        content: msg.content,
        tags: [],
        stale: false,
        createdAt: nowISO(),
      });
    } else {
      const existing = await DB.getAllByIndex('bookmarks', 'conversationId', conv.id);
      const match = existing.find((b) => b.messageId === msg.id);
      if (match) await DB.delete('bookmarks', match.id);
    }
  }

  async function sendMessage(conv, text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    if (!navigator.onLine) { toast('当前离线，无法发送'); return; }
    const now = nowISO();
    const userMsg = { id: uuid(), conversationId: conv.id, role: 'user', content: trimmed, createdAt: now, archived: false, bookmarked: false };
    await DB.put('messages', userMsg);
    conv.updatedAt = now;
    conv.lastMessagePreview = trimmed.slice(0, 40);
    await DB.put('conversations', conv);
    await loadMessages();
    render();
    await requestAssistantReply(conv);
  }

  // ---- 第 6.2 部分：上下文编排 ----
  // 顺序：事实与边界 → 预设 → 对方卡 → 我的卡 → 常驻世界书 → 命中关键词世界书 →
  //      手工长记忆 → 自动长记忆 → 最近聊天 → 当前消息 → 历史后指令
  function buildContext(conv, historyMessages) {
    const character = characterOf(conv);
    const persona = conv.personaResourceId ? Resources.all.find((r) => r.id === conv.personaResourceId) : null;
    const preset = conv.presetResourceId ? Resources.all.find((r) => r.id === conv.presetResourceId) : null;
    const lorebooks = (conv.lorebookResourceIds || []).map((id) => Resources.all.find((r) => r.id === id)).filter(Boolean);
    const manualMemories = (conv.manualMemoryResourceIds || []).map((id) => Resources.all.find((r) => r.id === id)).filter(Boolean);
    const recentText = historyMessages.slice(-6).map((m) => m.content).join('\n').toLowerCase();

    const blocks = [];

    // 事实与边界
    const boundaries = [character?.data?.boundaries, persona?.data?.boundaries, persona?.data?.forbiddenRealInfo ? `绝不引用：${persona.data.forbiddenRealInfo}` : ''].filter(Boolean);
    if (boundaries.length) blocks.push(`【事实与边界】\n${boundaries.join('\n')}`);
    blocks.push('【AI 身份声明】你是 AI 生成的对话角色，所有回复都是 AI 生成内容，不代表真实人物，不构成现实承诺。');

    // 预设
    if (preset) {
      const p = preset.data;
      const presetLines = Object.entries(p)
        .filter(([k]) => k !== 'systemPrompt' && k !== 'postHistoryPrompt')
        .map(([, v]) => v).filter(Boolean);
      if (p.systemPrompt) blocks.push(`【预设 · 系统提示】${p.systemPrompt}`);
      if (presetLines.length) blocks.push(`【预设】\n${presetLines.join('\n')}`);
    }

    // 对方卡
    if (character) {
      const c = character.data;
      const lines = Object.entries(c).filter(([k]) => k !== 'openingLine').map(([, v]) => v).filter(Boolean);
      blocks.push(`【对方角色卡 · ${character.name}】\n${lines.join('\n')}`);
    }

    // 我的卡
    if (persona) {
      const p = persona.data;
      const lines = Object.entries(p).filter(([k]) => k !== 'forbiddenRealInfo').map(([, v]) => v).filter(Boolean);
      blocks.push(`【我的角色卡】\n${lines.join('\n')}`);
    }

    // 常驻世界书
    const alwaysEntries = [];
    const keywordEntries = [];
    for (const lb of lorebooks) {
      for (const entry of (lb.data.entries || [])) {
        if (entry.enabled === false) continue;
        if (entry.triggerMode === 'keyword') keywordEntries.push(entry);
        else alwaysEntries.push(entry);
      }
    }
    sortEntries(alwaysEntries);
    if (alwaysEntries.length) blocks.push(`【常驻世界书】\n${alwaysEntries.map(entryText).join('\n')}`);

    // 命中关键词世界书
    const hitEntries = keywordEntries.filter((entry) => {
      const kws = (entry.keywords || '').split(/[,，]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      return kws.some((kw) => kw && recentText.includes(kw));
    });
    sortEntries(hitEntries);
    if (hitEntries.length) blocks.push(`【命中关键词世界书】\n${hitEntries.map(entryText).join('\n')}`);

    // 手工长记忆
    if (manualMemories.length) {
      blocks.push(`【手工长记忆】\n${manualMemories.map((m) => {
        const d = m.data;
        return `- ${d.title || m.name}：${[d.facts, d.feelings, d.relationshipChange, d.stablePreferencesTaboos, d.unfinishedPromises].filter(Boolean).join('；')}`;
      }).join('\n')}`);
    }

    // 自动长记忆（第8部分）
    const autoMemories = window.Memory ? window.Memory.getInjectableMemories(conv, historyMessages) : [];
    if (autoMemories.length) {
      const prefix = conv.longMemory?.injectionPrompt ? conv.longMemory.injectionPrompt + '\n' : '';
      blocks.push(`【自动长记忆】\n${prefix}${autoMemories.map((m) => `- ${m.content}`).join('\n')}`);
    }

    if (conv.systemPromptExtra) blocks.push(`【额外系统提示词】\n${conv.systemPromptExtra}`);

    return { systemText: blocks.join('\n\n'), postHistoryText: preset?.data?.postHistoryPrompt || '' };
  }

  function sortEntries(entries) {
    entries.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  }
  function entryText(entry) {
    const parts = [entry.content, entry.rules, entry.organization, entry.relationships, entry.historyEvents].filter(Boolean);
    return `- ${entry.title ? entry.title + '：' : ''}${parts.join('；')}`;
  }

  async function requestAssistantReply(conv, { isProactiveCheck = false } = {}) {
    const connection = state.connections.find((c) => c.id === conv.connectionId);
    if (!connection) {
      if (!isProactiveCheck) toast('这个对话还没有绑定 API 连接，去对话设置里选一个吧');
      return null;
    }
    const provider = Providers[connection.provider];
    if (!provider) { toast('未知的连接类型'); return null; }

    const apiKey = connection.apiKeyCipher ? await CryptoUtils.decryptText(connection.apiKeyCipher, connection.apiKeyIv) : '';

    const history = visibleMessages();
    const { systemText, postHistoryText } = buildContext(conv, history);
    const character = characterOf(conv);

    state.streaming = true;
    state.abortController = new AbortController();
    render();

    const assistantMsg = { id: uuid(), conversationId: conv.id, role: 'assistant', content: '', createdAt: nowISO(), archived: false, bookmarked: false };
    let appended = false;

    try {
      let stream;
      if (connection.provider === 'anthropic') {
        const msgs = history.map((m) => ({ role: m.role, content: m.content }));
        const fullSystem = [systemText, postHistoryText].filter(Boolean).join('\n\n');
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal, fullSystem);
      } else if (connection.provider === 'gemini') {
        const msgs = history.map((m) => ({ role: m.role, content: m.content }));
        const fullSystem = [systemText, postHistoryText].filter(Boolean).join('\n\n');
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal, fullSystem);
      } else {
        const msgs = [
          ...(systemText ? [{ role: 'system', content: systemText }] : []),
          ...history.map((m) => ({ role: m.role, content: m.content })),
          ...(postHistoryText ? [{ role: 'system', content: postHistoryText }] : []),
        ];
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal);
      }

      for await (const chunk of stream) {
        assistantMsg.content += chunk;
        if (!appended) {
          state.messages.push(assistantMsg);
          appended = true;
        }
        updateStreamingBubble(assistantMsg, character);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content += assistantMsg.content ? '\n\n（已停止生成）' : '（已停止生成）';
      } else {
        assistantMsg.content = (assistantMsg.content ? assistantMsg.content + '\n\n' : '') + `⚠️ ${err.message || err}`;
      }
      if (!appended) { state.messages.push(assistantMsg); appended = true; }
      updateStreamingBubble(assistantMsg, character);
    } finally {
      state.streaming = false;
      state.abortController = null;
      if (appended && assistantMsg.content) {
        await DB.put('messages', assistantMsg);
        conv.updatedAt = nowISO();
        conv.lastMessagePreview = assistantMsg.content.slice(0, 40);
        await DB.put('conversations', conv);
        await refreshConversations();
        if (window.Memory) await window.Memory.maybeAutoSummarize(conv);
      }
      render();
    }
    return assistantMsg;
  }

  function updateStreamingBubble(msg, character) {
    const list = container.querySelector('#message-list');
    if (!list) return;
    let el = list.querySelector(`[data-id="${msg.id}"]`);
    if (!el) {
      list.insertAdjacentHTML('beforeend', messageBubble(msg, true, character));
      el = list.querySelector(`[data-id="${msg.id}"]`);
    } else {
      el.querySelector('.msg-content').innerHTML = renderMarkdownish(msg.content);
    }
    list.scrollTop = list.scrollHeight;
  }

  function openRoomSettings(conv) {
    const lm = conv.longMemory || {};
    const pr = conv.proactive || {};
    const summaryConnOptions = state.connections.map((cn) =>
      `<option value="${cn.id}" ${lm.summaryConnectionId === cn.id ? 'selected' : ''}>${escapeHtml(cn.name)}</option>`).join('');
    const dialog = Pages.open('对话设置', `
      <form id="room-settings-form">
        <label class="field"><span>标题</span><input name="title" value="${escapeAttr(conv.title)}" maxlength="24"></label>
        ${bindingFieldsHTML(conv)}

        <fieldset class="fieldset"><legend>独立长记忆（第8部分）</legend>
          <label class="field-inline"><input type="checkbox" name="lmEnabled" ${lm.enabled ? 'checked' : ''}><span>启用自动总结长记忆</span></label>
          <label class="field"><span>总结连接（不选则用聊天连接）</span><select name="lmSummaryConnectionId"><option value="">（同聊天连接）</option>${summaryConnOptions}</select></label>
          <label class="field"><span>每 N 条消息自动总结一次（0 为关闭）</span><input type="number" name="lmEveryN" value="${lm.summarizeEveryN || 0}" min="0"></label>
          <label class="field"><span>最大记忆条数</span><input type="number" name="lmMaxCount" value="${lm.maxCount || 200}" min="1"></label>
          <label class="field"><span>注入上限（每轮最多注入几条）</span><input type="number" name="lmInjectionCap" value="${lm.injectionCap ?? 6}" min="0"></label>
          <label class="field"><span>总结提示词</span><textarea name="lmSummaryPrompt" rows="2">${escapeHtml(lm.summaryPrompt || '')}</textarea></label>
          <label class="field"><span>注入提示词</span><textarea name="lmInjectionPrompt" rows="2">${escapeHtml(lm.injectionPrompt || '')}</textarea></label>
          <div class="modal-actions" style="justify-content:flex-start">
            <button type="button" class="btn-secondary" id="btn-summarize-now">立即总结</button>
            <button type="button" class="btn-secondary" id="btn-open-memories">查看/管理长记忆</button>
          </div>
        </fieldset>

        <fieldset class="fieldset"><legend>角色主动消息（第9部分）</legend>
          <p class="section-hint">没有独立后台/推送服务：只会在你打开、回到前台、或应用保持打开期间定时检查生成，应用被完全关闭后不会收到新消息推送。</p>
          <label class="field"><span>模式</span>
            <select name="pMode">
              <option value="off" ${pr.mode !== 'draft' && pr.mode !== 'auto' ? 'selected' : ''}>关闭</option>
              <option value="draft" ${pr.mode === 'draft' ? 'selected' : ''}>仅草稿（生成后等你确认发送）</option>
              <option value="auto" ${pr.mode === 'auto' ? 'selected' : ''}>允许自动发送</option>
            </select>
          </label>
          <label class="field"><span>安静时段（开始-结束，24 小时制）</span>
            <div style="display:flex;gap:8px">
              <input type="time" name="pQuietStart" value="${pr.quietStart || '23:00'}">
              <input type="time" name="pQuietEnd" value="${pr.quietEnd || '08:00'}">
            </div>
          </label>
          <label class="field"><span>最短冷却（分钟）</span><input type="number" name="pMinCooldown" value="${pr.minCooldownMinutes ?? 120}" min="1"></label>
          <label class="field"><span>每日上限（条）</span><input type="number" name="pDailyCap" value="${pr.dailyCap ?? 3}" min="0"></label>
          <label class="field-inline"><input type="checkbox" name="pPaused" ${pr.paused ? 'checked' : ''}><span>一键暂停</span></label>
        </fieldset>

        <div class="modal-actions">
          <button type="button" class="btn-danger" id="btn-delete-conv">删除对话</button>
          <button type="button" class="btn-secondary" id="cancel-room-settings">取消</button>
          <button type="submit" class="btn-primary">保存</button>
        </div>
      </form>
    `);
    dialog.querySelector('#cancel-room-settings').addEventListener('click', () => Pages.close(dialog));
    dialog.querySelector('#btn-summarize-now').addEventListener('click', async () => {
      if (!window.Memory) return;
      toast('总结中…');
      try {
        await window.Memory.summarizeNow(conv);
        toast('已生成新的长记忆，去"查看/管理长记忆"确认');
      } catch (err) {
        alert('总结失败：' + (err.message || err));
      }
    });
    dialog.querySelector('#btn-open-memories').addEventListener('click', () => {
      if (window.Memory) window.Memory.openManager(conv);
    });
    dialog.querySelector('#btn-delete-conv').addEventListener('click', async () => {
      if (!confirm('删除这段对话及其全部消息？此操作不可撤销（收藏内容会保留但会标记为来源已删除）。')) return;
      const msgs = await DB.getAllByIndex('messages', 'conversationId', conv.id);
      for (const m of msgs) await DB.delete('messages', m.id);
      const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', conv.id);
      for (const b of bookmarks) { b.stale = true; b.sourceDeleted = true; await DB.put('bookmarks', b); }
      await DB.delete('conversations', conv.id);
      Pages.close(dialog);
      state.view = 'list';
      await refreshConversations();
      render();
    });
    dialog.querySelector('#room-settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = collectBindingFields(dialog);
      const fd = new FormData(e.target);
      conv.title = fields.title || conv.title;
      Object.assign(conv, fields);
      delete conv.title_unused;
      conv.longMemory = {
        ...lm,
        enabled: fd.get('lmEnabled') === 'on',
        summaryConnectionId: fd.get('lmSummaryConnectionId') || null,
        summarizeEveryN: Number(fd.get('lmEveryN')) || 0,
        maxCount: Number(fd.get('lmMaxCount')) || 200,
        injectionCap: Number(fd.get('lmInjectionCap')) || 0,
        summaryPrompt: fd.get('lmSummaryPrompt') || '',
        injectionPrompt: fd.get('lmInjectionPrompt') || '',
      };
      conv.proactive = {
        ...pr,
        mode: fd.get('pMode') || 'off',
        quietStart: fd.get('pQuietStart') || '23:00',
        quietEnd: fd.get('pQuietEnd') || '08:00',
        minCooldownMinutes: Number(fd.get('pMinCooldown')) || 120,
        dailyCap: Number(fd.get('pDailyCap')) || 0,
        paused: fd.get('pPaused') === 'on',
      };
      conv.updatedAt = nowISO();
      await DB.put('conversations', conv);
      Pages.close(dialog);
      await refreshConversations();
      render();
    });
  }

  async function refreshConnections() {
    state.connections = await DB.getAll('connections');
  }

  return {
    init, refreshConnections, characterOf, buildContext,
    get state() { return state; },
    requestAssistantReply,
    async refreshList() { await refreshConversations(); if (state.view === 'list') render(); },
    async reloadIfCurrent(conversationId) {
      if (state.currentConversationId === conversationId) { await loadMessages(); render(); }
    },
    async refreshAvatars() { await refreshAvatarUrls(); render(); },
  };
})();
window.Chat = Chat;

function emptyState(title, sub) {
  return `<div class="empty-state">${flowerSpray(90)}<div class="empty-title">${escapeHtml(title)}</div><div class="empty-sub">${escapeHtml(sub)}</div></div>`;
}

// 简约线稿玫瑰花饰，用在很小的空间里（比如按钮）。
function roseFlourish(size) {
  const petal = 'M0,0 C-3,-3 -2,-7 0,-9 C2,-7 3,-3 0,0 Z';
  return `
    <svg class="rose-flourish" width="${size}" height="${size}" viewBox="-14 -16 28 30" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round">
      <g transform="translate(0,-2)">
        <path d="${petal}"/><path d="${petal}" transform="rotate(72)"/><path d="${petal}" transform="rotate(144)"/>
        <path d="${petal}" transform="rotate(216)"/><path d="${petal}" transform="rotate(288)"/>
        <circle r="1.6" opacity="0.6"/>
      </g>
      <path d="M0,7 V13"/>
      <path d="M0,9c-2 0-3.5 1.3-4 3"/>
      <path d="M0,11.5c1.8 0 3.2 1 3.6 2.6"/>
    </svg>
  `;
}

// 多花线稿花束，用在空状态这种有足够空间的地方。
function flowerSpray(width) {
  const height = Math.round(width * 60 / 140);
  return `
    <svg class="flower-spray" width="${width}" height="${height}" viewBox="0 0 140 60" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M108,32 Q124,28 138,14" stroke-width="0.8"/>
      <path d="M118,26 Q122,20 130,18"/>
      <path d="M122,22 Q126,15 133,12"/>
      <path d="M30,34 Q18,42 10,50"/>
      <path d="M20,44 Q14,50 8,54"/>
      <path d="M70,26 Q66,42 62,50"/>
      <path d="M62,44 Q56,50 50,54"/>
      <path d="M30.0,34.0 C23.0,30.0 24.6,24.2 31.7,22.1 C37.9,26.0 37.8,32.1 30.0,34.0"/>
      <path d="M30.0,34.0 C31.7,26.2 37.7,25.8 41.8,31.9 C40.0,39.0 34.2,40.8 30.0,34.0"/>
      <path d="M30.0,34.0 C38.0,33.2 40.1,38.8 35.6,44.6 C28.3,45.1 24.8,40.1 30.0,34.0"/>
      <path d="M30.0,34.0 C33.3,41.3 28.6,45.1 21.7,42.6 C18.9,35.8 22.6,31.0 30.0,34.0"/>
      <path d="M30.0,34.0 C24.0,39.4 19.0,36.1 19.2,28.7 C24.8,24.0 30.6,26.0 30.0,34.0"/>
      <circle cx="30" cy="34" r="1.1" fill="currentColor" stroke="none"/>
      <path d="M70.0,26.0 C62.0,18.8 65.7,11.7 75.5,11.0 C82.5,17.8 80.7,25.6 70.0,26.0"/>
      <path d="M70.0,26.0 C74.3,16.2 82.3,17.5 86.0,26.6 C81.7,35.3 73.7,36.1 70.0,26.0"/>
      <path d="M70.0,26.0 C80.6,27.1 81.9,35.1 74.4,41.4 C64.7,40.0 61.6,32.6 70.0,26.0"/>
      <path d="M70.0,26.0 C72.2,36.5 65.0,40.1 56.7,34.9 C55.1,25.3 61.1,20.0 70.0,26.0"/>
      <path d="M70.0,26.0 C60.7,31.4 55.0,25.6 57.4,16.1 C66.0,11.6 73.0,15.7 70.0,26.0"/>
      <circle cx="70" cy="26" r="1.4" fill="currentColor" stroke="none"/>
      <path d="M108.0,32.0 C105.7,25.0 110.4,22.0 116.4,24.9 C118.3,31.4 114.5,35.5 108.0,32.0"/>
      <path d="M108.0,32.0 C113.9,27.7 118.2,31.2 117.3,37.8 C111.7,41.6 106.7,39.2 108.0,32.0"/>
      <path d="M108.0,32.0 C114.0,36.3 112.0,41.5 105.3,42.7 C100.0,38.5 100.7,33.0 108.0,32.0"/>
      <path d="M108.0,32.0 C105.7,39.0 100.2,38.7 97.0,32.8 C99.3,26.5 104.8,25.4 108.0,32.0"/>
      <path d="M108.0,32.0 C100.6,32.0 99.2,26.7 103.9,21.8 C110.6,22.1 113.3,26.9 108.0,32.0"/>
      <circle cx="108" cy="32" r="1" fill="currentColor" stroke="none"/>
      <ellipse cx="62" cy="52" rx="2.2" ry="3.2" transform="rotate(20 62 52)"/>
    </svg>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function renderMarkdownish(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
function truncate(s, n) {
  s = s || '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}
