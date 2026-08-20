// 开屏动画：星空 + 流光雨滴，纯装饰，不阻塞真正的数据加载（App.boot() 在它下面并行执行）。
// 大约 3 秒后自动淡出，也可以点按跳过；尊重 prefers-reduced-motion。
(function () {
  const root = document.getElementById('splash-screen');
  const canvas = document.getElementById('splash-canvas');
  const skipBtn = document.getElementById('splash-skip');
  const welcomeEl = document.getElementById('splash-welcome');
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

    // 流星：不是单一细线，是"头亮尾淡"的锥形光迹 + 柔光头部。
    drops.forEach((d) => {
      const tailX = d.x - d.drift * d.len * 0.3;
      const tailY = d.y - d.len;
      const segments = 6;
      ctx.lineCap = 'round';
      for (let i = 0; i < segments; i++) {
        const t0 = i / segments, t1 = (i + 1) / segments;
        ctx.beginPath();
        ctx.moveTo(tailX + (d.x - tailX) * t0, tailY + (d.y - tailY) * t0);
        ctx.lineTo(tailX + (d.x - tailX) * t1, tailY + (d.y - tailY) * t1);
        ctx.lineWidth = 0.3 + t1 * t1 * 1.8;
        ctx.strokeStyle = t1 > 0.65 ? hexToRgba('#ffffff', d.opacity * (0.3 + t1 * 0.8)) : hexToRgba(accent, d.opacity * t1 * 0.9);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 4.5);
      glow.addColorStop(0, hexToRgba('#ffffff', Math.min(0.95, d.opacity * 2.2)));
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 4.5, 0, Math.PI * 2);
      ctx.fill();

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

  // 加载完成的一瞬间，"Welcome Home" 花体字先跳动发光一下，再淡出整个开屏。
  function finish() {
    if (dismissed) return;
    welcomeEl?.classList.add('is-complete');
    setTimeout(dismiss, reduceMotion ? 0 : 380);
  }

  if (reduceMotion) {
    // 减少动效偏好：只画一次静态星空，缩短停留时间。
    draw(0);
    setTimeout(finish, 900);
  } else {
    rafId = requestAnimationFrame(loop);
    setTimeout(finish, 2650);
  }

  skipBtn?.addEventListener('click', dismiss);
  root.addEventListener('click', (e) => { if (e.target === root) dismiss(); });
})();
