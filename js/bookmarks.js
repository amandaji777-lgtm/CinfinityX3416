// 记忆收藏：收藏对话里的一条消息，或者自己新建一段文字收藏。
const Bookmarks = (() => {
  let container;
  let all = [];
  let query = '';
  let filterType = 'all'; // all | message | custom

  async function init(rootEl) {
    container = rootEl;
    await refresh();
    render();
  }

  async function refresh() {
    all = await DB.getAll('bookmarks');
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  function filtered() {
    return all.filter((b) => {
      if (filterType !== 'all' && b.type !== filterType) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (b.title || '').toLowerCase().includes(q) ||
        (b.content || '').toLowerCase().includes(q) ||
        (b.tags || []).some((t) => t.toLowerCase().includes(q));
    });
  }

  function render() {
    const list = filtered();
    container.innerHTML = `
      <div class="bookmarks-view">
        <div class="view-header">
          <h2>记忆收藏</h2>
          <button class="btn-icon" id="btn-add-bookmark" title="新建收藏">＋</button>
        </div>
        <div class="bm-toolbar">
          <input id="bm-search" placeholder="搜索标题 / 内容 / 标签" value="${escapeAttr(query)}">
          <select id="bm-filter">
            <option value="all" ${filterType === 'all' ? 'selected' : ''}>全部</option>
            <option value="message" ${filterType === 'message' ? 'selected' : ''}>来自对话</option>
            <option value="custom" ${filterType === 'custom' ? 'selected' : ''}>自定义</option>
          </select>
        </div>
        <div class="bm-list">
          ${list.length === 0 ? emptyState('还没有收藏', '点右上角 ＋ 新建，或在对话里收藏一条消息') : list.map(bookmarkCard).join('')}
        </div>
      </div>
    `;
    container.querySelector('#btn-add-bookmark').addEventListener('click', () => openEditor(null));
    container.querySelector('#bm-search').addEventListener('input', (e) => { query = e.target.value; render(); });
    container.querySelector('#bm-filter').addEventListener('change', (e) => { filterType = e.target.value; render(); });
    container.querySelectorAll('.bm-card').forEach((el) => {
      const id = el.dataset.id;
      const item = all.find((b) => b.id === id);
      el.querySelector('[data-act="edit"]')?.addEventListener('click', () => openEditor(item));
      el.querySelector('[data-act="delete"]')?.addEventListener('click', () => removeBookmark(item));
      el.querySelector('[data-act="jump"]')?.addEventListener('click', () => jumpToSource(item));
    });
  }

  function bookmarkCard(b) {
    const isCustom = b.type === 'custom';
    return `
      <div class="bm-card ${b.stale ? 'is-stale' : ''}" data-id="${b.id}">
        <div class="bm-card-top">
          <span class="bm-type-tag">${isCustom ? '自定义' : '对话摘录'}</span>
          ${b.title ? `<span class="bm-title">${escapeHtml(b.title)}</span>` : ''}
        </div>
        <div class="bm-content">${escapeHtml(truncate(b.content, 160))}</div>
        ${b.tags && b.tags.length ? `<div class="bm-tags">${b.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${b.stale ? '<div class="bm-stale-note">原始对话已修改或删除，这里保留的是收藏时的快照</div>' : ''}
        <div class="bm-card-actions">
          <span class="bm-time">${formatRelativeTime(b.createdAt)}</span>
          ${!isCustom && !b.stale ? '<button class="msg-act" data-act="jump">跳转原消息</button>' : ''}
          <button class="msg-act" data-act="edit">编辑</button>
          <button class="msg-act" data-act="delete">删除</button>
        </div>
      </div>
    `;
  }

  function openEditor(item) {
    const isNew = !item;
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${isNew ? '新建收藏' : '编辑收藏'}</h3>
        <form id="bm-form">
          <label class="field"><span>标题（可选）</span><input name="title" maxlength="30" value="${escapeAttr(item?.title || '')}"></label>
          <label class="field"><span>内容</span><textarea name="content" rows="5" required>${escapeHtml(item?.content || '')}</textarea></label>
          <label class="field"><span>标签（用空格或逗号分隔）</span><input name="tags" value="${escapeAttr((item?.tags || []).join(', '))}"></label>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="bm-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#bm-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#bm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tags = String(fd.get('tags') || '').split(/[,，\s]+/).filter(Boolean);
      if (isNew) {
        await DB.put('bookmarks', {
          id: uuid(),
          type: 'custom',
          title: fd.get('title')?.trim() || '',
          content: fd.get('content')?.trim() || '',
          tags,
          stale: false,
          createdAt: nowISO(),
        });
      } else {
        item.title = fd.get('title')?.trim() || '';
        item.content = fd.get('content')?.trim() || '';
        item.tags = tags;
        await DB.put('bookmarks', item);
      }
      dialog.remove();
      await refresh();
      render();
    });
  }

  async function removeBookmark(item) {
    if (!await UIDialog.confirm('删除这条收藏？', { danger: true, okLabel: '删除' })) return;
    await DB.delete('bookmarks', item.id);
    if (item.type === 'message' && item.messageId) {
      const msg = await DB.get('messages', item.messageId);
      if (msg) { msg.bookmarked = false; await DB.put('messages', msg); }
    }
    await refresh();
    render();
  }

  function jumpToSource(item) {
    if (window.App?.goToChat) window.App.goToChat(item.conversationId, item.messageId);
  }

  return { init, refresh };
})();

function truncate(s, n) {
  s = s || '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
