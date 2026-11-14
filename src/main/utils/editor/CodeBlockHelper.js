/**
 * Code-block helpers — response.txt shell only:
 *   .gpt-diff-view.gpt-code-view
 *     .gpt-diff-header  (click → collapse)
 *     .gpt-diff-content > pre
 * Styles in response.css only.
 */

const MIN_CODE_CHARS = 40;

function isAgentPreview(pre) {
  if (!pre || !pre.closest) return false;
  return !!(
    pre.closest('.gpt-agent-log') ||
    pre.closest('.gpt-live-preview-box') ||
    pre.closest('.gpt-diff-view') ||
    pre.closest('.gpt-terminal-block') ||
    pre.closest('.gpt-file-tree') ||
    pre.closest('.gpt-diff-content') ||
    pre.closest('.gpt-oc-row-body') ||
    pre.closest('.gpt-oc-thinking-body') ||
    pre.closest('.gpt-oc-cmd-out') ||
    pre.closest('.gpt-oc-entries')
  );
}

function isRealCodeBlock(pre) {
  if (!pre) return false;
  if (isAgentPreview(pre)) return false;
  if (pre.dataset.gptNoCopy === '1') return false;
  if (pre.className && /language-/.test(pre.className)) return true;
  const code = pre.querySelector('code');
  const text = (code || pre).textContent || '';
  if (text.trim().length < MIN_CODE_CHARS) return false;
  if (text.includes('\n') || /[{};=<>]|function |const |let |import /.test(text)) return true;
  return false;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const SELECT_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export function hasBalancedCodeBlocks(text) {
  if (!text) return true;
  const opens = (String(text).match(/^```/gm) || []).length;
  return opens % 2 === 0;
}

/**
 * Wrap every real <pre> as:
 *   <div class="gpt-diff-view gpt-code-view">
 *     <div class="gpt-diff-header">lang + actions</div>
 *     <div class="gpt-diff-content"><pre>…</pre></div>
 *   </div>
 */
export function addCopyButton(root) {
  if (!root || !root.querySelectorAll) return;

  root.querySelectorAll(
    '.gpt-agent-log .gpt-code-btns-container, .gpt-live-preview-box .gpt-code-btns-container, .gpt-diff-view .gpt-code-btns-container'
  ).forEach(el => {
    try { el.remove(); } catch (e) {}
  });

  root.querySelectorAll('.gpt-live-preview-content pre, .gpt-diff-content pre').forEach(pre => {
    pre.style.position = '';
    pre.dataset.gptNoCopy = '1';
  });

  const pres = root.querySelectorAll('pre');
  pres.forEach(pre => {
    if (!isRealCodeBlock(pre)) return;
    // Already in professional shell (live re-paint) — keep
    if (pre.closest('.gpt-diff-view.gpt-code-view') || pre.closest('.gpt-diff-view')) return;

    const lang =
      Array.from(pre.classList).find(c => c.startsWith('language-'))?.replace('language-', '') ||
      Array.from(pre.querySelector('code')?.classList || []).find(c => c.startsWith('language-'))?.replace('language-', '') ||
      'code';

    const parent = pre.parentNode;
    if (!parent) return;

    const wrap = document.createElement('div');
    wrap.className = 'gpt-diff-view gpt-code-view';
    parent.insertBefore(wrap, pre);

    const header = document.createElement('div');
    header.className = 'gpt-diff-header';
    header.style.cursor = 'pointer';
    header.innerHTML = `
      <span class="gpt-code-lang">${esc(lang)}</span>
      <div class="gpt-code-actions">
        <button type="button" class="gpt-code-btn gpt-selectall-btn" title="Select all">${SELECT_SVG}</button>
        <button type="button" class="gpt-code-btn copy-btn" title="Copy">${COPY_SVG}</button>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'gpt-diff-content';
    body.appendChild(pre);

    wrap.appendChild(header);
    wrap.appendChild(body);

    header.addEventListener('click', (e) => {
      if (e.target.closest('.gpt-code-btn')) return;
      wrap.classList.toggle('is-collapsed');
    });

    const codeEl = pre.querySelector('code') || pre;
    header.querySelector('.gpt-selectall-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    header.querySelector('.copy-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const text = codeEl.textContent || '';
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        btn.innerHTML = CHECK_SVG;
        btn.classList.add('is-copied');
        setTimeout(() => {
          btn.innerHTML = COPY_SVG;
          btn.classList.remove('is-copied');
        }, 1600);
      } catch (err) { /* ignore */ }
    });
  });
}
