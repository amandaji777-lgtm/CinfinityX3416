// 应用入口：首次向导判断、底部导航、"更多"设置页（API连接/备份/关于）。
const App = (() => {
  let currentTab = 'chat';
  let settings = {};

  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    settings = await loadSettings();
    if (!settings.wizardCompleted) {
      const wizardRoot = document.getElementById('wizard-root');
      Wizard.render(wizardRoot, settings, async (newSettings) => {
        settings = newSettings;
        wizardRoot.innerHTML = '';
        applyTheme(settings);
        await startMainApp();
      });
      return;
    }
    applyTheme(settings);
    await startMainApp();
  }

  async function loadSettings() {
    const keys = [
      'workspaceName', 'subtitle', 'nickname', 'theme', 'colorTheme', 'clockFormat',
      'aiEnabled', 'proactiveMessagesEnabled', 'wizardCompleted', 'storageMode', 'createdAt',
      'customAccent', 'customBubbleColor', 'customChatBg',
      'navLabelChat', 'navLabelBookmarks', 'navLabelMood', 'navLabelMore',
    ];
    const entries = await Promise.all(keys.map(async (k) => [k, await DB.getSetting(k)]));
    return Object.fromEntries(entries);
  }

  function lightenHex(hex, amount) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // 深色模式的"呼吸感"氛围是结构性的、不开放自定义；自定义强调色/气泡色/聊天
  // 背景色只在浅色模式下生效，切到深色模式时自动清除内联覆盖，交回样式表管理。
  function applyTheme(s) {
    const isDark = s.theme === 'soft-dark';
    document.documentElement.dataset.theme = isDark ? 'soft-dark' : 'light';
    document.documentElement.dataset.colorTheme = s.colorTheme || 'duskpink';
    const root = document.documentElement.style;

    if (s.customAccent) {
      root.setProperty('--accent-strong', s.customAccent);
      root.setProperty('--accent', lightenHex(s.customAccent, 0.55));
    } else {
      root.removeProperty('--accent-strong');
      root.removeProperty('--accent');
    }

    if (!isDark && s.customBubbleColor) root.setProperty('--user-bubble-bg', s.customBubbleColor);
    else root.removeProperty('--user-bubble-bg');

    if (!isDark && s.customChatBg) root.setProperty('--bg', s.customChatBg);
    else root.removeProperty('--bg');
  }

  function applyNavLabels(s) {
    const map = {
      chat: s.navLabelChat || '对话',
      bookmarks: s.navLabelBookmarks || '收藏',
      mood: s.navLabelMood || '心情',
      more: s.navLabelMore || '更多',
    };
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      const label = btn.querySelector('.nav-label');
      if (label && map[btn.dataset.tab]) label.textContent = map[btn.dataset.tab];
    });
  }

  async function startMainApp() {
    document.getElementById('app-shell').style.display = 'flex';
    document.getElementById('app-title').textContent = settings.workspaceName || '拾光';
    document.getElementById('app-subtitle').textContent = settings.subtitle || '';
    applyNavLabels(settings);

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
    document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const view = document.getElementById(`view-${tab}`);
    view.classList.add('active');
    if (tab === 'bookmarks') await Bookmarks.init(view);
    if (tab === 'mood') await Mood.init(view);
    if (tab === 'more') await More.init(view);
    if (tab === 'resources') await Resources.init(view);
    if (tab === 'chat' && Chat.refreshList) await Chat.refreshList();
  }

  async function goToChat(conversationId, messageId) {
    await switchTab('chat');
    // Chat 模块内部会话切换（直接复用其已加载状态）
    if (window.__chatOpenConversation) window.__chatOpenConversation(conversationId, messageId);
  }

  return { boot, switchTab, goToChat, get settings() { return settings; }, set settings(v) { settings = v; }, applyTheme, applyNavLabels };
})();
window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  App.boot();
});
