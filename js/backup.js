// JSON 全量导入导出。API Key 密文/设备密钥不会被导出，避免备份文件泄露密钥。
const Backup = (() => {
  async function exportAll() {
    const [settings, connections, conversations, messages, bookmarks, moods] = await Promise.all([
      DB.getAll('settings'),
      DB.getAll('connections'),
      DB.getAll('conversations'),
      DB.getAll('messages'),
      DB.getAll('bookmarks'),
      DB.getAll('moods'),
    ]);

    const safeConnections = connections.map(({ apiKeyCipher, apiKeyIv, ...rest }) => rest);

    return {
      schema: 'shiguang-backup-v1',
      exportedAt: nowISO(),
      dbVersion: DB_VERSION,
      data: { settings, connections: safeConnections, conversations, messages, bookmarks, moods },
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

  // 恢复：逐表覆盖式导入，导入前需要调用方二次确认。
  async function importFromPayload(payload) {
    validate(payload);
    const { settings, connections, conversations, messages, bookmarks, moods } = payload.data;
    const tasks = [];
    for (const row of settings || []) tasks.push(DB.put('settings', row));
    for (const row of connections || []) tasks.push(DB.put('connections', row));
    for (const row of conversations || []) tasks.push(DB.put('conversations', row));
    for (const row of messages || []) tasks.push(DB.put('messages', row));
    for (const row of bookmarks || []) tasks.push(DB.put('bookmarks', row));
    for (const row of moods || []) tasks.push(DB.put('moods', row));
    await Promise.all(tasks);
    return {
      counts: {
        settings: (settings || []).length,
        connections: (connections || []).length,
        conversations: (conversations || []).length,
        messages: (messages || []).length,
        bookmarks: (bookmarks || []).length,
        moods: (moods || []).length,
      },
    };
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
