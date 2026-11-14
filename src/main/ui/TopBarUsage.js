// Top-bar circular usage indicator + API key picker popup.
// Visible ONLY when selected model type supports live provider usage.

import { ApiKeyManager } from '../model/ApiKeyManager.js';
import { ModelConfig } from '../model/ModelConfig.js';
import {
  supportsProviderUsage,
  fetchProviderUsage,
  fetchPoolUsage,
  formatUsd,
  formatRemainingLine,
  scoreKeyUsage
} from '../core/usage/ProviderUsage.js';
import * as ProviderUsageMod from '../core/usage/ProviderUsage.js';

if (typeof globalThis !== 'undefined') {
  globalThis.__ProviderUsage = ProviderUsageMod;
}

const R = 14;
const CIRC = 2 * Math.PI * R;

export const TopBarUsage = {
  _timer: null,
  app: null,

  init(app) {
    this.app = app;
    const wrap = document.getElementById('gpt-usage-circle-wrap');
    if (!wrap || wrap._wired) {
      this.refresh();
      return;
    }
    wrap._wired = true;

    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePopup();
    });
    document.addEventListener('click', () => this.hidePopup());

    window.addEventListener('gpt-usage-updated', () => this.refresh());
    window.addEventListener('gpt-model-changed', () => {
      this.hidePopup();
      this.refresh({ forceHideCheck: true });
    });

    this.refresh();
    this._timer = setInterval(() => this.refresh({ quiet: true }), 90_000);
  },

  _modelType() {
    return (this.app?.selectedModel?.type || '').toLowerCase();
  },

  _config() {
    const t = this._modelType();
    try {
      return (ModelConfig && ModelConfig[t]) || this.app?.selectedModel || null;
    } catch (_) {
      return this.app?.selectedModel || null;
    }
  },

  hideCircle() {
    const wrap = document.getElementById('gpt-usage-circle-wrap');
    if (wrap) wrap.style.display = 'none';
    this.hidePopup();
  },

  async refresh({ quiet = false, forceHideCheck = false } = {}) {
    const wrap = document.getElementById('gpt-usage-circle-wrap');
    const arc = document.getElementById('gpt-usage-circle-arc');
    const label = document.getElementById('gpt-usage-circle-label');
    if (!wrap || !arc || !label) return;

    const modelType = this._modelType();

    // Unsupported providers (gemini, mistral, …) → always hide
    if (!supportsProviderUsage(modelType)) {
      this.hideCircle();
      return;
    }

    const config = this._config();
    if (!config?.apiKeyName) {
      this.hideCircle();
      return;
    }

    const pool = ApiKeyManager.getPool(modelType, config);
    const strategy = ApiKeyManager.getStrategy(modelType);
    const activeId = this.app?._activeApiKeyId
      || (strategy && strategy !== ApiKeyManager.RANDOM_STRATEGY ? strategy : null);
    const active = pool.find(k => k.id === activeId)
      || ApiKeyManager.pickKey(modelType, config)
      || pool[0];

    if (!active?.key) {
      this.hideCircle();
      return;
    }

    wrap.style.display = 'flex';

    // Local token fallback while / if provider fetch fails
    const tokenSnap = (() => {
      try {
        return this.app?.usageManager?.getSnapshot?.(modelType, 1);
      } catch (_) { return null; }
    })();

    const r = await fetchProviderUsage(modelType, active.key, { force: !quiet });
    const d = r.data;

    if (!d) {
      // Fall back to local token usage ring if we have requests
      const src = tokenSnap?.model;
      if (src?.requests > 0) {
        label.textContent = 'tok';
        arc.setAttribute('stroke-dasharray', `${CIRC * 0.35} ${CIRC}`);
        wrap.title = `${active.name}: local tokens · ${(src.tokensIn + src.tokensOut).toLocaleString()} total`;
      } else {
        label.textContent = '—';
        arc.setAttribute('stroke-dasharray', `0 ${CIRC}`);
        wrap.title = r.error || `${active.name}: usage unavailable`;
      }
      return;
    }

    // Real remaining % only — never invent 50%
    let pctLeft = null;
    if (d.pctRemain != null) pctLeft = d.pctRemain;
    else if (d.limit > 0 && d.remaining != null) pctLeft = (d.remaining / d.limit) * 100;
    else if (d.remaining === 0) pctLeft = 0;

    if (pctLeft != null) {
      const dash = Math.max(0, Math.min(CIRC, (pctLeft / 100) * CIRC));
      arc.setAttribute('stroke-dasharray', `${dash} ${CIRC}`);
      label.textContent = `${Math.round(pctLeft)}`;
    } else {
      // Credits used but no limit → show usage hint, not fake %
      label.textContent = '∞';
      arc.setAttribute('stroke-dasharray', `${CIRC * 0.15} ${CIRC}`);
    }

    wrap.title = `${active.name}: ${formatRemainingLine(d)}`
      + (d.limit != null && formatUsd(d.limit) ? ` / ${formatUsd(d.limit)}` : '');
  },

  hidePopup() {
    const pop = document.getElementById('gpt-usage-key-popup');
    if (pop) pop.style.display = 'none';
  },

  async togglePopup() {
    const pop = document.getElementById('gpt-usage-key-popup');
    if (!pop) return;
    if (pop.style.display === 'block') {
      pop.style.display = 'none';
      return;
    }

    const modelType = this._modelType();
    const config = this._config();
    if (!supportsProviderUsage(modelType) || !config) {
      this.hideCircle();
      return;
    }

    const pool = ApiKeyManager.getPool(modelType, config);
    const strategy = ApiKeyManager.getStrategy(modelType);
    const activeId = this.app?._activeApiKeyId
      || (strategy && strategy !== ApiKeyManager.RANDOM_STRATEGY ? strategy : null);
    pop.innerHTML = `<div style="font-size:11px;opacity:0.7;padding:6px;">Loading keys…</div>`;
    pop.style.display = 'block';

    const rows = await fetchPoolUsage(modelType, pool);
    const isRandom = strategy === ApiKeyManager.RANDOM_STRATEGY;

    let html = `
      <div style="font-size:10px;opacity:0.55;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px;color:var(--primary-text-color);">
        API Keys · ${modelType}${isRandom ? ' · random' : ''}
      </div>`;

    if (isRandom) {
      html += `<div style="font-size:10px;opacity:0.65;margin-bottom:8px;color:var(--primary-text-color);">
        Random rotates keys. Prefers higher remaining credit when known.
      </div>`;
    }

    for (const r of rows) {
      const sel = r.id === activeId || (!activeId && r.id === pool[0]?.id);
      const line = r.data ? formatRemainingLine(r.data) : (r.error ? String(r.error).slice(0, 40) : 'no data');
      const pct = r.data?.pctRemain != null ? Math.round(r.data.pctRemain)
        : (r.data?.remaining === 0 ? 0 : null);
      html += `
        <div class="gpt-usage-key-row" data-key-id="${esc(r.id)}"
          style="display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:8px;cursor:pointer;
            background:${sel ? 'var(--button-background-color, #4b5dd1)22' : 'transparent'};
            border:1px solid ${sel ? 'var(--button-background-color, #4b5dd1)' : 'transparent'};margin-bottom:4px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:${sel ? 600 : 400};color:var(--primary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${esc(r.name)}${sel ? ' ✓' : ''}
            </div>
            <div style="font-size:10px;opacity:0.6;color:var(--primary-text-color);">${esc(line)}</div>
          </div>
          ${pct != null ? `<span style="font-size:10px;opacity:0.7;">${pct}%</span>` : ''}
        </div>`;
    }

    html += `<div style="font-size:10px;opacity:0.55;margin-top:6px;color:var(--primary-text-color);">Tap a key to pin it.</div>`;
    pop.innerHTML = html;

    pop.querySelectorAll('.gpt-usage-key-row').forEach(row => {
      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = row.getAttribute('data-key-id');
        if (!id || !config) return;
        ApiKeyManager.setStrategy(modelType, id);
        const keyObj = pool.find(k => k.id === id);
        if (keyObj && config.apiKeyName) {
          try {
            const { ConfigManager } = await import('../utils/ConfigManager.js');
            ConfigManager.set(config.apiKeyName, keyObj.key);
            if (this.app) {
              this.app[config.apiKeyName] = keyObj.key;
              this.app._activeApiKeyId = keyObj.id;
              this.app._activeApiKeyName = keyObj.name;
            }
          } catch (_) {}
        }
        this.hidePopup();
        this.refresh({ quiet: false });
        if (window.toast) window.toast(`API key: ${keyObj?.name || id}`);
      });
    });
  }
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
