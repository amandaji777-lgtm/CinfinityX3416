// 首次启动向导：只在设置为空时展示一次，之后可在"更多-设置"里随时修改。
const Wizard = (() => {
  const COLOR_THEMES = [
    { id: 'duskpink', label: '暮粉', swatch: 'linear-gradient(135deg, #f5d2d6, #9a8398)' },
    { id: 'sage', label: '鼠尾草', swatch: 'linear-gradient(135deg, #cfe3de, #6f8f89)' },
    { id: 'mistpine', label: '雾松', swatch: 'linear-gradient(135deg, #d7e8d5, #6f9382)' },
    { id: 'candy', label: '糖果', swatch: 'linear-gradient(135deg, #fcaec1, #b7a8d6)' },
  ];

  function render(container, existing, onComplete) {
    const v = existing || {};
    container.innerHTML = `
      <div class="wizard-overlay">
        <form class="wizard-card" id="wizard-form">
          <h1>欢迎使用拾光</h1>
          <p class="wizard-sub">先花一分钟做几个简单设置，之后随时可以在"更多 → 设置"里修改。</p>

          <label class="field">
            <span>工作台名称</span>
            <input name="workspaceName" maxlength="20" value="${escapeAttr(v.workspaceName || '拾光')}" required>
          </label>
          <label class="field">
            <span>副标题（可选）</span>
            <input name="subtitle" maxlength="30" value="${escapeAttr(v.subtitle || '对话 · 收藏 · 心情')}">
          </label>
          <label class="field">
            <span>怎么称呼你</span>
            <input name="nickname" maxlength="16" placeholder="你的昵称" value="${escapeAttr(v.nickname || '')}">
          </label>

          <div class="field">
            <span>配色</span>
            <div class="swatch-row" id="swatch-row">
              ${COLOR_THEMES.map((c) => `
                <label class="swatch-option">
                  <input type="radio" name="colorTheme" value="${c.id}" ${(v.colorTheme || 'duskpink') === c.id ? 'checked' : ''}>
                  <span class="swatch" style="background:${c.swatch}"></span>
                  <span class="swatch-label">${c.label}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <span>深色模式</span>
            <div class="seg-row">
              <label class="seg-option"><input type="radio" name="theme" value="light" ${(v.theme || 'light') === 'light' ? 'checked' : ''}><span>浅色</span></label>
              <label class="seg-option"><input type="radio" name="theme" value="soft-dark" ${v.theme === 'soft-dark' ? 'checked' : ''}><span>柔和深色</span></label>
            </div>
          </div>

          <div class="field">
            <span>时间显示</span>
            <div class="seg-row">
              <label class="seg-option"><input type="radio" name="clockFormat" value="24" ${(v.clockFormat || 24) == 24 ? 'checked' : ''}><span>24 小时制</span></label>
              <label class="seg-option"><input type="radio" name="clockFormat" value="12" ${v.clockFormat == 12 ? 'checked' : ''}><span>12 小时制</span></label>
            </div>
          </div>

          <label class="field-inline">
            <input type="checkbox" name="aiEnabled" ${v.aiEnabled !== false ? 'checked' : ''}>
            <span>启用 AI 对话功能（之后随时可在设置里关闭）</span>
          </label>
          <label class="field-inline">
            <input type="checkbox" name="proactiveMessagesEnabled" ${v.proactiveMessagesEnabled ? 'checked' : ''}>
            <span>启用角色主动消息（默认关闭，没有后台推送，只在你打开/回到 App 时检查生成）</span>
          </label>

          <div class="wizard-note">
            <strong>关于数据存储：</strong>本应用采用<b>仅本机模式</b>：所有内容保存在这台设备浏览器的 IndexedDB 里，不会上传到任何云端。
            更换浏览器、清理网站数据、卸载应用或更换手机都可能导致本地数据无法访问——请记得在"更多 → 设置 → 备份"里定期导出 JSON 备份。
          </div>

          <button type="submit" class="btn-primary">开始使用</button>
        </form>
      </div>
    `;

    container.querySelector('#wizard-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const settings = {
        workspaceName: fd.get('workspaceName') || '拾光',
        subtitle: fd.get('subtitle') || '',
        nickname: fd.get('nickname') || '',
        colorTheme: fd.get('colorTheme') || 'duskpink',
        theme: fd.get('theme') || 'light',
        clockFormat: Number(fd.get('clockFormat')) || 24,
        aiEnabled: fd.get('aiEnabled') === 'on',
        proactiveMessagesEnabled: fd.get('proactiveMessagesEnabled') === 'on',
        storageMode: 'local-only',
        wizardCompleted: true,
        createdAt: v.createdAt || nowISO(),
      };
      for (const [key, value] of Object.entries(settings)) {
        await DB.setSetting(key, value);
      }
      const persist = await DB.requestPersistentStorage();
      await DB.setSetting('persistentStorage', persist);
      onComplete(settings);
    });
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  return { render, COLOR_THEMES };
})();
