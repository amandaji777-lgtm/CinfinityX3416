// 第9部分：角色主动消息，手机端真实实现（能力分级：纯 PWA 无后台，只在打开/回到前台/
// 保持打开期间定时检查时生成，不伪造后台推送）。随机检查 + 条件评分 + 冷却保护，不用固定频率。
// 禁止内疚/威胁/操纵用户回应。
const Proactive = (() => {
  let logCache = [];
  let checking = false;

  async function refresh() {
    logCache = await DB.getAll('proactive_log');
  }

  function getPendingDraft(conversationId) {
    return logCache
      .filter((l) => l.conversationId === conversationId && l.status === 'draft')
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))[0] || null;
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function inQuietHours(quietStart, quietEnd) {
    if (!quietStart || !quietEnd) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = quietStart.split(':').map(Number);
    const [eh, em] = quietEnd.split(':').map(Number);
    const start = sh * 60 + sm, end = eh * 60 + em;
    if (start === end) return false;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end; // 跨零点
  }

  async function checkAll() {
    if (checking) return;
    if (!navigator.onLine) return;
    const settings = await loadGlobalToggle();
    if (!settings.aiEnabled || !settings.proactiveMessagesEnabled) return;
    checking = true;
    try {
      const conversations = await DB.getAll('conversations');
      for (const conv of conversations) {
        try {
          await checkOne(conv);
        } catch (_) { /* 单个对话检查失败不影响其他对话 */ }
      }
    } finally {
      checking = false;
    }
  }

  async function loadGlobalToggle() {
    const aiEnabled = await DB.getSetting('aiEnabled', true);
    const proactiveMessagesEnabled = await DB.getSetting('proactiveMessagesEnabled', false);
    return { aiEnabled, proactiveMessagesEnabled };
  }

  async function checkOne(conv) {
    const pr = conv.proactive;
    if (!pr || pr.mode === 'off' || pr.paused) return;
    if (!conv.connectionId || !conv.characterResourceId) return; // 角色主动消息依赖角色卡与连接
    if (inQuietHours(pr.quietStart, pr.quietEnd)) return;

    const now = Date.now();
    if (pr.lastTriggeredAt) {
      const minutesSince = (now - new Date(pr.lastTriggeredAt).getTime()) / 60000;
      if (minutesSince < (pr.minCooldownMinutes ?? 120)) return;
    }
    const today = todayStr();
    const dailyCount = pr.dailyCountDate === today ? (pr.dailyCount || 0) : 0;
    if (dailyCount >= (pr.dailyCap ?? 3)) return;

    if (getPendingDraft(conv.id)) return; // 已经有一条草稿在等待确认，先不再生成新的

    const score = await scoreConversation(conv);
    // 随机检查 + 条件评分：分数越高越容易触发，但始终带一点随机性，不使用固定机械频率。
    if (Math.random() * 100 >= score) return;

    await trigger(conv, dailyCount, today, score);
  }

  async function scoreConversation(conv) {
    const messages = await DB.getAllByIndex('messages', 'conversationId', conv.id);
    const visible = messages.filter((m) => !m.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = visible[visible.length - 1];
    const idleHours = last ? (Date.now() - new Date(last.createdAt).getTime()) / 3600000 : 999;
    const bookmarks = await DB.getAllByIndex('bookmarks', 'conversationId', conv.id);
    const idleScore = Math.min(idleHours, 48) * 1.5;
    const openLoopScore = last && last.role === 'user' ? 15 : 0; // 用户说了话但没有等到合适的回应节奏，视为"未完话题"倾向
    const engagementScore = Math.min(bookmarks.length, 10) * 2;
    const jitter = Math.random() * 15;
    return Math.min(100, idleScore + openLoopScore + engagementScore + jitter);
  }

  async function trigger(conv, dailyCount, today, score) {
    const connections = await DB.getAll('connections');
    const connection = connections.find((c) => c.id === conv.connectionId);
    if (!connection) return;
    const provider = Providers[connection.provider];
    const apiKey = connection.apiKeyCipher ? await CryptoUtils.decryptText(connection.apiKeyCipher, connection.apiKeyIv) : '';

    const messages = await DB.getAllByIndex('messages', 'conversationId', conv.id);
    const visible = messages.filter((m) => !m.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    await Resources.refresh();
    if (window.Memory) await window.Memory.refresh(conv.id);
    const { systemText } = Chat.buildContext(conv, visible);
    const instruction = '现在请你主动开口，生成一句符合你人设、你此刻想对用户说的话（不是在回复用户的上一条消息，是你自己想说的）。' +
      '语气自然、简短，不要说教，不要制造愧疚、威胁或道德绑架来让对方必须回应。只输出这一句话本身，不要加任何解释或标签。';
    const promptMessages = [{ role: 'user', content: instruction }];

    let content = '';
    try {
      if (connection.provider === 'anthropic' || connection.provider === 'gemini') {
        for await (const chunk of provider.streamChat(connection, apiKey, promptMessages, undefined, systemText)) content += chunk;
      } else {
        const msgs = [{ role: 'system', content: systemText }, ...promptMessages];
        for await (const chunk of provider.streamChat(connection, apiKey, msgs, undefined)) content += chunk;
      }
    } catch (_) {
      return; // 生成失败就静默放弃这一次，不打扰用户
    }
    content = content.trim();
    if (!content) return;

    const now = nowISO();
    const logEntry = {
      id: uuid(),
      conversationId: conv.id,
      triggeredAt: now,
      reason: `分数 ${score.toFixed(0)}/100`,
      connectionId: connection.id,
      content,
      mode: conv.proactive.mode,
      status: conv.proactive.mode === 'auto' ? 'auto-sent' : 'draft',
    };
    await DB.put('proactive_log', logEntry);

    if (conv.proactive.mode === 'auto') {
      await DB.put('messages', {
        id: uuid(), conversationId: conv.id, role: 'assistant', content, createdAt: now,
        archived: false, bookmarked: false, isProactive: true,
      });
      conv.updatedAt = now;
      conv.lastMessagePreview = content.slice(0, 40);
      await DB.put('conversations', { ...conv, proactive: { ...conv.proactive, lastTriggeredAt: now, dailyCount: dailyCount + 1, dailyCountDate: today } });
    } else {
      conv.proactive = { ...conv.proactive, lastTriggeredAt: now, dailyCount: dailyCount + 1, dailyCountDate: today };
      await DB.put('conversations', conv);
    }
    await refresh();
    if (Chat.refreshList) await Chat.refreshList();
    if (Chat.reloadIfCurrent) await Chat.reloadIfCurrent(conv.id);
  }

  async function sendDraft(logId) {
    const log = logCache.find((l) => l.id === logId) || await DB.get('proactive_log', logId);
    if (!log || log.status !== 'draft') return;
    const now = nowISO();
    await DB.put('messages', {
      id: uuid(), conversationId: log.conversationId, role: 'assistant', content: log.content, createdAt: now,
      archived: false, bookmarked: false, isProactive: true,
    });
    const conv = await DB.get('conversations', log.conversationId);
    if (conv) {
      conv.updatedAt = now;
      conv.lastMessagePreview = log.content.slice(0, 40);
      await DB.put('conversations', conv);
    }
    log.status = 'sent';
    await DB.put('proactive_log', log);
    await refresh();
    if (Chat.refreshList) await Chat.refreshList();
  }

  async function discardDraft(logId) {
    const log = logCache.find((l) => l.id === logId) || await DB.get('proactive_log', logId);
    if (!log) return;
    log.status = 'discarded';
    await DB.put('proactive_log', log);
    await refresh();
    if (Chat.refreshList) await Chat.refreshList();
  }

  return { refresh, checkAll, getPendingDraft, sendDraft, discardDraft };
})();
window.Proactive = Proactive;
