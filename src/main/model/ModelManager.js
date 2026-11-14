// src/main/core/model/ModelManager.js
import { ModelSetupUI } from '../ui/ModelSetupUI.js'; 
import { ModelConfig } from './ModelConfig.js'; 
import { ConfigManager } from '../utils/ConfigManager.js';
import { CustomModelManager } from './CustomModelManager.js';
import { isFimEnabled } from '../fim/FimSettings.js';
import { updateStartPageIcon } from '../ui/startPage/index.js';

export class ModelManager {
    constructor(pluginContext) {
        this.app = pluginContext; 
    }

    renderModels(e = false) {
        const modelListElement = document.querySelector('#gpt-chat-model');
        if (!modelListElement) return;
        modelListElement.innerHTML = ''; 

        // Let's show all available models in the sidebar
        const modelsToShow = this.app.allModels || []; 
        this.showListModel(modelsToShow, e);
    }

    showListModel(modelsToShow, e) {
        if (!this.app.modelListElement) this.app.modelListElement = document.querySelector('#gpt-chat-model');
        if (!this.app.modelListElement) return;
        this.app.modelListElement.innerHTML = '';

        modelsToShow.sort((a, b) => {
            if (a.model === this.app.lastSelectedModel && a.name === this.app.lastSelectedModelName) return -1;
            else if (b.model === this.app.lastSelectedModel && b.name === this.app.lastSelectedModelName) return 1;
            return 0;
        });

        modelsToShow.forEach(model => {
            if (model.type === 'hide') return;

            const li = document.createElement('li');
            li.classList.add('gpt-model-each-list', 'gpt-slow-wave');
            li.setAttribute('id', model.model);
            li.setAttribute('data-model', model.model);
            li.setAttribute('data-name', model.name);

            let imageContent = model.image.trim().startsWith('<svg') 
                ? model.image 
                : `<img src="${model.image}" alt="${model.name}" style="width: 18px; height: 18px;">`;
            
            let model_color = model.level === 'pro' ? '#e1ca10c7' : (model.level === 'smart' ? '#10a1e1c7' : 'var(--primary-text-color)');
            
            const modelType = model.type.toLowerCase();
            const config = ModelConfig[modelType];

            if (config) {
                let selectedModelName = `Powered By ${model.name}`;
                if (config.modelKeyName) {
                    let storedName = ConfigManager.get(config.modelKeyName);
                    if (storedName && storedName !== 'null') selectedModelName = storedName.replace('models/', '');
                }

                li.innerHTML = this.getSidebarHTML(model, imageContent, selectedModelName, model_color);
            } else {
                li.innerHTML = `
                    <div class="gpt-sidebar-model-icon">
                        <div class="gpt-sidebar-model-icon-bg" style="background-color:${model.image_bg}">${imageContent}</div>
                    </div>
                    <div class="gpt-model-name">
                        <div style="color:${model_color};">${model.name}</div>
                        <div class="gpt-model-type">${model.type}</div>
                    </div>`;
            }

            if (config) {
                const threeDot = document.createElement('span');
                threeDot.classList.add('gpt-threedot-setting');
                threeDot.textContent = '⋮';
                threeDot.title = 'Options';
                threeDot.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const configFlags = { [modelType]: true }; 
                    await this.handleModelClick(model, configFlags);
                });
                li.appendChild(threeDot);
            }

            if (model.model === this.app.lastSelectedModel && model.name === this.app.lastSelectedModelName) li.classList.add('active-model');

            li.addEventListener('click', async () => {
                if (this.app.tokenManager && typeof this.app.tokenManager.updateTokenUsage === 'function') {
                    this.app.tokenManager.updateTokenUsage(null, model);
                }

                this.app.sticker = config?.bypassAppQuota ? 'allow' : null;

                if (model.level === 'hide') return;

                document.querySelectorAll('#gpt-chat-model li').forEach(item => item.classList.remove('active-model'));
                li.classList.add('active-model');

                await this.handleModelClick(model, {});
                
                if (this.app.chatHistoryManager && typeof this.app.chatHistoryManager.startNewConversation === 'function') {
                    await this.app.chatHistoryManager.startNewConversation(model);
                }

                this.app.selectedModel = model;
                this.app.lastSelectedModel = model.model;
                this.app.lastSelectedModelName = model.name;

                const gptTopTitle = document.querySelector('#gpt-top-title');
                if (gptTopTitle) {
                    gptTopTitle.innerText = model.name;
                    this.app.gptTopTitle = model.name;
                }

                ConfigManager.set('lastSelectedModel', model.model);
                ConfigManager.set('lastSelectedModelName', model.name);
                
                if (this.app.bubbleControls && typeof this.app.bubbleControls.enableFunctionBubble === 'function') this.app.bubbleControls.enableFunctionBubble();
            });

            this.app.modelListElement.appendChild(li);
        });

        // 🟢 "Create Custom Model" — same row UI as other models (no dashed border, no ⋮)
        // Lucide-style puzzle piece
        const puzzleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.075.358.153.69.51.765a2.5 2.5 0 0 1 1.801 3.426c-.32.608-.92 1.01-1.6 1.059-.358.025-.65.327-.625.685a2.5 2.5 0 0 1-3.426 1.801c-.608-.32-1.01-.92-1.059-1.6-.025-.358-.327-.65-.685-.625a2.5 2.5 0 0 1-1.801-3.426c.32-.608.92-1.01 1.6-1.059.358-.025.65-.327.625-.685a2.5 2.5 0 0 1 3.426-1.801c.608.32 1.01.92 1.059 1.6.025.358.327.65.685.625z"/><path d="M11.5 2.5v3.5a2 2 0 1 1-4 0V2.5"/><path d="M2.5 11.5h3.5a2 2 0 1 1 0 4H2.5"/><path d="M11.5 21.5v-3.5a2 2 0 1 0-4 0v3.5"/><rect x="5.5" y="5.5" width="8" height="8" rx="1"/></svg>`;

        const addBtn = document.createElement('li');
        addBtn.classList.add('gpt-model-each-list', 'gpt-slow-wave', 'gpt-create-custom-model-btn');
        addBtn.setAttribute('role', 'button');
        addBtn.setAttribute('data-model', '__create_custom__');
        addBtn.setAttribute('data-name', 'Custom Model');
        // Match getSidebarHTML layout — no extra border, no three-dot
        addBtn.innerHTML = `
            <div class="gpt-sidebar-model-icon">
                <div class="gpt-sidebar-model-icon-bg" style="background-color:#4b5dd1">${puzzleSvg}</div>
            </div>
            <div class="gpt-model-name">
                <div style="color:var(--primary-text-color);">Custom Model
                    <div class="gpt-selected-model-id" style="font-size:0.8em; color:#888;">any</div>
                </div>
                <div class="gpt-model-type">custom</div>
            </div>
        `;

        const openCreate = (ev) => {
            try {
                if (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                }
                console.log('[ModelManager] Create Custom Model clicked');
                // Defer so sidebar click handlers finish first
                setTimeout(() => {
                    try {
                        CustomModelManager.showCreateModal(this.app);
                    } catch (err) {
                        console.error('[ModelManager] showCreateModal error', err);
                        window.toast?.(`Custom model: ${err.message || err}`);
                    }
                }, 0);
            } catch (err) {
                console.error('[ModelManager] openCreate failed', err);
                window.toast?.(`Custom model: ${err.message || err}`);
            }
        };
        addBtn.addEventListener('click', openCreate, true);
        addBtn.onclick = openCreate;

        this.app.modelListElement.appendChild(addBtn);
    }

    getSidebarHTML(model, imageContent, selectedModelName, titleColor) {
        const type = String(model.type || '').toLowerCase();
        let fimBadge = '';
        try {
            if (isFimEnabled(type)) {
                fimBadge = `<span class="gpt-fim-badge" title="FIM enabled">fim</span>`;
            }
        } catch (_) {}
        return `
            <div class="gpt-sidebar-model-icon">
                <div class="gpt-sidebar-model-icon-bg" style="background-color:${model.image_bg}">${imageContent}</div>
            </div>
            <div class="gpt-model-name">
                <div style="color:${titleColor};display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>${model.name}</span>${fimBadge}
                    <div class="gpt-selected-model-id" style="font-size:0.8em; color:#888;width:100%;">${selectedModelName}</div>
                </div>
                <div class="gpt-model-type">${model.type}</div>
            </div>
        `;
    }

    async handleModelClick(model, modalFlags = {}) {
        let gptStartPageIcon = document.getElementById('gpt-start-page-icon');
        
        let bgImageUrl = '';
        if (model.image.startsWith('<svg')) {
            const encodedSvg = encodeURIComponent(model.image).replace(/'/g, '%27').replace(/"/g, '%22').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
            bgImageUrl = `data:image/svg+xml;charset=UTF-8,${encodedSvg}`;
            if (gptStartPageIcon !== null) {
                gptStartPageIcon.style.backgroundColor = model.image_bg;
                gptStartPageIcon.innerHTML = model.image;
                try { updateStartPageIcon(model); } catch (_) {}
            }
        } else {
            bgImageUrl = model.image;
            if (gptStartPageIcon !== null) {
                gptStartPageIcon.style.backgroundColor = model.image_bg;
                gptStartPageIcon.innerHTML = `<img src="${model.image}" alt="Image" style="max-width:80%;">`;
            }
        }

        let styleTag = document.getElementById('dynamic-ai-avatar-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'dynamic-ai-avatar-style';
            document.head.appendChild(styleTag);
        }
        styleTag.innerHTML = `
            .assistant-message::before, .gpt-message.assistant-message::before {
                background-image: url('${bgImageUrl}') !important;
                background-size: cover !important;
                background-color: ${model.image_bg} !important;
            }
        `;

        if (this.app.appUIManager && typeof this.app.appUIManager.dynamicChatModelIconChange === 'function') {
            this.app.appUIManager.dynamicChatModelIconChange(bgImageUrl);
        } else if (typeof this.app.dynamicChatModelIconChange === 'function') {
            this.app.dynamicChatModelIconChange(bgImageUrl);
        }

        this.app.selectedModel = model;
        try {
          window.dispatchEvent(new CustomEvent('gpt-model-changed', {
            detail: { modelType: model?.type, source: 'modelManager' }
          }));
        } catch (_) {}

        const modelType = model.type.toLowerCase();
        const config = ModelConfig[modelType];
        
        if (this.app.chatInputUI && typeof this.app.chatInputUI.updateSendButton === 'function') {
            this.app.chatInputUI.updateSendButton(config);
            this.app.chatInputUI.updateDynamicToggles(config);
        }
        
        const consoleBtn = document.getElementById('gpt-model-console-btn');
        if (consoleBtn) {
            if (config && config.consoleUrl) {
                const url = config.consoleUrl;
                const btnText = config.consoleText || 'Console';
                consoleBtn.innerHTML = `<a href="${url}" target="_blank" style="color: inherit; text-decoration: none;">${btnText} <span style="font-size:1.1em;font-weight:bold;">↗</span></a>`;
                consoleBtn.style.display = 'block'; 
            } else {
                consoleBtn.style.display = 'none';
            }
        }

        if (!config) return; 

        let isMissingKey = false;
        let isMissingModel = false;

        if (config.apiKeyName && config.apiKeyName.toLowerCase().includes('key')) {
            const key = ConfigManager.get(config.apiKeyName);
            if (!key || key.trim() === '' || key === 'null') {
                isMissingKey = true;
            }
        }

        if (config.setting_ui && config.setting_ui.inputs && config.setting_ui.inputs.length > 0) {
            const primaryInputKey = config.setting_ui.inputs[0].storageKey;
            const modelId = ConfigManager.get(primaryInputKey);
            if (!modelId || modelId.trim() === '' || modelId === 'null') {
                isMissingModel = true;
            }
        } else if (config.modelKeyName) {
            const modelId = ConfigManager.get(config.modelKeyName);
            if (!modelId || modelId.trim() === '' || modelId === 'null') {
                isMissingModel = true;
            }
        }

        if (modalFlags[modelType] || isMissingKey || isMissingModel) {
            if (typeof ModelSetupUI !== 'undefined') {
                ModelSetupUI.showModelModal(this.app, model); 
            }
        }
    }

    async getSelectedModelData() {
        if (this.app.storageManager && typeof this.app.storageManager.modelsCheck === 'function') await this.app.storageManager.modelsCheck();
        
        const modelId = this.app.lastSelectedModel && this.app.lastSelectedModel !== 'null' ? this.app.lastSelectedModel : null;
        const modelName = this.app.lastSelectedModelName && this.app.lastSelectedModelName !== 'null' ? this.app.lastSelectedModelName : null;
        
        if (modelId && modelName && this.app.allModels) {
            for (let i = 0; i < this.app.allModels.length; i++) {
                if (this.app.allModels[i].model == modelId && this.app.allModels[i].name == modelName) return this.app.allModels[i];
            }
        }
        
        if (this.app.allModels && this.app.allModels.length > 0) {
            return this.app.allModels[0];
        }
        return null;
    }

    activeModel(current_modal = this.app.selectedModel) {
        if (!this.app.allModels || !this.app.selectedModel || !current_modal) return;
        let activeModel2 = this.app.allModels.find(model => model.model === this.app.selectedModel.model && model.name === current_modal.name);
        
        if (!activeModel2 && this.app.allModels.length > 0) activeModel2 = this.app.allModels[0];
        
        if (activeModel2) { this.app.recentModels = [activeModel2]; this.app.gptTopTitle = activeModel2.name; }
    }

    activateModel(selectedModel) {
        const modelListItems = document.querySelectorAll('#gpt-chat-model li');
        modelListItems.forEach(item => {
            const model = item.getAttribute('data-model');
            const name = item.getAttribute('data-name');
            if (model === selectedModel.model && name === selectedModel.name) item.classList.add('active-model');
            else item.classList.remove('active-model');
        });
    }

    getModelNToken() {
        const hftoken = this.app.tToks || [];
        if (hftoken.length === 0) return { hfToken: null };
        const randomHfToken = hftoken[Math.floor(Math.random() * hftoken.length)];
        return { hfToken: `Bearer ` + randomHfToken };
    }

    getNextModel(triedModels) {
        const modelList = this.app.allModels || [];
        const remainingModels = modelList.filter(modelObj => !triedModels.includes(modelObj.model));
        return remainingModels.length > 0 ? remainingModels[Math.floor(Math.random() * remainingModels.length)] : null;
    }

    setActiveChat(index) {
        const chatHistoryElement = document.getElementById('gpt-chats-history');
        if (chatHistoryElement) {
            const allChatItems = chatHistoryElement.querySelectorAll('li');
            allChatItems.forEach(item => item.classList.remove('active'));
            
            const activeItem = chatHistoryElement.querySelector(`li[data-index="${index}"]`);
            if (activeItem) activeItem.classList.add('active');
        }
    }

    /** Collapse #gpt-chat-model to single-row height (60px) — same as “Hide GPT's” */
    collapseModelListToRow() {
        try {
            if (!this.app.modelListElement) {
                this.app.modelListElement = document.querySelector('#gpt-chat-model');
            }
            const el = this.app.modelListElement;
            if (el) {
                el.style.height = '60px';
                el.style.maxHeight = '60px';
                el.style.overflow = 'hidden';
                el.classList.remove('active');
            }
            if (this.app.moreButtonDiv) {
                this.app.moreButtonDiv.textContent = "More GPT's";
            }
            if (this.app.listHistory) {
                this.app.listHistory.style.height = '75vh';
            }
        } catch (e) {
            console.warn('[ModelManager] collapseModelListToRow', e);
        }
    }

    /** Expand full model list (30vh) — same as “More GPT's” */
    expandModelListFull() {
        try {
            if (!this.app.modelListElement) {
                this.app.modelListElement = document.querySelector('#gpt-chat-model');
            }
            const el = this.app.modelListElement;
            if (el) {
                el.style.height = '30vh';
                el.style.maxHeight = '30vh';
                el.style.overflow = 'scroll';
            }
            if (this.app.moreButtonDiv) {
                this.app.moreButtonDiv.textContent = "Hide GPT's";
            }
            if (this.app.listHistory) {
                this.app.listHistory.style.height = '70vh';
            }
        } catch (e) {
            console.warn('[ModelManager] expandModelListFull', e);
        }
    }
}
