// src/main/ui/WebSearchCard.js
/**
 * Compact web-search card — title + link only.
 * Shared by live SearchEvaluator and ChatRenderer (history re-render).
 */

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ query?: string, engine?: string, status?: string, items?: {title?:string,url?:string}[] }} data
 * @returns {HTMLElement}
 */
export function buildWebSearchCard(data = {}) {
  const query = data.query || '';
  const engine = data.engine || '';
  const status = data.status || 'done';
  const items = Array.isArray(data.items) ? data.items : [];

  const card = document.createElement('div');
  card.className = 'gpt-web-search-card';
  card.setAttribute('data-gpt-web-card', '1');
  card.setAttribute('data-status', status);

  const links = items
    .filter((it) => it && (it.title || it.url))
    .slice(0, 8)
    .map((it) => {
      const title = esc(it.title || it.url || 'Link');
      const url = esc(it.url || '');
      return `<div class="gpt-web-search-item"${url ? ` data-url="${url}"` : ''}>
        <div class="t">${title}</div>
        ${url ? `<div class="u">${url}</div>` : ''}
      </div>`;
    })
    .join('');

  card.innerHTML = `
    <div class="gpt-web-search-head">
      <span class="dot"></span>
      <b>Web search</b>
      ${engine ? `<span class="eng">${esc(engine)}</span>` : ''}
      <span class="q" title="${esc(query)}">${esc(query)}</span>
      <span class="st">${esc(status === 'done' ? '' : status)}</span>
    </div>
    <div class="gpt-web-search-body">${links || (status === 'running' ? '<div class="empty">Searching…</div>' : '<div class="empty">No links</div>')}</div>
  `;

  card.querySelectorAll('.gpt-web-search-item[data-url]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const u = el.getAttribute('data-url');
      if (u) {
        try {
          window.open(u, '_blank');
        } catch (_) {}
      }
    });
  });

  return card;
}

/** Compact data for JSON history (title + url only) */
export function compactWebSearch(data) {
  if (!data) return null;
  return {
    query: String(data.query || ''),
    engine: String(data.engine || ''),
    items: (data.items || [])
      .filter((it) => it && (it.title || it.url))
      .slice(0, 10)
      .map((it) => ({
        title: String(it.title || it.url || '').slice(0, 200),
        url: String(it.url || '').slice(0, 500)
      }))
  };
}

/** Mount card at top of assistant bubble (sibling of content — never inside stream holder) */
export function mountWebSearchCard(botMessageElement, data, messageContainer) {
  if (!botMessageElement || !data) return null;
  botMessageElement.querySelectorAll('.gpt-web-search-card').forEach((el) => el.remove());
  const card = buildWebSearchCard(data);
  if (messageContainer && messageContainer.parentElement === botMessageElement) {
    botMessageElement.insertBefore(card, messageContainer);
  } else {
    botMessageElement.insertBefore(card, botMessageElement.firstChild);
  }
  return card;
}
