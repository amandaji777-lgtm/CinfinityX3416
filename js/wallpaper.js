// 自定义壁纸：现在只有白金一套主题，不用再分深浅色两份。壁纸存成一份"最近使用
// 历史"（最多 MAX_HISTORY 张，Blob 直接放进 settings 表），外加一个"当前生效"的
// id——换壁纸不再是"覆盖掉唯一那一张"，新上传的图会加进历史最前面，之前用过的
// 图还留在历史里，随时能从"快速选项"里一键切回去，不用重新翻相册上传一遍。
// 不进 JSON 备份——原因和不导出 API Key 一样：图片会让备份文件变得很大又不便于
// 纯文本比对。
const Wallpaper = (() => {
  const HISTORY_KEY = 'wallpaperHistory';
  const CURRENT_KEY = 'wallpaperCurrentId';
  const MAX_HISTORY = 6;
  let currentObjectUrl = null;
  let migrated = null;

  // 兼容这次改版之前的数据：那时候壁纸是按"白金/黑银"两个主题分别存一份
  // （wallpaperLight / wallpaperDark），现在只保留一套主题，把旧数据一次性
  // 搬进新的历史列表里，不会让用户升级后发现自己设的壁纸突然消失。
  async function ensureMigrated() {
    if (migrated) return migrated;
    migrated = (async () => {
      const existingHistory = await DB.getSetting(HISTORY_KEY);
      if (existingHistory !== undefined) return;
      const history = [];
      let currentId = null;
      for (const oldKey of ['wallpaperLight', 'wallpaperDark']) {
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

  // 壁纸自适应取色：把照片画到一块 24×24 的小画布上求平均色相，给玻璃卡片轻轻带一点
  // 照片的色调（12% 权重），明暗固定跟着白金主题走，不跟着照片亮不亮走——避免深色
  // 照片把 --text/--surface 这些全站共用的变量强制翻暗，导致输入框/分段控件这些
  // 地方文字读不清。
  function sampleAverageColor(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = 24; cv.height = 24;
          const g = cv.getContext('2d');
          g.drawImage(img, 0, 0, 24, 24);
          const d = g.getImageData(0, 0, 24, 24).data;
          let r = 0, gg = 0, bb = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
          r = Math.round(r / n); gg = Math.round(gg / n); bb = Math.round(bb / n);
          const lum = (0.2126 * r + 0.7152 * gg + 0.0722 * bb) / 255;
          resolve({ r, g: gg, b: bb, lum });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function mix(channel, target, w) {
    return Math.round(channel + (target - channel) * w);
  }

  function applyAdaptiveTone(sample) {
    const root = document.documentElement.style;
    if (!sample) {
      ['--glass-bg', '--glass-bg-strong', '--glass-border'].forEach((k) => root.removeProperty(k));
      return;
    }
    const base = 248;
    const rr = mix(sample.r, base, 0.88), gg = mix(sample.g, base, 0.88), bb = mix(sample.b, base, 0.88);
    root.setProperty('--glass-bg', `rgba(${rr},${gg},${bb},0.70)`);
    root.setProperty('--glass-bg-strong', `rgba(${Math.min(rr + 4, 255)},${Math.min(gg + 4, 255)},${Math.min(bb + 4, 255)},0.85)`);
    root.setProperty('--glass-border', 'rgba(0,0,0,0.10)');
  }

  async function apply() {
    const layer = document.getElementById('wallpaper-layer');
    if (!layer) return;
    const [history, currentId] = [await getHistory(), await getCurrentId()];
    const entry = history.find((h) => h.id === currentId);
    const blob = entry ? storableToBlob(entry.storable) : null;

    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }

    if (blob instanceof Blob) {
      currentObjectUrl = URL.createObjectURL(blob);
      layer.style.backgroundImage = `url("${currentObjectUrl}")`;
      layer.classList.add('is-active');
      document.documentElement.classList.add('has-wallpaper');
      const sample = await sampleAverageColor(currentObjectUrl);
      applyAdaptiveTone(sample);
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('is-active');
      document.documentElement.classList.remove('has-wallpaper');
      applyAdaptiveTone(null);
    }
  }

  // 新上传一张图：加进历史最前面并立即设为当前，超过 MAX_HISTORY 张就把最旧的
  // 挤出去（正在用的那张即使排到末尾也不会被挤掉，保证"当前壁纸"永远还在历史里）。
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
    await apply();
  }

  // 快速选项：直接从历史里挑一张设为当前，不用重新上传。
  async function selectFromHistory(id) {
    await ensureMigrated();
    await DB.setSetting(CURRENT_KEY, id);
    await apply();
  }

  async function removeFromHistory(id) {
    await ensureMigrated();
    let history = await getHistory();
    history = history.filter((h) => h.id !== id);
    await DB.setSetting(HISTORY_KEY, history);
    const currentId = await getCurrentId();
    if (currentId === id) await DB.setSetting(CURRENT_KEY, null);
    await apply();
  }

  async function clear() {
    await ensureMigrated();
    await DB.setSetting(CURRENT_KEY, null);
    await apply();
  }

  async function has() {
    return !!(await getCurrentId());
  }

  // 给设置页用：把历史列表转成可以直接渲染的 { id, blob, isCurrent } 数组。
  async function list() {
    const [history, currentId] = [await getHistory(), await getCurrentId()];
    return history.map((h) => ({ id: h.id, blob: storableToBlob(h.storable), isCurrent: h.id === currentId }));
  }

  return { apply, set, clear, has, list, selectFromHistory, removeFromHistory };
})();
window.Wallpaper = Wallpaper;
