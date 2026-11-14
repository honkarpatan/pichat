/**
 * WhatsApp-style centered event / error rows in chat.
 */

const ICON_INFO = `<svg class="gpt-event-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

const ICON_ERROR = `<svg class="gpt-event-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

const ICON_WARN = `<svg class="gpt-event-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const ICON_CONTINUE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="10 8 16 12 10 16"/></svg>`;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} msg { content, type?, action?, continuePrompt? }
 * @returns {{ el: HTMLElement, bind: function(app) }}
 */
export function buildEventMessageElement(msg = {}) {
  const type = msg.type === 'error' ? 'error' : (msg.type === 'warn' ? 'warn' : 'info');
  const text = String(msg.content || msg.text || '');
  const action = msg.action || null;
  const long = text.length > 64;

  const el = document.createElement('div');
  el.className = `gpt-message gpt-event-message gpt-event-${type}`;
  el.setAttribute('data-msg-role', 'event');
  el.setAttribute('data-event-type', type);
  if (action) el.setAttribute('data-event-action', action);

  const icon = type === 'error' ? ICON_ERROR : (type === 'warn' ? ICON_WARN : ICON_INFO);
  const color =
    type === 'error' ? 'var(--error-text-color, #e57373)' :
    type === 'warn' ? 'var(--warning-text-color, #ffb74d)' :
    'var(--primary-text-color)';

  el.style.cssText = [
    'display:block',
    'position:relative',
    'z-index:1',
    'width:calc(100% - 16px)',
    'margin:6px 8px',
    'padding:0 10px',
    'box-sizing:border-box',
    `color:${color}`,
    'cursor:default',
    'user-select:none',
    'overflow:hidden',
    'clear:both',
    'flex-shrink:0',
    'transition:min-height 0.22s ease'
  ].join(';');

  // Collapsed: small min-height (not max-height)
  el.style.setProperty('min-height', long ? '22px' : '22px', 'important');

  const actionBtn = action
    ? `<button type="button" class="gpt-event-action" title="Continue" aria-label="Continue">${ICON_CONTINUE}</button>`
    : '';

  el.innerHTML = `
    <div class="gpt-event-inner" style="display:flex;align-items:flex-start;gap:0;max-width:100%;min-width:0;justify-content:center;">
      <span class="gpt-event-icon" style="display:inline;flex-shrink:0;line-height:16px;font-size:0;padding-right:4px;padding-top:1px;">${icon}</span>
      <div class="gpt-event-text${long ? ' is-clamp' : ''}" style="font-size:11px;line-height:16px;opacity:0.72;text-align:start;min-width:0;flex:1 1 auto;">${escapeHtml(text)}</div>
      ${actionBtn}
    </div>
  `;

  const textEl = el.querySelector('.gpt-event-text');
  const btn = el.querySelector('.gpt-event-action');
  if (btn) {
    btn.style.cssText = [
      'flex-shrink:0',
      'width:22px',
      'height:22px',
      'margin-left:6px',
      'border-radius:50%',
      'border:none',
      'background:transparent',
      'color:inherit',
      'display:inline',
      'padding:0',
      'cursor:pointer',
      'opacity:0.85',
      'align-self:flex-start',
      'line-height:22px',
      'vertical-align:middle'
    ].join(';');
  }

  if (textEl && long) {
    textEl.style.overflow = 'hidden';
    textEl.style.textOverflow = 'ellipsis';
    textEl.style.whiteSpace = 'nowrap';
    textEl.style.maxWidth = action ? 'min(68vw, 260px)' : 'min(82vw, 320px)';
  }

  function setOpen(open) {
    if (!textEl || !long) return;
    if (open) {
      textEl.classList.add('is-open');
      textEl.style.whiteSpace = 'normal';
      textEl.style.overflow = 'visible';
      textEl.style.textOverflow = 'unset';
      textEl.style.maxWidth = 'min(90vw, 400px)';
      // measure natural height then set min-height !important
      el.style.setProperty('min-height', '22px', 'important');
      void el.offsetHeight;
      const h = Math.max(22, el.scrollHeight + 6);
      el.style.setProperty('min-height', h + 'px', 'important');
    } else {
      textEl.classList.remove('is-open');
      textEl.style.whiteSpace = 'nowrap';
      textEl.style.overflow = 'hidden';
      textEl.style.textOverflow = 'ellipsis';
      textEl.style.maxWidth = action ? 'min(68vw, 260px)' : 'min(82vw, 320px)';
      el.style.setProperty('min-height', '22px', 'important');
    }
  }

  function bind(app) {
    if (long && textEl) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.gpt-event-action')) return;
        setOpen(!textEl.classList.contains('is-open'));
      });
      el.style.cursor = 'pointer';
      el.title = 'Tap to expand';
    }

    if (btn && action === 'continue') {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (app?.isFetching) return;
        btn.disabled = true;
        const prompt =
          msg.continuePrompt ||
          (type === 'error'
            ? 'Continue from where you left off. Keep context short; do not repeat finished work.'
            : 'Please continue.');
        try {
          if (app?.chatHandler?.handleSendMessage) {
            await app.chatHandler.handleSendMessage(prompt);
          }
        } catch (_) {
          btn.disabled = false;
        }
      });
    }
  }

  return { el, bind };
}

/** Append event after assistant response (never between user and assistant). */
export function appendEventToChatBox(box, el, afterEl = null) {
  if (!box || !el) return;
  try {
    box.querySelectorAll('.assistant-message.increaseChatHeight').forEach((m) => {
      m.classList.remove('increaseChatHeight');
      try { m.style.minHeight = ''; } catch (_) {}
    });

    // Prefer last assistant bubble in the chat box
    const assistants = box.querySelectorAll(':scope > .assistant-message, :scope > .gpt-message.assistant-message');
    let anchor = assistants.length ? assistants[assistants.length - 1] : null;

    // Explicit afterEl only if it is an assistant (or we have no assistant)
    if (afterEl && afterEl.parentNode === box) {
      if (afterEl.classList?.contains('assistant-message') || afterEl.getAttribute('data-msg-role') === 'assistant') {
        anchor = afterEl;
      }
    }

    if (!anchor) {
      // No assistant yet — append at end (should be rare; caller should finalize assistant first)
      box.appendChild(el);
    } else {
      // Skip past any event rows already after this assistant
      let insertBefore = anchor.nextSibling;
      while (insertBefore && insertBefore.nodeType === 1 &&
             (insertBefore.classList?.contains('gpt-event-message') ||
              insertBefore.getAttribute?.('data-msg-role') === 'event')) {
        insertBefore = insertBefore.nextSibling;
      }
      if (insertBefore) box.insertBefore(el, insertBefore);
      else box.appendChild(el);
    }
  } catch (_) {
    try { box.appendChild(el); } catch (__) {}
  }
  try { box.scrollTop = box.scrollHeight; } catch (_) {}
}

export function applyEventMessageStylesOnce() {
  if (document.getElementById('gpt-event-style')) {
    // refresh rules
    document.getElementById('gpt-event-style').textContent = eventCss();
    return;
  }
  const s = document.createElement('style');
  s.id = 'gpt-event-style';
  s.textContent = eventCss();
  document.head.appendChild(s);
}

function eventCss() {
  return `
    .gpt-event-message,
    .gpt-message.gpt-event-message {
      position: relative !important;
      z-index: 1;
      clear: both;
      overflow: hidden;
      transition: min-height 0.22s ease;
      width: calc(100% - 16px) !important;
      box-sizing: border-box;
    }
    .gpt-event-message .gpt-event-icon {
      display: inline !important;
      line-height: 16px;
      vertical-align: top;
    }
    .gpt-event-message .gpt-event-icon svg {
      display: inline !important;
      vertical-align: -2px;
    }
    .gpt-event-message .gpt-event-text {
      text-align: start !important;
    }
    .gpt-event-message .gpt-event-inner {
      gap: 0 !important;
    }
    .gpt-event-message .gpt-event-action {
      display: inline !important;
      border: none !important;
      background: transparent !important;
      box-shadow: none !important;
      outline: none !important;
    }
    .gpt-event-message.gpt-event-error { color: var(--error-text-color, #e57373); }
    .gpt-event-message.gpt-event-warn { color: var(--warning-text-color, #ffb74d); }
    .gpt-event-message.gpt-event-info { color: var(--primary-text-color); }
    .gpt-event-message .gpt-event-action:active { opacity: 1; transform: scale(0.94); }
    .assistant-message.increaseChatHeight:has(+ .gpt-event-message) {
      min-height: 0 !important;
      height: auto !important;
    }
  `;
}
