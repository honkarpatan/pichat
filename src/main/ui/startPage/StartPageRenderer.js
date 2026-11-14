import { getStartPageTheme } from './StartPageThemes.js';
import {
  resolveStartPageThemeId,
  DEFAULT_COMMAND_HINTS
} from './StartPageConfig.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function modelIconHtml(model) {
  if (!model) return '';
  const img = model.image || '';
  if (typeof img === 'string' && img.trim().startsWith('<svg')) return img;
  if (img) return `<img src="${escapeHtml(img)}" alt="" style="max-width:80%;max-height:80%;object-fit:contain;">`;
  return '';
}

function colorsFromModel(model) {
  const bg = model?.image_bg || model?.startPage?.iconBg || '#111';
  const accent = model?.startPage?.accent
    || model?.styles?.sendBtn?.backgroundColor
    || bg;
  const chipBg = model?.startPage?.chipBg || 'rgba(225,220,220,0.55)';
  const chipText = model?.startPage?.chipText || 'var(--primary-text-color, #222)';
  const muted = model?.startPage?.mutedText || 'var(--secondary-text-color, #4d4d4d)';
  return { bg, accent, chipBg, chipText, muted };
}

/**
 * Build full #gpt-start-page HTML for empty chat.
 * @param {object} opts
 * @param {object} opts.model - selected ModelConfig entry
 * @param {string} [opts.modelType]
 * @param {Array} [opts.infoItems]
 * @param {Array} [opts.commandHints]
 */
export function buildStartPageHTML(opts = {}) {
  const model = opts.model || {};
  const modelType = opts.modelType || model.type || '';
  const themeId = resolveStartPageThemeId(modelType, model);
  const theme = getStartPageTheme(themeId);
  const colors = colorsFromModel(model);
  const icon = modelIconHtml(model);
  const name = model.name || modelType || 'AI';

  const pageStyle = [
    'display:flex',
    'flex-direction:column',
    `justify-content:${theme.page.justify}`,
    `align-items:${theme.page.align}`,
    'height:100%',
    'min-height:60vh',
    `padding:${theme.page.padding}`,
    `gap:${theme.page.gap}`,
    'box-sizing:border-box',
    'position:relative',
    `--sp-icon-bg:${colors.bg}`,
    `--sp-accent:${colors.accent}`,
    `--sp-chip-bg:${colors.chipBg}`,
    `--sp-chip-text:${colors.chipText}`,
    `--sp-muted:${colors.muted}`
  ].join(';');

  const iconStyle = [
    `background-color:var(--sp-icon-bg)`,
    `width:${theme.icon.size}px`,
    `height:${theme.icon.size}px`,
    `border-radius:${theme.icon.radius}`,
    'align-items:center',
    'justify-content:center',
    'display:flex',
    'overflow:hidden',
    'flex-shrink:0',
    theme.icon.shadow ? `box-shadow:${theme.icon.shadow}` : '',
    theme.icon.marginBottom ? `margin-bottom:${theme.icon.marginBottom}px` : ''
  ].filter(Boolean).join(';');

  const animClass = theme.animation?.enter
    ? ` gpt-start-anim-${theme.animation.enter}`
    : '';

  let greeting = '';
  if (theme.showGreeting) {
    greeting = `<div class="gpt-start-greeting" style="font-size:1.15em;font-weight:600;color:var(--primary-text-color);text-align:center;opacity:0.92;">
      How can I help you today?
    </div>`;
  }

  let modelName = '';
  if (theme.showModelName) {
    modelName = `<div class="gpt-start-model-name" style="font-size:12px;opacity:0.55;color:var(--primary-text-color);letter-spacing:0.02em;">
      ${escapeHtml(name)}
    </div>`;
  }

  let chips = '';
  if (theme.chips.position !== 'none') {
    const parts = [];
    if (theme.showCommandHints) {
      const hints = opts.commandHints || DEFAULT_COMMAND_HINTS;
      // If both commands + info, keep commands mid-page so they don't overlap bottom info
      const cmdTheme = (theme.showInfo && theme.chips.position === 'bottom')
        ? { ...theme, chips: { ...theme.chips, position: 'center' } }
        : theme;
      parts.push(buildCommandChips(hints, cmdTheme, colors));
    }
    if (theme.showInfo) {
      parts.push(buildInfoShell(theme));
    }
    chips = parts.join('\n');
  }

  return `<div id="gpt-start-page" class="gpt-start-page gpt-start--${escapeHtml(theme.id)}${animClass}" data-start-theme="${escapeHtml(theme.id)}" style="${pageStyle}">
  <div id="gpt-start-page-icon" class="gpt-start-icon" style="${iconStyle}">${icon}</div>
  ${modelName}
  ${greeting}
  ${chips}
</div>`;
}

function buildInfoShell(theme) {
  const pos = theme.chips.position === 'bottom'
    ? 'position:absolute;bottom:5px;left:0;right:0;'
    : '';
  return `<div class="gpt-info gpt-start-chips gpt-start-cmd-scroll" style="width:100%;max-width:100%;box-sizing:border-box;text-align:center;line-height:1.5;${pos}">
  <div class="gpt-start-info-inner" style="display:flex;flex-direction:${theme.chips.direction};flex-wrap:nowrap;gap:${theme.chips.gap};width:max-content;min-width:100%;box-sizing:border-box;padding:4px 16px 8px;justify-content:center;"></div>
</div>`;
}

function buildCommandChips(hints, theme, colors) {
  const pos = theme.chips.position === 'bottom'
    ? 'position:absolute;bottom:8px;left:0;right:0;'
    : '';
  const wave = theme.animation?.chip === 'wave' ? ' gpt-slow-wave' : '';
  const items = (hints || []).map((h) => {
    const cmd = h.cmd || h.command || '';
    const label = h.label || cmd;
    const hint = h.hint || '';
    return `<button type="button" class="gpt-start-cmd-chip${wave}" data-slash-cmd="${escapeHtml(cmd)}"
      style="min-width:max-content;height:${theme.chips.height}px;background:var(--sp-chip-bg);border:1px solid var(--border-color,rgba(0,0,0,.08));border-radius:${theme.chips.radius}px;padding:6px 14px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;flex:0 0 auto;cursor:pointer;opacity:${theme.chips.opacity};color:var(--sp-chip-text);-webkit-tap-highlight-color:transparent;">
      <span style="font-size:12px;font-weight:600;font-family:var(--oc2-mono,ui-monospace,monospace);white-space:nowrap;">${escapeHtml(cmd || label)}</span>
      ${hint ? `<span style="font-size:10px;opacity:0.7;white-space:nowrap;">${escapeHtml(hint)}</span>` : ''}
    </button>`;
  }).join('');

  // Outer = full-width scrollport; inner = max-content row (centers when short, scrolls when wide)
  return `<div class="gpt-start-cmd-scroll gpt-start-chips" style="width:100%;max-width:100%;box-sizing:border-box;${pos}">
  <div class="gpt-start-cmd-row" style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:${theme.chips.gap};width:max-content;min-width:100%;box-sizing:border-box;padding:4px 16px 8px;justify-content:center;align-items:stretch;">
    ${items}
  </div>
</div>`;
}

/**
 * Fill .gpt-info with tip cards (ChatGPT-style).
 */
export function fillInfoChips(container, infoItems = [], themeId = 'chatgpt') {
  if (!container) return;
  const theme = getStartPageTheme(themeId);
  const host = container.querySelector('.gpt-start-info-inner') || container;
  host.innerHTML = '';
  if (!theme.showInfo) return;

  const sorted = [...infoItems].sort((a, b) => (a.function === 'none' ? -1 : 1));
  const pick = sorted.slice().sort(() => 0.5 - Math.random()).slice(0, 4);
  const wave = theme.animation?.chip === 'wave' ? 'gpt-slow-wave' : '';

  pick.forEach((info) => {
    const el = document.createElement('div');
    el.className = `gpt-info-list ${wave}`.trim();
    el.style.cssText = [
      'min-width:auto',
      `height:${theme.chips.height}px`,
      'background-color:var(--sp-chip-bg, rgba(225,220,220,0.55))',
      `border-radius:${theme.chips.radius}px`,
      'text-align:center',
      'line-height:1.5',
      'display:flex',
      'justify-content:center',
      'align-items:center',
      'flex-direction:column',
      'padding:6px 8px',
      'flex-grow:1',
      'flex-shrink:0',
      `opacity:${theme.chips.opacity}`
    ].join(';');

    const title = document.createElement('p');
    title.className = 'bottom-info-heading';
    title.style.cssText = 'font-size:1.05em;font-weight:500;margin:0;color:var(--sp-chip-text, inherit);';
    title.textContent = info.title || '';

    const content = document.createElement('p');
    content.className = 'bottom-info-title';
    content.style.cssText = 'font-size:0.85em;margin:2px 0 0;color:var(--sp-muted, #4d4d4d);';
    content.textContent = info.content || '';

    el.appendChild(title);
    el.appendChild(content);

    if (info.function === 'none') {
      el.style.pointerEvents = 'none';
      el.style.opacity = String(Math.min(0.6, theme.chips.opacity));
    } else {
      el.style.cursor = 'pointer';
      el.dataset.functionType = info.function || '';
      el.dataset.title = info.title || '';
      el.dataset.content = info.content || '';
    }
    host.appendChild(el);
  });
}

/**
 * Mount / refresh start page into #chat-box.
 * Wires command chips → insert into input; info chips → optional onInfoClick.
 */
export function mountStartPage(chatBox, opts = {}) {
  if (!chatBox) return null;
  const html = buildStartPageHTML(opts);
  chatBox.innerHTML = html;
  const root = chatBox.querySelector('#gpt-start-page');
  const themeId = root?.getAttribute('data-start-theme') || 'chatgpt';
  const theme = getStartPageTheme(themeId);

  if (theme.showInfo && opts.infoItems?.length) {
    fillInfoChips(root.querySelector('.gpt-info'), opts.infoItems, themeId);
  }

  // Command chips → put slash text into composer
  root?.querySelectorAll('.gpt-start-cmd-chip[data-slash-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-slash-cmd') || '';
      const input = document.getElementById('gpt-user-input');
      if (input && cmd) {
        input.value = cmd + (input.value ? '' : ' ');
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof opts.onCommandClick === 'function') opts.onCommandClick(cmd);
    });
  });

  // Info chips
  root?.querySelectorAll('.gpt-info-list[data-function-type]').forEach((el) => {
    el.addEventListener('click', () => {
      if (typeof opts.onInfoClick === 'function') {
        opts.onInfoClick(
          el.dataset.functionType,
          el.dataset.title,
          el.dataset.content
        );
      }
    });
  });

  return root;
}

/** Update only the center icon (model switch while start page visible). */
export function updateStartPageIcon(model) {
  const iconEl = document.getElementById('gpt-start-page-icon');
  if (!iconEl || !model) return;
  const colors = colorsFromModel(model);
  iconEl.style.backgroundColor = colors.bg;
  iconEl.innerHTML = modelIconHtml(model);
  const page = document.getElementById('gpt-start-page');
  if (page) {
    page.style.setProperty('--sp-icon-bg', colors.bg);
    page.style.setProperty('--sp-accent', colors.accent);
  }
}
