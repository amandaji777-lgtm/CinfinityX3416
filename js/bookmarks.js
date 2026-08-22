// 记忆收藏：收藏对话里的一条消息，或者自己新建一段文字收藏，可以配一张照片。
const Bookmarks = (() => {
  let container;
  let all = [];
  let query = '';
  let filterType = 'all'; // all | message | custom
  let viewMode = 'list'; // list | sky
  const SKY_MIN_SLOTS = 42; // 星星太少会显得空，没记录的位置补成空心占位星
  const photoUrls = new Map(); // bookmark id -> object URL，每次 render() 前统一 revoke 再按需重建
  let photoObserver = null;

  // 照片降采样：手机相机原图动辄 10MB+，直接存 IndexedDB 存几十张就很吃内存/容易卡顿，
  // 上传时先压到长边 900px、转 JPEG 存起来（通常几十到一百多 KB）。
  function resizeImageFile(file, maxDim = 900, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片处理失败')), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

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

  function revokePhotoUrls() {
    if (photoObserver) { photoObserver.disconnect(); photoObserver = null; }
    photoUrls.forEach((url) => URL.revokeObjectURL(url));
    photoUrls.clear();
  }

  function render() {
    revokePhotoUrls(); // 上一轮渲染创建的图片预览 URL 先全部释放，避免每次搜索/筛选都叠加泄漏
    const list = filtered();
    container.innerHTML = `
      <div class="bookmarks-view">
        <div class="view-header">
          <h2>记忆收藏</h2>
          <div class="view-header-actions">
            <div class="bm-view-toggle">
              <button type="button" class="bm-view-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" title="列表">☰</button>
              <button type="button" class="bm-view-btn ${viewMode === 'sky' ? 'active' : ''}" data-view="sky" title="星空">✦</button>
            </div>
            <button class="btn-icon" id="btn-add-bookmark" title="新建收藏">＋</button>
          </div>
        </div>
        ${viewMode === 'sky' ? renderSky() : renderList(list)}
      </div>
    `;
    container.querySelector('#btn-add-bookmark').addEventListener('click', () => openEditor(null));
    container.querySelectorAll('.bm-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => { viewMode = btn.dataset.view; render(); });
    });
    if (viewMode === 'sky') {
      bindSkyEvents();
    } else {
      container.querySelector('#bm-search').addEventListener('input', (e) => { query = e.target.value; render(); });
      container.querySelector('#bm-filter').addEventListener('change', (e) => { filterType = e.target.value; render(); });
      container.querySelectorAll('.bm-card').forEach((el) => {
        const id = el.dataset.id;
        const item = all.find((b) => b.id === id);
        el.querySelector('[data-act="edit"]')?.addEventListener('click', () => openEditor(item));
        el.querySelector('[data-act="delete"]')?.addEventListener('click', () => removeBookmark(item));
        el.querySelector('[data-act="jump"]')?.addEventListener('click', () => jumpToSource(item));
      });
      setupPhotoLazyLoad();
    }
  }

  function renderList(list) {
    return `
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
    `;
  }

  // 星空视图：每条记忆是一颗星，没记录到的位置是空心占位星（点了直接去新建），
  // 纯 CSS 静态排布，不用 canvas 逐帧重绘——星星本身不会动，只有点击态有反馈，
  // 不会重复"更多"页那种持续动画在真机上拖慢滚动的问题。
  function renderSky() {
    const slotCount = Math.max(SKY_MIN_SLOTS, all.length);
    const stars = Array.from({ length: slotCount }, (_, i) => {
      const item = all[i];
      const jitterClass = `bm-star-j${i % 6}`;
      if (item) {
        return `<button type="button" class="bm-star is-filled ${jitterClass}" data-id="${item.id}" title="${escapeAttr(truncate(item.content, 60))}">${starIcon()}</button>`;
      }
      return `<button type="button" class="bm-star is-empty ${jitterClass}" data-empty="1" title="还没有这条记忆">${starIcon()}</button>`;
    }).join('');
    return `
      <div class="bm-sky-hint">${all.length} 条记忆 · 点亮的星星是你记下的，空心的还等着被填满</div>
      <div class="bm-sky">${stars}</div>
    `;
  }

  function starIcon() {
    return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12,2.6 L14.3,9.2 L21.4,9.7 L15.9,14.1 L17.7,21 L12,17 L6.3,21 L8.1,14.1 L2.6,9.7 L9.7,9.2 Z"/></svg>`;
  }

  function bindSkyEvents() {
    container.querySelectorAll('.bm-star.is-filled').forEach((el) => {
      const item = all.find((b) => b.id === el.dataset.id);
      el.addEventListener('click', () => openEditor(item));
    });
    container.querySelectorAll('.bm-star.is-empty').forEach((el) => {
      el.addEventListener('click', () => openEditor(null));
    });
  }

  // 照片懒加载：卡片上的照片占位真正滚动进视口才创建预览 URL、插入 <img>，不是一次性
  // 把整页收藏的图全部解码——收藏多了也不会一下子把内存吃满。
  function setupPhotoLazyLoad() {
    const placeholders = container.querySelectorAll('.bm-photo[data-bm-id]');
    if (!placeholders.length) return;
    photoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        photoObserver.unobserve(el);
        const id = el.dataset.bmId;
        const item = all.find((b) => b.id === id);
        const imgBlob = storableToBlob(item?.image);
        if (!imgBlob) return;
        const url = URL.createObjectURL(imgBlob);
        photoUrls.set(id, url);
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('is-loaded');
      });
    }, { rootMargin: '200px 0px' });
    placeholders.forEach((el) => photoObserver.observe(el));
  }

  function bookmarkCard(b) {
    const isCustom = b.type === 'custom';
    return `
      <div class="bm-card ${b.stale ? 'is-stale' : ''}" data-id="${b.id}">
        <div class="bm-card-top">
          <span class="bm-type-tag">${isCustom ? '自定义' : '对话摘录'}</span>
          ${b.title ? `<span class="bm-title">${escapeHtml(b.title)}</span>` : ''}
        </div>
        ${storableToBlob(b.image) ? `<div class="bm-photo" data-bm-id="${b.id}"></div>` : ''}
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
    let pendingImage = storableToBlob(item?.image);
    let editPreviewUrl = null;
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${isNew ? '新建收藏' : '编辑收藏'}</h3>
        <form id="bm-form">
          <label class="field"><span>标题（可选）</span><input name="title" maxlength="30" value="${escapeAttr(item?.title || '')}"></label>
          <label class="field"><span>内容</span><textarea name="content" rows="5" required>${escapeHtml(item?.content || '')}</textarea></label>
          <label class="field"><span>标签（用空格或逗号分隔）</span><input name="tags" value="${escapeAttr((item?.tags || []).join(', '))}"></label>
          <div class="field">
            <span>照片（可选）</span>
            <div class="bm-photo-edit">
              <div class="bm-photo-preview is-empty" id="bm-photo-preview">未设置</div>
              <div class="bm-photo-edit-actions">
                <label class="btn-secondary file-btn">上传<input type="file" accept="image/*" id="bm-photo-input" hidden></label>
                <button type="button" class="msg-act" id="bm-photo-clear" style="display:none">移除</button>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="bm-cancel">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);

    const previewEl = dialog.querySelector('#bm-photo-preview');
    const clearBtn = dialog.querySelector('#bm-photo-clear');
    function updatePreview() {
      if (editPreviewUrl) { URL.revokeObjectURL(editPreviewUrl); editPreviewUrl = null; }
      if (pendingImage instanceof Blob) {
        editPreviewUrl = URL.createObjectURL(pendingImage);
        previewEl.style.backgroundImage = `url("${editPreviewUrl}")`;
        previewEl.classList.remove('is-empty');
        previewEl.textContent = '';
        clearBtn.style.display = '';
      } else {
        previewEl.style.backgroundImage = '';
        previewEl.classList.add('is-empty');
        previewEl.textContent = '未设置';
        clearBtn.style.display = 'none';
      }
    }
    updatePreview();

    function closeDialog() {
      if (editPreviewUrl) URL.revokeObjectURL(editPreviewUrl);
      dialog.remove();
    }

    dialog.querySelector('#bm-photo-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { await UIDialog.alert('请选择图片文件'); return; }
      try {
        pendingImage = await resizeImageFile(file);
        updatePreview();
      } catch (_) {
        await UIDialog.alert('图片处理失败，换一张试试');
      }
    });
    clearBtn.addEventListener('click', () => { pendingImage = null; updatePreview(); });

    dialog.querySelector('#bm-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('#bm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tags = String(fd.get('tags') || '').split(/[,，\s]+/).filter(Boolean);
      const storableImage = pendingImage ? await blobToStorable(pendingImage) : null;
      if (isNew) {
        await DB.put('bookmarks', {
          id: uuid(),
          type: 'custom',
          title: fd.get('title')?.trim() || '',
          content: fd.get('content')?.trim() || '',
          tags,
          image: storableImage,
          stale: false,
          createdAt: nowISO(),
        });
      } else {
        item.title = fd.get('title')?.trim() || '';
        item.content = fd.get('content')?.trim() || '';
        item.tags = tags;
        item.image = storableImage;
        await DB.put('bookmarks', item);
      }
      closeDialog();
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
