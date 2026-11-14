// src/main/utils/ProjectWorkspace.js
import { ConfigManager } from './ConfigManager.js';

const STORAGE_KEY = 'gpt_project_workspaces_by_chat';
const INSTR_KEY = 'gpt_project_instructions_by_chat';

function uid() {
  return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function chatKey(conversationId) {
  if (conversationId == null || conversationId === '') return 'default';
  return String(conversationId);
}

function loadMap() {
  try {
    const raw = ConfigManager.get(STORAGE_KEY, null);
    if (!raw) return {};
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (_) {
    return {};
  }
}

function saveMap(map) {
  ConfigManager.set(STORAGE_KEY, JSON.stringify(map || {}));
}

export function pathUnderWorkspace(candidate, workspaceUrl) {
  if (!candidate || !workspaceUrl) return false;
  const c = normalizeUrl(candidate);
  const w = normalizeUrl(workspaceUrl);
  if (!c || !w) return false;
  if (c === w) return true;
  if (c.startsWith(w + '/') || c.startsWith(w + '%2F') || c.startsWith(w + '%2f')) return true;
  const cTail = c.includes('::') ? c.slice(c.lastIndexOf('::') + 2) : c;
  const wTail = w.includes('::') ? w.slice(w.lastIndexOf('::') + 2) : w;
  if (cTail && wTail && (cTail === wTail || cTail.startsWith(wTail + '/') || cTail.startsWith(wTail.replace(/^primary:/i, '') + '/'))) {
    return true;
  }
  const wName = wTail.split('/').filter(Boolean).pop() || '';
  if (wName && (cTail === wName || cTail.startsWith(wName + '/') || c.includes('/' + wName + '/'))) {
    return true;
  }
  return false;
}

export class ProjectWorkspace {
  static activeChatId(app) {
    if (app && app.currentConversationIndex != null) return chatKey(app.currentConversationIndex);
    try {
      const idx = ConfigManager.get('current_chat_index', null);
      if (idx != null && idx !== '') return chatKey(idx);
    } catch (_) {}
    return 'default';
  }

  static list(conversationId) {
    const map = loadMap();
    const key = chatKey(conversationId);
    const arr = map[key];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(w => w && w.url)
      .map(w => ({
        id: w.id || uid(),
        name: String(w.name || 'Workspace').trim() || 'Workspace',
        url: normalizeUrl(w.url)
      }));
  }

  static saveAll(conversationId, list) {
    const map = loadMap();
    const key = chatKey(conversationId);
    const clean = (Array.isArray(list) ? list : [])
      .filter(w => w && w.url)
      .map(w => ({
        id: w.id || uid(),
        name: String(w.name || 'Workspace').trim() || 'Workspace',
        url: normalizeUrl(w.url)
      }));
    if (clean.length) map[key] = clean;
    else delete map[key];
    saveMap(map);
    return clean;
  }

  static add(conversationId, { name, url }) {
    const list = ProjectWorkspace.list(conversationId);
    const nUrl = normalizeUrl(url);
    if (!nUrl) return list;
    if (list.some(w => normalizeUrl(w.url) === nUrl)) {
      if (name) {
        const next = list.map(w =>
          normalizeUrl(w.url) === nUrl ? { ...w, name: String(name).trim() || w.name } : w
        );
        return ProjectWorkspace.saveAll(conversationId, next);
      }
      return list;
    }
    list.push({
      id: uid(),
      name: String(name || 'Workspace').trim() || 'Workspace',
      url: nUrl
    });
    return ProjectWorkspace.saveAll(conversationId, list);
  }

  static remove(conversationId, idOrUrl) {
    const key = String(idOrUrl || '');
    const next = ProjectWorkspace.list(conversationId).filter(
      w => w.id !== key && normalizeUrl(w.url) !== normalizeUrl(key)
    );
    return ProjectWorkspace.saveAll(conversationId, next);
  }

  static hasAny(conversationId) {
    return ProjectWorkspace.list(conversationId).length > 0;
  }

  static isPathAllowed(conversationId, pathOrUrl) {
    const list = ProjectWorkspace.list(conversationId);
    if (!list.length) return true;
    if (!pathOrUrl) return false;
    return list.some(w => pathUnderWorkspace(pathOrUrl, w.url));
  }

  static resolveToWorkspace(conversationId, path) {
    const raw = String(path || '').trim();
    if (!raw) return raw;
    const list = ProjectWorkspace.list(conversationId);
    if (!list.length) return raw;

    const root = list[0].url;
    const rootName = list[0].name || root.split(/[/:]/).filter(Boolean).pop() || '';

    // True device/SAF absolute paths only (NOT "/js/app.js" relative paths!)
    const isDeviceAbsolute =
      raw.includes('content://') ||
      raw.includes('::') ||
      /^\/(?:sdcard|storage|data|mnt|system)\b/i.test(raw);

    if (isDeviceAbsolute) {
      if (ProjectWorkspace.isPathAllowed(conversationId, raw)) return normalizeUrl(raw);
      // Extract relative tail if workspace name appears in the path, otherwise keep last 2 segments if subfolder
      const parts = raw.split(/[\\/]/).filter(Boolean);
      const wsIdx = rootName ? parts.findIndex(p => p.toLowerCase() === rootName.toLowerCase()) : -1;
      if (wsIdx !== -1 && wsIdx < parts.length - 1) {
        return normalizeUrl(root + '/' + parts.slice(wsIdx + 1).join('/'));
      }
      const basename = parts.pop() || '';
      if (!basename) return root;
      return normalizeUrl(root + '/' + basename);
    }

    // Relative path (including "/js/script.js" or "./js/script.js" or "MyProject/js/script.js")
    let rel = raw.replace(/^\.?\/+/, '');
    if (rootName && (rel === rootName || rel.startsWith(rootName + '/'))) {
      rel = rel === rootName ? '' : rel.slice(rootName.length + 1);
    }
    if (!rel || rel === '.') return root;
    return normalizeUrl(root + '/' + rel);
  }

  static getInstruction(conversationId) {
    try {
      const raw = ConfigManager.get(INSTR_KEY, null);
      if (!raw) return '';
      const map = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!map || typeof map !== 'object') return '';
      return String(map[chatKey(conversationId)] || '').trim();
    } catch (_) {
      return '';
    }
  }

  static setInstruction(conversationId, text) {
    let map = {};
    try {
      const raw = ConfigManager.get(INSTR_KEY, null);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') map = parsed;
      }
    } catch (_) {}
    const key = chatKey(conversationId);
    const v = String(text || '').trim();
    if (v) map[key] = v;
    else delete map[key];
    ConfigManager.set(INSTR_KEY, JSON.stringify(map));
    return v;
  }

  static contextBlock(conversationId) {
    const list = ProjectWorkspace.list(conversationId);
    const instr = ProjectWorkspace.getInstruction(conversationId);
    let block = '';
    if (!list.length) {
      block = `[Project Workspace]\nNo explicit workspace locked for this chat. Operate strictly inside the active project folder.`;
    } else {
      const lines = list.map(w => {
        let s = String(w.url || '');
        const i = s.lastIndexOf('::');
        if (i !== -1) s = s.slice(i + 2);
        s = s.replace(/^primary:/i, '').replace(/^\/+/, '');
        const shell = s ? `/sdcard/${s}` : '';
        return `- ${w.name}: ${w.url}` + (shell ? `\n  Shell: ${shell}` : '');
      }).join('\n');
      block = `[Project Workspace — RESTRICTED to this chat]\nYou MUST only read/write/list under these workspace roots. Never touch files outside them.\n${lines}`;
    }
    if (instr) {
      block += `\n\n[User project instructions — follow these for this chat]\n${instr}`;
    }
    return block;
  }

  static async pickFolder() {
    try {
      const fileBrowser = acode.require('fileBrowser');
      if (!fileBrowser) {
        if (typeof window.toast === 'function') window.toast('Folder picker not available', 2500);
        return null;
      }
      const picked = await fileBrowser('folder', 'Select project folder', true);
      if (!picked) {
        if (typeof window.toast === 'function') window.toast('No folder selected', 2000);
        return null;
      }
      const url = picked.url || picked.uri || picked.path || null;
      if (!url) {
        if (typeof window.toast === 'function') window.toast('Could not read folder path', 2500);
        return null;
      }
      const name =
        picked.name ||
        picked.filename ||
        (String(url).includes('::')
          ? String(url).slice(String(url).lastIndexOf('::') + 2).split('/').filter(Boolean).pop()
          : String(url).split('/').filter(Boolean).pop()) ||
        'Workspace';
      return { url, name };
    } catch (e) {
      console.error('[ProjectWorkspace] pickFolder', e);
      if (typeof window.toast === 'function') window.toast('Folder select failed', 2500);
      return null;
    }
  }

  static async promptName(defaultName = '') {
    const def = String(defaultName || 'Workspace').trim() || 'Workspace';
    try {
      const { createInput } = await import('../ui/components/UiField.js');
      const { openUiDialog } = await import('../ui/components/UiDialog.js');
      return await new Promise((resolve) => {
        const field = createInput({
          id: 'gpt-ws-name-input',
          label: 'Project name',
          value: def,
          placeholder: 'Workspace'
        });
        openUiDialog({
          title: 'Name workspace',
          body: field.root,
          confirmText: 'Add',
          cancelText: 'Cancel',
          onConfirm: () => resolve(field.getValue().trim() || def),
          onCancel: () => resolve(def)
        });
      });
    } catch (_) {
      try {
        const name = window.prompt('Project name', def);
        if (name == null) return def;
        return String(name).trim() || def;
      } catch (__) {
        return def;
      }
    }
  }

  static async addViaPicker(conversationId, app = null) {
    await new Promise(r => setTimeout(r, 50));
    const folder = await ProjectWorkspace.pickFolder();
    if (!folder) return null;
    let id = conversationId;
    if (app) {
      try { id = ProjectWorkspace.activeChatId(app); } catch (_) {}
    }
    const name = await ProjectWorkspace.promptName(folder.name || 'Workspace');
    const list = ProjectWorkspace.add(id, { name, url: folder.url });
    const row = list.find(w => normalizeUrl(w.url) === normalizeUrl(folder.url)) || null;
    if (row && typeof window.toast === 'function') {
      window.toast(`Workspace added: ${row.name}`, 2200);
    }
    return row;
  }
}