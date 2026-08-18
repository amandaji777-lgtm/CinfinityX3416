// 开屏动画：星空 + 流光雨滴，纯装饰，不阻塞真正的数据加载（App.boot() 在它下面并行执行）。
// 大约 3 秒后自动淡出，也可以点按跳过；尊重 prefers-reduced-motion。
(function () {
  const root = document.getElementById('splash-screen');
  const canvas = document.getElementById('splash-canvas');
  const skipBtn = document.getElementById('splash-skip');
  if (!root || !canvas) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  let width, height, dpr;
  let rafId = null;
  let dismissed = false;

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
  resize();
  window.addEventListener('resize', resize);

  function rand(min, max) { return Math.random() * (max - min) + min; }

  const stars = Array.from({ length: 70 }, () => ({
    x: rand(0, width),
    y: rand(0, height),
    r: rand(0.6, 1.8),
    phase: rand(0, Math.PI * 2),
    speed: rand(0.8, 2.2),
  }));

  const drops = Array.from({ length: 26 }, () => makeDrop());
  function makeDrop() {
    return {
      x: rand(0, width),
      y: rand(-height, 0),
      len: rand(40, 110),
      speed: rand(2.2, 5),
      drift: rand(0.3, 0.9),
      opacity: rand(0.18, 0.42),
    };
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim() || '#e8a0b4';

  function draw(t) {
    ctx.clearRect(0, 0, width, height);

    // 星空
    stars.forEach((s) => {
      const tw = 0.5 + 0.5 * Math.sin(t / 1000 * s.speed + s.phase);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${(0.25 + tw * 0.65).toFixed(2)})`;
      ctx.fill();
    });

    // 流光雨滴
    drops.forEach((d) => {
      const grad = ctx.createLinearGradient(d.x, d.y, d.x + d.drift * d.len * 0.3, d.y + d.len);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, hexToRgba(accent, d.opacity));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.drift * d.len * 0.3, d.y + d.len);
      ctx.stroke();

      d.y += d.speed;
      d.x += d.drift;
      if (d.y > height) {
        d.y = rand(-120, -20);
        d.x = rand(0, width);
      }
    });
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '').trim();
    if (h.length !== 6) return `rgba(232,160,180,${alpha})`;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function loop(t) {
    draw(t);
    rafId = requestAnimationFrame(loop);
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    root.classList.add('splash-hide');
    setTimeout(() => root.remove(), 500);
  }

  if (reduceMotion) {
    // 减少动效偏好：只画一次静态星空，缩短停留时间。
    draw(0);
    setTimeout(dismiss, 900);
  } else {
    rafId = requestAnimationFrame(loop);
    setTimeout(dismiss, 3000);
  }

  skipBtn?.addEventListener('click', dismiss);
  root.addEventListener('click', (e) => { if (e.target === root) dismiss(); });
})();
