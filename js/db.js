// 固定数据库名与版本；升级时只新增/迁移，不删除已有数据。
const DB_NAME = 'shiguang-db';
const DB_VERSION = 3;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        db.createObjectStore('settings', { keyPath: 'key' });

        const connections = db.createObjectStore('connections', { keyPath: 'id' });
        connections.createIndex('createdAt', 'createdAt');

        const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
        conversations.createIndex('updatedAt', 'updatedAt');

        const messages = db.createObjectStore('messages', { keyPath: 'id' });
        messages.createIndex('conversationId', 'conversationId');
        messages.createIndex('createdAt', 'createdAt');

        const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bookmarks.createIndex('createdAt', 'createdAt');
        bookmarks.createIndex('conversationId', 'conversationId');

        const moods = db.createObjectStore('moods', { keyPath: 'id' });
        moods.createIndex('date', 'date');
        moods.createIndex('time', 'time');

        // 设备本地密钥，不随备份导出，不出现在任何导出/日志文件里。
        db.createObjectStore('device_key', { keyPath: 'id' });
      }

      if (oldVersion < 2) {
        // 第6部分：AI 资料库五区（character/persona/preset/lorebook/longMemory）统一存放。
        const resources = db.createObjectStore('ai_resources', { keyPath: 'id' });
        resources.createIndex('kind', 'kind');
        resources.createIndex('updatedAt', 'updatedAt');

        // 第8部分：独立长记忆（自动摘要，区别于第6部分的手工长记忆资源卡）。
        const memories = db.createObjectStore('ai_memories', { keyPath: 'id' });
        memories.createIndex('conversationId', 'conversationId');
        memories.createIndex('generatedAt', 'generatedAt');

        // 第5部分：每日链接状态，按角色资源 id + 日期。
        const linkStatus = db.createObjectStore('link_daily_status', { keyPath: 'id' });
        linkStatus.createIndex('characterId', 'characterId');
        linkStatus.createIndex('date', 'date');

        // 第9部分：角色主动消息触发审计记录。
        const proactiveLog = db.createObjectStore('proactive_log', { keyPath: 'id' });
        proactiveLog.createIndex('conversationId', 'conversationId');
        proactiveLog.createIndex('triggeredAt', 'triggeredAt');
      }

      if (oldVersion < 3) {
        // 潮汐：例假/生理周期每日记录（流量/疼痛/心情标签/欲望），按日期查询。
        const cycleLogs = db.createObjectStore('cycle_logs', { keyPath: 'id' });
        cycleLogs.createIndex('date', 'date');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('数据库被其他标签页占用，请关闭其他窗口后重试。'));
  });
  return dbPromise;
}

function tx(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('事务已中止'));
    Promise.resolve(fn(transaction)).then((r) => { result = r; }).catch(reject);
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async put(storeName, value) {
    return tx([storeName], 'readwrite', (t) => reqToPromise(t.objectStore(storeName).put(value)));
  },
  async get(storeName, key) {
    return tx([storeName], 'readonly', (t) => reqToPromise(t.objectStore(storeName).get(key)));
  },
  async delete(storeName, key) {
    return tx([storeName], 'readwrite', (t) => reqToPromise(t.objectStore(storeName).delete(key)));
  },
  async getAll(storeName) {
    return tx([storeName], 'readonly', (t) => reqToPromise(t.objectStore(storeName).getAll()));
  },
  async getAllByIndex(storeName, indexName, query) {
    return tx([storeName], 'readonly', (t) =>
      reqToPromise(t.objectStore(storeName).index(indexName).getAll(query)));
  },
  async count(storeName) {
    return tx([storeName], 'readonly', (t) => reqToPromise(t.objectStore(storeName).count()));
  },
  async clear(storeName) {
    return tx([storeName], 'readwrite', (t) => reqToPromise(t.objectStore(storeName).clear()));
  },

  // ---- settings 是 key -> {key, value} 的简单表，这里封装成更好用的读写 ----
  async getSetting(key, fallback) {
    const row = await DB.get('settings', key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    return DB.put('settings', { key, value });
  },

  async requestPersistentStorage() {
    if (!(navigator.storage && navigator.storage.persist)) {
      return { supported: false, granted: false };
    }
    try {
      const granted = await navigator.storage.persist();
      return { supported: true, granted };
    } catch (e) {
      return { supported: true, granted: false, error: String(e) };
    }
  },

  async estimateUsage() {
    if (!(navigator.storage && navigator.storage.estimate)) return null;
    try {
      return await navigator.storage.estimate();
    } catch (e) {
      return null;
    }
  },

  STORE_NAMES: [
    'settings', 'connections', 'conversations', 'messages', 'bookmarks', 'moods',
    'ai_resources', 'ai_memories', 'link_daily_status', 'proactive_log',
  ],
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO() {
  return new Date().toISOString();
}
