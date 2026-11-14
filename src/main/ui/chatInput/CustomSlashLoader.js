/**
 * Load user slash commands from .aicodex/commands/*.md
 * Frontmatter (optional YAML between ---):
 *   name: review
 *   description: Review code
 * Body: prompt template with $ARGUMENTS or {{args}}
 */
import {
  getProjectFolder, listDir, readFile, normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';
import { registerSlashCommand } from './SlashCommands.js';

const TAG = '[CustomSlash]';
const ROOT = '.aicodex/commands';

/** @type {Set<string>} */
const _registeredIds = new Set();

function parseFrontmatter(raw) {
  const text = String(raw || '');
  if (!text.startsWith('---')) {
    return { meta: {}, body: text.trim() };
  }
  const end = text.indexOf('---', 3);
  if (end < 0) return { meta: {}, body: text.trim() };
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 3).trim();
  const meta = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body };
}

function applyArgs(template, args) {
  const a = String(args || '').trim();
  return String(template || '')
    .replace(/\$ARGUMENTS/g, a)
    .replace(/\{\{\s*args\s*\}\}/gi, a)
    .replace(/\$ARGS/g, a);
}

async function readCmdFile(projectUri, rel) {
  try {
    const r = await readFile(normalizeSafUrl(joinSafPath(projectUri, rel)), 'utf-8');
    if (r?.success && typeof r.content === 'string') return r.content;
  } catch (_) {}
  return null;
}

/**
 * Discover command markdown files under .aicodex/commands
 * @returns {Promise<Array<{id,name,description,body,rel}>>}
 */
export async function discoverCustomCommands() {
  const project = await getProjectFolder();
  if (!project?.uri) return [];

  const found = [];
  try {
    const listed = await listDir(normalizeSafUrl(joinSafPath(project.uri, ROOT)));
    if (!listed?.success || !Array.isArray(listed.entries)) return [];

    for (const e of listed.entries) {
      const name = e.name || e;
      if (!name || name.startsWith('.')) continue;

      if (e.isDirectory) {
        // .aicodex/commands/<name>/COMMAND.md or SKILL-like
        for (const fname of ['COMMAND.md', 'command.md', 'CMD.md']) {
          const rel = `${ROOT}/${name}/${fname}`;
          const content = await readCmdFile(project.uri, rel);
          if (content) {
            const { meta, body } = parseFrontmatter(content);
            const id = String(meta.name || name).replace(/^\//, '').toLowerCase();
            found.push({
              id,
              name: '/' + id,
              description: meta.description || `Custom: ${id}`,
              body,
              rel,
              model: meta.model || null
            });
            break;
          }
        }
      } else if (/\.md$/i.test(name)) {
        const base = name.replace(/\.md$/i, '');
        const rel = `${ROOT}/${name}`;
        const content = await readCmdFile(project.uri, rel);
        if (!content) continue;
        const { meta, body } = parseFrontmatter(content);
        const id = String(meta.name || base).replace(/^\//, '').toLowerCase();
        found.push({
          id,
          name: '/' + id,
          description: meta.description || `Custom: ${id}`,
          body,
          rel,
          model: meta.model || null
        });
      }
    }
  } catch (e) {
    console.warn(TAG, 'discover', e?.message || e);
  }

  // de-dupe by id
  const map = new Map();
  for (const c of found) map.set(c.id, c);
  return [...map.values()];
}

/**
 * Register discovered commands into slash registry (idempotent).
 */
export async function registerCustomSlashCommands(app) {
  const list = await discoverCustomCommands();
  let n = 0;
  for (const c of list) {
    const id = `custom_${c.id}`;
    // Re-register by overwriting same id — registerSlashCommand should replace
    registerSlashCommand({
      id,
      name: c.name,
      description: c.description + ' (custom)',
      custom: true,
      subcommands: [
        {
          name: c.name + ' ',
          description: 'Run with arguments → fills chat input',
          insert: true
        }
      ],
      run: async (ctx) => {
        const args = String(ctx.args || '').trim();
        const prompt = applyArgs(c.body, args);
        if (!prompt.trim()) {
          const { pushChatEvent } = await import('./SlashCommands.js').catch(() => ({}));
          // fallback toast
          if (typeof window.toast === 'function') window.toast('Empty command body', 2000);
          return;
        }
        // Insert as user message ready to send — or auto-send
        const input = document.getElementById('gpt-user-input');
        if (input) {
          input.value = prompt;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        }
        // Auto-send so it behaves like a real slash agent command
        const send =
          document.getElementById('send-btn') ||
          document.getElementById('gpt-send-btn') ||
          document.querySelector('.gpt-send-btn, #send-button');
        if (send) {
          setTimeout(() => {
            try { send.click(); } catch (_) {}
          }, 40);
        } else if (typeof window.toast === 'function') {
          window.toast('Prompt filled — press Send', 2000);
        }
        console.log(TAG, 'ran', c.name, 'args=', args.slice(0, 40));
      }
    });
    _registeredIds.add(id);
    n++;
  }
  console.log(TAG, 'registered', n, 'custom commands');
  return list;
}

export async function listCustomCommands() {
  return discoverCustomCommands();
}

export const CustomSlashLoader = {
  discoverCustomCommands,
  registerCustomSlashCommands,
  listCustomCommands
};
