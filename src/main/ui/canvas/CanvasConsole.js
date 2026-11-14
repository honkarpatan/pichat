// src/main/ui/canvas/CanvasConsole.js
/**
 * Canvas preview console + error capture.
 * - Collapse / expand
 * - Drag header to resize height
 * - Error line → Fix | Warning line → What is this
 * - Action closes canvas and sends prompt to AI
 */
import { ConfigManager } from '../../utils/ConfigManager.js';

const MSG_TYPE = 'gpt-canvas-console';

/** Script injected into preview HTML (iframe). */
export function getConsoleBridgeScript() {
  return `
<script>
(function () {
  if (window.__gptCanvasBridge) return;
  window.__gptCanvasBridge = true;
  function send(level, args) {
    try {
      var text = Array.prototype.map.call(args, function (a) {
        if (a == null) return String(a);
        if (typeof a === 'string') return a;
        if (a && a.stack) return a.stack;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
      parent.postMessage({ type: '${MSG_TYPE}', level: level, text: text, ts: Date.now() }, '*');
    } catch (e) {}
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level] && console[level].bind(console);
    console[level] = function () {
      try { send(level, arguments); } catch (e) {}
      if (orig) try { return orig.apply(console, arguments); } catch (e2) {}
    };
  });
  window.addEventListener('error', function (ev) {
    var msg = (ev && ev.message) || 'Script error';
    var where = '';
    if (ev && ev.filename) where = ' @ ' + ev.filename + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0);
    send('error', [msg + where]);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    send('error', ['Unhandled rejection: ' + (r && r.stack ? r.stack : String(r))]);
  });
})();
</script>`;
}

export function injectConsoleBridge(html) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes('__gptCanvasBridge')) return html;
  const bridge = getConsoleBridgeScript();
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, bridge + '</head>');
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body([^>]*)>/i, '<body$1>' + bridge);
  return bridge + html;
}

export class CanvasConsoleUI {
  constructor(canvasManager) {
    this.cm = canvasManager;
    this.logs = [];
    this._onMessage = this._onMessage.bind(this);
    this._bound = false;
    this.collapsed = false;
    this._heightPx = 180;
  }

  bind() {
    if (this._bound) return;
    window.addEventListener('message', this._onMessage);
    this._bound = true;
  }

  unbind() {
    window.removeEventListener('message', this._onMessage);
    this._bound = false;
  }

  clear() {
    this.logs = [];
    this._render();
    this._updateErrorBar();
  }

  _onMessage(ev) {
    const d = ev?.data;
    if (!d || d.type !== MSG_TYPE) return;
    this.logs.push({
      level: d.level || 'log',
      text: String(d.text || ''),
      ts: d.ts || Date.now()
    });
    if (this.logs.length > 300) this.logs = this.logs.slice(-300);
    this._render();
    if (d.level === 'error' || d.level === 'warn') this._updateErrorBar();
  }

  mountShell(bodyEl) {
    if (!bodyEl) return;
    let wrap = bodyEl.querySelector('.gpt-canvas-console-wrap');
    if (wrap) {
      this._applyHeight();
      return wrap;
    }

    wrap = document.createElement('div');
    wrap.className = 'gpt-canvas-console-wrap';
    wrap.innerHTML = `
      <div class="gpt-canvas-console-resize" id="gpt-canvas-console-resize" title="Drag to resize"></div>
      <div class="gpt-canvas-error-bar" id="gpt-canvas-error-bar" style="display:none;"></div>
      <div class="gpt-canvas-console" id="gpt-canvas-console">
        <div class="gpt-canvas-console-head" id="gpt-canvas-console-head">
          <button type="button" class="gpt-canvas-console-toggle" id="gpt-canvas-console-toggle" title="Collapse / expand">▾</button>
          <span class="gpt-canvas-console-title">Console</span>
          <span class="gpt-canvas-console-count" id="gpt-canvas-console-count"></span>
          <button type="button" class="gpt-canvas-console-clear" id="gpt-canvas-console-clear" title="Clear">Clear</button>
        </div>
        <div class="gpt-canvas-console-body" id="gpt-canvas-console-body"></div>
      </div>`;
    bodyEl.appendChild(wrap);

    wrap.querySelector('#gpt-canvas-console-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clear();
    });
    wrap.querySelector('#gpt-canvas-console-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapse();
    });
    // Tap title toggles too
    wrap.querySelector('#gpt-canvas-console-head')?.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.toggleCollapse();
    });

    this._bindResize(wrap);
    this._applyHeight();
    return wrap;
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
    const wrap = document.querySelector('.gpt-canvas-console-wrap');
    const btn = document.getElementById('gpt-canvas-console-toggle');
    if (wrap) wrap.classList.toggle('is-collapsed', this.collapsed);
    if (btn) btn.textContent = this.collapsed ? '▸' : '▾';
    this._applyHeight();
  }

  _applyHeight() {
    const host = document.getElementById('gpt-canvas-console-host');
    const wrap = document.querySelector('.gpt-canvas-console-wrap');
    if (!host) return;
    // Overlay on top of HTML — never compresses #gpt-canvas-body
    host.style.position = 'absolute';
    host.style.left = '0';
    host.style.right = '0';
    host.style.bottom = '0';
    host.style.zIndex = '20';
    if (this.collapsed) {
      host.style.height = '36px';
      if (wrap) wrap.style.height = '36px';
    } else {
      const h = Math.max(80, Math.min(this._heightPx, Math.floor(window.innerHeight * 0.45)));
      host.style.height = h + 'px';
      if (wrap) wrap.style.height = '100%';
    }
  }

  _bindResize(wrap) {
    const handle = wrap.querySelector('#gpt-canvas-console-resize');
    if (!handle || handle._gptBound) return;
    handle._gptBound = true;
    let startY = 0;
    let startH = 0;
    const onMove = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dy = startY - y; // drag up → taller console
      this._heightPx = Math.max(80, Math.min(startH + dy, Math.floor(window.innerHeight * 0.55)));
      this.collapsed = false;
      wrap.classList.remove('is-collapsed');
      const btn = document.getElementById('gpt-canvas-console-toggle');
      if (btn) btn.textContent = '▾';
      this._applyHeight();
    };
    const onEnd = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    const onStart = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      startY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      startH = this.collapsed ? 180 : this._heightPx;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    };
    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
  }

  _render() {
    const body = document.getElementById('gpt-canvas-console-body');
    const countEl = document.getElementById('gpt-canvas-console-count');
    if (countEl) {
      const e = this.logs.filter((l) => l.level === 'error').length;
      const w = this.logs.filter((l) => l.level === 'warn').length;
      countEl.textContent = e || w ? `${e ? e + ' err' : ''}${e && w ? ' · ' : ''}${w ? w + ' warn' : ''}` : `${this.logs.length}`;
    }
    if (!body) return;

    body.innerHTML = this.logs
      .map((l, idx) => {
        const cls = l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : 'log';
        let act = '';
        if (l.level === 'error') {
          act = `<button type="button" class="gpt-csl-act" data-idx="${idx}" data-act="fix">Fix</button>`;
        } else if (l.level === 'warn') {
          act = `<button type="button" class="gpt-csl-act" data-idx="${idx}" data-act="explain">What is this?</button>`;
        }
        return `<div class="gpt-canvas-console-line ${cls}" data-idx="${idx}">
          <span class="lvl">${l.level}</span>
          <span class="txt">${escapeHtml(l.text)}</span>
          ${act}
        </div>`;
      })
      .join('');

    body.querySelectorAll('.gpt-csl-act').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-idx'));
        const act = btn.getAttribute('data-act');
        const row = this.logs[idx];
        if (!row) return;
        if (act === 'fix') this.askAiAbout(row, 'fix');
        else this.askAiAbout(row, 'explain');
      });
    });

    body.scrollTop = body.scrollHeight;
  }

  _errors() {
    return this.logs.filter((l) => l.level === 'error');
  }

  _updateErrorBar() {
    const bar = document.getElementById('gpt-canvas-error-bar');
    if (!bar) return;
    const errs = this._errors();
    if (!errs.length) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
    const last = errs[errs.length - 1].text.slice(0, 160);
    bar.style.display = 'flex';
    bar.innerHTML = `
      <span class="gpt-canvas-error-msg" title="${escapeAttr(last)}">${errs.length} error(s) — ${escapeHtml(last)}</span>
      <button type="button" class="gpt-canvas-fix-btn" id="gpt-canvas-fix-once">Fix</button>
      <button type="button" class="gpt-canvas-fix-btn primary" id="gpt-canvas-fix-auto">Auto-fix</button>`;
    bar.querySelector('#gpt-canvas-fix-once')?.addEventListener('click', () => this.requestFix(false));
    bar.querySelector('#gpt-canvas-fix-auto')?.addEventListener('click', () => this.requestFix(true));

    if (ConfigManager.get('canvasAutoAskFix') === 'true') {
      this._maybeAutoAsk(errs);
    }
  }

  _maybeAutoAsk(errs) {
    if (this._askedHash === errs.map((e) => e.text).join('|').slice(0, 200)) return;
    this._askedHash = errs.map((e) => e.text).join('|').slice(0, 200);
    if (ConfigManager.get('canvasAutoFixSend') === 'true') {
      this.requestFix(true);
    }
  }

  /** Close canvas + send prompt to chat (always tries Send). */
  askAiAbout(row, mode) {
    const file = this.cm?._lastOpen?.src || this.cm?._lastOpen?.title || 'preview file';
    const text = row?.text || '';
    let prompt;
    if (mode === 'fix' || row?.level === 'error') {
      prompt = `Canvas preview error in \`${file}\`. Please fix it (edit the project files as needed).\n\nError:\n${text}`;
    } else {
      prompt = `Canvas preview warning in \`${file}\`. What is this warning and should I worry? Explain briefly and suggest a fix if needed.\n\nWarning:\n${text}`;
    }
    this._closeCanvasAndSend(prompt, true);
  }

  requestFix(autoLoop) {
    const errs = this._errors();
    if (!errs.length) {
      window.toast?.('No console errors to fix');
      return;
    }
    const file = this.cm?._lastOpen?.src || this.cm?._lastOpen?.title || 'preview file';
    const list = errs
      .slice(-8)
      .map((e, i) => `${i + 1}. ${e.text}`)
      .join('\n');
    const prompt = autoLoop
      ? `Canvas preview reported runtime errors in \`${file}\`. Please fix them fully (edit files as needed) and keep fixing until the errors are resolved. Do not ask me to click Fix again.\n\nErrors:\n${list}`
      : `Canvas preview reported runtime errors in \`${file}\`. Please fix these errors:\n\n${list}`;

    this._closeCanvasAndSend(prompt, autoLoop || ConfigManager.get('canvasAutoFixSend') === 'true');
  }

  _closeCanvasAndSend(prompt, autoSend) {
    try {
      this.cm?.close?.();
    } catch (_) {}

    const input =
      document.getElementById('gpt-user-input') ||
      document.querySelector('#user-input, textarea.gpt-user-input, #gpt-chat-input');
    if (input) {
      input.value = prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }

    if (autoSend) {
      const sendBtn =
        document.getElementById('gpt-send-btn') ||
        document.querySelector('.gpt-send-btn, #send-button, button.gpt-send');
      if (sendBtn) setTimeout(() => sendBtn.click(), 80);
      else window.toast?.('Prompt ready — press Send');
    } else {
      window.toast?.('Prompt filled — press Send');
    }
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
