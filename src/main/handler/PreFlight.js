import { isBlock, checkTokenStatus } from '../../cloud/auth.js';
import {ConfigManager} from '../utils/ConfigManager.js';

export class PreFlight {
    static async run(app, regenHelper) {
        
        // 🟢 FIXED: Hardcoded App Version status to bypass Firebase checks
        if (!app.okAppVersion || app.okAppVersion === 'notOk') {
            app.okAppVersion = 'OK';
            ConfigManager.set('gpt-app-version-status', 'OK');
        }

        // 🟢 FIXED: Hardcoded Model Version status to bypass controls.js fetch
        if (!app.__MODELsVERSIONTEMP) {
            app.__MODELsVERSIONTEMP = 'Local.1.0';
        }

        // Keep User Block Checking (From auth.js)
        if (app.isUserBlock === null || app.isUserBlock === true) {
            await app.chatHandler.updateAssistantMessage(true, "Checking user's validity...");
            let isUserBlockStatus = null;
            try {
                isUserBlockStatus = await Promise.race([isBlock(app.lang_showing), new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 5000))]);
            } catch (e) {}
            
            app.isUserBlock = ConfigManager.get('gpt-is-user-blocked') === 'true';
            if(app.isUserBlock || isUserBlockStatus) {
                ConfigManager.set('gpt-is-user-blocked', 'true');
                throw new Error(`@@@!!!Account Blocked: Status 900`);
            } else {
                ConfigManager.set('gpt-is-user-blocked', 'false');
            }
        }

        // Keep Single Login Verification (From auth.js)
        if (app.loginStatus === null) {
            await app.chatHandler.updateAssistantMessage(true, 'Checking login status...');
            let ls = null;
            try {
                ls = await Promise.race([checkTokenStatus(ConfigManager.get('gpt-token'), app.lang_showing), new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 15000))]);
            } catch (e) {}

            if (ls === "logout") {
                ConfigManager.set('gpt-login-status', '008');
                throw new Error(`@@@!!!This user already logged in another device <br><button id="force-logout-btn">Log Out</button>`);
            } else if (ls === true) {
                ConfigManager.set('gpt-login-status', 'OK');
                app.loginStatus = 'OK';
            }
        }
    }
}