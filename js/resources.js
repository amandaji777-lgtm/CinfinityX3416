// 第6部分：AI 资料库。对方角色卡 / 我的角色卡 / 预设 / 世界书 / 手工长记忆 五个独立区域。
// 每个区域都支持：文字新建（逐项填写或整段粘贴）、编辑、复制、上传 JSON、导出 JSON。
// 统一资源格式：{ $schema, kind, id, name, version, data, source:{type, originalText, createdAt} }
const RESOURCE_SCHEMA = 'workbuddy-ai-resource-v1';

const KIND_META = {
  character: { label: '对方角色卡', short: '对方卡' },
  persona: { label: '我的角色卡', short: '我的卡' },
  preset: { label: '预设', short: '预设' },
  lorebook: { label: '世界书', short: '世界书' },
  longMemory: { label: '手工长记忆', short: '手工长记忆' },
};

// 逐项字段定义：type 为 short(单行) / long(多行) / number / checkbox
const FIELD_SCHEMAS = {
  character: [
    ['name', '姓名', 'short'], ['nickname', '昵称', 'short'], ['addressTerm', '称呼', 'short'],
    ['ageStatus', '年龄/成年状态', 'short'], ['pronouns', '代词', 'short'], ['identity', '身份', 'short'],
    ['appearance', '外貌', 'long'], ['background', '背景', 'long'], ['personality', '核心/内外人格', 'long'],
    ['values', '价值观', 'long'], ['abilityLimits', '能力限制', 'long'], ['relationToUser', '与用户关系', 'long'],
    ['sharedHistory', '共同历史', 'long'], ['expressionStyle', '表达与依恋方式', 'long'], ['habits', '行为习惯', 'long'],
    ['languageStyle', '语言风格', 'long'], ['likesDislikes', '喜欢厌恶', 'long'], ['sensitivePoints', '敏感点', 'long'],
    ['boundaries', '边界', 'long'], ['sceneReactions', '不同场景反应', 'long'], ['forbiddenExpressions', '禁用表达', 'long'],
    ['openingLine', '开场白', 'long'], ['sampleDialogue', '示例对话', 'long'],
  ],
  persona: [
    ['name', '姓名昵称', 'short'], ['preferredAddress', '希望的称呼', 'short'], ['ageStatus', '年龄/成年状态', 'short'],
    ['pronouns', '代词', 'short'], ['identity', '身份', 'short'], ['personality', '性格', 'long'],
    ['background', '背景', 'long'], ['preferencesTaboos', '偏好禁忌', 'long'], ['communicationHabits', '沟通习惯', 'long'],
    ['emotionalNeeds', '情绪需求', 'long'], ['boundaries', '边界', 'long'], ['relationshipHistory', '关系与共同经历', 'long'],
    ['allowedRealInfo', '允许引用的现实信息', 'long'], ['forbiddenRealInfo', '绝不引用的现实信息', 'long'],
  ],
  preset: [
    ['goal', '目标', 'long'], ['perspective', '视角', 'short'], ['language', '语言', 'short'], ['length', '长度', 'short'],
    ['actionDialogueRatio', '动作对白比例', 'short'], ['format', '格式', 'short'], ['coherence', '连贯性', 'long'],
    ['characterAgency', '角色主体性', 'long'], ['gentleOrStrong', '温柔/强势判断', 'long'], ['conflictHandling', '冲突处理', 'long'],
    ['plotProgression', '剧情推进', 'long'], ['forbiddenTics', '禁用口癖', 'long'], ['factFictionBoundary', '事实虚构边界', 'long'],
    ['memoryRules', '记忆规则', 'long'], ['endingHabits', '结尾习惯', 'long'], ['systemPrompt', '系统提示', 'long'],
    ['postHistoryPrompt', '历史后提示', 'long'], ['orderNote', '排列顺序说明', 'long'],
  ],
  longMemory: [
    ['title', '标题', 'short'], ['object', '对象', 'short'], ['timeRangeFrom', '时间范围（起）', 'short'],
    ['timeRangeTo', '时间范围（止）', 'short'], ['facts', '事实', 'long'], ['feelings', '感受', 'long'],
    ['relationshipChange', '关系变化', 'long'], ['stablePreferencesTaboos', '稳定偏好禁忌', 'long'],
    ['unfinishedPromises', '未完成约定', 'long'], ['keywords', '关键词', 'short'], ['credibility', '可信度', 'short'],
    ['source', '来源', 'short'],
  ],
};

// 这三类各自已经有专属的"名字"字段（角色卡叫"姓名"，长记忆叫"标题"），列表标题
// 直接从这个字段派生，不用再单独填一遍"资源名称"——预设/世界书没有这种字段，
// 所以它们还是保留独立的"资源名称"作为唯一的命名入口。
const NAME_DERIVED_FROM_FIELD = {
  character: 'name',
  persona: 'name',
  longMemory: 'title',
};

const LOREBOOK_ENTRY_FIELDS = [
  ['title', '标题', 'short'], ['content', '正文', 'long'],
  ['keywords', '关键词/同义词（逗号分隔）', 'short'], ['priority', '优先级', 'number'],
  ['characterScope', '角色范围', 'short'], ['location', '地点', 'short'], ['rules', '规则', 'long'],
  ['organization', '组织', 'long'], ['relationships', '人物关系', 'long'], ['historyEvents', '历史事件', 'long'],
];

const Resources = (() => {
  let container;
  let all = [];
  let activeKind = 'character';
  let avatarUrls = {};
  let activeCategoryDialog = null; // 当前打开的分区独立页面（Pages.open 返回的根节点），没打开时为 null

  async function init(rootEl) {
    container = rootEl;
    await refresh();
    render();
  }

  async function refresh() {
    all = await DB.getAll('ai_resources');
    avatarUrls = await Avatars.preload(all.filter((r) => r.kind === 'character').map((r) => r.id));
  }

  function byKind(kind) {
    return all.filter((r) => r.kind === kind).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  // 顶层落地页：五个分区各是一行，点进去才是该分区自己的独立页面（Pages 抽屉），
  // 不再是同一屏里切换 segment tab——每个区域感觉上真的是"进了一个地方"而不是"切了个标签"。
  function render() {
    container.innerHTML = `
      <div class="resources-view">
        <div class="view-header">
          <button class="btn-icon" id="res-back">←</button>
          <h2>AI 资料库</h2>
          <span></span>
        </div>
        <nav class="more-glass-list">
          ${Object.entries(KIND_META).map(([k, m]) => resCategoryRow(k, m)).join('')}
        </nav>
      </div>
    `;
    container.querySelector('#res-back').addEventListener('click', () => window.App.switchTab('more'));
    container.querySelectorAll('.more-row[data-kind]').forEach((btn) => {
      btn.addEventListener('click', () => openCategoryPage(btn.dataset.kind));
    });
  }

  function resCategoryRow(kind, meta) {
    const count = byKind(kind).length;
    return `
      <button type="button" class="more-row" data-kind="${kind}">
        <span class="more-row-body">
          <div class="more-row-label">${meta.label}</div>
          <div class="more-row-sub">${count} 条</div>
        </span>
        <span class="more-row-chevron">›</span>
      </button>
    `;
  }

  // 分区独立页面：整页抽屉（跟 API 连接/头像/壁纸那些设置页是同一套 Pages 组件），
  // 顶部工具栏 + 卡片列表，自带返回按钮，返回就回到上面的五分区落地页。
  function openCategoryPage(kind) {
    activeKind = kind;
    const dialog = Pages.open(KIND_META[kind].label, categoryBodyHTML(kind));
    activeCategoryDialog = dialog;
    dialog.querySelector('.page-back').addEventListener('click', () => {
      if (activeCategoryDialog === dialog) activeCategoryDialog = null;
      render(); // 分区页面关闭、回到落地页时，条数可能已经变了，重画一下落地列表
    });
    bindCategoryEvents(dialog, kind);
  }

  function categoryBodyHTML(kind) {
    const list = byKind(kind);
    return `
      <div class="res-toolbar">
        <button class="btn-secondary" id="res-new-text">＋ 文字新建</button>
        <label class="btn-secondary file-btn">上传 JSON<input type="file" id="res-import" accept="application/json" hidden></label>
      </div>
      <div class="res-list">
        ${list.length === 0 ? emptyState('这个区域还没有内容', '点上面"文字新建"逐项填写，或粘贴一段自然语言') :
          list.map(resCard).join('')}
      </div>
    `;
  }

  function bindCategoryEvents(dialog, kind) {
    dialog.querySelector('#res-new-text').addEventListener('click', () => openEditor(kind, null));
    dialog.querySelector('#res-import').addEventListener('change', handleImportFile);
    dialog.querySelectorAll('.res-card').forEach((el) => {
      const id = el.dataset.id;
      const item = all.find((r) => r.id === id);
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openEditor(kind, item));
      el.querySelector('[data-act="dup"]').addEventListener('click', () => duplicateResource(item));
      el.querySelector('[data-act="export"]').addEventListener('click', () => exportResource(item));
      el.querySelector('[data-act="linkstatus"]')?.addEventListener('click', () => window.LinkStatus.openManager(item));
      el.querySelector('[data-act="delete"]').addEventListener('click', () => deleteResource(item));
    });
  }

  // 分区页里增删改之后：如果这个分区页面还开着，就地刷新它的列表，不整页重开；
  // 落地页的每分区条数会在下次进 AI 资料库时（Resources.init 重新跑）自然更新。
  function refreshCategoryView() {
    if (!activeCategoryDialog || !activeCategoryDialog.isConnected) { activeCategoryDialog = null; return; }
    const dialog = activeCategoryDialog;
    dialog.querySelector('.page-body').innerHTML = categoryBodyHTML(activeKind);
    bindCategoryEvents(dialog, activeKind);
  }

  function resCard(r) {
    const preview = summarize(r);
    const avatarUrl = r.kind === 'character' ? avatarUrls[r.id] : null;
    return `
      <div class="res-card" data-id="${r.id}">
        <div class="res-card-top">
          <div class="res-card-name-row">
            ${r.kind === 'character' ? `<div class="conv-avatar res-card-avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="">` : escapeHtml((r.name || '角')[0] || '角')}</div>` : ''}
            <b>${escapeHtml(r.name || '未命名')}</b>
          </div>
          <span class="res-source-tag">${r.source?.type === 'imported-json' ? 'JSON导入' : '文字创建'}</span>
        </div>
        <div class="res-card-preview">${escapeHtml(truncate(preview, 100))}</div>
        <div class="res-card-actions">
          <button class="msg-act" data-act="edit">编辑</button>
          <button class="msg-act" data-act="dup">复制</button>
          <button class="msg-act" data-act="export">导出JSON</button>
          ${r.kind === 'character' ? '<button class="msg-act" data-act="linkstatus">每日链接状态</button>' : ''}
          <button class="msg-act" data-act="delete">删除</button>
        </div>
      </div>
    `;
  }

  function summarize(r) {
    if (r.kind === 'lorebook') return (r.data.entries || []).map((e) => e.title).filter(Boolean).join(' / ') || (r.source?.originalText || '');
    const fields = FIELD_SCHEMAS[r.kind] || [];
    for (const [key] of fields) {
      if (r.data[key]) return r.data[key];
    }
    return r.source?.originalText || '';
  }

  // ---- 编辑器：逐项填写 / 粘贴文本 两种模式，确认前都会有 JSON 预览 ----
  function openEditor(kind, item) {
    const isNew = !item;
    // 角色卡/我的角色卡/手工长记忆这三类的"名字"就用它们各自专属的字段（姓名/标题）——
    // 那个字段单独拎到"逐项填写/整段粘贴"两个模式切换的上面，两种模式下都看得见、
    // 填得到，不会切到"整段粘贴"就找不到填名字的地方。预设/世界书没有专属名字字段，
    // 还是用通用的"资源名称"。
    const derivedField = NAME_DERIVED_FROM_FIELD[kind];
    const nameLabel = derivedField ? FIELD_SCHEMAS[kind].find(([k]) => k === derivedField)[1] : '资源名称';
    // 兼容这次改版之前存的旧数据：那时候"资源名称"和这个专属字段是分开填的，
    // 可能只填了其中一个——编辑时优先用专属字段的值，没有就退回旧的资源名称，
    // 不会让本来填过名字的老角色卡打开后突然变成空的。
    const nameValue = derivedField ? (item?.data?.[derivedField] || item?.name || '') : (item?.name || '');
    const dialog = Pages.open(`${isNew ? '新建' : '编辑'}${KIND_META[kind].label}`, `
      ${kind === 'character' ? `
        <div class="avatar-upload-row">
          <div class="avatar-preview" id="res-avatar-preview">…</div>
          <div class="avatar-upload-actions">
            <label class="btn-secondary file-btn">更换头像<input type="file" accept="image/*" id="res-avatar-input" hidden></label>
            <button type="button" class="msg-act" id="res-avatar-clear" style="display:none">移除头像</button>
          </div>
        </div>
      ` : ''}
      <div class="seg-row" id="mode-row">
        <label class="seg-option"><input type="radio" name="mode" value="fields" checked><span>逐项填写</span></label>
        <label class="seg-option"><input type="radio" name="mode" value="paste"><span>整段粘贴</span></label>
      </div>
      <label class="field"><span>${nameLabel}</span><input id="res-name" ${derivedField ? `data-field="${derivedField}"` : ''} value="${escapeAttr(nameValue)}" maxlength="30" required></label>
      <div id="fields-mode">
        ${kind === 'lorebook' ? lorebookEntriesEditor(item) : fieldsForm(kind, item?.data || {}, derivedField)}
      </div>
      <div id="paste-mode" style="display:none">
        <label class="field"><span>粘贴自然语言描述（缺项就空着，系统不会编造）</span>
          <textarea id="paste-text" rows="8" placeholder="把你已有的设定原文粘贴进来...">${escapeHtml(item?.source?.originalText || '')}</textarea>
        </label>
      </div>
      <div class="modal-actions">
        ${!isNew ? '<button type="button" class="btn-danger" id="res-delete">删除</button>' : ''}
        <button type="button" class="btn-secondary" id="res-cancel">取消</button>
        <button type="button" class="btn-primary" id="res-preview">预览并保存</button>
      </div>
    `);

    dialog.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', (e) => {
      dialog.querySelector('#fields-mode').style.display = e.target.value === 'fields' ? '' : 'none';
      dialog.querySelector('#paste-mode').style.display = e.target.value === 'paste' ? '' : 'none';
    }));
    if (kind === 'lorebook') bindLorebookEntryEvents(dialog);

    let pendingAvatarFile = null;
    let pendingAvatarClear = false;
    let tempAvatarUrl = null;
    if (kind === 'character') {
      const previewEl = dialog.querySelector('#res-avatar-preview');
      const clearBtn = dialog.querySelector('#res-avatar-clear');
      const fallbackLetter = () => escapeHtml(((dialog.querySelector('#res-name').value || item?.name || '角').trim())[0] || '角');
      const refreshAvatarPreview = async () => {
        if (tempAvatarUrl) { URL.revokeObjectURL(tempAvatarUrl); tempAvatarUrl = null; }
        if (pendingAvatarClear) {
          previewEl.innerHTML = fallbackLetter();
          clearBtn.style.display = 'none';
          return;
        }
        if (pendingAvatarFile) {
          tempAvatarUrl = URL.createObjectURL(pendingAvatarFile);
          previewEl.innerHTML = `<img src="${tempAvatarUrl}" alt="">`;
          clearBtn.style.display = '';
          return;
        }
        const url = item ? await Avatars.urlFor(item.id) : null;
        previewEl.innerHTML = url ? `<img src="${url}" alt="">` : fallbackLetter();
        clearBtn.style.display = url ? '' : 'none';
      };
      refreshAvatarPreview();
      dialog.querySelector('#res-avatar-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { await UIDialog.alert('请选择图片文件'); return; }
        pendingAvatarFile = file;
        pendingAvatarClear = false;
        refreshAvatarPreview();
      });
      clearBtn.addEventListener('click', () => {
        pendingAvatarFile = null;
        pendingAvatarClear = true;
        refreshAvatarPreview();
      });
    }

    dialog.querySelector('#res-cancel').addEventListener('click', () => {
      if (tempAvatarUrl) URL.revokeObjectURL(tempAvatarUrl);
      Pages.close(dialog);
    });
    dialog.querySelector('#res-delete')?.addEventListener('click', () => { Pages.close(dialog); deleteResource(item); });
    dialog.querySelector('#res-preview').addEventListener('click', async () => {
      const name = dialog.querySelector('#res-name').value.trim();
      if (!name) { await UIDialog.alert(`请填写${nameLabel}`); return; }
      const mode = dialog.querySelector('input[name=mode]:checked').value;
      let data, originalText = '', sourceType;
      if (mode === 'paste') {
        originalText = dialog.querySelector('#paste-text').value.trim();
        data = kind === 'lorebook' ? { entries: [] } : {};
        sourceType = 'manual-text';
      } else {
        data = kind === 'lorebook' ? { entries: collectLorebookEntries(dialog) } : collectFields(kind, dialog);
        sourceType = item?.source?.type === 'imported-json' ? 'imported-json' : 'manual-text';
        originalText = item?.source?.originalText || '';
      }
      const avatarChange = kind === 'character' && (pendingAvatarFile || pendingAvatarClear)
        ? { file: pendingAvatarFile, clear: pendingAvatarClear } : null;
      showPreviewThenSave(dialog, {
        id: item?.id || uuid(),
        kind, name, data, sourceType, originalText,
        createdAt: item?.source?.createdAt || nowISO(),
      }, avatarChange);
    });
  }

  function fieldsForm(kind, data, excludeKey) {
    return (FIELD_SCHEMAS[kind] || []).filter(([key]) => key !== excludeKey).map(([key, label, type]) => `
      <label class="field"><span>${label}</span>
        ${type === 'long'
          ? `<textarea data-field="${key}" rows="2">${escapeHtml(data[key] || '')}</textarea>`
          : `<input data-field="${key}" value="${escapeAttr(data[key] || '')}">`}
      </label>
    `).join('');
  }

  function collectFields(kind, dialog) {
    const data = {};
    dialog.querySelectorAll('[data-field]').forEach((el) => {
      const v = el.value.trim();
      if (v) data[el.dataset.field] = v;
    });
    return data;
  }

  function lorebookEntriesEditor(item) {
    const entries = item?.data?.entries || [];
    return `
      <div class="lb-entries" id="lb-entries" data-entries='${escapeAttr(JSON.stringify(entries))}'>
        <div class="lb-entries-list" id="lb-entries-list">${entries.map((e, i) => lorebookEntryRow(e, i)).join('')}</div>
        <button type="button" class="btn-secondary" id="lb-add-entry">＋ 添加条目</button>
      </div>
    `;
  }

  function lorebookEntryRow(entry, i) {
    return `
      <div class="lb-entry-row" data-idx="${i}">
        <div class="lb-entry-top">
          <b>${escapeHtml(entry.title || '未命名条目')}</b>
          <label class="field-inline-sm"><input type="checkbox" class="lb-enabled" ${entry.enabled !== false ? 'checked' : ''}> 启用</label>
        </div>
        <label class="field-inline-sm">触发方式
          <select class="lb-trigger">
            <option value="always" ${entry.triggerMode !== 'keyword' ? 'selected' : ''}>常驻</option>
            <option value="keyword" ${entry.triggerMode === 'keyword' ? 'selected' : ''}>关键词触发</option>
          </select>
        </label>
        <label class="field-inline-sm">插入位置
          <select class="lb-position">
            <option value="top" ${(entry.insertPosition || 'top') === 'top' ? 'selected' : ''}>靠前</option>
            <option value="bottom" ${entry.insertPosition === 'bottom' ? 'selected' : ''}>靠后</option>
          </select>
        </label>
        ${LOREBOOK_ENTRY_FIELDS.map(([key, label, type]) => `
          <label class="field"><span>${label}</span>
            ${type === 'long'
              ? `<textarea data-lbfield="${key}" rows="2">${escapeHtml(entry[key] || '')}</textarea>`
              : `<input data-lbfield="${key}" type="${type === 'number' ? 'number' : 'text'}" value="${escapeAttr(entry[key] ?? '')}">`}
          </label>
        `).join('')}
        <button type="button" class="btn-danger lb-remove">删除此条目</button>
      </div>
    `;
  }

  function bindLorebookEntryEvents(dialog) {
    dialog.querySelector('#lb-add-entry').addEventListener('click', () => {
      const list = dialog.querySelector('#lb-entries-list');
      const idx = list.children.length;
      list.insertAdjacentHTML('beforeend', lorebookEntryRow({}, idx));
      bindEntryRemoves(dialog);
    });
    bindEntryRemoves(dialog);
  }
  function bindEntryRemoves(dialog) {
    dialog.querySelectorAll('.lb-remove').forEach((btn) => {
      btn.onclick = () => btn.closest('.lb-entry-row').remove();
    });
  }

  function collectLorebookEntries(dialog) {
    return Array.from(dialog.querySelectorAll('.lb-entry-row')).map((row) => {
      const entry = {
        enabled: row.querySelector('.lb-enabled').checked,
        triggerMode: row.querySelector('.lb-trigger').value,
        insertPosition: row.querySelector('.lb-position').value,
      };
      row.querySelectorAll('[data-lbfield]').forEach((el) => {
        const v = el.value.trim ? el.value.trim() : el.value;
        if (v !== '') entry[el.dataset.lbfield] = el.dataset.lbfield === 'priority' ? Number(v) : v;
      });
      return entry;
    });
  }

  function showPreviewThenSave(dialog, draft, avatarChange) {
    const resource = {
      $schema: RESOURCE_SCHEMA,
      kind: draft.kind,
      id: draft.id,
      name: draft.name,
      version: 1,
      data: draft.data,
      source: { type: draft.sourceType, originalText: draft.originalText, createdAt: draft.createdAt },
      updatedAt: nowISO(),
    };
    const previewDialog = document.createElement('div');
    previewDialog.className = 'modal-overlay';
    previewDialog.innerHTML = `
      <div class="modal-card">
        <h3>确认保存</h3>
        <pre class="json-preview">${escapeHtml(JSON.stringify(resource, null, 2))}</pre>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="pv-cancel">返回修改</button>
          <button type="button" class="btn-primary" id="pv-confirm">确认保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(previewDialog);
    previewDialog.querySelector('#pv-cancel').addEventListener('click', () => previewDialog.remove());
    previewDialog.querySelector('#pv-confirm').addEventListener('click', async () => {
      await DB.put('ai_resources', resource);
      let avatarError = null;
      if (avatarChange) {
        try {
          if (avatarChange.clear) await Avatars.clear(resource.id);
          else if (avatarChange.file) await Avatars.set(resource.id, avatarChange.file);
        } catch (err) {
          avatarError = err?.message || '未知错误';
        }
      }
      previewDialog.remove();
      Pages.close(dialog);
      await refresh();
      refreshCategoryView();
      if (window.Chat) await window.Chat.refreshAvatars();
      if (avatarError) await UIDialog.alert('资料卡已保存，但头像设置失败：' + avatarError + '，换一张小一点的图片再试一次');
      else toast('已保存');
    });
  }

  async function duplicateResource(item) {
    const copy = { ...item, id: uuid(), name: item.name + ' 副本', updatedAt: nowISO() };
    await DB.put('ai_resources', copy);
    await refresh();
    refreshCategoryView();
  }

  function exportResource(item) {
    const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${KIND_META[item.kind].short}-${item.name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function deleteResource(item) {
    if (!await UIDialog.confirm(`删除"${item.name}"？正在使用它的对话不会自动清空绑定，只是会读取不到内容。`, { danger: true, okLabel: '删除' })) return;
    await DB.delete('ai_resources', item.id);
    if (item.kind === 'character') await Avatars.clear(item.id);
    await refresh();
    refreshCategoryView();
    if (window.Chat) await window.Chat.refreshAvatars();
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.kind || !FIELD_SCHEMAS[json.kind] && json.kind !== 'lorebook') {
        throw new Error('无法识别的资源类型（kind 字段缺失或不支持）');
      }
      // 导入预览校验，原始文件内容只读保留在 rawImport 里，不覆盖 originalText。
      openImportPreview(json, file.name);
    } catch (err) {
      await UIDialog.alert('导入失败：' + err.message);
    }
    e.target.value = '';
  }

  function openImportPreview(json, filename) {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-card">
        <h3>导入预览：${escapeHtml(filename)}</h3>
        <p class="section-hint">识别为「${KIND_META[json.kind]?.label || json.kind}」，会作为 ${activeKind === json.kind ? '当前区域的' : ''}新资源导入，不会自动分类到其他区域。</p>
        <pre class="json-preview">${escapeHtml(JSON.stringify(json, null, 2))}</pre>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="imp-cancel">取消</button>
          <button type="button" class="btn-primary" id="imp-confirm">确认导入</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#imp-cancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#imp-confirm').addEventListener('click', async () => {
      const resource = {
        $schema: RESOURCE_SCHEMA,
        kind: json.kind,
        id: uuid(),
        name: json.name || '导入的资源',
        version: json.version || 1,
        data: json.data || {},
        source: { type: 'imported-json', originalText: JSON.stringify(json), createdAt: nowISO() },
        updatedAt: nowISO(),
      };
      await DB.put('ai_resources', resource);
      dialog.remove();
      await refresh();
      refreshCategoryView();
      toast('导入成功' + (json.kind !== activeKind ? `，已存入「${KIND_META[json.kind]?.label || json.kind}」` : ''));
    });
  }

  return { init, refresh, byKind, KIND_META, get all() { return all; } };
})();
