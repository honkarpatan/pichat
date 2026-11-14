// src/main/ui/chatInput/ChatInputTemplates.js
import { icons } from '../../../data/svg.js';

export class ChatInputTemplates {
    
    static getToggleSVG(isOn) {
        return isOn ? icons.activedToggler : icons.deactivatedToggler;
    }

    static generateActionsHTML(opts = {}) {
        // Always include Add Project in DOM; updateDynamicToggles shows/hides via supportsProject
        const actions = [
            { id: 'action-image', label: 'Upload Image', icon: icons.imageIcon },
            { id: 'action-file', label: 'Attach File', icon: icons.fileIcon },
            {
                id: 'action-project',
                label: 'Add Project',
                icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
            }
        ];
        return actions.map(act => {
            const hide = act.id === 'action-project' && opts.supportsProject === false;
            return `<div id="${act.id}" style="display:${hide ? 'none' : 'flex'}; align-items:center; gap:10px; padding:8px 10px; cursor:pointer; border-radius:6px; color:var(--primary-text-color); font-size:13px;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">${act.icon} <span>${act.label}</span></div>`;
        }).join('');
    }

    static generateToolsHTML(states) {
        const studyIconSVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`;
        const toggles = [
            { id: 'web', label: 'Web Browsing', icon: icons.globeIcon },
            { id: 'think', label: 'Reasoning (Think)', icon: icons.brainIcon },
            { id: 'imageGen', label: 'Generate Image', icon: icons.imageGenIcon },
            { id: 'catchFunction', label: 'Catch Function', icon: icons.funcIcon },
            { id: 'selectedText', label: 'Selected Text', icon: icons.textIcon },
            { id: 'history', label: 'Chat History', icon: icons.historyIcon },
            { id: 'agent', label: 'Agent Mode', icon: icons.funcIcon },
            { id: 'study', label: 'Study Guide', icon: studyIconSVG }
        ];

        return toggles.map(t => `<div class="tool-toggle-item" data-id="${t.id}" data-locked="false" style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; cursor:pointer; border-radius:6px; color:var(--primary-text-color); font-size:13px;" onmouseover="if(this.getAttribute('data-locked')!=='true') this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'"><div style="display:flex; align-items:center; gap:10px;">${t.icon} <span>${t.label}</span></div><div class="toggle-icon-container" style="display:flex; align-items:center;">${this.getToggleSVG(states[t.id])}</div></div>`).join('');
    }

    static renderInputArea(states) {
        return `
        <div style="display:flex; flex-direction:column; width:auto; background:var(--secondary-color, rgba(0,0,0,0.1)); border:1px solid var(--border-color, #444); border-radius:15px; padding:6px 10px; position:relative;">
            <div id="gpt-function-suggestions" style="display:none; align-items:center; gap:6px; width:100%; overflow-x:auto; white-space:nowrap; padding-bottom:8px; margin-bottom:4px; border-bottom:1px solid var(--border-color, rgba(255,255,255,0.05)); scrollbar-width:none;"></div>
            <div style="width:100%; margin-bottom: 4px;">
                <textarea id="gpt-user-input" placeholder="Message..." rows="1" style="width:100%; min-height:24px; max-height:150px; background:transparent; border:none; color:var(--primary-text-color); outline:none; resize:none; padding:4px 0; font-family:inherit; font-size:14px; line-height:18px; overflow-y:auto;"></textarea>
            </div>
            
            <!-- 🟢 PRO FIX: Flex wrap layout to protect send button -->
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap: 8px;">
                
                <!-- Wrapper for Actions, Tools and Badges -->
                <div style="display:flex; align-items:center; gap:8px; flex: 1; min-width: 0;">
                    <div style="position:relative; flex-shrink: 0;">
                        <button id="gpt-action-btn" style="background:transparent; border:none; color:var(--primary-text-color); cursor:pointer; padding:6px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">${icons.plusIcon}</button>
                        <div id="gpt-action-popup" style="display:none; position:absolute; bottom:120%; left:0; background:var(--secondary-color, #2a2a2a); border:1px solid var(--border-color, #444); border-radius:8px; padding:5px; min-width:160px; box-shadow:0 4px 10px rgba(0,0,0,0.3); z-index:100;">${this.generateActionsHTML()}</div>
                        <div id="gpt-project-submenu" style="display:none; position:absolute; bottom:120%; left:0; background:var(--secondary-color, #2a2a2a); border:1px solid var(--border-color, #444); border-radius:8px; padding:5px; min-width:200px; max-height:260px; overflow-y:auto; box-shadow:0 4px 10px rgba(0,0,0,0.3); z-index:101;"></div>
                    </div>
                    <div style="position:relative; flex-shrink: 0;">
                        <button id="gpt-tools-btn" style="background:transparent; border:none; color:var(--primary-text-color); cursor:pointer; padding:6px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">${icons.toolsIcon}</button>
                        <div id="gpt-tools-popup" style="display:none; position:absolute; bottom:120%; left:0; background:var(--secondary-color, #2a2a2a); border:1px solid var(--border-color, #444); border-radius:8px; padding:5px; min-width:180px; box-shadow:0 4px 10px rgba(0,0,0,0.3); z-index:100;">${this.generateToolsHTML(states)}</div>
                    </div>
                    
                    <!-- 🟢 PRO FIX: Horizontally scrollable badges without pushing the flex box -->
                    <div id="gpt-active-badges" style="display:flex; gap:6px; margin-left: 2px; align-items:center; overflow-x:auto; scrollbar-width:none; flex: 1; min-width: 0; padding: 4px 0;"></div>
                </div>
                
                <!-- Send + Stop (both visible while agent runs: Send=queue, Stop=abort) -->
                <div style="flex-shrink:0; display:flex; align-items:center; gap:6px;">
                    <button id="send-btn" title="Send" style="background:#4b5dd1; border:none; color:#fff; cursor:pointer; padding:6px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:0.2s; width:32px; height:32px; flex-shrink:0;">${icons.sendIcon}</button>
                    <button id="stop-btn" title="Stop agent" style="display:none; background:#f44336; border:none; color:#fff; cursor:pointer; padding:6px; border-radius:50%; align-items:center; justify-content:center; transition:0.2s; width:32px; height:32px; flex-shrink:0;">${icons.stopIcon}</button>
                </div>
            </div>
            <input type="file" id="file-input" multiple style="display:none;" />
        </div>
        <div id="previewContainer" style="display:none; position:absolute; left:0; right:0; bottom:110px; width:100%; height:auto; padding:8px 4px 4px; gap:5px; flex-wrap:nowrap; overflow-x:auto; overflow-y:visible; align-items:flex-start; background:transparent; border:none; z-index:50; pointer-events:none;"></div>
        `;
    }
}