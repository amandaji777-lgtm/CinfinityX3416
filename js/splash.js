// 开屏：星空 + 流光雨滴（仅在深色场景下画，白色纯色背景下跳过，避免白底画白色星星）。
// 真正的"进入"动作是手指从底部横杠往上一滑（不是定时器自动跳走）——不阻塞真正的
// 数据加载，App.boot() 在它下面并行执行。点击屏幕任意位置、键盘 ↑/空格 也能进入，
// 尊重 prefers-reduced-motion（此时直接短暂展示后自动进入，不强制要求手势）。
(function () {
  const root = document.getElementById('splash-screen');
  const canvas = document.getElementById('splash-canvas');
  const photoBg = document.getElementById('splash-photo-bg');
  const home = document.getElementById('splash-home');
  const content = document.querySelector('.splash-content');
  const welcomeEl = document.getElementById('splash-welcome');
  const timeEl = document.getElementById('splash-time');
  const dateEl = document.getElementById('splash-date');
  if (!root || !canvas) return;

  // 主屏幕图标打开的独立模式下，iOS 有时候不是真的重启页面，而是把上一次挂起的
  // 网页原样恢复——如果上次挂起前正好用键盘输入过，Safari 记的视觉视口缩放/偏移
  // 可能还是歪的，恢复回来开屏就会跟着错位、露出没铺满的边。开屏一启动就先"晃"
  // 一下 viewport meta（逼 Safari 重新算一遍），把这个继承来的歪状态先扶正。
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    const originalViewport = viewportMeta.getAttribute('content');
    viewportMeta.setAttribute('content', originalViewport + ',maximum-scale=1.0');
    requestAnimationFrame(() => viewportMeta.setAttribute('content', originalViewport));
  }

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  let width, height, dpr;
  let rafId = null;
  let dismissed = false;
  let isDark = true;

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
    if (clockId) clearInterval(clockId);
    welcomeEl?.classList.add('is-complete');
    root.classList.add('splash-hide');
    setTimeout(() => root.remove(), 500);
  }

  // ---------------- 锁屏风格的真实日期时间：每分钟刷新一次即可 ----------------
  let clockId = null;
  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  function updateClock() {
    if (!timeEl || !dateEl) return;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`;
  }
  updateClock();
  clockId = setInterval(updateClock, 15000);

  // ---------------- 背景：主题纯色，或用户自定义的开屏照片 ----------------
  async function setupBackground() {
    // 这段脚本在 app.js（真正 applyTheme 的地方）之前就执行了，document.documentElement
    // 的 data-theme 这时还没被设置，不能用它判断深浅——直接问 DB 拿存好的主题设置。
    let theme = 'light';
    try { theme = (await DB.getSetting('theme')) === 'soft-dark' ? 'soft-dark' : 'light'; } catch (_) {}
    let photoUrl = null;
    try { photoUrl = window.SplashPhoto ? await window.SplashPhoto.urlFor(theme) : null; } catch (_) { photoUrl = null; }

    isDark = !!photoUrl || theme === 'soft-dark';
    root.classList.toggle('is-light', !isDark);

    if (photoUrl && photoBg) {
      photoBg.style.backgroundImage = `url("${photoUrl}")`;
      photoBg.classList.add('is-active');
    }

    if (isDark) {
      if (reduceMotion) { draw(0); }
      else { rafId = requestAnimationFrame(loop); }
    }
  }
  setupBackground();

  // ---------------- 上滑进入：真实拖拽手势，跟手移动；桌面用鼠标拖拽/键盘兜底 ----------------
  const THRESH = 70;
  let dragging = false, startY = 0, dy = 0;

  function setDrag(d) {
    dy = Math.max(-260, Math.min(0, d));
    const p = Math.min(1, -dy / THRESH);
    if (content) {
      content.style.transform = `translateY(${dy * 0.55}px)`;
      content.style.opacity = String(1 - p * 0.7);
    }
    if (home) home.style.transform = `translateY(${dy * 0.3}px)`;
  }
  function resetDrag() {
    dy = 0;
    if (content) { content.style.transform = ''; content.style.opacity = ''; }
    if (home) home.style.transform = '';
  }
  function onDown(e) { dragging = true; startY = e.clientY; }
  function onMove(e) { if (!dragging) return; setDrag(e.clientY - startY); }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (-dy > THRESH) dismiss(); else resetDrag();
  }

  if (home) {
    home.addEventListener('pointerdown', (e) => { try { home.setPointerCapture(e.pointerId); } catch (_) {} onDown(e); });
    home.addEventListener('pointermove', onMove);
    home.addEventListener('pointerup', onUp);
    home.addEventListener('pointercancel', onUp);
    home.addEventListener('click', dismiss);
  }
  window.addEventListener('keydown', (e) => {
    if (dismissed) return;
    if (e.key === 'ArrowUp' || e.key === ' ') { e.preventDefault(); dismiss(); }
  });
  root.addEventListener('click', (e) => { if (e.target === root) dismiss(); });

  if (reduceMotion) {
    // 减少动效偏好：不强制要求手势，短暂停留后自动进入。
    setTimeout(dismiss, 900);
  }
})();
