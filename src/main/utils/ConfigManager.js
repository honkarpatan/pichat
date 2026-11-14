// src/main/utils/ConfigManager.js
export class ConfigManager {
    static STORAGE_KEY = 'AicodeGPT_SecureConfig';

    // ১. স্টোরেজ থেকে সব ডেটা একবারে আনা এবং ডিক্রিপ্ট করা
    static _getConfig() {
        try {
            let rawData = localStorage.getItem(this.STORAGE_KEY);
            if (!rawData) return {};
            
            if (rawData.startsWith("ENC::")) {
                const base64Data = rawData.substring(5);
                rawData = decodeURIComponent(escape(atob(base64Data)));
            }
            return JSON.parse(rawData);
        } catch (e) {
            console.error("Config parse error", e);
            return {};
        }
    }

    // ২. পুরো অবজেক্ট এনক্রিপ্ট করে এক জায়গায় সেভ করা
    static _saveConfig(configObj) {
        const jsonStr = JSON.stringify(configObj);
        const encrypted = "ENC::" + btoa(unescape(encodeURIComponent(jsonStr)));
        localStorage.setItem(this.STORAGE_KEY, encrypted);
    }

    // ৩. Get Item (পুরনো localStorage.getItem এর রিপ্লেসমেন্ট)
    static get(key, defaultValue = null) {
        const config = this._getConfig();
        return config[key] !== undefined ? config[key] : defaultValue;
    }

    // ৪. Set Item (পুরনো localStorage.setItem এর রিপ্লেসমেন্ট)
    static set(key, value) {
        const config = this._getConfig();
        config[key] = value;
        this._saveConfig(config);
    }

    // ৫. Remove Item
    static remove(key) {
        const config = this._getConfig();
        delete config[key];
        this._saveConfig(config);
    }
}