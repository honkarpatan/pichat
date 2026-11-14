/**
 * Lightweight dialog shell (theme-aware). Does NOT replace PopupManager.editMessage —
 * use this for new forms (instructions, rename, confirm with fields, etc.).
 *
 * Classes: .gpt-ui-dialog-overlay, .gpt-ui-dialog, .gpt-ui-dialog-title,
 *          .gpt-ui-dialog-body, .gpt-ui-dialog-actions, .gpt-ui-btn, .gpt-ui-btn-primary
 */

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {HTMLElement|HTMLElement[]} [opts.body] — nodes to put in body
 * @param {string} [opts.confirmText='Save']
 * @param {string} [opts.cancelText='Cancel']
 * @param {boolean} [opts.showCancel=true]
 * @param {() => boolean|void|Promise<boolean|void>} [opts.onConfirm] — return false to keep open
 * @param {() => void} [opts.onCancel]
 * @returns {{ overlay: HTMLElement, close: () => void, setBusy: (b: boolean) => void }}
 */
export function openUiDialog(opts = {}) {
  const existing = document.getElementById('gpt-ui-dialog-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'gpt-ui-dialog-overlay';
  overlay.className = 'gpt-ui-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'gpt-ui-dialog';
  dialog.setAttribute('role', 'dialog');

  if (opts.title) {
    const title = document.createElement('div');
    title.className = 'gpt-ui-dialog-title';
    title.textContent = opts.title;
    dialog.appendChild(title);
  }

  const body = document.createElement('div');
  body.className = 'gpt-ui-dialog-body';
  const nodes = Array.isArray(opts.body) ? opts.body : (opts.body ? [opts.body] : []);
  nodes.forEach(n => {
    if (n) body.appendChild(n);
  });
  dialog.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'gpt-ui-dialog-actions';

  const close = () => {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 160);
  };

  let busy = false;
  const setBusy = (b) => {
    busy = !!b;
    confirmBtn.disabled = busy;
    if (cancelBtn) cancelBtn.disabled = busy;
    confirmBtn.style.opacity = busy ? '0.6' : '1';
  };

  let cancelBtn = null;
  if (opts.showCancel !== false) {
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'gpt-ui-btn';
    cancelBtn.textContent = opts.cancelText || 'Cancel';
    cancelBtn.onclick = () => {
      if (busy) return;
      try { opts.onCancel?.(); } catch (_) {}
      close();
    };
    actions.appendChild(cancelBtn);
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'gpt-ui-btn gpt-ui-btn-primary';
  confirmBtn.textContent = opts.confirmText || 'Save';
  confirmBtn.onclick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await opts.onConfirm?.();
      if (ok === false) {
        setBusy(false);
        return;
      }
      close();
    } catch (e) {
      console.warn('[UiDialog]', e);
      setBusy(false);
    }
  };
  actions.appendChild(confirmBtn);

  dialog.appendChild(actions);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && !busy) {
      try { opts.onCancel?.(); } catch (_) {}
      close();
    }
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  // Focus first field
  setTimeout(() => {
    const focusable = dialog.querySelector('textarea, input, select, button.gpt-ui-btn-primary');
    focusable?.focus?.();
  }, 40);

  return { overlay, close, setBusy };
}
