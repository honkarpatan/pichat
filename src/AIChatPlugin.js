// src/AIChatPlugin.js 

import plugin from '../plugin.json';
import { getSettings, settingsList, onSettingsChange } from './settings.js';

const { editor } = window.editorManager;
import MarkdownIt from 'markdown-it';
import Prism from './prism.js';
import { addStyles } from './addStyle.js';
import { showTopIcon } from './action/showTileIcon.js';
import { mainBoxHTML } from './data/mainBoxHtml.js'; 

// Managers
import { ChatModalSetup } from './main/ui/ChatModalSetup.js';
import { SettingsUI } from './main/ui/SettingsUI.js';
import { PopupManager } from './main/ui/PopupManager.js';
import { ChatInputUI } from './main/ui/ChatInputUI.js';
import { StorageManager } from './main/core/storage/StorageManager.js';
import { ChatHistoryManager } from './main/core/chat/ChatHistoryManager.js';
import { ModelManager } from './main/model/ModelManager.js'; 
import { ChatRenderer } from './main/ui/ChatRenderer.js';
import { AppUIManager } from './main/ui/AppUIManager.js';
import { AuthManager } from './main/core/auth/AuthManager.js';
import { ChatHandler } from './main/core/chat/ChatHandler.js';
import { UsageManager } from './main/core/usage/UsageManager.js';
import { Formatter } from './main/utils/Formatter.js';
import { ConfigManager } from './main/utils/ConfigManager.js';
import { CanvasManager } from './main/ui/canvas/CanvasManager.js';
import { SettingsStore, hydrateSchema } from './main/settings/SettingsStore.js';
import { chatHandlerSettingsSchema } from './main/settings/schemas/chatHandlerSettings.js';

const appSettings = window.acode.require('settings');

export class AIChatPlugin { 
    constructor() {
        if (!appSettings.value[plugin.id]) {
            appSettings.value[plugin.id] = { };
            appSettings.update(false);
        }
        
        this.md = new MarkdownIt({
            html: true ,
            highlight: (str, lang) => {
                if (lang && Prism.languages[lang]) {
                    try { return `<pre class="language-${lang}"><code data-language="${lang}">${Prism.highlight(str, Prism.languages[lang], lang)}</code></pre>`; } catch (__) {}
                }
                return `<pre class="language-plaintext"><code data-language="plaintext">${this.md.utils.escapeHtml(str)}</code></pre>`;
            }
        });

        // Initialize Managers
        this.settingsUI = new SettingsUI(this);
        this.popupManager = new PopupManager(this);
        this.chatInputUI = new ChatInputUI(this);
        this.storageManager = new StorageManager(this);
        this.canvasManager = new CanvasManager(this);
        this.chatHistoryManager = new ChatHistoryManager(this);
        this.modelManager = new ModelManager(this);
        this.chatRenderer = new ChatRenderer(this);
        this.appUIManager = new AppUIManager(this);
        this.authManager = new AuthManager(this);
        this.chatHandler = new ChatHandler(this);
        this.usageManager = new UsageManager(this); // 🟢 Token Usage: per-model + global request/token tracking
        this.chatModalSetup = new ChatModalSetup(this);

        // Initialize System Flags
        this.singleRun = true; 

        // 🟢 Settings Engine: schema-driven get/set for plugin settings (backed by ConfigManager)
        // See src/main/settings/SettingsStore.js + SettingsRenderer.js + settings/schemas/*.js
        this.settingsStore = new SettingsStore(this);

        // State Variables
        this.amIThink = false;
        this.isOncePathChkDone = false;
        this.isFetching = false;
        this.currentRequestController = null;
        this.blockCount = 0;
        this.blockResetTimeout = null;
        this.optimize = false;

        // 🟢 These used to be hardcoded here (isShowHistory, isShowImg, isEnableCatchSelectText,
        // isEnableWebBrowsing, isEnableFunctionCatch). They're now persisted, user-editable settings —
        // see chatHandlerSettingsSchema.js. Add a new `bind`-ed field there to hydrate a new flag here
        // automatically; nothing in this file needs to change.
        hydrateSchema(this.settingsStore, chatHandlerSettingsSchema);

        // Load Settings & Storage
        this.__SETTINGS = this.getSettings();
        this.pathUrl = this.__SETTINGS.aicode_path_url ? this.__SETTINGS.aicode_path_url : null;
        
        this.lang_showing = ConfigManager.get('current-gpt-user-email') || null;
        this.continueWOpath = ConfigManager.get('continueWOpath') || 'false'; 
        
        // API Keys & Models Tracking
        this.gptApiKey = ConfigManager.get('gptApiKey') || 'null';
        this.gptModel = ConfigManager.get('gptSelectedModel') || 'null';
        this.mistralApiKey = ConfigManager.get('mistralApiKey') || 'null';
        this.mistralModel = ConfigManager.get('mistralSelectedModel') || 'null';
        this.geminiApiKey = ConfigManager.get('geminiApiKey') || 'null';
        this.geminiModel = ConfigManager.get('geminiSelectedModel') || 'null';
        
        this.huggingfaceKey = ConfigManager.get('huggingfaceApiKey') || 'null';
        this.huggingfaceModel = ConfigManager.get('huggingfaceSelectedModel') || 'null';
        this.huggingfaceReasoningModel = ConfigManager.get('huggingfaceReasoningModel') || 'null';
        this.huggingfaceImageModel = ConfigManager.get('huggingfaceImageModel') || 'null';

        this.lastSelectedModel = ConfigManager.get('lastSelectedModel') || 'null';
        this.lastSelectedModelName = ConfigManager.get('lastSelectedModelName') || 'null';
        
        this.updateTokenWhen = ConfigManager.get('updateTokenWhen') || '0.8';

        const defaultChatId = Date.now().toString();
        const currentDate = typeof Formatter !== 'undefined' && Formatter.getFormattedDate ? Formatter.getFormattedDate() : new Date().toLocaleDateString();

        this.conversations = [{ id: defaultChatId, title: "New Chat", chat: [], model: this.selectedModel, date: currentDate }];
        this.conversationsTemp = [{ id: defaultChatId, title: "New Chat", chat: [], model: this.selectedModel, date: currentDate }];
        
        this.allModels = [];
        this.recentModels = [];
        this.chatHistory = [];
        this.chatHistoryTemp = [];
        
        this.gptTopTitle = 'Loading...';
    }

    async init() {
        // addStyles();
        showTopIcon();
        
        if (this.chatModalSetup) {
            await this.chatModalSetup.setup(mainBoxHTML);
        }

        if (this.usageManager) this.usageManager.load(); // 🟢 Token Usage: non-blocking load (fallback storage until a chat path is picked)

        // Top-bar usage circle after DOM is ready (OpenRouter live credits)
        try {
            const { TopBarUsage } = await import('./main/ui/TopBarUsage.js');
            TopBarUsage.init(this);
            this._topBarUsage = TopBarUsage;
        } catch (e) {
            console.warn('[AIChat] TopBarUsage init skipped', e);
        }

        if (this.appUIManager) {
            this.authManager.registerCommands();
            this.appUIManager.setupLoginModal(this.authManager);
            this.appUIManager.initSidebarSwipe();
        }
    }

    getSettings() {
        return appSettings.value[plugin.id];
    }

    get settingsObj() {
        return {
            list: [
                { key: "path", text: "Select Path", info: "Select path location where GPT chats are saved locally", value: this.getSettings().path },
                { key: "resetAll", text: "Reset All", info: "Reset all settings to default", value: "" }
            ],
            cb: (key, value) => this.settingsCall(key, value)
        };
    }

    async settingsCall(key, value) {
        if (key === "resetAll") this.allReset();
    }
  
    incrementBlockCount() {
        this.blockCount += 1;
        if (this.blockResetTimeout) clearTimeout(this.blockResetTimeout);
        this.blockResetTimeout = setTimeout(() => { this.blockCount = 0; }, 1200000); 
    }

    parseImageLinks(message) {
      return message;
    }

    escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
  
    async allReset() {
        window.toast('App Reset Successfully! Restart Editor');
        localStorage.clear(); 
        await this.destroy();
    }

    async destroy() {
        this.chatHistory = [];
        this.chatHistoryTemp = [];
        this.pastUserInputs = [];
        this.pastUserInputsTemp = [];
        this.generatedResponses = [];
        this.generatedResponsesTemp = [];
        this.isFetching = false;
        this.currentRequestController = null;
        
        const defaultChatId = Date.now().toString();
        const currentDate = typeof Formatter !== 'undefined' && Formatter.getFormattedDate ? Formatter.getFormattedDate() : new Date().toLocaleDateString();

        this.conversations = [{ id: defaultChatId, title: "New Chat", chat: [], model: this.selectedModel, date: currentDate }];
        this.conversationsTemp = [{ id: defaultChatId, title: "New Chat", chat: [], model: this.selectedModel, date: currentDate }];
        
        this.currentConversation = null;
        this.currentConversationTemp = null;
        this.currentConversationIndex = '0';
        
        this.web_results = '';
        this.blockCount = 0;
        if (this.blockResetTimeout) clearTimeout(this.blockResetTimeout);
        this.blockResetTimeout = null;
        
        this.lang_showing = null;
        this.pathUrl = null; 
        this.continueWOpath = 'false'; 
        
        this.gptModel = null;
        this.gptApiKey = null;
        this.geminiApiKey = null;
        this.geminiModel = null;
        this.mistralApiKey = null;
        this.mistralModel = null;
        this.huggingfaceKey = null;
        this.huggingfaceModel = null;
        this.lastSelectedModel = null;
        this.lastSelectedModelName = null;

        this.selectedModel = null;
        this.activateSelectMode = false;
    }
}