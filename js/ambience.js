// 柔和深色模式的氛围感：点击水波光晕 + 留白角落（随最近一次心情记录的颜色变化）。
// "感知到你累了/开心"没有真实的生理感应能力，这里诚实地接到你自己在"心情"里记的最新颜色上。
const Ambience = (() => {
  // 点哪里都会有水波光辉，不限于特定组件——氛围感覆盖整个页面。
  function initRipple() {
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const target = e.target.closest('button, a, input, textarea, select, [role="button"]') || e.target;
      // 大卡片/整行按钮点下去时不该让水波盖住整块——先把参与尺寸计算的边长封顶，再缩小比例。
      const size = Math.min(Math.max(target?.offsetWidth || 0, target?.offsetHeight || 0, 34), 70) * 0.6;

      const wave = document.createElement('div');
      wave.className = 'ripple-wave';
      wave.style.width = size + 'px';
      wave.style.height = size + 'px';
      wave.style.left = e.clientX + 'px';
      wave.style.top = e.clientY + 'px';
      document.body.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove());

      const spark = document.createElement('div');
      spark.className = 'ripple-spark';
      spark.style.left = e.clientX + 'px';
      spark.style.top = e.clientY + 'px';
      document.body.appendChild(spark);
      spark.addEventListener('animationend', () => spark.remove());
    });
  }

  function colorBrightness(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return 150;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  // 留白角落始终是白银色的光，只有"闪烁的疏密/亮度"随最近一次心情记录变化——
  // 不把角落染成心情的颜色（那样反而像状态指示灯，不是"通感"的氛围光）。
  async function refreshCorner() {
    const el = document.getElementById('ambient-corner');
    if (!el || typeof DB === 'undefined') return;
    let moods = [];
    try { moods = await DB.getAll('moods'); } catch (_) { return; }

    let fleckCount = 2;
    let softness = 0.5; // 越低越"柔软暗淡"（对应疲惫），越高越明亮
    if (moods.length) {
      moods.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      const brightness = colorBrightness(moods[0].color);
      softness = Math.min(1, Math.max(0.35, brightness / 255));
      fleckCount = brightness > 180 ? 7 : brightness > 120 ? 4 : 2;
    }
    el.style.background = `radial-gradient(circle, rgba(255,255,255,${softness.toFixed(2)}), transparent 72%)`;
    el.innerHTML = Array.from({ length: fleckCount }, () => {
      const x = (Math.random() * 34 + 4).toFixed(0);
      const y = (Math.random() * 34 + 4).toFixed(0);
      const delay = (Math.random() * 2).toFixed(2);
      return `<span class="fleck" style="left:${x}px;top:${y}px;animation-delay:${delay}s"></span>`;
    }).join('');
  }

  function init() {
    initRipple();
    refreshCorner();
  }

  return { init, refreshCorner };
})();
window.Ambience = Ambience;
