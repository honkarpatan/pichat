// src/main/ui/SettingsUI.js
import { ConfigManager } from '../utils/ConfigManager.js';
import { SettingsRenderer } from '../settings/SettingsRenderer.js';
import { chatHandlerSettingsSchema } from '../settings/schemas/chatHandlerSettings.js';
import { uiSettingsSchema } from '../settings/schemas/uiSettings.js'; 
import { storagePrivacySettingsSchema } from '../settings/schemas/storagePrivacySettings.js'; 

export class SettingsUI {
    constructor(pluginContext) {
        this.app = pluginContext;

        const savedWidth = ConfigManager.get('chatContainerWidth');
        if (savedWidth) {
            let style = document.getElementById('gpt-dynamic-ui-styles');
            if (!style) {
                style = document.createElement('style');
                style.id = 'gpt-dynamic-ui-styles';
                document.head.appendChild(style);
            }
            style.innerHTML = `.chat-container { min-width: ${savedWidth}px !important; max-width: ${savedWidth}px !important; width: ${savedWidth}px !important; }`;
        }
    }

    _attachClick(id, handler, isDoubleClick = false) {
        const el = document.getElementById(id);
        if (!el) return;
        
        const eventType = isDoubleClick ? 'dblclick' : 'click';
        const dataKey = isDoubleClick ? 'dblListenerAttached' : 'listenerAttached';

        if (el.dataset[dataKey] === 'true') return;

        el.addEventListener(eventType, async (e) => {
            await handler(e, el);
        });
        
        el.dataset[dataKey] = 'true';
    }

    setupSettingsToggle() {
        this._attachClick('gpt-setting-button', async () => {
            const optionsMenuRight = document.getElementById('three-dot-options');
            const threeDOT = document.getElementById('gpt-three-dot');
            const chatBox = document.getElementById('chat-box');
            const inpContainer = document.getElementById('input-container');
            const infoPage = document.getElementById('gpt-info-page');
            const viewDetailsBack = document.getElementById('gpt-info-page-back');
            const settingPage = document.getElementById('gpt-setting-page');
            const gptModalOverlay = document.querySelector('.gpt-modal-overlay');

            if (optionsMenuRight) optionsMenuRight.style.display = 'none';
            if (threeDOT) threeDOT.style.display = 'none';
            if (chatBox) chatBox.style.display = 'none';
            if (inpContainer) inpContainer.style.display = 'none';
            if (infoPage) infoPage.style.display = 'none';

            if (viewDetailsBack) viewDetailsBack.style.display = 'block';
            if (settingPage) settingPage.style.display = 'flex';
            if (gptModalOverlay) gptModalOverlay.style.transform = 'translateX(-100%)';
            
            this.initAllSettings();
        });

        this._attachClick('gpt-info-page-back', () => {
            const settingPage = document.getElementById('gpt-setting-page');
            const viewDetailsBack = document.getElementById('gpt-info-page-back');
            const chatBox = document.getElementById('chat-box');
            const inpContainer = document.getElementById('input-container');
            const threeDOT = document.getElementById('gpt-three-dot');
            const infoPage = document.getElementById('gpt-info-page');
            const gptModalOverlay = document.querySelector('.gpt-modal-overlay');

            if (settingPage) settingPage.style.display = 'none';
            if (infoPage) infoPage.style.display = 'none';
            if (viewDetailsBack) viewDetailsBack.style.display = 'none';
            
            if (chatBox) chatBox.style.display = ''; 
            if (inpContainer) inpContainer.style.display = ''; 
            if (threeDOT) threeDOT.style.display = ''; 
            
            if (gptModalOverlay) gptModalOverlay.style.transform = 'translateX(0)';

            if (this.app.bubbleControls) this.app.bubbleControls.enableFunctionBubble();
            if (settingPage && this.app.initialSettingContent) settingPage.innerHTML = this.app.initialSettingContent;
            this.app.settingFuncNiddle = 'by_setting_icon';
        });
    }

    initAllSettings() {
        try {
            import('../settings/schemas/uiSettings.js').then(m => {
                m.applyUiWaveEffectsFromStore?.(this.app.settingsStore);
            }).catch(() => {});
        } catch (_) {}
        let settingPage = document.getElementById('gpt-setting-page');
        if (settingPage && !this.app.initialSettingContent) {
            this.app.initialSettingContent = settingPage.innerHTML;
        }

        this.enableFontSizeEdit();
        this.setupProfileAndInfo();
        this.setupSecretKey();
        this.setupActionButtons();
        this.setupReadmeUI();
        this.setupCanvasToggle();
        
        // Setup Schema UIs
        this.setupChatSettingsUI();
        this.setupUISettingsUI();
        this.setupStoragePrivacyUI();
    }
    
    enableFontSizeEdit() {
        this._attachClick("fontSizeSetting", () => {
            const fontSizeSetting = document.getElementById("fontSizeSetting");
            const chatBox = document.querySelector("#chat-box");
            if (!chatBox || document.getElementById("temp-font-input")) return;

            const input = document.createElement("input");
            input.id = "temp-font-input";
            input.type = "number";
            input.min = 10;
            input.max = 40;
            input.value = parseInt(window.getComputedStyle(chatBox).fontSize) || 14;
            input.style = "width:80px;border:1px solid #ccc;padding:2px;border-radius:4px;";

            fontSizeSetting.style.display = 'none';
            fontSizeSetting.parentNode.insertBefore(input, fontSizeSetting.nextSibling);
            input.focus();

            input.addEventListener("blur", function () {
                const newValue = input.value.trim();
                if (newValue && !isNaN(newValue)) {
                    chatBox.style.fontSize = `${newValue}px`;
                    const textSpan = fontSizeSetting.querySelector('span');
                    if(textSpan) textSpan.textContent = `Font Size: ${newValue}px`;
                }
                input.remove(); 
                fontSizeSetting.style.display = 'flex'; 
            });

            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") input.blur();
            });
        });
    }

    setupProfileAndInfo() {
        let currentGptUserName = ConfigManager.get('current-gpt-user-name') || 'User';
        let currentGptUserEmail = this.app.lang_showing;
        let settingUserName = document.getElementById('gpt-setting-user-name');
        let settingProfileIcon = document.querySelector('.gpt-setting-profile div');
        const ShowEmail = document.getElementById('gpt-sub-setting-email');
        const ShowVersion = document.getElementById('gpt-sub-setting-version');
        
        if (currentGptUserEmail && currentGptUserEmail !== 'null' && settingProfileIcon && settingUserName) {
            let firstWord = currentGptUserEmail[0].toUpperCase(); 
            settingProfileIcon.innerText = firstWord;
            settingUserName.innerText = `${currentGptUserName}`;
        }

        if (ShowEmail) ShowEmail.innerText = this.app.lang_showing || 'Not Logged In';
        if (ShowVersion) ShowVersion.innerText = `Aicode Cosmo ${this.app.__MODELsVERSIONTEMP || '1.0.0'}`;

        this._setupDeveloperUnlock(ShowVersion);
        this._renderDeveloperEntry();
    }

    /**
     * Android-style: tap version 7 times to unlock Developer options.
     */
    _setupDeveloperUnlock(versionEl) {
        if (!versionEl || versionEl.dataset.devTapBound === '1') return;
        versionEl.dataset.devTapBound = '1';
        versionEl.style.cursor = 'pointer';
        const parent = versionEl.closest('.gpt-setting-settings-item') || versionEl;
        parent.style.cursor = 'pointer';
        this._devTapCount = 0;
        this._devTapTimer = null;
        const onTap = () => {
            const store = this.app.settingsStore;
            if (store?.getBool?.('developerModeUnlocked', false) || store?.get('developerModeUnlocked') === true || store?.get('developerModeUnlocked') === 'true') {
                window.toast?.('Developer options already unlocked', 1200);
                return;
            }
            this._devTapCount = (this._devTapCount || 0) + 1;
            if (this._devTapTimer) clearTimeout(this._devTapTimer);
            this._devTapTimer = setTimeout(() => { this._devTapCount = 0; }, 2000);
            const left = 7 - this._devTapCount;
            if (this._devTapCount >= 7) {
                this._devTapCount = 0;
                try {
                    store?.set('developerModeUnlocked', true);
                } catch (_) {
                    try { localStorage.setItem('developerModeUnlocked', 'true'); } catch (__) {}
                }
                window.toast?.('You unlocked Developer options', 2500);
                this._renderDeveloperEntry();
            } else if (this._devTapCount >= 4) {
                window.toast?.(`${left} more taps to unlock Developer options`, 1000);
            }
        };
        parent.addEventListener('click', onTap);
    }

    _isDevUnlocked() {
        try {
            const store = this.app.settingsStore;
            if (store?.getBool?.('developerModeUnlocked', false)) return true;
            if (store?.get('developerModeUnlocked') === true || store?.get('developerModeUnlocked') === 'true') return true;
            if (localStorage.getItem('developerModeUnlocked') === 'true') return true;
        } catch (_) {}
        return false;
    }

    _isDevEnabled() {
        try {
            const store = this.app.settingsStore;
            if (store?.getBool?.('developerModeEnabled', false)) return true;
            if (store?.get('developerModeEnabled') === true || store?.get('developerModeEnabled') === 'true') return true;
        } catch (_) {}
        return false;
    }

    /** Show Developer Mode row at top of settings when unlocked */
    _renderDeveloperEntry() {
        const container = document.getElementById('gpt-setting-page-container');
        if (!container) return;
        let section = document.getElementById('gpt-dev-mode-section');
        if (!this._isDevUnlocked()) {
            if (section) section.remove();
            return;
        }
        if (section) return; // already present

        section = document.createElement('div');
        section.id = 'gpt-dev-mode-section';
        section.innerHTML = `
          <div class="gpt-setting-section-header">Developer</div>
          <div class="gpt-setting-settings-section">
            <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-developer">
              <div class="gpt-setting-rows"><span class="gpt-dev-ico" style="display:inline-flex;width:18px;height:18px;margin-right:0;vertical-align:middle;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.1.7.7 1.2 1.5 1.2H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></span> Developer Mode</div>
              <div class="gpt-setting-sub-item" id="gpt-sub-setting-developer">${this._isDevEnabled() ? 'On — edit built-in prompts' : 'Off'}</div>
            </div>
          </div>
        `;
        // Insert after profile block (first child section header area)
        const firstHeader = container.querySelector('.gpt-setting-section-header');
        if (firstHeader) container.insertBefore(section, firstHeader);
        else container.insertBefore(section, container.firstChild);

        const row = section.querySelector('#gpt-main-setting-developer');
        row?.addEventListener('click', () => this._openDeveloperPage());
    }

    _openDeveloperPage() {
        const settingPage = document.getElementById('gpt-setting-page');
        if (!settingPage) return;
        if (!this.app.initialSettingContent) {
            this.app.initialSettingContent = settingPage.innerHTML;
        }

        const store = this.app.settingsStore;
        const enabled = this._isDevEnabled();

        let overrides = {};
        try {
            const raw = store?.get('devSystemPrompts', null);
            if (typeof raw === 'string') overrides = JSON.parse(raw) || {};
            else if (raw && typeof raw === 'object') overrides = raw;
        } catch (_) {}

        const KEYS = [
            'SYSTEM_INSTRUCTION_NORMAL',
            'SYSTEM_INSTRUCTION_WEB_NORMAL',
            'SYSTEM_INSTRUCTION',
            'SYSTEM_INSTRUCTION_STUDY',
            'SIMULATED_THINK_INSTRUCTION'
        ];

        const paint = (defaults) => {
            const fields = KEYS.map(k => {
                const def = String(defaults[k] || '');
                const saved = overrides[k] != null && String(overrides[k]).trim()
                    ? String(overrides[k])
                    : def;
                const esc = saved
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                return `
              <div class="sce-row sce-row-stacked" style="margin-bottom:14px;">
                <div class="sce-row-label">${k}</div>
                <div class="sce-row-desc">Edit the built-in instruction. Reset restores the default text below.</div>
                <textarea class="sce-textarea gpt-dev-prompt" data-key="${k}" rows="6" placeholder="">${esc}</textarea>
              </div>`;
            }).join('');

            settingPage.innerHTML = `
          <div class="sce-page-header" style="display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid var(--border-color,#333);">
            <span class="sce-back-btn" id="gpt-dev-back" style="cursor:pointer;font-size:18px;">&#8592;</span>
            <span class="sce-page-title" style="font-weight:600;">Developer Mode</span>
          </div>
          <div style="padding:12px;overflow:auto;flex:1;">
            <div class="sce-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <div>
                <div class="sce-row-label">Enable developer prompts</div>
                <div class="sce-row-desc" style="font-size:11px;opacity:0.6;">When on, textareas below replace built-in system instructions for all providers.</div>
              </div>
              <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="gpt-dev-enabled" ${enabled ? 'checked' : ''}/>
                <span style="font-size:12px;">${enabled ? 'On' : 'Off'}</span>
              </label>
            </div>
            <div style="font-size:11px;opacity:0.55;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.4px;">Built-in system prompts</div>
            ${fields}
            <button type="button" id="gpt-dev-save" style="margin-top:8px;width:100%;padding:10px;border:none;border-radius:10px;background:var(--button-background-color,#4b5dd1);color:#fff;font-weight:600;cursor:pointer;">Save overrides</button>
            <button type="button" id="gpt-dev-reset" style="margin-top:8px;width:100%;padding:10px;border:1px solid var(--border-color,#555);border-radius:10px;background:transparent;color:inherit;cursor:pointer;">Reset all to defaults</button>
          </div>
        `;

            settingPage.querySelector('#gpt-dev-back')?.addEventListener('click', () => {
                settingPage.innerHTML = this.app.initialSettingContent;
                this.initAllSettings();
            });

            const en = settingPage.querySelector('#gpt-dev-enabled');
            en?.addEventListener('change', () => {
                const on = !!en.checked;
                try { store?.set('developerModeEnabled', on); } catch (_) {}
                const lab = en.parentElement?.querySelector('span');
                if (lab) lab.textContent = on ? 'On' : 'Off';
                window.toast?.(on ? 'Developer prompts On' : 'Developer prompts Off', 1200);
            });

            settingPage.querySelector('#gpt-dev-save')?.addEventListener('click', () => {
                const map = {};
                settingPage.querySelectorAll('.gpt-dev-prompt').forEach(ta => {
                    const k = ta.getAttribute('data-key');
                    const v = (ta.value || '').trim();
                    if (k && v) map[k] = v;
                });
                try { store?.set('devSystemPrompts', map); } catch (_) {}
                window.toast?.('Developer prompt overrides saved', 1500);
            });

            settingPage.querySelector('#gpt-dev-reset')?.addEventListener('click', () => {
                try { store?.set('devSystemPrompts', {}); } catch (_) {}
                settingPage.querySelectorAll('.gpt-dev-prompt').forEach(ta => {
                    const k = ta.getAttribute('data-key');
                    ta.value = defaults[k] || '';
                });
                window.toast?.('Reset to built-in defaults', 1500);
            });
        };

        import('../model/SystemPrompt.js').then(mod => {
            const defaults = typeof mod.getBuiltinPromptDefaults === 'function'
                ? mod.getBuiltinPromptDefaults()
                : {
                    SYSTEM_INSTRUCTION_NORMAL: mod.SYSTEM_INSTRUCTION_NORMAL,
                    SYSTEM_INSTRUCTION_WEB_NORMAL: mod.SYSTEM_INSTRUCTION_WEB_NORMAL,
                    SYSTEM_INSTRUCTION: mod.SYSTEM_INSTRUCTION,
                    SYSTEM_INSTRUCTION_STUDY: mod.SYSTEM_INSTRUCTION_STUDY,
                    SIMULATED_THINK_INSTRUCTION: mod.SIMULATED_THINK_INSTRUCTION
                };
            paint(defaults || {});
        }).catch(() => paint({}));
    }

    setupSecretKey() {
        const secretKey = ConfigManager.get('gpt-token') || ''; 
        const maskKey = (key) => {
            let KEY = key ? key : 'gXhkaXghhjTyyU_GarbageKEY';
            const visibleLength = 4;
            return '*'.repeat(Math.max(0, KEY.length - visibleLength)) + KEY.slice(-visibleLength);
        };

        const gptSecretKeySub = document.getElementById('gpt-sub-setting-secretkey');
        if (gptSecretKeySub) gptSecretKeySub.innerText = maskKey(secretKey);

        this._attachClick('gpt-main-setting-secretkey', () => {
            navigator.clipboard.writeText(secretKey).then(() => {
                window.toast('Secret key copied to clipboard!', 1000);
            }).catch((error) => console.error('Failed to copy text:', error));
        });
    }

    setupActionButtons() {
        this._attachClick('gpt-main-setting-logout', async () => {
            if (this.app.authManager) await this.app.authManager.gptLogout();
        });

        this._attachClick('gpt-main-setting-language', () => window.toast('Available Soon....', 3000));
    }

    setupReadmeUI() {
        this._attachClick('gpt-main-setting-readme', () => {
            let settingPage = document.getElementById('gpt-setting-page');
            if (settingPage) settingPage.innerHTML = window.readmeContent || this.app.readmeContent || "No info available.";  
            
            const video = document.getElementById('youtube-video');
            const scrollIcon = document.getElementById('scroll-icon');
            
            if (video && scrollIcon) {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            scrollIcon.classList.remove('show');
                            scrollIcon.classList.add('hide');
                        } else {
                            scrollIcon.classList.remove('hide');
                            scrollIcon.classList.add('show');
                        }
                    });
                }, { threshold: 0.1 });
                observer.observe(video);

                scrollIcon.addEventListener('click', () => {
                    video.scrollIntoView({ behavior: 'smooth' });
                });
            }
        });
    }

    setupCanvasToggle() {
        const sub = document.getElementById('gpt-sub-setting-canvas');
        const syncLabel = () => {
            if (sub) sub.textContent = this.app.canvasManager?.isEnabled() ? 'On' : 'Off';
        };
        syncLabel();

        this._attachClick('gpt-main-setting-canvas', () => {
            if (!this.app.canvasManager) {
                window.toast('Canvas module not available', 1500);
                return;
            }
            const next = !this.app.canvasManager.isEnabled();
            this.app.canvasManager.setEnabled(next);
            syncLabel();
            window.toast(next ? 'Canvas Preview enabled' : 'Canvas Preview disabled', 1500);
        });
    }

    _renderSubMenu(buttonId, title, schema) {
        this._attachClick(buttonId, () => {
            const settingPage = document.getElementById('gpt-setting-page');
            if (!settingPage) return;

            if (!this.app.initialSettingContent) {
                this.app.initialSettingContent = settingPage.innerHTML;
            }

            settingPage.innerHTML = '';

            const backRow = document.createElement('div');
            backRow.className = 'sce-page-header';
            backRow.innerHTML = `<span class="sce-back-btn" aria-label="Back">&#8592;</span><span class="sce-page-title">${title}</span>`;
            backRow.querySelector('.sce-back-btn').addEventListener('click', () => {
                settingPage.innerHTML = this.app.initialSettingContent;
                this.initAllSettings(); 
            });
            settingPage.appendChild(backRow);

            const mount = document.createElement('div');
            settingPage.appendChild(mount);

            if (!this.sharedRenderer) {
                this.sharedRenderer = new SettingsRenderer(this.app, this.app.settingsStore);
            }
            this.sharedRenderer.render(schema, mount);
        });
    }

    setupChatSettingsUI() {
        this._renderSubMenu('gpt-main-setting-aichat', 'AI Chat Settings', chatHandlerSettingsSchema);
    }

    setupUISettingsUI() {
        this._renderSubMenu('gpt-main-setting-ui', 'UI & Layout', uiSettingsSchema);
    }

    setupStoragePrivacyUI() {
        this._renderSubMenu('gpt-main-setting-storage', 'Storage & Privacy', storagePrivacySettingsSchema);
    }
}