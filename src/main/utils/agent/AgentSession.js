// src/main/utils/agent/AgentSession.js

/**
 * AgentSession — durable per-chat working context (cwd + goal).
 * Modern agents (Claude Code / Cursor) inject dynamic state, not a giant static prompt.
 *
 * Storage key: agent_session_<conversationId>
 * Fields: { workingDir, projectName, projectUri, goal, lastFiles[], updatedAt }
 */

const KEY_PREFIX = 'agent_session_';

function storageKey(conversationId) {
  const id = conversationId != null ? String(conversationId) : 'default';
  return KEY_PREFIX + id;
}

function now() {
  return Date.now();
}

export class AgentSession {
  static load(conversationId) {
    try {
      const raw = localStorage.getItem(storageKey(conversationId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  static save(conversationId, patch) {
    const prev = AgentSession.load(conversationId) || {};
    const next = {
      workingDir: prev.workingDir || '',
      projectName: prev.projectName || '',
      projectUri: prev.projectUri || '',
      goal: prev.goal || '',
      lastFiles: Array.isArray(prev.lastFiles) ? prev.lastFiles : [],
      updatedAt: now(),
      ...prev,
      ...patch,
      updatedAt: now()
    };
    // normalize workingDir
    if (next.workingDir) {
      next.workingDir = String(next.workingDir).replace(/^\/+/, '').replace(/\/+$/, '');
    }
    if (Array.isArray(next.lastFiles) && next.lastFiles.length > 12) {
      next.lastFiles = next.lastFiles.slice(-12);
    }
    try {
      localStorage.setItem(storageKey(conversationId), JSON.stringify(next));
    } catch (_) {}
    return next;
  }

  static clear(conversationId) {
    try {
      localStorage.removeItem(storageKey(conversationId));
    } catch (_) {}
  }


  /**
   * content://...::primary:Ay/game5 → /sdcard/Ay/game5
   * Never drop the parent folder (Ay).
   */
  static contentUrlToShellPath(pathOrUrl) {
    if (!pathOrUrl) return '';
    let s = String(pathOrUrl);
    if (s.startsWith('/sdcard/') || s.startsWith('/storage/emulated/0/')) {
      return s.replace(/\/+$/, '');
    }
    const idx = s.lastIndexOf('::');
    if (idx !== -1) s = s.slice(idx + 2);
    s = s.replace(/^primary:/i, '').replace(/^\/+/, '');
    // drop filename if present
    if (/\.[a-zA-Z0-9]{1,12}$/.test(s) && s.includes('/')) {
      s = s.replace(/\/[^/]+$/, '');
    }
    s = s.replace(/^\/+|\/+$/g, '');
    if (!s) return '';
    return '/sdcard/' + s;
  }

  /** Relative path under sdcard, e.g. Ay/game5 */
  static contentUrlToRelPath(pathOrUrl) {
    const shell = AgentSession.contentUrlToShellPath(pathOrUrl);
    return shell.replace(/^\/sdcard\//, '').replace(/^\/storage\/emulated\/0\//, '');
  }

  /** Extract folder hint from a path/url like .../Ay/chess/index.html → chess */
  static pathToWorkingDir(pathOrUrl, projectName) {
    if (!pathOrUrl) return '';
    let s = String(pathOrUrl);
    // content://...::primary:Ay/chess/index.html or ::/Ay/chess
    const idx = s.lastIndexOf('::');
    if (idx !== -1) s = s.slice(idx + 2);
    s = s.replace(/^primary:/i, '').replace(/^\/+/, '');
    if (projectName && s.startsWith(projectName + '/')) {
      s = s.slice(projectName.length + 1);
    }
    s = s.replace(/^\/sdcard\/[^/]+\//, '');
    // drop filename
    if (/\.[a-zA-Z0-9]{1,12}$/.test(s)) {
      s = s.replace(/\/[^/]+$/, '');
    }
    return s.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Update session from a successful tool result (create_file_tree, create_or_update_file, etc.)
   */
  static noteWrite(conversationId, { path, projectName, projectUri, fileNames }) {
    const wd = AgentSession.pathToWorkingDir(path, projectName);
    const patch = {};
    if (projectName) patch.projectName = projectName;
    if (projectUri) patch.projectUri = projectUri;
    if (wd) patch.workingDir = wd;
    if (fileNames && fileNames.length) {
      const prev = AgentSession.load(conversationId);
      const last = (prev && prev.lastFiles) || [];
      patch.lastFiles = [...last, ...fileNames].slice(-12);
    }
    return AgentSession.save(conversationId, patch);
  }

  /** Infer a short goal from the user message & implement Task Boundary logic */
  static noteGoalFromMessage(conversationId, userMessage) {
    const text = String(userMessage || '').trim();
    if (!text) return AgentSession.load(conversationId);
    
    const prev = AgentSession.load(conversationId);
    if (!prev) return AgentSession.save(conversationId, { goal: text.slice(0, 240) });

    const lowText = text.toLowerCase();

    // 🟢 SMART TASK BOUNDARY DETECTION (Topical Overlap)
    // Identify if the user is continuing the previous task or starting a completely new one.
    
    const followUpKeywords = /^(fix|update|change|add|remove|delete|it|this|still|not working|broken|error|bug|issue|continue|next|more|why|how|what)\b/i;
    const isFollowUp = followUpKeywords.test(lowText) || text.length < 15;

    // Collect all previous context words (goal, project name, recently edited files)
    const prevContextWords = [
        prev.goal || '',
        prev.projectName || '',
        prev.workingDir || '',
        ...(prev.lastFiles || [])
    ].join(' ').toLowerCase();

    // Extract meaningful words (>3 chars) from the new user request
    const currentWords = lowText.match(/\b[a-z0-9_]{4,}\b/g) || [];
    const hasOverlap = currentWords.some(w => prevContextWords.includes(w));

    // If it's a brand new request with NO keyword overlap and NO follow-up phrasing, reset task context!
    if (!isFollowUp && !hasOverlap && currentWords.length > 0) {
        console.log('[AgentSession] Context shift detected! Clearing stale goal & lastFiles.');
        return AgentSession.save(conversationId, { 
            goal: text.slice(0, 240),
            lastFiles: [] // Flush old files to stop Context Pollution
        });
    }

    // Otherwise, it's related. Don't overwrite a richer goal with a short follow-up
    if (text.length >= 15 && !/^(fix it|still broken|not working)$/i.test(lowText)) {
        return AgentSession.save(conversationId, { goal: text.slice(0, 240) });
    }
    
    return prev;
  }

  /**
   * Dynamic block injected into context (variable system layer).
   */
  static toPromptBlock(conversationId) {
    const s = AgentSession.load(conversationId);
    if (!s || (!s.workingDir && !s.goal && !s.projectName)) {
      return `[Agent Session]
No working directory saved yet.
On first write, system will remember the folder (e.g. chess/).
If the user says improve/advanced/fix — list and edit the EXISTING folder; do NOT create a new parallel project.`;
    }
    const lines = ['[Agent Session — active context]'];
    if (s.projectName) lines.push(`Project: ${s.projectName}`);
    
    let hasDir = false;
    if (s.workingDir || s.shellPath || s.projectUri) {
      const rel = s.workingDir || AgentSession.contentUrlToRelPath(s.projectUri) || '';
      const shell = s.shellPath || AgentSession.contentUrlToShellPath(s.projectUri) || (rel ? `/sdcard/${rel}` : '');
      
      if (rel) {
          lines.push(`Working dir: ${rel}/  (edit files HERE)`);
          hasDir = true;
      }
      if (shell) {
        lines.push(`Shell path: ${shell}`);
        lines.push(`ALWAYS use this shell path (e.g. ${shell}/index.html). NEVER invent /sdcard/<name> without parent folders.`);
      }
      if (s.projectUri) lines.push(`Content URL: ${s.projectUri}`);
    }
    
    if (s.goal) lines.push(`Session goal: ${s.goal}`);
    
    if (s.lastFiles && s.lastFiles.length > 0) {
        // Remove duplicates and show only the last 6 edited files
        const uniqueFiles = [...new Set(s.lastFiles)].slice(-6);
        lines.push(`Recent files: ${uniqueFiles.join(', ')}`);
    }
    
    lines.push('Rules: Prefer list_directory + str_replace / edit_file_lines / write tools under Working dir.');
    if (hasDir) {
        lines.push('Do NOT mkdir a new top-level project folder if Working dir already exists, unless explicitly requested.');
    }
    
    return lines.join('\n');
  }
}