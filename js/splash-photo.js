// 开屏自定义背景照片：跟壁纸一样，现在只有白金一套主题，也是"最近历史 + 当前生效
// 一张"的模式，不设就用主题自己的纯色背景。同样是 Blob 存进 settings 表，不进 JSON
// 备份（原因和壁纸/头像一样：图片不适合塞进纯文本备份）。
const SplashPhoto = (() => {
  const HISTORY_KEY = 'splashPhotoHistory';
  const CURRENT_KEY = 'splashPhotoCurrentId';
  const MAX_HISTORY = 6;
  let currentObjectUrl = null;
  let migrated = null;

  // 兼容改版之前按"白金/黑银"两个主题分别存一份（splashPhotoLight / splashPhotoDark）
  // 的旧数据，一次性搬进新的历史列表。
  async function ensureMigrated() {
    if (migrated) return migrated;
    migrated = (async () => {
      const existingHistory = await DB.getSetting(HISTORY_KEY);
      if (existingHistory !== undefined) return;
      const history = [];
      let currentId = null;
      for (const oldKey of ['splashPhotoLight', 'splashPhotoDark']) {
        const storable = await DB.getSetting(oldKey);
        if (!storableToBlob(storable)) continue;
        const id = uuid();
        history.push({ id, storable, createdAt: nowISO() });
        if (!currentId) currentId = id;
      }
      await DB.setSetting(HISTORY_KEY, history);
      await DB.setSetting(CURRENT_KEY, currentId);
    })();
    return migrated;
  }

  async function getHistory() {
    await ensureMigrated();
    return (await DB.getSetting(HISTORY_KEY)) || [];
  }

  async function getCurrentId() {
    await ensureMigrated();
    return (await DB.getSetting(CURRENT_KEY)) || null;
  }

  async function urlFor() {
    const history = await getHistory();
    const currentId = await getCurrentId();
    const entry = history.find((h) => h.id === currentId);
    const blob = entry ? storableToBlob(entry.storable) : null;
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    if (blob instanceof Blob) {
      currentObjectUrl = URL.createObjectURL(blob);
      return currentObjectUrl;
    }
    return null;
  }

  async function set(file) {
    await ensureMigrated();
    const storable = await blobToStorable(file);
    const id = uuid();
    let history = await getHistory();
    history = [{ id, storable, createdAt: nowISO() }, ...history];
    if (history.length > MAX_HISTORY) {
      const currentId = await getCurrentId();
      const keep = history.slice(0, MAX_HISTORY);
      if (!keep.some((h) => h.id === currentId)) {
        const currentEntry = history.find((h) => h.id === currentId);
        if (currentEntry) keep[keep.length - 1] = currentEntry;
      }
      history = keep;
    }
    await DB.setSetting(HISTORY_KEY, history);
    await DB.setSetting(CURRENT_KEY, id);
  }

  async function selectFromHistory(id) {
    await ensureMigrated();
    await DB.setSetting(CURRENT_KEY, id);
  }

  async function removeFromHistory(id) {
    await ensureMigrated();
    let history = await getHistory();
    history = history.filter((h) => h.id !== id);
    await DB.setSetting(HISTORY_KEY, history);
    const currentId = await getCurrentId();
    if (currentId === id) await DB.setSetting(CURRENT_KEY, null);
  }

  async function clear() {
    await ensureMigrated();
    await DB.setSetting(CURRENT_KEY, null);
  }

  async function has() {
    return !!(await getCurrentId());
  }

  async function list() {
    const [history, currentId] = [await getHistory(), await getCurrentId()];
    return history.map((h) => ({ id: h.id, blob: storableToBlob(h.storable), isCurrent: h.id === currentId }));
  }

  return { urlFor, set, clear, has, list, selectFromHistory, removeFromHistory };
})();
window.SplashPhoto = SplashPhoto;
