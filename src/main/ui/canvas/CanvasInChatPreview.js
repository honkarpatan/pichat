// src/main/ui/canvas/CanvasInChatPreview.js
/**
 * In-chat HTML preview with scan effect on source, then live iframe.
 * Minimum ~3s visible so the user can glance at what the agent previewed.
 */
import { CanvasBundler } from '../../core/canvas/CanvasBundler.js'; 
import { injectConsoleBridge } from './CanvasConsole.js';

const MSG_TYPE = 'gpt-canvas-console';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findChatHost() {
  return (
    document.querySelector('.gpt-agent-work-wrapper:last-of-type') ||
    document.querySelector('#gpt-chat-messages .assistant-message:last-of-type .message-content') ||
    document.querySelector('#gpt-chat-messages .message.assistant:last-of-type') ||
    document.querySelector('#gpt-messages') ||
    document.body
  );
}

/**
 * @param {object} opts
 * @param {string} opts.fileUrl
 * @param {string} [opts.label]
 * @param {number} [opts.minMs=3000]
 * @param {number} [opts.timeoutMs=4500]
 * @returns {Promise<{ ok: boolean, errors: string[], label: string, timedOut: boolean }>}
 */
export async function runInChatHtmlPreview(opts = {}) {
  const fileUrl = opts.fileUrl;
  const label = opts.label || (fileUrl || '').split('/').pop() || 'index.html';
  const minMs = Math.max(3000, Number(opts.minMs) || 3000);
  const timeoutMs = Number(opts.timeoutMs) || 4500;
  const t0 = Date.now();

  const host = findChatHost();
  const card = document.createElement('div');
  card.className = 'gpt-chat-html-preview is-running';
  card.innerHTML = `
    <div class="gpt-chp-head">
      <span class="gpt-chp-status" data-st>previewing…</span>
      <span class="gpt-chp-file">${esc(label)}</span>
    </div>
    <div class="gpt-chp-code-wrap gpt-diff-content">
      <div class="gpt-chp-scan" aria-hidden="true"></div>
      <div class="gpt-chp-code gpt-chp-diff-body"><div class="gpt-diff-row gpt-diff-ctx"><span class="gpt-diff-sign"></span><span class="gpt-diff-text">Loading source…</span></div></div>
    </div>
    <div class="gpt-chp-frame-wrap" style="display:none;">
      <iframe class="gpt-chp-frame" sandbox="allow-scripts allow-same-origin allow-forms" title="preview"></iframe>
    </div>
    <div class="gpt-chp-foot muted">Checking runtime…</div>
  `;
  host.appendChild(card);

  const setStatus = (t) => {
    const el = card.querySelector('[data-st]');
    if (el) el.textContent = t;
  };
  const setFoot = (t) => {
    const el = card.querySelector('.gpt-chp-foot');
    if (el) el.textContent = t;
  };

  let sourceText = '';
  let html = '';
  try {
    const bundled = await CanvasBundler.buildFromHtmlFile(fileUrl);
    if (bundled.success) {
      html = bundled.html;
      // show original-ish source for scan (read raw file for display)
      try {
        const fs = acode.require('fs');
        sourceText = await fs(fileUrl).readFile('utf-8');
      } catch (_) {
        sourceText = html.slice(0, 8000);
      }
    } else {
      throw new Error(bundled.error || 'bundle failed');
    }
  } catch (e) {
    setStatus('failed');
    setFoot(String(e.message || e));
    card.classList.add('is-error');
    await sleep(Math.max(0, minMs - (Date.now() - t0)));
    card.classList.add('is-leaving');
    await sleep(400);
    card.remove();
    return { ok: false, errors: [String(e.message || e)], label, timedOut: false };
  }

  // Diff-style rows (contained) + scan light inside the box only
  const codeEl = card.querySelector('.gpt-chp-code');
  const lines = String(sourceText || '')
    .split('\n')
    .slice(0, 80);
  if (String(sourceText || '').split('\n').length > 80) {
    lines.push('⋯ truncated ⋯');
  }
  codeEl.innerHTML = lines
    .map((ln) => {
      const t = esc(ln);
      return `<div class="gpt-diff-row gpt-diff-ctx"><span class="gpt-diff-sign"></span><span class="gpt-diff-text">${t || ' '}</span></div>`;
    })
    .join('');
  card.classList.add('is-scanning');
  setStatus('scanning…');

  await sleep(900); // scan animation window

  // Live preview in chat
  setStatus(`previewed: ${label}`);
  card.classList.remove('is-scanning');
  card.classList.add('is-previewing');
  const wrap = card.querySelector('.gpt-chp-frame-wrap');
  const iframe = card.querySelector('.gpt-chp-frame');
  wrap.style.display = 'block';

  const errors = [];
  const onMsg = (ev) => {
    const d = ev?.data;
    if (!d || d.type !== MSG_TYPE) return;
    if (d.level === 'error') errors.push(String(d.text || ''));
  };
  window.addEventListener('message', onMsg);
  iframe.srcdoc = injectConsoleBridge(html);

  // Wait for errors / timeout while keeping UI open at least minMs
  await sleep(Math.min(timeoutMs, 2500));
  window.removeEventListener('message', onMsg);

  const elapsed = Date.now() - t0;
  const remain = minMs - elapsed;
  if (remain > 0) await sleep(remain);

  setStatus(errors.length ? `checked · ${errors.length} error(s)` : 'checked · ok');
  setFoot(
    errors.length
      ? errors.slice(0, 3).join(' · ')
      : 'No runtime errors in preview window'
  );
  card.classList.toggle('is-error', errors.length > 0);
  card.classList.add('is-done');

  await sleep(500);
  card.classList.add('is-leaving');
  await sleep(450);
  try {
    card.remove();
  } catch (_) {}

  return {
    ok: errors.length === 0,
    errors,
    label,
    timedOut: false
  };
}
