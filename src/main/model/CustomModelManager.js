// src/main/core/model/CustomModelManager.js
import { ConfigManager } from '../utils/ConfigManager.js';
import { ModelConfig } from './ModelConfig.js';
import { ApiKeyManager } from './ApiKeyManager.js';
import { CustomModelHandler } from './CustomModelHandler.js';

const STORAGE_KEY = 'customModelDefs';
const ID_PREFIX = 'custom_';

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a4 4 0 0 1 8 0v2"></path><line x1="8" y1="13" x2="8" y2="13.01"></line><line x1="16" y1="13" x2="16" y2="13.01"></line><line x1="12" y1="16" x2="12" y2="17"></line></svg>`;
const DEFAULT_SEND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M2 21l21-9L2 3v7l15 2-15 2z"></path></svg>`;

export const PAYLOAD_PRESETS = {
    openai_compatible: {
        label: 'OpenAI-compatible (OpenRouter, Groq, LM Studio, etc.)',
        template: JSON.stringify({
            url: 'https://api.example.com/v1/chat/completions',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer {{API_KEY}}' },
            body: { model: '{{MODEL_ID}}', messages: '{{MESSAGES}}', temperature: 0.7, stream: true }
        }, null, 2)
    },
    ollama_local: {
        label: 'Ollama (Local server)',
        template: JSON.stringify({
            url: 'http://localhost:11434/api/chat',
            headers: { 'Content-Type': 'application/json' },
            body: { model: '{{MODEL_ID}}', messages: '{{MESSAGES}}', stream: true }
        }, null, 2)
    }
};

const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class CustomModelManager {

    static genId() {
        return ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    static isCustomType(modelType) {
        return typeof modelType === 'string' && modelType.startsWith(ID_PREFIX);
    }

    // ---------- Storage ----------

    static getAll() {
        const raw = ConfigManager.get(STORAGE_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn('[CustomModelManager] Corrupt custom model list, ignoring:', e);
            return [];
        }
    }

    static get(id) {
        return this.getAll().find(d => d.id === id) || null;
    }

    static _saveAll(list) {
        ConfigManager.set(STORAGE_KEY, JSON.stringify(list));
    }

    static save(def) {
        const list = this.getAll();
        const now = Date.now();

        if (def.id) {
            const idx = list.findIndex(d => d.id === def.id);
            const merged = { ...(idx >= 0 ? list[idx] : {}), ...def, updatedAt: now };
            if (idx >= 0) list[idx] = merged; else list.push(merged);
            this._saveAll(list);
            this.registerInModelConfig(merged);
            return merged;
        }

        const created = { ...def, id: this.genId(), createdAt: now, updatedAt: now };
        list.push(created);
        this._saveAll(list);
        this.registerInModelConfig(created);
        return created;
    }

    static remove(id, app = null) {
        this._saveAll(this.getAll().filter(d => d.id !== id));

        const config = ModelConfig[id];
        if (config) {
            if (config.apiKeyName) {
                ApiKeyManager.savePool(id, config, [], app);
                ConfigManager.remove(`${config.apiKeyName}Pool`);
            }
            ConfigManager.remove(`${id}ApiKeyStrategy`);
            ConfigManager.remove(`${id}ApiKeyLastUsed`);
            ConfigManager.remove(config.modelKeyName);
            ConfigManager.remove(`${id}UseCustomApi_primary`);
            ConfigManager.remove(`${id}CustomPayload_primary`);
        }
        delete ModelConfig[id];
    }

    // ---------- Registration ----------

    static registerInModelConfig(def) {
        const type = def.id;
        const apiKeyName = `${type}ApiKey`;
        const modelKeyName = `${type}Model`;
        const cap = def.capabilities || {};

        ConfigManager.set(`${type}UseCustomApi_primary`, 'true');
        if (ConfigManager.get(`${type}CustomPayload_primary`) === null) {
            ConfigManager.set(`${type}CustomPayload_primary`, def.payloadTemplate || PAYLOAD_PRESETS.openai_compatible.template);
        }

        const description = def.docsHtml
            ? def.docsHtml
            : (def.description ? `<p>${escapeHtml(def.description)}</p>` : '<p>Custom user-defined model.</p>');

        const accent = def.accentColor || '#4b5dd1';
        ModelConfig[type] = {
            handler: CustomModelHandler,
            apiKeyName,
            modelKeyName,
            isCustomModel: true,
            baseProvider: def.baseProvider || null,
            supportsImages: !!cap.supportsImages,
            supportsFiles: !!cap.supportsFiles,
            supportsWeb: !!cap.supportsWeb,
            supportsThink: !!cap.supportsThink,
            supportsStudyMode: cap.supportsStudyMode !== false,
            supportsTools: cap.supportsTools !== false,
            supportsProject: cap.supportsProject !== false,
            supportsImageGeneration: !!cap.supportsImageGeneration,
            // Level selector on input bar (Gemini HIGH/MEDIUM/LOW, OpenAI low/medium/high, …)
            // Fallback: re-copy from base provider if user created clone before think_how was stored
            think_how: (Array.isArray(def.think_how) && def.think_how.length
                ? def.think_how
                : (def.baseProvider && Array.isArray(ModelConfig[def.baseProvider]?.think_how)
                    ? [...ModelConfig[def.baseProvider].think_how]
                    : undefined)),
            bypassAppQuota: true,
            styles: {
                sendBtn: {
                    backgroundColor: accent,
                    borderRadius: '50%',
                    icon: def.sendIcon || DEFAULT_SEND_ICON_SVG
                },
                setupModal: {
                    accentColor: accent,
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderRadius: '6px',
                    btnBorderRadius: '4px'
                }
            },
            consoleUrl: def.consoleUrl || '',
            consoleText: def.consoleText || 'Console',
            name: def.name || 'Custom Model',
            image: (def.image && String(def.image).trim()) || DEFAULT_ICON_SVG,
            image_bg: def.imageBg || accent,
            info: description,
            capability: def.capability || description,
            level: def.level || 'standard',
            setting_ui: {
                tabs: ['manager', 'api_fetch', 'manual', 'custom_api', 'docs'],
                inputs: [
                    {
                        id: 'primary',
                        label: 'Model ID',
                        storageKey: modelKeyName,
                        placeholder: 'e.g. gpt-4o-mini / llama3.1',
                        payload: def.payloadTemplate || PAYLOAD_PRESETS.openai_compatible.template
                    }
                ],
                advancedSettings: Array.isArray(def.advancedSettings) ? def.advancedSettings : []
            }
        };

        if (def.modelId) ConfigManager.set(modelKeyName, def.modelId);
        // Always refresh payload when user re-registers with a new template from clone
        if (def.payloadTemplate) {
            ConfigManager.set(`${type}CustomPayload_primary`, def.payloadTemplate);
            ConfigManager.set(`${type}UseCustomApi_primary`, 'true');
        }
    }

    static registerAll() {
        this.getAll().forEach(def => this.registerInModelConfig(def));
    }

    static async refreshSidebar(app) {
        const allCustoms = this.getAll().map(def => ({
            model: def.id,
            name: def.name,
            type: def.id,
            image: def.image || DEFAULT_ICON_SVG,
            image_bg: def.imageBg || '#4b5dd1',
            level: def.level || 'standard'
        }));

        app.allModels = (app.allModels || []).filter(m => !this.isCustomType(m.type));
        app.allModels.push(...allCustoms);

        app.recentModels = (app.recentModels || []).filter(m => !this.isCustomType(m.type) || allCustoms.find(c => c.model === m.model));

        if (app.storageManager && typeof app.storageManager.modelsCheck === 'function') {
            await app.storageManager.modelsCheck();
        }
        if (app.modelManager && typeof app.modelManager.renderModels === 'function') {
            app.modelManager.renderModels();
        }
    }

    /** Built-in providers available to clone (excludes custom_* already registered). */
    static listCloneSources() {
        const out = [];
        for (const [key, cfg] of Object.entries(ModelConfig || {})) {
            try {
            if (!cfg || cfg.isCustomModel || this.isCustomType(key)) continue;
            if (!cfg.name) continue;
            const primary = cfg.setting_ui?.inputs?.find(i => i.id === 'primary' && i.payload);
            let docsFromHandler = null;
            try {
                if (typeof cfg.handler?.getDocsHTML === 'function') {
                    docsFromHandler = cfg.handler.getDocsHTML();
                }
            } catch (docErr) {
                console.warn('[CustomModelManager] getDocsHTML failed for', key, docErr);
            }
            out.push({
                key,
                name: cfg.name,
                image: cfg.image || DEFAULT_ICON_SVG,
                imageBg: cfg.image_bg || '#4b5dd1',
                accent: cfg.styles?.setupModal?.accentColor || cfg.styles?.sendBtn?.backgroundColor || '#4b5dd1',
                level: cfg.level || 'standard',
                hasPayload: !!primary?.payload,
                payload: primary?.payload || PAYLOAD_PRESETS.openai_compatible.template,
                placeholder: primary?.placeholder || 'model-id',
                capabilities: {
                    supportsImages: !!cfg.supportsImages,
                    supportsFiles: !!cfg.supportsFiles,
                    supportsWeb: !!cfg.supportsWeb,
                    supportsThink: !!cfg.supportsThink,
                    supportsStudyMode: cfg.supportsStudyMode !== false,
                    supportsTools: cfg.supportsTools !== false,
                    supportsProject: cfg.supportsProject !== false,
                    supportsImageGeneration: !!cfg.supportsImageGeneration
                },
                think_how: Array.isArray(cfg.think_how) ? [...cfg.think_how] : null,
                consoleUrl: cfg.consoleUrl || '',
                consoleText: cfg.consoleText || 'Console',
                info: cfg.info || '',
                capability: cfg.capability || '',
                sendIcon: cfg.styles?.sendBtn?.icon || null,
                advancedSettings: Array.isArray(cfg.setting_ui?.advancedSettings)
                    ? cfg.setting_ui.advancedSettings
                    : [],
                docsFromHandler
            });
            } catch (e) {
                console.warn('[CustomModelManager] skip clone source', key, e);
            }
        }
        // Generic OpenAI-compatible last
        out.push({
            key: '_openai_compatible',
            name: 'OpenAI-compatible',
            image: DEFAULT_ICON_SVG,
            imageBg: '#4b5dd1',
            accent: '#4b5dd1',
            level: 'standard',
            hasPayload: true,
            payload: PAYLOAD_PRESETS.openai_compatible.template,
            placeholder: 'gpt-4o-mini',
            capabilities: {
                supportsImages: false,
                supportsFiles: true,
                supportsWeb: false,
                supportsThink: false,
                supportsStudyMode: true,
                supportsTools: true,
                supportsProject: true,
                supportsImageGeneration: false
            },
            consoleUrl: '',
            consoleText: 'Console',
            info: '<p>Any OpenAI-compatible API (OpenRouter, Groq, Together, LM Studio…).</p>',
            capability: 'OpenAI-compatible',
            sendIcon: null,
            advancedSettings: [],
            docsFromHandler: null
        });
        out.push({
            key: '_ollama_local',
            name: 'Ollama (local)',
            image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/light/ollama.png',
            imageBg: '#1a1a1a',
            accent: '#888',
            level: 'standard',
            hasPayload: true,
            payload: PAYLOAD_PRESETS.ollama_local.template,
            placeholder: 'llama3.1',
            capabilities: {
                supportsImages: false,
                supportsFiles: true,
                supportsWeb: false,
                supportsThink: false,
                supportsStudyMode: true,
                supportsTools: true,
                supportsProject: true,
                supportsImageGeneration: false
            },
            consoleUrl: 'http://localhost:11434',
            consoleText: 'Ollama',
            info: '<p>Local Ollama server (<code>/api/chat</code>).</p>',
            capability: 'Ollama local',
            sendIcon: null,
            advancedSettings: [],
            docsFromHandler: null
        });
        return out;
    }

    static _thumbHtml(src, bg) {
        const isUrl = typeof src === 'string' && /^https?:\/\//i.test(src);
        const isSvg = typeof src === 'string' && (src.includes('<svg') || src.trim().startsWith('<svg'));
        if (isUrl) {
            return `<span class="gpt-cm-thumb" style="background:${bg || '#333'}"><img src="${escapeHtml(src)}" alt="" /></span>`;
        }
        if (isSvg) {
            return `<span class="gpt-cm-thumb" style="background:${bg || '#333'}">${src}</span>`;
        }
        return `<span class="gpt-cm-thumb" style="background:${bg || '#333'}">${DEFAULT_ICON_SVG}</span>`;
    }

    // ---------- UI: Create Custom Model (clone from available AIs) ----------

    static showCreateModal(app) {
        try {
        console.log('[CustomModelManager] showCreateModal start');
        const existing = document.getElementById('gpt-cm-create-overlay');
        if (existing) existing.remove();

        let sources = [];
        try {
            sources = this.listCloneSources();
        } catch (e) {
            console.error('[CustomModelManager] listCloneSources failed', e);
            sources = [];
        }
        if (!sources.length) {
            // Absolute fallback so UI never opens empty/dead
            sources = [{
                key: '_openai_compatible',
                name: 'OpenAI-compatible',
                image: DEFAULT_ICON_SVG,
                imageBg: '#4b5dd1',
                accent: '#4b5dd1',
                level: 'standard',
                hasPayload: true,
                payload: PAYLOAD_PRESETS.openai_compatible.template,
                placeholder: 'gpt-4o-mini',
                capabilities: {
                    supportsImages: false,
                    supportsFiles: true,
                    supportsWeb: false,
                    supportsThink: false,
                    supportsStudyMode: true,
                    supportsTools: true,
                    supportsProject: true,
                    supportsImageGeneration: false
                },
                think_how: null,
                consoleUrl: '',
                consoleText: 'Console',
                info: '<p>Any OpenAI-compatible API.</p>',
                capability: 'OpenAI-compatible',
                sendIcon: null,
                advancedSettings: [],
                docsFromHandler: null
            }];
        }
        console.log('[CustomModelManager] clone sources:', sources.length);

        const overlay = document.createElement('div');
        overlay.id = 'gpt-cm-create-overlay';
        overlay.className = 'gpt-cm-create-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,0.55);opacity:1;';

        const renderStep1 = () => {
            const cards = sources.map(s => `
                <button type="button" class="gpt-cm-ai-card" data-key="${escapeHtml(s.key)}">
                    ${this._thumbHtml(s.image, s.imageBg)}
                    <span class="gpt-cm-ai-meta">
                        <span class="gpt-cm-ai-name">${escapeHtml(s.name)}</span>
                        <span class="gpt-cm-ai-sub">${escapeHtml(s.key.startsWith('_') ? 'Generic preset' : 'Clone setup')}</span>
                    </span>
                </button>
            `).join('');

            overlay.innerHTML = `
              <div class="gpt-cm-create-dialog" role="dialog" aria-label="Create custom model">
                <div class="gpt-cm-create-header">
                  <div class="gpt-cm-create-title">Create Custom Model</div>
                  <div class="gpt-cm-create-sub">Pick an AI to clone — payload, icon &amp; capabilities copy over. You can edit docs next.</div>
                </div>
                <div class="gpt-cm-ai-grid">${cards}</div>
                <div class="gpt-cm-create-footer">
                  <button type="button" class="gpt-ui-btn" id="cm-cancel">Cancel</button>
                </div>
              </div>`;

            const cancel = overlay.querySelector('#cm-cancel');
            if (cancel) cancel.onclick = (ev) => { ev.stopPropagation(); overlay.remove(); };
            overlay.querySelectorAll('.gpt-cm-ai-card').forEach(btn => {
                btn.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const src = sources.find(s => s.key === btn.getAttribute('data-key'));
                    if (src) renderStep2(src);
                };
            });
        };

        const renderStep2 = (src) => {
            const defaultName = src.key.startsWith('_')
                ? (src.key === '_ollama_local' ? 'My Ollama' : 'My OpenAI-compatible')
                : `My ${src.name}`;
            let defaultDocs = src.docsFromHandler || '';
            if (!defaultDocs) {
                defaultDocs = `<div style="padding:12px;font-size:12px;line-height:1.55;color:var(--primary-text-color);">
  <b style="font-size:13px;color:${src.accent}">${escapeHtml(src.name)}</b>
  <div style="margin-top:8px;opacity:.9;">${src.info || ''}</div>
  <div style="margin-top:8px;opacity:.75;">${src.capability || ''}</div>
  <p style="margin-top:12px;color:var(--secondary-text-color);">Edit this Docs tab anytime from model settings → Manager / Docs.</p>
</div>`;
            }

            overlay.innerHTML = `
              <div class="gpt-cm-create-dialog gpt-cm-create-dialog-wide" role="dialog">
                <div class="gpt-cm-create-header">
                  <button type="button" class="gpt-cm-back" id="cm-back" title="Back">←</button>
                  <div style="flex:1;min-width:0;">
                    <div class="gpt-cm-create-title">Customize</div>
                    <div class="gpt-cm-create-sub">Based on <b>${escapeHtml(src.name)}</b> — full clone of API payload &amp; flags</div>
                  </div>
                  ${this._thumbHtml(src.image, src.imageBg)}
                </div>
                <div class="gpt-cm-create-body">
                  <div class="gpt-field">
                    <label class="gpt-field-label" for="cm-name">Display name</label>
                    <input class="gpt-input" id="cm-name" type="text" value="${escapeHtml(defaultName)}" placeholder="My model" />
                  </div>
                  <div class="gpt-field">
                    <label class="gpt-field-label" for="cm-model-id">Default model ID (optional)</label>
                    <input class="gpt-input" id="cm-model-id" type="text" placeholder="${escapeHtml(src.placeholder)}" />
                    <div class="gpt-field-hint">Saved as this custom model’s primary model id. You can change it later in Manual tab.</div>
                  </div>
                  <div class="gpt-field">
                    <label class="gpt-field-label" for="cm-docs">Docs (HTML allowed)</label>
                    <textarea class="gpt-textarea" id="cm-docs" rows="7" style="max-height:200px;font-size:12px;">${escapeHtml(defaultDocs)}</textarea>
                    <div class="gpt-field-hint">Shown in Settings → Docs. Describe limits, endpoints, tips for yourself.</div>
                  </div>
                  <div class="gpt-cm-caps">
                    ${src.capabilities.supportsTools ? '<span class="gpt-cm-cap">Agent</span>' : ''}
                    ${src.capabilities.supportsStudyMode ? '<span class="gpt-cm-cap">Study</span>' : ''}
                    ${src.capabilities.supportsImages ? '<span class="gpt-cm-cap">Vision</span>' : ''}
                    ${src.capabilities.supportsWeb ? '<span class="gpt-cm-cap">Web</span>' : ''}
                    ${src.capabilities.supportsImageGeneration ? '<span class="gpt-cm-cap">Image gen</span>' : ''}
                  </div>
                </div>
                <div class="gpt-cm-create-footer">
                  <button type="button" class="gpt-ui-btn" id="cm-cancel2">Cancel</button>
                  <button type="button" class="gpt-ui-btn gpt-ui-btn-primary" id="cm-save">Create model</button>
                </div>
              </div>`;

            const back = overlay.querySelector('#cm-back');
            const cancel2 = overlay.querySelector('#cm-cancel2');
            const saveBtn = overlay.querySelector('#cm-save');
            if (back) back.onclick = (ev) => { ev.stopPropagation(); renderStep1(); };
            if (cancel2) cancel2.onclick = (ev) => { ev.stopPropagation(); overlay.remove(); };
            if (saveBtn) saveBtn.onclick = async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try {
                    const name = overlay.querySelector('#cm-name').value.trim() || defaultName;
                    const modelId = overlay.querySelector('#cm-model-id').value.trim();
                    const docsHtml = overlay.querySelector('#cm-docs').value;

                    const def = {
                        name,
                        baseProvider: src.key.startsWith('_') ? null : src.key,
                        payloadTemplate: src.payload || PAYLOAD_PRESETS.openai_compatible.template,
                        modelId: modelId || undefined,
                        image: typeof src.image === 'string' ? src.image : DEFAULT_ICON_SVG,
                        imageBg: src.imageBg,
                        accentColor: src.accent,
                        level: src.level,
                        capabilities: { ...(src.capabilities || {}) },
                        think_how: Array.isArray(src.think_how) && src.think_how.length
                            ? [...src.think_how]
                            : undefined,
                        consoleUrl: src.consoleUrl,
                        consoleText: src.consoleText,
                        description: `${src.name} clone`,
                        docsHtml,
                        capability: src.capability,
                        sendIcon: src.sendIcon || undefined,
                        advancedSettings: src.advancedSettings || []
                    };

                    this.save(def);
                    await this.refreshSidebar(app);
                    if (typeof window.toast === 'function') window.toast(`Custom model “${name}” created`, 2500);
                    overlay.remove();
                } catch (err) {
                    console.error('[CustomModelManager] create failed', err);
                    if (typeof window.toast === 'function') window.toast(`Create failed: ${err.message || err}`, 3500);
                }
            };
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
        overlay.classList.add('is-open');
        renderStep1();
        console.log('[CustomModelManager] overlay mounted');
        } catch (err) {
            console.error('[CustomModelManager] showCreateModal fatal', err);
            if (typeof window.toast === 'function') {
                window.toast(`Custom model UI error: ${err.message || err}`, 4000);
            }
        }
    }
}