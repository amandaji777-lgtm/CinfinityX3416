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
    // 聊了很久的对话，本地攒的消息可能有几百上千条——loadMessages() 仍然要
    // 全部读出来（编辑/封存/长记忆这些逻辑要用到完整历史），但没道理把这么
    // 多气泡全部一次性画进 DOM：节点一多，光是打字、滚动这些最基础的交互
    // 都会跟着变卡，这是"发给 AI 的内容"之外、之前完全没处理过的另一个
    // 卡顿源头。默认只画最近这些条，更早的折成一个"加载更早的消息"按钮，
    // 点开再展开，需要时才把 DOM 撑大。每次切换对话都会重置回默认值。
    visibleWindow: 60,
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
    document.body.classList.toggle('is-chat-room', state.view === 'room');
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
    bindConvSwipe();
  }

  // 会话左滑：露出一个"删除"按钮，不是滑到底直接删——还是要点一下+二次确认才会真正
  // 删除，避免误滑一下就永久丢了一段对话。同时只允许同时露出一行，滑开新的一行会把
  // 之前露出的收回去；轻点已经露出的行会先收回而不是直接进对话。
  let swipeOpenWrap = null;
  function bindConvSwipe() {
    swipeOpenWrap = null;
    const SWIPE_W = 76;
    container.querySelectorAll('.conv-row-wrap').forEach((wrap) => {
      const row = wrap.querySelector('.conv-row');
      const delBtn = wrap.querySelector('.conv-row-delete');
      let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, isSwipe = false, moved = false;

      function setX(x, animate) {
        row.style.transition = animate ? 'transform 0.2s ease' : '';
        row.style.transform = x ? `translateX(${x}px)` : '';
      }
      function closeWrap(animate = true) {
        setX(0, animate);
        wrap.classList.remove('is-open');
        if (swipeOpenWrap === wrap) swipeOpenWrap = null;
      }
      function openWrap() {
        if (swipeOpenWrap && swipeOpenWrap !== wrap) {
          const prevRow = swipeOpenWrap.querySelector('.conv-row');
          prevRow.style.transition = 'transform 0.2s ease';
          prevRow.style.transform = '';
          swipeOpenWrap.classList.remove('is-open');
        }
        setX(-SWIPE_W, true);
        wrap.classList.add('is-open');
        swipeOpenWrap = wrap;
      }

      row.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        dragging = true; decided = false; isSwipe = false; moved = false;
        startX = e.clientX; startY = e.clientY; dx = 0;
        row.style.transition = '';
        try { row.setPointerCapture(e.pointerId); } catch (_) {}
      });
      row.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rawDx = e.clientX - startX;
        const rawDy = e.clientY - startY;
        if (!decided) {
          if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
          decided = true;
          isSwipe = Math.abs(rawDx) > Math.abs(rawDy);
          if (isSwipe) wrap.classList.add('is-dragging');
        }
        if (!isSwipe) return;
        moved = true;
        const base = wrap.classList.contains('is-open') ? -SWIPE_W : 0;
        dx = Math.min(0, Math.max(-SWIPE_W - 24, base + rawDx));
        setX(dx, false);
      });
      function endDrag() {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove('is-dragging');
        if (!isSwipe) return;
        if (dx < -SWIPE_W * 0.5) openWrap(); else closeWrap();
      }
      row.addEventListener('pointerup', endDrag);
      row.addEventListener('pointercancel', endDrag);

      row.addEventListener('click', () => {
        if (moved) { moved = false; return; } // 刚滑完这一下点击不算数
        if (wrap.classList.contains('is-open')) { closeWrap(); return; }
        openConversation(wrap.dataset.id);
      });
      delBtn.addEventListener('click', async () => {
        const conv = state.conversations.find((c) => c.id === wrap.dataset.id);
        if (!conv) return;
        if (!await UIDialog.confirm(`删除"${conv.title || characterOf(conv)?.name || '这段对话'}"及其全部消息？此操作不可撤销（收藏内容会保留但会标记为来源已删除）。`, { danger: true, okLabel: '删除' })) {
          closeWrap();
          return;
        }
        await deleteConversationData(conv.id);
        await refreshConversations();
        render();
      });
    });
  }

  // 真正的删除动作抽出来单独一个函数，会话设置页里的"删除对话"按钮跟这里的左滑删除
  // 共用同一份逻辑，不用维护两份一样的代码。
  async function deleteConversationData(conversationId) {
    const msgs = await DB.getAllByIndex('messages', 'conversationId', conversationId);
    for (const m of msgs) await DB.delete('messages', m.id);
    const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', conversationId);
    for (const b of bookmarks) { b.stale = true; b.sourceDeleted = true; await DB.put('bookmarks', b); }
    await DB.delete('conversations', conversationId);
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
      <div class="conv-row-wrap" data-id="${c.id}">
        <button type="button" class="conv-row-delete" data-act="swipe-delete">删除</button>
        <div class="conv-row" data-id="${c.id}">
          <div class="conv-avatar">${avatarInner(avatarUrl, character?.name || c.title || '对')}</div>
          <div class="conv-meta">
            <div class="conv-title">${escapeHtml(c.title || character?.name || '未命名对话')} ${pendingDraft ? '<span class="tag draft-tag">主动消息草稿</span>' : ''}</div>
            <div class="conv-sub">${escapeHtml(c.lastMessagePreview || '还没有消息')}</div>
          </div>
          <div class="conv-time">${formatRelativeTime(c.updatedAt)}</div>
        </div>
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
    state.visibleWindow = 60;
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
    const allMsgs = visibleMessages();
    const msgs = allMsgs.length > state.visibleWindow ? allMsgs.slice(-state.visibleWindow) : allMsgs;
    const hiddenOlderCount = allMsgs.length - msgs.length;
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
          ${hiddenOlderCount > 0 ? `<button class="msg-load-older" id="btn-load-older">加载更早的消息（还有 ${hiddenOlderCount} 条）</button>` : ''}
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
    // 点"加载更早的消息"是唯一一种"故意往回翻"的场景——render() 默认会把
    // 列表滚到最底部（正常打开/发消息都想看最新的），但这里用户明明是想看
    // 更早的内容，滚到底部反而把刚展开的这些直接顶飞出视野。展开前先记住
    // 当时的滚动位置和总高度，展开后按差值补回去，让原本正在看的那些消息
    // 视觉上停在原地不动，只是上面多出来一截可以继续往上翻。
    const loadOlderBtn = container.querySelector('#btn-load-older');
    if (loadOlderBtn) {
      loadOlderBtn.addEventListener('click', () => {
        const prevScrollHeight = list.scrollHeight;
        const prevScrollTop = list.scrollTop;
        state.visibleWindow += 100;
        render();
        const newList = container.querySelector('#message-list');
        if (newList) newList.scrollTop = newList.scrollHeight - prevScrollHeight + prevScrollTop;
      });
    }
    // 用事件代理挂在 message-list 上，而不是逐条气泡绑定——流式输出过程中
    // 新插进来的那条气泡不会经过完整 render()，代理这样才能一直管用。
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.msg-thinking-toggle');
      if (!btn) return;
      const body = btn.nextElementSibling;
      if (!body || !body.classList.contains('msg-thinking-body')) return;
      const willOpen = body.hidden;
      body.hidden = !willOpen;
      btn.classList.toggle('is-open', willOpen);
    });

    if (state.streaming) {
      container.querySelector('#btn-stop').addEventListener('click', () => {
        state.abortController?.abort();
      });
    } else {
      const sendBtn = container.querySelector('#btn-send');
      const input = container.querySelector('#composer-input');
      sendBtn.addEventListener('click', () => { const v = input.value; input.value = ''; sendMessage(conv, v); });
      // 中文拼音输入法选字上屏那一下，浏览器也会触发一次 key === 'Enter' 的
      // keydown——这时候文字其实还没真正提交进 input.value（要等 compositionend
      // 才会），如果不认这是"输入法在确认候选词"，就会被当成"用户按了发送"，
      // 拿着还没接上后半段的半截 value 直接发出去、清空输入框，后半句就跟着
      // 丢了。用 e.isComposing（老版 Android WebView 上没有这个属性，退回看
      // keyCode === 229，是输入法组合期间的通用标记）把这种情况挡在发送之外。
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          const v = input.value;
          input.value = '';
          sendMessage(conv, v);
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
          ${m.isProactive ? `<div class="msg-proactive-tag">✨ ${escapeHtml(character?.name || 'TA')} 主动消息</div>` : ''}
          ${m.thinking ? `
          <button class="msg-thinking-toggle" data-act="toggle-thinking">💭 思考过程${m.thinkingSeconds ? ` · ${m.thinkingSeconds}s` : ''} <span class="chevron">▾</span></button>
          <div class="msg-thinking-body" hidden>${escapeHtml(m.thinking)}</div>` : ''}
          <div class="msg-content">${renderMarkdownish(m.content)}</div>
          <div class="msg-meta">
            <span class="msg-time">${formatTime(m.createdAt)}</span>
          </div>
          <div class="msg-actions">
            <button class="msg-act" data-act="copy" title="复制">复制</button>
            <button class="msg-act ${m.bookmarked ? 'active' : ''}" data-act="bookmark" title="收藏">${m.bookmarked ? '★ 已收藏' : '☆ 收藏'}</button>
            ${!m.archived ? '<button class="msg-act" data-act="edit-content" title="编辑">编辑</button>' : ''}
            ${!m.archived ? '<button class="msg-act" data-act="delete" title="删除">删除</button>' : ''}
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
          // 收藏这个动作特别高频，之前跟别的动作一样走整条消息列表重新渲染——
          // 消息一多，光是收藏一下就要重建全部气泡的 DOM，点哪个按钮都感觉卡。
          // 其实只有这一个按钮自己的文字/高亮状态变了，直接改这一个元素就够。
          await toggleBookmarkMessage(conv, msg);
          await loadMessages();
          btn.textContent = msg.bookmarked ? '★ 已收藏' : '☆ 收藏';
          btn.classList.toggle('active', msg.bookmarked);
        } else if (act === 'edit-content') {
          openMessageEditDialog(msg);
        } else if (act === 'delete') {
          await deleteMessage(conv, msg);
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

  // 直接原地改内容，不牵动这条之后的任何消息（跟"回溯编辑"不一样——那个是
  // 连带后面一起封存、重新走一遍生成流程；这里单纯改错字/改措辞）。
  function openMessageEditDialog(msg) {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>编辑消息</h3>
        <form id="msg-edit-form">
          <label class="field"><textarea name="content" rows="5" required>${escapeHtml(msg.content)}</textarea></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="msg-edit-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#msg-edit-cancel').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('#msg-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = new FormData(e.target).get('content')?.trim();
      if (!content) return;
      msg.content = content;
      await DB.put('messages', msg);
      // 收藏时存的是当时内容的快照，这条消息原文改了之后快照就跟不上了，
      // 标一下 stale（跟对话/消息被删时的处理是同一套逻辑），不动收藏本身。
      const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', state.currentConversationId);
      const match = bookmarks.find((b) => b.messageId === msg.id);
      if (match && match.content !== content) { match.stale = true; await DB.put('bookmarks', match); }
      dialog.remove();
      await loadMessages();
      // 编辑不改这条消息的角色/前后位置，跟收藏一样不需要重建整条消息列表——
      // 只更新这一条气泡自己的正文。
      const contentEl = container.querySelector(`.msg-bubble[data-id="${msg.id}"] .msg-content`);
      if (contentEl) contentEl.innerHTML = renderMarkdownish(msg.content);
    });
  }

  async function deleteMessage(conv, msg) {
    if (!await UIDialog.confirm('删除这条消息？删除后无法恢复。', { danger: true, okLabel: '删除' })) return;
    await DB.delete('messages', msg.id);
    const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', conv.id);
    const match = bookmarks.find((b) => b.messageId === msg.id);
    if (match) { match.stale = true; match.sourceDeleted = true; await DB.put('bookmarks', match); }
    if (window.Memory) await window.Memory.markStaleForMessages(conv.id, [msg.id]);
    await loadMessages();
    render();
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
    // 发一条消息只需要在列表末尾添一条气泡，不用把已经在屏幕上的所有消息
    // 全部拆了重建一遍——对话越长这个开销越明显，"发消息卡""点哪个按钮
    // 都卡"很大一部分就是从这种全量重渲染攒出来的。
    if (!appendMessageRow(userMsg, characterOf(conv))) render();
    await requestAssistantReply(conv);
  }

  // 跟 updateStreamingBubble 是同一个思路：直接插入新的 DOM 节点，不重建
  // 整个列表；只有前一条同发言方的气泡需要把"结尾圆角"样式让给新的这条。
  function appendMessageRow(m, character) {
    const list = container.querySelector('#message-list');
    if (!list) return false;
    list.querySelector('.empty-state')?.remove();
    const bubbles = list.querySelectorAll('.msg-bubble');
    const prevBubble = bubbles[bubbles.length - 1];
    if (prevBubble && prevBubble.closest('.msg-row')?.classList.contains(m.role === 'user' ? 'from-user' : 'from-ai')) {
      prevBubble.classList.remove('is-group-last');
      prevBubble.classList.add('is-group-mid');
    }
    list.insertAdjacentHTML('beforeend', messageBubble(m, true, character));
    const el = list.querySelector(`[data-id="${m.id}"]`);
    bindMessageActions(el, currentConversation());
    list.scrollTop = list.scrollHeight;
    return true;
  }

  // 流式结束、AI 一条长回复拆成好几条气泡定稿的这一下：把 updateStreamingBubble
  // 留在原地的那一条临时气泡，原地换成定稿后的一条或多条正式气泡，不重建
  // 整个消息列表。
  function replaceStreamingBubbleWithFinal(originalId, finalMsgs, character) {
    const list = container.querySelector('#message-list');
    if (!list) return false;
    const oldBubble = list.querySelector(`[data-id="${originalId}"]`);
    const oldRow = oldBubble?.closest('.msg-row');
    if (!oldRow) return false;
    const html = finalMsgs.map((m, i) => messageBubble(m, i === finalMsgs.length - 1, character)).join('');
    oldRow.insertAdjacentHTML('afterend', html);
    oldRow.remove();
    const conv = currentConversation();
    finalMsgs.forEach((m) => {
      const el = list.querySelector(`[data-id="${m.id}"]`);
      if (el) bindMessageActions(el, conv);
    });
    list.scrollTop = list.scrollHeight;
    return true;
  }

  // 只把"停止"按钮换回"发送"，输入框这个 DOM 节点全程不换——用户可能在
  // AI 还没念完的时候就已经提前打字回复了，输入框一旦被整体重建，草稿就
  // 没了，还得重打一遍。
  function syncComposerAfterStreaming(conv) {
    const composer = container.querySelector('.composer');
    const stopBtn = composer?.querySelector('#btn-stop');
    const input = composer?.querySelector('#composer-input');
    if (!composer || !input) return false;
    if (!stopBtn) return true; // 已经是发送按钮，不用换
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn-primary';
    sendBtn.id = 'btn-send';
    sendBtn.textContent = '发送';
    stopBtn.replaceWith(sendBtn);
    sendBtn.addEventListener('click', () => { const v = input.value; input.value = ''; sendMessage(conv, v); });
    // 同上面 #composer-input 首次绑定那处一样，要挡住输入法选字上屏时误触发
    // 的 Enter，不然半截消息被提前发出去、后半段就丢了。
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        sendMessage(conv, v);
      }
    });
    return true;
  }

  // 跟上面反过来——开始生成回复的这一下，只需要把"发送"换成"停止"，之前
  // 这里是无脑一次 render()，把整个消息列表连着重建一遍，只为了换一个按钮。
  // 消息列表本身根本不需要动：updateStreamingBubble() 自己会在第一个 chunk
  // 到达时把占位气泡插进 #message-list，不依赖这次 render() 提前搭好节点。
  // 对话越聊越长，这个白白重建全部气泡的开销就越明显——"聊得越久越卡"
  // 很大一部分就是每发一条消息都要重新跑一遍全部历史消息的 markdown 解析、
  // 转义、头像查找拼出来的。
  function syncComposerToStreaming(conv) {
    const composer = container.querySelector('.composer');
    const sendBtn = composer?.querySelector('#btn-send');
    if (!composer) return false;
    if (!sendBtn) return true; // 已经是停止按钮，不用换
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn-primary btn-stop';
    stopBtn.id = 'btn-stop';
    stopBtn.textContent = '停止';
    sendBtn.replaceWith(stopBtn);
    stopBtn.addEventListener('click', () => { state.abortController?.abort(); });
    return true;
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
    // 这段是背后悄悄总结出来的记忆内容，混进了角色能看到的系统提示词里——
    // 之前真实发生过一次事故：里面塞的内容/措辞比较"指令式"（比如误填了本该
    // 只给总结那次调用看的话），模型就把这当成了一个要执行的任务，在正式
    // 回复里把这段话原样复述了出来，看起来像是"背后的东西泄漏进了聊天"。
    // 不管这段文字本身写了什么，都在标题上加一层不许当真执行/不许逐字复述
    // 的强约束兜底，减少这类事故再发生。
    // 每条记忆本该是"一段总结文字"，正常不会太长——但总结这一步是模型生成的，
    // 没有硬性长度约束，遇到啰嗦的模型、或者总结提示词写得比较宽泛，单条
    // 记忆内容也可能意外写成一整段。之前只限制了"每轮最多注入几条"（默认
    // 6 条），没限制单条能有多长，攒的时间一长，真被这么几条超长记忆撑满，
    // 这个板块本身就能把发给模型的内容拉得又臭又长，拖慢每一轮的响应速度。
    // 这里给单条注入内容也加个字数上限，超出部分截断——完整内容在"长记忆
    // 管理"里还是能看到、编辑，只是塞进这一轮系统提示词的这份要简短。
    const AUTO_MEMORY_MAX_CHARS = 200;
    const autoMemories = window.Memory ? window.Memory.getInjectableMemories(conv, historyMessages) : [];
    // 这一轮实际被塞进摘要里的消息 ID，供调用方决定"这几条原始消息既然已经有
    // 摘要顶着了，这轮就不用再把原文整段重发一遍"——只有真的被注入的那些
    // 摘要覆盖到的消息才算数，不是随便一条"已确认"的记忆就能拿来抵消原文
    // （没被选中注入的记忆，它对应的原文不能删，删了这轮就真的什么都不知道了）。
    const coveredMessageIds = new Set();
    if (autoMemories.length) {
      const prefix = conv.longMemory?.injectionPrompt ? conv.longMemory.injectionPrompt + '\n' : '';
      blocks.push(`【自动长记忆 · 仅供你自己私下参考，绝不能在回复里逐字复述这个板块本身或把它当成一项要执行的任务，只是安静地记在心里，让语气自然一点】\n${prefix}${autoMemories.map((m) => `- ${truncate(m.content, AUTO_MEMORY_MAX_CHARS)}`).join('\n')}`);
      autoMemories.forEach((m) => (m.sourceMessageIds || []).forEach((id) => coveredMessageIds.add(id)));
    }

    if (conv.systemPromptExtra) blocks.push(`【额外系统提示词】\n${conv.systemPromptExtra}`);

    return { systemText: blocks.join('\n\n'), postHistoryText: preset?.data?.postHistoryPrompt || '', coveredMessageIds };
  }

  function sortEntries(entries) {
    entries.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  }
  function entryText(entry) {
    const parts = [entry.content, entry.rules, entry.organization, entry.relationships, entry.historyEvents].filter(Boolean);
    return `- ${entry.title ? entry.title + '：' : ''}${parts.join('；')}`;
  }

  // 把 ai.js 那边混进字符串流里的 <think>…</think> 拆出来：真正在思考的时候
  // （标签还没闭合）content 部分是空的，交给调用方显示"思考中…"这类提示。
  function splitThinking(raw) {
    const closed = raw.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/);
    if (closed) return { thinking: closed[1].trim(), content: closed[2].trim(), stillThinking: false };
    const open = raw.match(/^<think>([\s\S]*)$/);
    if (open) return { thinking: open[1].trim(), content: '', stillThinking: true };
    return { thinking: '', content: raw, stillThinking: false };
  }

  // AI 想一条条发消息，还是一大段，交给它自己的措辞决定：回复里用空行隔开的
  // 每一段，当成一条独立消息处理——不强加规则，AI 不分段就还是一整条。
  function splitIntoSegments(text) {
    return text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  }

  // 一次回复拆成好几条消息时，用这个让它们的 createdAt 依次错开几毫秒，保证
  // 排序/分组稳定，同时几乎不影响时间显示。
  function addMillis(iso, ms) {
    return new Date(new Date(iso).getTime() + ms).toISOString();
  }

  // 发给 API 的历史消息里不能有连续同角色的两条（Anthropic 等协议要求严格轮流）——
  // 一条 AI 回复在本地拆成好几条气泡存库后，这里要把它们合并回一条再喂给模型。
  function mergeConsecutiveRoles(history) {
    const merged = [];
    for (const m of history) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + m.content;
      else merged.push({ role: m.role, content: m.content });
    }
    return merged;
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

    const fullHistory = visibleMessages();
    const { systemText, postHistoryText, coveredMessageIds } = buildContext(conv, fullHistory);
    // 长记忆摘要一直是"额外加"进上下文，从来没把已经被总结过的原始消息从
    // 发给 AI 的内容里减掉——聊得越久，每次请求带的历史就越长，token 花费
    // 和等回复的时间都会跟着无限往上涨，聊得足够久甚至会超出模型自己的
    // 上下文上限。这轮真正被注入的摘要覆盖到哪些原始消息，就把这些消息从
    // 这次发送的历史里去掉（本地聊天记录本身不受影响，还是看得到）；最近
    // 这些消息保留原文一直不裁，保证即时语境不会完全只靠一段压缩过的摘要。
    const KEEP_RECENT_RAW = 8;
    let history = coveredMessageIds && coveredMessageIds.size
      ? fullHistory.filter((m, i) => i >= fullHistory.length - KEEP_RECENT_RAW || !coveredMessageIds.has(m.id))
      : fullHistory;
    // 上面这层裁剪只在"长记忆确实总结覆盖到了这些消息"时才生效——没开长记忆、
    // 或者还没攒够触发总结的条数时，一条都不会被裁，等于每一轮都把从这段
    // 对话第一句话开始的全部历史原文带给模型。对话越聊越久，这份历史就
    // 越长，模型要先读完这么长的输入才能开始说话，"思考"时间跟着一起变长，
    // 输入 token 花费也跟着涨——这才是真正的瓶颈，不是前端卡顿。这里再加
    // 一道无条件的硬上限，不管长记忆开没开、覆盖没覆盖，单轮最多只带最近
    // 这么多条原始消息（超出的部分本地聊天记录还在，只是这一轮不再发给
    // 模型），可以在对话设置里调整。
    const maxRawHistory = conv.maxRawHistory ?? 40;
    if (history.length > maxRawHistory) history = history.slice(-maxRawHistory);
    const character = characterOf(conv);

    state.streaming = true;
    state.abortController = new AbortController();
    if (!syncComposerToStreaming(conv)) render();

    const assistantMsg = { id: uuid(), conversationId: conv.id, role: 'assistant', content: '', createdAt: nowISO(), archived: false, bookmarked: false };
    let appended = false;
    let thinkStartAt = null;
    let thinkEndAt = null;

    // streamChat 检测到"这条回复是被 max_tokens 长度上限截断的，不是模型自己
    // 说完的"时，会把结果写进这个对象——for-await-of 拿不到生成器的 return
    // 值，只能靠这种共享对象把信号带出循环，好在结束后给用户补一句说明，而
    // 不是让一句话卡在半中间、看着像故障。
    const streamMeta = {};
    try {
      let stream;
      if (connection.provider === 'anthropic') {
        const msgs = mergeConsecutiveRoles(history);
        const fullSystem = [systemText, postHistoryText].filter(Boolean).join('\n\n');
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal, fullSystem, streamMeta);
      } else if (connection.provider === 'gemini') {
        const msgs = mergeConsecutiveRoles(history);
        const fullSystem = [systemText, postHistoryText].filter(Boolean).join('\n\n');
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal, fullSystem, streamMeta);
      } else {
        const msgs = [
          ...(systemText ? [{ role: 'system', content: systemText }] : []),
          ...mergeConsecutiveRoles(history),
          ...(postHistoryText ? [{ role: 'system', content: postHistoryText }] : []),
        ];
        stream = provider.streamChat(connection, apiKey, msgs, state.abortController.signal, undefined, streamMeta);
      }

      for await (const chunk of stream) {
        assistantMsg.content += chunk;
        if (thinkStartAt === null && assistantMsg.content.includes('<think>')) thinkStartAt = Date.now();
        if (thinkEndAt === null && assistantMsg.content.includes('</think>')) thinkEndAt = Date.now();
        if (!appended) {
          state.messages.push(assistantMsg);
          appended = true;
        }
        updateStreamingBubble(assistantMsg, character);
      }
      if (streamMeta.truncated) {
        assistantMsg.content += '\n\n（这条回复被"最大回复长度"限制截断了，没说完——可以去对话设置的连接里调大这个数值）';
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
      let finalMsgs = null;
      if (appended && assistantMsg.content) {
        // 拆出思考过程；标签万一没闭合（生成被打断之类），别把内容藏没了，
        // 退回成普通正文照常显示。
        let { thinking, content, stillThinking } = splitThinking(assistantMsg.content);
        if (stillThinking) { content = thinking; thinking = ''; }
        const thinkingSeconds = (thinking && thinkStartAt && thinkEndAt) ? Math.round((thinkEndAt - thinkStartAt) / 100) / 10 : null;

        const segments = splitIntoSegments(content);
        finalMsgs = (segments.length > 1 ? segments : [content]).map((seg, i) => ({
          id: i === 0 ? assistantMsg.id : uuid(),
          conversationId: conv.id,
          role: 'assistant',
          content: seg,
          createdAt: addMillis(assistantMsg.createdAt, i * 5),
          archived: false,
          bookmarked: false,
          thinking: i === 0 ? thinking : '',
          thinkingSeconds: i === 0 ? thinkingSeconds : null,
        }));

        const idx = state.messages.indexOf(assistantMsg);
        if (idx !== -1) state.messages.splice(idx, 1, ...finalMsgs);
        for (const m of finalMsgs) await DB.put('messages', m);

        conv.updatedAt = nowISO();
        conv.lastMessagePreview = finalMsgs[finalMsgs.length - 1].content.slice(0, 40);
        await DB.put('conversations', conv);
        await refreshConversations();
        if (window.Memory) await window.Memory.maybeAutoSummarize(conv);
      }
      // 之前这里也是无脑一次 render()，把整个聊天室（包括输入框）连着重建
      // 一遍——AI 回复念完、拆成一条条气泡的这一下，正好是用户最容易已经
      // 提前开始打字回复的时机（看着长文字念完就想接话了），输入框一旦被
      // 整个换成新的空框，刚打的字全跟着旧框一起消失，还得重打。改成只
      // 换消息本身、只把"停止"按钮换回"发送"，输入框这个 DOM 节点全程
      // 不重建，用户的草稿不会被打断。只有找不到房间容器（比如已经切走）
      // 时才退回整体重渲染。
      const replaced = finalMsgs ? replaceStreamingBubbleWithFinal(assistantMsg.id, finalMsgs, character) : true;
      const composerSynced = syncComposerAfterStreaming(conv);
      if (!replaced || !composerSynced) render();
    }
    return assistantMsg;
  }

  // 流式过程中 msg.content 是原始缓冲区，可能正卡在 <think> 标签中间——跟存库后
  // 的"已拆好 thinking/content"两码事，所以这里单独解析显示，不复用 messageBubble
  // 那套（那套假定 m.content/m.thinking 已经是最终拆好的）。
  function streamingDisplayHtml(rawContent) {
    const { thinking, content, stillThinking } = splitThinking(rawContent);
    if (stillThinking) return `<span class="msg-thinking-live">💭 思考中…</span>`;
    let html = '';
    if (thinking) {
      html += `<button class="msg-thinking-toggle" data-act="toggle-thinking">💭 思考过程 <span class="chevron">▾</span></button><div class="msg-thinking-body" hidden>${escapeHtml(thinking)}</div>`;
    }
    html += renderMarkdownish(content);
    return html;
  }

  function updateStreamingBubble(msg, character) {
    const list = container.querySelector('#message-list');
    if (!list) return;
    let el = list.querySelector(`[data-id="${msg.id}"]`);
    if (!el) {
      const placeholder = { ...msg, content: '', thinking: '' };
      list.insertAdjacentHTML('beforeend', messageBubble(placeholder, true, character));
      el = list.querySelector(`[data-id="${msg.id}"]`);
    }
    el.querySelector('.msg-content').innerHTML = streamingDisplayHtml(msg.content);
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

        <fieldset class="fieldset"><legend>上下文</legend>
          <label class="field"><span>单轮最多携带的原始聊天记录条数</span><input type="number" name="maxRawHistory" value="${conv.maxRawHistory ?? 40}" min="4"></label>
          <p class="section-hint">每次发消息，聊天记录不会无限往前带——超过这个条数的更早消息这一轮就不会发给 AI（本地记录不受影响，还是看得到），避免聊得越久、每次都要处理的内容越多、越慢越贵。想让更早的内容还能影响回复，去下面开启"独立长记忆"，让它总结进去。</p>
        </fieldset>

        <fieldset class="fieldset"><legend>独立长记忆（第8部分）</legend>
          <label class="field-inline"><input type="checkbox" name="lmEnabled" ${lm.enabled ? 'checked' : ''}><span>启用自动总结长记忆</span></label>
          <label class="field"><span>总结连接（不选则用聊天连接）</span><select name="lmSummaryConnectionId"><option value="">（同聊天连接）</option>${summaryConnOptions}</select></label>
          <label class="field"><span>每 N 条消息自动总结一次（0 为关闭）</span><input type="number" name="lmEveryN" value="${lm.summarizeEveryN || 0}" min="0"></label>
          <label class="field"><span>最大记忆条数</span><input type="number" name="lmMaxCount" value="${lm.maxCount || 200}" min="1"></label>
          <label class="field"><span>注入上限（每轮最多注入几条）</span><input type="number" name="lmInjectionCap" value="${lm.injectionCap ?? 6}" min="0"></label>
          <label class="field"><span>总结提示词</span><textarea name="lmSummaryPrompt" rows="2" placeholder="例如：多关注情绪变化和约定">${escapeHtml(lm.summaryPrompt || '')}</textarea></label>
          <p class="section-hint">这段只用在"背后总结成 JSON 记忆"那一次单独调用里，角色看不到、不会出现在聊天中。</p>
          <label class="field"><span>注入提示词</span><textarea name="lmInjectionPrompt" rows="2" placeholder="例如：以下是你们之间的重要记忆，自然地记在心里，不要生硬提起">${escapeHtml(lm.injectionPrompt || '')}</textarea></label>
          <p class="section-hint">⚠️ 这段会跟着记忆内容一起塞进每轮正常聊天的系统提示词，角色会当真看到——写"总结成 JSON"这类格式要求放到这里，角色会把这当成任务去执行，在聊天里复述格式说明（不是 bug，是填错了地方）。</p>
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
        // summarizeNow() 抛出来的错误信息本身已经是完整的中文句子（"总结失败：
        // ……"/"还没有配置连接"这种），这里不再重复加一遍"总结失败："前缀，
        // 不然会变成"总结失败：总结失败：……"这种重复的怪话。
        await UIDialog.alert(err.message || String(err));
      }
    });
    dialog.querySelector('#btn-open-memories').addEventListener('click', () => {
      if (window.Memory) window.Memory.openManager(conv);
    });
    dialog.querySelector('#btn-delete-conv').addEventListener('click', async () => {
      if (!await UIDialog.confirm('删除这段对话及其全部消息？此操作不可撤销（收藏内容会保留但会标记为来源已删除）。', { danger: true, okLabel: '删除' })) return;
      await deleteConversationData(conv.id);
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
      conv.maxRawHistory = Number(fd.get('maxRawHistory')) || 40;
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
    init, refreshConnections, characterOf, buildContext, splitThinking,
    get state() { return state; },
    requestAssistantReply,
    async refreshList() { await refreshConversations(); if (state.view === 'list') render(); },
    // 角色的主动消息是后台定时检查触发的，跟用户当下在干什么完全无关——
    // 用户很可能正在往输入框里打一大段字，这时候一条主动消息冒出来，之前
    // 无脑一次 render() 会把整个聊天室（包括输入框）连着重建一遍，正在打的
    // 字全跟着消失，一点预兆都没有。这里改成跟"AI 回复念完定稿"那次修复
    // 同一个思路：能只插入新气泡就只插入，不重建输入框；万一走到非走 render()
    // 不可的分支（比如手动审核模式下要弹出"待发送草稿"这个提示条，这个不在
    // messages 表里，只能整页重渲染才会出现），也要先把输入框里的草稿和光标
    // 位置存一下，重渲染完了再原样塞回去，用户完全无感。
    async reloadIfCurrent(conversationId) {
      if (state.currentConversationId !== conversationId) return;
      const prevIds = new Set(state.messages.map((m) => m.id));
      await loadMessages();
      if (state.view !== 'room') { render(); return; }

      const composerBefore = container.querySelector('#composer-input');
      const draftText = composerBefore ? composerBefore.value : null;
      const selStart = composerBefore ? composerBefore.selectionStart : null;
      const selEnd = composerBefore ? composerBefore.selectionEnd : null;

      const conv = currentConversation();
      const character = characterOf(conv);
      const newMsgs = visibleMessages().filter((m) => !prevIds.has(m.id));
      const hasDraftBanner = !!window.Proactive?.getPendingDraft(conversationId);
      if (newMsgs.length > 0 && !hasDraftBanner) {
        const ok = newMsgs.every((m) => appendMessageRow(m, character));
        if (ok) return; // 全部走 DOM 局部插入成功，输入框这个节点根本没被动过
      }

      render();
      if (draftText != null) {
        const composerAfter = container.querySelector('#composer-input');
        if (composerAfter) {
          composerAfter.value = draftText;
          if (selStart != null) composerAfter.setSelectionRange(selStart, selEnd);
        }
      }
    },
    async refreshAvatars() { await refreshAvatarUrls(); render(); },
  };
})();
window.Chat = Chat;

function emptyState(title, sub) {
  return `<div class="empty-state"><div class="empty-title">${escapeHtml(title)}</div><div class="empty-sub">${escapeHtml(sub)}</div></div>`;
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
