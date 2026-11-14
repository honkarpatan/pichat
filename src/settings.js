import plugin from '../plugin.json';
const appSettings = acode.require('settings');
import {AIChatPlugin} from './AIChatPlugin.js' ;
// Default setting values
const defaultSettings = {
  disable_aicode: false ,
  aicode_path_url: null,
};

function getSettings() {
  let pluginSettings = appSettings.value[plugin.id];

  // Initialize if missing
  if (!pluginSettings) {
    pluginSettings = { ...defaultSettings };
    appSettings.value[plugin.id] = pluginSettings;
    appSettings.update();
    return pluginSettings;
  }

  // Sync keys if defaultSettings changed
  let changed = false;

  // Add missing keys
  for (const key in defaultSettings) {
    if (!(key in pluginSettings)) {
      pluginSettings[key] = defaultSettings[key];
      changed = true;
    }
  }

  // Remove unknown/obsolete keys
  for (const key in pluginSettings) {
    if (!(key in defaultSettings)) {
      delete pluginSettings[key];
      changed = true;
    }
  }

  if (changed) appSettings.update();

  return pluginSettings;
}


// Settings list for the Acode plugin UI
const settingsList = [
  {
    key: 'disable_aicode',
    text: 'Disable Aicode GPT',
    checkbox: getSettings().disable_aicode,
    value: getSettings().disable_aicode,
    info: 'If enabled, the plugin will be completely disabled.'
  },
  {
  key: "aicode_path_url",
  text: "Select Path",
  value: getSettings().aicode_path_url,
  info: getSettings().aicode_path_url,
  },
  {
    key: "aicode_reset_all",
    text: "Reset All",
    info: "Reset all settings to default & log out",
    value: "", // No specific value needed for reset
}
];



// Called when a setting changes
async function onSettingsChange(key, value) {
const acodePlugin = new AIChatPlugin();
// acodePlugin.setPath();
  let pathUrlValue = null ;
  switch (key) {
        case "aicode_path_url": 
            pathUrlValue = await acodePlugin.setPath();
            break;
        case "aicode_reset_all":
            await acodePlugin.allReset(); // Call reset function
            break;
    }
    console.log('pathUrlValue :',pathUrlValue);
    console.log('value :',value);
  const parsed = pathUrlValue || value ; // checkbox or select
  console.log('Parsed :',parsed);
  const settings = getSettings();
  settings[key] = parsed;
  appSettings.update();
  window.toast('Restart Editor for applied changes !');
}

export {
  getSettings,
  settingsList,
  onSettingsChange
};
