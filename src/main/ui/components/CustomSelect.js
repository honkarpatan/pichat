// src/main/ui/components/CustomSelect.js
const escapeAttr = (str) => String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class CustomSelect {
    static render(id, options, selectedValue, styles = {}, disabled = false) {
        const bg = styles.inputBg || 'var(--secondary-color, #1e1e1e)';
        const border = styles.borderColor || 'var(--border-color, #444)';
        const text = styles.textColor || 'var(--primary-text-color, #fff)';
        const accent = styles.accentColor || '#4b5dd1';

        let activeItem = options.find(o => String(o.value) === String(selectedValue));
        if (!activeItem && options.length > 0) activeItem = options[0];

        const selectedLabel = activeItem ? activeItem.label : 'Select...';
        const safeSelectedVal = activeItem ? activeItem.value : '';

        let optionsHtml = options.map(opt => `
            <div class="gpt-custom-option" data-value="${escapeAttr(opt.value)}" style="padding: 10px 12px; font-size: 12px; cursor: pointer; transition: background 0.2s; color:${String(opt.value) === String(safeSelectedVal) ? accent : text}; border-bottom: 1px solid rgba(255,255,255,0.02); display: flex; align-items: center; justify-content: space-between;">
                <span>${escapeAttr(opt.label)}</span>
                ${String(opt.value) === String(safeSelectedVal) ? `<svg class="opt-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
            </div>
        `).join('');

        return `
        <div class="gpt-custom-select-wrapper ${disabled ? 'is-disabled' : ''}" id="${escapeAttr(id)}" data-disabled="${disabled ? '1' : '0'}" style="position: relative; width: 100%; user-select: none; z-index: 20; ${disabled ? 'opacity: 0.5; pointer-events: none;' : ''}">
            <div class="gpt-custom-select-header" style="background: ${bg}; border: 1px solid ${border}; border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; color: ${text}; font-size: 12px; transition: border-color 0.2s;">
                <span class="gpt-custom-select-value" data-value="${escapeAttr(safeSelectedVal)}">${escapeAttr(selectedLabel)}</span>
                <svg class="gpt-custom-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; flex-shrink:0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div class="gpt-custom-select-dropdown" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: ${bg}; border: 1px solid ${border}; border-radius: 6px; max-height: 220px; overflow-y: auto; z-index: 80; box-shadow: 0 8px 24px rgba(0,0,0,0.35);">
                ${optionsHtml}
            </div>
        </div>`;
    }

    static wire(id, onChange, styles = {}) {
        const wrapper = document.getElementById(id);
        if (!wrapper) return;
        if (wrapper.getAttribute('data-disabled') === '1' || wrapper.classList.contains('is-disabled')) return;

        // Re-wire safely (refresh replaces DOM)
        if (wrapper._gptSelectCleanup) {
            try { wrapper._gptSelectCleanup(); } catch (_) {}
            wrapper._gptSelectCleanup = null;
        }

        const header = wrapper.querySelector('.gpt-custom-select-header');
        const dropdown = wrapper.querySelector('.gpt-custom-select-dropdown');
        const chevron = wrapper.querySelector('.gpt-custom-select-chevron');
        const valueSpan = wrapper.querySelector('.gpt-custom-select-value');
        const options = wrapper.querySelectorAll('.gpt-custom-option');
        if (!header || !dropdown) return;

        const border = styles.borderColor || 'var(--border-color, #444)';
        const accent = styles.accentColor || '#4b5dd1';
        const text = styles.textColor || 'var(--primary-text-color, #fff)';

        let docCloser = null;
        const closeDropdown = () => {
            dropdown.style.display = 'none';
            dropdown.style.position = '';
            dropdown.style.top = '';
            dropdown.style.left = '';
            dropdown.style.width = '';
            dropdown.style.right = '';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            header.style.borderColor = border;
            if (docCloser) {
                document.removeEventListener('pointerdown', docCloser, true);
                docCloser = null;
            }
        };

        const openDropdown = () => {
            document.querySelectorAll('.gpt-custom-select-dropdown').forEach(d => {
                if (d !== dropdown) {
                    d.style.display = 'none';
                    d.style.position = '';
                    d.style.top = '';
                    d.style.left = '';
                    d.style.width = '';
                }
            });
            document.querySelectorAll('.gpt-custom-select-chevron').forEach(s => {
                if (s !== chevron) s.style.transform = 'rotate(0deg)';
            });
            // Fixed position so overflow:scroll parents (ApiKey tab) cannot clip the menu
            const rect = header.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.top = Math.min(rect.bottom + 4, window.innerHeight - 40) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = Math.max(rect.width, 160) + 'px';
            dropdown.style.right = 'auto';
            dropdown.style.zIndex = '9999';
            dropdown.style.display = 'block';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
            header.style.borderColor = accent;
            if (docCloser) document.removeEventListener('pointerdown', docCloser, true);
            docCloser = (ev) => {
                if (wrapper.contains(ev.target) || dropdown.contains(ev.target)) return;
                closeDropdown();
            };
            setTimeout(() => {
                document.addEventListener('pointerdown', docCloser, true);
            }, 0);
        };

        const onHeader = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            if (isOpen) closeDropdown();
            else openDropdown();
        };

        header.addEventListener('click', onHeader);
        header.addEventListener('pointerdown', (e) => e.stopPropagation());

        const optHandlers = [];
        options.forEach(opt => {
            const enter = () => { opt.style.background = 'rgba(255,255,255,0.05)'; };
            const leave = () => { opt.style.background = 'transparent'; };
            const click = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const val = opt.getAttribute('data-value');
                const label = opt.querySelector('span')?.textContent?.trim() || val;
                if (valueSpan) {
                    valueSpan.textContent = label;
                    valueSpan.setAttribute('data-value', val);
                }
                options.forEach(o => {
                    o.style.color = text;
                    o.querySelector('.opt-check')?.remove();
                });
                opt.style.color = accent;
                opt.insertAdjacentHTML('beforeend', `<svg class="opt-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`);
                closeDropdown();
                if (typeof onChange === 'function') onChange(val);
            };
            opt.addEventListener('pointerenter', enter);
            opt.addEventListener('pointerleave', leave);
            opt.addEventListener('click', click);
            optHandlers.push({ opt, enter, leave, click });
        });

        wrapper._gptSelectCleanup = () => {
            header.removeEventListener('click', onHeader);
            closeDropdown();
            optHandlers.forEach(({ opt, enter, leave, click }) => {
                opt.removeEventListener('pointerenter', enter);
                opt.removeEventListener('pointerleave', leave);
                opt.removeEventListener('click', click);
            });
        };
    }

    static getValue(id) {
        const el = document.getElementById(id);
        if (!el) return null;
        return el.querySelector('.gpt-custom-select-value')?.getAttribute('data-value') ?? null;
    }

    static setDisabled(id, disabled) {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('data-disabled', disabled ? '1' : '0');
        el.classList.toggle('is-disabled', !!disabled);
        el.style.opacity = disabled ? '0.5' : '1';
        el.style.pointerEvents = disabled ? 'none' : '';
    }
}
