// src/main/ui/ChatInputUI.js
import { icons } from '../../data/svg.js';
import { ConfigManager } from '../utils/ConfigManager.js';
import { ChatInputTemplates } from './chatInput/ChatInputTemplates.js';
import { ChatInputEvents } from './chatInput/ChatInputEvents.js';

export class ChatInputUI {
  constructor(pluginContext) {
    this.app = pluginContext;

    // Load global fallback states
    const savedHistory = ConfigManager.get('toolState_history') !== 'false'; 
    const savedImageGen = ConfigManager.get('toolState_imageGen') === 'true'; 
    const savedCatchFunction = ConfigManager.get('toolState_catchFunction') === 'true'; 
    const savedThinkLevel = ConfigManager.get('toolState_thinkLevel') || 'HIGH';

    this.states = {
      web: false,             
      catchFunction: savedCatchFunction,   
      selectedText: false,    
      history: savedHistory,          
      think: false,           
      thinkLevel: savedThinkLevel,    
      imageGen: savedImageGen,        
      agent: false,           
      study: false            
    };

    this.app.isEnableFunctionCatch = this.states.catchFunction;
    this.app.isEnableImageGeneration = this.states.imageGen;
    if (this.app.settingsStore) this.app.settingsStore.setBool('isShowHistory', this.states.history);

    this.isActionMenuOpen = false;
    this.isToolsMenuOpen = false;
  }

  // 🟢 PRO FIX: Forwarding method to prevent TypeError from external callers like ChatModalSetup
  updateFunctionSuggestions(funcList) {
      ChatInputEvents.updateFunctionSuggestions(this, funcList);
  }

  syncWithConversation() {
      const conv = this.app.currentConversation;
      if (!conv) return;
      
      if (!conv.toolStates) {
          conv.toolStates = {};
      }

      this.states.web = conv.toolStates.web ?? false;
      this.states.think = conv.toolStates.think ?? false;
      this.states.thinkLevel = conv.toolStates.thinkLevel ?? ConfigManager.get('toolState_thinkLevel') ?? 'HIGH';
      this.states.agent = conv.toolStates.agent ?? false;
      this.states.study = conv.toolStates.study ?? false;
      this.states.selectedText = conv.toolStates.selectedText ?? false;
      
      this.states.history = conv.toolStates.history ?? (ConfigManager.get('toolState_history') !== 'false');
      this.states.imageGen = conv.toolStates.imageGen ?? (ConfigManager.get('toolState_imageGen') === 'true');
      this.states.catchFunction = conv.toolStates.catchFunction ?? (ConfigManager.get('toolState_catchFunction') === 'true');

      if (this.states.agent && this.states.study) {
          this.states.study = false;
          conv.toolStates.study = false;
      }

      this.app.isEnableWebBrowsing = this.states.web;
      this.app.isEnableAgentMode = this.states.agent;
      this.app.isEnableStudyMode = this.states.study;
      this.app.isEnableCatchSelectText = this.states.selectedText;
      this.app.isEnableFunctionCatch = this.states.catchFunction;
      this.app.isEnableImageGeneration = this.states.imageGen;
      
      if (this.app.settingsStore) this.app.settingsStore.setBool('isShowHistory', this.states.history);

      if (this.states.study) document.body.classList.add('study-mode-active');
      else document.body.classList.remove('study-mode-active');

      Object.keys(this.states).forEach(id => {
          const toggleIcon = document.querySelector(`.tool-toggle-item[data-id="${id}"] .toggle-icon-container`);
          if (toggleIcon) toggleIcon.innerHTML = ChatInputTemplates.getToggleSVG(this.states[id]);
      });

      ChatInputEvents.updateActiveBadges(this);
      // Per-chat workspaces: refresh warning visibility for this tab
      if (this.states.agent) {
          ChatInputEvents.showAgentProjectWarningIfNeeded?.(this);
      } else {
          ChatInputEvents.dismissAgentProjectWarning?.();
      }
  }

  setup() {
    this.inputContainer = document.getElementById('input-container');
    if (!this.inputContainer) return;
    this.inputContainer.innerHTML = ChatInputTemplates.renderInputArea(this.states);
    
    ChatInputEvents.attachListeners(this);
    ChatInputEvents.updateActiveBadges(this); 
  }

  updateDynamicToggles(config) {
    if (!config) return;
    const imgAction = document.getElementById('action-image');
    const fileAction = document.getElementById('action-file');
    const projectAction = document.getElementById('action-project');
    if (imgAction) imgAction.style.display = config.supportsImages ? 'flex' : 'none';
    if (fileAction) fileAction.style.display = config.supportsFiles ? 'flex' : 'none';
    if (projectAction) {
      projectAction.style.display = config.supportsProject ? 'flex' : 'none';
      if (config.supportsProject) ChatInputEvents.bindProjectAction?.(this, projectAction);
    }

    const webToggle = document.querySelector('.tool-toggle-item[data-id="web"]');
    const thinkToggle = document.querySelector('.tool-toggle-item[data-id="think"]');
    const imageGenToggle = document.querySelector('.tool-toggle-item[data-id="imageGen"]');
    const agentToggle = document.querySelector('.tool-toggle-item[data-id="agent"]');
    const studyToggle = document.querySelector('.tool-toggle-item[data-id="study"]');

    if (webToggle) webToggle.style.display = config.supportsWeb ? 'flex': 'none';
    if (thinkToggle) thinkToggle.style.display = config.supportsThink ? 'flex': 'none';
    if (agentToggle) agentToggle.style.display = config.supportsTools ? 'flex': 'none';
    if (studyToggle) studyToggle.style.display = config.supportsStudyMode ? 'flex': 'none';

    if (imageGenToggle) {
      if (config.supportsImageGeneration) {
        imageGenToggle.style.display = 'flex';
        let hasImageModel = false;
        if (config.imageModelKeyName) {
          const savedModel = ConfigManager.get(config.imageModelKeyName);
          if (savedModel && savedModel.trim() !== '') {
            hasImageModel = true;
          }
        }
        if (!hasImageModel) {
          imageGenToggle.style.opacity = '0.4';
          imageGenToggle.style.cursor = 'not-allowed';
          imageGenToggle.setAttribute('data-locked', 'true');
          this.states.imageGen = false;
          imageGenToggle.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false);
        } else {
          imageGenToggle.style.opacity = '1';
          imageGenToggle.style.cursor = 'pointer';
          imageGenToggle.setAttribute('data-locked', 'false');
        }
      } else {
        imageGenToggle.style.display = 'none';
        this.states.imageGen = false;
      }
    }

    if (!config.supportsWeb) { this.states.web = false; this.app.isEnableWebBrowsing = false; if (webToggle) webToggle.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false); }
    if (!config.supportsThink) { this.states.think = false; if (thinkToggle) thinkToggle.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false); }
    if (!config.supportsTools) { this.states.agent = false; this.app.isEnableAgentMode = false; if (agentToggle) agentToggle.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false); }
    
    if (!config.supportsStudyMode) { 
        this.states.study = false; 
        this.app.isEnableStudyMode = false; 
        document.body.classList.remove('study-mode-active');
        if (studyToggle) studyToggle.querySelector('.toggle-icon-container').innerHTML = ChatInputTemplates.getToggleSVG(false); 
    }

    ChatInputEvents.updateActiveBadges(this);
  }

  updateSendButton(config) {
    const sendBtn = document.getElementById('send-btn');
    if (!sendBtn) return;
    const defaultColor = '#4b5dd1';
    const defaultRadius = '50%';
    if (config) {
      const btnStyles = config.styles?.sendBtn || {};
      sendBtn.style.background = btnStyles.backgroundColor || defaultColor;
      sendBtn.style.borderRadius = btnStyles.borderRadius || defaultRadius;
      sendBtn.innerHTML = btnStyles.icon || icons.defaultIcon;
      if (config.animation === false) { document.body.classList.add('gpt-no-animations'); this.app.optimize = true; } 
      else { document.body.classList.remove('gpt-no-animations'); this.app.optimize = false; }
    }
  }
}