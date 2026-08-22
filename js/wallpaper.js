// 自定义壁纸：浅色/深色主题可以各自设置一张背景照片，毛玻璃卡片盖在上面。
// 图片存成 Blob 直接放进 settings 表（IndexedDB 原生支持存 Blob，不用转 base64）。
// 不进 JSON 备份——原因和不导出 API Key 一样：图片会让备份文件变得很大又不便于纯文本比对。
const Wallpaper = (() => {
  const KEYS = { light: 'wallpaperLight', 'soft-dark': 'wallpaperDark' };
  let currentObjectUrl = null;

  function keyFor(theme) {
    return KEYS[theme] || KEYS.light;
  }

  // 壁纸自适应取色：把照片画到一块 24×24 的小画布上求平均色相，给玻璃卡片轻轻带一点
  // 照片的色调（12% 权重），但明暗永远跟着"你选的主题"走，不跟着"这张照片亮不亮"走——
  // 之前的版本反过来了：深色照片会把 --text/--surface 这些全站共用的变量强制翻成浅色，
  // 结果输入框/分段控件这些底色仍然是主题原来的浅色的地方，文字也变浅了，直接读不到
  // （用户反馈"选项完全看不见"）。现在只调玻璃卡片自己的透明度和一点点色相，不透明度
  // 调得比之前更高，保证不管照片多亮多暗，主题自己的文字颜色始终读得清楚。
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
    // 明暗跟着当前选的主题走（不是跟着照片走），只把色相朝照片平均色带一点点（12% 权重）。
    const dark = document.documentElement.dataset.theme === 'soft-dark';
    const base = dark ? 20 : 248;
    const rr = mix(sample.r, base, 0.88), gg = mix(sample.g, base, 0.88), bb = mix(sample.b, base, 0.88);
    // 不透明度比这次修复之前（0.60/0.62）略高一点留安全余量，但不像修复当天那版
    // （0.82/0.84）那么闷——用户反馈"想要更通透一点"，这版两边各退一步。
    if (dark) {
      root.setProperty('--glass-bg', `rgba(${rr},${gg},${bb},0.68)`);
      root.setProperty('--glass-bg-strong', `rgba(${Math.max(rr - 4, 0)},${Math.max(gg - 4, 0)},${Math.max(bb - 4, 0)},0.84)`);
      root.setProperty('--glass-border', 'rgba(255,255,255,0.14)');
    } else {
      root.setProperty('--glass-bg', `rgba(${rr},${gg},${bb},0.70)`);
      root.setProperty('--glass-bg-strong', `rgba(${Math.min(rr + 4, 255)},${Math.min(gg + 4, 255)},${Math.min(bb + 4, 255)},0.85)`);
      root.setProperty('--glass-border', 'rgba(0,0,0,0.10)');
    }
  }

  async function apply(theme) {
    const layer = document.getElementById('wallpaper-layer');
    if (!layer) return;
    let blob = null;
    try { blob = storableToBlob(await DB.getSetting(keyFor(theme))); } catch (_) { blob = null; }

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
    await DB.setSetting(keyFor(theme), await blobToStorable(file));
    await apply(document.documentElement.dataset.theme || 'light');
  }

  async function clear(theme) {
    await DB.setSetting(keyFor(theme), null);
    await apply(document.documentElement.dataset.theme || 'light');
  }

  async function has(theme) {
    const blob = storableToBlob(await DB.getSetting(keyFor(theme)));
    return blob instanceof Blob;
  }

  return { apply, set, clear, has };
})();
window.Wallpaper = Wallpaper;
