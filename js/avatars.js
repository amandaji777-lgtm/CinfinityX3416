// 头像：AI 角色卡头像 + 用户自己的头像。跟壁纸走一样的模式——Blob 存进 settings 表，
// 按需转成 object URL 显示，不会被塞进 JSON 备份（图片不适合塞进纯文本备份）。
// 键名：角色头像 charAvatar:<resourceId>，用户自己的头像 userAvatar（resourceId 传 null/undefined）。
const Avatars = (() => {
  const urlCache = new Map(); // key -> objectURL，避免同一头像被重复创建 URL 造成泄漏

  function keyFor(resourceId) {
    return resourceId ? `charAvatar:${resourceId}` : 'userAvatar';
  }

  // 头像原本直接存手机相机原图，跟壁纸一样容易在真机/内嵌浏览器上因为配额限制
  // 悄悄写入失败（界面却显示"已更新"）。上传前先压到长边 500px 足够圆形头像清晰度用了。
  function resizeImageFile(file, maxDim = 500, quality = 0.85) {
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

  async function getBlob(resourceId) {
    try {
      const v = await DB.getSetting(keyFor(resourceId));
      return storableToBlob(v);
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
    const resized = await resizeImageFile(file);
    await DB.setSetting(keyFor(resourceId), await blobToStorable(resized));
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
