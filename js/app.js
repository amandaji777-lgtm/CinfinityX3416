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

  async function startMainApp() {
    document.getElementById('app-shell').style.display = 'flex';
    document.title = settings.workspaceName || '星纪';

    window.addEventListener('online', updateOfflineBanner);
    window.addEventListener('offline', updateOfflineBanner);
    updateOfflineBanner();

    await Chat.init(document.getElementById('view-chat'));
    if (window.Proactive) await Proactive.refresh();
    if (window.Ambience) Ambience.init();
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
    if (tab === 'cycle') await Cycle.init(view);
    if (tab === 'more') await More.init(view);
    if (tab === 'resources') await Resources.init(view);
    if (tab === 'chat' && Chat.refreshList) await Chat.refreshList();
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
