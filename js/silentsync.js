// 静默同频：一分钟的安静仪式。没有文字、没有输入框，只有缓缓起伏的深蓝海浪
// 和中间一点跟着接近静息心率（约每 1.1 秒一拍）双拍起伏的光——没有真实心跳
// 录音可用，就用这个视觉节奏本身去代替"心跳"，而不是随便配一段无关的音效。
// 计时满 60 秒自动淡出；也允许中途轻点屏幕提前结束，不强留人在里面。
const SilentSync = (() => {
  const DURATION = 60000;
  let btn, overlay, canvas, ctx;
  let rafId = null, dismissTimer = null;
  let waves = [];
  let width = 0, height = 0, dpr = 1;
  let resizeHandler = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seedWaves() {
    waves = [
      { amp: 22, freq: 0.006, speed: 0.00032, y: 0.60, color: 'rgba(78,120,196,0.42)' },
      { amp: 30, freq: 0.0038, speed: 0.00021, y: 0.72, color: 'rgba(46,86,158,0.5)' },
      { amp: 40, freq: 0.0026, speed: 0.00014, y: 0.85, color: 'rgba(22,52,108,0.65)' },
    ];
  }

  function draw(t) {
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#040a14');
    bg.addColorStop(0.55, '#081a30');
    bg.addColorStop(1, '#0b2544');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    waves.forEach((w) => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 10) {
        const y = height * w.y + Math.sin(x * w.freq + t * w.speed) * w.amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = w.color;
      ctx.fill();
    });
  }

  function loop(t) {
    draw(t);
    rafId = requestAnimationFrame(loop);
  }

  function open() {
    if (!overlay) return;
    overlay.classList.add('is-active');
    overlay.setAttribute('aria-hidden', 'false');
    resize();
    seedWaves();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    if (!resizeHandler) {
      resizeHandler = () => resize();
      window.addEventListener('resize', resizeHandler);
    }
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(close, DURATION);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-active');
    overlay.setAttribute('aria-hidden', 'true');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
  }

  function init() {
    btn = document.getElementById('silentsync-btn');
    overlay = document.getElementById('silentsync-overlay');
    canvas = document.getElementById('silentsync-canvas');
    if (!btn || !overlay || !canvas) return;
    ctx = canvas.getContext('2d');
    btn.addEventListener('click', open);
    overlay.addEventListener('click', close);
  }

  return { init };
})();
window.SilentSync = SilentSync;
