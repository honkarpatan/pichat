// COMPRESS MAIN SECURE 5.0 + 
import plugin from '../plugin.json';
import { getSettings, settingsList, onSettingsChange } from './settings.js';
import { AIChatPlugin } from './AIChatPlugin.js'; // moved your large class into this file
const { editor } = editorManager;
import './styles.css';
import './canvas.css';
import './model.css';
import './login.css';
import './response.css';
import './settings.css';
import './components.css';
import './extra.css';
import './opencode.css';
import { FimController } from './main/fim/FimController.js';

// const fileBrowser = acode.require("fileBrowser");
// const fs = acode.require("fs");
// const appSettings = acode.require('settings');

if (window.acode) {
  let __SETTINGS = getSettings();
  
  window.ACODE_FILE_STORAGE = CACHE_STORAGE.replace('/cache/','/files');
  
  const acodePlugin = new AIChatPlugin();
  acode.setPluginInit(plugin.id, async () => {
    if(!__SETTINGS.disable_aicode)
    await acodePlugin.init();
    try {
      FimController.init(acodePlugin.app || acodePlugin || window.app);
    } catch (e) {
      console.warn('[FIM] init failed', e);
    }
  }, {
    list: settingsList,
    cb: onSettingsChange
  });
  acode.setPluginUnmount(plugin.id, () => {
    try { FimController.destroy(); } catch (_) {}
    acodePlugin.destroy();
  });
}