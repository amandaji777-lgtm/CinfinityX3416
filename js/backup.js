// JSON 全量导入导出。API Key 密文/设备密钥不会被导出，避免备份文件泄露密钥。
const Backup = (() => {
  // 壁纸是 Blob，JSON.stringify 序列化不了，也没必要塞进纯文本备份里——和不导出 API Key 一个道理。
  const EXCLUDED_SETTING_KEYS = ['wallpaperLight', 'wallpaperDark'];

  async function exportAll() {
    const data = {};
    for (const store of DB.STORE_NAMES) {
      data[store] = await DB.getAll(store);
    }
    data.connections = data.connections.map(({ apiKeyCipher, apiKeyIv, ...rest }) => rest);
    data.settings = data.settings.filter((row) => !EXCLUDED_SETTING_KEYS.includes(row.key));

    return {
      schema: 'shiguang-backup-v1',
      exportedAt: nowISO(),
      dbVersion: DB_VERSION,
      data,
      note: 'API Key 出于安全考虑不包含在备份中，恢复后需要重新填写。',
    };
  }

  function download(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportToFile() {
    const payload = await exportAll();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    download(`shiguang-backup-${stamp}.json`, payload);
    await DB.setSetting('lastBackupAt', nowISO());
    return payload;
  }

  function validate(payload) {
    if (!payload || payload.schema !== 'shiguang-backup-v1' || !payload.data) {
      throw new Error('这不是一个可识别的备份文件（schema 不匹配）。');
    }
  }

  // 恢复：逐表覆盖式导入，导入前需要调用方二次确认。旧版本备份文件缺少的表按空数组处理。
  async function importFromPayload(payload) {
    validate(payload);
    const tasks = [];
    const counts = {};
    for (const store of DB.STORE_NAMES) {
      const rows = payload.data[store] || [];
      counts[store] = rows.length;
      for (const row of rows) tasks.push(DB.put(store, row));
    }
    await Promise.all(tasks);
    return { counts };
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (e) {
          reject(new Error('文件不是合法的 JSON。'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  return { exportAll, exportToFile, importFromPayload, readFile, validate };
})();
