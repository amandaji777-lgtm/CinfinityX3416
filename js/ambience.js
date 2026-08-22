// 点击水波光晕：点哪里都会有，覆盖整个页面。
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

  function init() {
    initRipple();
  }

  return { init };
})();
window.Ambience = Ambience;
