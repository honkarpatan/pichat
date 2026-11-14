// src/main/core/canvas/CanvasPostAgent.js
/**
 * After agent writes HTML/JS, optionally run a headless canvas preview,
 * collect runtime errors (with timeout), and surface Fix / Auto-fix in chat.
 */
import { ConfigManager } from '../../utils/ConfigManager.js';
import { CanvasBundler } from './CanvasBundler.js';
import { injectConsoleBridge, getConsoleBridgeScript } from '../../ui/canvas/CanvasConsole.js';

const TAG = '[CanvasPostAgent]';
const MSG_TYPE = 'gpt-canvas-console';

function isHtmlPath(p) {
  return /\.html?$/i.test(String(p || ''));
}
function isScriptPath(p) {
  return /\.(js|mjs|cjs)$/i.test(String(p || ''));
}

function pickPreviewTarget(actions) {
  const list = actions || [];
  // Prefer written HTML
  for (const a of list) {
    const path = a.fullPath || a.url || a.label || a.target || '';
    if (a.status === 'error') continue;
    if (isHtmlPath(path) && (a.url || a.fullPath)) {
      return { url: a.url || a.fullPath, label: a.label || path };
    }
  }
  // If only scripts written, try sibling index.html via dirname
  for (const a of list) {
    const path = a.fullPath || a.url || a.label || '';
    if (!isScriptPath(path)) continue;
    const base = String(a.url || a.fullPath || '').replace(/\/[^/]+$/, '');
    if (base) {
      return { url: `${base}/index.html`, label: 'index.html', guessed: true };
    }
  }
  return null;
}

/**
 * Headless iframe preview: wait up to timeoutMs for errors, then resolve.
 */
function runHeadlessPreview(html, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const errors = [];
    const logs = [];
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';

    const onMsg = (ev) => {
      const d = ev?.data;
      if (!d || d.type !== MSG_TYPE) return;
      const row = { level: d.level, text: String(d.text || '') };
      logs.push(row);
      if (d.level === 'error') errors.push(row);
    };
    window.addEventListener('message', onMsg);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMsg);
      try {
        iframe.remove();
      } catch (_) {}
      resolve({ errors, logs });
    };

    // Settle early if we got errors and a short grace period passed
    const start = Date.now();
    const tick = setInterval(() => {
      if (errors.length && Date.now() - start > 1200) {
        clearInterval(tick);
        finish();
      }
    }, 200);

    setTimeout(() => {
      clearInterval(tick);
      finish();
    }, timeoutMs);

    document.body.appendChild(iframe);
    iframe.srcdoc = injectConsoleBridge(html);
  });
}

function buildErrorCard(fileLabel, errors, timeoutHit) {
  const id = `gpt-cv-err-${Date.now()}`;
  const list = errors
    .slice(0, 10)
    .map((e, i) => `<li style="margin:4px 0;">${i + 1}. ${esc(e.text)}</li>`)
    .join('');
  const errPayload = encodeURIComponent(JSON.stringify(errors.map((e) => e.text)));
  return `
<div class="gpt-canvas-agent-report" id="${id}" data-file="${escAttr(fileLabel)}" data-errors="${errPayload}">
  <div class="gpt-canvas-agent-report-head">
    <span class="dot"></span>
    <b>Canvas preview</b>
    <span class="muted">${esc(fileLabel)}${timeoutHit ? ' · timed out waiting' : ''}</span>
  </div>
  <div class="gpt-canvas-agent-report-body">
    <p style="margin:0 0 6px;font-size:12px;color:#ff8a80;">${errors.length} runtime error(s) detected</p>
    <ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.45;color:var(--primary-text-color,#ddd);">${list}</ul>
  </div>
  <div class="gpt-canvas-agent-report-actions">
    <button type="button" class="gpt-canvas-fix-btn" data-act="fix">Fix</button>
    <button type="button" class="gpt-canvas-fix-btn primary" data-act="auto">Auto-fix</button>
  </div>
</div>`;
}

function buildOkCard(fileLabel) {
  return `
<div class="gpt-canvas-agent-report ok">
  <div class="gpt-canvas-agent-report-head">
    <span class="dot ok"></span>
    <b>Canvas preview</b>
    <span class="muted">${esc(fileLabel)} · no runtime errors</span>
  </div>
</div>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

function injectCardHtml(app, html) {
  // Prefer live chat stream area
  const live =
    document.querySelector('.gpt-agent-work-wrapper:last-of-type') ||
    document.querySelector('#gpt-chat-messages .assistant-message:last-of-type .message-content') ||
    document.querySelector('#gpt-chat-messages .message.assistant:last-of-type') ||
    document.querySelector('#gpt-messages');
  const host = document.createElement('div');
  host.innerHTML = html;
  const node = host.firstElementChild;
  if (!node) return;

  if (live) {
    live.appendChild(node);
  } else {
    document.body.appendChild(node);
  }

  node.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-act');
      const file = node.getAttribute('data-file') || 'preview';
      let errs = [];
      try {
        errs = JSON.parse(decodeURIComponent(node.getAttribute('data-errors') || '[]'));
      } catch (_) {}
      const list = errs.map((t, i) => `${i + 1}. ${t}`).join('\n');
      const auto = act === 'auto';
      const prompt = auto
        ? `Canvas preview found runtime errors in \`${file}\`. Fix them completely (edit project files). Keep going until errors are gone — do not ask me to click Fix again.\n\nErrors:\n${list}`
        : `Canvas preview found runtime errors in \`${file}\`. Please fix:\n\n${list}`;

      const input =
        document.getElementById('gpt-user-input') ||
        document.querySelector('#user-input, textarea.gpt-user-input');
      if (input) {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      if (auto || ConfigManager.get('canvasAutoFixSend') === 'true') {
        const send =
          document.getElementById('gpt-send-btn') ||
          document.querySelector('.gpt-send-btn, #send-button');
        if (send) setTimeout(() => send.click(), 60);
        else window.toast?.('Prompt ready — press Send');
      } else {
        window.toast?.('Fix prompt filled — press Send');
      }
    });
  });

  // Persist lightly into last assistant message text if history API available
  try {
    if (app?.chatHistoryManager && typeof app.chatHistoryManager.addMessageToHistory === 'function') {
      // skip full history HTML spam — card is live-only unless user saves chat render path
    }
  } catch (_) {}
}

export const CanvasPostAgent = {
  /**
   * Call after agent turn finalizes.
   * @param {object} app
   * @param {array} actionsTaken
   */
  async afterAgentTurn(app, actionsTaken = []) {
    try {
      const { HeldWrites } = await import('../../utils/file/HeldWrites.js');
      if (HeldWrites.pendingCount(app) > 0) {
        console.log(TAG, 'skip preview — held writes pending');
        return;
      }
    } catch (_) {}

    if (ConfigManager.get('canvasAutoRunAfterAgent') === 'false') return;
    if (!actionsTaken?.length) return;

    const target = pickPreviewTarget(actionsTaken);
    if (!target?.url) {
      console.log(TAG, 'no HTML target from actions');
      return;
    }

    // If guessed index.html, verify exists
    try {
      const fs = acode.require('fs');
      if (!(await fs(target.url).exists())) {
        console.log(TAG, 'target missing', target.url);
        return;
      }
    } catch (_) {
      return;
    }

    console.log(TAG, 'preview', target.url);
    const clearStatus = () => {
      try {
        // show=false schedules clear; also force-clear immediately
        app.chatHandler?.liveUI?.updateAssistantMessage?.(false, '', 0);
        const turn = app._currentTurn;
        if (turn?.statusLine) {
          turn.statusLine.style.display = 'none';
          turn.statusLine.innerHTML = '';
        }
      } catch (_) {}
    };

    try {
      app.chatHandler?.liveUI?.updateAssistantMessage?.(true, 'Running canvas preview…', 4000);
    } catch (_) {}

    const timeoutMs = Number(ConfigManager.get('canvasPreviewTimeoutMs') || 4500);
    let html = null;
    try {
      const bundled = await CanvasBundler.buildFromHtmlFile(target.url);
      if (bundled.success) html = bundled.html;
    } catch (e) {
      console.warn(TAG, 'bundle failed', e);
    }
    if (!html) {
      try {
        const fs = acode.require('fs');
        html = await fs(target.url).readFile('utf-8');
      } catch (e) {
        console.warn(TAG, 'read html failed', e);
        clearStatus();
        return;
      }
    }

    let errors = [];
    try {
      const result = await runHeadlessPreview(html, timeoutMs);
      errors = result?.errors || [];
    } catch (e) {
      console.warn(TAG, 'headless preview failed', e);
      clearStatus();
      return;
    }

    clearStatus();
    const timeoutHit = false; // informational only

    if (!errors.length) {
      injectCardHtml(app, buildOkCard(target.label || target.url));
      return;
    }

    injectCardHtml(app, buildErrorCard(target.label || target.url, errors, timeoutHit));

    // Optionally auto-open visible canvas too
    try {
      if (ConfigManager.get('canvasOpenOnError') === 'true' && app.canvasManager?.open) {
        app.canvasManager.open({
          mode: 'file',
          src: target.url,
          title: target.label || 'Preview'
        });
      }
    } catch (_) {}

    // Auto-fix turn: fill + send without waiting for user click
    try {
      const auto = ConfigManager.get('agentCanvasAutoFix');
      if (auto === true || auto === 'true' || auto === 1 || auto === '1') {
        const list = errors.map((e, i) => `${i + 1}. ${e.text || e}`).join('\n');
        const prompt =
          `Canvas preview found runtime errors in \`${target.label || target.url}\`. ` +
          `Fix them completely (edit project files). Keep going until errors are gone.\n\nErrors:\n${list}`;
        const input =
          document.getElementById('gpt-user-input') ||
          document.querySelector('#user-input, textarea.gpt-user-input');
        if (input) {
          input.value = prompt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const send =
          document.getElementById('send-btn') ||
          document.getElementById('gpt-send-btn') ||
          document.querySelector('.gpt-send-btn, #send-button');
        if (send) {
          console.log(TAG, 'agentCanvasAutoFix → send');
          setTimeout(() => { try { send.click(); } catch (_) {} }, 120);
        }
      }
    } catch (e) {
      console.warn(TAG, 'auto-fix', e);
    }
  }
};
