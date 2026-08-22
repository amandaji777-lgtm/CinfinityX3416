// 开屏自定义背景照片：跟壁纸一样，白金/黑银两套主题可以各自设一张，不设就用
// 主题自己的纯色背景（黑银黑色/白金白色），不再有内置默认图。同样是 Blob 存进
// settings 表，不进 JSON 备份（原因和壁纸/头像一样：图片不适合塞进纯文本备份）。
const SplashPhoto = (() => {
  const KEYS = { light: 'splashPhotoLight', 'soft-dark': 'splashPhotoDark' };
  let currentObjectUrl = null;

  function keyFor(theme) {
    return KEYS[theme] || KEYS.light;
  }

  async function urlFor(theme) {
    let blob = null;
    try { blob = storableToBlob(await DB.getSetting(keyFor(theme))); } catch (_) { blob = null; }
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    if (blob instanceof Blob) {
      currentObjectUrl = URL.createObjectURL(blob);
      return currentObjectUrl;
    }
    return null;
  }

  async function set(theme, file) {
    await DB.setSetting(keyFor(theme), await blobToStorable(file));
  }

  async function clear(theme) {
    await DB.setSetting(keyFor(theme), null);
  }

  async function has(theme) {
    const blob = storableToBlob(await DB.getSetting(keyFor(theme)));
    return blob instanceof Blob;
  }

  return { urlFor, set, clear, has };
})();
window.SplashPhoto = SplashPhoto;
