// src/main/ui/modelSetup/AdvancedTab.js
import { ConfigManager } from '../../utils/ConfigManager.js';

export const AdvancedTab = {
    id: 'advanced',

    buildHTML(ctx) {
        const { modelType, uiConf, isFirstTab, styles } = ctx;
        let savedOptions = JSON.parse(ConfigManager.get(`${modelType}ModelOptions`) || '{}');
        const isFirst = isFirstTab('advanced');
        let html = `<div class="setting-tab-content" id="tab-advanced" style="display:${isFirst ? 'block' : 'none'};">`;

        uiConf.advancedSettings.forEach(s => {
            let val = savedOptions[s.id] !== undefined ? savedOptions[s.id] : s.default;

            if (s.type === 'boolean') {
                let isChecked = val === true ? 'checked' : '';
                html += `
                    <div class="input-group" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding: 5px 0;">
                        <label style="margin:0; width:80%; cursor:pointer;">${s.label}</label>
                        <input type="checkbox" class="adv-checkbox" data-id="${s.id}" ${isChecked} style="accent-color:var(--active-text-color, #4b5dd1); width:16px; height:16px; cursor:pointer;" />
                    </div>`;
            } else if (s.type === 'selection') {
                let optionsHtml = s.options.map(opt => {
                    let isSelected = val == opt.value ? 'selected' : '';
                    return `<option value="${opt.value}" ${isSelected}>${opt.label}</option>`;
                }).join('');

                html += `
                    <div class="input-group" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding: 5px 0;">
                        <label style="margin:0; width:50%;">${s.label}</label>
                        <select class="adv-select" data-id="${s.id}" style="width:45%; padding:4px; font-size:12px; cursor:pointer; outline:none;">
                            ${optionsHtml}
                        </select>
                    </div>`;
            } else if (s.type === 'text') {
                const esc = String(val ?? s.default ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                html += `
                    <div class="input-group" style="margin-bottom:10px; padding: 5px 0;">
                        <label style="display:block; margin-bottom:4px; font-size:12px;">${s.label}</label>
                        <input type="text" class="adv-text" data-id="${s.id}" value="${esc}" placeholder="${(s.placeholder || '').replace(/"/g, '&quot;')}" style="width:100%; box-sizing:border-box; padding:8px; font-size:12px; border-radius:4px; outline:none;" />
                        ${s.hint ? `<div class="secondary-text" style="font-size:10px;margin-top:3px;">${s.hint}</div>` : ''}
                    </div>`;
            } else {
                html += `
                    <div class="input-group" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <label style="margin:0; width:40%;">${s.label}: <b id="val-${s.id}" style="color:${styles.accentColor};">${val}</b></label>
                        <input type="range" class="adv-slider" data-id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${val}" />
                    </div>`;
            }
        });

        html += `
                <div style="text-align:right; margin-top:8px;">
                    <button class="reset-tab-btn" data-reset="advanced" style="${styles.resetBtnStyle}">Reset Defaults</button>
                </div>
            </div>`;
        return html;
    },

    wire(modal, ctx) {
        modal.querySelectorAll('.adv-slider').forEach(slider => {
            slider.oninput = () => { modal.querySelector(`#val-${slider.getAttribute('data-id')}`).textContent = slider.value; };
        });
    },

    save(modal, ctx) {
        const { modelType, uiConf } = ctx;
        if (!uiConf.tabs.includes('advanced')) return;

        let currentOptions = {};
        modal.querySelectorAll('.adv-slider').forEach(slider => {
            currentOptions[slider.getAttribute('data-id')] = Number(slider.value);
        });
        modal.querySelectorAll('.adv-checkbox').forEach(cb => {
            currentOptions[cb.getAttribute('data-id')] = cb.checked;
        });
        modal.querySelectorAll('.adv-select').forEach(sel => {
            let v = sel.value;
            currentOptions[sel.getAttribute('data-id')] = isNaN(v) ? v : Number(v);
        });
        modal.querySelectorAll('.adv-text').forEach(inp => {
            currentOptions[inp.getAttribute('data-id')] = inp.value;
        });
        ConfigManager.set(`${modelType}ModelOptions`, JSON.stringify(currentOptions));
    },

    reset(modal, ctx) {
        const { modelType, uiConf } = ctx;
        uiConf.advancedSettings.forEach(s => {
            if (s.type === 'boolean') {
                const cb = modal.querySelector(`.adv-checkbox[data-id="${s.id}"]`);
                if (cb) cb.checked = s.default;
            } else if (s.type === 'selection') {
                const sel = modal.querySelector(`.adv-select[data-id="${s.id}"]`);
                if (sel) sel.value = s.default;
            } else if (s.type === 'text') {
                const inp = modal.querySelector(`.adv-text[data-id="${s.id}"]`);
                if (inp) inp.value = s.default || '';
            } else {
                const slider = modal.querySelector(`.adv-slider[data-id="${s.id}"]`);
                if (slider) {
                    slider.value = s.default;
                    modal.querySelector(`#val-${s.id}`).textContent = s.default;
                }
            }
        });
        ConfigManager.remove(`${modelType}ModelOptions`);
        window.toast("Advanced settings restored to default.");
    }
};