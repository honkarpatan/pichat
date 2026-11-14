// src/main/ui/modelSetup/ManualTab.js
import { ConfigManager } from '../../utils/ConfigManager.js';

const escapeAttr = (str) => String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const ManualTab = {
    id: 'manual',

    buildHTML(ctx) {
        const { uiConf, isFirstTab, styles } = ctx;
        const isFirst = isFirstTab('manual');
        let html = `<div class="setting-tab-content" id="tab-manual" style="display:${isFirst ? 'block' : 'none'};max-height:60vh;overflow-y:scroll;">`;

        uiConf.inputs.forEach(input => {
            html += `
                <div class="input-group manual-group-container" data-key="${input.storageKey}" data-placeholder="${escapeAttr(input.placeholder)}">
                    <label style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <span>${input.label} List</span>
                        <span style="font-size:9px; color:${styles.accentColor}; opacity:0.8;">Select Radio to set Active</span>
                    </label>
                    <div class="manual-rows-container"></div>
                    <div class="secondary-text" style="font-size:10px; margin-top:4px; margin-bottom:12px;">Add up to 10 models. Exact 1 empty row is kept ready below.</div>
                </div>`;
        });

        html += `
                <div style="text-align:right; margin-top:8px;">
                    <button class="reset-tab-btn" data-reset="manual" style="${styles.resetBtnStyle}">Reset Manual Inputs</button>
                </div>
            </div>`;
        return html;
    },

    _rowHTML(storageKey, val, isChecked, styles) {
        return `
            <div class="manual-model-row" style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                <input type="radio" name="active_${storageKey}" class="manual-radio" ${isChecked ? 'checked' : ''} style="accent-color: ${styles.accentColor} !important; cursor:pointer; width:16px; height:16px;" title="Set as active">
                <input type="text" class="manual-input manual-input-val" data-key="${storageKey}" value="${escapeAttr(val)}" style="flex:1; padding:8px; font-size:12px; background:${styles.inputBg}; border:1px solid ${styles.borderColor}; color:${styles.textColor}; border-radius:4px;" />
                <button type="button" class="manual-remove" title="Remove this model" style="flex-shrink:0; width:28px; height:28px; border-radius:6px; border:1px solid ${styles.borderColor}; background:transparent; color:var(--error-text-color, #f44336); cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center;">&times;</button>
            </div>`;
    },

    wire(modal, ctx) {
        const { uiConf, styles } = ctx;

        uiConf.inputs.forEach(inputDef => {
            const container = modal.querySelector(`.manual-group-container[data-key="${inputDef.storageKey}"]`);
            if (!container) return;
            const rowsContainer = container.querySelector('.manual-rows-container');

            let list = [];
            try { list = JSON.parse(ConfigManager.get(`${inputDef.storageKey}_list`) || '[]'); } catch(e){}
            if (!Array.isArray(list)) list = [];

            let activeVal = ConfigManager.get(inputDef.storageKey) || '';

            if (list.length === 0 && activeVal) list.push(activeVal);
            list = list.filter(v => v.trim() !== '');

            const updateRadioState = () => {
                const rows = Array.from(rowsContainer.querySelectorAll('.manual-model-row'));
                const checkedRadio = rows.find(r => r.querySelector('.manual-radio').checked)?.querySelector('.manual-radio');
                
                if (!checkedRadio || checkedRadio.closest('.manual-model-row').querySelector('.manual-input-val').value.trim() === '') {
                    const firstValid = rows.find(r => r.querySelector('.manual-input-val').value.trim() !== '');
                    if (firstValid) {
                        rows.forEach(r => r.querySelector('.manual-radio').checked = false);
                        firstValid.querySelector('.manual-radio').checked = true;
                    }
                }
            };

            // 🟢 PRO FIX: Strict 1 empty row policy with DOM manipulation
            const ensurePadding = () => {
                let rows = Array.from(rowsContainer.querySelectorAll('.manual-model-row'));
                
                // Remove intermediate empty rows (unless currently focused by user)
                rows.forEach((row, idx) => {
                    const inp = row.querySelector('.manual-input-val');
                    if (idx < rows.length - 1 && inp.value.trim() === '' && document.activeElement !== inp) {
                        row.remove();
                    }
                });

                // Re-evaluate DOM list
                rows = Array.from(rowsContainer.querySelectorAll('.manual-model-row'));
                let trailingEmpty = 0;
                for (let i = rows.length - 1; i >= 0; i--) {
                    if (rows[i].querySelector('.manual-input-val').value.trim() === '') trailingEmpty++;
                    else break;
                }

                // Add empty row if missing
                while (trailingEmpty < 1 && rows.length < 10) {
                    rowsContainer.insertAdjacentHTML('beforeend', this._rowHTML(inputDef.storageKey, '', false, styles));
                    rows = Array.from(rowsContainer.querySelectorAll('.manual-model-row'));
                    trailingEmpty++;
                    bindRow(rows[rows.length - 1]);
                }
                
                // Remove excessive empty rows from the end
                while (trailingEmpty > 1 && rows.length > 1) {
                    const last = rows[rows.length - 1];
                    if (document.activeElement && last.contains(document.activeElement)) break; // Don't delete if user is typing
                    last.remove();
                    rows = Array.from(rowsContainer.querySelectorAll('.manual-model-row'));
                    trailingEmpty--;
                }
                
                updateRadioState();
            };

            const bindRow = (row) => {
                const inp = row.querySelector('.manual-input-val');
                const removeBtn = row.querySelector('.manual-remove');
                const radio = row.querySelector('.manual-radio');
                const placeholder = container.getAttribute('data-placeholder');
                
                inp.placeholder = placeholder;

                inp.addEventListener('input', ensurePadding);
                inp.addEventListener('blur', () => setTimeout(ensurePadding, 100)); // Clean up un-focused empty rows

                removeBtn.onclick = () => {
                    const currentRows = Array.from(rowsContainer.querySelectorAll('.manual-model-row'));
                    if (currentRows.length === 1 && inp.value.trim() === '') return;
                    row.remove();
                    ensurePadding();
                };

                radio.onchange = updateRadioState;
            };

            // Initial render
            rowsContainer.innerHTML = '';
            list.forEach((val) => {
                rowsContainer.insertAdjacentHTML('beforeend', this._rowHTML(inputDef.storageKey, val, val === activeVal, styles));
            });
            
            Array.from(rowsContainer.querySelectorAll('.manual-model-row')).forEach(bindRow);
            ensurePadding();
        });
    },

    save(modal, ctx) {
        const { app, uiConf } = ctx;
        uiConf.inputs.forEach(inputDef => {
            const container = modal.querySelector(`.manual-group-container[data-key="${inputDef.storageKey}"]`);
            if (!container) return;

            const rows = Array.from(container.querySelectorAll('.manual-model-row'));
            const validList = [];
            let selectedVal = '';

            rows.forEach(row => {
                const val = row.querySelector('.manual-input-val').value.trim();
                if (val) {
                    validList.push(val);
                    if (row.querySelector('.manual-radio').checked) {
                        selectedVal = val;
                    }
                }
            });

            if (validList.length > 0) {
                if (!selectedVal) selectedVal = validList[0];
                ConfigManager.set(`${inputDef.storageKey}_list`, JSON.stringify(validList));
                ConfigManager.set(inputDef.storageKey, selectedVal);
                app[inputDef.storageKey] = selectedVal;
            } else {
                ConfigManager.remove(`${inputDef.storageKey}_list`);
                ConfigManager.remove(inputDef.storageKey);
                app[inputDef.storageKey] = '';
            }
        });
    },

    reset(modal, ctx) {
        const { uiConf } = ctx;
        uiConf.inputs.forEach(inp => {
            ConfigManager.remove(`${inp.storageKey}_list`);
            ConfigManager.remove(inp.storageKey);
        });
        this.wire(modal, ctx);
        window.toast("Manual inputs cleared from view. Save to apply.");
    }
};