// src/main/settings/SettingsRenderer.js
const STYLE_ID = 'sce-settings-engine-styles';

export class SettingsRenderer {
    constructor(pluginContext, store) {
        this.app = pluginContext;
        this.store = store;
        this._stack = [];
    }

    render(schema, container, title = null) {
        this.container = container;
        this._stack = [{ schema, title }];
        this._draw();
    }

    _draw() {
        this._ensureSceStyles();
        const { schema, title } = this._stack[this._stack.length - 1];
        this.container.innerHTML = '';

        if (this._stack.length > 1) {
            this.container.appendChild(this._buildPageHeader(title));
        }

        const list = document.createElement('div');
        list.className = 'sce-list';
        (schema || []).forEach((field) => {
            const row = this._renderField(field);
            if (row) list.appendChild(row);
        });
        this.container.appendChild(list);
    }

    _buildPageHeader(title) {
        const header = document.createElement('div');
        header.className = 'sce-page-header';
        header.innerHTML = `<span class="sce-back-btn" aria-label="Back">&#8592;</span><span class="sce-page-title"></span>`;
        header.querySelector('.sce-page-title').textContent = title || '';
        header.querySelector('.sce-back-btn').addEventListener('click', () => this.back());
        return header;
    }

    back() {
        if (this._stack.length > 1) {
            this._stack.pop();
            this._draw();
            return true;
        }
        return false;
    }

    _renderField(field) {
        switch (field.type) {
            case 'header': return this._renderHeader(field);
            case 'subheader': return this._renderSubheader(field);
            case 'info': return this._renderInfo(field);
            case 'markdown': return this._renderMarkdown(field);
            case 'text': return this._renderTextInput(field);
            case 'textarea': return this._renderTextarea(field);
            case 'select': return this._renderSelect(field);
            case 'range': return this._renderRange(field);
            case 'toggle': return this._renderToggle(field);
            case 'page': return this._renderPage(field);
            case 'action': return this._renderAction(field); 
            default:
                console.log(`[SettingsRenderer] ⚠️ Unknown field type: ${field.type}`);
                return null;
        }
    }

    _renderHeader(field) {
        const el = document.createElement('div');
        el.className = 'sce-header';
        el.textContent = field.label || '';
        return el;
    }

    _renderSubheader(field) {
        const el = document.createElement('div');
        el.className = 'sce-subheader';
        el.textContent = field.label || '';
        return el;
    }

    _renderInfo(field) {
        const el = document.createElement('div');
        el.className = 'sce-info';
        el.innerHTML = `<span class="sce-info-icon">i</span><div class="sce-info-text"></div>`;
        el.querySelector('.sce-info-text').innerHTML = this._md(field.label || field.content || '');
        return el;
    }

    _renderMarkdown(field) {
        const el = document.createElement('div');
        el.className = 'sce-markdown';
        el.innerHTML = this._md(field.content || '');
        return el;
    }

    _rowShell(field) {
        const row = document.createElement('div');
        row.className = 'sce-row';
        row.innerHTML = `
            <div class="sce-row-main">
                <div class="sce-row-label"></div>
                ${field.description ? `<div class="sce-row-desc"></div>` : ''}
            </div>
            <div class="sce-row-control"></div>
        `;
        row.querySelector('.sce-row-label').textContent = field.label || field.key || '';
        if (field.description) row.querySelector('.sce-row-desc').innerHTML = this._md(field.description);
        return row;
    }

    _renderTextInput(field) {
        const row = this._rowShell(field);
        const control = row.querySelector('.sce-row-control');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sce-text-input';
        input.placeholder = field.placeholder || '';
        input.value = this.store.read(field) ?? '';
        input.addEventListener('change', () => this.store.write(field, input.value));
        control.appendChild(input);
        return row;
    }

    _renderTextarea(field) {
        const wrap = document.createElement('div');
        wrap.className = 'sce-row sce-row-stacked';
        wrap.innerHTML = `
            <div class="sce-row-label"></div>
            ${field.description ? `<div class="sce-row-desc"></div>` : ''}
        `;
        wrap.querySelector('.sce-row-label').textContent = field.label || field.key || '';
        if (field.description) wrap.querySelector('.sce-row-desc').innerHTML = this._md(field.description);

        const textarea = document.createElement('textarea');
        textarea.className = 'sce-textarea';
        textarea.rows = 4;
        textarea.placeholder = field.placeholder || '';
        textarea.value = this.store.read(field) ?? '';
        textarea.addEventListener('blur', () => this.store.write(field, textarea.value));
        wrap.appendChild(textarea);
        return wrap;
    }

    _renderSelect(field) {
        const row = this._rowShell(field);
        const control = row.querySelector('.sce-row-control');
        control.appendChild(this._buildCustomSelect(field));
        return row;
    }

    /**
     * Custom dropdown (Acode theme vars) — no native <select> popup.
     */
    _buildCustomSelect(field) {
        this._ensureSceStyles();
        const options = field.options || [];
        const current = this.store.read(field);
        const currentOpt = options.find(o => String(o.value) === String(current)) || options[0];

        const wrap = document.createElement('div');
        wrap.className = 'sce-dd';
        wrap.setAttribute('data-key', field.key || '');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sce-dd-btn';
        btn.innerHTML = `<span class="sce-dd-label"></span><span class="sce-dd-chevron">▾</span>`;
        const labelEl = btn.querySelector('.sce-dd-label');
        labelEl.textContent = currentOpt?.label || String(current ?? '');

        const menu = document.createElement('div');
        menu.className = 'sce-dd-menu';
        menu.style.display = 'none';

        const closeAll = () => {
            document.querySelectorAll('.sce-dd-menu').forEach(m => { m.style.display = 'none'; });
            document.querySelectorAll('.sce-dd.open').forEach(w => w.classList.remove('open'));
        };

        options.forEach((opt) => {
            const item = document.createElement('div');
            item.className = 'sce-dd-item' + (String(opt.value) === String(current) ? ' is-selected' : '');
            item.textContent = opt.label;
            item.dataset.value = opt.value;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                labelEl.textContent = opt.label;
                menu.querySelectorAll('.sce-dd-item').forEach(el => el.classList.remove('is-selected'));
                item.classList.add('is-selected');
                this.store.write(field, opt.value);
                if (typeof field.onChange === 'function') {
                    try { field.onChange(opt.value, this.app); } catch (_) {}
                }
                closeAll();
            });
            menu.appendChild(item);
        });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = menu.style.display === 'block';
            closeAll();
            if (!open) {
                menu.style.display = 'block';
                wrap.classList.add('open');
            }
        });

        if (!document.body._sceDdCloseBound) {
            document.body._sceDdCloseBound = true;
            document.addEventListener('click', () => closeAll());
        }

        wrap.appendChild(btn);
        wrap.appendChild(menu);
        return wrap;
    }

    _ensureSceStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = `
.sce-list { display:flex; flex-direction:column; gap:2px; padding:4px 0 16px; }
.sce-row { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; }
.sce-row-stacked { flex-direction:column; align-items:stretch; }
.sce-row-label { font-size:13px; font-weight:500; color:var(--primary-text-color,#eee); }
.sce-row-desc { font-size:11px; opacity:0.55; margin-top:2px; color:var(--primary-text-color,#eee); line-height:1.35; }
.sce-row-control { margin-left:auto; flex-shrink:0; }
.sce-row-stacked .sce-row-control { margin-left:0; width:100%; margin-top:6px; }
.sce-textarea {
  width:100%; min-height:72px; box-sizing:border-box; padding:8px 10px; border-radius:8px;
  border:1px solid var(--border-color,#444); background:var(--secondary-color,#1e1e2e);
  color:var(--primary-text-color,#eee); font-size:12px; font-family:inherit; resize:vertical;
}
.sce-dd { position:relative; min-width:140px; max-width:100%; }
.sce-dd-btn {
  display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;
  padding:7px 10px; border-radius:8px; cursor:pointer;
  border:1px solid var(--border-color,#444);
  background:var(--secondary-color,#1e1e2e);
  color:var(--primary-text-color,#eee); font-size:12px; font-family:inherit;
}
.sce-dd-btn:active { opacity:0.9; }
.sce-dd-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.sce-dd-chevron { opacity:0.55; font-size:10px; flex-shrink:0; }
.sce-dd-menu {
  position:absolute; right:0; top:calc(100% + 4px); z-index:200;
  min-width:100%; max-height:220px; overflow-y:auto;
  border-radius:10px; padding:4px;
  border:1px solid var(--border-color,#444);
  background:var(--secondary-color,#1e1e2e);
  box-shadow:0 8px 24px rgba(0,0,0,0.35);
}
.sce-dd-item {
  padding:8px 10px; border-radius:7px; font-size:12px; cursor:pointer;
  color:var(--primary-text-color,#eee);
}
.sce-dd-item:hover { background:var(--button-background-color,#4b5dd1); color:#fff; }
.sce-dd-item.is-selected {
  background:color-mix(in srgb, var(--button-background-color,#4b5dd1) 28%, transparent);
  font-weight:600;
}
.sce-page-header { display:flex; align-items:center; gap:10px; padding:8px 4px 12px; }
.sce-back-btn { cursor:pointer; font-size:18px; color:var(--primary-text-color,#eee); }
.sce-page-title { font-weight:600; color:var(--primary-text-color,#eee); }
`;
        document.head.appendChild(s);
    }

    _renderRange(field) {
        const row = this._rowShell(field);
        const control = row.querySelector('.sce-row-control');

        const value = this.store.read(field);
        const readout = document.createElement('span');
        readout.className = 'sce-range-readout';
        readout.textContent = this._formatRangeValue(field, value);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'sce-range';
        input.min = field.min ?? 0;
        input.max = field.max ?? 100;
        input.step = field.step ?? 1;
        input.value = value;

        input.addEventListener('input', () => {
            readout.textContent = this._formatRangeValue(field, input.value);
            if (field.onChange) field.onChange(input.value, this.app);
        });
        input.addEventListener('change', () => {
            this.store.write(field, parseFloat(input.value));
        });

        const wrap = document.createElement('div');
        wrap.className = 'sce-range-wrap';
        wrap.appendChild(input);
        wrap.appendChild(readout);
        control.appendChild(wrap);
        return row;
    }

    _formatRangeValue(field, rawValue) {
        const num = parseFloat(rawValue);
        if (field.percent) return `${Math.round(num * 100)}%`;
        if (field.unit) return `${num} ${field.unit}`;
        return `${num}`;
    }

    _renderToggle(field) {
        const row = this._rowShell(field);
        const control = row.querySelector('.sce-row-control');

        const label = document.createElement('label');
        label.className = 'sce-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!this.store.read(field);
        const slider = document.createElement('span');
        slider.className = 'sce-toggle-slider';

        input.addEventListener('change', () => this.store.write(field, input.checked));

        label.appendChild(input);
        label.appendChild(slider);
        control.appendChild(label);
        return row;
    }

    _renderPage(field) {
        const row = document.createElement('div');
        row.className = 'sce-row sce-row-clickable';
        row.innerHTML = `
            <div class="sce-row-main">
                <div class="sce-row-label"></div>
                ${field.description ? `<div class="sce-row-desc"></div>` : ''}
            </div>
            <span class="sce-chevron">&#8250;</span>
        `;
        row.querySelector('.sce-row-label').textContent = field.label || '';
        if (field.description) row.querySelector('.sce-row-desc').innerHTML = this._md(field.description);
        row.addEventListener('click', () => {
            this._stack.push({ schema: field.children || [], title: field.label });
            this._draw();
        });
        return row;
    }

    _renderAction(field) {
        const row = this._rowShell(field);
        const control = row.querySelector('.sce-row-control');
        const btn = document.createElement('button');
        btn.className = 'generic-btn';
        btn.textContent = field.buttonText || 'Execute';
        btn.style.cssText = 'padding: 6px 14px; font-size: 11.5px; cursor: pointer; border-radius: 6px; font-weight: bold; background: var(--active-color, #4b5dd1); color: #fff; border: none;';
        
        if (field.danger) {
            btn.style.background = 'rgba(244, 67, 54, 0.15)';
            btn.style.color = '#f44336';
            btn.style.border = '1px solid rgba(244, 67, 54, 0.4)';
        }

        // 🟢 PRO FIX: Append the button to the DOM BEFORE calling onInit
        control.appendChild(btn);

        if (field.onInit) {
            field.onInit(btn, this.app);
        }

        btn.addEventListener('click', async () => {
            if (field.onClick) {
                const originalText = btn.textContent;
                btn.textContent = 'Please wait...';
                btn.disabled = true;
                btn.style.opacity = '0.7';
                try {
                    await field.onClick(this.app, btn);
                } finally {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    btn.style.opacity = '1';
                }
            }
        });
        
        return row;
    }

    _md(text) {
        if (!text) return '';
        try {
            if (this.app?.md?.renderInline) {
                const html = this.app.md.renderInline(text);
                return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
            }
        } catch (_) { }
        return text;
    }
}