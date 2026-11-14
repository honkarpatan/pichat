// src/main/ui/modelSetup/ModalShell.js
// Owns the modal/overlay DOM element, the shared CSS block, the header + tab bar,
// and the generic tab-switching / close-button wiring used by every provider's setup modal.

export class ModalShell {

    static getOverlayAndModal(modalId, modalClass) {
        let overlay = document.getElementById('modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'modal-overlay';
            overlay.classList.add('modal-overlay');
            document.body.appendChild(overlay);
        }

        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.classList.add(modalClass);
            document.body.appendChild(modal);
        }

        overlay.style.display = 'block';
        modal.style.display = 'block';

        const closeModal = () => {
            modal.style.display = 'none';
            overlay.style.display = 'none';
        };

        overlay.onclick = closeModal;
        return { overlay, modal, closeModal };
    }

    /** Resolves the modal's derived color/style tokens from ModelConfig.styles.setupModal. */
    static resolveStyles(config) {
        const getVal = (val, fallback) => (val && val !== 'default') ? val : fallback;
        const mStyles = config.styles?.setupModal || {};

        return {
            mStyles,
            bg: getVal(mStyles.background, 'var(--primary-color, #1e1e1e)'),
            textColor: getVal(mStyles.color, 'var(--primary-text-color)'),
            borderColor: getVal(mStyles.borderColor, 'var(--border-color, #444)'),
            borderRadius: getVal(mStyles.borderRadius, '8px'),
            subTabRadius: getVal(mStyles.subTabRadius, '15px'),
            btnBorderRadius: getVal(mStyles.btnBorderRadius, '5px'),
            accentColor: getVal(mStyles.accentColor, 'var(--active-text-color, #4b5dd1)'),
            secondaryBg: getVal(mStyles.secondaryBg, 'var(--secondary-color, #2a2a2a)'),
            primaryBg: getVal(mStyles.primaryBg, 'var(--primary-color, #2a2a2a)'),
            inputBg: getVal(mStyles.inputBg, 'var(--secondary-color, #1e1e1e)'),
            popupBg: getVal(mStyles.popupBg, 'var(--popup-background-color, #1e1e1e)'),
            resetBtnStyle: "background:transparent; color:var(--error-text-color, #f44); border:none; font-size:10.5px; font-weight:bold; cursor:pointer; padding:4px;"
        };
    }

    static buildStyleBlock(modalId, s) {
        return `
            <style>
                #${modalId} {
                    background: ${s.bg} !important;
                    border-radius: ${s.borderRadius} !important;
                    border: 1px solid ${s.borderColor} !important;
                    color: ${s.textColor} !important;
                }
                #${modalId} .setting-tab-btn, 
                #${modalId} .custom-api-subtab-btn {
                    border-radius: ${s.btnBorderRadius} !important;
                    background: ${s.secondaryBg} !important;
                    color: ${s.textColor} !important;
                    border: 1px solid ${s.borderColor} !important;
                    transition: all 0.2s ease;
                    opacity: 0.7;
                    cursor: pointer;
                }
                #${modalId} .setting-tab-btn.active, 
                #${modalId} .custom-api-subtab-btn.active {
                    background: ${s.accentColor} !important;
                    color: #828282 !important;
                    border-color: ${s.accentColor} !important;
                    opacity: 1;
                }
                
                #${modalId} input[type="text"], 
                #${modalId} textarea,
                #${modalId} select,
                #${modalId} .fetched-model-item {
                    background: ${s.inputBg} !important;
                    color: ${s.textColor} !important;
                    border: 1px solid ${s.borderColor} !important;
                    border-radius: 4px;
                }
                #${modalId} select:focus { outline: none; border-color: ${s.accentColor} !important; }
                #${modalId} select option { background: ${s.primaryBg} !important; color: ${s.textColor} !important; }
                
                #${modalId} input[type="checkbox"] {
                    accent-color: ${s.accentColor} !important;
                }
                #${modalId} .generic-btn {
                    background: ${s.accentColor} !important;
                    color: #fff !important;
                    border: none;
                    border-radius: 6px;
                }
                #${modalId} .close-generic-modal { color: ${s.textColor} !important; }
                #${modalId} label, #${modalId} .setting-tab-content { color: ${s.textColor} !important; background: ${s.primaryBg} !important }
                #${modalId} h4 { color: ${s.textColor} !important; }
                #${modalId} .secondary-text { color: ${s.textColor} !important; opacity: 0.7; }
                #${modalId} .settings-tabs { background: ${s.popupBg} !important; }

                /* 🟢 Multi API Key System */
                #${modalId} .api-key-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
                #${modalId} .api-key-row .akp-name { width:34%; flex-shrink:0; padding:8px; font-size:12px; }
                #${modalId} .api-key-row .akp-value { flex:1; padding:8px; font-size:12px; }
                #${modalId} .api-key-row .akp-remove {
                    flex-shrink:0; width:28px; height:28px; border-radius:6px; border:1px solid ${s.borderColor} !important;
                    background:transparent !important; color:var(--error-text-color, #f44336) !important; cursor:pointer; font-size:13px;
                    display:flex; align-items:center; justify-content:center;
                }
                #${modalId} .api-key-row .akp-name.name-conflict { border-color:var(--error-text-color, #f44336) !important; }
                #${modalId} .pie-slice:hover { opacity:0.8; }
            </style>
        `;
    }

    static buildHeaderAndTabs(model, headerIcon, allTabs, opts = {}) {
        return `
            <div class="gpt-setting-page-container" style="flex-direction:column; align-items:stretch;">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="width:22px; height:22px; border-radius:4px; background:${model.image_bg}; display:flex; align-items:center; justify-content:center;">
                            ${headerIcon}
                        </div>
                        <h4 style="margin:0; font-weight:normal; font-style:italic; font-size:14px;">${model.name} Setup</h4>
                    </div>
                    <div class="close-generic-modal">&times;</div>
                </div>
                
                <div class="settings-tabs">
                    ${allTabs.map((tab, idx) => {
                        const label = tab === 'usage' ? 'USAGE' : tab.replace('_', ' ').toUpperCase();
                        const dot = (tab === 'fim' && opts?.fimEnabled)
                            ? ' <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 5px #22c55e;margin-left:3px;vertical-align:middle;"></span>'
                            : '';
                        return `
                        <button class="setting-tab-btn ${idx === 0 ? 'active' : ''}" data-target="tab-${tab}">
                            ${label}${dot}
                        </button>`;
                    }).join('')}
                </div>
            </div>
            
            <div class="settings-body">
        `;
    }

    static wireTabSwitching(modal) {
        const tabBtns = modal.querySelectorAll('.setting-tab-btn');
        const tabContents = modal.querySelectorAll('.setting-tab-content');
        tabBtns.forEach(btn => {
            btn.onclick = () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.style.display = 'none');
                btn.classList.add('active');
                modal.querySelector(`#${btn.getAttribute('data-target')}`).style.display = 'block';
            };
        });

        const customTabBtns = modal.querySelectorAll('.custom-api-subtab-btn');
        const customPayloadSections = modal.querySelectorAll('.custom-payload-section');
        customTabBtns.forEach(btn => {
            btn.onclick = () => {
                customTabBtns.forEach(b => b.classList.remove('active'));
                customPayloadSections.forEach(c => c.style.display = 'none');
                btn.classList.add('active');
                modal.querySelector(`#${btn.getAttribute('data-target')}`).style.display = 'block';
            };
        });
    }

    static wireCloseButton(modal, closeModal) {
        modal.querySelector('.close-generic-modal').onclick = () => {
            // 🟢 Token Usage: stop listening for live usage updates once the modal is closed
            if (modal._usageListener) { window.removeEventListener('gpt-usage-updated', modal._usageListener); modal._usageListener = null; }
            closeModal();
        };
    }

    /** Shared confirm-then-run helper used by every tab's reset button. */
    static confirmThenRun(textColor, message, onConfirm) {
        const DialogBox = window.acode ? window.acode.require('dialogBox') : null;
        if (DialogBox) {
            const confirmBox = DialogBox('Confirm Reset', `<p style="font-size:13px; color:${textColor};">${message}</p>`, 'Cancel');
            confirmBox.then(() => { onConfirm(); confirmBox.hide(); });
        } else if (confirm(message.replace(/<[^>]+>/g, ''))) {
            onConfirm();
        }
    }
}