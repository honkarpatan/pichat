// main/ui/AppUIManager.js
import { loginBoxHTML } from '../../data/loginBoxHTML.js'; // Adjust path if needed

export class AppUIManager {
    constructor(pluginContext) {
        this.app = pluginContext;
    }

    initSidebarSwipe() {
        const sidebar = document.querySelector(".modal-overlayy");
        if(!sidebar) return;
        let sidebarOpen = true, startX = 0, currentX = 0, isDragging = false;

        sidebar.addEventListener("touchstart", (e) => {
            if (e.target !== sidebar) return; 
            startX = e.touches[0].clientX;
            isDragging = true;
            sidebar.style.transition = "none"; 
        });

        sidebar.addEventListener("touchmove", (e) => {
            if (!isDragging) return;
            currentX = e.touches[0].clientX;
            let deltaX = currentX - startX;
            if (deltaX < 0) { 
                sidebar.style.transform = `translateX(${deltaX}px)`;
                if(this.app.popupManager) this.app.popupManager.closePopup();
            }
        });

        sidebar.addEventListener("touchend", () => {
            if (!isDragging) return;
            isDragging = false;
            sidebar.style.transition = "transform 0.3s ease-out"; 
            if (currentX - startX < -100) { 
                sidebar.classList.remove("gpt-show"); 
                sidebar.style.transform = "";
                sidebarOpen = false;
            } else {
                sidebar.style.transform = "";
                sidebar.classList.add("gpt-show");
            }
        });
    }

    addGoToTopButton(msg) {
        if (!msg.querySelector(".go-to-top-btn")) {
            const btn = document.createElement("button");
            btn.className = "go-to-top-btn";
            btn.innerHTML = `<svg width="16" height="16" viewBox="-0.5 0 25 25" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13.8599L10.87 10.8C11.0125 10.6416 11.1868 10.5149 11.3815 10.4282C11.5761 10.3415 11.7869 10.2966 12 10.2966C12.2131 10.2966 12.4239 10.3415 12.6185 10.4282C12.8132 10.5149 12.9875 10.6416 13.13 10.8L16 13.8599"/><path d="M3 7.41992L3 17.4199C3 19.6291 4.79086 21.4199 7 21.4199H17C19.2091 21.4199 21 19.6291 21 17.4199V7.41992C21 5.21078 19.2091 3.41992 17 3.41992H7C4.79086 3.41992 3 5.21078 3 7.41992Z"/></svg>`;
            btn.onclick = () => msg.scrollIntoView({ behavior: "smooth", block: "start" });
            msg.appendChild(btn);
        }
    }

    removeGoToTopButton(msg) {
        const btn = msg.querySelector(".go-to-top-btn");
        if (btn) btn.remove();
    }

    enableFontSizeEdit() {
        console.log('ENABLEFONTSIZEEDIT____________]');
        const fontSizeSetting = document.getElementById("fontSizeSetting");
        const chatBox = document.querySelector("#chat-box");
        if(!fontSizeSetting || !chatBox) return;
        
        fontSizeSetting.addEventListener("click", function () {
            if (fontSizeSetting.querySelector("input")) return; 
            const input = document.createElement("input");
            input.type = "number"; input.min = 10; input.max = 40;
            input.value = chatBox.style.fontSize.replace('px','') || 14;
            input.style = "width:80px; border:1px solid #ccc; padding:2px; border-radius:4px;";
            
            const oldText = fontSizeSetting.textContent;
            fontSizeSetting.replaceWith(input);
            input.focus();

            input.addEventListener("blur", function () {
                if (input.value.trim() && !isNaN(input.value)) {
                    chatBox.style.fontSize = `${input.value.trim()}px`;
                    fontSizeSetting.textContent = `Font Size: ${input.value.trim()}px`;
                } else {
                    fontSizeSetting.textContent = oldText;
                }
                input.replaceWith(fontSizeSetting);
            });
            input.addEventListener("keydown", e => { if (e.key === "Enter") input.blur(); });
        });
    }

    addCollapseChatHistory() {
        const historyContainer = document.getElementById("gpt-chats-history");
        if(!historyContainer) return;
        historyContainer.addEventListener("click", function (event) {
            const clickedElement = event.target;
            if (clickedElement.classList.contains("gpt-history-date-heading")) {
                let nextElement = clickedElement.nextElementSibling;
                while (nextElement && !nextElement.classList.contains("gpt-history-date-heading")) {
                    nextElement.style.display = nextElement.style.display === "none" ? "flex" : "none";
                    nextElement = nextElement.nextElementSibling;
                }
            }
        });
    }

    dynamicChatModelIconChange(imageUrl) {
        let dynamicStyle = document.getElementById('dynamic-assistant-style');
        if (!dynamicStyle) {
            dynamicStyle = document.createElement('style');
            dynamicStyle.id = 'dynamic-assistant-style';
            document.head.appendChild(dynamicStyle);
        }
        dynamicStyle.innerHTML = `.assistant-message::before { content: ''; display: block; width: 20px; height: 20px; background-color: transparent; background-image: url('${imageUrl}'); background-size: contain; position: absolute; top: -15px; left: 0; animation: fadeIn 0.5s ease-in-out; }`;
    }

    setupLoginModal(authManager) {
        this.app.loginBox = document.createElement("div");
        this.app.loginBox.classList.add('modal-overlayyy');
        this.app.loginBox.innerHTML = loginBoxHTML; // Ensure this is imported in this file
        document.body.appendChild(this.app.loginBox);

        this.app.loginBox.addEventListener("click", (e) => {
            if (e.target === this.app.loginBox) this.app.loginBox.classList.remove("gpt-show");
        });

        document.querySelector('.gpt-sign-page-close-gpt')?.addEventListener("click", () => this.app.loginBox.classList.remove("gpt-show"));

        document.getElementById('gpt-signup')?.addEventListener('click', () => {
            document.querySelector('.gpt-declaimer-message').style.display = 'none';
            document.querySelector('.gpt-signup-container').classList.replace("gpt-hide-navigate", "gpt-show-navigate");
            document.querySelector('.gpt-login-container').classList.replace("gpt-show-navigate", "gpt-hide-navigate");
        });

        document.getElementById('gpt-signin')?.addEventListener('click', () => {
            document.querySelector('.gpt-declaimer-message').style.display = 'block';
            document.querySelector('.gpt-signup-container').classList.replace("gpt-show-navigate", "gpt-hide-navigate");
            document.querySelector('.gpt-login-container').classList.replace("gpt-hide-navigate", "gpt-show-navigate");
        });

        document.querySelector('#gpt-login-button')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const gmail = document.getElementById('gpt-login-email').value;
            const token = document.getElementById('gpt-login-key').value;
            await authManager.gptLogin(gmail, token);
        });
    }
}