import { Formatter } from '../utils/Formatter.js';
// src/main/ui/ChatUI.js
export class ChatUI {
    // ==========================================
    // Send, Stop & Loading Button UI Controls
    // ==========================================
    
    static updateSendStopBtn(app, status) {
        // console.log('UPDATESENDSTOPBTN__________]');
        const stopBtn = document.getElementById('stop-btn');
        const sendBtn = document.getElementById('send-btn');
        
        if (status === 'run') {
            app.isFetching = true;
            ChatUI.toggleLoading(app, true);
            // Keep Send visible while running → queues steering (SteeringQueue)
            // Stop aborts the run
            if (sendBtn) {
                sendBtn.style.display = 'flex';
                sendBtn.title = 'Queue message for running agent (steering)';
                sendBtn.style.opacity = '0.92';
            }
            if (stopBtn) stopBtn.style.display = 'flex';
        } else {
            console.log('ABORTED SIGNAL ::');
            app.isFetching = false;
            // Must pass false — true was re-adding a spinner and never clearing loading UI
            ChatUI.toggleLoading(app, false);
            if (sendBtn) {
                sendBtn.style.display = 'flex';
                sendBtn.title = 'Send';
                sendBtn.style.opacity = '1';
            }
            if (stopBtn) stopBtn.style.display = 'none';
        }
    }

    static toggleLoading(app, running) {
        if (app.optimize) return;
        // console.log('TOGGLELOADING __________________]');
        
        let assistantMessage = null;
        if (app.chatBox) {
            assistantMessage = app.chatBox.querySelector('.assistant-message:last-child');
        }
        const stopBtn = document.getElementById('stop-btn');

        if (running) {
            // Add loading effect
            if (assistantMessage && !document.querySelector('.loading-spinner') && !app.optimize) {
                const loader = document.createElement('div');
                loader.className = 'loading-spinner';
                assistantMessage.appendChild(loader);
            }
            if (stopBtn) {
                stopBtn.classList.add('loading-active');
            }
        } else {
            // Remove loading effect
            const existingLoader = document.querySelector('.loading-spinner');
            if (existingLoader) {
                existingLoader.remove();
            }
            if (stopBtn) {
                stopBtn.classList.remove('loading-active');
            }
        }
    }

    static toggleStopBtnLoading(running) {
        // console.log('TOGGLESTOPBTNLOADING __________ ]');
        const stopBtn = document.getElementById('stop-btn');
        const sendBtn = document.getElementById('send-btn');
        
        if (running) {
            if (stopBtn) {
                stopBtn.classList.add('loading-active');
                stopBtn.style.display = 'flex';
            }
            // Keep Send so user can queue steering while agent runs
            if (sendBtn) {
                sendBtn.style.display = 'flex';
                sendBtn.title = 'Queue message for running agent (steering)';
            }
        } else {
            if (stopBtn) {
                stopBtn.classList.remove('loading-active');
                stopBtn.style.display = 'none';
            }
            if (sendBtn) {
                sendBtn.style.display = 'flex';
                sendBtn.title = 'Send';
            }
        }
    }
    
    // Spinner control
    static spinGPTICON(isLoading) {
        const spinner = document.getElementById('gpt-spinner');
        if (!spinner) return;
        spinner.style.display = isLoading ? 'block' : 'none';
    }

    // Fast Wave Animation
    static gptFastWaveEffect(optimize, animationSetting) {
        if (animationSetting === 'no' || optimize) return;
        
        const boxes = document.querySelectorAll('.gpt-fast-wave');
        boxes.forEach(box => {
            box.addEventListener('pointerdown', ChatUI.createFastWave);
        });
    }

    static createFastWave(event) {
        if (document.documentElement.classList.contains('gpt-wave-off') ||
            document.body?.classList?.contains('gpt-wave-off')) return;
        const box = event.currentTarget;
        const wave = document.createElement('span');
        wave.classList.add('gpt-fastwave-touch');

        const rect = box.getBoundingClientRect();
        wave.style.left = `${event.clientX - rect.left - 10}px`;
        wave.style.top = `${event.clientY - rect.top - 10}px`;

        box.appendChild(wave);
        wave.addEventListener('animationend', () => wave.remove());
    }

    // Slow Wave Animation
    static gptSlowWaveEffect(optimize, animationSetting) {
        if (animationSetting === 'no' || optimize) return;
        
        const boxes = document.querySelectorAll('.gpt-slow-wave');
        boxes.forEach(box => {
            box.addEventListener('pointerdown', ChatUI.createSlowWave);
        });
    }

    static createSlowWave(event) {
        if (document.documentElement.classList.contains('gpt-wave-off') ||
            document.body?.classList?.contains('gpt-wave-off')) return;
        const box = event.currentTarget;
        const wave = document.createElement('span');
        wave.classList.add('gpt-slowwave-touch');

        const rect = box.getBoundingClientRect();
        wave.style.left = `${event.clientX - rect.left - 10}px`;
        wave.style.top = `${event.clientY - rect.top - 10}px`;

        box.appendChild(wave);
        wave.addEventListener('animationend', () => wave.remove());
    }
    
    // ==========================================
    // UI Helpers & Animations
    // ==========================================
    
    // 🟢 NEW: Collapse logic for long User Queries
    static setupCollapsibleUserMessage(messageElement) {
        // Delay slightly to let the DOM paint and calculate heights accurately
        setTimeout(() => {
            const innerHolder = messageElement.querySelector('.gpt-message-inner-holder');
            if (!innerHolder) return;

            // Check if the query is too tall (e.g., exceeds 150px)
            if (innerHolder.scrollHeight > 150) {
                
                // 1. Apply Initial Collapsed Styles
                innerHolder.style.maxHeight = '120px';
                innerHolder.style.overflow = 'hidden';
                innerHolder.style.transition = 'max-height 0.35s ease';
                
                // Add a subtle bottom margin to the message element so the icon fits well
                messageElement.style.position = 'relative';
                messageElement.style.marginBottom = '20px';

                // 2. Create the Expand/Collapse Toggle Button
                const toggleBtn = document.createElement('div');
                toggleBtn.className = 'gpt-query-collapse-btn';
                toggleBtn.style.cssText = `
                    position: absolute;
                    bottom: 14px;
                    right: 12px;
                    background: var(--secondary-color, #2a2a2a);
                    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
                    border-radius: 50%;
                    width: 26px;
                    height: 26px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: var(--primary-text-color, #e0e0e0);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.4);
                    z-index: 10;
                    transition: all 0.2s ease;
                `;
                
                const expandSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
                const collapseSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;

                toggleBtn.innerHTML = expandSvg;
                
                // Hover effect for the button
                toggleBtn.onmouseenter = () => toggleBtn.style.background = 'var(--active-color, #3a3a3a)';
                toggleBtn.onmouseleave = () => toggleBtn.style.background = 'var(--secondary-color, #2a2a2a)';

                // 3. Attach click event to toggle max-height
                let isCollapsed = true;
                toggleBtn.onclick = (e) => {
                    e.stopPropagation(); // Prevent triggering the long-press logic
                    isCollapsed = !isCollapsed;
                    
                    if (isCollapsed) {
                        innerHolder.style.maxHeight = '110px';
                        toggleBtn.innerHTML = expandSvg;
                        toggleBtn.style.transform = 'translateY(0px)';
                    } else {
                        innerHolder.style.maxHeight = innerHolder.scrollHeight + 'px';
                        toggleBtn.innerHTML = collapseSvg;
                        toggleBtn.style.transform = 'translateY(2px)';
                    }
                };

                messageElement.appendChild(toggleBtn);
            }
        }, 50);
    }

    static chatIncreaseHeight() {
        const box = document.getElementById('chat-box') || document.querySelector('.chat-box');
        const messages = document.querySelectorAll('.assistant-message');
        messages.forEach((message) => message.classList.remove('increaseChatHeight'));
        if (!messages.length) return;
        // If the last chat bubble is an event/info row, do NOT stretch the previous assistant
        // (that left a huge empty gap and pushed the event off-screen / to the bottom).
        try {
            const kids = box ? Array.from(box.querySelectorAll(':scope > .gpt-message')) : [];
            const last = kids[kids.length - 1];
            if (last && (last.classList.contains('gpt-event-message') || last.getAttribute('data-msg-role') === 'event')) {
                return;
            }
        } catch (_) {}
        const lastMessage = messages[messages.length - 1];
        // Don't stretch if an event row follows this assistant
        try {
            if (lastMessage.nextElementSibling &&
                (lastMessage.nextElementSibling.classList.contains('gpt-event-message') ||
                 lastMessage.nextElementSibling.getAttribute('data-msg-role') === 'event')) {
                return;
            }
        } catch (_) {}
        lastMessage.classList.add('increaseChatHeight');
    }

    static streamTitleCharacterByCharacter(element, title, bubble) {
        let index = 0;
        const plain = Formatter.formatChatTitlePlain(title || '');
        element.textContent = '';
        if (bubble) bubble.style.display = 'inline-block';
        const intervalId = setInterval(() => {
            if (index < plain.length) {
                element.textContent += plain[index];
                index++;
            } else {
                clearInterval(intervalId);
                if (bubble) bubble.style.display = 'none';
                // Final: light markdown (bold/italic) for finished title
                try { element.innerHTML = Formatter.formatChatTitleHtml(title || plain); } catch (_) {}
            }
        }, 20);
    }

    static insertIntoCode(content) {
        const editor = window.editorManager?.editor;
        if (!editor) {
            console.error("Ace editor instance not found.");
            return;
        }
        const cursorPosition = editor.getCursorPosition();
        editor.session.insert(cursorPosition, content);
    }

    // ==========================================
    // Long Press & Text Selection Control
    // ==========================================
    static addLongPressListener(app, messageElement, index, role) {
        // User: no long-press menu — inline footer has Edit / time / chars
        if (role === 'user') {
            messageElement.dataset.msgIndex = String(index);
            messageElement.dataset.msgRole = 'user';
            return;
        }
        messageElement.dataset.msgIndex = String(index);
        messageElement.dataset.msgRole = role || 'assistant';

        let pressTimer, secondaryPressTimer;
        let startX = 0, startY = 0;
        let isLongPress = false;
        let isMoving = false;

        const startLongPress = (event) => {
            // Select-text mode: no popup on long-press
            if (app.activateSelectMode) return;
            isLongPress = false;
            startX = event.type === 'touchstart' ? event.touches[0].clientX : event.clientX;
            startY = event.type === 'touchstart' ? event.touches[0].clientY : event.clientY;

            pressTimer = setTimeout(() => {
                isLongPress = true;
                if (!isMoving) {
                    const x = event.type === 'touchstart' ? event.touches[0].clientX : event.clientX;
                    const y = event.type === 'touchstart' ? event.touches[0].clientY : event.clientY;

                    if (role === 'user') {
                        window.navigator.vibrate(30);
                        if (app.popupManager) app.popupManager.showUserPopup(x, y, index);
                    } else {
                        if (!app.activateSelectMode) {
                            window.navigator.vibrate(30);
                            if (app.popupManager) app.popupManager.showPopup(x, y, index);
                        }
                    }
                }
            }, 500);
        };

        const handleMovement = (event) => {
            const moveX = event.type === 'touchmove' ? event.touches[0].clientX : event.clientX;
            const moveY = event.type === 'touchmove' ? event.touches[0].clientY : event.clientY;

            if (Math.abs(moveX - startX) > 15 || Math.abs(moveY - startY) > 15) {
                isMoving = true;
                clearTimeout(pressTimer);
                clearTimeout(secondaryPressTimer);
            }
        };

        const handleDrag = () => {
            if (window.getSelection().toString() !== "") {
                if (app.mainBox) app.mainBox.classList.remove("gpt-show");
            }
        };

        const clearLongPress = () => { clearTimeout(pressTimer); clearTimeout(secondaryPressTimer); };
        const resetMovement = () => { isMoving = false; };

        messageElement.addEventListener('mousedown', startLongPress);
        messageElement.addEventListener('mouseup', clearLongPress);
        messageElement.addEventListener('mousemove', handleMovement);
        messageElement.addEventListener('mouseout', clearLongPress);
        messageElement.addEventListener('touchstart', startLongPress);
        messageElement.addEventListener('touchend', () => { clearLongPress(); resetMovement(); });
        messageElement.addEventListener('touchmove', handleMovement);
        messageElement.addEventListener('touchcancel', clearLongPress);
        messageElement.addEventListener('dragstart', handleDrag);
    }

    static disableLongPressForElement(app, messageElement) {
        // Do NOT cloneNode — that strips collapsible / rail click handlers.
        // Long-press is gated by app.activateSelectMode in startLongPress.
        app.activateSelectMode = true;
        return messageElement;
    }

    static enterSelectTextMode(app, messageElement, index) {
        if (!messageElement) return;
        try { ChatUI.exitSelectTextMode(app); } catch (_) {}
        app.activateSelectMode = true;
        app._selectTextIndex = index;

        const el = messageElement;
        app._selectTextEl = el;
        el.classList.add('gpt-select-text-mode');
        el.setAttribute('data-select-mode', '1');
        if (index != null) el.setAttribute('data-msg-index', String(index));
        el.style.userSelect = 'text';
        el.style.webkitUserSelect = 'text';
        el.style.background = 'rgba(21, 89, 185, 0.18)';
        el.style.color = 'var(--primary-text-color, #97b0d1)';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        // Text surfaces only — leave interactive chrome (chevrons/rows) as-is for listeners
        el.querySelectorAll('.gpt-message-inner-holder, .gpt-oc-prose, .gpt-stream-prose, .part-text, .gpt-oc-row-body').forEach((n) => {
            n.style.userSelect = 'text';
            n.style.webkitUserSelect = 'text';
        });
        ChatUI.showSelectModeBar(app, index, el);
    }

    static showSelectModeBar(app, index, messageElement) {
        ChatUI.removeSelectModeBar();
        const input = document.getElementById('input-container');
        const bar = document.createElement('div');
        bar.id = 'gpt-select-mode-bar';
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'position:relative;z-index:60;width:100%;box-sizing:border-box;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--secondary-color,#1e1e2e);border-top:1px solid var(--border-color,#333);border-bottom:1px solid var(--border-color,#333);color:var(--primary-text-color,#eee);font-size:12px;';
        bar.innerHTML = '<div style="min-width:0;flex:1;font-weight:600;">Cancel select mode?</div>' +
            '<div style="display:flex;gap:8px;flex-shrink:0;">' +
            '<button type="button" data-select-all style="padding:6px 12px;border-radius:8px;border:1px solid var(--border-color,#555);background:transparent;color:inherit;cursor:pointer;font-size:11px;">Select all</button>' +
            '<button type="button" data-select-exit style="padding:6px 14px;border-radius:8px;border:none;background:var(--button-background-color,#4b5dd1);color:#fff;cursor:pointer;font-size:11px;font-weight:600;">Exit</button>' +
            '</div>';
        if (input && input.parentNode) input.parentNode.insertBefore(bar, input);
        else if (app.mainBox) app.mainBox.appendChild(bar);

        bar.querySelector('[data-select-all]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const root = app._selectTextEl || messageElement;
            if (!root) return;
            try {
                // Prefer answer prose; fall back to full message
                const target = root.querySelector('.gpt-oc-prose, .gpt-stream-prose, .gpt-message-inner-holder') || root;
                const range = document.createRange();
                range.selectNodeContents(target);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (_) {}
        });
        bar.querySelector('[data-select-exit]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            ChatUI.exitSelectTextMode(app);
        });

        try {
            const sendBtn = app.mainBox?.querySelector('#send-btn');
            const cancelBtn = app.mainBox?.querySelector('#cancel-btn');
            if (sendBtn) sendBtn.style.display = 'none';
            if (cancelBtn) {
                cancelBtn.style.display = 'flex';
                cancelBtn.onclick = () => ChatUI.exitSelectTextMode(app);
            }
        } catch (_) {}
    }

    static removeSelectModeBar() {
        try { document.getElementById('gpt-select-mode-bar')?.remove(); } catch (_) {}
    }

    static showCancelSelectButton(app, index) {
        const el = app._selectTextEl
            || document.querySelector('.gpt-message.assistant-message[data-select-mode="1"]')
            || document.querySelector('.gpt-message.assistant-message[data-msg-index="' + index + '"]');
        if (el) ChatUI.showSelectModeBar(app, index, el);
    }

    static exitSelectTextMode(app, index, cancelBtn) {
        const el = app._selectTextEl
            || document.querySelector('.gpt-message.assistant-message[data-select-mode="1"]')
            || (index != null ? document.querySelector('.gpt-message.assistant-message[data-msg-index="' + index + '"]') : null);

        if (el) {
            el.classList.remove('gpt-select-text-mode');
            el.removeAttribute('data-select-mode');
            el.style.userSelect = '';
            el.style.webkitUserSelect = '';
            el.style.background = '';
            el.style.color = '';
            el.style.maxHeight = '';
            el.style.overflow = '';
            el.querySelectorAll('.gpt-message-inner-holder, .gpt-oc-work, .gpt-oc-prose, .gpt-stream-prose, .part-text').forEach((n) => {
                n.style.userSelect = '';
                n.style.webkitUserSelect = '';
                n.style.maxHeight = '';
                n.style.overflow = '';
            });
            // Long-press listeners were never removed (no clone) — nothing to rebind
        }

        ChatUI.removeSelectModeBar();
        app.activateSelectMode = false;
        app._selectTextEl = null;
        app._selectTextIndex = null;
        try {
            const sendBtn = app.mainBox?.querySelector('#send-btn');
            const cBtn = cancelBtn || app.mainBox?.querySelector('#cancel-btn');
            if (cBtn) cBtn.style.display = 'none';
            if (sendBtn) sendBtn.style.display = 'flex';
        } catch (_) {}
        try { window.getSelection()?.removeAllRanges(); } catch (_) {}
    }
}
