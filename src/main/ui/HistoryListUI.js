import { ChatUI } from './ChatUI.js';
import { Formatter } from '../utils/Formatter.js'; 
import {ConfigManager} from '../utils/ConfigManager.js'; 

export class HistoryListUI {
    static async renderSidebarList(app) {
        if (!app.conversations) return;
        
        // 🟢 PRO FIX: Filter out empty chats (Hide "New Chat" until a message is sent)
        // And keep track of the original index for correct highlighting
        let renderList = app.conversations
            .map((conv, i) => ({ conversation: conv, originalIndex: i }))
            .filter(item => item.conversation.chat && item.conversation.chat.length > 0);

        // 🟢 PRO FIX: Sort by 'lastUpdated' timestamp (Last message sent priority)
        renderList.sort((a, b) => {
            const timeA = a.conversation.lastUpdated || parseInt(a.conversation.id) || 0;
            const timeB = b.conversation.lastUpdated || parseInt(b.conversation.id) || 0;
            return timeB - timeA; // Descending: Newest message comes first!
        });

        let lastGroupLabel = '';
        const chatHistoryElement = document.getElementById('gpt-chats-history');
        if (!chatHistoryElement) return;
        
        chatHistoryElement.innerHTML = '';
        let lastClickedConversationIndex = app.currentConversationIndex !== null ? parseInt(app.currentConversationIndex) : null;

        renderList.forEach(({ conversation, originalIndex }) => {
            if (conversation.hasStreamed === undefined) conversation.hasStreamed = false;
            
            // Group label based on the updated date
            const groupLabel = Formatter.getConversationGroupLabel ? Formatter.getConversationGroupLabel(conversation.date) : "Recent";

            if (groupLabel !== lastGroupLabel) {
                lastGroupLabel = groupLabel;
                const groupHeader = document.createElement('div');
                groupHeader.className = 'gpt-history-date-heading';
                groupHeader.textContent = groupLabel;
                chatHistoryElement.appendChild(groupHeader);
            }

            const chatItem = document.createElement('li');
            
            chatItem.setAttribute('data-index', originalIndex);
            chatItem.className = `chat-item gpt-slow-wave ${originalIndex === parseInt(app.currentConversationIndex) ? 'active' : ''}`;
            
            const titleSpan = document.createElement('span');
            titleSpan.className = 'title-span';
            const bubbleSpan = document.createElement('span');
            bubbleSpan.className = 'gpt-title-bubble';

            if (originalIndex === parseInt(app.currentConversationIndex)) {
                if (typeof ChatUI !== 'undefined') ChatUI.streamTitleCharacterByCharacter(titleSpan, conversation.title, bubbleSpan);
                conversation.hasStreamed = true;
            } else {
                const plain = Formatter.formatChatTitlePlain(conversation.title || '');
                const clipped = plain.length > 60 ? plain.substring(0, 60) + '...' : plain;
                titleSpan.innerHTML = Formatter.formatChatTitleHtml(clipped);
            }

            chatItem.appendChild(titleSpan);
            chatItem.appendChild(bubbleSpan);

            const optionsButton = document.createElement('button');
            optionsButton.textContent = '⋮';
            optionsButton.className = 'options-button';
            optionsButton.onclick = (e) => { e.stopPropagation(); if (app.popupManager) app.popupManager.showOptionsMenu(originalIndex, e); };
            chatItem.appendChild(optionsButton);

            chatItem.onclick = async () => {
                app.activateSelectMode = false;
                try {
                    const { ChatUI } = await import('./ChatUI.js');
                    ChatUI.exitSelectTextMode(app);
                } catch (_) {}

                
                let currentModel = app.conversations[originalIndex].model;
                // Keep generation running in background — only detach live DOM from the leaving chat
                if (originalIndex !== parseInt(app.currentConversationIndex)) {
                    try { app.chatHandler?.detachActiveTurnForSwitch?.(); } catch (_) {}
                }

                app.currentConversationIndex = originalIndex.toString();
                
                if (lastClickedConversationIndex !== null && lastClickedConversationIndex !== originalIndex) {
                    if (app.conversations[lastClickedConversationIndex]) {
                        app.conversations[lastClickedConversationIndex].hasStreamed = false;
                    }
                }
                lastClickedConversationIndex = originalIndex;

                app.lastSelectedModel = currentModel.model;
                app.lastSelectedModelName = currentModel.name;
                ConfigManager.set('lastSelectedModel', app.lastSelectedModel);
                ConfigManager.set('lastSelectedModelName', app.lastSelectedModelName);
                app.selectedModel = currentModel;
                try {
                    window.dispatchEvent(new CustomEvent('gpt-model-changed', {
                        detail: { modelType: currentModel?.type, source: 'history' }
                    }));
                } catch (_) {}

                await app.chatHistoryManager.loadConversation(originalIndex);

                // Stop btn only if THIS chat still has an in-flight turn
                try {
                    const turn = app._currentTurn;
                    const activeHere = turn && String(turn.conversationIndex) === String(originalIndex);
                    if (typeof ChatUI !== 'undefined') {
                        ChatUI.updateSendStopBtn(app, activeHere ? 'run' : 'stop');
                    }
                } catch (_) {}
                
                if (app.modelManager) {
                    app.modelManager.activeModel(currentModel);
                    app.modelManager.activateModel(currentModel);
                    await app.modelManager.handleModelClick(currentModel);
                    // Chat selected → collapse model wrapper to 60px (single active model row)
                    if (typeof app.modelManager.collapseModelListToRow === 'function') {
                        app.modelManager.collapseModelListToRow();
                    } else if (app.modelListElement) {
                        app.modelListElement.style.height = '60px';
                        app.modelListElement.style.maxHeight = '60px';
                        app.modelListElement.style.overflow = 'hidden';
                    }
                    app.modelManager.showListModel(app.recentModels);
                    
                    if (app.modelManager.setActiveChat) app.modelManager.setActiveChat(originalIndex);
                }

                if (!conversation.hasStreamed && typeof ChatUI !== 'undefined') {
                    titleSpan.textContent = '';
                    ChatUI.streamTitleCharacterByCharacter(titleSpan, conversation.title, bubbleSpan);
                    conversation.hasStreamed = true;
                }
            };
            chatHistoryElement.appendChild(chatItem);
        });

        if (typeof ChatUI !== 'undefined') {
            ChatUI.gptSlowWaveEffect(app.optimize, window.appSettings?.value?.animation);
        }
    }
}