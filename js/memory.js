// 第8部分：独立长记忆。允许聊天模型和总结模型使用不同连接，按 N 条自动总结或手动总结，
// 只提取稳定偏好/重要信息/重要事件/关系变化/约定和禁忌，不编造；用户可查看/编辑/合并/确认/停用/删除。
const Memory = (() => {
  let cache = [];

  // 提取总结模型回复里的第一个完整 JSON 对象。之前用的是贪婪正则 /\{[\s\S]*\}/，
  // 从第一个 { 一路吃到最后一个 } ——只要回复里在 JSON 前后多说了几句话、或者
  // 用 ```json 代码块包了一层，稍微复杂一点的情况就容易连带把无关文字也吞
  // 进去，解析直接失败。改成从第一个 { 开始数括号配对，配对上就截止，不管
  // 前后多了什么大白话或者代码块标记都不受影响。
  function extractFirstJsonObject(text) {
    const stripped = text.replace(/```(?:json)?/gi, '').trim();
    const start = stripped.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') {
        depth--;
        if (depth === 0) return stripped.slice(start, i + 1);
      }
    }
    return null;
  }

  async function refresh(conversationId) {
    cache = conversationId ? await DB.getAllByIndex('ai_memories', 'conversationId', conversationId) : await DB.getAll('ai_memories');
    await quarantineGarbledMemories();
  }

  // summarizeNow() 现在生成的那一步已经堵住了"模型没听话就把原始输出整段
  // 存成记忆内容"这个口子，但堵不住已经存在库里的旧记录——那些记录很可能
  // 已经被点过"批准"，会一直被注入到之后的对话里，光关掉"自动总结"这个开关
  // 并不会让这些已经存在的旧记录停止生效，用户只能自己一条条去长记忆管理里
  // 翻出来删，体验很差。这里补一次数据层面的自检，两种"看着不像真记忆"的
  // 情况都算：
  // 1. 内容本身就是没解析过的原始 JSON（带着 content/keywords/object 这三个
  //    字段名，形如 "content":"..." 这种语法）。
  // 2. 内容是模型对着"怎么总结成 JSON"这个任务本身自言自语的思考过程（不是
  //    严格的 JSON 语法，是大白话，比如 DeepSeek 这类模型常见的英文思考链：
  //    "We need parse the long conversation... produce JSON... content/
  //    keywords/object"）——这种一眼看不出是"没解析过的 JSON"，但一段真正
  //    描述用户/关系的记忆内容，正常情况下不会需要提到"JSON"这个词，出现
  //    就基本可以断定是任务思考过程混进来了，不是真记忆。
  function looksLikeUnparsedJson(content) {
    return typeof content === 'string' &&
      /"content"\s*:/.test(content) && /"keywords"\s*:/.test(content) && /"object"\s*:/.test(content);
  }
  function looksLikeTaskReasoning(content) {
    return typeof content === 'string' && /\bJSON\b/.test(content);
  }
  // 前两种检测抓的是"语法上还没解析成功的 JSON"和"内容里直接提到 JSON 这个词"，
  // 但还有第三种更隐蔽的泄漏：语法完全正常、也不提 JSON，但整段其实是模型在对着
  // "这次总结任务该怎么写"自说自话——比如"要用总结性段落呈现而不是列表""不需要
  // 提稳定偏好这个标签""要确保涵盖这些维度"。这些话原本是说给总结模型自己听的
  // 格式要求，不是真的在描述用户/两人关系。这类文本的共同点是：会照抄或改写发给
  // 总结模型的指令原文（下面这些词组本身就摘自 summarizeNow() 里的 instruction
  // 常量）。一段真正描述用户的记忆，正常不会同时命中两个以上这种指令用词。
  const INSTRUCTION_ECHO_PHRASES = [
    '稳定偏好', '重要信息', '重要事件', '关系变化', '约定和禁忌', '不要编造',
    '只回复 JSON', '只回复JSON', '不要加任何解释', '开场白', '总结性段落',
    '不是列表', '涵盖这些维度', '只基于对话', '这段总结', '总结文字',
  ];
  function looksLikeInstructionEcho(content) {
    if (typeof content !== 'string') return false;
    return INSTRUCTION_ECHO_PHRASES.filter((p) => content.includes(p)).length >= 2;
  }
  function looksLikeLeakedMemory(content) {
    return looksLikeUnparsedJson(content) || looksLikeTaskReasoning(content) || looksLikeInstructionEcho(content);
  }
  async function quarantineGarbledMemories() {
    const bad = cache.filter((m) => !m.stale && looksLikeLeakedMemory(m.content));
    for (const m of bad) {
      m.stale = true;
      await DB.put('ai_memories', m);
    }
  }

  function getInjectableMemories(conv, recentMessages) {
    const cap = conv.longMemory?.injectionCap ?? 6;
    if (!cap) return [];
    // quarantineGarbledMemories() 只在 refresh() 触发的那几个时间点（打开对话、
    // 主动消息检查、总结成功之后）扫一遍——如果正好是在同一个长时间开着没
    // 关过的对话里，中间产生的坏记录会有一段时间没被扫到，靠"事后清理"接不
    // 住这个时间差。这里在真正拿去注入的这一刻再兜底判断一次，不管上一次
    // 清理是什么时候跑的，坏内容永远不会真的被喂给角色。
    const pool = cache.filter((m) => m.conversationId === conv.id && m.userConfirmed && !m.stale &&
      !looksLikeLeakedMemory(m.content));
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
    // 格式指令挪到系统提示词里单独给（而不是跟对话记录混在同一条 user 消息里）——
    // 像 Claude 这类模型，"只回复 JSON"这种硬性格式要求放在系统提示词里遵守
    // 得明显更好，混在一大段 user 消息末尾反而更容易被当成对话内容的一部分，
    // 顺手多聊两句、或者用 ```json 代码块包一层（这两种都会让下面的 JSON 提取
    // 失败）。
    const instruction = (lm.summaryPrompt ? lm.summaryPrompt + '\n' : '') +
      '只提取稳定偏好、重要信息、重要事件、关系变化、约定和禁忌，不要编造没有出现过的内容。' +
      '用 JSON 格式回复，且只回复 JSON 本身：{"content":"一段总结文字","keywords":["关键词1","关键词2"],"object":"这段记忆关于谁/什么"}。' +
      '不要加任何解释、开场白，也不要用 ```json 这样的代码块包裹，直接从 { 开始、到 } 结束。';
    const promptMessages = [{ role: 'user', content: `请总结以下对话记录：\n\n${transcript}` }];
    let raw = '';
    if (connection.provider === 'anthropic' || connection.provider === 'gemini') {
      for await (const chunk of provider.streamChat(connection, apiKey, promptMessages, undefined, instruction)) raw += chunk;
    } else {
      const msgs = [{ role: 'system', content: instruction }, ...promptMessages];
      for await (const chunk of provider.streamChat(connection, apiKey, msgs, undefined)) raw += chunk;
    }
    // 有些模型（尤其带思考链的）不老实按"只回复 JSON"执行，会在前面加一段
    // 大白话的"好的，根据用户提到的事情，我来总结一下……"之类的开场白，甚至
    // 混着 <think> 标签。这段"没听话"的原始文本之前会被 catch 兜底整段存成
    // 记忆内容，下一轮又被塞回聊天的系统提示词里——角色看到这段"记忆"里写着
    // 一段很像指令的大白话，会把它当成真事复述出来，这正是"记忆内容突然
    // 冒进聊天里"的源头。现在解析失败就直接放弃这次总结，不生成半成品记忆，
    // 从源头掐断这条泄漏链路。
    const { content: withoutThinking } = Chat.splitThinking(raw.trim());
    const jsonText = extractFirstJsonObject(withoutThinking);

    let parsed;
    try {
      if (!jsonText) throw new Error('模型没有按要求返回 JSON 格式');
      parsed = JSON.parse(jsonText);
    } catch (_) {
      throw new Error('总结失败：这次模型的回复不是有效的 JSON 格式，跳过，不生成记忆（避免半成品混进对话）');
    }
    if (!parsed.content || typeof parsed.content !== 'string') {
      throw new Error('总结失败：返回的 JSON 里没有 content 字段，跳过，不生成记忆');
    }
    // 光校验"这确实是一段合法 JSON"还不够——模型可能老老实实按格式包了一层
    // JSON，但塞进 content 字段里的却是它自己对着"怎么完成这次总结任务"的
    // 思考文字（比如"我们需要输出JSON...任务描述是要提取稳定偏好..."），格式
    // 完全合法，但内容本身就是废的。这种货一旦被批准，会跟真记忆一样被注入
    // 到之后的对话里、被角色照着念出来。用跟"扫描全部对话"清理工具同一套
    // 判断标准，在生成这一步就先拦一次，不等它混进数据库里再靠事后扫描。
    if (looksLikeLeakedMemory(parsed.content)) {
      throw new Error('总结失败：这次生成的内容看着像是模型在思考"怎么完成总结任务"本身，不是真正的总结，跳过，不生成记忆');
    }

    const record = {
      id: uuid(),
      conversationId: conv.id,
      content: parsed.content,
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

  // 之前是浮层弹窗，"关闭"按钮跟列表内容挤在同一个可滚动区域里——记忆条数一多，
  // 关闭按钮被挤到最底下，每次想关都得先滑到底。改用 Pages 那套抽屉容器：
  // 标题栏（含返回/关闭箭头）单独固定在顶部，不在滚动区域里，列表再长也不影响关闭。
  function openManager(conv) {
    const page = Pages.open(`长记忆管理 · ${escapeHtml(conv.title)}`, `<div id="mem-list"></div>`);
    renderMemoryList(page, conv);
  }

  async function renderMemoryList(dialog, conv) {
    const rows = (await DB.getAllByIndex('ai_memories', 'conversationId', conv.id)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    const listEl = dialog.querySelector('#mem-list');
    listEl.innerHTML = rows.length === 0 ? '<div class="empty-sub">还没有自动总结的长记忆</div>' : rows.map(memRow).join('');
    listEl.querySelectorAll('.mem-review-card').forEach((el) => {
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

  // 待确认的长记忆用一枚蜡封图标强调——AI 悄悄总结出来的东西，过一眼再点开才真正生效，
  // 而不是默默存下就直接被拿去用。已确认的换成一个简单的对勾徽章，视觉上一眼区分开。
  function waxSeal() {
    return `
      <svg class="wax-seal-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9.2" fill="currentColor" stroke="none" opacity="0.14"/>
        <circle cx="12" cy="12" r="9.2"/>
        <path d="M12,5.4 L13.4,9.6 L17.8,9.6 L14.2,12.1 L15.6,16.3 L12,13.8 L8.4,16.3 L9.8,12.1 L6.2,9.6 L10.6,9.6 Z" fill="currentColor" stroke="none"/>
      </svg>
    `;
  }

  function memRow(m) {
    const pending = !m.userConfirmed;
    return `
      <div class="mem-review-card ${pending ? 'is-pending' : ''} ${m.stale ? 'is-stale' : ''}" data-id="${m.id}">
        <div class="mem-review-top">
          <span class="mem-review-badge ${pending ? 'is-pending' : 'is-confirmed'}" title="${pending ? '待审核' : '已确认'}">
            ${pending ? waxSeal() : '✓'}
            <span>${pending ? '待审核' : '已确认'}</span>
          </span>
          ${m.stale ? '<span class="tag">已停用</span>' : ''}
          <span class="bm-time">${formatRelativeTime(m.generatedAt)}</span>
        </div>
        <div class="bm-content">${escapeHtml(m.content)}</div>
        ${m.keywords?.length ? `<div class="bm-tags">${m.keywords.map((k) => `<span class="tag">#${escapeHtml(k)}</span>`).join('')}</div>` : ''}
        <div class="bm-card-actions">
          ${pending ? '<button class="btn-primary btn-sm" data-act="confirm">批准</button>' : ''}
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

  return { refresh, getInjectableMemories, markStaleForMessages, maybeAutoSummarize, summarizeNow, openManager, looksLikeLeakedMemory };
})();
window.Memory = Memory;
