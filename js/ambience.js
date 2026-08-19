// 柔和深色模式的氛围感：点击水波光晕 + 留白角落（随最近一次心情记录的颜色变化）。
// "感知到你累了/开心"没有真实的生理感应能力，这里诚实地接到你自己在"心情"里记的最新颜色上。
const Ambience = (() => {
  function initRipple() {
    document.addEventListener('pointerdown', (e) => {
      if (document.documentElement.dataset.theme !== 'soft-dark') return;
      const target = e.target.closest('button, .conv-row, .res-card, .bm-card, .mem-row, .ls-row, .mood-entry-row, .conn-row');
      if (!target) return;
      const wave = document.createElement('div');
      wave.className = 'ripple-wave';
      const size = Math.max(target.offsetWidth, target.offsetHeight, 60) * 1.6;
      wave.style.width = size + 'px';
      wave.style.height = size + 'px';
      wave.style.left = e.clientX + 'px';
      wave.style.top = e.clientY + 'px';
      document.body.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove());
    });
  }

  function colorBrightness(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return 150;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  async function refreshCorner() {
    const el = document.getElementById('ambient-corner');
    if (!el || typeof DB === 'undefined') return;
    let moods = [];
    try { moods = await DB.getAll('moods'); } catch (_) { return; }
    if (!moods.length) {
      el.style.background = 'radial-gradient(circle, rgba(255,255,255,0.3), transparent 70%)';
      el.innerHTML = '';
      return;
    }
    moods.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    const color = moods[0].color || '#cdbfe0';
    el.style.background = `radial-gradient(circle, ${color}, transparent 72%)`;
    const brightness = colorBrightness(color);
    const fleckCount = brightness > 180 ? 6 : brightness > 120 ? 3 : 1;
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
