// "更多"页：星野壁纸抽屉——顶部是工作台签名区，下面一块玻璃卡片列表，
// 每一行点开才是详细设置的整页表单：工作台设置、头像、自定义壁纸、
// AI 资料库入口、API 连接管理、数据备份与说明。
const More = (() => {
  let container;
  let connections = [];
  let storageInfo = null;
  let wallpaperBlobs = { light: null, 'soft-dark': null };
  let wallpaperPreviewUrls = { light: null, 'soft-dark': null };
  let userAvatarBlob = null;
  let userAvatarPreviewUrl = null;
  let skyStars = [];
  let skyResizeHandler = null;

  async function init(rootEl) {
    container = rootEl;
    connections = await DB.getAll('connections');
    storageInfo = await DB.estimateUsage();
    await refreshWallpaperBlobs();
    await refreshUserAvatarBlob();
    render();
  }

  async function refreshWallpaperBlobs() {
    wallpaperBlobs.light = await DB.getSetting('wallpaperLight');
    wallpaperBlobs['soft-dark'] = await DB.getSetting('wallpaperDark');
  }

  async function refreshUserAvatarBlob() {
    userAvatarBlob = await DB.getSetting('userAvatar');
  }

  function rebuildUserAvatarPreview() {
    if (userAvatarPreviewUrl) URL.revokeObjectURL(userAvatarPreviewUrl);
    userAvatarPreviewUrl = userAvatarBlob instanceof Blob ? URL.createObjectURL(userAvatarBlob) : null;
  }

  function rebuildWallpaperPreviews() {
    for (const t of ['light', 'soft-dark']) {
      if (wallpaperPreviewUrls[t]) URL.revokeObjectURL(wallpaperPreviewUrls[t]);
      wallpaperPreviewUrls[t] = wallpaperBlobs[t] instanceof Blob ? URL.createObjectURL(wallpaperBlobs[t]) : null;
    }
  }

  // ---------------- 顶层列表：星野壁纸抽屉 ----------------
  function render() {
    const s = App.settings;
    rebuildWallpaperPreviews();
    rebuildUserAvatarPreview();
    container.innerHTML = `
      <div class="more-view">
        <canvas class="more-sky" aria-hidden="true"></canvas>
        <div class="more-scrim" aria-hidden="true"></div>
        <div class="more-scroll">
          <div class="more-hero">
            <p class="more-hero-name">${escapeHtml(s.workspaceName || '星纪')}</p>
            <p class="more-hero-caption">Star Chronicle</p>
            ${heroStatHTML(s.createdAt)}
          </div>
          <nav class="more-glass-list">
            <button type="button" class="more-row" id="row-avatar">
              <span class="more-row-icon avatar-preview-sm">${userAvatarPreviewUrl ? `<img src="${userAvatarPreviewUrl}" alt="">` : escapeHtml((s.nickname || '你')[0] || '你')}</span>
              <span class="more-row-body"><div class="more-row-label">头像</div><div class="more-row-sub">Choose your face</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-workspace">
              <span class="more-row-icon">${moreIcon('workspace')}</span>
              <span class="more-row-body"><div class="more-row-label">工作台设置</div><div class="more-row-sub">Tune the desk</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-wallpaper">
              <span class="more-row-icon">${moreIcon('wallpaper')}</span>
              <span class="more-row-body"><div class="more-row-label">外观 · 自定义壁纸</div><div class="more-row-sub">Dress the light</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-resources">
              <span class="more-row-icon">${moreIcon('library')}</span>
              <span class="more-row-body"><div class="more-row-label">AI 资料库</div><div class="more-row-sub">Feed the mind</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-connections">
              <span class="more-row-icon">${moreIcon('connections')}</span>
              <span class="more-row-body"><div class="more-row-label">API 连接</div><div class="more-row-sub">Wire the voice</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-backup">
              <span class="more-row-icon">${moreIcon('backup')}</span>
              <span class="more-row-body"><div class="more-row-label">数据与备份</div><div class="more-row-sub">Keep what matters</div></span>
              <span class="more-row-chevron">›</span>
            </button>
            <button type="button" class="more-row" id="row-about">
              <span class="more-row-icon">${moreIcon('about')}</span>
              <span class="more-row-body"><div class="more-row-label">关于 · 使用说明</div><div class="more-row-sub">Know the maker</div></span>
              <span class="more-row-chevron">›</span>
            </button>
          </nav>
        </div>
      </div>
    `;
    container.querySelector('#row-avatar').addEventListener('click', openAvatarPage);
    container.querySelector('#row-workspace').addEventListener('click', openWorkspacePage);
    container.querySelector('#row-wallpaper').addEventListener('click', openWallpaperPage);
    container.querySelector('#row-resources').addEventListener('click', () => window.App.switchTab('resources'));
    container.querySelector('#row-connections').addEventListener('click', openConnectionsPage);
    container.querySelector('#row-backup').addEventListener('click', openBackupPage);
    container.querySelector('#row-about').addEventListener('click', openAboutPage);
    initSky();
  }

  function heroStatHTML(createdAt) {
    if (!createdAt) return '';
    const start = new Date(createdAt);
    if (Number.isNaN(start.getTime())) return '';
    const days = Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1);
    const label = `${start.getFullYear()}.${String(start.getMonth() + 1).padStart(2, '0')}.${String(start.getDate()).padStart(2, '0')}`;
    return `<p class="more-hero-stat">自 ${label} · 第 <b>${days}</b> 天</p>`;
  }

  // 抽屉列表用的简约单线图标，跟随主题色，不引入新色相。
  function moreIcon(name) {
    const icons = {
      workspace: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2"/><path d="M3.4 9h17.2M8 13.4h5"/>',
      wallpaper: '<path d="M4 16.5l5-6 4 4.5 3-3.5 4 5"/><circle cx="17" cy="7" r="2"/><rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2"/>',
      library: '<path d="M4.5 19V6.2a2 2 0 0 1 2-2H17l3 3v11.8a1.4 1.4 0 0 1-1.4 1.4H5.9A1.4 1.4 0 0 1 4.5 19Z"/><path d="M8 8.4h6M8 12h8"/>',
      connections: '<circle cx="8" cy="12" r="3.6"/><circle cx="16" cy="12" r="3.6"/><path d="M11.4 12h1.2"/>',
      backup: '<path d="M12 3.6c4.2 1.3 6.6 2.3 6.6 2.3v6c0 4-2.7 6.5-6.6 7.7-3.9-1.2-6.6-3.7-6.6-7.7v-6S7.8 4.9 12 3.6Z"/>',
      about: '<circle cx="12" cy="12" r="8"/><path d="M12 10.6v5.4M12 7.6v.1"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
  }

  // ---------------- 背景：星野画布（黑银=星空月晕，白金=中性铂金晨光，绝不引入暖黄色相） ----------------
  function initSky() {
    if (skyResizeHandler) { window.removeEventListener('resize', skyResizeHandler); skyResizeHandler = null; }
    const canvas = container.querySelector('.more-sky');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: r.width, h: r.height };
    }
    function seed(w, h) {
      skyStars = [];
      for (let i = 0; i < 70; i++) {
        skyStars.push({ x: Math.random() * w, y: Math.random() * h * 0.7, r: Math.random() * 1.2 + 0.3, p: Math.random() * Math.PI * 2, s: Math.random() * 0.5 + 0.25 });
      }
    }
    // 静态画一次，不用 requestAnimationFrame 持续重绘——这层画布底下垫着的是
    // 一块开了 backdrop-filter 的玻璃列表，持续重绘 + 持续重新模糊在真机上
    // （尤其是 iOS Safari）非常吃性能，是列表滚动卡顿的头号嫌疑。星星就用
    // 各自随机的固定亮度，不做逐帧闪烁。
    function draw(w, h) {
      const isDark = document.documentElement.dataset.theme === 'soft-dark';
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      if (isDark) { bg.addColorStop(0, '#0d0d0d'); bg.addColorStop(0.6, '#161616'); bg.addColorStop(1, '#050505'); }
      else { bg.addColorStop(0, '#fbfbfa'); bg.addColorStop(0.6, '#f0f0ee'); bg.addColorStop(1, '#e2e2df'); }
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

      const mx = w * 0.26, my = h * 0.15;
      const glow = ctx.createRadialGradient(mx, my, 2, mx, my, isDark ? w * 0.55 : w * 0.4);
      glow.addColorStop(0, isDark ? 'rgba(240,240,238,.16)' : 'rgba(163,163,156,.13)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

      skyStars.forEach((st) => {
        const b = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(st.p * 3));
        if (isDark) {
          ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240,240,238,${(0.25 + b * 0.55).toFixed(3)})`;
          ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(st.x, st.y, st.r * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(163,163,156,${(0.04 + b * 0.04).toFixed(3)})`;
          ctx.fill();
        }
      });

      ctx.beginPath(); ctx.arc(mx, my, 14, 0, Math.PI * 2);
      const moonG = ctx.createRadialGradient(mx, my, 1, mx, my, 14);
      if (isDark) { moonG.addColorStop(0, 'rgba(240,240,238,.95)'); moonG.addColorStop(1, 'rgba(240,240,238,.2)'); }
      else { moonG.addColorStop(0, 'rgba(163,163,156,.45)'); moonG.addColorStop(1, 'rgba(163,163,156,.04)'); }
      ctx.fillStyle = moonG; ctx.fill();
    }

    let dims = size();
    seed(dims.w, dims.h);
    draw(dims.w, dims.h);
    skyResizeHandler = () => { dims = size(); seed(dims.w, dims.h); draw(dims.w, dims.h); };
    window.addEventListener('resize', skyResizeHandler);
  }

  // ---------------- 头像 ----------------
  function openAvatarPage() {
    const dialog = Pages.open('头像', `
      <div class="more-section">
        <h3>我的头像</h3>
        <div class="avatar-upload-row">
          <div class="avatar-preview">${userAvatarPreviewUrl ? `<img src="${userAvatarPreviewUrl}" alt="">` : escapeHtml((App.settings.nickname || '你')[0] || '你')}</div>
          <div class="avatar-upload-actions">
            <label class="btn-secondary file-btn">更换我的头像<input type="file" accept="image/*" id="user-avatar-input" hidden></label>
            ${userAvatarPreviewUrl ? '<button type="button" class="msg-act" id="user-avatar-clear">移除头像</button>' : ''}
          </div>
        </div>
        <p class="section-hint">会显示在你自己发的每条消息旁边。</p>
      </div>
      <div class="more-section">
        <h3>角色头像</h3>
        <p class="section-hint">每个"对方角色卡"的头像单独在 AI 资料库里设置——编辑一张角色卡，顶部就能上传专属头像。</p>
        <button type="button" class="btn-secondary" id="avatar-goto-resources">去 AI 资料库设置角色头像</button>
      </div>
    `);
    dialog.querySelector('#user-avatar-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { await UIDialog.alert('请选择图片文件'); return; }
      await Avatars.set(null, file);
      await refreshUserAvatarBlob();
      if (window.Chat) await window.Chat.refreshAvatars();
      Pages.close(dialog);
      render();
      openAvatarPage();
      toast('头像已更新');
    });
    dialog.querySelector('#user-avatar-clear')?.addEventListener('click', async () => {
      await Avatars.clear(null);
      await refreshUserAvatarBlob();
      if (window.Chat) await window.Chat.refreshAvatars();
      Pages.close(dialog);
      render();
      openAvatarPage();
      toast('已移除头像');
    });
    dialog.querySelector('#avatar-goto-resources').addEventListener('click', () => {
      Pages.close(dialog);
      window.App.switchTab('resources');
    });
  }

  // ---------------- 工作台设置 ----------------
  function openWorkspacePage() {
    const s = App.settings;
    const dialog = Pages.open('工作台设置', `
      <form id="settings-form">
        <label class="field"><span>工作台名称</span><input name="workspaceName" value="${escapeAttr(s.workspaceName || '')}" maxlength="20"></label>
        <label class="field"><span>副标题</span><input name="subtitle" value="${escapeAttr(s.subtitle || '')}" maxlength="30"></label>
        <label class="field"><span>昵称</span><input name="nickname" value="${escapeAttr(s.nickname || '')}" maxlength="16"></label>

        <div class="field"><span>基础模式</span>
          <div class="seg-row">
            <label class="seg-option"><input type="radio" name="theme" value="light" ${s.theme !== 'soft-dark' ? 'checked' : ''}><span>白金</span></label>
            <label class="seg-option"><input type="radio" name="theme" value="soft-dark" ${s.theme === 'soft-dark' ? 'checked' : ''}><span>黑银</span></label>
          </div>
        </div>

        <fieldset class="fieldset"><legend>点按时的光辉颜色</legend>
          <p class="section-hint">整体配色固定为白金/黑银这两种呼吸感玻璃质感，不再有其他配色方案；这里只能调"点击卡片/按钮时散开的那圈光晕"用什么颜色。</p>
          <label class="field-inline"><input type="checkbox" name="useCustomColors" id="use-custom-colors" ${s.customAccent ? 'checked' : ''}><span>自定义光辉颜色</span></label>
          <label class="field"><span>光辉颜色</span><input type="color" name="customAccent" value="${s.customAccent || (s.theme === 'soft-dark' ? '#ececeb' : '#232320')}" ${s.customAccent ? '' : 'disabled'}></label>
        </fieldset>

        <label class="field-inline"><input type="checkbox" name="aiEnabled" ${s.aiEnabled !== false ? 'checked' : ''}><span>启用 AI 对话功能</span></label>
        <label class="field-inline"><input type="checkbox" name="proactiveMessagesEnabled" ${s.proactiveMessagesEnabled ? 'checked' : ''}><span>启用角色主动消息（总开关，具体每个角色还要单独在对话设置里打开）</span></label>
        <div class="modal-actions"><button type="submit" class="btn-primary">保存设置</button></div>
      </form>
    `);
    dialog.querySelector('#use-custom-colors').addEventListener('change', (e) => {
      dialog.querySelector('input[name=customAccent]').disabled = !e.target.checked;
    });
    dialog.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const useCustom = fd.get('useCustomColors') === 'on';
      const updated = {
        ...App.settings,
        workspaceName: fd.get('workspaceName') || '星纪',
        subtitle: fd.get('subtitle') || '',
        nickname: fd.get('nickname') || '',
        theme: fd.get('theme') || 'light',
        customAccent: useCustom ? fd.get('customAccent') : null,
        aiEnabled: fd.get('aiEnabled') === 'on',
        proactiveMessagesEnabled: fd.get('proactiveMessagesEnabled') === 'on',
      };
      for (const [k, v] of Object.entries(updated)) await DB.setSetting(k, v);
      App.settings = updated;
      App.applyTheme(updated);
      document.title = updated.workspaceName || '星纪';
      toast('已保存');
      Pages.close(dialog);
      render();
    });
  }

  // ---------------- 自定义壁纸 ----------------
  function openWallpaperPage() {
    const dialog = Pages.open('外观 · 自定义壁纸', `
      <div class="more-section">
        <p class="section-hint">白金和黑银可以各自设一张背景照片，毛玻璃卡片盖在上面（不会存进备份文件，换设备后需要重新上传）。</p>
        <div class="wallpaper-row">
          ${wallpaperItem('light', '白金')}
          ${wallpaperItem('soft-dark', '黑银')}
        </div>
      </div>
    `);
    bindWallpaperEvents(dialog);
  }

  function wallpaperItem(theme, label) {
    const url = wallpaperPreviewUrls[theme];
    const idSafe = theme.replace(/[^a-z]/g, '');
    return `
      <div class="wallpaper-item">
        <div class="wallpaper-preview" style="${url ? `background-image:url('${url}')` : ''}">${url ? '' : '未设置'}</div>
        <span class="wallpaper-label">${label}</span>
        <div class="wallpaper-actions">
          <label class="btn-secondary file-btn">上传<input type="file" accept="image/*" data-wallpaper-input="${theme}" id="wallpaper-${idSafe}-input" hidden></label>
          ${url ? `<button type="button" class="msg-act" data-wallpaper-clear="${theme}">清除</button>` : ''}
        </div>
      </div>
    `;
  }

  function bindWallpaperEvents(dialog) {
    dialog.querySelectorAll('[data-wallpaper-input]').forEach((input) => {
      input.addEventListener('change', (e) => handleWallpaperUpload(dialog, input.dataset.wallpaperInput, e));
    });
    dialog.querySelectorAll('[data-wallpaper-clear]').forEach((btn) => {
      btn.addEventListener('click', () => handleWallpaperClear(dialog, btn.dataset.wallpaperClear));
    });
  }

  async function handleWallpaperUpload(dialog, theme, e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { await UIDialog.alert('请选择图片文件'); return; }
    await Wallpaper.set(theme, file);
    await refreshWallpaperBlobs();
    Pages.close(dialog);
    render();
    openWallpaperPage();
    toast('壁纸已更新');
  }

  async function handleWallpaperClear(dialog, theme) {
    await Wallpaper.clear(theme);
    await refreshWallpaperBlobs();
    Pages.close(dialog);
    render();
    openWallpaperPage();
    toast('已清除壁纸');
  }

  // ---------------- API 连接 ----------------
  function openConnectionsPage() {
    const dialog = Pages.open('API 连接', `
      <div class="more-section">
        <p class="section-hint">网页会员（ChatGPT Plus / Claude Pro / Gemini Advanced 等）通常不等于 API Key，需要用各家开发者平台生成的密钥。</p>
        <div class="conn-list" id="conn-list">
          ${connections.length === 0 ? '<div class="empty-sub">还没有连接，点下面按钮添加一个</div>' : connections.map(connRow).join('')}
        </div>
        <button class="btn-secondary" id="btn-add-conn">＋ 添加连接</button>
      </div>
    `);
    bindConnectionsEvents(dialog);
  }

  function connRow(c) {
    return `
      <div class="conn-row" data-id="${c.id}">
        <div class="conn-info">
          <div class="conn-name">${escapeHtml(c.name)}</div>
          <div class="conn-sub">${PROVIDER_LABELS[c.provider] || c.provider} · ${escapeHtml(c.model || c.customUrl || '')}</div>
        </div>
        <div class="conn-actions">
          <button class="msg-act" data-act="test">测试</button>
          <button class="msg-act" data-act="edit">编辑</button>
          <button class="msg-act" data-act="delete">删除</button>
        </div>
      </div>
    `;
  }

  function bindConnectionsEvents(dialog) {
    dialog.querySelector('#btn-add-conn').addEventListener('click', () => openConnEditor(null, dialog));
    dialog.querySelectorAll('.conn-row').forEach((el) => {
      const id = el.dataset.id;
      const conn = connections.find((c) => c.id === id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openConnEditor(conn, dialog));
      el.querySelector('[data-act="delete"]').addEventListener('click', () => deleteConn(conn, dialog));
      el.querySelector('[data-act="test"]').addEventListener('click', () => testConn(conn));
    });
  }

  function refreshConnectionsListInPlace(dialog) {
    const list = dialog.querySelector('#conn-list');
    if (!list) return;
    list.innerHTML = connections.length === 0 ? '<div class="empty-sub">还没有连接，点下面按钮添加一个</div>' : connections.map(connRow).join('');
    bindConnectionsEvents(dialog);
  }

  // ---------------- 数据与备份 ----------------
  function openBackupPage() {
    const dialog = Pages.open('数据与备份', `
      <div class="more-section">
        <div class="storage-info">
          <div>本地数据库版本：v${DB_VERSION}</div>
          <div>存储模式：仅本机（不上传云端）</div>
          <div>最后备份：<span id="last-backup-at">读取中…</span></div>
          <div>持久化存储权限：<span id="persist-status">读取中…</span></div>
          ${storageInfo ? `<div>预计占用：约 ${formatBytes(storageInfo.usage)} / ${formatBytes(storageInfo.quota)}</div>` : ''}
        </div>
        <div class="record-counts" id="record-counts">统计中…</div>
        <div class="backup-actions">
          <button class="btn-secondary" id="btn-export">立即备份（导出 JSON）</button>
          <label class="btn-secondary file-btn">
            导入备份恢复
            <input type="file" id="btn-import" accept="application/json" hidden>
          </label>
        </div>
        <p class="section-hint">备份文件不包含 API Key（出于安全考虑）、自定义壁纸和头像（图片不适合塞进纯文本备份），恢复后需要重新填写密钥、重新上传壁纸和头像。</p>
      </div>
    `);
    dialog.querySelector('#btn-export').addEventListener('click', async () => {
      await Backup.exportToFile();
      toast('已导出备份文件');
      refreshCountsIn(dialog);
      updateBackupStatusIn(dialog);
    });
    dialog.querySelector('#btn-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const payload = await Backup.readFile(file);
        Backup.validate(payload);
        if (!await UIDialog.confirm('导入会用备份文件里的数据覆盖同 ID 的记录（不会清空其他现有数据）。确定要恢复吗？')) return;
        const result = await Backup.importFromPayload(payload);
        toast(`恢复完成：设置${result.counts.settings}项、对话${result.counts.conversations}条、消息${result.counts.messages}条`);
        location.reload();
      } catch (err) {
        await UIDialog.alert('导入失败：' + err.message);
      }
    });
    updateBackupStatusIn(dialog);
    refreshCountsIn(dialog);
  }

  async function updateBackupStatusIn(dialog) {
    const lastBackupAt = await DB.getSetting('lastBackupAt');
    dialog.querySelector('#last-backup-at').textContent = lastBackupAt ? formatRelativeTime(lastBackupAt) : '还没有备份过';
    const persist = await DB.getSetting('persistentStorage');
    const el = dialog.querySelector('#persist-status');
    if (!persist) el.textContent = '未知';
    else if (!persist.supported) el.textContent = '浏览器不支持';
    else el.textContent = persist.granted ? '已获得持久化权限' : '未获得（浏览器仍可能在空间不足时清理数据）';
  }

  async function refreshCountsIn(dialog) {
    const [conv, msg, bm, mood] = await Promise.all([
      DB.count('conversations'), DB.count('messages'), DB.count('bookmarks'), DB.count('moods'),
    ]);
    const el = dialog.querySelector('#record-counts');
    if (el) el.textContent = `对话 ${conv} 条 · 消息 ${msg} 条 · 收藏 ${bm} 条 · 心情记录 ${mood} 条`;
  }

  // ---------------- 关于 ----------------
  function openAboutPage() {
    Pages.open('关于 · 使用说明', `
      <div class="more-section">
        <div class="about-text">
          <p><b>预览地址不是永久存储。</b>请把本应用"添加到主屏幕"安装为 PWA，并定期在"数据与备份"里导出 JSON 备份——更换浏览器、清理网站数据或卸载应用都可能导致本地数据无法访问。</p>
          <p><b>AI 消息都会标注为"AI 生成"</b>，不代表真实人物，请理性看待对话内容。</p>
          <p>更完整的教程见仓库根目录的 <code>README.md</code>。</p>
        </div>
      </div>
    `);
  }

  // ---------------- 连接编辑 ----------------
  function openConnEditor(item, parentDialog) {
    const isNew = !item;
    const dialog = Pages.open(isNew ? '添加连接' : '编辑连接', `
      <div class="risk-note">浏览器前端无法真正隐藏 API Key，密钥会用 Web Crypto 加密存在本机，但仍建议优先使用你自己的安全后端/Relay 转发请求。</div>
      <form id="conn-form">
        <label class="field"><span>预设</span>
          <select id="preset-select">
            <option value="">自定义</option>
            ${PROVIDER_PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>名称</span><input name="name" required value="${escapeAttr(item?.name || '')}" maxlength="20"></label>
        <label class="field"><span>协议</span>
          <select name="provider" id="provider-select">
            ${Object.entries(PROVIDER_LABELS).map(([id, label]) => `<option value="${id}" ${item?.provider === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <div id="standard-fields">
          <label class="field"><span>Base URL</span><input name="baseUrl" value="${escapeAttr(item?.baseUrl || '')}" placeholder="https://api.openai.com/v1"></label>
          <label class="field"><span>模型</span><input name="model" value="${escapeAttr(item?.model || '')}" placeholder="例如 gpt-4o-mini"></label>
        </div>
        <label class="field"><span>API Key ${item ? '（留空则不修改）' : ''}</span><input name="apiKey" type="password" placeholder="sk-..." autocomplete="off"></label>
        <fieldset class="fieldset" id="custom-fields" style="display:none">
          <legend>自定义协议映射</legend>
          <p class="section-hint">仅做声明式模板替换，不会执行任何脚本。占位符：{{model}} {{apiKey}} {{system}} {{messagesJSON}} {{temperature}} {{maxTokens}}</p>
          <label class="field"><span>请求方法</span>
            <select name="customMethod"><option value="POST" ${item?.customMethod !== 'GET' ? 'selected' : ''}>POST</option><option value="GET" ${item?.customMethod === 'GET' ? 'selected' : ''}>GET</option></select>
          </label>
          <label class="field"><span>请求 URL</span><input name="customUrl" value="${escapeAttr(item?.customUrl || '')}" placeholder="https://example.com/v1/chat?model={{model}}"></label>
          <label class="field"><span>鉴权请求头名称</span><input name="customAuthHeaderName" value="${escapeAttr(item?.customAuthHeaderName || 'Authorization')}"></label>
          <label class="field"><span>鉴权请求头模板</span><input name="customAuthHeaderTemplate" value="${escapeAttr(item?.customAuthHeaderTemplate || 'Bearer {{apiKey}}')}"></label>
          <label class="field"><span>其他请求头（JSON，可选）</span><textarea name="customHeaders" rows="2">${escapeHtml(item?.customHeaders || '')}</textarea></label>
          <label class="field"><span>请求体模板（JSON）</span><textarea name="customBodyTemplate" rows="3" placeholder='{"model":"{{model}}","messages":{{messagesJSON}},"stream":true}'>${escapeHtml(item?.customBodyTemplate || '')}</textarea></label>
          <label class="field"><span>响应文本路径</span><input name="customResponseTextPath" value="${escapeAttr(item?.customResponseTextPath || '')}" placeholder="choices.0.delta.content"></label>
          <label class="field"><span>流式格式</span>
            <select name="customStreamFormat">
              <option value="none" ${(item?.customStreamFormat || 'none') === 'none' ? 'selected' : ''}>不支持流式（一次性返回）</option>
              <option value="sse-json-path" ${item?.customStreamFormat === 'sse-json-path' ? 'selected' : ''}>SSE（data: 前缀的 JSON 行）</option>
              <option value="ndjson-json-path" ${item?.customStreamFormat === 'ndjson-json-path' ? 'selected' : ''}>NDJSON（每行一个 JSON）</option>
            </select>
          </label>
        </fieldset>
        <div class="modal-actions">
          ${!isNew ? '<button type="button" class="btn-danger" id="conn-delete">删除</button>' : ''}
          <button type="button" class="btn-secondary" id="conn-cancel">取消</button>
          <button type="submit" class="btn-primary">保存</button>
        </div>
      </form>
    `);

    function toggleProviderFields() {
      const provider = dialog.querySelector('#provider-select').value;
      dialog.querySelector('#custom-fields').style.display = provider === 'custom' ? '' : 'none';
      dialog.querySelector('#standard-fields').style.display = provider === 'custom' ? 'none' : '';
    }
    toggleProviderFields();
    dialog.querySelector('#provider-select').addEventListener('change', toggleProviderFields);

    dialog.querySelector('#preset-select').addEventListener('change', (e) => {
      const preset = PROVIDER_PRESETS.find((p) => p.id === e.target.value);
      if (!preset) return;
      const f = dialog.querySelector('#conn-form');
      f.name.value = preset.name;
      f.provider.value = preset.provider;
      f.baseUrl.value = preset.baseUrl;
      f.model.value = preset.model;
      toggleProviderFields();
    });
    dialog.querySelector('#conn-cancel').addEventListener('click', () => Pages.close(dialog));
    dialog.querySelector('#conn-delete')?.addEventListener('click', () => { Pages.close(dialog); deleteConn(item, parentDialog); });
    dialog.querySelector('#conn-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const rawKey = fd.get('apiKey');
      let apiKeyCipher = item?.apiKeyCipher || '';
      let apiKeyIv = item?.apiKeyIv || '';
      if (rawKey) {
        const enc = await CryptoUtils.encryptText(rawKey);
        apiKeyCipher = enc.cipher;
        apiKeyIv = enc.iv;
      }
      const conn = {
        id: item?.id || uuid(),
        name: fd.get('name').trim(),
        provider: fd.get('provider'),
        baseUrl: (fd.get('baseUrl') || '').trim(),
        model: (fd.get('model') || '').trim(),
        apiKeyCipher,
        apiKeyIv,
        customMethod: fd.get('customMethod') || 'POST',
        customUrl: (fd.get('customUrl') || '').trim(),
        customAuthHeaderName: (fd.get('customAuthHeaderName') || '').trim(),
        customAuthHeaderTemplate: fd.get('customAuthHeaderTemplate') || '',
        customHeaders: fd.get('customHeaders') || '',
        customBodyTemplate: fd.get('customBodyTemplate') || '',
        customResponseTextPath: (fd.get('customResponseTextPath') || '').trim(),
        customStreamFormat: fd.get('customStreamFormat') || 'none',
        createdAt: item?.createdAt || nowISO(),
      };
      await DB.put('connections', conn);
      Pages.close(dialog);
      connections = await DB.getAll('connections');
      await Chat.refreshConnections();
      render();
      if (parentDialog) refreshConnectionsListInPlace(parentDialog);
    });
  }

  async function deleteConn(item, parentDialog) {
    if (!await UIDialog.confirm(`删除连接"${item.name}"？使用它的对话会变成未绑定状态。`, { danger: true, okLabel: '删除' })) return;
    await DB.delete('connections', item.id);
    connections = await DB.getAll('connections');
    await Chat.refreshConnections();
    render();
    if (parentDialog) refreshConnectionsListInPlace(parentDialog);
  }

  async function testConn(item) {
    toast('测试中…');
    try {
      const apiKey = item.apiKeyCipher ? await CryptoUtils.decryptText(item.apiKeyCipher, item.apiKeyIv) : '';
      const provider = Providers[item.provider];
      await provider.testConnection(item, apiKey);
      toast('连接成功 ✓');
    } catch (err) {
      await UIDialog.alert('连接测试失败：\n' + (err.message || err));
    }
  }

  function formatBytes(n) {
    if (!n && n !== 0) return '未知';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
  }

  return { init };
})();
