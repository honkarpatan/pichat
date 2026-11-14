// src/main/ui/ModelSetupUI.js
//
// 🟢 Refactor note: this file used to contain the entire settings-modal implementation
// (~800 lines: modal shell, every tab's HTML/wiring, the usage graphs, the assignment
// popup...) in one place. It's now a thin coordinator — each concern lives in its own
// module under ./modelSetup/, and this file just builds the shared `ctx` object and
// wires the pieces together. Public API (`showModelModal`, `getOverlayAndModal`,
// `showAssignmentPopup`) is unchanged, so nothing importing this file needs to change.
// src/main/ui/ModelSetupUI.js
import { ModelConfig } from '../model/ModelConfig.js'; 

import { ModalShell } from './modelSetup/ModalShell.js';
import { AssignmentPopup } from './modelSetup/AssignmentPopup.js';
import { ApiKeyTab } from './modelSetup/ApiKeyTab.js';
import { ManualTab } from './modelSetup/ManualTab.js';
import { AdvancedTab } from './modelSetup/AdvancedTab.js';
import { CustomApiTab } from './modelSetup/CustomApiTab.js';
import { DocsTab } from './modelSetup/DocsTab.js';
import { UsageTab } from './modelSetup/UsageTab.js';
import { FimTab } from './modelSetup/FimTab.js';
import { supportsFim } from '../fim/FimConfig.js'; 
import { isFimEnabled } from '../fim/FimSettings.js'; 

const TAB_MODULES = {
    api_fetch: ApiKeyTab,
    manual: ManualTab,
    advanced: AdvancedTab,
    custom_api: CustomApiTab,
    docs: DocsTab,
    fim: FimTab
};

export class ModelSetupUI {

    static getOverlayAndModal(modalId, modalClass) {
        return ModalShell.getOverlayAndModal(modalId, modalClass);
    }

    static showAssignmentPopup(modelId, modelName, inputs, parentModal, modalStyles) {
        return AssignmentPopup.show(modelId, modelName, inputs, parentModal, modalStyles);
    }

    static showModelModal(app, model) {
        const modelType = model.type.toLowerCase();
        const config = ModelConfig[modelType];

        if (!config) {
            window.toast("No configuration found for this model.");
            return;
        }

        const uiConf = config.setting_ui;
        const modalId = `${modelType}-settings-modal`;
        const { modal, closeModal } = ModalShell.getOverlayAndModal(modalId, 'generic-settings-modal');

        const styles = ModalShell.resolveStyles(config);

        let headerIcon = model.image.trim().startsWith('<svg')
            ? model.image
            : `<img src="${model.image}" alt="icon" style="width:16px; height:16px; object-fit:contain;">`;

        // Inject FIM tab when profile supports it (or already listed)
        const tabs = [...uiConf.tabs];
        if (supportsFim(modelType) && !tabs.includes('fim')) {
            // before docs if present, else append
            const docsIdx = tabs.indexOf('docs');
            if (docsIdx >= 0) tabs.splice(docsIdx, 0, 'fim');
            else tabs.push('fim');
        }
        const allTabs = [...tabs, 'usage'];
        const fimOn = supportsFim(modelType) && isFimEnabled(modelType);

        const ctx = {
            app, model, modelType, config, uiConf: { ...uiConf, tabs }, styles, modalId,
            isFirstTab: (tabName) => tabs[0] === tabName,
            confirmThenRun: (message, onConfirm) => ModalShell.confirmThenRun(styles.textColor, message, onConfirm)
        };

        let html = ModalShell.buildStyleBlock(modalId, styles);
        html += ModalShell.buildHeaderAndTabs(model, headerIcon, allTabs, { fimEnabled: fimOn });

        tabs.forEach(tabName => {
            if (tabName === 'manager') {
                const isFirst = tabs[0] === 'manager';
                html += `<div class="setting-tab-content" id="tab-manager" style="display:${isFirst ? 'block' : 'none'};"></div>`;
                return;
            }
            const mod = TAB_MODULES[tabName];
            if (mod) html += mod.buildHTML(ctx);
        });

        html += UsageTab.buildHTML(ctx);

        html += `
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px; padding-top:12px; border-top:1px solid ${styles.borderColor};">
                <button id="save-generic-settings" class="generic-btn">Save & Apply</button>
            </div>
        `;

        modal.innerHTML = html;

        ModalShell.wireCloseButton(modal, closeModal);
        ModalShell.wireTabSwitching(modal);

        tabs.forEach(tabName => {
            if (tabName === 'manager') {
                if (config.handler.renderManagerTab) {
                    // 🟢 PRO FIX: Passed `ctx` here so CustomModelHandler can access it
                    config.handler.renderManagerTab(modal.querySelector('#tab-manager'), app, ctx);
                }
                return;
            }
            const mod = TAB_MODULES[tabName];
            if (mod) mod.wire(modal, ctx);
        });

        UsageTab.wire(modal, ctx);

        modal.querySelector('#save-generic-settings').onclick = () => {
            if (tabs.includes('api_fetch') && ApiKeyTab.save(modal, ctx) === false) return;

            tabs.forEach(tabName => {
                if (tabName === 'api_fetch' || tabName === 'manager') return;
                const mod = TAB_MODULES[tabName];
                if (mod && mod.save) mod.save(modal, ctx);
            });

            window.toast(`${model.name} setup saved!`);
            closeModal();
        };

        modal.querySelectorAll('.reset-tab-btn').forEach(btn => {
            btn.onclick = () => {
                const resetType = btn.getAttribute('data-reset');
                const mod = TAB_MODULES[resetType];
                if (!mod || !mod.reset) return;

                ctx.confirmThenRun("Are you sure you want to reset the settings for this tab?", () => mod.reset(modal, ctx));
            };
        });
    }
}