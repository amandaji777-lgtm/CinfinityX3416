// 原生 confirm()/alert() 在沙盒化的预览 iframe 里会被静默拦截（点了没反应），
// 用自己的玻璃弹窗代替，Promise 化，行为和原生一致但样式统一、哪里都能用。
const UIDialog = (() => {
  function confirm(message, opts = {}) {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'modal-overlay';
      dialog.innerHTML = `
        <div class="modal-card ui-dialog-card">
          <p class="ui-dialog-message">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="ui-dialog-cancel">${escapeHtml(opts.cancelLabel || '取消')}</button>
            <button type="button" class="${opts.danger ? 'btn-danger' : 'btn-primary'}" id="ui-dialog-ok">${escapeHtml(opts.okLabel || '确定')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
      const cleanup = (result) => { dialog.remove(); resolve(result); };
      dialog.querySelector('#ui-dialog-cancel').addEventListener('click', () => cleanup(false));
      dialog.querySelector('#ui-dialog-ok').addEventListener('click', () => cleanup(true));
      dialog.addEventListener('click', (e) => { if (e.target === dialog) cleanup(false); });
    });
  }

  function alert(message) {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'modal-overlay';
      dialog.innerHTML = `
        <div class="modal-card ui-dialog-card">
          <p class="ui-dialog-message">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" id="ui-dialog-ok">好的</button>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);
      dialog.querySelector('#ui-dialog-ok').addEventListener('click', () => { dialog.remove(); resolve(); });
    });
  }

  return { confirm, alert };
})();
window.UIDialog = UIDialog;
