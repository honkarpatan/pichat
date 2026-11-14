// src/main/ui/PopupManager.js
export class PopupManager {
    constructor(pluginContext) {
        this.app = pluginContext; 
    }

    // ==========================================
    // 1. Image Click Popup
    // ==========================================
    setupImagePopup() {
        // Bind once — re-render used to stack listeners
        if (this._imagePopupBound) return;
        this._imagePopupBound = true;

        document.body.addEventListener("click", (event) => {
            const popup = document.querySelector("#image-popup");
            if (popup && !popup.contains(event.target) && !event.target.closest?.("img")) {
                popup.remove();
            }

            // Any chat message image → full-screen preview + download
            const img = event.target.closest?.("img");
            if (!img) return;
            // Skip UI chrome icons / favicons
            if (img.classList.contains("gpt-web-favicon") || img.closest(".gpt-canvas-btn, .gpt-agent-step, .gpt-perm-header")) return;
            // Prefer chat message area
            const inChat = img.closest(".assistant-message, .user-message, .gpt-message-inner-holder, #chat-box, .chat-box");
            if (!inChat && !img.classList.contains("gpt-result-img") && !img.classList.contains("study-gallery")) return;

            event.preventDefault();
            event.stopPropagation();
            if (typeof this.showImageInModal === "function") {
                this.showImageInModal(img.currentSrc || img.src);
            } else {
                this.showImagePopup(img);
            }
        });

        if (this.app.chatBox) {
            this.app.chatBox.addEventListener("scroll", () => {
                const popup = document.querySelector("#image-popup");
                if (popup) popup.remove();
            });
        }
    }

    /** Tag response images so they are clearly clickable */
    tagChatImages(root) {
        const scope = root || this.app.chatBox || document;
        scope.querySelectorAll?.("img").forEach((img) => {
            if (img.classList.contains("gpt-web-favicon")) return;
            if (img.closest(".gpt-canvas-btn, .gpt-agent-step")) return;
            img.classList.add("gpt-result-img");
            img.style.cursor = "pointer";
        });
    }

    showImagePopup(imageElement) {
        const existingPopup = document.querySelector("#image-popup");
        if (existingPopup) existingPopup.remove();

        const imageUrl = imageElement.src;
        const popup = document.createElement("div");
        popup.id = "image-popup";
        popup.style.position = "absolute";
        popup.style.top = `${imageElement.getBoundingClientRect().bottom + window.scrollY + 5}px`;
        popup.style.left = `${imageElement.getBoundingClientRect().left + window.scrollX}px`;
        popup.style.background = "#fff";
        popup.style.border = "1px solid #ccc";
        popup.style.borderRadius = "5px";
        popup.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.2)";
        popup.style.padding = "10px";
        popup.style.zIndex = "1000";

        popup.innerHTML = `
            <div style="margin-bottom: 5px;">
            <a href="${imageUrl}" target="_blank" style="text-decoration: none;padding: 5px 10px; color: #5375fb;">Go to Link</a>
            </div>
            <button id="copy-link-btn" style="background: #5375fb; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Copy Link</button>
        `;

        document.body.appendChild(popup);

        document.querySelector("#copy-link-btn").addEventListener("click", () => {
            navigator.clipboard.writeText(imageUrl).then(() => {
                window.toast("Link copied to clipboard!", 2000);
            });
        });
    }

    // ==========================================
    // 2. Chat History 3-Dot Options Menu
    // ==========================================
    showOptionsMenu(index, event) {
        const existingMenu = document.querySelector('.options-menu');
        if (existingMenu) existingMenu.remove();

        const optionsMenu = document.createElement('div');
        optionsMenu.classList.add('options-menu');
        
        const renameOption = document.createElement('div');
        renameOption.classList.add('options-item');
        renameOption.innerHTML = `<span class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="margin-right:10px;"><path d="M3 21h18v-2H3v2zm2.586-5l10.293-10.293 2.828 2.828L8.414 18H5v-2.414zM21.707 7.707l-2.828-2.828a1 1 0 0 0-1.414 0L16.293 6.172l4.242 4.242 1.414-1.414a1 1 0 0 0 0-1.414z" fill="#4d4d4d"></path></svg></span>Rename`;
        renameOption.addEventListener('click', async() => {
            await this.app.chatHistoryManager.renameConversationListHistory(index);
            optionsMenu.remove(); 
        });

        const deleteOption = document.createElement('div');
        deleteOption.classList.add('options-item');
        deleteOption.innerHTML = `<span class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="margin-right:10px;"><path d="M16 9v10H8V9h8zm-1.5-5h-5l-1 1H5v2h14V5h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z" fill="#4d4d4d"></path></svg></span>Delete`;
        deleteOption.addEventListener('click', async() => {
            optionsMenu.remove(); 
            if (this.app.conversations.length != 1) {
                await this.app.chatHistoryManager.deleteConversationListHistory(index);
                if(typeof this.app.startNewConversation === 'function') await this.app.startNewConversation();
            } else {
                window.toast('Cannot Be Deleted!');
            }
        });

        optionsMenu.appendChild(renameOption);
        optionsMenu.appendChild(deleteOption);
        document.body.appendChild(optionsMenu);

        const rect = event.target.getBoundingClientRect();
        optionsMenu.style.top = `${rect.top + window.scrollY + 20}px`;
        optionsMenu.style.left = `${rect.left + window.scrollX}px`;

        const hideMenu = (e) => {
            if (!optionsMenu.contains(e.target) && !event.target.contains(e.target)) {
                optionsMenu.remove();
                document.removeEventListener('click', hideMenu);
            }
        };
        document.addEventListener('click', hideMenu);
    }

    // ==========================================
    // 3. Feedback Modal
    // ==========================================
    showFeedbackModal(user_msg, assistant_msg) {
        const overlay = document.createElement('div');
        overlay.id = 'gpt-feedback-overlay';
        
        const modal = document.createElement('div');
        modal.classList.add('gpt-feedback-container');
        modal.innerHTML = `
            <h4 style="padding:12px;">Provide Feedback</h4>
            <div class="feedback-container-primary-part">
                <textarea id="gpt-feedback-text" rows="4" placeholder="What was the issue with the response? How could it be improved?"></textarea>
            </div>
            <div class="feedback-container-secondary-part">
                <label><input type="checkbox" id="feedback-unsafe"> This is harmful/unsafe</label>
                <label><input type="checkbox" id="feedback-untrue"> This isn't true</label>
                <label><input type="checkbox" id="feedback-unhelpful"> This isn't helpful</label><br>
                <button id="gpt-submit-feedback">Submit</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeFeedbackModal();
        });

        document.getElementById('gpt-submit-feedback').addEventListener('click', async () => {
            if(typeof this.app.submitFeedback === 'function') await this.app.submitFeedback(user_msg, assistant_msg);
            this.closeFeedbackModal();
        });
    }

    closeFeedbackModal() {
        const overlay = document.getElementById('gpt-feedback-overlay');
        if (overlay) document.body.removeChild(overlay);
    }

    // ==========================================
    // 4. User Message Long Press Popup
    // ==========================================
    showUserPopup(x, y, index) {
        const messageHolder = document.querySelectorAll('.gpt-message-inner-holder')[index];
        if (!messageHolder) return;

        const hasImage = messageHolder.querySelector("img") !== null;

        const popup = document.createElement('div');
        popup.className = 'popup-options';
        popup.style.left = `${x}px`;
        popup.style.top = `${y}px`;

        const optionIcons = {
            'Preview': `<svg fill="grey" width="16" height="16" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M14.474 10.002c-1.1 0-2.157.462-2.966 1.195-.925.84-1.508 2.047-1.508 3.294 0 .665 1 .688 1 .024 0-.965.466-1.93 1.182-2.58.627-.57 1.47-.908 2.318-.934.655 0 .672-.998-.026-.998zM15 8c-3.86 0-7 3.14-7 7s3.14 7 7 7 7-3.14 7-7-3.14-7-7-7zm0 1c3.32 0 6 2.68 6 6s-2.68 6-6 6-6-2.68-6-6 2.68-6 6-6zm0-3c-4.883 0-8.625 1.953-11.13 4.02-1.254 1.033-2.2 2.095-2.843 2.968-.32.437-.565.826-.736 1.15-.17.325-.29.52-.29.862 0 .34.12.537.29.86.172.326.416.715.737 1.152.642.873 1.59 1.935 2.842 2.968C6.374 22.047 10.116 24 15 24c4.883 0 8.625-1.953 11.13-4.02 1.254-1.033 2.2-2.095 2.843-2.968.32-.437.565-.826.736-1.15.17-.325.29-.52.29-.862 0-.34-.12-.537-.29-.86-.172-.326-.416-.715-.737-1.152-.642-.873-1.59-1.935-2.842-2.968C23.626 7.953 19.884 6 15 6zm0 1c4.617 0 8.125 1.838 10.494 3.79 1.185.978 2.082 1.984 2.674 2.79.296.403.515.758.656 1.024.175.327.136.55 0 .792-.147.263-.36.62-.656 1.024-.592.806-1.49 1.812-2.674 2.79C23.124 21.16 19.617 23 15 23s-8.125-1.838-10.494-3.79c-1.185-.978-2.082-1.984-2.674-2.79-.296-.403-.51-.76-.656-1.024-.14-.25-.17-.485 0-.792.145-.264.36-.62.656-1.024.592-.806 1.49-1.812 2.674-2.79C6.876 8.84 10.383 7 15 7z"/></svg>`,
            'Edit': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M20.8477 1.87868C19.6761 0.707109 17.7766 0.707105 16.605 1.87868L2.44744 16.0363C2.02864 16.4551 1.74317 16.9885 1.62702 17.5692L1.03995 20.5046C0.760062 21.904 1.9939 23.1379 3.39334 22.858L6.32868 22.2709C6.90945 22.1548 7.44285 21.8693 7.86165 21.4505L22.0192 7.29289C23.1908 6.12132 23.1908 4.22183 22.0192 3.05025L20.8477 1.87868ZM18.0192 3.29289C18.4098 2.90237 19.0429 2.90237 19.4335 3.29289L20.605 4.46447C20.9956 4.85499 20.9956 5.48815 20.605 5.87868L17.9334 8.55027L15.3477 5.96448L18.0192 3.29289ZM13.9334 7.3787L3.86165 17.4505C3.72205 17.5901 3.6269 17.7679 3.58818 17.9615L3.00111 20.8968L5.93645 20.3097C6.13004 20.271 6.30784 20.1759 6.44744 20.0363L16.5192 9.96448L13.9334 7.3787Z"/></svg>`,
            'Copy': `<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`
        };

        const options = ['Edit', 'Copy'];
        if (hasImage) options.unshift('Preview');

        options.forEach(option => {
            const optionElement = document.createElement('div');
            optionElement.className = 'popup-option';

            const iconSpan = document.createElement('span');
            iconSpan.innerHTML = optionIcons[option];

            const textSpan = document.createElement('span');
            textSpan.textContent = option;

            optionElement.appendChild(iconSpan);
            optionElement.appendChild(textSpan);

            optionElement.onclick = () => this.handleUserPopupOption(option, index);
            popup.appendChild(optionElement);
        });

        this.closePopup();
        document.body.appendChild(popup);

        document.addEventListener('click', () => this.closePopup(), { once: true });
        
        if (this.app.chatBox) {
            this.app.chatBox.addEventListener('scroll', () => this.closePopup());
        }
    }

    handleUserPopupOption(option, index) {
        if (option === 'Edit' && this.app.activateSelectMode === false) {
            if(typeof this.editMessage === 'function') this.editMessage(index, this.app.chatHistory[index].content);
        } else if (option === 'Copy') {
            const messageContent = this.app.chatHistory[index].content;
            navigator.clipboard.writeText(messageContent);
        } else if (option === 'Preview') {
            if(typeof this.previewImage === 'function') this.previewImage(index);
        }

        this.closePopup(); 
    }

    // ==========================================
    // 5. Assistant Message Long Press Popup
    // ==========================================
    showPopup(x, y, index) {
        const popup = document.createElement('div');
        popup.className = 'popup-options';
        popup.style.left = `${x}px`;
        popup.style.top = `${y}px`;

        const optionIcons = {
            'Copy': `<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M0 0h24v24H0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
            'Insert Into Code': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3 5C3 4.44772 3.44772 4 4 4H7C8.65685 4 10 5.34315 10 7V10C10 10.3506 9.93985 10.6872 9.82929 11H10C11.6569 11 13 12.3431 13 14V17C13 18.6569 11.6569 20 10 20H4C3.44772 20 3 19.5523 3 19C3 18.4477 3.44772 18 4 18H10C10.5523 18 11 17.5523 11 17V14C11 13.4477 10.5523 13 10 13H7H4C3.44772 13 3 12.5523 3 12C3 11.4477 3.44772 11 4 11H7C7.55229 11 8 10.5523 8 10V7C8 6.44772 7.55229 6 7 6H4C3.44772 6 3 5.55228 3 5ZM17.4142 15L18.7071 13.7071C19.0976 13.3166 19.0976 12.6834 18.7071 12.2929C18.3166 11.9024 17.6834 11.9024 17.2929 12.2929L14.2929 15.2929C13.9024 15.6834 13.9024 16.3166 14.2929 16.7071L17.2929 19.7071C17.6834 20.0976 18.3166 20.0976 18.7071 19.7071C19.0976 19.3166 19.0976 18.6834 18.7071 18.2929L17.4142 17H21C21.5523 17 22 16.5523 22 16C22 15.4477 21.5523 15 21 15H17.4142Z"/></svg>`,
            'Select Text': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.00001 4.10999C6.14022 4.33198 5.37874 4.83376 4.83558 5.53625C4.29241 6.23875 3.99845 7.10201 4.00001 7.98999V17.99C4.00001 19.0509 4.42149 20.0682 5.17164 20.8184C5.92178 21.5685 6.93914 21.99 8.00001 21.99H16C17.0609 21.99 18.0783 21.5685 18.8284 20.8184C19.5786 20.0682 20 19.0509 20 17.99V7.98999C19.9993 7.10372 19.7044 6.24269 19.1614 5.54224C18.6184 4.84178 17.8581 4.34156 17 4.12" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 5.98999C8.46957 5.98999 7.96089 5.77925 7.58582 5.40417C7.21074 5.0291 7 4.52042 7 3.98999C7 3.45956 7.21074 2.95088 7.58582 2.57581C7.96089 2.20073 8.46957 1.98999 9 1.98999H15C15.5304 1.98999 16.0392 2.20073 16.4142 2.57581C16.7893 2.95088 17 3.45956 17 3.98999C17 4.52042 16.7893 5.0291 16.4142 5.40417C16.0392 5.77925 15.5304 5.98999 15 5.98999H9Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 16H14" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12H16" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
            'Regenerate': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.9381 13C19.979 12.6724 20 12.3387 20 12C20 7.58172 16.4183 4 12 4C9.49942 4 7.26681 5.14727 5.7998 6.94416M4.06189 11C4.02104 11.3276 4 11.6613 4 12C4 16.4183 7.58172 20 12 20C14.3894 20 16.5341 18.9525 18 17.2916M15 17H18V17.2916M5.7998 4V6.94416M5.7998 6.94416V6.99993L8.7998 7M18 20V17.2916" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
            'Bad Response': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.52 5.65002L13.42 3.25002C13.02 2.85002 12.12 2.65002 11.52 2.65002H7.71998C6.51998 2.65002 5.21998 3.55002 4.91998 4.75002L2.51998 12.05C2.01998 13.45 2.91998 14.65 4.41998 14.65H8.41998C9.01998 14.65 9.51998 15.15 9.41998 15.85L8.91998 19.05C8.71998 19.95 9.31998 20.95 10.22 21.25C11.02 21.55 12.02 21.15 12.42 20.55L16.52 14.45" stroke-width="1.5" stroke-miterlimit="10"/><path d="M21.62 5.65V15.45C21.62 16.85 21.02 17.35 19.62 17.35H18.62C17.22 17.35 16.62 16.85 16.62 15.45V5.65C16.62 4.25 17.22 3.75 18.62 3.75H19.62C21.02 3.75 21.62 4.25 21.62 5.65Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        };

        const options = ['Copy', 'Select Text', 'Regenerate', 'Bad Response', 'Insert Into Code'];
        options.forEach(option => {
            const optionElement = document.createElement('div');
            optionElement.className = 'popup-option';

            const iconSpan = document.createElement('span');
            iconSpan.innerHTML = optionIcons[option];

            const textSpan = document.createElement('span');
            textSpan.textContent = option;

            optionElement.appendChild(iconSpan);
            optionElement.appendChild(textSpan);

            optionElement.onclick = async () => await this.handlePopupOption(option, index);
            popup.appendChild(optionElement);
        });

        this.closePopup();
        document.body.appendChild(popup);
        document.addEventListener('click', () => this.closePopup(), { once: true });
    }

    async handlePopupOption(option, index) {
        const userMessage = document.querySelector(`.gpt-message.user-message:nth-child(${index})`); 
        const messageElement = document.querySelector(`.gpt-message.assistant-message:nth-child(${index + 1})`); 

        if (option === 'Copy') {
            this.closePopup();
            // Assuming removeThinkTags is accessible via app context, e.g. Formatter.removeThinkTags
            let messageContent = this.app.chatHistory[index].content;
            if (this.app.Formatter && typeof this.app.Formatter.removeThinkTags === 'function') {
                messageContent = this.app.Formatter.removeThinkTags(messageContent);
            } else if (typeof this.app.removeThinkTags === 'function') {
                messageContent = this.app.removeThinkTags(messageContent);
            }
            navigator.clipboard.writeText(messageContent);

        } else if (option === 'Select Text') {
            this.closePopup();
            // Resolve message by data-msg-index / class (nth-child is unreliable)
            let el = messageElement;
            if (!el) {
                el = document.querySelector(`.gpt-message.assistant-message[data-msg-index="${index}"]`)
                    || document.querySelectorAll('.gpt-message.assistant-message')[Math.floor(index / 2)]
                    || null;
            }
            try {
                const { ChatUI } = await import('./ChatUI.js');
                if (el) ChatUI.enterSelectTextMode(this.app, el, index);
                else if (typeof this.app.showCancelSelectButton === 'function') this.app.showCancelSelectButton(index);
            } catch (_) {
                if (el) {
                    el.style.userSelect = 'text';
                    el.style.background = 'rgba(21, 89, 185, 0.18)';
                }
            }

        } else if (option === 'Regenerate') {
            this.closePopup();
            await this.regenerateAt(index);

        } else if (option === 'Bad Response') {
            this.showFeedbackModal(userMessage, messageElement); 
        } else if (option === 'Insert Into Code') {
            this.closePopup();
            let messageContent = this.app.chatHistory[index].content;
            if (this.app.Formatter && typeof this.app.Formatter.removeThinkTags === 'function') {
                messageContent = this.app.Formatter.removeThinkTags(messageContent);
            } else if (typeof this.app.removeThinkTags === 'function') {
                messageContent = this.app.removeThinkTags(messageContent);
            }
            
            if(typeof this.app.insertIntoCode === 'function') this.app.insertIntoCode(messageContent);
        }
    }

    // Helper to clear options
    closePopup() {
        // console.log('CLOSEPOPUP_____________]');
        const popups = document.querySelectorAll('.popup-options');
        if (popups.length > 0) {
            popups.forEach(popup => popup.remove());
        } else {
            // console.log('pop up not found ');
        }
    }
    
    
    // ==========================================
    // 6. Full-Screen Image Viewer Modal
    // ==========================================
    // 🟢 PRO FIX: Modern Full-Screen Modal with Safe Download
    async showImageInModal(imageUrl) {
        const overlay = document.createElement('div');
        overlay.id = 'gpt-image-overlay';
        overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:999999; display:flex; flex-direction:column; align-items:center; justify-content:center; backdrop-filter:blur(8px); cursor:zoom-out; opacity:0; transition:opacity 0.3s ease;";

        // Close on background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => document.body.removeChild(overlay), 300);
            }
        });

        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.cssText = "max-width:90%; max-height:80%; border-radius:12px; box-shadow:0 15px 40px rgba(0,0,0,0.6); object-fit:contain; transform:scale(0.9); transition:transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);";
        
        // Error fallback
        img.onerror = () => { img.src = 'https://static-00.iconduck.com/assets.00/delete-icon-468x512-xo4vopq8.png'; };

        const downloadButton = document.createElement('button');
        downloadButton.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 6V18M12 18L7 13M12 18L17 13" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> <span style="margin-left:8px;">Download</span>`;
        downloadButton.style.cssText = "margin-top:20px; background:#4b5dd1; color:#fff; border:none; padding:10px 20px; border-radius:30px; font-size:14px; font-weight:bold; cursor:pointer; display:flex; align-items:center; box-shadow:0 4px 15px rgba(75, 93, 209, 0.4); transition:0.2s;";
        
        // Hide download button for data: URIs as they are hard to process securely without Blob conversion
        if (imageUrl && imageUrl.startsWith('data:')) {
            downloadButton.style.display = 'none';
        }

        downloadButton.addEventListener('click', async (e) => {
            e.stopPropagation(); // Stop overlay click
            
            if (typeof window.toast === 'function') window.toast('Downloading image...', 2000);
            
            try {
                if (imageUrl.startsWith('file:///')) {
                    if (this.app.storageManager) await this.app.storageManager.DownloadCheck();
                    const fs = acode.require("fs");
                    const downloadDir = 'file:///storage/emulated/0/Download';
                    if (await fs(downloadDir).exists()) {
                        await fs(imageUrl).copyTo(downloadDir);
                        if (typeof window.toast === 'function') window.toast(`Saved to Downloads folder! √`, 2000);
                    }
                } else {
                    // Download Web Image
                    const a = document.createElement('a');
                    a.href = imageUrl;
                    a.download = `Aicode_Generated_Image_${Date.now()}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    if (typeof window.toast === 'function') window.toast('Downloaded Successfully √', 2000);
                }
            } catch (err) {
                if (typeof window.toast === 'function') window.toast('Download Failed!', 2000);
                console.error("Download Error:", err);
            }
        });

        overlay.appendChild(img);
        overlay.appendChild(downloadButton);
        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => { 
            overlay.style.opacity = '1'; 
            img.style.transform = 'scale(1)'; 
        });
    }

    previewImage(index) {
        const messageHolder = document.querySelectorAll('.gpt-message-inner-holder')[index];
        if (!messageHolder) return;
        const img = messageHolder.querySelector("img");
        if (!img) return;
        this.showImageInModal(img.src);
    }

    // ==========================================
    // 7. Edit Message Modal
    // ==========================================
    /**
     * Regenerate: keep the user prompt, drop assistant(+anything after), resend without
     * appending a second user bubble. Fixes abort→regenerate turning AI text into user msg.
     */
    async regenerateAt(index) {
        const chat = this.app.chatHistory || [];
        let i = parseInt(index, 10);
        if (!Number.isFinite(i) || i < 0) i = chat.length - 1;
        if (i >= chat.length) i = chat.length - 1;

        let userIdx = i;
        while (userIdx > 0 && chat[userIdx]?.role !== 'user') userIdx--;
        if (chat[userIdx]?.role !== 'user') {
            userIdx = chat.map(m => m?.role).lastIndexOf('user');
        }
        if (userIdx < 0 || !chat[userIdx]) {
            console.warn('[PopupManager] regenerate: no user message found');
            return;
        }

        let userOldInput = chat[userIdx].content;
        try {
            const { restoreAttachmentsFromContent } = await import('../utils/message/AttachmentRestore.js');
            const restored = restoreAttachmentsFromContent(this.app, userOldInput);
            userOldInput = restored.text || '';
        } catch (_) {
            this.app.isUserSelectedImageUrl = null;
            if (Array.isArray(userOldInput)) {
                const textItem = userOldInput.find(item => item.type === 'text');
                userOldInput = textItem ? textItem.text : '';
            } else {
                userOldInput = String(userOldInput || '');
            }
        }
        // Allow image-only / file-only messages
        if (!String(userOldInput || '').trim() && !(this.app.attachedFiles && this.app.attachedFiles.length)) return;

        try {
            const { BranchHistory } = await import('../utils/agent/BranchHistory.js');
            BranchHistory.commitRegenerate(this.app, userIdx);
            try {
                const { HistoryFileOps } = await import('../history/HistoryFileOps.js');
                await HistoryFileOps.saveActiveChat(this.app);
            } catch (_) {}
            await this.app.chatHistoryManager?.renderChatHistory?.();
        } catch (e) {
            console.warn('[regenerateAt branch]', e);
            // fallback: truncate
            if (this.app.chatHistoryManager) {
                await this.app.chatHistoryManager.deleteMessagesAfter(userIdx);
            }
        }

        if (this.app.chatHandler) {
            await this.app.chatHandler.handleSendMessage(userOldInput, { regenerate: true });
        }
    }

    /** Switch branch version on the owning user message (edit/regenerate history). */
    async switchVariant(asstOrUserIndex, delta) {
        try {
            const { BranchHistory } = await import('../utils/agent/BranchHistory.js');
            const chat = this.app.chatHistory || [];
            let userIdx = parseInt(asstOrUserIndex, 10);
            if (chat[userIdx]?.role !== 'user') {
                userIdx = BranchHistory.findUserIdx(chat, userIdx);
            }
            if (userIdx < 0) return;
            await BranchHistory.switchBranch(this.app, userIdx, delta);
        } catch (e) {
            console.warn('[switchVariant]', e);
        }
    }

    /**
     * Edit user prompt — does NOT delete history until user sends.
     * Cancel restores the hidden turn (prompt + response).
     */
    editMessage(index, originalContent) {
        let userOldInput = originalContent;
        // Inline restore (editMessage is synchronous — no await)
        try {
            const files = [];
            let text = '';
            if (typeof userOldInput === 'string') {
                text = userOldInput;
            } else if (Array.isArray(userOldInput)) {
                for (const item of userOldInput) {
                    if (!item) continue;
                    if (item.type === 'text' && item.text != null) text += (text ? '\n' : '') + item.text;
                    else if (item.type === 'image_url' && item.image_url?.url) {
                        files.push({ type: 'image', name: item.name || 'image', data: item.image_url.url });
                    } else if (item.type === 'file') {
                        files.push({ type: 'text', name: item.name || 'file', data: item.text || item.data || '' });
                    }
                }
            } else {
                text = String(userOldInput ?? '');
            }
            this.app.attachedFiles = files;
            this.app.isUserSelectedImageUrl = files.find(f => f.type === 'image')
                ? { url: files.find(f => f.type === 'image').data, type: 'image_url' }
                : null;
            userOldInput = text;
            try { this.app.chatModalSetup?.renderFilePreviews?.(); } catch (_) {}
        } catch (_) {
            this.app.isUserSelectedImageUrl = null;
            userOldInput = String(userOldInput ?? '');
        }

        const chat = this.app.chatHistory || [];
        let userIdx = parseInt(index, 10);
        if (!Number.isFinite(userIdx) || userIdx < 0) userIdx = chat.map(m => m?.role).lastIndexOf('user');
        while (userIdx > 0 && chat[userIdx]?.role !== 'user') userIdx--;
        if (userIdx < 0) userIdx = 0;

        const text = userOldInput.trim();

        // Soft-edit: keep history; snapshot + hide DOM until send or cancel
        try {
            const slice = (this.app.chatHistory || []).slice(userIdx);
            this.app._editDraft = {
                userIdx,
                snapshot: JSON.parse(JSON.stringify(slice)),
                text
            };
        } catch (_) {
            this.app._editDraft = { userIdx, snapshot: null, text };
        }

        // Hide this turn's bubbles in the chat UI (not deleted)
        try {
            const nodes = this.app.chatBox?.querySelectorAll?.('.gpt-message');
            if (nodes) {
                for (let i = userIdx; i < nodes.length; i++) {
                    nodes[i].style.display = 'none';
                    nodes[i].dataset.editHidden = '1';
                }
            }
        } catch (_) {}

        const input = document.getElementById('gpt-user-input');
        if (input) {
            input.value = text;
            input.focus();
            try {
                input.setSelectionRange(input.value.length, input.value.length);
            } catch (_) {}
            if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
        }

        this.showEditDraftBar(text);

        try {
            this.app.currentRequestController?.abort?.();
        } catch (_) {}
    }

    /** Restore messages hidden by edit; clear input. */
    cancelEditDraft() {
        const draft = this.app._editDraft;
        document.getElementById('gpt-edit-draft-bar')?.remove();

        // Unhide any soft-hidden message nodes
        try {
            this.app.chatBox?.querySelectorAll?.('.gpt-message[data-edit-hidden="1"]').forEach(el => {
                el.style.display = '';
                delete el.dataset.editHidden;
            });
        } catch (_) {}

        // If history was already deleted (legacy path), restore snapshot
        if (draft?.snapshot && Array.isArray(draft.snapshot)) {
            try {
                const convIdx = parseInt(this.app.currentConversationIndex, 10);
                const conv = this.app.conversations?.[convIdx];
                const chat = conv?.chat || this.app.chatHistory || [];
                // Only restore if those messages are missing
                const stillThere = chat.length > draft.userIdx
                    && JSON.stringify(chat[draft.userIdx]?.content) === JSON.stringify(draft.snapshot[0]?.content);
                if (!stillThere && conv) {
                    conv.chat = chat.slice(0, draft.userIdx).concat(draft.snapshot);
                    this.app.chatHistory = [...conv.chat];
                    this.app.chatHistoryManager?.renderChatHistory?.();
                }
            } catch (e) {
                console.warn('[cancelEditDraft] restore', e);
            }
        }

        const input = document.getElementById('gpt-user-input');
        if (input) {
            input.value = '';
            if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
        }
        this.app.isUserSelectedImageUrl = null;
        this.app._editDraft = null;
    }

    /** Thin bar above input: truncated italic prompt + Cancel. */
    showEditDraftBar(fullText) {
        document.getElementById('gpt-edit-draft-bar')?.remove();
        const text = String(fullText || '');
        if (!text) return;

        const MAX = 72;
        const shown = text.length > MAX ? text.slice(0, MAX) : text;
        const bar = document.createElement('div');
        bar.id = 'gpt-edit-draft-bar';
        bar.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:10px',
            'padding:6px 10px',
            'width:100%',
            'box-sizing:border-box',
            'background:var(--secondary-color,#1e1e2e)',
            'border-bottom:1px solid var(--border-color,#333)',
            'font-size:12px',
            'color:var(--primary-text-color)'
        ].join(';');

        const preview = document.createElement('div');
        preview.style.cssText = [
            'flex:1',
            'min-width:0',
            'font-style:italic',
            'opacity:0.55',
            'overflow:hidden',
            'white-space:nowrap',
            'position:relative'
        ].join(';');
        preview.textContent = shown;
        if (text.length > MAX) {
            preview.style.maskImage = 'linear-gradient(90deg, #000 70%, transparent 100%)';
            preview.style.webkitMaskImage = 'linear-gradient(90deg, #000 70%, transparent 100%)';
        }

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.style.cssText = 'flex-shrink:0;padding:4px 10px;border-radius:6px;border:1px solid var(--border-color,#555);background:transparent;color:var(--primary-text-color);cursor:pointer;font-size:11px;opacity:0.85;';
        cancel.onclick = () => this.cancelEditDraft();

        bar.appendChild(preview);
        bar.appendChild(cancel);

        const inputEl = document.getElementById('input-container');
        if (inputEl?.parentElement) {
            inputEl.parentElement.insertBefore(bar, inputEl);
        } else {
            document.body.appendChild(bar);
        }
    }

}
