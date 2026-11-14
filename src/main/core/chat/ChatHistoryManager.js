// src/main/core/chat/ChatHistoryManager.js
import { Formatter } from '../../utils/Formatter.js';
import { HistoryFileOps } from '../../history/HistoryFileOps.js';
import { HistoryListUI } from '../../ui/HistoryListUI.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { resolveApiModelId } from '../../utils/ResolveModelId.js';
import { scheduleResumeBannerCheck } from '../../ui/ResumeBanner.js';  

export class ChatHistoryManager {
    constructor(pluginContext) {
        this.app = pluginContext; 
    }

    async addMessageToHistory(role, content, title, hiddenContext = null, skipSave = false, skipRender = false, agentActions = null, targetConversationIndex = null) {
        // content may be a plain string (legacy) OR a structured message object from MessageSchema
        const isStructured = content && typeof content === 'object' && !Array.isArray(content) && ('type' in content || 'image' in content);
        const textForEmptyCheck = isStructured ? (content.content || '') : (typeof content === 'string' ? content : '');
        const hasParts = isStructured && Array.isArray(content.parts) && content.parts.length > 0;
        // Do not drop assistant turns that only have parts (or agentActions / image)
        if (role === 'assistant'
            && !String(textForEmptyCheck).trim()
            && (!agentActions || agentActions.length === 0)
            && !(isStructured && content.image)
            && !hasParts) return;

        if (this.app._isMessageTransactionActive) skipSave = true;

        if (role === 'user' && !this.app.currentConversation) {
            const chatId = this.app.storageManager?.generateChatId() || Date.now().toString();
            
            // 🟢 Pass the default tools to new chats based on current input
            const defaultToolStates = {
                web: this.app.chatInputUI?.states?.web || false,
                think: this.app.chatInputUI?.states?.think || false,
                agent: this.app.chatInputUI?.states?.agent || false,
                study: this.app.chatInputUI?.states?.study || false,
                selectedText: this.app.chatInputUI?.states?.selectedText || false
            };

            this.app.currentConversation = { id: chatId, title: "New Chat", chat: [], model: this.app.selectedModel, date: Formatter.getFormattedDate(), lastUpdated: Date.now(), toolStates: defaultToolStates };
            this.app.conversations.push(this.app.currentConversation);
        } else if (role === 'assistant') {
            // Title applied to target conv in push block below (supports background owner)
            if (title) this.app.gptTitle = title;
        }

        let message;
        if (isStructured) {
            message = { role, ...content };
            // Ensure role wins if caller put a different role inside the object
            message.role = role;
            if (hiddenContext != null && message.hidden_context == null) message.hidden_context = hiddenContext;
            if (agentActions && !message.agentActions) message.agentActions = agentActions;
            // Array custom props (_durationSec) die in JSON.stringify — store on message
            if (agentActions && agentActions._durationSec != null) {
                message.agentDurationSec = agentActions._durationSec;
                message.durationSec = agentActions._durationSec;
            }
        } else {
            message = { role, type: 'text', content: content };
            if (hiddenContext) message.hidden_context = hiddenContext;
            if (agentActions) message.agentActions = agentActions;
            if (agentActions && agentActions._durationSec != null) {
                message.agentDurationSec = agentActions._durationSec;
                message.durationSec = agentActions._durationSec;
            }
        }

        // Metadata for footers (time / model / key)
        if (!message.createdAt) message.createdAt = Date.now();
        if (role === 'assistant' && !message.completedAt) message.completedAt = Date.now();
        if (role === 'user' && message.charCount == null) {
            const t = typeof message.content === 'string'
                ? message.content
                : (Array.isArray(message.content)
                    ? (message.content.find(x => x.type === 'text')?.text || '')
                    : String(message.content || ''));
            message.charCount = t.length;
        }
        if (role === 'assistant') {
            const sm = this.app.selectedModel || {};
            const type = String(sm.type || '').toLowerCase();
            const pickSlug = (...cands) => {
                for (const c of cands) {
                    if (!c) continue;
                    const s = String(c).trim();
                    if (!s) continue;
                    if (type && s.toLowerCase() === type) continue;
                    if (['openrouter', 'openai', 'gemini', 'mistral', 'deepseek', 'ollama', 'anthropic'].includes(s.toLowerCase())) continue;
                    return s;
                }
                return '';
            };
            if (!message.modelId || ['openrouter','openai','gemini','mistral','deepseek','ollama'].includes(String(message.modelId).toLowerCase())) {
                message.modelId = resolveApiModelId(this.app, message) || pickSlug(sm.model, this.app.lastSelectedModel, sm.id, sm.name) || sm.model || '';
            }
            if (!message.modelName) {
                message.modelName = sm.name || message.modelId || '';
            }
            if (!message.apiKeyLabel) {
                try {
                    message.apiKeyLabel = this.app.modelManager?.getActiveKeyLabel?.(sm.type)
                        || this.app._lastApiKeyLabel
                        || '';
                } catch (_) {
                    message.apiKeyLabel = this.app._lastApiKeyLabel || '';
                }
            }
            if (!message.provider) {
                message.provider = sm.type || '';
            }
            try {
                const pending = this.app._pendingVariants;
                if (pending && Array.isArray(pending.variants)) {
                    const snap = {
                        content: message.content,
                        parts: message.parts || null,
                        modelId: message.modelId,
                        modelName: message.modelName,
                        provider: message.provider,
                        agentActions: message.agentActions || null,
                        createdAt: message.createdAt || Date.now()
                    };
                    message.variants = [...pending.variants, snap];
                    message.activeVariant = message.variants.length - 1;
                    this.app._pendingVariants = null;
                }
            } catch (_) {}
        }

        // Persist mode + markdown heading preference for re-render
        if (role === 'assistant' && message.responseMode == null) {
            if (this.app.isEnableAgentMode) message.responseMode = 'agent';
            else if (this.app.isEnableStudyMode) message.responseMode = 'study';
            else message.responseMode = 'normal';
        }
        if (role === 'assistant' && message.collapseMarkdownHeaders == null) {
            let style = 'collapsible';
            try {
                if (this.app.settingsStore?.get) {
                    style = this.app.settingsStore.get('markdownHeadingStyle', 'collapsible') || 'collapsible';
                } else {
                    const v = ConfigManager.get('markdownHeadingStyle');
                    if (v && v !== 'null') style = String(v);
                }
            } catch (_) {}
            message.collapseMarkdownHeaders = style !== 'normal';
        }

        // Prefer explicit owner chat (background generation) over whatever is on screen
        let targetConv = this.app.currentConversation;
        if (targetConversationIndex != null && targetConversationIndex !== '') {
            const idx = parseInt(targetConversationIndex, 10);
            if (!Number.isNaN(idx) && this.app.conversations?.[idx]) {
                targetConv = this.app.conversations[idx];
            }
        }
        if (targetConv) {
            // Mid-chat regenerate: insert assistant at the turn slot, keep later messages
            const insertAt = this.app._pendingInsertAt;
            if (role === 'assistant' && insertAt != null && Number.isFinite(insertAt)
                && insertAt >= 0 && insertAt <= targetConv.chat.length) {
                targetConv.chat.splice(insertAt, 0, message);
                this.app._pendingInsertAt = null;
            } else if (role === 'assistant') {
                // Insert before trailing event rows so order is user → assistant → events
                let at = targetConv.chat.length;
                while (at > 0 && targetConv.chat[at - 1]?.role === 'event') at--;
                if (at < targetConv.chat.length) targetConv.chat.splice(at, 0, message);
                else targetConv.chat.push(message);
                this.app._pendingInsertAt = null;
            } else {
                targetConv.chat.push(message);
            }
            targetConv.date = Formatter.getFormattedDate();
            targetConv.lastUpdated = Date.now();
            if (role === 'assistant' && title) {
                targetConv.title = title;
            } else if (role === 'assistant' && (!targetConv.title || targetConv.title === 'New Chat')) {
                targetConv.title = this.app.gptTitle || targetConv.title || 'New Chat';
            }
        }

        // Only mirror into app.chatHistory when viewing the owner chat
        const viewingOwner = targetConversationIndex == null
            || String(this.app.currentConversationIndex) === String(targetConversationIndex);
        if (viewingOwner) {
            this.app.currentConversation = targetConv || this.app.currentConversation;
            this.app.chatHistory = this.app.currentConversation ? [...this.app.currentConversation.chat] : [];
        }

        if (!viewingOwner) {
            // Background chat finished while user is elsewhere — sidebar only
            try {
                if (typeof HistoryListUI !== 'undefined' && HistoryListUI.renderSidebarList) {
                    await HistoryListUI.renderSidebarList(this.app);
                }
            } catch (_) {}
        } else if (!skipRender) {
            await this.renderChatHistory(false, skipSave);
        } else {
            // Live turn already painted — only refresh sidebar title/list, no wipe+rebuild
            try {
                if (typeof HistoryListUI !== 'undefined' && HistoryListUI.renderSidebarList) {
                    await HistoryListUI.renderSidebarList(this.app);
                }
            } catch (_) {}
        }
        if (!skipSave) await HistoryFileOps.saveActiveChat(this.app);
    }

    async renderChatHistory(isRenderChat = false, skipSidebar = false) {
        if (!skipSidebar && typeof HistoryListUI !== 'undefined' && HistoryListUI.renderSidebarList) {
            await HistoryListUI.renderSidebarList(this.app); 
        }
        if (!isRenderChat && this.app.chatHistory?.length !== 0 && !this.app.activateSelectMode) {
            await this.app.chatRenderer?.renderChat();
        }
    }

    async renameConversationListHistory(index) {
        const conv = this.app.conversations[index];
        if (!conv) return;

        const currentTitle = conv.title || '';

        // Prefer reusable themed dialog + input (no window.prompt)
        try {
            const { openUiDialog } = await import('../../ui/components/UiDialog.js');
            const { createInput } = await import('../../ui/components/UiField.js');

            const field = createInput({
                id: 'gpt-rename-chat-title',
                label: 'Chat title',
                placeholder: 'Enter a title',
                value: currentTitle,
                maxLength: 120
            });

            await new Promise((resolve) => {
                openUiDialog({
                    title: 'Rename chat',
                    body: field.root,
                    confirmText: 'Save',
                    cancelText: 'Cancel',
                    onConfirm: async () => {
                        const newTitle = (field.getValue() || '').trim();
                        if (!newTitle) {
                            window.toast?.('Title cannot be empty');
                            return false;
                        }
                        if (newTitle === currentTitle) return true;
                        conv.title = newTitle;
                        await HistoryFileOps.renameChatFiles(this.app, conv);
                        await this.renderChatHistory();
                        return true;
                    },
                    onCancel: () => resolve()
                });
                // Focus + select existing title
                setTimeout(() => {
                    try {
                        field.input.focus();
                        field.input.select();
                    } catch (_) {}
                }, 50);
                // Resolve when dialog is gone (best-effort)
                const obs = new MutationObserver(() => {
                    if (!document.getElementById('gpt-ui-dialog-overlay')) {
                        obs.disconnect();
                        resolve();
                    }
                });
                obs.observe(document.body, { childList: true });
            });
            return;
        } catch (e) {
            console.warn('[ChatHistoryManager] UiDialog rename failed, fallback prompt', e);
        }

        const newTitle = prompt('Enter new title:', currentTitle);
        if (newTitle && newTitle.trim()) {
            conv.title = newTitle.trim();
            await HistoryFileOps.renameChatFiles(this.app, conv);
            await this.renderChatHistory();
        }
    }

    async deleteConversationListHistory(index) {
        let intIndex = parseInt(index);
        const convToDelete = this.app.conversations[intIndex];

        if (this.app.conversations.length === 1) {
            this.app.currentConversationIndex = '0';
            ConfigManager.set('current_chat_index', '0');
        }

        await HistoryFileOps.deleteChatFiles(this.app, convToDelete); 
        this.app.conversations.splice(intIndex, 1);

        if(this.app.conversations.length === 0) {
            await this.startNewConversation();
        } else {
            let currentIndex = parseInt(this.app.currentConversationIndex);
            if (intIndex === currentIndex) {
                let newIndex = 0; 
                this.app.currentConversationIndex = newIndex.toString();
                if(this.app.pathUrl) ConfigManager.set('current_chat_index', newIndex.toString());
                
                await this.loadConversation(newIndex, false);
            } else if (intIndex < currentIndex) {
                currentIndex--;
                this.app.currentConversationIndex = currentIndex.toString();
                if(this.app.pathUrl) ConfigManager.set('current_chat_index', currentIndex.toString());
            }
            await this.renderChatHistory();
        }
    }

    async deleteMessage(index) {
        let currentIndex = parseInt(this.app.currentConversationIndex);
        if (this.app.conversations[currentIndex]) {
            const msgsToDelete = this.app.conversations[currentIndex].chat.slice(index);
            this.app.conversations[currentIndex].chat.splice(index, msgsToDelete.length);
        }
        this.app.chatHistory = this.app.currentConversation ? [...this.app.currentConversation.chat] : [];
        await HistoryFileOps.saveActiveChat(this.app);
        await this.renderChatHistory();
    }

    /** Keep messages [0..userIdx], drop everything after (for edit). */
    async deleteMessagesAfter(userIdx) {
        const currentIndex = parseInt(this.app.currentConversationIndex);
        const conv = this.app.conversations[currentIndex];
        if (!conv?.chat) return;
        const i = Math.max(0, parseInt(userIdx, 10));
        if (i + 1 < conv.chat.length) {
            conv.chat.splice(i + 1);
        }
        this.app.chatHistory = [...conv.chat];
        await HistoryFileOps.saveActiveChat(this.app);
        await this.renderChatHistory();
    }

    /**
     * Remove only the assistant turn after userIdx (until next user).
     * Leaves later user/assistant pairs intact — regenerate variant stays local to that turn.
     * Returns insert index for the new assistant.
     */
    async deleteAssistantTurnOnly(userIdx) {
        const currentIndex = parseInt(this.app.currentConversationIndex);
        const conv = this.app.conversations[currentIndex];
        if (!conv?.chat) return userIdx + 1;
        const i = Math.max(0, parseInt(userIdx, 10));
        let end = i + 1;
        while (end < conv.chat.length && conv.chat[end]?.role !== 'user') end++;
        if (end > i + 1) {
            conv.chat.splice(i + 1, end - (i + 1));
        }
        this.app.chatHistory = [...conv.chat];
        await HistoryFileOps.saveActiveChat(this.app);
        await this.renderChatHistory();
        return i + 1;
    }

    /** Delete from userIdx inclusive (edit → remove prompt + responses, put text in input). */
    async deleteFrom(userIdx) {
        return this.deleteMessage(userIdx);
    }

    async loadConversation(index, isRenderChat = true) {
        try {
            const { ChatUI } = await import('../../ui/ChatUI.js');
            ChatUI.exitSelectTextMode(this.app);
        } catch (_) { this.app.activateSelectMode = false; }

        this.app.currentConversationIndex = index.toString();
        if (this.app.pathUrl) ConfigManager.set('current_chat_index', index);

        const conversation = this.app.conversations[index];
        this.app.currentConversation = conversation;

        if (conversation) {
            this.app.isTitle = conversation.title;
            this.app.chatHistory = [...conversation.chat];
            
            const gptTopTitle = document.querySelector('#gpt-top-title');
            if (gptTopTitle) {
                const raw = (conversation.title && conversation.title !== 'New Chat')
                    ? conversation.title
                    : (conversation.model?.name || 'New Chat');
                try { gptTopTitle.innerHTML = Formatter.formatChatTitleHtml(raw); }
                catch (_) { gptTopTitle.textContent = Formatter.formatChatTitlePlain(raw); }
            }

            // 🟢 PRO FIX: Trigger Tool UI Sync! Updates badges and states per specific chat memory!
            if (this.app.chatInputUI && typeof this.app.chatInputUI.syncWithConversation === 'function') {
                this.app.chatInputUI.syncWithConversation();
            }
        }

        if (this.app.chatHistory?.length !== 0) {
            if (this.app.chatRenderer) await this.app.chatRenderer.renderChat();
        } else {
            this.app.chatBox = document.getElementById('chat-box');
            if (this.app.chatBox) {
                this.app.chatBox.innerHTML = '';
                this.app.isTitle = null;
                this.app.gptTitle = null;
            }
            if (this.app.storageManager) await this.app.storageManager.initializeInfoSection();
        }

        // If a generation is still running for THIS chat, re-attach its live DOM
        try {
            this.app.chatHandler?.reattachTurnIfOwner?.(index);
        } catch (_) {}

        try { scheduleResumeBannerCheck(this.app, 400); } catch (_) {}
    }

    async startNewConversation(model = this.app.selectedModel, isStartup = false) {
        if (this.app.chatHandler?.handleStopFetching) await this.app.chatHandler.handleStopFetching();
        
        let blankIndex = -1;
        for (let i = 0; i < this.app.conversations.length; i++) {
            if (!this.app.conversations[i].chat || this.app.conversations[i].chat.length === 0) { blankIndex = i; break; }
        }

        if (blankIndex !== -1) {  
            this.app.conversations[blankIndex].model = model;
            // Set active chat id BEFORE UI so workspace picker binds to THIS chat, not the previous one
            this.app.currentConversationIndex = blankIndex.toString();
            try {
                const { ConfigManager } = await import('../../utils/ConfigManager.js');
                ConfigManager.set('current_chat_index', blankIndex.toString());
            } catch (_) {}
            // Empty chat: do not keep another chat's workspace selection on this index
            try {
                const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
                ProjectWorkspace.saveAll(blankIndex, []);
            } catch (_) {}
            await this.loadConversation(blankIndex);
            await this.renderChatHistory(true); 
            
            if (this.app.modelManager?.setActiveChat) this.app.modelManager.setActiveChat(blankIndex);
            if (this.app.modelManager) await this.app.modelManager.handleModelClick(model);
            try {
                this.app.chatInputUI?.updateActiveBadges?.();
                this.app.chatInputUI?.syncWithConversation?.();
            } catch (_) {}
        } else { 
            this.app.currentConversationIndex = this.app.conversations.length.toString();
            try {
                const { ConfigManager } = await import('../../utils/ConfigManager.js');
                ConfigManager.set('current_chat_index', this.app.currentConversationIndex);
            } catch (_) {}
            this.app.chatBox = document.getElementById('chat-box');
            if (this.app.chatBox) {
                this.app.chatBox.innerHTML = '';
                this.app.isTitle = null;     
                this.app.gptTitle = null;
            }

            const gptTopTitle = document.querySelector('#gpt-top-title');
            if (gptTopTitle) try { gptTopTitle.innerHTML = Formatter.formatChatTitleHtml(model.name); } catch (_) { gptTopTitle.textContent = Formatter.formatChatTitlePlain(model.name); }

            const formattedDate = Formatter.getFormattedDate();
            const chatId = this.app.storageManager ? this.app.storageManager.generateChatId() : Date.now().toString();

            // 🟢 Inherit whatever tools are currently on as the starting point for a new chat
            const defaultToolStates = {
                web: this.app.chatInputUI?.states?.web || false,
                think: this.app.chatInputUI?.states?.think || false,
                agent: this.app.chatInputUI?.states?.agent || false,
                study: this.app.chatInputUI?.states?.study || false,
                selectedText: this.app.chatInputUI?.states?.selectedText || false
            };

            this.app.currentConversation = { id: chatId, title: "New Chat", chat: [], model: model, date: formattedDate, lastUpdated: Date.now(), toolStates: defaultToolStates };
            this.app.conversations.push(this.app.currentConversation);
            this.app.chatHistory = [];

            // New chat index must not inherit another chat's workspace list
            try {
                const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
                ProjectWorkspace.saveAll(this.app.currentConversationIndex, []);
            } catch (_) {}
            try {
                const { ConfigManager } = await import('../../utils/ConfigManager.js');
                ConfigManager.set('current_chat_index', this.app.currentConversationIndex);
            } catch (_) {}

            // 🟢 Sync State to render proper badges
            if (this.app.chatInputUI && typeof this.app.chatInputUI.syncWithConversation === 'function') {
                this.app.chatInputUI.syncWithConversation();
            }
            try { this.app.chatInputUI?.updateActiveBadges?.(); } catch (_) {}

            await this.renderChatHistory(true);

            if (this.app.modelManager?.setActiveChat) this.app.modelManager.setActiveChat(parseInt(this.app.currentConversationIndex));
            if (this.app.storageManager) await this.app.storageManager.initializeInfoSection();
            if (this.app.modelManager) await this.app.modelManager.handleModelClick(model);
            
            if (!isStartup) window.toast('New Chat', 2000);
        }
    }

    updateCurrentConversationIndex() {}
}