import { loginUser, logoutUser } from '../../../cloud/auth.js';
import { ConfigManager } from '../../utils/ConfigManager.js';

export class AuthManager {
    constructor(pluginContext) {
        this.app = pluginContext;
    }
    
    registerCommands() {
    if (window.editorManager && editorManager.editor) {
        editorManager.editor.commands.addCommand({
            name: 'toggle_aicode_gpt',
            description: 'AICode GPT : Launch',
            // bindKey: { win: 'Ctrl-Alt-G', mac: 'Command-Alt-G' },
            exec: async () => {
                await this.toggleChatModal()
            }
        });
    }
}


    async gptLogin(gmail, token) {
        console.log('GPTLOGIN____________]');
        let currentEmail = await loginUser(gmail, token);
        
        if(currentEmail) {
            this.app.lang_showing = currentEmail;
            await this.gptUpToDate(currentEmail);
            if(this.app.storageManager) await this.app.storageManager.pathCheck();
            
            // UI Toggle called after everything is safely loaded
            await this.toggleChatModal(); 
        }
    }

    async gptLogout() {
        console.log('GPTLOGOUT_____________]');
        await logoutUser();
        this.app.destroy();
        this.toggleChatModal();
        window.toast('Restart App after LogOut');
    }

    async getNameAndEmail() {
        // console.log('GETNAMEANDEMAIL_____________]');
        const gptIconDiv = document.querySelector('.gpt-bottom-sidebar-box .gpt-user-box .gpt-user-icon div');
        const gptUserNameDiv = document.querySelector('.gpt-user-name');
        
        const currentGptUserEmail = ConfigManager.get('current-gpt-user-email');
        const currentGptUserName = ConfigManager.get('current-gpt-user-name');

        if(currentGptUserEmail && currentGptUserEmail[0] && currentGptUserEmail !== 'null') {
            let firstWord = currentGptUserEmail[0].toUpperCase();
            if(gptIconDiv) gptIconDiv.innerHTML = firstWord;
        }

        if(gptUserNameDiv) gptUserNameDiv.innerText = currentGptUserName || 'User';

        if(this.app.pathUrl !== null && this.app.pathUrl !== '') {
            if(this.app.storageManager) await this.app.storageManager.userCheck();
        }
    }

    async gptUpToDate(email = null) {
        this.app.usage_limit = '0'; // No limits
        ConfigManager.set('updateTokenWhen', '0.8'); 
    }

    async toggleChatModal() {
        // console.log('TOGGLECHATMODAL____________]');
        this.app.lang_showing = ConfigManager.get('current-gpt-user-email');
        
        if (this.app.lang_showing && this.app.lang_showing !== 'null') {
            //  Safely Close Login Box
            if(this.app.loginBox) {
                this.app.loginBox.classList.remove("gpt-show");
                this.app.loginBox.style.display = "none";
            }
            
            //Safely Open Main Box
            if(this.app.mainBox) {
                this.app.mainBox.style.display = "flex";
                this.app.mainBox.classList.add("gpt-show"); 
            }
            
            await this.getNameAndEmail();
            
            //  Safe check for allModels (Prevents App Crash!)
            if (!this.app.allModels || this.app.allModels.length === 0) {
                console.warn('[System] Models empty. Requesting reload.');
                if (this.app.storageManager) await this.app.storageManager.modelsCheck();
            }
            
        } else {
            // User Not Logged In
            if(this.app.mainBox) {
                this.app.mainBox.classList.remove("gpt-show");
                this.app.mainBox.style.display = "none";
            }
            if(this.app.loginBox) {
                this.app.loginBox.style.display = "flex";
                setTimeout(() => this.app.loginBox.classList.add("gpt-show"), 50); // Smooth animation
            }
        }
    }
    
    
    
    
    
    
}