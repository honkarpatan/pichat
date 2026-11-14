/**
 * @file autocomplete popup above the input.
 */
import {
  getProjectFileIndex,
  filterFiles,
  extractAtMentions
} from '../../context/ProjectFileIndex.js';
import { readFile, getProjectFolder, joinSafPath, normalizeSafUrl } from '../../utils/file/fileOperations.js';

const BOX_ID = 'gpt-at-suggest';
const MAX_READ_CHARS = 6000;

function getAtToken(value, cursor) {
  const before = String(value || '').slice(0, cursor ?? value?.length ?? 0);
  const m = before.match(/(^|\s)@([^\s]*)$/);
  if (!m) return null;
  return { query: m[2] || '', start: before.length - (m[2] || '').length - 1 };
}

export function hideAtSuggestions() {
  try { document.getElementById(BOX_ID)?.remove(); } catch (_) {}
}

/**
 * @param {object} ui ChatInputUI-ish
 * @param {string} value input value
 * @param {number} [cursor]
 */
export async function updateAtSuggestions(ui, value, cursor) {
  const token = getAtToken(value, cursor);
  if (!token) {
    hideAtSuggestions();
    return;
  }
  let files = [];
  try {
    files = await getProjectFileIndex();
  } catch (e) {
    console.warn('[FileMention] index', e);
  }
  const matches = filterFiles(files, token.query, 12);
  if (!matches.length) {
    hideAtSuggestions();
    return;
  }

  const inputContainer = document.getElementById('input-container');
  let box = document.getElementById(BOX_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = [
      'position:absolute', 'left:0', 'right:0', 'bottom:100%',
      'z-index:91', 'max-height:220px', 'overflow:auto',
      'background:var(--secondary-color,#1e1e2e)',
      'border:1px solid var(--border-color,#333)',
      'border-radius:0', 'border-bottom:none',
      'box-shadow:0 -6px 18px rgba(0,0,0,0.25)'
    ].join(';');
    if (inputContainer) {
      if (getComputedStyle(inputContainer).position === 'static') {
        inputContainer.style.position = 'relative';
      }
      inputContainer.appendChild(box);
    } else {
      document.body.appendChild(box);
    }
  }

  box.innerHTML = matches.map(f => `
    <div class="gpt-at-item" data-path="${f.replace(/"/g, '&quot;')}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border-color,#333);">
      <span style="font-size:13px;font-weight:600;color:var(--primary-text-color);">@${f.replace(/</g, '&lt;')}</span>
    </div>
  `).join('');

  box.querySelectorAll('.gpt-at-item').forEach(row => {
    row.onclick = () => {
      const input = document.getElementById('gpt-user-input');
      if (!input) return;
      const path = row.dataset.path;
      const cur = input.selectionStart ?? input.value.length;
      const tok = getAtToken(input.value, cur);
      if (!tok) return;
      const before = input.value.slice(0, tok.start);
      const after = input.value.slice(cur);
      input.value = before + '@' + path + ' ' + after;
      const pos = (before + '@' + path + ' ').length;
      input.focus();
      input.setSelectionRange(pos, pos);
      hideAtSuggestions();
      if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
    };
  });
}

/**
 * Read @mentioned files into a context block for the model.
 */
export async function buildAtMentionContext(userText) {
  const paths = extractAtMentions(userText);
  if (!paths.length) return '';
  const project = await getProjectFolder();
  if (!project?.uri) return '';

  const parts = [];
  for (const rel of paths.slice(0, 8)) {
    try {
      const url = joinSafPath(project.uri, rel.replace(/^\.\//, ''));
      const r = await readFile(normalizeSafUrl(url), 'utf-8');
      if (r?.success && typeof r.content === 'string') {
        let body = r.content;
        if (body.length > MAX_READ_CHARS) {
          body = body.slice(0, MAX_READ_CHARS) + '\n…[truncated]';
        }
        parts.push(`### @${rel}\n\`\`\`\n${body}\n\`\`\``);
      } else {
        parts.push(`### @${rel}\n(Could not read file)`);
      }
    } catch (_) {
      parts.push(`### @${rel}\n(Could not read file)`);
    }
  }
  if (!parts.length) return '';
  return (
    `[User @file mentions — treat these as attached context]\n\n` +
    parts.join('\n\n')
  );
}

export { extractAtMentions };
