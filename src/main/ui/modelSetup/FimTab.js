// src/main/ui/modelSetup/FimTab.js 
import { supportsFim, getFimProfile, FIM_GLOBAL_DEFAULTS } from '../../fim/FimConfig.js';
import { loadFimSettings, saveFimSettings } from '../../fim/FimSettings.js'; 
import { FimController } from '../../fim/FimController.js';

export const FimTab = {
  id: 'fim',

  buildHTML(ctx) {
    const { modelType, isFirstTab, styles } = ctx;
    const isFirst = isFirstTab('fim');
    const profile = getFimProfile(modelType);
    const s = loadFimSettings(modelType);
    const enabled = !!s.enabled && profile.supported;

    if (!profile.supported) {
      return `
        <div class="setting-tab-content" id="tab-fim" style="display:${isFirst ? 'block' : 'none'}; max-height:60vh;overflow-y:scroll;">
          <div style="padding:12px;font-size:12px;line-height:1.5;color:var(--secondary-text-color);">
            <b style="color:${styles.accentColor}">FIM not available</b>
            <p style="margin:8px 0;">This provider has no Fill-In-the-Middle profile. Use a code model (DeepSeek Coder, Codestral, OpenAI instruct, Ollama code, OpenRouter code models…).</p>
            <p style="opacity:0.8;">Profile: ${profile.label || profile.mode}</p>
          </div>
        </div>`;
    }

    const row = (id, label, control) => `
      <div class="input-group" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;">
        <label style="margin:0;flex:1;font-size:12px;">${label}</label>
        <div style="flex-shrink:0;">${control}</div>
      </div>`;

    return `
      <div class="setting-tab-content" id="tab-fim" style="display:${isFirst ? 'block' : 'none'};max-height:60vh;overflow-y:scroll;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span class="gpt-fim-status-dot" style="width:8px;height:8px;border-radius:50%;background:${enabled ? '#22c55e' : '#666'};box-shadow:${enabled ? '0 0 6px #22c55e' : 'none'};"></span>
          <span style="font-size:12px;font-weight:600;">FIM ${enabled ? 'enabled' : 'disabled'}</span>
          <span class="secondary-text" style="font-size:10px;margin-left:auto;">${profile.label || profile.mode}</span>
        </div>

        ${row(
          'enabled',
          'Enable FIM for this model',
          `<input type="checkbox" class="fim-check" data-id="enabled" ${s.enabled ? 'checked' : ''} style="accent-color:${styles.accentColor};width:16px;height:16px;" />`
        )}
        ${row(
          'autoTrigger',
          'Auto-trigger while typing',
          `<input type="checkbox" class="fim-check" data-id="autoTrigger" ${s.autoTrigger ? 'checked' : ''} style="accent-color:${styles.accentColor};width:16px;height:16px;" />`
        )}
        ${row(
          'alwaysOn',
          'Always-on (with auto debounce)',
          `<input type="checkbox" class="fim-check" data-id="alwaysOn" ${s.alwaysOn ? 'checked' : ''} style="accent-color:${styles.accentColor};width:16px;height:16px;" />`
        )}
        ${row(
          'showGhost',
          'Show ghost preview',
          `<input type="checkbox" class="fim-check" data-id="showGhost" ${s.showGhost !== false ? 'checked' : ''} style="accent-color:${styles.accentColor};width:16px;height:16px;" />`
        )}
        ${row(
          'multiline',
          'Allow multi-line completion',
          `<input type="checkbox" class="fim-check" data-id="multiline" ${s.multiline !== false ? 'checked' : ''} style="accent-color:${styles.accentColor};width:16px;height:16px;" />`
        )}
        ${row(
          'useCustomApi',
          'Use custom API / template',
          `<input type="checkbox" class="fim-check" data-id="useCustomApi" ${s.useCustomApi ? 'checked' : ''} style="accent-color:${styles.accentColor};width:16px;height:16px;" />`
        )}

        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;">Debounce (ms): <b id="fim-val-debounceMs" style="color:${styles.accentColor}">${s.debounceMs}</b></label>
          <input type="range" class="fim-range" data-id="debounceMs" min="100" max="2000" step="50" value="${s.debounceMs}" style="width:100%;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;">Max tokens: <b id="fim-val-maxTokens" style="color:${styles.accentColor}">${s.maxTokens}</b></label>
          <input type="range" class="fim-range" data-id="maxTokens" min="16" max="1024" step="16" value="${s.maxTokens}" style="width:100%;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;">Temperature: <b id="fim-val-temperature" style="color:${styles.accentColor}">${s.temperature}</b></label>
          <input type="range" class="fim-range" data-id="temperature" min="0" max="1.5" step="0.05" value="${s.temperature}" style="width:100%;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;">Top P: <b id="fim-val-topP" style="color:${styles.accentColor}">${s.topP}</b></label>
          <input type="range" class="fim-range" data-id="topP" min="0" max="1" step="0.05" value="${s.topP}" style="width:100%;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;">Prefix context chars: <b id="fim-val-prefixChars" style="color:${styles.accentColor}">${s.prefixChars}</b></label>
          <input type="range" class="fim-range" data-id="prefixChars" min="256" max="8192" step="256" value="${s.prefixChars}" style="width:100%;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;">Suffix context chars: <b id="fim-val-suffixChars" style="color:${styles.accentColor}">${s.suffixChars}</b></label>
          <input type="range" class="fim-range" data-id="suffixChars" min="64" max="4096" step="64" value="${s.suffixChars}" style="width:100%;" />
        </div>

        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;display:block;margin-bottom:4px;">Wake key(s)</label>
          <input type="text" class="fim-text" data-id="wakeKeys" value="${String(s.wakeKeys || '').replace(/"/g, '&quot;')}" placeholder="Ctrl-Space,Alt-/" style="width:100%;box-sizing:border-box;padding:8px;font-size:12px;border-radius:4px;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;display:block;margin-bottom:4px;">FIM-only model id (optional)</label>
          <input type="text" class="fim-text" data-id="fimModelId" value="${String(s.fimModelId || '').replace(/"/g, '&quot;')}" placeholder="e.g. deepseek-coder" style="width:100%;box-sizing:border-box;padding:8px;font-size:12px;border-radius:4px;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label style="font-size:12px;display:block;margin-bottom:4px;">Stop sequences (comma, use \\n for newline)</label>
          <input type="text" class="fim-text" data-id="stopSequences" value="${String(s.stopSequences || '').replace(/"/g, '&quot;')}" style="width:100%;box-sizing:border-box;padding:8px;font-size:12px;border-radius:4px;" />
        </div>
        <div class="input-group" style="margin-bottom:10px;display:flex;flex-direction:column;">
          <label style="font-size:12px;display:block;margin-bottom:4px;">Custom FIM JSON template</label>
          <textarea class="fim-area" data-id="customTemplate" rows="6" placeholder='{"url":"...","headers":{},"body":{"prompt":"{{PREFIX}}","suffix":"{{SUFFIX}}"}}' style="width:100%;box-sizing:border-box;padding:8px;font-size:11px;font-family:monospace;border-radius:4px;resize:vertical;">${String(s.customTemplate || '').replace(/</g, '&lt;')}</textarea>
          <div class="secondary-text" style="font-size:10px;margin-top:4px;">Placeholders: {{PREFIX}} {{SUFFIX}} {{API_KEY}} {{MODEL_ID}} {{MAX_TOKENS}} {{TEMPERATURE}}</div>
        </div>

        <div style="text-align:right;margin-top:8px;">
          <button class="reset-tab-btn" data-reset="fim" style="${styles.resetBtnStyle}">Reset FIM Defaults</button>
        </div>
      </div>`;
  },

  wire(modal, ctx) {
    modal.querySelectorAll('.fim-range').forEach(slider => {
      slider.oninput = () => {
        const id = slider.getAttribute('data-id');
        const label = modal.querySelector(`#fim-val-${id}`);
        if (label) label.textContent = slider.value;
      };
    });
  },

  save(modal, ctx) {
    const { modelType } = ctx;
    if (!supportsFim(modelType) && !modal.querySelector('.fim-check')) return;

    const settings = loadFimSettings(modelType);
    modal.querySelectorAll('.fim-check').forEach(cb => {
      settings[cb.getAttribute('data-id')] = cb.checked;
    });
    modal.querySelectorAll('.fim-range').forEach(slider => {
      settings[slider.getAttribute('data-id')] = Number(slider.value);
    });
    modal.querySelectorAll('.fim-text').forEach(inp => {
      settings[inp.getAttribute('data-id')] = inp.value;
    });
    modal.querySelectorAll('.fim-area').forEach(area => {
      settings[area.getAttribute('data-id')] = area.value;
    });
    const turningOn = !!settings.enabled;
    saveFimSettings(modelType, settings);

    if (turningOn) {
      window.toast?.(`FIM on for ${modelType} — other models’ FIM turned off`);
    }

    // Refresh controller + sidebar green FIM badge
    try {
      FimController._attachViewListeners?.();
    } catch (_) {}
    try {
      if (ctx.app?.modelManager?.renderModels) ctx.app.modelManager.renderModels();
      else if (ctx.app?.modelManager?.showListModel) {
        ctx.app.modelManager.showListModel(ctx.app.recentModels || ctx.app.allModels || []);
      }
    } catch (_) {}
  },

  reset(modal, ctx) {
    const { modelType } = ctx;
    const profile = getFimProfile(modelType);
    const defaults = { ...FIM_GLOBAL_DEFAULTS, ...(profile.defaults || {}) };
    saveFimSettings(modelType, defaults);
    window.toast?.('FIM settings reset');
    // Rebuild is heavy; user can reopen modal
  }
};
