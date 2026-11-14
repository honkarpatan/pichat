// src/data/mainBoxHTML.js 
import { icons } from './svg.js';

export const mainBoxHTML = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.8/purify.min.js"></script>
    
<div class="chat-container" id="chatContainer">
     <div class="gpt-top-bar" style="display:flex;flex-direction:row;width:100%;background-color:transparent;position:absolute;top:0;justify-content:space-between;height:1.5em;align-items:center;">
    <div style='font-weight:bold;display:flex;align-items:center; padding-left:8px;'>
        
        <div id="gpt-sidebar-toggle">
          ${icons.sidebarToggle}
        </div>

      <div id="gpt-top-title">Loading...</div>
      
  </div>
  <div class='gpt-top-tile-container'>

  <div id="gpt-usage-circle-wrap" title="API key usage" style="display:none;position:relative;margin-right:6px;cursor:pointer;align-items:center;">
    <svg id="gpt-usage-circle" width="22" height="22" viewBox="0 0 36 36" style="display:block;">
      <circle cx="18" cy="18" r="14" fill="none" stroke="var(--secondary-text-color, #888)" stroke-opacity="0.25" stroke-width="3.5"/>
      <circle id="gpt-usage-circle-arc" cx="18" cy="18" r="14" fill="none" stroke="var(--button-background-color, #4b5dd1)" stroke-width="3.5"
        stroke-dasharray="0 88" stroke-linecap="round" transform="rotate(-90 18 18)"/>
      <text id="gpt-usage-circle-label" x="18" y="21" text-anchor="middle" font-size="8" font-weight="600" fill="var(--primary-text-color, currentColor)">—</text>
    </svg>
    <div id="gpt-usage-key-popup" style="display:none;position:absolute;top:26px;right:0;z-index:80;min-width:200px;max-width:280px;background:var(--secondary-color, #1e1e2e);border:1px solid var(--border-color, #333);border-radius:10px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.35);"></div>
  </div>
  
  <div id="gpt-model-console-btn" style="padding:2px 8px;font-size:0.65em;color:#be9e03;background-color:rgba(190,158,3,0.1);border-radius:4px;cursor:pointer;font-weight:500;">
    Console ↗
  </div>
  
  <div id="new-chat-button" style="padding:0 10px;display:none;">
    ${icons.newChat}
  </div>
    
    <div id="gpt-three-dot" style="cursor:pointer; position:relative;">
  ${icons.threeDotMenu}
</div>

  <div id="gpt-info-page-back" style="position: relative; display: none;">
      ${icons.cross}
    </div>

<div id="three-dot-options" class="three-dot-options">
  <ul style="list-style:none; padding:0; margin:0;">
    <li id="gpt-info-view-details" class="option-item" style="display:flex; align-items:center; padding:10px; cursor:pointer;">
      ${icons.viewDetails}
      View Details
    </li>
    <div style="height:0.8px;background-color:#d2d0d0;width:100%;"></div>
    <li id="gpt-info-rename-chat" class="option-item" style="display:flex; align-items:center; padding:10px; cursor:pointer;">
      ${icons.rename}
      Rename
    </li>
    <li id="gpt-info-delete-chat" class="option-item" style="display:flex; align-items:center; padding:10px; cursor:pointer;">
      ${icons.delete}
      Delete
    </li>
  <li class="gpt-info-close-gpt" class="option-item" style="display:flex; align-items:center; padding:10px; cursor:pointer;">
      ${icons.close}
      Close
    </li>
  </ul>
</div>

  </div>
  </div>

<div class="gpt-modal-overlay">
<div id="gpt-side-bar" class="gpt-side-bar">
<div class="gpt-top-sidebar-box">
  
  <ul id="gpt-chat-model">
      </ul>
  
  <ul id="gpt-chat-more">
    <li>
        <div class="gpt-more-icon">
          ${icons.moreGPTs}
        </div>
        <div id="gpt-more-button">
          <div>More GPT's</div>
        </div>
        </li>
  </ul>
  
  <ul id="gpt-chats-history" style="overflow:scroll;">
      <li>New Chat</li>
  </ul>
</div>

<div class="gpt-bottom-sidebar-box" style="background-color:var(--secondary-color);height:55px;width:100%;display:flex;align-items:center;justify-content:space-between;position:absolute;bottom:0;">
    <div class="gpt-user-box" style="display:flex;align-items:center;">
    <div class="gpt-user-icon" style="background-color:#ff8899a2;width:40px;height:40px;border-radius:50%;align-items:center;justify-content:center;font-size:20px;text-align:center;flex-direction:column;display:flex;font-weight:400;overflow:hidden;">
        <div id="gpt-email-icon" style="cursor:pointer;"></div>
        <div id="email-popup" class="email-popup">
          <p id="email-popup-text" style="margin:0;"></p>
        </div>
    </div>
    <div class="gpt-user-name" style="padding:0 10px;font-weight:500;color:var(--primary-text-color);"></div>
  </div>
  <div id="gpt-setting-button" style="width:40px;height:30px;border-radius:8px;font-weight:450;display:flex;justify-content:center;align-items:center;color:#eee;margin-right:5px;">
    ${icons.settingDots}
 </div> 
</div>
</div>
</div>
  
<div id="chat-box" class="chat-box" style="position:relative;">
</div>

<div id="popup-menu" class="popup-menu" style="display:none; position:absolute; z-index:1000;">
  <button class="popup-option" id="copy-btn">Copy</button>
  <button class="popup-option" id="select-text-btn">Select Text</button>
  <button class="popup-option" id="regenerate-btn">Regenerate</button>
  <button class="popup-option" id="bad-response-btn">Bad Response</button>
</div>

 <div id="gpt-info-page" style="display: none; height: 100vh;flex-direction:column;margin-top:50px;display:none;">
  <div id="gpt-info-page-container" style="display: flex; justify-content: flex-start; align-items: center;flex-direction:column;margin-top:50px;">
  <div id="gpt-info-page-image-bg" style="background-color:#000;width:60px;height:60px;border-radius:50%;align-items:center;justify-content:center;display:flex;overflow:hidden;">
    ${icons.modelLogoLargeWhite}
    </div>
    <p id="gpt-infopage-model-name" style="font-weight:500;margin:15px 0;font-size:1.1em;">Loading...</p>
</div>

<div style="display:flex;justify-content:flex-start;align-items:flex-start;flex-direction:column;padding:8px;">
<p style="font-weight:450; color:#8d8888;">Model Info</p>
  <p style="font-weight:400;font-size:0.9em;color:#7f6464;padding-top:15px;">Description</p>
<div id="gpt-model-info">
  <p>Use the right model for my request</p>
  </div>
  
<p style="font-weight:400;font-size:0.9em;color:#7f6464;padding-top:15px;">Capabilities</p>
<div id="gpt-model-capability"></div>
    <p style="margin-top:10%;">For any report, contact with the developer - <a href="https://telegram.me/cosmodec" target="_blank">here</a></p>
  </div>
  </div>

<div id="gpt-setting-page" style="display: none;">
  <div id="gpt-setting-page-container">
    
    <div class="gpt-setting-profile">
      <div style="width:40px;height:40px;border-radius:50%;background-color:#9f460e;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:1.5em;">A</div>
      <div class="gpt-setting-profile-info"><p id="gpt-setting-user-name">...</p></div>
    </div>
    
    <div class="gpt-setting-section-header">Account</div>
    <div class="gpt-setting-settings-section">
        <div class="gpt-setting-settings-item gpt-slow-wave"><div class="gpt-setting-rows">${icons.email} Email </div><div class="gpt-setting-sub-item" id="gpt-sub-setting-email">aicode.test@gmail.com</div></div>
        <div class="gpt-setting-settings-item gpt-slow-wave"><div class="gpt-setting-row">${icons.archivedChats}<div>Archived Chats</div></div></div>
    </div>
    
    <div class="gpt-setting-section-header">Security</div>
    <div class="gpt-setting-settings-section">
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-secretkey"><div class="gpt-setting-rows">${icons.secretKey}Secret Key</div><div class="gpt-setting-sub-item" id="gpt-sub-setting-secretkey">Hai8wjXha7jaj_ha77bsj7</div></div>
        <a href="https://aicode-tokens.vercel.app" id="gpt-generate-new-key"><div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-generateNewKey"><div class="gpt-setting-row">${icons.generateKey} Generate New Key</div></div></a>
    </div>
    
    <div class="gpt-setting-section-header">App Preferences</div>
    <div class="gpt-setting-settings-section">
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-language"><div class="gpt-setting-rows">${icons.language}Language</div><div class="gpt-setting-sub-item" id="gpt-sub-setting-language">English</div></div>
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-fontSize"><div class="gpt-setting-rows" id="fontSizeSetting">${icons.fontSize}<span id="fontSizeText">Font Size</span></div><div class="gpt-setting-sub-item" id="gpt-sub-setting-fontSize">Type font size of chat eg: default 14</div></div>
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-canvas"><div class="gpt-setting-rows">${icons.canvas || icons.fontSize} Canvas Preview</div><div class="gpt-setting-sub-item" id="gpt-sub-setting-canvas">On</div></div>
        
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-ui">
            <div class="gpt-setting-rows"><span style="font-size: 16px;">${icons.color}</span> UI & Layout Settings</div>
            <div class="gpt-setting-sub-item" id="gpt-sub-setting-ui">Customize sidebar dimensions and visuals</div>
        </div>
    </div>
    
    <div class="gpt-setting-section-header">Advanced Customization</div>
    <div class="gpt-setting-settings-section">
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-aichat">
            <div class="gpt-setting-rows">${icons.aiChat || icons.canvas || icons.fontSize} Chat Behavior & Context</div>
            <div class="gpt-setting-sub-item" id="gpt-sub-setting-aichat">History, system prompt, web browsing & more</div>
        </div>
    </div>
    
    <div class="gpt-setting-section-header">Data & Privacy</div>
    <div class="gpt-setting-settings-section">
        <!-- 🟢 PRO FIX: Removed redundant old path and delete data items -->
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-storage">
            <div class="gpt-setting-rows"><span style="font-size: 16px;">${icons.storage}</span> Storage & Privacy</div>
            <div class="gpt-setting-sub-item" id="gpt-sub-setting-storage">Manage paths, history, cache, and encryption</div>
        </div>
    </div>
    
    <div class="gpt-setting-section-header">About</div>
    <div class="gpt-setting-settings-section">
        <div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-readme"><div class="gpt-setting-row">${icons.readme}Readme.Md</div></div>
        <a href="https://telegram.me/cosmodec" id="support-link"><div class="gpt-setting-settings-item gpt-slow-wave" id="gpt-main-setting-support"><div class="gpt-setting-row">${icons.support}Contact & Support</div></div></a>
        <div class="gpt-setting-settings-item gpt-slow-wave"><div class="gpt-setting-rows">${icons.pluginVersion}GPT plugin Version</div><div class="gpt-setting-sub-item" id="gpt-sub-setting-version">AICodeX Cosmo v6.x.x</div></div>
    </div>
    <div class="gpt-setting-settings-section">
        <div class="gpt-setting-settings-item gpt-slow-wave gpt-setting-logout" id="gpt-main-setting-logout"><div class="gpt-setting-row">${icons.logout}Logout</div></div>
    </div>
  </div>
</div>

<div id="previewContainer"></div>
<div class="input-container visible" id="input-container"></div>

</div>`;