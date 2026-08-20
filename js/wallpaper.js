// 自定义壁纸：浅色/深色主题可以各自设置一张背景照片，毛玻璃卡片盖在上面。
// 图片存成 Blob 直接放进 settings 表（IndexedDB 原生支持存 Blob，不用转 base64）。
// 不进 JSON 备份——原因和不导出 API Key 一样：图片会让备份文件变得很大又不便于纯文本比对。
const Wallpaper = (() => {
  const KEYS = { light: 'wallpaperLight', 'soft-dark': 'wallpaperDark' };
  let currentObjectUrl = null;

  function keyFor(theme) {
    return KEYS[theme] || KEYS.light;
  }

  async function apply(theme) {
    const layer = document.getElementById('wallpaper-layer');
    if (!layer) return;
    let blob = null;
    try { blob = await DB.getSetting(keyFor(theme)); } catch (_) { blob = null; }

    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }

    if (blob instanceof Blob) {
      currentObjectUrl = URL.createObjectURL(blob);
      layer.style.backgroundImage = `url("${currentObjectUrl}")`;
      layer.classList.add('is-active');
      document.documentElement.classList.add('has-wallpaper');
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('is-active');
      document.documentElement.classList.remove('has-wallpaper');
    }
  }

  async function set(theme, file) {
    await DB.setSetting(keyFor(theme), file);
    await apply(document.documentElement.dataset.theme || 'light');
  }

  async function clear(theme) {
    await DB.setSetting(keyFor(theme), null);
    await apply(document.documentElement.dataset.theme || 'light');
  }

  async function has(theme) {
    const blob = await DB.getSetting(keyFor(theme));
    return blob instanceof Blob;
  }

  return { apply, set, clear, has };
})();
window.Wallpaper = Wallpaper;
