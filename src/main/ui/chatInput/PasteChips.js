/**
 * Large paste → chip in #previewContainer (same look as image previews).
 * Horizontal scroll; click opens themed text popup.
 * Settings: pasteChipThreshold, pasteChipMode (ask | allow)
 */
import { ConfigManager } from '../../utils/ConfigManager.js';

const TAG = '[PasteChips]';


/** chat-box margin: 50px when any preview chip exists, else 5px */
export function syncChatBoxForChips() {
  try {
    const box = document.getElementById('previewContainer');
    const chat = document.getElementById('chat-box') || document.querySelector('.chat-box');
    if (!chat) return;
    const n = box
      ? box.querySelectorAll('.gpt-image-preview-container, .gpt-file-chip, .gpt-paste-chip').length
      : 0;
    chat.style.marginBottom = n > 0 ? '50px' : '5px';
  } catch (_) {}
}

/**
 * Default bottom 110px; grows when #gpt-user-input height grows past one line (~24px).
 */
export function updatePreviewContainerBottom() {
  try {
    const el = document.getElementById('previewContainer');
    if (!el) return;
    const ta = document.getElementById('gpt-user-input');
    const base = 110;
    const minLine = 24;
    const h = ta ? (ta.offsetHeight || minLine) : minLine;
    const extra = Math.max(0, h - minLine);
    el.style.bottom = (base + extra) + 'px';
  } catch (_) {}
}

const MAX_CHIP_BODY = 80_000;
const DEFAULT_THRESHOLD = 400;

function getThreshold() {
  try {
    const v = parseInt(ConfigManager.get('pasteChipThreshold'), 10);
    if (Number.isFinite(v) && v >= 50) return v;
  } catch (_) {}
  return DEFAULT_THRESHOLD;
}

/** @returns {'ask'|'allow'} */
function getPasteMode() {
  try {
    const m = String(ConfigManager.get('pasteChipMode') || 'ask').toLowerCase();
    if (m === 'allow') return 'allow';
  } catch (_) {}
  return 'ask';
}

function ensurePreviewContainer() {
  const el = document.getElementById('previewContainer');
  if (!el) return null;
  // Floating strip — no solid background, sits above input area
  el.style.display = 'flex';
  el.style.flexWrap = 'nowrap';
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.right = '0';
  /* bottom set by updatePreviewContainerBottom() */
el.style.bottom = '110px';
  el.style.height = 'auto';
  el.style.minHeight = '0';
  el.style.gap = '5px';
  el.style.marginTop = '0';
  el.style.padding = '8px 4px 4px';
  el.style.alignItems = 'flex-start';
  el.style.overflowX = 'auto';
  el.style.overflowY = 'visible';
  el.style.background = 'transparent';
  el.style.border = 'none';
  el.style.boxShadow = 'none';
  el.style.zIndex = '50';
  el.style.pointerEvents = 'none'; /* container ignores clicks; chips re-enable */
  el.style.webkitOverflowScrolling = 'touch';
  try {
    const input = document.getElementById('input-container');
    if (input) {
      if (getComputedStyle(input).position === 'static') {
        input.style.position = 'relative';
      }
      input.style.overflow = 'visible';
    }
  } catch (_) {}
  updatePreviewContainerBottom();
  return el;
}

function chipLabel(text) {
  const n = text.length;
  const lines = text.split('\n').length;
  const first = text.trim().slice(0, 24).replace(/\s+/g, ' ');
  return `${first}${text.trim().length > 24 ? '…' : ''} (${n})`;
}

function docIconSvg() {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--active-text-color, #4b5dd1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
}

/**
 * Acode-themed popup showing full paste text
 */
function showTextPopup(title, body) {
  const existing = document.getElementById('gpt-paste-text-popup');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'gpt-paste-text-popup';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'background:rgba(0,0,0,0.45)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:16px', 'box-sizing:border-box'
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(92vw,420px)', 'max-height:70vh',
    'display:flex', 'flex-direction:column',
    'background:var(--secondary-color,#1e1e2e)',
    'color:var(--primary-text-color,#eee)',
    'border:1px solid var(--border-color,#333)',
    'border-radius:12px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.4)',
    'overflow:hidden'
  ].join(';');

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border-color,#333);gap:8px;';
  head.innerHTML = `
    <span style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(title).replace(/</g, '&lt;')}</span>
    <button type="button" data-close style="background:transparent;border:none;color:var(--primary-text-color);font-size:20px;cursor:pointer;line-height:1;padding:0 4px;">×</button>
  `;

  const pre = document.createElement('pre');
  pre.style.cssText = [
    'margin:0', 'padding:12px 14px', 'overflow:auto', 'flex:1',
    'font-size:12px', 'line-height:1.45', 'white-space:pre-wrap',
    'word-break:break-word', 'font-family:ui-monospace,monospace',
    'color:var(--primary-text-color)'
  ].join(';');
  pre.textContent = body;

  card.appendChild(head);
  card.appendChild(pre);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => { try { overlay.remove(); } catch (_) {} };
  head.querySelector('[data-close]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

async function askPasteAction() {
  try {
    const select = typeof acode !== 'undefined' ? acode.require('select') : null;
    if (typeof select === 'function') {
      const picked = await select('Paste options', [
        { value: 'chip', text: 'Paste as chip' },
        { value: 'input', text: 'Paste in input' }
      ]).catch(() => undefined);
      if (picked === 'chip' || picked === 'input') return picked;
      return null; // cancelled
    }
  } catch (e) {
    console.warn(TAG, 'select failed', e);
  }
  // Fallback simple confirm-style via window
  try {
    if (typeof confirm === 'function' && confirm('Paste as chip? (Cancel = paste in input)')) {
      return 'chip';
    }
    return 'input';
  } catch (_) {
    return 'chip';
  }
}

export function addPasteChip(app, text) {
  const body = String(text || '').slice(0, MAX_CHIP_BODY);
  if (!body.trim()) return null;
  if (!app._pasteChips) app._pasteChips = [];
  const id = 'paste_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = { id, text: body, at: Date.now(), name: `paste_${app._pasteChips.length + 1}.txt` };
  app._pasteChips.push(entry);
  renderChips(app);
  console.log(TAG, 'chip', id, body.length);
  return entry;
}

export function clearPasteChips(app) {
  if (app) app._pasteChips = [];
  const box = document.getElementById('previewContainer');
  if (box) {
    box.querySelectorAll('.gpt-paste-chip').forEach(el => el.remove());
    if (!box.children.length) {
      box.style.display = 'none';
      box.style.height = 'auto';
    }
  }
  syncChatBoxForChips();
}

export function getPasteChipsContext(app) {
  const list = app?._pasteChips || [];
  if (!list.length) return '';
  return (
    '[User pasted content chips]\n\n' +
    list.map((c, i) => `### Paste ${i + 1} (${c.name || 'chip'})\n\`\`\`\n${c.text}\n\`\`\``).join('\n\n')
  );
}

function renderChips(app) {
  const box = ensurePreviewContainer();
  if (!box) return;

  // Drop old paste chips only
  box.querySelectorAll('.gpt-paste-chip').forEach(el => el.remove());

  const list = app?._pasteChips || [];
  if (!list.length && !(box.querySelector('.gpt-image-preview-container:not(.gpt-paste-chip)'))) {
    // keep visible if image chips exist from attachedFiles
  }
  if (list.length) box.style.display = 'flex';

  for (const c of list) {
    const el = document.createElement('div');
    el.className = 'gpt-paste-chip';
    el.dataset.chipId = c.id;
    el.style.cssText = [
      'position:relative', 'display:inline-flex', 'align-items:center',
      'background:var(--secondary-color, rgba(0,0,0,0.2))',
      'border:1px solid var(--border-color, #444)',
      'border-radius:8px', 'padding:6px 10px', 'gap:8px',
      'margin:0 2px', 'flex-shrink:0', 'cursor:pointer',
      'max-width:160px', 'pointer-events:auto',
      'box-shadow:0 2px 8px rgba(0,0,0,0.25)'
    ].join(';');

    el.innerHTML = `
      ${docIconSvg()}
      <span style="font-size:12px; color:var(--primary-text-color); max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${chipLabel(c.text).replace(/</g, '&lt;')}</span>
    `;

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.className = 'gpt-close-btn';
    closeButton.style.cssText = [
      'position:absolute', 'top:-8px', 'right:-8px',
      'background:#f44336', 'color:#fff', 'border:none', 'border-radius:50%',
      'width:18px', 'height:18px', 'font-size:14px', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'box-shadow:0 2px 5px rgba(0,0,0,0.3)', 'z-index:2'
    ].join(';');
    closeButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      app._pasteChips = (app._pasteChips || []).filter(x => x.id !== c.id);
      renderChips(app);
    };
    el.appendChild(closeButton);

    el.onclick = (e) => {
      if (e.target === closeButton || closeButton.contains(e.target)) return;
      showTextPopup(c.name || 'Pasted text', c.text);
    };

    box.appendChild(el);
  }
  syncChatBoxForChips();
}

/**
 * Attach paste listener once on #gpt-user-input
 */
export function attachPasteChipListener(app) {
  const ta = document.getElementById('gpt-user-input');
  if (!ta || ta.dataset.pasteChipBound === '1') return;
  ta.dataset.pasteChipBound = '1';

  if (ta.dataset.previewBottomBound !== '1') {
    ta.dataset.previewBottomBound = '1';
    const onResize = () => {
      updatePreviewContainerBottom();
    };
    ta.addEventListener('input', onResize);
    ta.addEventListener('keyup', onResize);
    window.addEventListener('resize', onResize);
  }

  ta.addEventListener('paste', async (e) => {
    try {
      const text = e.clipboardData?.getData('text/plain') || '';
      const threshold = getThreshold();
      if (text.length < threshold) return; // normal small paste into input

      e.preventDefault();
      const mode = getPasteMode();
      let action = 'chip';
      if (mode === 'ask') {
        action = await askPasteAction();
        if (!action) return; // cancelled
      }

      if (action === 'input') {
        // Insert at cursor
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        ta.value = before + text + after;
        const pos = start + text.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
        return;
      }

      addPasteChip(app, text);
      if (typeof window.toast === 'function') {
        window.toast('Pasted as chip', 1500);
      }
    } catch (err) {
      console.warn(TAG, err);
    }
  });
}

export function renderPasteChips(app) {
  renderChips(app);
}

export const PASTE_CHIP_THRESHOLD = DEFAULT_THRESHOLD;
