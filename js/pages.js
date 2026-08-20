// 整页抽屉：给字段特别多的表单(API连接/资料库编辑/对话设置)用的"点开就是一整页、
// 可以舒服地滚动，不是局促的半截弹窗"容器。简单的确认框/小表单仍然用 modal-overlay。
const Pages = (() => {
  function open(title, bodyHTML, opts) {
    opts = opts || {};
    const root = document.getElementById('page-stack');
    const page = document.createElement('div');
    page.className = 'page-view';
    page.innerHTML = `
      <div class="page-header">
        <button type="button" class="page-back" aria-label="返回">‹</button>
        <h2>${title}</h2>
        <div class="page-header-actions">${opts.headerActions || ''}</div>
      </div>
      <div class="page-body"></div>
    `;
    page.querySelector('.page-body').innerHTML = bodyHTML;
    root.appendChild(page);
    page.querySelector('.page-back').addEventListener('click', () => close(page));
    requestAnimationFrame(() => page.classList.add('is-active'));
    return page;
  }

  function close(page) {
    page.classList.remove('is-active');
    page.addEventListener('transitionend', () => page.remove(), { once: true });
    setTimeout(() => page.remove(), 400); // 兜底：万一 transitionend 没触发也不会卡住
  }

  return { open, close };
})();
window.Pages = Pages;
