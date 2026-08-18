// AI 对话模块：会话列表 + 聊天室，简化人设卡（不做世界书/预设/我的角色卡/独立长记忆分区）。
const Chat = (() => {
  let container;
  let state = {
    view: 'list', // 'list' | 'room'
    conversations: [],
    connections: [],
    currentConversationId: null,
    messages: [],
    showArchived: false,
    streaming: false,
    abortController: null,
  };

  async function init(rootEl) {
    container = rootEl;
    await refreshConversations();
    state.connections = await DB.getAll('connections');
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

  function render() {
    if (state.view === 'list') renderList();
    else renderRoom();
  }

  function renderList() {
    container.innerHTML = `
      <div class="chat-list-view">
        <div class="view-header">
          <h2>AI 对话</h2>
          <button class="btn-icon" id="btn-new-conv" title="新建对话"><i class="icon">＋</i></button>
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
    container.querySelectorAll('.conv-row').forEach((el) => {
      el.addEventListener('click', () => openConversation(el.dataset.id));
    });
  }

  function convItem(c) {
    return `
      <div class="conv-row" data-id="${c.id}">
        <div class="conv-avatar">${escapeHtml((c.character?.name || c.title || '对')[0])}</div>
        <div class="conv-meta">
          <div class="conv-title">${escapeHtml(c.title || c.character?.name || '未命名对话')}</div>
          <div class="conv-sub">${escapeHtml(c.lastMessagePreview || '还没有消息')}</div>
        </div>
        <div class="conv-time">${formatRelativeTime(c.updatedAt)}</div>
      </div>
    `;
  }

  function openNewConversationDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const connOptions = state.connections.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}（${c.provider}）</option>`).join('');
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>新建对话</h3>
        <form id="new-conv-form">
          <label class="field"><span>对话标题</span><input name="title" maxlength="24" placeholder="例如：晚安聊天"></label>
          <label class="field"><span>使用的连接</span>
            <select name="connectionId" ${state.connections.length === 0 ? 'disabled' : ''}>
              ${connOptions || '<option value="">（尚未配置连接）</option>'}
            </select>
          </label>
          <fieldset class="fieldset">
            <legend>对方人设卡（可选，简化版）</legend>
            <label class="field"><span>名字</span><input name="charName" maxlength="20" placeholder="留空则不设定角色"></label>
            <label class="field"><span>人设描述</span><textarea name="charPersona" rows="3" placeholder="性格、说话方式、背景等，AI 会据此扮演"></textarea></label>
            <label class="field"><span>开场白（可选）</span><textarea name="charGreeting" rows="2" placeholder="对话开始时角色说的第一句话"></textarea></label>
          </fieldset>
          <label class="field"><span>额外系统提示词（可选）</span><textarea name="systemPrompt" rows="2" placeholder="给 AI 的额外指令，例如语言风格、回复长度"></textarea></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="cancel-new-conv">取消</button>
            <button type="submit" class="btn-primary">创建并进入</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#cancel-new-conv').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#new-conv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const id = uuid();
      const now = nowISO();
      const charName = fd.get('charName')?.trim();
      const conversation = {
        id,
        title: fd.get('title')?.trim() || charName || '未命名对话',
        connectionId: fd.get('connectionId') || null,
        character: charName ? {
          name: charName,
          persona: fd.get('charPersona')?.trim() || '',
          greeting: fd.get('charGreeting')?.trim() || '',
        } : null,
        systemPrompt: fd.get('systemPrompt')?.trim() || '',
        lastMessagePreview: '',
        createdAt: now,
        updatedAt: now,
      };
      await DB.put('conversations', conversation);
      if (conversation.character?.greeting) {
        await DB.put('messages', {
          id: uuid(),
          conversationId: id,
          role: 'assistant',
          content: conversation.character.greeting,
          createdAt: now,
          archived: false,
          bookmarked: false,
          isGreeting: true,
        });
      }
      dialog.remove();
      await refreshConversations();
      openConversation(id);
    });
  }

  async function openConversation(id) {
    state.currentConversationId = id;
    state.view = 'room';
    state.showArchived = false;
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
    container.innerHTML = `
      <div class="chat-room-view">
        <div class="room-header">
          <button class="btn-icon" id="btn-back"><i class="icon">←</i></button>
          <div class="room-title">
            <div class="room-name">${escapeHtml(conv.title)}</div>
            <div class="room-sub">${conv.character ? 'AI 生成角色 · ' + escapeHtml(conv.character.name) : '无角色人设'}</div>
          </div>
          <button class="btn-icon" id="btn-room-settings" title="对话设置"><i class="icon">⚙</i></button>
        </div>
        ${!navigator.onLine ? '<div class="hint-banner warn">当前处于离线状态，暂时无法连接 AI 服务。</div>' : ''}
        ${state.messages.some((m) => m.archived) ? `
          <div class="archived-toggle">
            <label><input type="checkbox" id="toggle-archived" ${state.showArchived ? 'checked' : ''}> 显示已封存的消息（回溯/重说产生的历史分支）</label>
          </div>` : ''}
        <div class="message-list" id="message-list">
          ${msgs.length === 0 ? emptyState('开始聊天吧', '在下方输入框发送第一条消息') : msgs.map(messageBubble).join('')}
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

  function messageBubble(m) {
    const isUser = m.role === 'user';
    return `
      <div class="msg-bubble ${isUser ? 'from-user' : 'from-ai'} ${m.archived ? 'is-archived' : ''}" data-id="${m.id}">
        <div class="msg-content">${renderMarkdownish(m.content)}</div>
        <div class="msg-meta">
          ${!isUser ? '<span class="ai-tag">AI 生成</span>' : ''}
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
          await archiveFrom(msg.createdAt, false);
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
    // 关联到这些消息的记忆收藏标记为 stale，而不是删除。
    const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', state.currentConversationId);
    for (const b of bookmarks) {
      if (b.messageId && toArchive.some((m) => m.id === b.messageId)) {
        b.stale = true;
        await DB.put('bookmarks', b);
      }
    }
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

  async function requestAssistantReply(conv) {
    const connection = state.connections.find((c) => c.id === conv.connectionId);
    if (!connection) {
      toast('这个对话还没有绑定 API 连接，去对话设置里选一个吧');
      return;
    }
    const provider = Providers[connection.provider];
    if (!provider) { toast('未知的连接类型'); return; }

    const apiKey = connection.apiKeyCipher ? await CryptoUtils.decryptText(connection.apiKeyCipher, connection.apiKeyIv) : '';

    const history = visibleMessages().filter((m) => !m.isGreeting || m !== visibleMessages()[0]);
    const systemText = buildSystemPrompt(conv);

    state.streaming = true;
    state.abortController = new AbortController();
    render();

    const assistantMsg = { id: uuid(), conversationId: conv.id, role: 'assistant', content: '', createdAt: nowISO(), archived: false, bookmarked: false };
    let appended = false;

    try {
      let stream;
      if (connection.provider === 'anthropic') {
        const msgs = history.map((m) => ({ role: m.role, content: m.content }));
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal, systemText);
      } else {
        const msgs = [
          ...(systemText ? [{ role: 'system', content: systemText }] : []),
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ];
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal);
      }

      for await (const chunk of stream) {
        assistantMsg.content += chunk;
        if (!appended) {
          state.messages.push(assistantMsg);
          appended = true;
        }
        updateStreamingBubble(assistantMsg);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMsg.content += assistantMsg.content ? '\n\n（已停止生成）' : '（已停止生成）';
      } else {
        assistantMsg.content = (assistantMsg.content ? assistantMsg.content + '\n\n' : '') + `⚠️ ${err.message || err}`;
      }
      if (!appended) { state.messages.push(assistantMsg); appended = true; }
      updateStreamingBubble(assistantMsg);
    } finally {
      state.streaming = false;
      state.abortController = null;
      if (appended && assistantMsg.content) {
        await DB.put('messages', assistantMsg);
        conv.updatedAt = nowISO();
        conv.lastMessagePreview = assistantMsg.content.slice(0, 40);
        await DB.put('conversations', conv);
        await refreshConversations();
      }
      render();
    }
  }

  function updateStreamingBubble(msg) {
    const list = container.querySelector('#message-list');
    if (!list) return;
    let el = list.querySelector(`[data-id="${msg.id}"]`);
    if (!el) {
      list.insertAdjacentHTML('beforeend', messageBubble(msg));
      el = list.querySelector(`[data-id="${msg.id}"]`);
    } else {
      el.querySelector('.msg-content').innerHTML = renderMarkdownish(msg.content);
    }
    list.scrollTop = list.scrollHeight;
  }

  function buildSystemPrompt(conv) {
    const parts = [];
    if (conv.character?.persona) {
      parts.push(`你正在扮演角色"${conv.character.name}"。人设：${conv.character.persona}`);
      parts.push('请始终以该角色的口吻回复，但你的回复本质上是 AI 生成内容，不代表真实人物。');
    }
    if (conv.systemPrompt) parts.push(conv.systemPrompt);
    return parts.join('\n\n');
  }

  function openRoomSettings(conv) {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    const connOptions = state.connections.map((c) =>
      `<option value="${c.id}" ${conv.connectionId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}（${c.provider}）</option>`).join('');
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>对话设置</h3>
        <form id="room-settings-form">
          <label class="field"><span>标题</span><input name="title" value="${escapeAttr(conv.title)}" maxlength="24"></label>
          <label class="field"><span>使用的连接</span>
            <select name="connectionId"><option value="">（未绑定）</option>${connOptions}</select>
          </label>
          <fieldset class="fieldset">
            <legend>对方人设卡</legend>
            <label class="field"><span>名字</span><input name="charName" value="${escapeAttr(conv.character?.name || '')}" maxlength="20"></label>
            <label class="field"><span>人设描述</span><textarea name="charPersona" rows="3">${escapeHtml(conv.character?.persona || '')}</textarea></label>
          </fieldset>
          <label class="field"><span>额外系统提示词</span><textarea name="systemPrompt" rows="2">${escapeHtml(conv.systemPrompt || '')}</textarea></label>
          <div class="modal-actions">
            <button type="button" class="btn-danger" id="btn-delete-conv">删除对话</button>
            <button type="button" class="btn-secondary" id="cancel-room-settings">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#cancel-room-settings').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#btn-delete-conv').addEventListener('click', async () => {
      if (!confirm('删除这段对话及其全部消息？此操作不可撤销（收藏内容会保留但会标记为来源已删除）。')) return;
      const msgs = await DB.getAllByIndex('messages', 'conversationId', conv.id);
      for (const m of msgs) await DB.delete('messages', m.id);
      const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', conv.id);
      for (const b of bookmarks) { b.stale = true; b.sourceDeleted = true; await DB.put('bookmarks', b); }
      await DB.delete('conversations', conv.id);
      dialog.remove();
      state.view = 'list';
      await refreshConversations();
      render();
    });
    dialog.querySelector('#room-settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      conv.title = fd.get('title')?.trim() || conv.title;
      conv.connectionId = fd.get('connectionId') || null;
      const charName = fd.get('charName')?.trim();
      conv.character = charName ? { ...(conv.character || {}), name: charName, persona: fd.get('charPersona')?.trim() || '' } : null;
      conv.systemPrompt = fd.get('systemPrompt')?.trim() || '';
      conv.updatedAt = nowISO();
      await DB.put('conversations', conv);
      dialog.remove();
      await refreshConversations();
      render();
    });
  }

  async function refreshConnections() {
    state.connections = await DB.getAll('connections');
  }

  return { init, refreshConnections };
})();

function emptyState(title, sub) {
  return `<div class="empty-state"><div class="empty-title">${escapeHtml(title)}</div><div class="empty-sub">${escapeHtml(sub)}</div></div>`;
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
