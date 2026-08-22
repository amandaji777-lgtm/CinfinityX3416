// 应用入口：首次向导判断、底部导航、"更多"设置页（API连接/备份/关于）。
const App = (() => {
  let currentTab = 'chat';
  let settings = {};

  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    settings = await loadSettings();
    // 不再有强制的首次设置向导：直接用默认值进入，想改名字/主题随时去
    // "更多 → 工作台设置"，避免每次打开都要先过一遍表单。
    if (!settings.wizardCompleted) settings = await applyDefaultSettings(settings);
    // 应用改名"拾光"→"星纪"：老设备上早期存下的默认名要跟着迁移一次，
    // 用户自己改过的名字（不等于旧默认值）不动。
    if (settings.workspaceName === '拾光') {
      settings.workspaceName = '星纪';
      await DB.setSetting('workspaceName', '星纪');
    }
    applyTheme(settings);
    await startMainApp();
  }

  async function loadSettings() {
    const keys = [
      'workspaceName', 'subtitle', 'nickname', 'theme', 'clockFormat',
      'aiEnabled', 'proactiveMessagesEnabled', 'wizardCompleted', 'storageMode', 'createdAt',
      'customAccent',
    ];
    const entries = await Promise.all(keys.map(async (k) => [k, await DB.getSetting(k)]));
    return Object.fromEntries(entries);
  }

  async function applyDefaultSettings(existing) {
    const defaults = {
      workspaceName: '星纪', subtitle: '对话 · 收藏 · 心情', nickname: '',
      theme: 'light', clockFormat: 24, aiEnabled: true, proactiveMessagesEnabled: false,
      storageMode: 'local-only', wizardCompleted: true, createdAt: nowISO(),
    };
    const merged = { ...existing };
    for (const [key, value] of Object.entries(defaults)) {
      if (merged[key] === undefined || merged[key] === null) merged[key] = value;
    }
    for (const [key, value] of Object.entries(merged)) await DB.setSetting(key, value);
    const persist = await DB.requestPersistentStorage();
    await DB.setSetting('persistentStorage', persist);
    return merged;
  }

  // 白金/黑银两套固定底色不开放自定义；customAccent 只覆盖"点按时的光辉颜色"这一件事
  // （--ripple-glow），不会影响其他任何 UI 元素的配色，保证整体氛围不会被自定义弄乱。
  function applyTheme(s) {
    const isDark = s.theme === 'soft-dark';
    document.documentElement.dataset.theme = isDark ? 'soft-dark' : 'light';
    const root = document.documentElement.style;

    if (s.customAccent) root.setProperty('--ripple-glow', s.customAccent);
    else root.removeProperty('--ripple-glow');

    if (window.Wallpaper) Wallpaper.apply(isDark ? 'soft-dark' : 'light');
  }

  // 视频逐帧看到了更彻底的病根：光改 app-shell 的高度只解决了"键盘挡住多少"，
  // 没解决另一件事——iOS Safari 在输入框获得焦点时，会自己把"视觉视口"（真正
  // 显示在屏幕上的那一小块）在"布局视口"里挪一下位置，想把输入框"滚"到看得见
  // 的地方去。而 app-shell / splash-screen 用的 position:fixed;inset:0 是钉死
  // 在布局视口上的，不会跟着这个"挪动"走——所以视觉视口一挪，整个外壳在屏幕上
  // 看起来就像被"顶飞"了一样，露出一大片空白，直到手动滑一下把它拨回去。
  // visualViewport 除了 .height，还有 .offsetTop：正好就是这个"挪了多少"的量。
  // 用它反向把外壳往下（或上）挪回同样的距离，就能把这个挪动抵消掉，让外壳
  // 一直贴在视觉视口里，不会再飞出去。开屏页也会遇到同一个问题（比如从上次
  // 挂起的状态恢复、视觉视口本来就没归零），所以两个外壳一起处理。
  function bindVisualViewportResize() {
    const shell = document.getElementById('app-shell');
    const splash = document.getElementById('splash-screen');
    if (!window.visualViewport || (!shell && !splash)) return;
    const vv = window.visualViewport;
    let rafId = null;
    function apply() {
      const gap = window.innerHeight - vv.height;
      const panned = gap > 100 || vv.offsetTop > 1;
      [shell, splash].forEach((el) => {
        if (!el) return;
        if (panned) {
          el.style.height = vv.height + 'px';
          el.style.top = vv.offsetTop + 'px';
        } else {
          el.style.height = '';
          el.style.top = '';
        }
      });
      // 视口比整个屏幕矮出一大截，只可能是键盘挡住了下面这块——用这个当"键盘
      // 是不是弹起来了"的判断依据，给输入框那圈"给键盘让位"的安全区留白该
      // 去掉的时候去掉（见 .composer 里 body.keyboard-open 那条规则）。
      document.body.classList.toggle('keyboard-open', gap > 100);
      // 键盘弹起时 message-list 的可视高度跟着变矮了，但它的滚动位置不会自动
      // 跟着调整——如果之前刚好停在底部附近，外壳一变矮，最后几条消息就会被
      // 新冒出来的输入框正好挡住/压住。聊天室里，只要还大致停在底部，就跟着
      // 重新贴底一次，让最新消息始终露在输入框上方而不是被盖住。
      const list = document.getElementById('message-list');
      if (list && document.body.classList.contains('is-chat-room')) {
        const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
        if (wasNearBottom) list.scrollTop = list.scrollHeight;
      }
    }
    // 键盘弹起/收起是有个滑动动画的（不是一步到位），这个过程中 visualViewport
    // 的 resize/scroll 事件会连续密集地触发好多次——每次都同步改一遍尺寸、逼一次
    // 重排，密集触发时容易在动画中间的某一帧撞上"布局还没缩完就被截断"的画面
    // （配合 .message-list 那个 min-height:0 的修复，这里再用 rAF 把同一帧内的
    // 多次触发合并成一次，进一步减少中间态被渲染出来的机会）。
    function schedule() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(apply);
    }
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
  }

  async function startMainApp() {
    document.getElementById('app-shell').style.display = 'flex';
    document.title = settings.workspaceName || '星纪';

    window.addEventListener('online', updateOfflineBanner);
    window.addEventListener('offline', updateOfflineBanner);
    updateOfflineBanner();

    await Chat.init(document.getElementById('view-chat'));
    if (window.Proactive) await Proactive.refresh();
    if (window.Ambience) Ambience.init();
    if (window.SilentSync) SilentSync.init();
    bindVisualViewportResize();
    switchTab('chat');
    bindNav();

    // 第9部分能力分级：没有独立后台/推送服务，只在应用打开、回到前台、
    // 或应用保持打开期间的定时检查里生成主动消息，绝不假装能在关闭后推送。
    if (window.Proactive) {
      Proactive.checkAll();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') Proactive.checkAll();
      });
      setInterval(() => { if (document.visibilityState === 'visible') Proactive.checkAll(); }, 5 * 60 * 1000);
    }
  }

  function updateOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    banner.style.display = navigator.onLine ? 'none' : 'block';
  }

  function bindNav() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  async function switchTab(tab) {
    currentTab = tab;
    // AI 资料库不在底部导航里（从"更多"点进去），视觉上把它归在"更多"的高亮状态下。
    const highlightTab = tab === 'resources' ? 'more' : tab;
    document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === highlightTab));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const view = document.getElementById(`view-${tab}`);
    view.classList.add('active');
    if (tab === 'bookmarks') await Bookmarks.init(view);
    if (tab === 'mood') await Mood.init(view);
    if (tab === 'calendar') await Calendar.init(view);
    if (tab === 'more') await More.init(view);
    if (tab === 'resources') await Resources.init(view);
    if (tab === 'chat' && Chat.refreshList) await Chat.refreshList();
    // 底部导航条在"聊天室内"要隐藏（chat.js 自己在房间/列表切换时也会同步这个
    // class），但切到别的标签页时必须确保它被清掉——不然从聊天室切去"更多"
    // 之类的页面，导航条会跟着消失不见。
    document.body.classList.toggle('is-chat-room', tab === 'chat' && Chat.state?.view === 'room');
  }

  async function goToChat(conversationId, messageId) {
    await switchTab('chat');
    // Chat 模块内部会话切换（直接复用其已加载状态）
    if (window.__chatOpenConversation) window.__chatOpenConversation(conversationId, messageId);
  }

  return { boot, switchTab, goToChat, get settings() { return settings; }, set settings(v) { settings = v; }, applyTheme };
})();
window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.boot();
});
