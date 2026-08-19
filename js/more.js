// "更多"页：工作台设置、API 连接管理、数据备份与说明。
const More = (() => {
  let container;
  let connections = [];
  let storageInfo = null;

  async function init(rootEl) {
    container = rootEl;
    connections = await DB.getAll('connections');
    storageInfo = await DB.estimateUsage();
    render();
  }

  function render() {
    const s = App.settings;
    container.innerHTML = `
      <div class="more-view">
        <div class="view-header"><h2>更多</h2></div>

        <section class="more-section">
          <h3>工作台设置</h3>
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
              <label class="field"><span>光辉颜色</span><input type="color" name="customAccent" value="${s.customAccent || (s.theme === 'soft-dark' ? '#c7ccd1' : '#b8965a')}" ${s.customAccent ? '' : 'disabled'}></label>
            </fieldset>

            <label class="field-inline"><input type="checkbox" name="aiEnabled" ${s.aiEnabled !== false ? 'checked' : ''}><span>启用 AI 对话功能</span></label>
            <label class="field-inline"><input type="checkbox" name="proactiveMessagesEnabled" ${s.proactiveMessagesEnabled ? 'checked' : ''}><span>启用角色主动消息（总开关，具体每个角色还要单独在对话设置里打开）</span></label>
            <button type="submit" class="btn-primary">保存设置</button>
          </form>
        </section>

        <section class="more-section">
          <h3>API 连接</h3>
          <p class="section-hint">网页会员（ChatGPT Plus / Claude Pro / Gemini Advanced 等）通常不等于 API Key，需要用各家开发者平台生成的密钥。</p>
          <div class="conn-list">
            ${connections.length === 0 ? '<div class="empty-sub">还没有连接，点下面按钮添加一个</div>' : connections.map(connRow).join('')}
          </div>
          <button class="btn-secondary" id="btn-add-conn">＋ 添加连接</button>
        </section>

        <section class="more-section">
          <h3>数据与备份</h3>
          <div class="storage-info">
            <div>数据库：shiguang-db（v${DB_VERSION}）</div>
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
          <p class="section-hint">备份文件不包含 API Key（出于安全考虑），恢复后请重新填写连接密钥。</p>
        </section>

        <section class="more-section">
          <h3>关于 · 使用说明</h3>
          <div class="about-text">
            <p><b>预览地址不是永久存储。</b>请把本应用"添加到主屏幕"安装为 PWA，并定期在上方导出 JSON 备份——更换浏览器、清理网站数据或卸载应用都可能导致本地数据无法访问。</p>
            <p><b>AI 消息都会标注为"AI 生成"</b>，不代表真实人物，请理性看待对话内容。</p>
            <p>更完整的教程见仓库根目录的 <code>README.md</code>。</p>
          </div>
        </section>
      </div>
    `;

    bindEvents();
    refreshCounts();
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

  function bindEvents() {
    const useCustomCb = container.querySelector('#use-custom-colors');
    useCustomCb.addEventListener('change', (e) => {
      container.querySelector('input[name=customAccent]').disabled = !e.target.checked;
    });

    container.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const useCustom = fd.get('useCustomColors') === 'on';
      const updated = {
        ...App.settings,
        workspaceName: fd.get('workspaceName') || '拾光',
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
      document.title = updated.workspaceName || '拾光';
      toast('已保存');
    });

    container.querySelector('#btn-add-conn').addEventListener('click', () => openConnEditor(null));
    container.querySelectorAll('.conn-row').forEach((el) => {
      const id = el.dataset.id;
      const conn = connections.find((c) => c.id === id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openConnEditor(conn));
      el.querySelector('[data-act="delete"]').addEventListener('click', () => deleteConn(conn));
      el.querySelector('[data-act="test"]').addEventListener('click', () => testConn(conn));
    });

    container.querySelector('#btn-export').addEventListener('click', async () => {
      await Backup.exportToFile();
      toast('已导出备份文件');
      refreshCounts();
    });
    container.querySelector('#btn-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const payload = await Backup.readFile(file);
        Backup.validate(payload);
        if (!confirm('导入会用备份文件里的数据覆盖同 ID 的记录（不会清空其他现有数据）。确定要恢复吗？')) return;
        const result = await Backup.importFromPayload(payload);
        toast(`恢复完成：设置${result.counts.settings}项、对话${result.counts.conversations}条、消息${result.counts.messages}条`);
        location.reload();
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    });

    updateBackupStatus();
  }

  async function updateBackupStatus() {
    const lastBackupAt = await DB.getSetting('lastBackupAt');
    container.querySelector('#last-backup-at').textContent = lastBackupAt ? formatRelativeTime(lastBackupAt) : '还没有备份过';
    const persist = await DB.getSetting('persistentStorage');
    const el = container.querySelector('#persist-status');
    if (!persist) el.textContent = '未知';
    else if (!persist.supported) el.textContent = '浏览器不支持';
    else el.textContent = persist.granted ? '已获得持久化权限' : '未获得（浏览器仍可能在空间不足时清理数据）';
  }

  async function refreshCounts() {
    const [conv, msg, bm, mood] = await Promise.all([
      DB.count('conversations'), DB.count('messages'), DB.count('bookmarks'), DB.count('moods'),
    ]);
    const el = container.querySelector('#record-counts');
    if (el) el.textContent = `对话 ${conv} 条 · 消息 ${msg} 条 · 收藏 ${bm} 条 · 心情记录 ${mood} 条`;
  }

  function openConnEditor(item) {
    const isNew = !item;
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>${isNew ? '添加连接' : '编辑连接'}</h3>
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
      </div>
    `;
    document.body.appendChild(dialog);

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
    dialog.querySelector('#conn-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#conn-delete')?.addEventListener('click', () => { dialog.remove(); deleteConn(item); });
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
      dialog.remove();
      connections = await DB.getAll('connections');
      await Chat.refreshConnections();
      render();
    });
  }

  async function deleteConn(item) {
    if (!confirm(`删除连接"${item.name}"？使用它的对话会变成未绑定状态。`)) return;
    await DB.delete('connections', item.id);
    connections = await DB.getAll('connections');
    await Chat.refreshConnections();
    render();
  }

  async function testConn(item) {
    toast('测试中…');
    try {
      const apiKey = item.apiKeyCipher ? await CryptoUtils.decryptText(item.apiKeyCipher, item.apiKeyIv) : '';
      const provider = Providers[item.provider];
      await provider.testConnection(item, apiKey);
      toast('连接成功 ✓');
    } catch (err) {
      alert('连接测试失败：\n' + (err.message || err));
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
