// src/main/ui/modelSetup/AssignmentPopup.js
// Small popup shown when a fetched model needs to be assigned to one of several
// manual-input slots (e.g. "Primary Model" vs "Image Gen Model").

export class AssignmentPopup {
    static show(modelId, modelName, inputs, parentModal, modalStyles) {
        let overlay = document.getElementById('gpt-assign-popup-overlay');
        if (overlay) overlay.remove();

        const getVal = (val, fallback) => (val && val !== 'default') ? val : fallback;
        const bg = getVal(modalStyles.background, 'var(--primary-color, #1e1e1e)');
        const textColor = getVal(modalStyles.color, 'var(--primary-text-color)');
        const borderColor = getVal(modalStyles.borderColor, 'var(--border-color, #444)');
        const accentColor = getVal(modalStyles.accentColor, 'var(--active-text-color, #4b5dd1)');
        const secondaryBg = getVal(modalStyles.secondaryBg, 'var(--secondary-color, #2a2a2a)');
        const borderRadius = getVal(modalStyles.borderRadius, '12px');

        overlay = document.createElement('div');
        overlay.id = 'gpt-assign-popup-overlay';
        overlay.style = `position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px); transition:0.2s opacity;`;

        let popup = document.createElement('div');
        popup.style = `background:${bg}; background-size:cover; border:1px solid ${borderColor}; border-radius:${borderRadius}; padding:16px; min-width:260px; max-width:90%; box-shadow:0 8px 24px rgba(0,0,0,0.4); text-align:center; transform:scale(0.95); animation:gptPopupScale 0.2s forwards;`;

        let html = `
            <style>@keyframes gptPopupScale { to { transform:scale(1); } }</style>
            <div style="font-size:12px; color:${textColor}; opacity:0.8; margin-bottom:14px; line-height:1.4;">Assign <br><b style="color:${accentColor}; font-size:14px; opacity:1;">${modelName}</b> <br>to:</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
        `;

        inputs.forEach(inp => {
            html += `<button class="assign-btn" data-key="${inp.storageKey}" data-label="${inp.label}" style="background:${secondaryBg}; border:1px solid ${borderColor}; color:${textColor}; padding:10px; border-radius:8px; font-size:13px; cursor:pointer; transition:0.2s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">${inp.label}</button>`;
        });

        html += `
            </div>
            <button class="cancel-assign-btn" style="margin-top:14px; background:transparent; border:none; color:var(--error-text-color, #f44336); font-size:12px; font-weight:bold; cursor:pointer; padding:6px;">Cancel</button>
        `;

        popup.innerHTML = html;
        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        popup.querySelectorAll('.assign-btn').forEach(btn => {
            btn.onclick = () => {
                const storageKey = btn.getAttribute('data-key');
                const label = btn.getAttribute('data-label');
                const inputEl = parentModal.querySelector(`.manual-input[data-key="${storageKey}"]`);
                if (inputEl) inputEl.value = modelId;
                window.toast(`Successfully assigned to ${label}`);
                overlay.remove();
            };
        });

        popup.querySelector('.cancel-assign-btn').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }
}