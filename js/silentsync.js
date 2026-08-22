// 静默同频：一分钟的安静仪式。没有文字、没有输入框，背景跟随当前主题（不引入
// 新配色），中间是一枚缓慢自转的月亮徽记——外层光晕按接近静息心率的双拍节奏
// （约每 1.1 秒一拍）明暗起伏代替"心跳"，月盘和外圈各自用不同的速度慢慢转动。
// 计时满 60 秒自动淡出；也允许中途轻点屏幕提前结束，不强留人在里面。
const SilentSync = (() => {
  const DURATION = 60000;
  let btn, overlay;
  let dismissTimer = null;

  function open() {
    if (!overlay) return;
    overlay.classList.add('is-active');
    overlay.setAttribute('aria-hidden', 'false');
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(close, DURATION);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-active');
    overlay.setAttribute('aria-hidden', 'true');
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  }

  function init() {
    btn = document.getElementById('silentsync-btn');
    overlay = document.getElementById('silentsync-overlay');
    if (!btn || !overlay) return;
    btn.addEventListener('click', open);
    overlay.addEventListener('click', close);
  }

  return { init };
})();
window.SilentSync = SilentSync;
