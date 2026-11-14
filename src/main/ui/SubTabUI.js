export class SubTabUI {
    /**
     * Generates a dynamic sub-tab UI.
     * @param {Array} tabs - Array of objects: { title, content, activeColor, default (boolean) }
     * @returns {string} - HTML string for the sub-tab component
     */
    static generate(tabs) {
        if (!tabs || tabs.length === 0) return '';

        // 🟢 যদি মাত্র ১টা ট্যাব থাকে, তাহলে শুধু কন্টেন্ট দেখাবে (কোনো হেডার বা বাটন থাকবে না)
        if (tabs.length === 1) {
            return `
                <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 460px; scrollbar-width: thin;">
                    ${tabs[0].content}
                </div>
            `;
        }

        // 🟢 একের বেশি ট্যাব থাকলে ডায়নামিক হেডার তৈরি করবে
        const containerId = 'tab-container-' + Math.random().toString(36).substr(2, 9);
        
        let headerHTML = `<div style="display: flex; gap: 10px; border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.1)); padding-bottom: 8px; margin-bottom: 15px; overflow-x: auto; scrollbar-width: none;">`;
        let contentHTML = '';

        tabs.forEach((tab, index) => {
            const isDefault = tab.default || (index === 0 && !tabs.some(t => t.default));
            const tabId = `tab-btn-${containerId}-${index}`;
            const contentId = `tab-content-${containerId}-${index}`;
            const activeColor = tab.activeColor || 'var(--active-text-color, #4b5dd1)';
            const normalColor = 'var(--primary-text-color)';

            // Inline Script for smooth switching without reloading
            headerHTML += `
                <button id="${tabId}" 
                    onclick="
                        document.querySelectorAll('.content-${containerId}').forEach(el => el.style.display='none');
                        document.getElementById('${contentId}').style.display='block';
                        document.querySelectorAll('.btn-${containerId}').forEach(el => {
                            el.style.color='${normalColor}';
                            el.style.borderBottom='none';
                        });
                        this.style.color='${activeColor}';
                        this.style.borderBottom='2px solid ${activeColor}';
                    " 
                    class="btn-${containerId}"
                    style="color: ${isDefault ? activeColor : normalColor}; border: none; border-bottom: ${isDefault ? '2px solid ' + activeColor : 'none'}; background: transparent; padding: 4px 8px; cursor: pointer; font-weight: bold; font-size: 12px; transition: 0.2s; white-space: nowrap;">
                    ${tab.title}
                </button>
            `;

            contentHTML += `
                <div id="${contentId}" class="content-${containerId}" style="display: ${isDefault ? 'block' : 'none'};">
                    ${tab.content}
                </div>
            `;
        });

        headerHTML += `</div>`;

        return `
            <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 460px; scrollbar-width: thin;">
                ${headerHTML}
                ${contentHTML}
            </div>
        `;
    }
}