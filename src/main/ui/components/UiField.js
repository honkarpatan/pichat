/**
 * Reusable form fields — Acode theme variables, no raw browser chrome.
 * Use instead of window.prompt / bare <input> where possible.
 *
 * Classes: .gpt-field, .gpt-field-label, .gpt-field-hint,
 *          .gpt-input, .gpt-textarea, .gpt-select (see reusable_components.css)
 */

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  });
  return node;
}

/**
 * @param {object} opts
 * @param {string} [opts.id]
 * @param {string} [opts.label]
 * @param {string} [opts.hint]
 * @param {string} [opts.placeholder]
 * @param {string} [opts.value]
 * @param {string} [opts.type='text']
 * @param {boolean} [opts.disabled]
 * @param {number} [opts.maxLength]
 * @returns {{ root: HTMLElement, input: HTMLInputElement, getValue: () => string, setValue: (v: string) => void }}
 */
export function createInput(opts = {}) {
  const root = el('div', 'gpt-field');
  if (opts.label) root.appendChild(el('label', 'gpt-field-label', { text: opts.label, for: opts.id || undefined }));
  const input = el('input', 'gpt-input', {
    id: opts.id,
    type: opts.type || 'text',
    placeholder: opts.placeholder || '',
    value: opts.value != null ? String(opts.value) : '',
    disabled: !!opts.disabled,
    maxlength: opts.maxLength
  });
  root.appendChild(input);
  if (opts.hint) root.appendChild(el('div', 'gpt-field-hint', { text: opts.hint }));
  return {
    root,
    input,
    getValue: () => input.value,
    setValue: (v) => { input.value = v != null ? String(v) : ''; }
  };
}

/**
 * @param {object} opts — same as createInput + rows, maxHeight
 * @returns {{ root: HTMLElement, textarea: HTMLTextAreaElement, getValue: () => string, setValue: (v: string) => void }}
 */
export function createTextarea(opts = {}) {
  const root = el('div', 'gpt-field');
  if (opts.label) root.appendChild(el('label', 'gpt-field-label', { text: opts.label, for: opts.id || undefined }));
  const textarea = el('textarea', 'gpt-textarea', {
    id: opts.id,
    placeholder: opts.placeholder || '',
    rows: opts.rows || 4,
    disabled: !!opts.disabled,
    maxlength: opts.maxLength
  });
  textarea.value = opts.value != null ? String(opts.value) : '';
  if (opts.maxHeight) textarea.style.maxHeight = typeof opts.maxHeight === 'number' ? `${opts.maxHeight}px` : opts.maxHeight;

  const autoGrow = () => {
    textarea.style.height = 'auto';
    const max = parseInt(textarea.style.maxHeight, 10) || 280;
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
  };
  textarea.addEventListener('input', autoGrow);
  requestAnimationFrame(autoGrow);

  root.appendChild(textarea);
  if (opts.hint) root.appendChild(el('div', 'gpt-field-hint', { text: opts.hint }));
  return {
    root,
    textarea,
    getValue: () => textarea.value,
    setValue: (v) => {
      textarea.value = v != null ? String(v) : '';
      autoGrow();
    }
  };
}

/**
 * Native select styled with theme vars (for simple cases).
 * For richer dropdowns prefer CustomSelect.
 *
 * @param {object} opts
 * @param {{ value: string, label: string }[]} opts.options
 * @param {string} [opts.value]
 * @returns {{ root: HTMLElement, select: HTMLSelectElement, getValue: () => string, setValue: (v: string) => void }}
 */
export function createSelect(opts = {}) {
  const root = el('div', 'gpt-field');
  if (opts.label) root.appendChild(el('label', 'gpt-field-label', { text: opts.label, for: opts.id || undefined }));
  const select = el('select', 'gpt-select', {
    id: opts.id,
    disabled: !!opts.disabled
  });
  (opts.options || []).forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (String(o.value) === String(opts.value)) opt.selected = true;
    select.appendChild(opt);
  });
  root.appendChild(select);
  if (opts.hint) root.appendChild(el('div', 'gpt-field-hint', { text: opts.hint }));
  return {
    root,
    select,
    getValue: () => select.value,
    setValue: (v) => { select.value = v != null ? String(v) : ''; }
  };
}
