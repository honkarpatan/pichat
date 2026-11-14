// src/main/core/storage/StorageManager.js
import plugin from '../../../../plugin.json'; 
import { Formatter } from '../../utils/Formatter.js'; 
import { ModelConfig } from '../../model/ModelConfig.js'; 
import { HistoryFileOps } from '../../history/HistoryFileOps.js'; 
import { ConfigManager } from '../../utils/ConfigManager.js'
import { CustomModelManager } from '../../model/CustomModelManager.js';
import { mountStartPage, updateStartPageIcon } from '../../ui/startPage/index.js';

export class StorageManager {
    constructor(pluginContext) {
        this.app = pluginContext; 
        
        // Global Encryption Toggle
        this.app.enableEncryption = false; 
    }

    generateChatId() {
        return Date.now().toString() + Math.floor(Math.random() * 1000).toString();
    }

    async pathCheck() {
        const fs = acode.require("fs") ;
        if (!fs) return;

        if (this.app.usageManager) {
            if (this.app.pathUrl) await this.app.usageManager.migrateToPath();
            else await this.app.usageManager.load();
        }

        if (this.app.modelManager) {
            this.app.selectedModel = await this.app.modelManager.getSelectedModelData();
        }
        
        if (this.app.pathUrl && this.app.pathUrl !== '') {
            this.app.currentConversationIndex = ConfigManager.get('current_chat_index', '0');
            const convDirPath = `${this.app.pathUrl}/conversations`;
            
            const convDirExists = await fs(convDirPath).exists();
            if (!convDirExists) {
                await fs(this.app.pathUrl).createDirectory('conversations');
            }

            try {
                const filesList = await fs(convDirPath).lsDir();
                let loadedConvs = [];

                for (let file of filesList) {
                    if (file.isFile && file.name.startsWith('chat_') && file.name.endsWith('.json') && !file.name.includes('_temp')) {
                        try {
                            const fileContent = await fs(file.url).readFile("utf-8");
                            const decryptedStr = HistoryFileOps.decryptData(fileContent);
                            const parsed = JSON.parse(decryptedStr);
                            loadedConvs.push(parsed);
                        } catch (fileErr) {
                            console.warn(`[Corrupted File Detected & Skipped]: ${file.name}`, fileErr);
                            try { await fs(file.url).delete(); } catch(e) {}
                        }
                    }
                }

                loadedConvs.sort((a, b) => a.id.localeCompare(b.id));
                this.app.conversations = loadedConvs;

            } catch (error) {
                console.error('Critical Error loading conversations folder', error);
            }

            if (this.app.chatHistoryManager && typeof this.app.chatHistoryManager.startNewConversation === 'function') {
                await this.app.chatHistoryManager.startNewConversation(this.app.selectedModel, true);
            }
        }
    }

    async modelsCheck() {
        // 🟢 FIX: Ensure all Custom Models are registered into ModelConfig FIRST
        CustomModelManager.registerAll();

        const localModelsArray = Object.keys(ModelConfig).map(key => {
            const conf = ModelConfig[key];
            return { 
                model: key, 
                type: key, 
                name: conf.name, 
                image: conf.image, 
                image_bg: conf.image_bg, 
                info: conf.info, 
                capability: conf.capability, 
                level: conf.level 
            };
        });

        this.app.allModels = localModelsArray;
        
        // Ensure recent models are updated with all custom models
        if (!this.app.recentModels || this.app.recentModels.length < 1) {
            this.app.recentModels = this.app.allModels; 
        } else {
            // Restore missing custom models back to recent models just in case
            const customModels = localModelsArray.filter(m => CustomModelManager.isCustomType(m.type));
            customModels.forEach(cm => {
                if (!this.app.recentModels.find(rm => rm.model === cm.model)) {
                    this.app.recentModels.push(cm);
                }
            });
        }
    }

    async userCheck() {
        const id = ConfigManager.get('gpt-user-id');
        const token = ConfigManager.get('gpt-token');
        const currentGptUserEmail = ConfigManager.get('current-gpt-user-email');
        const currentGptUserName = ConfigManager.get('current-gpt-user-name');

        const fs = acode.require("fs") ;
        if (!fs) return;

        const existUser = await fs(`${this.app.pathUrl}/user-${id}.aicode.cosmo.json`).exists();
        const defaultUserFile = { id, token, name: currentGptUserName, email: currentGptUserEmail, phone: "+91 1234000000" };

        if (!existUser) {
            await fs(`${this.app.pathUrl}`).createFile(`user-${id}.aicode.cosmo.json`, JSON.stringify([defaultUserFile], null, 2));
            await fs(`${this.app.pathUrl}`).createFile(`user.json`, JSON.stringify(defaultUserFile, null, 2));
        }
    }

    async DownloadCheck() {
        const fs = acode.require("fs") ;
        if (!fs) return;
        const ROOT_DIR = `file:///storage/emulated/0`;
        const existDownloadDir = await fs(`${ROOT_DIR}/Download`).exists();
        if (!existDownloadDir) await fs(`${ROOT_DIR}`).createDirectory('Download');
    }

    async imagesCheck() {
        const fs = acode.require("fs") ;
        if (!fs) return;
        const existImagesDir = await fs(`${ACODE_FILE_STORAGE}/images`).exists();
        if (!existImagesDir) await fs(`${ACODE_FILE_STORAGE}`).createDirectory('images');
    }

    async setPath() {
        const fileBrowser = acode.require("fileBrowser");
        if (!fileBrowser) return;

        let myFile = await fileBrowser("folder", "Change the selected folder", true); 
        if (myFile) {
            ConfigManager.set("selectedPath", myFile.url);
            this.app.pathUrl = myFile.url;
            this.app.currentConversationIndex = '0';
            ConfigManager.set('current_chat_index', '0');
            
            window.toast("Location Added Successfully √");
            
            await this.pathCheck(); 
            
            if (this.app.oneTimeLoad === false) {
                if (this.app.chatHistoryManager) {
                    await this.app.chatHistoryManager.loadConversation(parseInt(this.app.currentConversationIndex), false);
                }
                this.app.oneTimeLoad = true;
            }
            
            const appSettings = acode.require('settings') ;
            if (appSettings && appSettings.value[plugin.id]) {
                appSettings.value[plugin.id].aicode_path_url = myFile.url;
                appSettings.update();
            }
            
            let settingPathInfo = document.getElementById('gpt-sub-setting-path');
            if (settingPathInfo) settingPathInfo.innerHTML = this.contentToFile(this.app.pathUrl);
            return myFile.url;
        } else {
            window.toast("Location Not Added !");
            return null;
        }
    }
  
    contentToFile(path) {
        if (!path || path === 'null') return 'Please select local path to save chats';
        let pathUrl = path.replace(/^.*primary/, 'primary').replace(/primary/g, '').replace(/%\d[a-zA-Z]/g, '/').split(/:+/).pop();
        return pathUrl;
    }
      
    async initializeInfoSection() {
        if (this.app.lang_showing && this.app.lang_showing !== 'null') {
            const HARDCODED_INFO_DATA = [
                { "function": "none", "title": "100% Free Limits", "content": "Use your own API keys for unlimited usage." },
                { "function": "none", "title": "Privacy First", "content": "All chats are saved entirely on your device." },
                { "function": "content", "title": "To get Api key", "content": "Click top-right badge ." }
            ];
            this.app.infoData = HARDCODED_INFO_DATA;
            this.renderRandomInfoSection(this.app.infoData); 
        }
    }
    
    renderRandomInfoSection(infoData) {
        if (!infoData) return;

        const chatBox = document.getElementById('chat-box');
        if (!chatBox) return;

        // Empty chat only — if messages exist, don't wipe chat-box
        if (chatBox.querySelector('.gpt-message, .assistant-message, .user-message')) {
            return;
        }

        const model = this.app.selectedModel || {};
        const modelType = this.app.selectedModelType || model.type || '';

        mountStartPage(chatBox, {
            model,
            modelType,
            infoItems: infoData,
            onInfoClick: (fn, title, content) => this.handleInfoClick(fn, title, content)
        });
    }

    async handleInfoClick(functionType, title, content) {
        if (functionType === 'run' && this.app.chatHandler) {
            await this.app.chatHandler.handleSendMessage(title + ' ' + content);
        }
    }
}