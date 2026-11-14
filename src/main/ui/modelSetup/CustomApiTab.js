// src/main/ui/modelSetup/CustomApiTab.js
import { ConfigManager } from '../../utils/ConfigManager.js';

export const CustomApiTab = {
    id: 'custom_api',

    buildHTML(ctx) {
        const { modelType, uiConf, isFirstTab, styles } = ctx;
        const isFirst = isFirstTab('custom_api');
        let html = `<div class="setting-tab-content" id="tab-custom_api" style="display:${isFirst ? 'block' : 'none'};">`;

        const inputsWithPayload = uiConf.inputs.filter(inp => inp.payload);

        if (inputsWithPayload.length > 0) {
            if (inputsWithPayload.length > 1) {
                html += `<div class="custom-api-subtabs" style="display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; padding-bottom:6px; border-bottom:1px solid ${styles.borderColor};">`;
                inputsWithPayload.forEach((inp, idx) => {
                    html += `<button class="custom-api-subtab-btn ${idx === 0 ? 'active' : ''}" data-target="custom-payload-${inp.id}" style="white-space:nowrap; padding:4px 10px; font-size:11px;">${inp.label}</button>`;
                });
                html += `</div>`;
            }

            inputsWithPayload.forEach((inp, idx) => {
                let isChecked = ConfigManager.get(`${modelType}UseCustomApi_${inp.id}`) === 'true';

                if (idx === 0 && ConfigManager.get(`${modelType}UseCustomApi`) !== null) {
                    isChecked = ConfigManager.get(`${modelType}UseCustomApi`) === 'true';
                }

                let defPayload = inp.payload || "{}";

                let customJson = ConfigManager.get(`${modelType}CustomPayload_${inp.id}`);
                if (!customJson && idx === 0) customJson = ConfigManager.get(`${modelType}CustomPayload`);
                if (!customJson) customJson = defPayload;

                html += `
                    <div class="custom-payload-section" id="custom-payload-${inp.id}" style="display:${idx === 0 ? 'block' : 'none'};">
                        <label style="display:flex; align-items:center; gap:6px; font-size:10.5px; margin-bottom:8px; padding-left: 5px; cursor:pointer;">
                            <input type="checkbox" class="use-custom-api-cb" data-id="${inp.id}" ${isChecked ? 'checked' : ''} />
                            <span>Override <b>${inp.label}</b> payload</span>
                        </label>
                        <textarea class="custom-api-json" data-id="${inp.id}" spellcheck="false" style="width:94% !important; height:120px; padding:8px; font-family:monospace; font-size:11px; resize:vertical;">${customJson}</textarea>
                    </div>`;
            });

            html += `
                    <p style="font-size:10.5px; color:var(--secondary-text-color,#888); margin:10px 6px 4px; line-height:1.4;">
                        <b>Agent / Study mode:</b> when those toggles are on, the built-in tool loop is used (custom override is skipped for that turn) so tools still work. For pure custom models, use an OpenAI-compatible endpoint — tools are attached to your payload automatically.
                    </p>
                    <div style="text-align:right; margin-top:8px;">
                        <button class="reset-tab-btn" data-reset="custom_api" style="${styles.resetBtnStyle}">Reset Payloads</button>
                    </div>`;
        } else {
            html += `<div class="secondary-text" style="font-size:11px; text-align:center; padding:20px;">No configurable payload available for this model.</div>`;
        }

        html += `</div>`;
        return html;
    },

    wire(modal, ctx) {
        // Sub-tab switching is handled centrally by ModalShell.wireTabSwitching.
    },

    save(modal, ctx) {
        const { modelType, uiConf } = ctx;
        if (!uiConf.tabs.includes('custom_api')) return;

        const inputsWithPayload = uiConf.inputs.filter(inp => inp.payload);
        inputsWithPayload.forEach(inp => {
            const cb = modal.querySelector(`.use-custom-api-cb[data-id="${inp.id}"]`);
            const txt = modal.querySelector(`.custom-api-json[data-id="${inp.id}"]`);

            if (cb && txt) {
                ConfigManager.set(`${modelType}UseCustomApi_${inp.id}`, cb.checked ? 'true' : 'false');
                ConfigManager.set(`${modelType}CustomPayload_${inp.id}`, txt.value.trim());
            }
        });

        ConfigManager.remove(`${modelType}UseCustomApi`);
        ConfigManager.remove(`${modelType}CustomPayload`);
    },

    reset(modal, ctx) {
        const { modelType, uiConf } = ctx;
        const inputsWithPayload = uiConf.inputs.filter(inp => inp.payload);
        inputsWithPayload.forEach(inp => {
            const cb = modal.querySelector(`.use-custom-api-cb[data-id="${inp.id}"]`);
            const txt = modal.querySelector(`.custom-api-json[data-id="${inp.id}"]`);

            if (cb) cb.checked = false;
            if (txt) txt.value = inp.payload || "{}";

            ConfigManager.remove(`${modelType}UseCustomApi_${inp.id}`);
            ConfigManager.remove(`${modelType}CustomPayload_${inp.id}`);
        });

        ConfigManager.remove(`${modelType}UseCustomApi`);
        ConfigManager.remove(`${modelType}CustomPayload`);
        window.toast("All Custom Payloads restored to default.");
    }
};