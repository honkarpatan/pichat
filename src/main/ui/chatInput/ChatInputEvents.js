// src/main/ui/chatInput/ChatInputEvents.js
import { collectFunctionNames } from '../../../functions/collectFunctionNames.js';
import { icons } from '../../../data/svg.js';
import { EditorHelper } from '../../utils/editor/EditorHelper.js'; 
import { ConfigManager } from '../../utils/ConfigManager.js';
import { HistoryFileOps } from '../../history/HistoryFileOps.js';
import { ModelConfig } from '../../model/ModelConfig.js';
import { ChatInputTemplates } from './ChatInputTemplates.js';

export class ChatInputEvents {

    // 🟢 PRO FIX: Added activeValue parameter and formatting logic
    static showDropdown(anchorEl, options, onSelect, activeValue = null) {
        const existing = document.getElementById('gpt-reusable-dropdown');
        if (existing) existing.remove();

        const dropdown = document.createElement('div');
        dropdown.id = 'gpt-reusable-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            background: var(--secondary-color, #2a2a2a);
            border: 1px solid var(--border-color, rgba(255,255,255,0.1));
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            padding: 5px;
            z-index: 999999;
            min-width: 120px;
            max-height: 250px;
            overflow-y: auto;
            scrollbar-width: none;
            display: flex;
            flex-direction: column;
            gap: 2px;
            animation: gpt-slide-up-fade 0.2s cubic-bezier(0.16,1,0.3,1);
        `;

        if (!document.getElementById('gpt-dropdown-style')) {
            const style = document.createElement('style');
            style.id = 'gpt-dropdown-style';
            style.textContent = `@keyframes gpt-slide-up-fade { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }`;
            document.head.appendChild(style);
        }

        options.forEach(opt => {
            const val = opt;
            let displayLabel = String(opt);
            
            // 🟢 Remove 'models/' prefix from display if it exists
            if (displayLabel.startsWith('models/')) {
                displayLabel = displayLabel.substring(7); 
            }

            const isActive = (val === activeValue);
            const item = document.createElement('div');
            
            // Add a checkmark if this is the active item
            item.innerHTML = `<span>${displayLabel}</span> ${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}`;
            
            item.style.cssText = `
                padding: 8px 14px;
                font-size: 11px;
                color: ${isActive ? 'var(--active-text-color, #4b5dd1)' : 'var(--primary-text-color, #fff)'};
                background: ${isActive ? 'var(--active-color, rgba(75, 93, 209, 0.15))' : 'transparent'};
                cursor: pointer;
                border-radius: 6px;
                transition: background 0.2s;
                text-transform: uppercase;
                font-weight: 600;
                letter-spacing: 0.5px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
            `;
            
            item.onmouseenter = () => item.style.background = 'var(--active-color, rgba(75, 93, 209, 0.25))';
            item.onmouseleave = () => item.style.background = isActive ? 'var(--active-color, rgba(75, 93, 209, 0.15))' : 'transparent';
            
            item.onclick = (e) => {
                e.stopPropagation();
                dropdown.remove();
                onSelect(val);
            };
            dropdown.appendChild(item);
        });

        document.body.appendChild(dropdown);

        const rect = anchorEl.getBoundingClientRect();
        dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`; 
        dropdown.style.left = `${rect.left}px`;

        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => document.addEventListener('click', closeDropdown), 10);
    }

    static updateFunctionSuggestions(ui, funcList) {
        const container = document.getElementById('gpt-function-suggestions');
        if (!container) return;
        if (!funcList || funcList.length === 0 || !ui.states.catchFunction) { container.style.display = 'none'; container.innerHTML = ''; return; }
        
        container.style.display = 'flex';
        let html = '<span style="font-size:11px; font-weight:bold; color:var(--primary-text-color); display:flex; align-items:center; padding-right:6px; opacity:0.7;">⚡</span>';
        
        funcList.forEach(funcItem => {
            const funcName = typeof funcItem === 'object' && funcItem.name ? funcItem.name: funcItem;
            const funcType = typeof funcItem === 'object' && funcItem.type ? funcItem.type: 'Function';
            html += `<div class="gpt-func-chip" data-name="${funcName}" title="${funcType}" style="display:inline-flex; align-items:center; gap:4px; color:var(--primary-text-color); padding:4px 10px; font-size:11px; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='rgba(75, 93, 209, 0.3)'" onmouseout="this.style.background='rgba(75, 93, 209, 0.1)'">${icons.functionChip} ${funcName}</div>`;
        });
        
        container.innerHTML = html;
        container.querySelectorAll('.gpt-func-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const input = document.getElementById('gpt-user-input');
                const funcName = chip.getAttribute('data-name');
                let words = input.value.split(/(?<=\s)/); 
                if (words.length > 0) {
                    let lastSegment = words[words.length - 1];
                    let spaceMatch = lastSegment.match(/^\s*/);
                    let leadingSpaces = spaceMatch ? spaceMatch[0] : '';
                    words[words.length - 1] = leadingSpaces + funcName + ' ';
                } else { words.push(funcName + ' '); }
                input.value = words.join('');
                input.focus();
                input.style.height = '24px';
                input.style.height = Math.min(input.scrollHeight, 150) + 'px';
            });
        });
    }

    static updateModelSwitcher(ui) {
        const badgeContainer = document.getElementById('gpt-active-badges');
        if (!badgeContainer) return;

        const oldSwitcher = document.getElementById('gpt-model-switcher-btn');
        if (oldSwitcher) oldSwitcher.remove();

        const modelType = ui.app.selectedModel?.type?.toLowerCase() || '';
        const config = ModelConfig[modelType];
        if (!config || !config.setting_ui || !config.setting_ui.inputs) return;

        const primaryInput = config.setting_ui.inputs.find(i => i.id === 'primary');
        if (!primaryInput) return;

        let list = [];
        try { list = JSON.parse(ConfigManager.get(`${primaryInput.storageKey}_list`) || '[]'); } catch(e){}
        const activeVal = ConfigManager.get(primaryInput.storageKey) || ui.app[primaryInput.storageKey];

        if (list.length > 1) {
            const switcherBtn = document.createElement('div');
            switcherBtn.id = 'gpt-model-switcher-btn';
            switcherBtn.title = 'Switch Active Model';
            switcherBtn.style.cssText = `
                display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; 
                background: rgba(40, 167, 69, 0.1); border: 1px solid rgba(40, 167, 69, 0.3); 
                color: #4CAF50; cursor: pointer; font-size: 10px; font-weight: bold; 
                letter-spacing: 0.5px; transition: all 0.2s ease; margin-right: 4px; flex-shrink: 0;
            `;
            
            // 🟢 Remove models/ for button display
            let displayVal = activeVal || list[0] || 'Select Model';
            if (typeof displayVal === 'string' && displayVal.startsWith('models/')) {
                displayVal = displayVal.substring(7);
            }
            if (displayVal.length > 12) displayVal = displayVal.substring(0, 10) + '...';

            switcherBtn.innerHTML = `<span>${displayVal}</span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            
            switcherBtn.onmouseenter = () => switcherBtn.style.background = 'rgba(40, 167, 69, 0.2)';
            switcherBtn.onmouseleave = () => switcherBtn.style.background = 'rgba(40, 167, 69, 0.1)';

            switcherBtn.onclick = (e) => {
                e.stopPropagation();
                // 🟢 Pass activeVal to showDropdown
                ChatInputEvents.showDropdown(switcherBtn, list, (selected) => {
                    ConfigManager.set(primaryInput.storageKey, selected);
                    ui.app[primaryInput.storageKey] = selected; 
                    ChatInputEvents.updateModelSwitcher(ui); 
                    
                    let toastName = selected;
                    if(toastName.startsWith('models/')) toastName = toastName.substring(7);
                    window.toast(`Switched to: ${toastName}`, 2000);
                }, activeVal);
            };
            
            badgeContainer.prepend(switcherBtn);
        }
    }

    static updateActiveBadges(ui) {
        const badgeContainer = document.getElementById('gpt-active-badges');
        if (!badgeContainer) return;
        
        badgeContainer.innerHTML = '';
        const activeTools = [];

        if (!ui.states.history) {
            activeTools.push({ id: 'history', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 15 15"></polyline><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`, color: '#f44336', tooltip: 'History Disabled' });
        }
        if (ui.states.web) activeTools.push({ id: 'web', icon: icons.globeIcon, color: '#4CAF50', tooltip: 'Web Search Active' });
        if (ui.states.think) activeTools.push({ id: 'think', icon: icons.brainIcon, color: '#E91E63', tooltip: 'Reasoning Active' });
        if (ui.states.agent) activeTools.push({ id: 'agent', icon: icons.funcIcon, color: '#FF9800', tooltip: 'Agent Mode Active' });
        if (ui.states.study) activeTools.push({ id: 'study', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`, color: '#9C27B0', tooltip: 'Study Mode Active' });
        
        if (ui.states.selectedText) {
            const text = EditorHelper.getSelectedText();
            if (text && text.trim().length > 0) {
                activeTools.push({ id: 'selectedText', icon: icons.textIcon, color: '#03A9F4', tooltip: 'Text Selected' });
            } else {
                ui.states.selectedText = false;
                ui.app.isEnableCatchSelectText = false;
                if (ui.app.currentConversation && ui.app.currentConversation.toolStates) {
                    ui.app.currentConversation.toolStates.selectedText = false;
                    HistoryFileOps.saveActiveChat(ui.app);
                }
                const toggle = document.querySelector('.tool-toggle-item[data-id="selectedText"] .toggle-icon-container');
                if (toggle) toggle.innerHTML = ChatInputTemplates.getToggleSVG(false);
            }
        }

        activeTools.forEach(tool => {
            const badge = document.createElement('div');
            badge.className = 'gpt-active-badge';
            badge.title = tool.tooltip;
            
            badge.style.cssText = `
                position: relative; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 5px; background: transparent; border: none; color: ${tool.color}; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
            `;
            
            const iconSpan = document.createElement('span');
            iconSpan.innerHTML = tool.icon;
            
            const closeSpan = document.createElement('span');
            closeSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            closeSpan.style.cssText = "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.7); border-radius:5px; opacity:0; transition:opacity 0.2s;";
            
            badge.appendChild(iconSpan);
            badge.appendChild(closeSpan);

            badge.onmouseenter = () => { closeSpan.style.opacity = '1'; };
            badge.onmouseleave = () => { closeSpan.style.opacity = '0'; };

            badge.onclick = (e) => {
                e.stopPropagation();
                ui.states[tool.id] = !ui.states[tool.id]; 
                
                if (tool.id === 'web') ui.app.isEnableWebBrowsing = ui.states.web;
                if (tool.id === 'selectedText') ui.app.isEnableCatchSelectText = ui.states.selectedText;
                if (tool.id === 'agent') ui.app.isEnableAgentMode = ui.states.agent;
                if (tool.id === 'study') {
                    ui.app.isEnableStudyMode = ui.states.study;
                    document.body.classList.remove('study-mode-active');
                }
                if (tool.id === 'history') {
                    if (ui.app.settingsStore) ui.app.settingsStore.setBool('isShowHistory', ui.states.history);
                }

                if (ui.app.currentConversation) {
                    if (!ui.app.currentConversation.toolStates) ui.app.currentConversation.toolStates = {};
                    ui.app.currentConversation.toolStates[tool.id] = ui.states[tool.id];
                    HistoryFileOps.saveActiveChat(ui.app);
                }

                ConfigManager.set(`toolState_${tool.id}`, ui.states[tool.id]);

                const toggleIcon = document.querySelector(`.tool-toggle-item[data-id="${tool.id}"] .toggle-icon-container`);
                if (toggleIcon) toggleIcon.innerHTML = ChatInputTemplates.getToggleSVG(ui.states[tool.id]);

                ChatInputEvents.updateActiveBadges(ui);
            };

            badgeContainer.appendChild(badge);
        });

        // Per-chat workspace chips
        import('../../utils/ProjectWorkspace.js').then(({ ProjectWorkspace }) => {
            const chatId = ProjectWorkspace.activeChatId(ui.app);
            ProjectWorkspace.list(chatId).forEach(w => {
                if (!w || !w.name) return;
                const chip = document.createElement('div');
                chip.className = 'gpt-ws-badge';
                chip.title = w.url || w.name;
                chip.style.cssText = `
                    display:inline-flex;align-items:center;gap:4px;padding:2px 6px 2px 8px;border-radius:6px;
                    background:rgba(75,93,209,0.12);border:1px solid rgba(75,93,209,0.28);color:#8b9cff;
                    font-size:10px;font-weight:600;flex-shrink:0;max-width:110px;
                `;
                const label = document.createElement('span');
                label.textContent = w.name;
                label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;';
                const x = document.createElement('button');
                x.type = 'button';
                x.title = 'Remove workspace';
                x.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                x.style.cssText = 'border:0;background:transparent;color:inherit;opacity:.7;cursor:pointer;padding:0;line-height:0;';
                x.onclick = (ev) => {
                    ev.stopPropagation();
                    ProjectWorkspace.remove(chatId, w.id || w.url);
                    ChatInputEvents.updateActiveBadges(ui);
                };
                chip.appendChild(label);
                chip.appendChild(x);
                badgeContainer.appendChild(chip);
            });
        }).catch(() => {});

        const modelType = ui.app.selectedModel?.type?.toLowerCase() || '';
        const config = ModelConfig[modelType];
        
        // Think Level Dropdown
        if (ui.states.think && config && Array.isArray(config.think_how) && config.think_how.length > 0) {
            if (!config.think_how.includes(ui.states.thinkLevel)) {
                ui.states.thinkLevel = config.think_how[0]; 
            }

            const thinkLevelBtn = document.createElement('div');
            thinkLevelBtn.className = 'gpt-think-level-btn';
            thinkLevelBtn.title = 'Select Thinking Level';
            thinkLevelBtn.style.cssText = `
                display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: rgba(233, 30, 99, 0.1); border: 1px solid rgba(233, 30, 99, 0.3); color: #E91E63; cursor: pointer; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 2px; transition: all 0.2s ease; flex-shrink: 0;
            `;
            thinkLevelBtn.innerHTML = `<span>${ui.states.thinkLevel}</span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            
            thinkLevelBtn.onmouseenter = () => thinkLevelBtn.style.background = 'rgba(233, 30, 99, 0.2)';
            thinkLevelBtn.onmouseleave = () => thinkLevelBtn.style.background = 'rgba(233, 30, 99, 0.1)';

            thinkLevelBtn.onclick = (e) => {
                e.stopPropagation();
                // 🟢 Pass ui.states.thinkLevel to highlight the currently active item
                ChatInputEvents.showDropdown(thinkLevelBtn, config.think_how, (selected) => {
                    ui.states.thinkLevel = selected;
                    if (ui.app.currentConversation) {
                        if (!ui.app.currentConversation.toolStates) ui.app.currentConversation.toolStates = {};
                        ui.app.currentConversation.toolStates.thinkLevel = selected;
                        HistoryFileOps.saveActiveChat(ui.app);
                    }
                    ConfigManager.set('toolState_thinkLevel', selected); 
                    ChatInputEvents.updateActiveBadges(ui);
                }, ui.states.thinkLevel);
            };
            badgeContainer.appendChild(thinkLevelBtn);
        }

        ChatInputEvents.updateModelSwitcher(ui);
    }

    static attachListeners(ui) {
        // Preload slash command registry
        import('./SlashCommands.js').then(m => { ChatInputEvents._slashMod = m; }).catch(() => {});
        import('./PasteChips.js').then(m => { try { m.attachPasteChipListener(ui.app); } catch (_) {} }).catch(() => {});
        const userInput = document.getElementById('gpt-user-input');
        const actionBtn = document.getElementById('gpt-action-btn');
        const actionPopup = document.getElementById('gpt-action-popup');
        const toolsBtn = document.getElementById('gpt-tools-btn');
        const toolsPopup = document.getElementById('gpt-tools-popup');

        userInput.addEventListener('input', (e) => {
            const inputEl = e.target;
            inputEl.style.height = '24px';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
            try {
                import('./PasteChips.js').then(m => m.updatePreviewContainerBottom?.()).catch(() => {});
            } catch (_) {}

            // `/` slash command palette (OpenCode-style)
            try {
                ChatInputEvents.updateSlashSuggestions(ui, inputEl.value);
            } catch (_) {}
            try {
                ChatInputEvents.updateAtFileSuggestions(ui, inputEl);
            } catch (_) {}

            if (ui.states.catchFunction && ui.app.currentFunc_List) {
                const words = inputEl.value.split(/\s+/);
                const lastWord = words[words.length - 1].toLowerCase();
                if (lastWord === '') {
                    ChatInputEvents.updateFunctionSuggestions(ui, ui.app.currentFunc_List);
                } else {
                    const filteredList = ui.app.currentFunc_List.filter(funcItem => {
                        const funcName = (typeof funcItem === 'object' ? funcItem.name : funcItem).toLowerCase();
                        return funcName.includes(lastWord); 
                    });
                    ChatInputEvents.updateFunctionSuggestions(ui, filteredList);
                }
            }
        });

        actionBtn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            ui.isActionMenuOpen = !ui.isActionMenuOpen; 
            actionPopup.style.display = ui.isActionMenuOpen ? 'block' : 'none'; 
            toolsPopup.style.display = 'none'; 
            ui.isToolsMenuOpen = false; 
        });

        toolsBtn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            ui.isToolsMenuOpen = !ui.isToolsMenuOpen; 
            toolsPopup.style.display = ui.isToolsMenuOpen ? 'block' : 'none'; 
            actionPopup.style.display = 'none'; 
            ui.isActionMenuOpen = false; 
        });

        if (ui._docClickListener) {
            document.removeEventListener('click', ui._docClickListener);
        }

        ui._docClickListener = (e) => {
            const curActionBtn = document.getElementById('gpt-action-btn');
            const curActionPopup = document.getElementById('gpt-action-popup');
            const curToolsBtn = document.getElementById('gpt-tools-btn');
            const curToolsPopup = document.getElementById('gpt-tools-popup');
            
            if (curActionBtn && curActionPopup && !curActionBtn.contains(e.target) && !curActionPopup.contains(e.target)) { 
                curActionPopup.style.display = 'none'; 
                ui.isActionMenuOpen = false; 
            }
            if (curToolsBtn && curToolsPopup && !curToolsBtn.contains(e.target) && !curToolsPopup.contains(e.target)) { 
                curToolsPopup.style.display = 'none'; 
                ui.isToolsMenuOpen = false; 
            }
        };

        document.addEventListener('click', ui._docClickListener);

        // Event delegation on action popup (capture) — survives re-renders & beats doc closer
        if (actionPopup && !actionPopup._gptActionDelegated) {
            actionPopup._gptActionDelegated = true;
            actionPopup.addEventListener('click', (e) => {
                const t = e.target.closest('#action-image, #action-file, #action-project');
                if (!t) return;
                e.preventDefault();
                e.stopPropagation();

                if (t.id === 'action-image') {
                    const fileInp = document.getElementById('file-input');
                    fileInp.setAttribute('accept', 'image/*');
                    fileInp.click();
                    actionPopup.style.display = 'none';
                    ui.isActionMenuOpen = false;
                    return;
                }
                if (t.id === 'action-file') {
                    const fileInp = document.getElementById('file-input');
                    fileInp.setAttribute('accept', 'text/*, .js, .py, .html, .css, .json, .csv, .md, .xml, .java, .cpp, .txt');
                    fileInp.click();
                    actionPopup.style.display = 'none';
                    ui.isActionMenuOpen = false;
                    return;
                }
                if (t.id === 'action-project') {
                    actionPopup.style.display = 'none';
                    ui.isActionMenuOpen = false;
                    // Open submenu from + button anchor (reliable position)
                    const anchor = document.getElementById('gpt-action-btn') || t;
                    setTimeout(() => ChatInputEvents.showProjectSubmenu(ui, anchor), 10);
                }
            }, true);
        }

        document.querySelectorAll('.tool-toggle-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = item.getAttribute('data-id');

                if (item.getAttribute('data-locked') === 'true') {
                    if (id === 'imageGen') {
                        if (typeof window.toast === 'function') window.toast('Please add an image gen model in input field', 3000);
                        else alert('Please add an image gen model in input field');
                    }
                    return;
                }

                // --- Think gate (non-native) ---
                if (id === 'think') {
                    const wantOn = !ui.states.think;
                    if (wantOn) {
                        let native = false;
                        let force = false;
                        try {
                            const { modelSupportsNativeThink, isForceNonNativeThinkingEnabled } =
                                await import('../../model/thinking/ThinkCapability.js');
                            native = modelSupportsNativeThink(ui.app);
                            force = isForceNonNativeThinkingEnabled(ui.app);
                        } catch (_) {
                            try {
                                force = !!ConfigManager.get('forceEnableNonNativeThinking');
                            } catch (__) {}
                        }
                        if (!native && !force) {
                            try {
                                const { pushChatEvent } = await import('./SlashCommands.js');
                                await pushChatEvent(
                                    ui.app,
                                    'Non-native thinking is disabled. Open Settings → Force enable thinking (non-native models) to turn it on. Warning: answers may be lower quality.'
                                );
                            } catch (_) {
                                if (typeof window.toast === 'function') {
                                    window.toast('Non-native thinking disabled — enable in Settings', 3500);
                                }
                            }
                            return; // do not toggle ON
                        }
                    }
                }

                ui.states[id] = !ui.states[id];
                item.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(ui.states[id]);

                if (ui.app.currentConversation) {
                    if (!ui.app.currentConversation.toolStates) ui.app.currentConversation.toolStates = {};
                    ui.app.currentConversation.toolStates[id] = ui.states[id];
                    HistoryFileOps.saveActiveChat(ui.app);
                }

                ConfigManager.set(`toolState_${id}`, ui.states[id]);

                if (id === 'web') ui.app.isEnableWebBrowsing = ui.states.web;
                if (id === 'selectedText') ui.app.isEnableCatchSelectText = ui.states.selectedText;
                if (id === 'imageGen') ui.app.isEnableImageGeneration = ui.states.imageGen;
                
                if (id === 'history') {
                    if (ui.app.settingsStore) ui.app.settingsStore.setBool('isShowHistory', ui.states.history);
                }
                
                if (id === 'study') {
                    ui.app.isEnableStudyMode = ui.states.study;
                    if (ui.states.study) {
                        document.body.classList.add('study-mode-active');
                        if (ui.states.agent) {
                            ui.states.agent = false;
                            ui.app.isEnableAgentMode = false;
                            ChatInputEvents.dismissAgentProjectWarning();
                            if (ui.app.currentConversation && ui.app.currentConversation.toolStates) {
                                ui.app.currentConversation.toolStates.agent = false;
                                HistoryFileOps.saveActiveChat(ui.app);
                            }
                            const agentItem = document.querySelector('.tool-toggle-item[data-id="agent"]');
                            if (agentItem) agentItem.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false);
                        }
                    } else {
                        document.body.classList.remove('study-mode-active');
                    }
                }

                if (id === 'agent') {
                    ui.app.isEnableAgentMode = ui.states.agent;
                    if (ui.states.agent) {
                        ChatInputEvents.showAgentProjectWarningIfNeeded(ui);
                        if (ui.states.study) {
                            ui.states.study = false;
                            ui.app.isEnableStudyMode = false;
                            if (ui.app.currentConversation && ui.app.currentConversation.toolStates) {
                                ui.app.currentConversation.toolStates.study = false;
                                HistoryFileOps.saveActiveChat(ui.app);
                            }
                            document.body.classList.remove('study-mode-active');
                            const studyItem = document.querySelector('.tool-toggle-item[data-id="study"]');
                            if (studyItem) studyItem.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false);
                        }
                    } else {
                        // Agent off → hide workspace warn
                        ChatInputEvents.dismissAgentProjectWarning();
                    }
                }

                if (id === 'catchFunction') {
                    ui.app.isEnableFunctionCatch = ui.states.catchFunction;
                    if (ui.states.catchFunction) {
                        const currentText = window.editorManager?.editor?.getValue() || '';
                        ui.app.currentFunc_List = collectFunctionNames(currentText) || [];
                        ChatInputEvents.updateFunctionSuggestions(ui, ui.app.currentFunc_List);
                    } else {
                        ChatInputEvents.updateFunctionSuggestions(ui, []);
                    }
                }

                ChatInputEvents.updateActiveBadges(ui);
            });
        });
    }

    /** Wire Add Project → submenu of workspaces + add */
    static bindProjectAction(ui, projectBtn) {
        if (!projectBtn || projectBtn._projectBound) return;
        projectBtn._projectBound = true;
        projectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const actionPopup = document.getElementById('gpt-action-popup');
            if (actionPopup) actionPopup.style.display = 'none';
            ui.isActionMenuOpen = false;
            ChatInputEvents.showProjectSubmenu(ui, projectBtn);
        });
    }

    static async showProjectSubmenu(ui, anchorEl) {
        const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
        const chatId = ProjectWorkspace.activeChatId(ui.app);
        let submenu = document.getElementById('gpt-project-submenu');
        if (!submenu) {
            submenu = document.createElement('div');
            submenu.id = 'gpt-project-submenu';
            document.body.appendChild(submenu);
        }
        submenu.style.cssText = `
            position:absolute; z-index:999999; min-width:210px; max-height:280px; overflow-y:auto;
            background:var(--secondary-color,#2a2a2a); border:1px solid var(--border-color,rgba(255,255,255,0.12));
            border-radius:8px; padding:5px; box-shadow:0 10px 28px rgba(0,0,0,0.45);
            display:flex; flex-direction:column; gap:2px;
        `;

        const list = ProjectWorkspace.list(chatId);
        const instr = ProjectWorkspace.getInstruction(chatId);
        const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const CROSS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        const NOTE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

        let html = '';
        // Extra instructions — above empty state / workspace list
        html += `<div class="gpt-ws-instruction" title="Extra instructions for agent in this chat">
          <span style="opacity:.85;line-height:0;">${NOTE}</span>
          <span style="font-weight:600;flex-shrink:0;">Instructions</span>
          <span class="gpt-ws-instruction-preview">${instr ? esc(instr.slice(0, 48)) + (instr.length > 48 ? '…' : '') : 'Add extra instruction…'}</span>
        </div>`;
        html += `<div style="height:1px;background:var(--border-color,rgba(255,255,255,0.08));margin:2px 2px 4px;"></div>`;

        if (!list.length) {
            html += `<div class="gpt-ws-empty" style="padding:8px 10px;font-size:12px;color:var(--secondary-text-color,#888);opacity:.85;">No project selected</div>`;
        } else {
            list.forEach(w => {
                html += `<div class="gpt-ws-item" data-id="${esc(w.id)}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;font-size:12px;color:var(--primary-text-color);">
                  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(w.url)}">${esc(w.name)}</span>
                  <button type="button" class="gpt-ws-remove" data-id="${esc(w.id)}" title="Remove" style="border:0;background:transparent;color:rgba(255,255,255,0.45);cursor:pointer;padding:2px;line-height:0;border-radius:4px;">${CROSS}</button>
                </div>`;
            });
        }
        html += `<div style="height:1px;background:var(--border-color,rgba(255,255,255,0.08));margin:4px 2px;"></div>`;
        html += `<div class="gpt-ws-add" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-radius:6px;font-size:12px;color:var(--primary-text-color);font-weight:600;">
          <span style="opacity:.8;">+</span><span>Add workspace</span>
        </div>`;
        submenu.innerHTML = html;
        submenu.style.display = 'flex';
        submenu.style.maxHeight = '320px';
        submenu.style.minWidth = '240px';

        const rect = (anchorEl || document.getElementById('gpt-action-btn')).getBoundingClientRect();
        submenu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        submenu.style.left = `${Math.max(8, rect.left)}px`;

        const closer = (ev) => {
            if (!submenu.contains(ev.target) && ev.target !== anchorEl && !anchorEl?.contains?.(ev.target)) {
                // Keep open if UiDialog is up
                if (document.getElementById('gpt-ui-dialog-overlay')) return;
                submenu.style.display = 'none';
                document.removeEventListener('click', closer);
            }
        };

        submenu.querySelectorAll('.gpt-ws-remove').forEach(btn => {
            btn.onclick = (ev) => {
                ev.stopPropagation();
                ProjectWorkspace.remove(chatId, btn.getAttribute('data-id'));
                ChatInputEvents.showProjectSubmenu(ui, anchorEl);
                ChatInputEvents.updateActiveBadges(ui);
            };
        });
        const addBtn = submenu.querySelector('.gpt-ws-add');
        if (addBtn) {
            addBtn.onclick = async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                submenu.style.display = 'none';
                document.removeEventListener('click', closer);
                try {
                    const liveId = ProjectWorkspace.activeChatId(ui.app);
                const added = await ProjectWorkspace.addViaPicker(liveId, ui.app);
                    if (added) {
                        ChatInputEvents.updateActiveBadges(ui);
                        ChatInputEvents.dismissAgentProjectWarning();
                    }
                } catch (err) {
                    console.error('[Add workspace]', err);
                    if (typeof window.toast === 'function') window.toast('Could not add workspace', 2500);
                }
            };
        }

        const instrBtn = submenu.querySelector('.gpt-ws-instruction');
        if (instrBtn) {
            instrBtn.onclick = async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                submenu.style.display = 'none';
                document.removeEventListener('click', closer);
                await ChatInputEvents.openProjectInstructionEditor(ui, chatId);
            };
        }

        setTimeout(() => document.addEventListener('click', closer), 30);
    }

    /** Per-chat agent instructions — UiDialog + UiField textarea */
    static async openProjectInstructionEditor(ui, chatId) {
        const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
        const { createTextarea } = await import('../components/UiField.js');
        const { openUiDialog } = await import('../components/UiDialog.js');
        const id = chatId != null ? chatId : ProjectWorkspace.activeChatId(ui.app);
        const current = ProjectWorkspace.getInstruction(id);

        const field = createTextarea({
            id: 'gpt-ws-instruction-ta',
            label: 'Extra instructions',
            placeholder: 'e.g. Prefer TypeScript, do not touch tests/, always use relative imports…',
            value: current,
            rows: 5,
            maxHeight: 220,
            hint: 'Sent with agent context for this chat only. Clear and Save to remove.'
        });

        openUiDialog({
            title: 'Project instructions',
            body: field.root,
            confirmText: 'Save',
            cancelText: 'Cancel',
            onConfirm: () => {
                ProjectWorkspace.setInstruction(id, field.getValue());
                if (typeof window.toast === 'function') {
                    const v = field.getValue().trim();
                    window.toast(v ? 'Instructions saved' : 'Instructions cleared', 2000);
                }
            }
        });
    }

    /** Place warning above input bar (always visible). */
    static async showAgentProjectWarningIfNeeded(ui) {
        try {
            const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
            const chatId = ProjectWorkspace.activeChatId(ui.app);
            if (ProjectWorkspace.hasAny(chatId)) {
                ChatInputEvents.dismissAgentProjectWarning();
                return;
            }
            ChatInputEvents.dismissAgentProjectWarning();

            const inputContainer = document.getElementById('input-container');
            if (!inputContainer || !inputContainer.parentElement) return;

            const card = document.createElement('div');
            card.id = 'gpt-project-warn';
            card.className = 'gpt-project-warn';
            card.innerHTML = `
              <div class="gpt-project-warn-title">No project selected</div>
              <div class="gpt-project-warn-body">Agent mode is on without a workspace for this chat. The AI may use any open folder. Use <b>Add workspace</b> to lock edits to one path.</div>
              <button type="button" class="gpt-project-warn-btn">Add workspace</button>
            `;
            inputContainer.parentElement.insertBefore(card, inputContainer);

            card.querySelector('.gpt-project-warn-btn')?.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const liveId = ProjectWorkspace.activeChatId(ui.app);
                const added = await ProjectWorkspace.addViaPicker(liveId, ui.app);
                if (added) {
                    ChatInputEvents.dismissAgentProjectWarning();
                    ChatInputEvents.updateActiveBadges(ui);
                }
            });
        } catch (e) {
            console.warn('[project warn]', e);
        }
    }

    static dismissAgentProjectWarning() {
        document.getElementById('gpt-project-warn')?.remove();
        document.querySelectorAll('.gpt-project-warn').forEach(el => el.remove());
    }


    static updateAtFileSuggestions(ui, inputEl) {
        import('./FileMention.js').then(m => {
            const el = inputEl || document.getElementById('gpt-user-input');
            if (!el) return;
            m.updateAtSuggestions(ui, el.value, el.selectionStart).catch(() => {});
        }).catch(() => {});
    }

    static updateSlashSuggestions(ui, value) {
        let box = document.getElementById('gpt-slash-suggest');
        const inputContainer = document.getElementById('input-container');
        if (!String(value || '').startsWith('/')) {
            box?.remove();
            return;
        }
        try { document.getElementById('gpt-at-suggest')?.remove(); } catch (_) {}
        let cmds = [];
        try {
            if (!ChatInputEvents._slashMod) return;
            cmds = ChatInputEvents._slashMod.getSlashSuggestions(ui.app, value) || [];
        } catch (_) { return; }
        if (!cmds.length) {
            box?.remove();
            return;
        }
        if (!box) {
            box = document.createElement('div');
            box.id = 'gpt-slash-suggest';
            box.style.cssText = [
                'position:absolute', 'left:0', 'right:0', 'bottom:100%',
                'z-index:90', 'max-height:220px', 'overflow:auto',
                'background:var(--secondary-color,#1e1e2e)',
                'border:1px solid var(--border-color,#333)',
                'border-radius:0', 'border-bottom:none',
                'box-shadow:0 -6px 18px rgba(0,0,0,0.25)'
            ].join(';');
            if (inputContainer) {
                if (getComputedStyle(inputContainer).position === 'static') {
                    inputContainer.style.position = 'relative';
                }
                inputContainer.appendChild(box);
            } else document.body.appendChild(box);
        }
        box.innerHTML = cmds.map(c => {
          const insertOnly = c.insert ? '1' : '0';
          const runIt = c.run !== false && !c.insert ? '1' : '0';
          const label = String(c.name || '').replace(/</g, '&lt;');
          const desc = String(c.description || '').replace(/</g, '&lt;');
          return `
          <div class="gpt-slash-item" data-cmd="${label}" data-insert="${insertOnly}" data-run="${runIt}"
            style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border-color,#333);display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:13px;font-weight:600;color:var(--primary-text-color);">${label}</span>
            <span style="font-size:11px;opacity:0.55;color:var(--primary-text-color);">${desc}</span>
          </div>`;
        }).join('');
        box.querySelectorAll('.gpt-slash-item').forEach(row => {
            row.onclick = () => {
                const input = document.getElementById('gpt-user-input');
                const cmd = row.dataset.cmd || '';
                const insertOnly = row.dataset.insert === '1';
                const runIt = row.dataset.run === '1';
                if (input) {
                    if (insertOnly) {
                        // Incomplete command — leave cursor for typing (e.g. /perms allow _)
                        input.value = cmd.endsWith(' ') ? cmd : (cmd + ' ');
                    } else if (runIt) {
                        input.value = cmd.trim();
                    } else {
                        input.value = cmd;
                    }
                    input.focus();
                    const pos = input.value.length;
                    try { input.setSelectionRange(pos, pos); } catch (_) {}
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (runIt && !insertOnly) {
                    ChatInputEvents.runSlashIfAny(ui, cmd.trim()).catch(() => {});
                    try { document.getElementById('gpt-slash-suggest')?.remove(); } catch (_) {}
                } else {
                    try { ChatInputEvents.updateSlashSuggestions(ui, input?.value || cmd); } catch (_) {}
                }
            };
        });
    }

    static async runSlashIfAny(ui, raw) {
        try {
            if (!ChatInputEvents._slashMod) {
                ChatInputEvents._slashMod = await import('./SlashCommands.js');
            }
            const handled = await ChatInputEvents._slashMod.tryHandleSlashCommand(ui.app, raw);
            if (handled) {
                const input = document.getElementById('gpt-user-input');
                if (input) {
                    input.value = '';
                    if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
                }
                document.getElementById('gpt-slash-suggest')?.remove();
            }
            return handled;
        } catch (e) {
            console.warn('[slash]', e);
            return false;
        }
    }


}