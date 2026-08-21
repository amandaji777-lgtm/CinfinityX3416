// 自定义壁纸：浅色/深色主题可以各自设置一张背景照片，毛玻璃卡片盖在上面。
// 图片存成 Blob 直接放进 settings 表（IndexedDB 原生支持存 Blob，不用转 base64）。
// 不进 JSON 备份——原因和不导出 API Key 一样：图片会让备份文件变得很大又不便于纯文本比对。
const Wallpaper = (() => {
  const KEYS = { light: 'wallpaperLight', 'soft-dark': 'wallpaperDark' };
  let currentObjectUrl = null;

  function keyFor(theme) {
    return KEYS[theme] || KEYS.light;
  }

  // 壁纸自适应取色：把照片画到一块 24×24 的小画布上求平均色和亮度——不管你选的是
  // 白金还是黑银主题，玻璃卡片的明暗都跟着这张照片本身走（亮照片配浅玻璃深字，
  // 暗照片配深玻璃亮字），而不是死板地跟着主题名字。之前"文字看不清"的根因就是
  // 玻璃卡片的明暗只认主题、不认照片，深色照片配浅色主题的玻璃卡片自然看不清。
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
      ['--glass-bg', '--glass-bg-strong', '--glass-border', '--text', '--text-muted'].forEach((k) => root.removeProperty(k));
      return;
    }
    const dark = sample.lum <= 0.55;
    // 玻璃底色朝照片平均色轻轻带一点色相（12% 权重），保持"颜色只在壁纸上出现"的原则，
    // 又不会让玻璃变得五颜六色。
    const base = dark ? 18 : 250;
    const rr = mix(sample.r, base, 0.88), gg = mix(sample.g, base, 0.88), bb = mix(sample.b, base, 0.88);
    if (dark) {
      root.setProperty('--glass-bg', `rgba(${rr},${gg},${bb},0.60)`);
      root.setProperty('--glass-bg-strong', `rgba(${Math.max(rr - 4, 0)},${Math.max(gg - 4, 0)},${Math.max(bb - 4, 0)},0.80)`);
      root.setProperty('--glass-border', 'rgba(255,255,255,0.14)');
      root.setProperty('--text', '#f2f0ec');
      root.setProperty('--text-muted', 'rgba(242,240,236,0.66)');
    } else {
      root.setProperty('--glass-bg', `rgba(${rr},${gg},${bb},0.62)`);
      root.setProperty('--glass-bg-strong', `rgba(${Math.min(rr + 4, 255)},${Math.min(gg + 4, 255)},${Math.min(bb + 4, 255)},0.82)`);
      root.setProperty('--glass-border', 'rgba(0,0,0,0.10)');
      root.setProperty('--text', '#201f1b');
      root.setProperty('--text-muted', 'rgba(32,31,27,0.62)');
    }
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
      const sample = await sampleAverageColor(currentObjectUrl);
      applyAdaptiveTone(sample);
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('is-active');
      document.documentElement.classList.remove('has-wallpaper');
      applyAdaptiveTone(null);
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
