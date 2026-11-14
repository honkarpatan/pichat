import { ChatUI } from './ChatUI.js';
import { ImageHandler } from '../utils/ImageHandler.js';
import {ConfigManager} from '../utils/ConfigManager.js';

export class ChatModalSetup {
    constructor(pluginContext) {
        this.app = pluginContext; 
    }

    async setup(mainBoxHTML) {
        // console.log('CHAT MODAL** _______________________________________]');
        const aicode = document.querySelector('#aicode');
        
        this.app.mainBox = document.createElement("div");
        this.app.mainBox.classList.add('modal-overlayy');
        this.app.mainBox.innerHTML = mainBoxHTML;
        document.body.appendChild(this.app.mainBox);

        // Setup Dynamic Input UI Before anything else!
        if (this.app.chatInputUI) {
            this.app.chatInputUI.setup();
        }

        // Pre-populate models to inject the correct UI immediately!
        if (this.app.storageManager && typeof this.app.storageManager.modelsCheck === 'function') {
            await this.app.storageManager.modelsCheck();
        }

        if (this.app.modelManager) {
            this.app.selectedModel = await this.app.modelManager.getSelectedModelData();
            this.app.modelManager.activeModel(this.app.selectedModel);

            // FORCE rendering the model list right now to clear any empty space!
            this.app.modelListElement = document.querySelector('#gpt-chat-model');
            if (this.app.modelListElement) {
                this.app.modelListElement.classList.add('active');
                this.app.modelManager.showListModel(this.app.recentModels);
            }

            if (this.app.selectedModel) {
                const gptTopTitle = this.app.mainBox.querySelector('#gpt-top-title');
                if (gptTopTitle) {
                    gptTopTitle.innerText = this.app.selectedModel.name;
                    this.app.gptTopTitle = this.app.selectedModel.name;
                }
            }
        }

        this.app.listHistory = document.querySelector('#gpt-chats-history');
        this.app.moreButton = document.querySelector('#gpt-chat-more');
        this.app.moreButtonDiv = document.querySelector('#gpt-more-button div');
        this.app.usageToken = this.app.mainBox.querySelector('#gpt-token-usage');
        this.app.gptDot = document.querySelector('#gpt-three-dot');

        // Send Button and Stop Button listeners hooked to the newly rendered ChatInputUI buttons
        const sendBtn = this.app.mainBox.querySelector('#send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', async () => {
                const userInput = document.getElementById('gpt-user-input');
                if (userInput) userInput.style.height = "24px"; // UI Reset height
                
                if (this.app.chatHandler && typeof this.app.chatHandler.handleSendMessage === 'function') {
                    await this.app.chatHandler.handleSendMessage(); 
                } else {
                    console.error("ChatHandler is missing! Please check ChatHandler.js imports.");
                }
            });
        }

        const stopBtn = this.app.mainBox.querySelector('#stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                if (this.app.chatHandler && typeof this.app.chatHandler.handleStopFetching === 'function') {
                    await this.app.chatHandler.handleStopFetching();
                }
            });
        }
        
        if (typeof window.fixInputHeight === 'function') window.fixInputHeight();

        this.app.mainBox.addEventListener("click", (e) => {
            if (e.target === this.app.mainBox) this.app.mainBox.classList.remove("gpt-show");
        });

        if (aicode) {
            aicode.addEventListener("click", async (e) => {
                if(ChatUI.spinGPTICON) ChatUI.spinGPTICON(true);
                
                if (window.appSettings && window.appSettings.value.animation === 'no') {
                    const styles = document.createElement('style');
                    styles.innerHTML = `.user-message .gpt-message-inner-holder p, #chat-box, .assistant-message { animation: none !important; transition: none !important; } .modal-overlayy * { animation: none !important; transition: none !important; }`;
                    document.head.appendChild(styles);
                }

                if (this.app.lang_showing && this.app.lang_showing !== 'null') {
                    if (this.app.authManager) await this.app.authManager.gptUpToDate(this.app.lang_showing);

                    if (this.app.isFetching == false && this.app.isOncePathChkDone == false) {
                        if (this.app.storageManager) await this.app.storageManager.pathCheck();
                        this.app.isOncePathChkDone = true;
                    }

                    if (this.app.singleRun || !this.app.selectedModel || !this.app.allModels) {
                        if (this.app.isFetching == false && this.app.storageManager) await this.app.storageManager.modelsCheck();
                        if (this.app.modelManager) this.app.selectedModel = await this.app.modelManager.getSelectedModelData();
                        
                        this.app.pathUrl = this.app.__SETTINGS?.aicode_path_url ? this.app.__SETTINGS.aicode_path_url : null;
                        
                        if (this.app.modelManager && ((this.app.pathUrl !== null && this.app.pathUrl !== '') || this.app.continueWOpath !== 'false')) {
                            await this.app.modelManager.handleModelClick(this.app.selectedModel);
                        }
                        
                        if (this.app.modelManager) {
                            this.app.modelManager.activeModel();
                            this.app.modelManager.activateModel(this.app.selectedModel);
                            this.app.modelManager.showListModel(this.app.recentModels);
                        }
                        this.app.singleRun = false;
                    }

                    if (this.app.pathUrl !== null && this.app.pathUrl !== '' && this.app.conversations.length > parseInt(this.app.currentConversationIndex)) {
                        if (this.app.isFetching == false && this.app.activateSelectMode == false && this.app.oneTimeLoad2) {
                            this.app.oneTimeLoad2 = false;
                            if (this.app.chatHistoryManager) await this.app.chatHistoryManager.loadConversation(parseInt(this.app.currentConversationIndex), false);
                        }
                        if (this.app.modelManager) this.app.modelManager.setActiveChat(parseInt(this.app.currentConversationIndex));
                    }

                    if (this.app.isEnableFunctionCatch) {
                        const currentText = window.editorManager?.editor?.getValue() || '';
                        this.app.currentFunc_List = typeof window.collectFunctionNames === 'function' ? window.collectFunctionNames(currentText) : [];
                        
                        // Trigger UI update immediately when modal opens
                        if (this.app.chatInputUI) {
                            this.app.chatInputUI.updateFunctionSuggestions(this.app.currentFunc_List);
                        }
                    }           
                }

                if (this.app.settingFuncNiddle == 'by_gpt_icon' && this.app.settingsUI) this.app.settingsUI.initAllSettings();

                if (typeof this.app.titleshowincase === 'function') await this.app.titleshowincase();
                if (this.app.authManager) await this.app.authManager.toggleChatModal();
                
                if(ChatUI.spinGPTICON) ChatUI.spinGPTICON(false);

                const settings = window.acode ? window.acode.require('settings') : null;
                let gptSlowWave = document.querySelectorAll('.gpt-slowwave-touch');
                let gptFastWave = document.querySelectorAll('.gpt-fastwave-touch');

                if (settings && settings.value.appTheme) {
                    let color = settings.value.appTheme === 'light' ? '#00000022' : settings.value.appTheme === 'oled' ? '#2b20c836' : '#7e7e7e36';
                    [...gptSlowWave, ...gptFastWave].forEach(el => el.style.backgroundColor = color);
                }
            }); 
        }

        const newChatBtn = document.getElementById('new-chat-button');
        if (newChatBtn) newChatBtn.addEventListener('click', async () => { if (this.app.chatHistoryManager) await this.app.chatHistoryManager.startNewConversation(); });

        if (this.app.moreButton) {
            this.app.moreButton.addEventListener('click', () => {
                if (typeof ChatUI.gptFastWaveEffect === 'function') ChatUI.gptFastWaveEffect(this.app.optimize, window.appSettings?.value?.animation);
                if (this.app.modelListElement) this.app.modelListElement.classList.remove('active');
                
                if (this.app.moreButtonDiv && this.app.moreButtonDiv.textContent === "More GPT's") {
                    this.app.recentModels = this.app.allModels;
                    if (this.app.modelListElement) this.app.modelListElement.innerHTML = '';
                    if (this.app.modelManager?.expandModelListFull) {
                        this.app.modelManager.expandModelListFull();
                    } else if (this.app.modelListElement) {
                        this.app.modelListElement.style.height = '30vh';
                        this.app.modelListElement.style.overflow = 'scroll';
                        if (this.app.moreButtonDiv) this.app.moreButtonDiv.textContent = "Hide GPT's";
                        if (this.app.listHistory) this.app.listHistory.style.height = '70vh';
                    }
                    if (this.app.modelManager) this.app.modelManager.showListModel(this.app.allModels);
                } else {
                    if (this.app.modelManager) this.app.modelManager.activeModel();
                    if (this.app.modelListElement) this.app.modelListElement.innerHTML = '';
                    if (this.app.modelManager?.collapseModelListToRow) {
                        this.app.modelManager.collapseModelListToRow();
                    } else {
                        if (this.app.moreButtonDiv) this.app.moreButtonDiv.textContent = "More GPT's";
                        if (this.app.modelListElement) {
                            this.app.modelListElement.style.height = '60px';
                            this.app.modelListElement.style.overflow = 'hidden';
                        }
                        if (this.app.listHistory) this.app.listHistory.style.height = '75vh';
                    }
                    if (this.app.modelManager) this.app.modelManager.showListModel(this.app.recentModels);
                }
            });
        }

        const gptModalOverlay = document.querySelector('.gpt-modal-overlay');
        const sidebarToggle = document.getElementById('gpt-sidebar-toggle');
        if (sidebarToggle && gptModalOverlay) {
            sidebarToggle.addEventListener('click', () => {
                const gptChatHist = document.querySelector('#gpt-chats-history li');
                if (this.app.pathUrl === null || this.app.pathUrl === '') {
                    if (gptChatHist == null) {
                        const chatHistoryElement = document.querySelector('#gpt-chats-history');
                        if(chatHistoryElement) chatHistoryElement.innerHTML = '<li class="active">New Chat</li>'; 
                    } else gptChatHist.classList.add('active');
                }
                
                if (this.app.modelManager) this.app.modelManager.setActiveChat(parseInt(this.app.currentConversationIndex));
                gptModalOverlay.style.transform = 'translateX(0)';

                if (this.app.settingFuncNiddle == 'by_setting_icon' && this.app.settingsUI) this.app.settingsUI.initAllSettings();
                
                if (typeof ChatUI.gptSlowWaveEffect === 'function') ChatUI.gptSlowWaveEffect(this.app.optimize, window.appSettings?.value?.animation);
                if (typeof ChatUI.gptFastWaveEffect === 'function') ChatUI.gptFastWaveEffect(this.app.optimize, window.appSettings?.value?.animation);
                if (this.app.appUIManager && typeof this.app.appUIManager.addCollapseChatHistory === 'function') this.app.appUIManager.addCollapseChatHistory();
            });

            gptModalOverlay.addEventListener("click", async (e) => {
                if (e.target === gptModalOverlay) {
                    gptModalOverlay.style.transform = 'translateX(-100%)';
                    if (this.app.chatRenderer && typeof this.app.chatRenderer.pushTitle === 'function') await this.app.chatRenderer.pushTitle(null);
                    
                    let osm = document.querySelector('.ollama-selected-model'); 
                    if(osm) osm.innerText = ConfigManager.get('ollamaPrimaryModel') || 'Powered By Ollama';
                }
            });
        }

        if (this.app.settingsUI) this.setupThreeDotMenu();
        if (this.app.settingsUI && typeof this.app.settingsUI.setupSettingsToggle === 'function') this.app.settingsUI.setupSettingsToggle();
        if (this.app.storageManager && typeof this.app.storageManager.initializeInfoSection === 'function') await this.app.storageManager.initializeInfoSection();
        if (typeof this.app.titleshowincase === 'function') await this.app.titleshowincase();

        this.setupVisualEffects();
        this.setupImageUpload();
    }
    
    setupThreeDotMenu() {
        const threeDOT = document.getElementById('gpt-three-dot');
        const optionsMenuRight = document.getElementById('three-dot-options');
        const viewDetails = document.getElementById('gpt-info-view-details');
        const viewDetailsBack = document.getElementById('gpt-info-page-back');
        const gptInfoRenameChat = document.getElementById('gpt-info-rename-chat');
        const gptInfoDeleteChat = document.getElementById('gpt-info-delete-chat');
        const chatBox = document.getElementById('chat-box');
        const inpContainer = document.getElementById('input-container');
        const infoPage = document.getElementById('gpt-info-page');
        const settingPage = document.getElementById('gpt-setting-page');

        if (!threeDOT || !optionsMenuRight) return;

        threeDOT.addEventListener('click', (e) => {
            e.stopPropagation();
            if (optionsMenuRight.style.display === 'none' || optionsMenuRight.style.display === '') {
                optionsMenuRight.style.display = 'block';
            } else {
                optionsMenuRight.style.display = 'none';
            }
        });

        document.addEventListener('click', (event) => {
            if (!threeDOT.contains(event.target) && !optionsMenuRight.contains(event.target)) {
                optionsMenuRight.style.display = 'none';
            }
        });

        if (viewDetails) {
            viewDetails.addEventListener('click', () => {
                optionsMenuRight.style.display = 'none';
                if (chatBox) chatBox.style.display = 'none';
                if (inpContainer) inpContainer.style.display = 'none';
                if (infoPage) infoPage.style.display = 'flex';
                if (threeDOT) threeDOT.style.display = 'none';
                if (settingPage) settingPage.style.display = 'none';
                if (viewDetailsBack) viewDetailsBack.style.display = 'block';

                let gptInfopageModelName = document.querySelector('#gpt-info-page-container #gpt-infopage-model-name');
                let gptModelInfo = document.querySelector('#gpt-model-info');
                let gptModelCapbility = document.querySelector('#gpt-model-capability');
                let gptInfoPageImageBg = document.querySelector('#gpt-info-page-image-bg');

                if (this.app.selectedModel) {
                    if (gptInfopageModelName) gptInfopageModelName.innerHTML = this.app.selectedModel.name;
                    if (gptModelInfo) gptModelInfo.innerHTML = this.app.selectedModel.info;
                    if (gptModelCapbility) gptModelCapbility.innerHTML = this.app.selectedModel.capability;
                    
                    if (gptInfoPageImageBg) {
                        if (this.app.selectedModel.image.startsWith('<svg')) {
                            gptInfoPageImageBg.innerHTML = this.app.selectedModel.image;
                        } else {
                            gptInfoPageImageBg.innerHTML = `<img src="${this.app.selectedModel.image}" alt="Image" style="max-width: 90%;">`;
                        }
                        gptInfoPageImageBg.style.backgroundColor = this.app.selectedModel.image_bg;
                    }
                }
            });
        }

        if (gptInfoRenameChat) {
            gptInfoRenameChat.addEventListener('click', async () => {
                optionsMenuRight.style.display = 'none';
                if (this.app.chatHistoryManager) {
                    await this.app.chatHistoryManager.renameConversationListHistory(this.app.currentConversationIndex);
                }
            });
        }

        if (gptInfoDeleteChat) {
            gptInfoDeleteChat.addEventListener('click', async () => {
                optionsMenuRight.style.display = 'none';
                if (this.app.conversations && this.app.conversations.length !== 1) {
                    if (this.app.chatHistoryManager) {
                        await this.app.chatHistoryManager.deleteConversationListHistory(parseInt(this.app.currentConversationIndex));
                        await this.app.chatHistoryManager.startNewConversation();
                    }
                } else {
                    window.toast('Cannot be deleted!');
                    this.app.currentConversationIndex = '0';
                    ConfigManager.set('current_chat_index', '0');
                }
            });
        }
    }


    setupVisualEffects() {
        const lightenColor = (hex, percent) => {
            const num = parseInt(hex.slice(1), 16), amt = Math.round(2.55 * percent), R = (num >> 16) + amt, G = (num >> 8 & 0x00FF) + amt, B = (num & 0x0000FF) + amt;
            return `#${(0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1)}`;
        };
        const rootStyle = getComputedStyle(document.documentElement);
        const primaryTextColor = rootStyle.getPropertyValue('--primary-text-color').trim();
        if (primaryTextColor.startsWith('#')) {
            const lighterColor = lightenColor(primaryTextColor, 30);
            document.querySelectorAll('#gpt-chat-more li').forEach(item => item.style.borderBottomColor = lighterColor);
        }
        let rippleInterval;
        const createRipple = (event, element) => {
            const rect = element.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, ripple = document.createElement('span');
            ripple.classList.add('ripple');
            ripple.style.width = ripple.style.height = Math.max(rect.width, rect.height) + 'px';
            ripple.style.left = `${x - ripple.offsetWidth / 2}px`; ripple.style.top = `${y - ripple.offsetHeight / 2}px`;
            element.appendChild(ripple);
            setTimeout(() => ripple.remove(), 1000);
        };
        const handleSingleClick = (event) => createRipple(event, event.currentTarget);
        const stopContinuousRipple = () => clearInterval(rippleInterval);
        const applyRipples = (selector) => {
            document.querySelectorAll(selector).forEach(item => {
                item.addEventListener('touchstart', handleSingleClick);
                item.addEventListener('touchend', stopContinuousRipple); 
            });
        };
        applyRipples('#gpt-chat-more li'); applyRipples('#gpt-chats-history li'); applyRipples('.gpt-message');
    }

    // File Preview UI Generator
    renderFilePreviews() {
        const previewContainer = document.getElementById('previewContainer');
        if (!previewContainer) return;
        
        previewContainer.innerHTML = '';
        previewContainer.style.display = 'flex';
        previewContainer.style.flexWrap = 'nowrap';
        previewContainer.style.position = 'absolute';
        previewContainer.style.left = '0';
        previewContainer.style.right = '0';
        previewContainer.style.bottom = '110px';
        previewContainer.style.overflowX = 'auto';
        previewContainer.style.overflowY = 'visible';
        previewContainer.style.height = 'auto';
        previewContainer.style.minHeight = '0';
        previewContainer.style.gap = '5px';
        previewContainer.style.marginTop = '0';
        previewContainer.style.padding = '8px 4px 4px';
        previewContainer.style.alignItems = 'flex-start';
        previewContainer.style.background = 'transparent';
        previewContainer.style.border = 'none';
        previewContainer.style.boxShadow = 'none';
        previewContainer.style.zIndex = '50';
        previewContainer.style.pointerEvents = 'none';
        previewContainer.style.webkitOverflowScrolling = 'touch';
        try {
          const input = document.getElementById('input-container');
          if (input) {
            if (getComputedStyle(input).position === 'static') input.style.position = 'relative';
            input.style.overflow = 'visible';
          }
        } catch (_) {}
        
        (this.app.attachedFiles || []).forEach((file, index) => {
            const isImage = file.type === 'image';
            const finalContainer = document.createElement('div');
            finalContainer.className = isImage ? 'gpt-image-preview-container' : 'gpt-file-chip';
            const pad = isImage ? '4px 10px' : '6px 10px';
            finalContainer.style = `position:relative; display:inline-flex; align-items:center; background:var(--secondary-color, rgba(0,0,0,0.2)); border:1px solid var(--border-color, #444); border-radius:8px; padding:${pad}; gap:8px; margin:0 2px; flex-shrink:0; pointer-events:auto; box-shadow:0 2px 8px rgba(0,0,0,0.25);`;
            
            let iconOrImg = '';
            if (isImage) {
                iconOrImg = `<img src="${file.data}" style="width:28px; height:28px; object-fit:cover; border-radius:4px;">`;
            } else {
                iconOrImg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--active-text-color, #4b5dd1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
            }
            
            finalContainer.innerHTML = `
                ${iconOrImg}
                <span style="font-size:12px; color:var(--primary-text-color); max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name}</span>
            `;
            
            const closeButton = document.createElement('button');
            closeButton.innerHTML = '&times;';
            closeButton.className = 'gpt-close-btn';
            closeButton.style = 'position:absolute; top:-8px; right:-8px; background:#f44336; color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 5px rgba(0,0,0,0.3);';
            closeButton.onclick = () => { 
                this.app.attachedFiles.splice(index, 1);
                this.renderFilePreviews();
            };
            
            finalContainer.appendChild(closeButton);
            previewContainer.appendChild(finalContainer);
        });
        try {
            import('./chatInput/PasteChips.js').then(m => {
              m.renderPasteChips?.(this.app);
              m.syncChatBoxForChips?.();
              m.updatePreviewContainerBottom?.();
            }).catch(() => {});
        } catch (_) {}
    }

    // Handles Multiple Images & Text Files
    setupImageUpload() {
        const fileInput = document.getElementById('file-input');
        if (!fileInput) return;
        
        if(!this.app.attachedFiles) this.app.attachedFiles = [];
        
        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            const previewContainer = document.getElementById('previewContainer');
            if (previewContainer && this.app.attachedFiles.length === 0) {
                previewContainer.innerHTML = '<div style="font-size:11px; color:var(--secondary-text-color); padding:5px;">Processing files...</div>'; 
            }

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const isImage = file.type.startsWith('image/');
                
                if (isImage) {
                    const imageUrl = URL.createObjectURL(file);
                    let base64Image = null;
                    if (typeof ImageHandler !== 'undefined' && typeof ImageHandler.blobToCompressedBase64 === 'function') {
                        base64Image = await ImageHandler.blobToCompressedBase64(imageUrl);
                    }
                    this.app.attachedFiles.push({ type: 'image', name: file.name, data: base64Image });
                } else {
                    // Local File Parsing for Texts/Codes
                    const textData = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.readAsText(file);
                    });
                    this.app.attachedFiles.push({ type: 'text', name: file.name, data: textData });
                }
            }
            
            fileInput.value = ''; // clear input for next selection
            this.renderFilePreviews();
        });
    }
}