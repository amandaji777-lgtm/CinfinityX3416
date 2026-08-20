// 头像：AI 角色卡头像 + 用户自己的头像。跟壁纸走一样的模式——Blob 存进 settings 表，
// 按需转成 object URL 显示，不会被塞进 JSON 备份（图片不适合塞进纯文本备份）。
// 键名：角色头像 charAvatar:<resourceId>，用户自己的头像 userAvatar（resourceId 传 null/undefined）。
const Avatars = (() => {
  const urlCache = new Map(); // key -> objectURL，避免同一头像被重复创建 URL 造成泄漏

  function keyFor(resourceId) {
    return resourceId ? `charAvatar:${resourceId}` : 'userAvatar';
  }

  async function getBlob(resourceId) {
    try {
      const v = await DB.getSetting(keyFor(resourceId));
      return v instanceof Blob ? v : null;
    } catch (_) {
      return null;
    }
  }

  function invalidate(resourceId) {
    const key = keyFor(resourceId);
    const old = urlCache.get(key);
    if (old) { URL.revokeObjectURL(old); urlCache.delete(key); }
  }

  async function set(resourceId, file) {
    await DB.setSetting(keyFor(resourceId), file);
    invalidate(resourceId);
  }

  async function clear(resourceId) {
    await DB.setSetting(keyFor(resourceId), null);
    invalidate(resourceId);
  }

  async function urlFor(resourceId) {
    const key = keyFor(resourceId);
    if (urlCache.has(key)) return urlCache.get(key);
    const blob = await getBlob(resourceId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  }

  // 批量预取：聊天页渲染消息列表是同步模板拼接，没法逐条 await，
  // 所以先一次性把用到的头像 URL 取出来缓存，模板里直接读缓存。
  async function preload(resourceIds) {
    const ids = [null, ...new Set(resourceIds.filter(Boolean))];
    const map = {};
    await Promise.all(ids.map(async (id) => {
      map[id === null ? 'user' : id] = await urlFor(id);
    }));
    return map;
  }

  async function has(resourceId) {
    return !!(await getBlob(resourceId));
  }

  return { set, clear, urlFor, preload, has };
})();
window.Avatars = Avatars;
