// src/main/agent/tools/AcodeFSAgent.js
//
// OpenCode / Claude Code style project tools + Project Memory (project_memory.md)
// Includes Stateful Read-Before-Edit Tracker & Strict Anti-Overwrite Guard.

import { ConfigManager } from '../../utils/ConfigManager.js';
import { detectLang, buildStructureOutline, formatOutlineText, tryTreeSitterOutline } from './StructureOutline.js';
import {
  getProjectFolder, createFolder, createFile, createNodes, isExists,
  readFile, listDir, deleteItem, renameItem, copyFile, moveItem,
  normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';

const TAG = '[AcodeFSAgent]';
const fs = acode.require('fs');
/** Modern AI layout: memory lives under project/.aicodex/ — not project root */
const MEMORY_DIR = '.aicodex';
const MEMORY_FILENAME = 'project_memory.md';
const MEMORY_REL = `${MEMORY_DIR}/${MEMORY_FILENAME}`;

// Tracks normalized file URLs read in the current agent session/turn
const _readFilesInTurn = new Set();
/** Paths outlined this agent turn — follow-up reads capped to OUTLINE_FOLLOW_READ_MAX lines */
const _outlinedPathsThisTurn = new Set();
const OUTLINE_FOLLOW_READ_MAX = 80;
/** Wrong/relative path key → resolved content:// URL (survives whole agent run) */
const _pathAlias = new Map();
let _aliasProjectKey = '';
const UNSAFE_BASENAME_ALIAS = new Set([
  'index.html', 'index.htm', 'style.css', 'styles.css', 'main.css', 'app.css',
  'script.js', 'main.js', 'app.js', 'package.json', 'readme.md', 'project_memory.md',
  'game.js', 'index.js', 'main.ts', 'app.ts',
  // Never basename-alias placeholders / config — css/.gitkeep ≠ js/.gitkeep
  '.gitkeep', 'gitkeep', '.gitignore', 'gitignore', '.env', 'env',
  'config.js', 'config.ts', 'config.json', 'todo.md', 'plan.md'
]);

function pathKey(p) {
  return String(p || '').trim().toLowerCase().replace(/\\/g, '/');
}

export class AcodeFSAgent {

  static resetTurnReadTracker() {
    _readFilesInTurn.clear();
    _outlinedPathsThisTurn.clear();
    // Clear aliases each agent run — prevents Test4 hijacking Test5/index.html
    _pathAlias.clear();
    _aliasProjectKey = '';
  }

  static clearPathAliases() {
    _pathAlias.clear();
    _aliasProjectKey = '';
  }

  static async _ensureAliasProjectScope() {
    try {
      const project = await getProjectFolder();
      const key = projectKeyFromUri(project?.uri);
      if (key && _aliasProjectKey && key !== _aliasProjectKey) {
        console.log(TAG, 'project changed — clearing path aliases');
        _pathAlias.clear();
      }
      if (key) _aliasProjectKey = key;
      return project;
    } catch (_) {
      return null;
    }
  }

  static _aliasBelongsToProject(aliasUrl, projectUri) {
    if (!aliasUrl || !projectUri) return false;
    const a = normalizeSafUrl(String(aliasUrl)).toLowerCase();
    const p = normalizeSafUrl(String(projectUri)).toLowerCase().replace(/\/$/, '');
    return a === p || a.startsWith(p + '/') || a.includes(p);
  }

  static markFileRead(url) {
    if (!url) return;
    _readFilesInTurn.add(normalizeSafUrl(String(url)));
  }

  static hasReadFile(url) {
    if (!url) return false;
    const n = normalizeSafUrl(String(url));
    if (_readFilesInTurn.has(n)) return true;
    // Alias: model may pass Chess/js/x after we read Chess/Chess/js/x
    const alias = _pathAlias.get(pathKey(url));
    if (alias && _readFilesInTurn.has(normalizeSafUrl(alias))) return true;
    const base = String(url).split('/').filter(Boolean).pop() || '';
    if (base && !UNSAFE_BASENAME_ALIAS.has(base.toLowerCase())) {
      const a2 = _pathAlias.get(pathKey(base));
      if (a2 && _readFilesInTurn.has(normalizeSafUrl(a2))) return true;
    }
    return false;
  }

  /** Remember that requestedPath actually lives at realUrl */
  static rememberPathAlias(requestedPath, realUrl) {
    if (!requestedPath || !realUrl) return;
    const real = normalizeSafUrl(String(realUrl));
    _pathAlias.set(pathKey(requestedPath), real);
    const parts = String(requestedPath).replace(/\\/g, '/').split('/').filter(Boolean);
    const base = parts.length ? parts[parts.length - 1] : '';
    const baseLower = base.toLowerCase();
    // Never map index.html globally across sibling folders (Test4 vs Test5)
    if (base && !UNSAFE_BASENAME_ALIAS.has(baseLower)) {
      _pathAlias.set(pathKey(base), real);
    }
    if (parts.length >= 2 && !UNSAFE_BASENAME_ALIAS.has(baseLower)) {
      _pathAlias.set(pathKey(parts.slice(-2).join('/')), real);
    }
  }

  /**
   * Resolve a path to an existing file URL (alias → direct → basename search).
   * Used by read AND str_replace/write so nested folders work once discovered.
   */
  static async resolveExistingFileUrl(rawPath) {
    if (!rawPath) return null;
    const raw = String(rawPath).trim();
    let project = await this._ensureAliasProjectScope();
    const projectUri = project?.uri || '';

    // 1) Cached alias — only if under current project (blocks Test4 when in Test5)
    const baseOnly = raw.split('/').filter(Boolean).pop() || '';
    const cached =
      _pathAlias.get(pathKey(raw)) ||
      (!UNSAFE_BASENAME_ALIAS.has(baseOnly.toLowerCase())
        ? _pathAlias.get(pathKey(baseOnly))
        : null);
    if (cached && this._aliasBelongsToProject(cached, projectUri)) {
      try {
        const r = await readFile(cached, 'utf-8');
        if (r?.success) return cached;
      } catch (_) {}
    } else if (cached) {
      console.log(TAG, 'ignore out-of-project alias', String(cached).slice(-50));
      _pathAlias.delete(pathKey(raw));
      if (baseOnly) _pathAlias.delete(pathKey(baseOnly));
    }

    // 2) Normal resolve
    let resolved = await this._resolveProjectPath(raw);
    try {
      const r = await readFile(resolved, 'utf-8');
      if (r?.success) {
        this.rememberPathAlias(raw, resolved);
        return normalizeSafUrl(resolved);
      }
    } catch (_) {}

    // 3) Basename + relative suffix search in project tree
    if (!project?.uri) {
      try { project = await getProjectFolder(); } catch (_) {}
    }
    if (!project?.uri) return resolved;

    const base = raw.split('/').pop();
    const relSuffix = raw.replace(/^content:\/\/[^\s]+/, '').replace(/^\/+/, '');
    const candidates = [];
    if (project.name && base) {
      candidates.push(joinSafPath(project.uri, `${project.name}/${relSuffix}`));
      candidates.push(joinSafPath(project.uri, `${project.name}/${base}`));
    }
    try {
      const found = await this._findFileByName(base, 12);
      for (const rel of found) {
        // Prefer paths that end with the relative path the model asked for
        candidates.push(joinSafPath(project.uri, rel));
      }
      // Sort: better match if rel ends with Chess/js/chess-board.js style
      candidates.sort((a, b) => {
        const as = String(a);
        const bs = String(b);
        const score = (u) => {
          let s = 0;
          if (relSuffix && u.toLowerCase().includes(relSuffix.toLowerCase())) s += 10;
          if (base && u.toLowerCase().endsWith(base.toLowerCase())) s += 3;
          return -s;
        };
        return score(as) - score(bs);
      });
    } catch (_) {}

    for (const c of candidates) {
      if (!c) continue;
      try {
        const r = await readFile(c, 'utf-8');
        if (r?.success) {
          this.rememberPathAlias(raw, c);
          console.log(TAG, `resolveExistingFileUrl: "${raw}" → ${c}`);
          return normalizeSafUrl(c);
        }
      } catch (_) {}
    }
    return resolved;
  }

  static getToolsSchema() {
    const MAX_LINE = ConfigManager.get('agentMaxReadLines') !== null ? parseInt(ConfigManager.get('agentMaxReadLines')) : 500;
    const pathNote = "Full project URI (content://...) or relative path under project root (e.g. 'js/app.js').";

    return [
      {
        name: "answer_informational_query",
        description: "Call this tool ONLY to respond to greetings, general questions, or read-only requests (like explaining code or listing files) WHERE NO CODE MODIFICATION IS NEEDED.",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "Your detailed chat response or explanation to the user." }
          },
          required: ["message"]
        }
      },
      {
        name: "read",
        description: `Read a file with 1-based line numbers (up to ${MAX_LINE} lines per call). MANDATORY before str_replace/edit_file_lines. For large files: call outline first, then read only needed ranges — do not sequential-scan the whole file.`,
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: pathNote },
            start_line: { type: "NUMBER", description: "Optional first line (1-based, default 1)" },
            end_line: { type: "NUMBER", description: "Optional last line (inclusive)" }
          },
          required: ["path"]
        }
      },
      {
        name: "str_replace",
        description: "Primary tool to edit/patch an EXISTING file. Replaces one exact block of lines with a new block. RULES: 1) You MUST 'read' the file first in this turn. 2) Prefer an exact copy of existing lines (no line-number prefixes; 3-10 lines of context). Whitespace/indent mismatches are tolerated (fuzzy match). 3) Never use '...' placeholders.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: pathNote },
            search: { type: "STRING", description: "Exact existing code snippet to find (no line numbers, no '...')." },
            replace: { type: "STRING", description: "New code snippet to replace it with." }
          },
          required: ["path", "search", "replace"]
        }
      },
      {
        name: "edit_file_lines",
        description: "Replace a contiguous range of lines [start_line .. end_line] (inclusive, 1-based from 'read' output) in an existing file. Use this when 'str_replace' fails due to whitespace/indentation differences.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: pathNote },
            start_line: { type: "NUMBER", description: "First line number to replace (1-based, inclusive)" },
            end_line: { type: "NUMBER", description: "Last line number to replace (1-based, inclusive)" },
            new_content: { type: "STRING", description: "Replacement code for lines start_line..end_line (use \"\" to delete those lines)" },
            lines: {
              type: "ARRAY",
              description: "Optional legacy array of {line, start_line, end_line, text} edits.",
              items: {
                type: "OBJECT",
                properties: {
                  line: { type: "NUMBER" },
                  start_line: { type: "NUMBER" },
                  end_line: { type: "NUMBER" },
                  text: { type: "STRING" }
                }
              }
            }
          },
          required: ["path"]
        }
      },
      {
        name: "write",
        description: "Create a brand NEW file ONLY. STRICT RULE: Never use 'write' on existing files — existing files are protected from full overwrite. Use 'str_replace' or 'edit_file_lines' for existing files.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: pathNote },
            content: { type: "STRING", description: "Complete content for the brand new file" }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "update_project_memory",
        description: "Create or update '.aicodex/project_memory.md' (project agent memory dir) to record project architecture, file map/responsibilities, key state/functions, and recent changes. Call this after creating a project or making structural changes/fixes so future turns remember the codebase.",
        parameters: {
          type: "OBJECT",
          properties: {
            content: {
              type: "STRING",
              description: "Structured Markdown for project_memory.md (# Project Overview, ## File Map, ## Key Functions & State, ## Recent Changes)"
            }
          },
          required: ["content"]
        }
      },
      {
        name: "list_directory",
        description: "List files and folders in a directory natively.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "Folder path/URI (or '.' for project root)" }
          },
          required: ["path"]
        }
      },
      {
        name: "glob",
        description: "Find files by name pattern (e.g. '*.js', '*.css', '*.html') across the project.",
        parameters: {
          type: "OBJECT",
          properties: {
            pattern: { type: "STRING", description: "Filename pattern, e.g. '*.js'" },
            path: { type: "STRING", description: "Optional subfolder scope" }
          },
          required: ["pattern"]
        }
      },
      {
        name: "grep",
        description: "Search file contents for a keyword, selector, or regex. Prefer grep BEFORE reading large files. Returns path:line + optional context.",
        parameters: {
          type: "OBJECT",
          properties: {
            pattern: { type: "STRING", description: "Search string or regex pattern (alias: query)" },
            query: { type: "STRING", description: "Alias for pattern — some models send query instead" },
            path: { type: "STRING", description: "Optional file or subfolder scope" },
            context_lines: { type: "NUMBER", description: "Lines of context before/after each hit (0-3, default 1)" },
            max_matches: { type: "NUMBER", description: "Max hits to return (default 40, hard cap 80)" }
          },
          required: ["pattern"]
        }
      },
      {
        name: "outline",
        description: "Structure map with start–end line ranges (HTML ids/classes/sections, CSS selectors, JS/TS functions/classes/methods, Python, Java/Kotlin). Prefer this BEFORE full read on large files, then read(path, start_line, end_line) only for the symbol range you will edit.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "File path/URI under project" },
            kind: { type: "STRING", description: "Optional filter: function|class|method|id|selector|tag|block|heading" },
            query: { type: "STRING", description: "Optional name substring filter (e.g. render, #app, .header)" }
          },
          required: ["path"]
        }
      },
      {
        name: "delete_item",
        description: "Delete a file or directory. ONLY use when the user explicitly asks to delete or remove a file/folder.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: pathNote }
          },
          required: ["path"]
        }
      },
      {
        name: "run_command",
        description: "Run ONE shell command (e.g. npm/node build or test). Do NOT use for ls, find, cat, grep, or writing files.",
        parameters: {
          type: "OBJECT",
          properties: {
            command: { type: "STRING", description: "Short shell command" }
          },
          required: ["command"]
        }
      }
    ];
  }

  /** Resolve relative paths against active workspace or project root */
  /**
   * Turn model-supplied paths into project-relative paths.
   * Prevents: project/data/data/com.termux/.../project/file.md nesting.
   */
  static _sanitizeRelativePath(raw, projectName) {
    let p = String(raw || '').trim().replace(/\\/g, '/');
    if (!p || p === '.' || p === './') return '';

    // content:// → keep only trailing relative-looking segment if possible
    if (p.startsWith('content://')) {
      const marker = '::';
      const i = p.indexOf(marker);
      if (i !== -1) p = p.slice(i + marker.length);
      else return p; // pure content url handled by caller
    }

    // Decode common encodings
    try { p = decodeURIComponent(p); } catch (_) {}

    // Absolute Termux / Android paths → strip to under last project-name occurrence
    const absHints = ['/data/data/', '/storage/emulated/', '/sdcard/', 'com.termux/files'];
    const looksAbs = p.startsWith('/') || absHints.some(h => p.includes(h));
    if (looksAbs && projectName) {
      const lower = p.toLowerCase();
      const pn = projectName.toLowerCase();
      let idx = lower.lastIndexOf('/' + pn + '/');
      if (idx === -1) idx = lower.lastIndexOf(pn + '/');
      if (idx !== -1) {
        const after = p.slice(idx);
        const cut = after.toLowerCase().indexOf(pn) + projectName.length;
        p = after.slice(cut).replace(/^\/+/, '');
      } else {
        // fall back to basename only (safer than nesting full abs path)
        p = p.split('/').filter(Boolean).pop() || p;
      }
    }

    // Strip duplicated "./projectName/" prefix
    if (projectName) {
      const pn = projectName.replace(/\/$/, '');
      const re = new RegExp('^\\.?/?(?:' + pn.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '/)+', 'i');
      p = p.replace(re, '');
    }

    // Still contains abs junk → basename
    if (p.includes('/data/data/') || p.includes('com.termux/files')) {
      p = p.split('/').filter(Boolean).pop() || 'file.txt';
    }

    // "aicodex/..." → ".aicodex/..." (model often drops the dot)
    p = p.replace(/(^|\/)aicodex(?=\/|$)/gi, '$1.aicodex');
    p = p.replace(/\/\.aicodex\/\.aicodex\//gi, '/.aicodex/');

    // Normalize ".aicodex (1)/..." → ".aicodex/..." (duplicate folder bug)
    p = p.replace(/\.aicodex\s*\(\d+\)/gi, '.aicodex');
    p = p.replace(/\.aicodex%20\(\d+\)/gi, '.aicodex');
    p = p.replace(/\.aicodex\+/g, '.aicodex'); // defensive

    // Collapse accidental repeated segments: foo/foo/bar → foo/bar (once)
    const segs = p.split('/').filter(Boolean);
    const collapsed = [];
    for (const s of segs) {
      if (collapsed.length && collapsed[collapsed.length - 1].toLowerCase() === s.toLowerCase()) continue;
      collapsed.push(s);
    }
    p = collapsed.join('/');

    // Drop leading projectName or Parent/projectName (GameTest/gametest/css → css)
    if (projectName) {
      const pn = projectName.toLowerCase();
      let parts = p.split('/').filter(Boolean);
      while (parts.length && parts[0].toLowerCase() === pn) parts.shift();
      if (parts.length >= 2 && parts[1].toLowerCase() === pn) {
        // ParentFolder/projectName/rest
        parts = parts.slice(2);
      }
      while (parts.length && parts[0].toLowerCase() === pn) parts.shift();
      p = parts.join('/');
    }

    return p.replace(/^\/+/, '').replace(/^\.\//, '');
  }

  static async _resolveProjectPath(rawPath) {
    if (!rawPath) return rawPath;
    let p = String(rawPath).trim();
    const project = await getProjectFolder();
    const projUri = project?.uri ? normalizeSafUrl(project.uri) : null;

    if (p === '.' || p === './' || p === '') {
      return projUri || p;
    }

    // content:// SAF urls — never run through relative sanitize (that creates Test/Test)
    if (p.startsWith('content://')) {
      const norm = normalizeSafUrl(p);
      if (projUri) {
        const a = norm.replace(/\/$/, '');
        const b = projUri.replace(/\/$/, '');
        if (a === b) return projUri; // exact project root
        // Same document tree: use as-is (full file URI)
        if (norm.includes('::') || a.startsWith(b)) return norm;
      }
      return norm;
    }

    if (projUri) {
      const rel = this._sanitizeRelativePath(p, project.name || '');
      if (!rel) return projUri;

      // Bare project name only → project root directory (not project/project)
      if (project.name && rel.toLowerCase() === String(project.name).toLowerCase()) {
        return projUri;
      }

      // /sdcard/... style
      const norm = rel.replace(/^\/storage\/emulated\/0\//, '/sdcard/');
      if (norm.startsWith('/sdcard/')) {
        const parts = norm.replace(/^\/sdcard\//, '').split('/').filter(Boolean);
        const idx = project.name ? parts.findIndex(seg => seg.toLowerCase() === project.name.toLowerCase()) : -1;
        if (idx !== -1) {
          const rest = parts.slice(idx + 1).join('/');
          return rest ? joinSafPath(projUri, rest) : projUri;
        }
      }

      console.log(TAG, `_resolveProjectPath: "${String(rawPath).slice(-80)}" → rel "${rel}"`);
      return joinSafPath(projUri, rel);
    }
    return normalizeSafUrl(p);
  }

  static async executeTool(functionCall) {
    let { name, args = {} } = functionCall || {};
    console.log(TAG, 'executeTool ->', name, args);
    try {
      if (args && args._parseError) {
        return {
          success: false,
          error: 'Tool arguments were truncated due to token limit (JSON parse failed). Please make smaller, targeted edits using str_replace.',
          created: 0
        };
      }

      // Capture path BEFORE resolve — "." becomes project URI later
      const originalPathArg = args.path != null ? String(args.path).trim() : '';

      // Per-chat Workspace resolution & lock
      try {
        const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
        let chatId = 'default';
        const idx = ConfigManager.get('current_chat_index', null);
        if (idx != null && idx !== '') chatId = idx;

        if (ProjectWorkspace.hasAny(chatId)) {
          const pathKeys = ['path', 'sourcePath', 'destinationFolderPath', 'parentPath'];
          for (const k of pathKeys) {
            if (args[k] && typeof ProjectWorkspace.resolveToWorkspace === 'function') {
              args[k] = ProjectWorkspace.resolveToWorkspace(chatId, args[k]);
            }
          }
          for (const k of pathKeys) {
            if (args[k] && !ProjectWorkspace.isPathAllowed(chatId, args[k])) {
              return {
                error: `Path blocked: outside selected project workspace(s) for this chat. Allowed: ${ProjectWorkspace.list(chatId).map(w => w.name).join(', ')}`,
                blocked: true
              };
            }
          }
        } else {
          // Even without workspace lock, auto-resolve relative paths against open project root
          const pathKeys = ['path', 'sourcePath', 'destinationFolderPath', 'parentPath'];
          for (const k of pathKeys) {
            if (args[k]) args[k] = await this._resolveProjectPath(args[k]);
          }
        }
      } catch (_) {}

      // Nested-folder fix for READ/EDIT only.
      // Never remap write/create paths — same basename in different folders (css/.gitkeep vs js/.gitkeep)
      // must not collapse onto the first existing file.
      try {
        const editTools = new Set([
          'read', 'read_file', 'str_replace', 'search_replace_edit', 'edit_file_lines'
        ]);
        if (editTools.has(name) && args.path) {
          const originalPath = args.path;
          const existing = await this.resolveExistingFileUrl(args.path);
          if (existing) {
            args.path = existing;
            if (existing !== originalPath) {
              console.log(TAG, `${name} path alias: ${String(originalPath).slice(-60)} → ${String(existing).slice(-60)}`);
            }
          }
        }
      } catch (e) {
        console.warn(TAG, 'resolveExistingFileUrl', e);
      }

      let result;
      switch (name) {
        case 'answer_informational_query':
          result = { success: true, message: "Response delivered to user." };
          break;
        case 'read':
        case 'read_file': {
          const op = originalPathArg;
          if (op === '.' || op === './' || op === '' || op === '/') {
            result = {
              error: `Path is a directory, not a file: "${op || '.'}". Use list_directory or glob instead of read.`
            };
            break;
          }
          result = await this._readFile(args.path, args.start_line, args.end_line);
          break;
        }
        case 'write':
        case 'create_or_update_file':
          result = await this._createOrUpdateFile(args.path, args.content, !!args._allowOverwrite);
          break;
        case 'update_project_memory':
          result = await this._updateProjectMemory(args.content);
          break;
        case 'str_replace': {
          const edits = Array.isArray(args.edits)
            ? args.edits
            : (args.search != null ? [{ search: args.search, replace: args.replace ?? '' }] : null);
          if (!edits) {
            const gotKeys = Object.keys(args || {}).filter(k => !['path', '_dryRun'].includes(k));
            result = {
              error: `Invalid arguments for str_replace (got: {${gotKeys.join(', ')}}). Required: {"path": "...", "search": "<exact lines>", "replace": "<new lines>"}.`
            };
            break;
          }
          result = await this._searchReplaceEdit(args.path, edits, !!args._dryRun);
          break;
        }
        case 'search_replace_edit':
          result = await this._searchReplaceEdit(args.path, args.edits, !!args._dryRun);
          break;
        case 'edit_file_lines':
          result = await this._editFileLines(args, !!args._dryRun);
          break;
        case 'glob':
          result = await this._glob(args.pattern, args.path);
          break;
        case 'grep': {
          const gPattern = args.pattern || args.query || args.search || args.q || args.needle || args.text;
          if (!gPattern) {
            result = { error: "Missing 'pattern' argument. Use pattern (or query) with the search string." };
          } else {
            result = await this._grep(gPattern, args.path, args);
          }
          try {
            const n = Array.isArray(result?.matches) ? result.matches.length
              : (result?.matchCount != null ? result.matchCount : 0);
            const sample = (result?.matches || []).slice(0, 5).map(h =>
              typeof h === 'string' ? h : (h.line != null ? `${h.file || ''}:${h.line}: ${h.text || h.content || ''}` : JSON.stringify(h).slice(0, 120))
            );
            console.log(TAG, `grep result → pattern="${gPattern || args.pattern}" path="${args.path || '.'}" matches=${n} via=${result?.via || 'n/a'}`,
              sample.length ? sample : (result?.error || result?.output || '(none)'));
          } catch (_) {}
          break;
        }
        case 'outline':
          result = await this._outline(args.path, args);
          break;
        case 'run_command':
        case 'run_shell_command':
          result = await this._runCommand(args.command);
          break;
        case 'list_directory':
          result = await this._listDirectory(args.path);
          break;
        case 'create_folder':
          result = await this._createFolder(args.path);
          break;
        case 'create_file_tree':
          result = await createNodes(args.path, args.nodes || []);
          break;
        case 'check_exists':
          result = await isExists(args.parentPath, args.name);
          break;
        case 'delete_item': {
          const allowDlt = ConfigManager.get('agentAllowDelete');
          const isDeleteAllowed = allowDlt === null ? true : (allowDlt === true || allowDlt === 'true');
          if (!isDeleteAllowed) {
            result = { error: "Security Restriction: File deletion is disabled in Agent Settings." };
          } else {
            result = await deleteItem(args.path);
          }
          break;
        }
        case 'rename_item':
          result = await renameItem(args.path, args.newName);
          break;
        case 'move_item':
          result = await moveItem(args.sourcePath, args.destinationFolderPath);
          break;
        case 'copy_file':
          result = await copyFile(args.sourcePath, args.destinationFolderPath, args.desiredName);
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }
      return result;
    } catch (e) {
      console.error(TAG, 'executeTool threw for', name, e);
      return { error: e.message || String(e) };
    }
  }

  /**
   * Builds rich OpenCode-style project context:
   * 1. Active Project Root URI
   * 2. Top-level File Tree (up to depth 2) so AI never hallucinates filenames
   * 3. Auto-loaded `project_memory.md` (if present in project root)
   * 4. Active file & tabs (only when allowed by options)
   */
  static async getProjectContextBlock(options = {}) {
    try {
      const {
        chatId = null,
        skipAcodeProject = false,
        includeActiveFile = true,
        includeOpenTabs = true
      } = options || {};

      const project = await getProjectFolder({ chatId, skipAcodeProject });
      let contextStr = "";

      if (!project || !project.uri) {
        contextStr = "[Current Project Folder]\nNONE open. Ask the user to select a workspace or open a project folder.\n";
      } else {
        const uri = normalizeSafUrl(String(project.uri));
        const shellOk = !/com\.termux\.documents|com\.foxdebug\.acode/i.test(uri);
        contextStr = `[Current Project Folder]\nName: ${project.name}\nRoot URI: ${uri}\n`;
        if (shellOk) {
          contextStr += `Shell Path: /sdcard/${project.name}\n`;
        }

        // Compact file tree (depth 4, max 120) — models MUST use these relative paths
        try {
          const treeAcc = [];
          await this._safWalkRelative(uri, '', 4, treeAcc, 120);
          if (treeAcc.length > 0) {
            const files = treeAcc.filter(i => !i.isDirectory);
            const dirs = treeAcc.filter(i => i.isDirectory);
            contextStr += `\n[Project File Tree (${treeAcc.length} items) — ALWAYS use these exact relative paths for read/str_replace/write]\n`;
            contextStr += dirs.slice(0, 40).map(item => `- ${item.relPath}/`).join('\n') + (dirs.length ? '\n' : '');
            contextStr += files.slice(0, 80).map(item => `- ${item.relPath}`).join('\n') + '\n';
            if (treeAcc.length >= 120) {
              contextStr += `(truncated — use glob/grep to find files deeper)\n`;
            }
            // Basename index helps nested layouts (Chess/Chess/js/x.js)
            const byBase = {};
            for (const f of files) {
              const b = f.relPath.split('/').pop();
              if (!b) continue;
              if (!byBase[b]) byBase[b] = [];
              if (byBase[b].length < 3) byBase[b].push(f.relPath);
            }
            const ambig = Object.entries(byBase).filter(([, v]) => v.length >= 1).slice(0, 40);
            if (ambig.length) {
              contextStr += `\n[File path index — basename → relative path(s)]\n`;
              for (const [b, paths] of ambig) {
                contextStr += `- ${b}: ${paths.join(' | ')}\n`;
              }
            }
          } else {
            contextStr += `\n[Project File Tree]\n(Empty project folder)\n`;
          }
        } catch (_) {}

        // Auto-load project_memory.md if it exists
        try {
          let memUrl = joinSafPath(uri, MEMORY_REL);
          let memRes = await readFile(memUrl, 'utf-8');
          if (!(memRes && memRes.success && memRes.content)) {
            // legacy root location
            memUrl = joinSafPath(uri, MEMORY_FILENAME);
            memRes = await readFile(memUrl, 'utf-8');
          }
          if (memRes && memRes.success && typeof memRes.content === 'string' && memRes.content.trim()) {
            const memText = memRes.content.trim().slice(0, 3500);
            contextStr += `\n[Project Memory (${MEMORY_FILENAME} — Persistent Architecture & Context)]\n${memText}\n`;
            this.markFileRead(memUrl);
          } else {
            contextStr += `\n[Project Memory]\nNo '${MEMORY_FILENAME}' found yet. After completing structural work or bug fixes, call 'update_project_memory' to keep a persistent map of this project.\n`;
          }
        } catch (_) {}
      }

      if (includeActiveFile || includeOpenTabs) {
        const em = window.editorManager;
        const activeFile = em?.activeFile;
        if (includeActiveFile && activeFile && activeFile.uri && !String(activeFile.uri).includes('com.foxdebug.acode')) {
          contextStr += `\n[Active Editor File]\nName: ${activeFile.name}\nURI: ${activeFile.uri}\n`;
        }
        if (includeOpenTabs && em?.files?.length) {
          const tabs = em.files
            .filter(f => f?.uri && !String(f.uri).includes('com.foxdebug.acode'))
            .slice(0, 12)
            .map(f => `- ${f.name}${f.isUnsaved ? ' (unsaved)' : ''}: ${f.uri}`)
            .join('\n');
          if (tabs) contextStr += `\n[Open Editor Tabs]\n${tabs}\n`;
        }
      }

      return contextStr;
    } catch (e) {
      console.error(TAG, 'getProjectContextBlock failed:', e);
      return "[Current Project Folder]\nCould not determine project folder.\n";
    }
  }

  static async _safWalkRelative(dirUrl, prefix, depth, acc, max) {
    if (depth < 0 || acc.length >= max) return;
    const listed = await listDir(dirUrl);
    if (!listed?.success || !Array.isArray(listed.entries)) return;
    for (const ent of listed.entries) {
      if (acc.length >= max) break;
      const name = ent.name || '';
      if (!name || name === '.git' || name === 'node_modules' || name === '.acode') continue;
      const url = ent.url || ent.uri || '';
      const isDir = !!(ent.isDirectory || ent.isFolder || ent.type === 'folder');
      const relPath = prefix ? `${prefix}/${name}` : name;
      acc.push({ name, relPath, url, isDirectory: isDir });
      if (isDir && url && depth > 1) {
        await this._safWalkRelative(url, relPath, depth - 1, acc, max);
      }
    }
  }

  static async _updateProjectMemory(content) {
    if (typeof content !== 'string' || !content.trim()) {
      return { error: "Missing or empty 'content' for project_memory.md." };
    }
    const project = await getProjectFolder();
    if (!project?.uri) {
      return { error: "No open project folder to save project_memory.md." };
    }
    const parentUrl = normalizeSafUrl(project.uri);
    // Ensure .aicodex/ exists — overwrite:true reuses existing dir (never ".aicodex (1)")
    let aicodexUrl = joinSafPath(parentUrl, MEMORY_DIR);
    try {
      const folderRes = await createFolder(parentUrl, MEMORY_DIR, { overwrite: true });
      if (folderRes?.success && folderRes.url) {
        aicodexUrl = normalizeSafUrl(folderRes.url);
      }
    } catch (_) {}
    const memUrl = joinSafPath(aicodexUrl, MEMORY_FILENAME);
    let oldContent = '';
    try {
      const existing = await readFile(memUrl, 'utf-8');
      if (existing?.success && typeof existing.content === 'string') oldContent = existing.content;
    } catch (_) {
      // migrate legacy root project_memory.md once
      try {
        const legacy = await readFile(joinSafPath(parentUrl, MEMORY_FILENAME), 'utf-8');
        if (legacy?.success && legacy.content) oldContent = legacy.content;
      } catch (_) {}
    }

    const res = await createFile(aicodexUrl, MEMORY_FILENAME, content.trim() + '\n', { overwrite: true });
    if (res && res.success) {
      this.markFileRead(memUrl);
      return {
        success: true,
        url: res.url || memUrl,
        path: MEMORY_REL,
        oldContent,
        newContent: content.trim() + '\n',
        message: `Updated ${MEMORY_REL} successfully.`
      };
    }
    return { error: res?.message || `Failed to write ${MEMORY_FILENAME}` };
  }

  /** Walk project for basename matches (nested folders like snake_game/snake_game/) */
  static async _findFileByName(fileName, maxHits = 8) {
    const project = await getProjectFolder();
    if (!project?.uri || !fileName) return [];
    const needle = String(fileName).toLowerCase();
    const acc = [];
    await this._safWalkRelative(normalizeSafUrl(project.uri), '', 4, acc, 200);
    return acc
      .filter(it => !it.isDirectory && String(it.relPath).split('/').pop().toLowerCase() === needle)
      .slice(0, maxHits)
      .map(it => it.relPath);
  }

  static async _tryReadCandidates(candidates) {
    const READ_MS = 15000;
    for (const c of candidates) {
      if (!c) continue;
      try {
        const r = await Promise.race([
          readFile(c, 'utf-8'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), READ_MS))
        ]);
        if (r?.success && typeof r.content === 'string') return { url: c, result: r };
      } catch (_) {}
    }
    return null;
  }

  static async _readFile(fileUrl, startLine, endLine) {
    if (!fileUrl) return { error: "Missing 'path' argument." };
    const rawPath = String(fileUrl).trim();
    const dirErr = (label) => ({
      error: `Path is a directory, not a file: "${label}". Use list_directory or glob instead of read.`
    });

    // Explicit relative roots
    if (rawPath === '.' || rawPath === './' || rawPath === '/' || rawPath === '') {
      return dirErr(rawPath || '.');
    }

    const resolvedUrl = await this._resolveProjectPath(fileUrl);
    const normResolved = normalizeSafUrl(String(resolvedUrl || ''));

    // After resolve, "." becomes project URI — still a directory
    try {
      const project = await getProjectFolder();
      if (project?.uri) {
        const proj = normalizeSafUrl(project.uri);
        if (normResolved === proj || normResolved === proj.replace(/\/$/, '') ||
            rawPath === project.name || rawPath === `./${project.name}`) {
          return dirErr(rawPath === project.name ? project.name : (rawPath || '.'));
        }
      }
    } catch (_) {}

    // Refuse directories (listDir succeeds with entries)
    try {
      const listed = await listDir(normResolved);
      if (listed?.success && Array.isArray(listed.entries) && listed.entries.length >= 0) {
        // listDir on a real file usually fails; success ⇒ treat as directory
        // Empty dir still counts as directory
        if (listed.entries.length > 0 || listed.isDirectory) {
          return {
            ...dirErr(rawPath),
            entries_sample: (listed.entries || []).slice(0, 8).map(e => e.name || e)
          };
        }
        // success + empty entries: still likely a dir
        return dirErr(rawPath);
      }
    } catch (_) {}

    // Timeout stalled reads (SAF can hang on Android)
    const READ_MS = 15000;
    const readWithTimeout = (url) => Promise.race([
      readFile(url, 'utf-8'),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`read timed out after ${READ_MS}ms`)), READ_MS))
    ]);

    let result;
    try {
      result = await readWithTimeout(resolvedUrl);
    } catch (e) {
      result = { success: false, error: e?.message || String(e) };
    }
    let usedUrl = resolvedUrl;
    let recoveredRel = null;

    // Path recovery: project root may be parent of nested app folder
    // e.g. open snake_game/ but files live in snake_game/snake_game/index.html
    if (!result || !result.success) {
      const pathName = String(fileUrl).split('/').filter(Boolean).pop() || '';
      const project = await getProjectFolder();
      // Basename is project folder name → user tried to read the directory
      if (project?.name && pathName && pathName.toLowerCase() === String(project.name).toLowerCase()) {
        return {
          error: `Path is a directory, not a file: "${pathName}". Use list_directory or glob instead of read.`
        };
      }
      const candidates = [];

      if (project?.uri && pathName && pathName.includes('.')) {
        // Only recover for file-like basenames (have extension)
        // 1) same-name nested folder: <project>/<projectName>/<file>
        if (project.name) {
          candidates.push(joinSafPath(project.uri, `${project.name}/${pathName}`));
        }
        // 2) basename search in tree (depth 4)
        try {
          const found = await this._findFileByName(pathName, 6);
          for (const rel of found) {
            candidates.push(joinSafPath(project.uri, rel));
          }
          // keep rel paths for error message
          if (found.length) recoveredRel = found;
        } catch (_) {}
      }

      const hit = await this._tryReadCandidates(candidates);
      if (hit) {
        result = hit.result;
        usedUrl = hit.url;
        console.log(TAG, `read path recovery: "${fileUrl}" → ${usedUrl}`);
      } else {
        const hintPaths = (recoveredRel && recoveredRel.length)
          ? recoveredRel.map(p => `'${p}'`).join(', ')
          : `'${pathName}', nested folder, or run list_directory / glob`;
        return {
          error: `File not found: ${fileUrl}. Tried project root and nested paths. Use one of: ${hintPaths}. Call list_directory on "." first if unsure.`,
          tried: candidates.slice(0, 5).map(String),
          suggestions: recoveredRel || []
        };
      }
    }

    // Mark file as read — BOTH requested + resolved URLs so str_replace unlocks
    this.markFileRead(usedUrl);
    this.markFileRead(resolvedUrl);
    this.markFileRead(fileUrl);
    this.rememberPathAlias(fileUrl, usedUrl);
    this.rememberPathAlias(resolvedUrl, usedUrl);

    const lines = result.content.split('\n');
    const MAX_LINE = ConfigManager.get('agentMaxReadLines') !== null ? parseInt(ConfigManager.get('agentMaxReadLines')) : 500;

    let s = Math.max(1, parseInt(startLine, 10) || 1);
    let e = Math.min(lines.length, parseInt(endLine, 10) || lines.length);

    if (e - s + 1 > MAX_LINE) {
      e = Math.min(lines.length, s + MAX_LINE - 1);
    }

    let outlineCapNote = '';
    try {
      const nUsed = normalizeSafUrl(String(usedUrl || resolvedUrl || ''));
      const nFile = normalizeSafUrl(String(fileUrl || ''));
      const relKey = String(usedUrl || '').split('/').filter(Boolean).slice(-3).join('/').toLowerCase();
      const wasOutlined = _outlinedPathsThisTurn.has(nUsed)
        || _outlinedPathsThisTurn.has(nFile)
        || (relKey && _outlinedPathsThisTurn.has(relKey));
      if (wasOutlined && (e - s + 1) > OUTLINE_FOLLOW_READ_MAX) {
        const oldSpan = e - s + 1;
        e = Math.min(lines.length, s + OUTLINE_FOLLOW_READ_MAX - 1);
        outlineCapNote = `\n\n[SYSTEM NOTE: This file was outlined earlier. Read window capped to ${OUTLINE_FOLLOW_READ_MAX} lines (you requested ${oldSpan}). Use a tighter range from the outline, then str_replace.]`;
      }
    } catch (_) {}

    const numbered = lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n');

    // Prefer a short relative path for the model to reuse (last 3 segments)
    const preferRel = String(usedUrl).split('/').filter(Boolean).slice(-3).join('/');

    let note = outlineCapNote || '';
    if (e < lines.length) {
      // M1: do NOT push sequential "read the rest" — prefer edit after one useful range
      note += `\n\n[SYSTEM NOTE: Showing lines ${s}-${e} of ${lines.length}. If you have enough context to edit, use str_replace/edit_file_lines on path="${preferRel}". Only read a *different* range if a specific missing section is required.]`;
    }
    if (usedUrl !== resolvedUrl || usedUrl !== fileUrl) {
      note += `\n[SYSTEM NOTE: Canonical path for this file is "${preferRel}". Always use this path for str_replace / edit_file_lines (do not invent a shorter path).]`;
    }

    // M2 read v2: for large files started at line 1, attach compact outline header
    let outlineHeader = '';
    if (s === 1 && lines.length > 200 && (!startLine || parseInt(startLine, 10) <= 1)) {
      try {
        const ol = await this._outlineFromLines(lines, preferRel, usedUrl);
        if (ol) outlineHeader = ol + '\n\n';
      } catch (_) {}
    }

    return {
      success: true,
      path: usedUrl,
      pathRelative: preferRel,
      content: outlineHeader + numbered + note,
      totalLines: lines.length,
      range: `${s}-${e}`,
      recovered: usedUrl !== resolvedUrl
    };
  }

  static _outlineFromLines(lines, preferRel, usedUrl) {
    const lang = detectLang(preferRel || usedUrl || '', lines.slice(0, 30).join('\n'));
    const symbols = buildStructureOutline(lines, lang, { max: 40 });
    if (!symbols.length) return '';
    const body = formatOutlineText(symbols.slice(0, 30), { path: preferRel, totalLines: lines.length });
    return `[OUTLINE ${preferRel} — ${lines.length} lines · ${lang}]\n${body}\n[Ranges are Lstart–Lend — read only those slices, then str_replace]`;
  }

  static async _listDirectory(dirUrl) {
    const resolved = await this._resolveProjectPath(dirUrl || '.');
    if (!resolved) return { error: "Missing 'path' argument." };
    const fixed = normalizeSafUrl(String(resolved));
    const s = fixed.toLowerCase();
    if (s.includes('com.foxdebug.acode') || s.includes('android%2fdata%2fcom.foxdebug') || s.includes('android/data/com.foxdebug')) {
      return {
        success: false,
        entries: [],
        error: "BLOCKED: Acode app-private data is not a user project."
      };
    }
    const result = await listDir(fixed);
    if (result.success) {
      result.entries = (result.entries || []).map(it => ({
        name: it.name,
        isDirectory: !!it.isDirectory,
        url: it.url
      }));
    } else if (!result.error && result.message) {
      result.error = result.message;
    }
    return result;
  }

  static _syncOpenEditorSession(fullPath, newContent) {
    try {
      const norm = normalizeSafUrl(fullPath);
      const openFile = window.editorManager?.files?.find(f => normalizeSafUrl(f.uri) === norm || f.uri === fullPath);
      if (openFile?.session && typeof openFile.session.replace === 'function') {
        const lastRow = openFile.session.getLength() - 1;
        const lastColumn = openFile.session.getLine(lastRow).length;
        openFile.session.replace({ start: { row: 0, column: 0 }, end: { row: lastRow, column: lastColumn } }, newContent);
      }
    } catch (_) {}
  }

  static async _editFileLines(args, dryRun = false) {
    const rawPath = args?.path;
    if (!rawPath) return { error: "Missing 'path' argument." };
    const fullPath = await this._resolveProjectPath(rawPath);

    const fileObj = fs(fullPath);
    if (!(await fileObj.exists())) {
      const pathName = String(rawPath).split('/').pop();
      return { error: `File not found: ${rawPath}. Use 'glob' to find the exact path (e.g. 'js/${pathName}').` };
    }

    if (!dryRun && !this.hasReadFile(fullPath)) {
      return {
        error: `READ-BEFORE-EDIT GUARD: You have not read '${rawPath}' in this turn. Call 'read' on '${rawPath}' first so you know the exact current line numbers before calling 'edit_file_lines'.`,
        blocked: true
      };
    }

    let oldContent;
    try {
      oldContent = await fileObj.readFile('utf-8');
    } catch (e) {
      return { error: `Could not read current content before editing: ${e.message || e}` };
    }

    const contentLines = oldContent.split('\n');
    let ranges = [];

    // Mode 1: Clean contiguous range { start_line, end_line, new_content }
    if (args.start_line != null && (args.new_content !== undefined || args.content !== undefined || args.replace !== undefined)) {
      const sLine = parseInt(args.start_line, 10);
      const eLine = args.end_line != null ? parseInt(args.end_line, 10) : sLine;
      const replacement = String(args.new_content ?? args.content ?? args.replace ?? '');
      ranges.push({ start: sLine, end: Math.max(sLine, eLine), text: replacement });
    }
    // Mode 2: Array of line/range edits
    else if (Array.isArray(args.lines) && args.lines.length > 0) {
      // Group contiguous single-line edits or explicit start_line/end_line objects
      const rawItems = args.lines
        .map(it => ({
          start: parseInt(it.start_line ?? it.line, 10),
          end: parseInt(it.end_line ?? it.start_line ?? it.line, 10),
          text: String(it.text ?? it.new_content ?? '')
        }))
        .filter(it => Number.isFinite(it.start) && it.start >= 1)
        .sort((a, b) => a.start - b.start);

      for (const item of rawItems) {
        const prev = ranges[ranges.length - 1];
        // If AI sent consecutive single lines where the first line contains multi-line text and subsequent lines repeat or clear, merge if overlapping
        if (prev && item.start <= prev.end) {
          prev.end = Math.max(prev.end, item.end);
          prev.text = prev.text ? `${prev.text}\n${item.text}` : item.text;
        } else {
          ranges.push({ ...item, end: Math.max(item.start, item.end) });
        }
      }
    } else {
      return {
        error: "Invalid 'edit_file_lines' arguments. Provide either { path, start_line, end_line, new_content } OR { path, lines: [{ line, text }] }."
      };
    }

    // Apply from bottom to top so earlier line numbers never shift
    ranges.sort((a, b) => b.start - a.start);

    let totalAdded = 0;
    let totalRemoved = 0;

    for (const r of ranges) {
      const startIdx = Math.max(0, r.start - 1);
      if (startIdx >= contentLines.length) continue;
      const endIdx = Math.min(contentLines.length - 1, r.end - 1);
      const removeCount = endIdx - startIdx + 1;

      // Strip accidental line-number prefixes if the model copied "12: code" from read output
      const cleanText = r.text
        .split('\n')
        .map(line => line.replace(/^\d+:\s/, ''))
        .join('\n');

      const oldSlice = contentLines.slice(startIdx, endIdx + 1).join('\n');
      if (oldSlice === cleanText) continue;

      totalRemoved += removeCount;
      if (cleanText === '') {
        contentLines.splice(startIdx, removeCount);
      } else {
        const newLines = cleanText.split('\n');
        contentLines.splice(startIdx, removeCount, ...newLines);
        totalAdded += newLines.length;
      }
    }

    if (totalAdded === 0 && totalRemoved === 0) {
      return { error: "No changes made — the replacement lines are identical to the existing file content." };
    }

    const newContent = contentLines.join('\n');
    if (dryRun) {
      return { success: true, url: fullPath, oldContent, newContent, dryRun: true, message: 'Preview only' };
    }

    try {
      await fileObj.writeFile(newContent);
    } catch (e) {
      return { error: `Failed to save edited file: ${e.message || e}` };
    }

    this._syncOpenEditorSession(fullPath, newContent);
    this.markFileRead(fullPath);

    return {
      success: true,
      url: fullPath,
      added: totalAdded,
      removed: totalRemoved,
      oldContent,
      newContent,
      message: `Edited lines (+${totalAdded} -${totalRemoved}). Note: Line numbers in this file have shifted; call 'read' if you need to make further line-based edits.`
    };
  }

  static async _searchReplaceEdit(rawPath, edits, dryRun = false) {
    if (!rawPath) return { error: "Missing 'path' argument." };
    if (!Array.isArray(edits) || edits.length === 0) {
      return { error: "Missing or invalid 'edits' argument — expected { path, search, replace }." };
    }

    const fullPath = await this._resolveProjectPath(rawPath);
    const fileObj = fs(fullPath);
    if (!(await fileObj.exists())) {
      const pathName = String(rawPath).split('/').pop();
      return { error: `File not found: ${rawPath}. Use 'glob' to check the exact path (e.g. 'js/${pathName}').` };
    }

    // Enforce Read-Before-Edit (skip during UI diff preview dryRun)
    if (!dryRun && !this.hasReadFile(fullPath)) {
      return {
        error: `READ-BEFORE-EDIT GUARD: You have NOT read '${rawPath}' in this turn! Never guess file contents. Call the 'read' tool on '${rawPath}' first, inspect the actual code, and then call 'str_replace'.`,
        blocked: true
      };
    }

    let oldContent;
    try {
      oldContent = await fileObj.readFile('utf-8');
    } catch (e) {
      return { error: `Could not read current content before editing: ${e.message || e}` };
    }

    let workingContent = oldContent;
    let applied = 0;
    let fuzzyApplied = 0;

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i] || {};
      let { search, replace } = edit;

      if (typeof search !== 'string' || search.length === 0) {
        return { error: `Edit #${i + 1}: 'search' must be a non-empty string.`, editsApplied: applied };
      }
      if (typeof replace !== 'string') {
        return { error: `Edit #${i + 1}: 'replace' must be a string.`, editsApplied: applied };
      }

      // Strip accidental line numbers ("14: const x = 1;") if model copied them from `read` output
      if (/^\d+:\s/.test(search.split('\n')[0] || '')) {
        search = search.split('\n').map(l => l.replace(/^\d+:\s/, '')).join('\n');
      }
      if (/^\d+:\s/.test(replace.split('\n')[0] || '')) {
        replace = replace.split('\n').map(l => l.replace(/^\d+:\s/, '')).join('\n');
      }

      if (search === replace) {
        return { error: `Edit #${i + 1} failed: 'search' and 'replace' are identical.`, editsApplied: applied };
      }

      const match = AcodeFSAgent._findAnchor(workingContent, search);

      if (match.matches === 0) {
        return {
          error: `Edit #${i + 1} failed: could not find that 'search' snippet in ${rawPath}. Call 'read' on ${rawPath} to view the exact current lines, or use 'edit_file_lines' with { path, start_line, end_line, new_content }.`,
          editsApplied: applied
        };
      }
      if (match.matches > 1) {
        return {
          error: `Edit #${i + 1} is ambiguous: that 'search' snippet matches ${match.matches} places in ${rawPath}. Include 2-4 more surrounding lines in 'search' to uniquely identify the target block.`,
          editsApplied: applied
        };
      }

      workingContent = workingContent.slice(0, match.start) + replace + workingContent.slice(match.end);
      applied++;
      if (match.tier !== 'exact') fuzzyApplied++;
    }

    if (dryRun) {
      return { success: true, url: fullPath, oldContent, newContent: workingContent, dryRun: true, message: 'Preview only (dry run)' };
    }

    try {
      await fileObj.writeFile(workingContent);
    } catch (e) {
      return { error: `Failed to save edited file: ${e.message || e}` };
    }

    this._syncOpenEditorSession(fullPath, workingContent);
    this.markFileRead(fullPath);

    return {
      success: true,
      url: fullPath,
      editsApplied: applied,
      fuzzyMatches: fuzzyApplied,
      oldContent,
      newContent: workingContent,
      message: `Applied ${applied} patch(es) to ${String(rawPath).split('/').pop()}.`
    };
  }

  static _normalizeLine(line) {
    return line.trim().replace(/[ \t]+/g, ' ');
  }

  static _lineOffsets(contentLines) {
    const offsets = [];
    let pos = 0;
    for (const line of contentLines) {
      offsets.push({ start: pos, end: pos + line.length });
      pos += line.length + 1;
    }
    return offsets;
  }

  static _findContiguousLineMatch(contentLines, searchLines, normalizeFn) {
    if (searchLines.length === 0 || contentLines.length < searchLines.length) return [];
    const normContent = contentLines.map(normalizeFn);
    const normSearch = searchLines.map(normalizeFn);
    const matches = [];
    for (let i = 0; i <= normContent.length - normSearch.length; i++) {
      let ok = true;
      for (let j = 0; j < normSearch.length; j++) {
        if (normContent[i + j] !== normSearch[j]) { ok = false; break; }
      }
      if (ok) matches.push(i);
    }
    return matches;
  }

  static _findAnchor(content, search) {
    const normContentCr = content.replace(/\r\n/g, '\n');
    const normSearchCr = search.replace(/\r\n/g, '\n');

    const exactPositions = [];
    {
      let idx = 0;
      while (true) {
        const f = content.indexOf(search, idx);
        if (f === -1) break;
        exactPositions.push(f);
        idx = f + 1;
      }
    }
    if (exactPositions.length === 1) return { matches: 1, start: exactPositions[0], end: exactPositions[0] + search.length, tier: 'exact' };
    if (exactPositions.length > 1) return { matches: exactPositions.length, tier: 'exact' };

    const contentLines = normContentCr.split('\n');
    const searchLines = normSearchCr.split('\n');
    const offsets = AcodeFSAgent._lineOffsets(content.split('\n'));

    const lineMatches = AcodeFSAgent._findContiguousLineMatch(contentLines, searchLines, AcodeFSAgent._normalizeLine);
    if (lineMatches.length === 1) {
      const startLine = lineMatches[0];
      const endLine = startLine + searchLines.length - 1;
      return { matches: 1, start: offsets[startLine].start, end: offsets[endLine].end, tier: 'normalized' };
    }
    if (lineMatches.length > 1) return { matches: lineMatches.length, tier: 'normalized' };

    const isBlank = (l) => AcodeFSAgent._normalizeLine(l) === '';
    const sigSearchLines = searchLines.filter(l => !isBlank(l));
    if (sigSearchLines.length === 0) return { matches: 0 };

    const sigContentEntries = [];
    contentLines.forEach((l, idx) => { if (!isBlank(l)) sigContentEntries.push({ origIndex: idx, line: l }); });
    const sigContentLines = sigContentEntries.map(e => e.line);

    const sigMatches = AcodeFSAgent._findContiguousLineMatch(sigContentLines, sigSearchLines, AcodeFSAgent._normalizeLine);
    if (sigMatches.length === 1) {
      const firstOrig = sigContentEntries[sigMatches[0]].origIndex;
      const lastOrig = sigContentEntries[sigMatches[0] + sigSearchLines.length - 1].origIndex;
      return { matches: 1, start: offsets[firstOrig].start, end: offsets[lastOrig].end, tier: 'fuzzy-block' };
    }
    if (sigMatches.length > 1) return { matches: sigMatches.length, tier: 'fuzzy-block' };

    // M2: indent-insensitive (strip leading whitespace per line)
    const stripIndent = (l) => String(l || '').replace(/^\s+/, '').replace(/[ \t]+/g, ' ').trimEnd();
    const indentMatches = AcodeFSAgent._findContiguousLineMatch(contentLines, searchLines, stripIndent);
    if (indentMatches.length === 1) {
      const startLine = indentMatches[0];
      const endLine = startLine + searchLines.length - 1;
      return { matches: 1, start: offsets[startLine].start, end: offsets[endLine].end, tier: 'indent-fuzzy' };
    }
    if (indentMatches.length > 1) return { matches: indentMatches.length, tier: 'indent-fuzzy' };

    // Unique long substring (≥12 chars) after normalize spaces
    const collapsed = normSearchCr.replace(/\s+/g, ' ').trim();
    if (collapsed.length >= 12) {
      const hay = normContentCr.replace(/[ \t]+/g, ' ');
      const needle2 = collapsed;
      let idx = 0;
      const pos = [];
      // search line-by-line collapsed
      const hayLines = normContentCr.split('\n');
      for (let i = 0; i < hayLines.length; i++) {
        const hl = hayLines[i].replace(/[ \t]+/g, ' ').trim();
        if (hl && needle2.includes(hl) && hl.length >= 8) {
          /* skip reverse */
        }
        if (hl.includes(needle2.slice(0, Math.min(40, needle2.length))) && needle2.length <= hl.length + 5) {
          pos.push(i);
        }
      }
      // Better: find collapsed search as subsequence of collapsed file
      const fileCollapsed = normContentCr.replace(/[ \t]+/g, ' ');
      let from = 0;
      const foundAt = [];
      while (from < fileCollapsed.length) {
        const f = fileCollapsed.indexOf(needle2, from);
        if (f === -1) break;
        foundAt.push(f);
        from = f + 1;
        if (foundAt.length > 3) break;
      }
      if (foundAt.length === 1) {
        // Map char offset in space-collapsed text is hard; fall back to first line match of first search line
        const firstSig = stripIndent(searchLines.find(l => stripIndent(l)) || '');
        if (firstSig.length >= 6) {
          const lineHits = [];
          for (let i = 0; i < contentLines.length; i++) {
            if (stripIndent(contentLines[i]).includes(firstSig.slice(0, 40))) lineHits.push(i);
          }
          if (lineHits.length === 1 && searchLines.length === 1) {
            const li = lineHits[0];
            return { matches: 1, start: offsets[li].start, end: offsets[li].end, tier: 'substr-fuzzy' };
          }
        }
      }
    }

    return { matches: 0 };
  }

  static _splitParentAndName(fullPath) {
    const fixed = normalizeSafUrl(String(fullPath || ''));
    const lastSlash = fixed.lastIndexOf('/');
    if (lastSlash === -1) return null;
    const docIdx = fixed.indexOf('::');
    if (docIdx !== -1 && lastSlash < docIdx) return null;
    return {
      parentUrl: fixed.substring(0, lastSlash),
      name: fixed.substring(lastSlash + 1)
    };
  }

  static async _createOrUpdateFile(rawPath, content, allowOverwrite = false) {
    if (!rawPath) return { error: "Missing 'path' argument." };
    if (typeof content !== 'string') return { error: "Missing or invalid 'content' argument." };

    const fixed = await this._resolveProjectPath(rawPath);
    const split = this._splitParentAndName(fixed);
    if (!split) return { error: `'${rawPath}' could not be resolved to a valid project file path.` };

    // Allow updating project_memory.md via write as well
    if (split.name.toLowerCase() === MEMORY_FILENAME) {
      return await this._updateProjectMemory(content);
    }

    let oldContent = null;
    try {
      const existing = await readFile(fixed, 'utf-8');
      if (existing && existing.success) oldContent = existing.content;
    } catch (_) {}

    // STRICT ANTI-OVERWRITE GUARD: Block overwriting ANY non-empty existing file!
    if (!allowOverwrite && typeof oldContent === 'string' && oldContent.trim().length > 0) {
      const oldLines = oldContent.split('\n').length;
      return {
        error: `ANTI-DATA-LOSS GUARD: Refusing 'write' on existing file '${split.name}' (${oldLines} lines). Overwriting existing files destroys code and UI! First call 'read' on '${rawPath}' (if you haven't already), then use 'str_replace' or 'edit_file_lines' to patch only the necessary lines.`,
        oldLines,
        blocked: true
      };
    }

    const result = await createFile(split.parentUrl, split.name, content, { overwrite: true });
    if (result && result.success) {
      result.oldContent = oldContent != null ? oldContent : '';
      result.newContent = content;
      this.markFileRead(result.url || fixed);
    }
    return result;
  }

  static async _createFolder(rawPath) {
    if (!rawPath) return { error: "Missing 'path' argument." };
    const fixed = await this._resolveProjectPath(rawPath);
    const split = this._splitParentAndName(fixed);
    if (!split) return { error: `'${rawPath}' is not a valid folder path.` };
    return await createFolder(split.parentUrl, split.name, { overwrite: true });
  }

  static _shellReachableUri(uri) {
    // /sdcard and plain file paths are always fine; Termux content:// may still
    // run *global* shell cmds (node -v) via Executor even if project is SAF-only.
    if (!uri) return false;
    return !/com\.foxdebug\.acode/i.test(String(uri));
  }

  static async _projectShellRoot() {
    const project = await getProjectFolder();
    if (!project?.uri) return null;
    const uri = String(project.uri);
    // Real filesystem under Termux home decoded from content URI when possible
    if (/com\.termux\.documents/i.test(uri)) {
      try {
        // content://…/tree/%2Fdata%2F…::/data/data/com.termux/files/home/Code/...
        const m = uri.match(/::(\/data\/data\/com\.termux\/files\/home\/[^?#]+)/);
        if (m) return m[1].replace(/\/$/, '');
        const dec = decodeURIComponent(uri);
        const m2 = dec.match(/(\/data\/data\/com\.termux\/files\/home\/[^\s:]+)/);
        if (m2) return m2[1].replace(/\/$/, '');
      } catch (_) {}
      return null; // still allow non-cwd commands below
    }
    if (!this._shellReachableUri(uri)) return null;
    if (uri.startsWith('/')) return uri;
    return `/sdcard/${project.name}`;
  }

  static async _runCommand(command) {
    const allow = ConfigManager.get('agentAllowTerminal');
    const okTerm = allow === true || allow === 'true' || allow == null || allow === '';
    if (!okTerm) return { error: 'Terminal access is disabled in Agent Settings.' };
    if (!command || !String(command).trim()) return { error: 'Empty command.' };

    const cmd = String(command).trim();
    // File I/O via shell stays blocked — FS tools are more reliable on SAF/Termux
    if (/^(ls|find|grep|cat)\b/.test(cmd)) {
      return {
        error: 'BLOCKED: Use native tools for ls/find/grep/cat (list_directory, glob, grep, read). Shell is for build/test/version checks.',
        blocked: true
      };
    }
    if (/\b(cat|tee)\s+>/i.test(cmd) || /<<\s*['"]?\w+['"]?/.test(cmd) || /\bsed\s+-i\b/i.test(cmd)) {
      return { error: 'BLOCKED: Do not modify files via shell. Use write, str_replace, or edit_file_lines.', blocked: true };
    }
    if (/\/data\/data|com\.termux|node_modules|\.git\/objects/i.test(cmd) && !/\/sdcard\/|\/data\/data\/com\.termux\/files\/home\//i.test(cmd)) {
      return { error: 'BLOCKED: Forbidden path in command.', blocked: true };
    }

    const terminal = acode.require('terminal');
    const executor = (typeof window !== 'undefined' && window.Executor) || terminal?.Executor;
    if (!executor?.execute) return { error: 'Terminal executor not available.' };

    // Prefer cd into project when we can resolve a real path; otherwise run as-is
    // (node -v, npm -v work without project cwd).
    const root = await this._projectShellRoot();
    const needsCwd = !/^(node|npm|npx|python|python3|pip|pkg|uname|whoami|echo|which|type)\b/.test(cmd);
    let finalCmd = cmd;
    if (root && needsCwd && !/^\s*cd\s+/.test(cmd)) {
      finalCmd = `cd ${JSON.stringify(root)} && ${cmd}`;
    } else if (!root && needsCwd && /\.\//.test(cmd)) {
      return {
        error: 'This project folder is only reachable via Filesystem (SAF). Use FS tools for project files; shell still works for global commands like node --version.',
        blocked: true
      };
    }

    const timeoutSec = ConfigManager.get('agentTerminalTimeout') !== null ? parseInt(ConfigManager.get('agentTerminalTimeout')) : 15;
    const timeoutMs = Math.max(5, timeoutSec) * 1000;
    try {
      const stdout = await Promise.race([
        executor.execute(finalCmd, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${timeoutSec}s`)), timeoutMs))
      ]);
      return {
        success: true,
        stdout: String(stdout ?? '').slice(0, 4000),
        cwd: root || null,
        command: finalCmd
      };
    } catch (e) {
      return { success: false, error: String(e?.message || e).slice(0, 800) };
    }
  }

  static async _fileIndexQuery(pattern) {
    try {
      const fileIndex = acode.require('fileIndex');
      if (!fileIndex?.query) return null;
      const project = await getProjectFolder();
      if (!project?.uri) return null;
      return await fileIndex.query({ roots: [project.uri], text: String(pattern || '').replace(/^\*\./, ''), limit: 100 });
    } catch (_) { return null; }
  }

  static async _fileIndexSearch(pattern) {
    try {
      const fileIndex = acode.require('fileIndex');
      if (!fileIndex?.search) return null;
      const project = await getProjectFolder();
      if (!project?.uri) return null;
      return await fileIndex.search({ roots: [project.uri], query: String(pattern), limit: 50 });
    } catch (_) { return null; }
  }

  static async _safWalkNames(dirUrl, depth, acc, max) {
    if (depth < 0 || acc.length >= max) return;
    const listed = await listDir(dirUrl);
    if (!listed?.success || !Array.isArray(listed.entries)) return;
    for (const ent of listed.entries) {
      if (acc.length >= max) break;
      const name = ent.name || '';
      if (!name || name === '.git' || name === 'node_modules') continue;
      const url = ent.url || ent.uri || '';
      const isDir = !!(ent.isDirectory || ent.isFolder || ent.type === 'folder');
      acc.push({ name, url, isDirectory: isDir });
      if (isDir && url && depth > 0) await this._safWalkNames(url, depth - 1, acc, max);
    }
  }

  static async _glob(pattern, pathArg) {
    if (!pattern) return { error: "Missing 'pattern' argument." };
    const fi = await this._fileIndexQuery(pattern, pathArg);
    if (fi) {
      const rows = Array.isArray(fi) ? fi : (fi.files || fi.results || fi.items || []);
      if (rows.length) return { success: true, via: 'fileIndex', matches: rows.slice(0, 80).map(r => r.path || r.url || r.name || String(r)) };
    }
    const project = await getProjectFolder();
    if (!project?.uri) return { error: 'No project open for glob.' };
    const startUri = pathArg ? await this._resolveProjectPath(pathArg) : project.uri;
    const acc = [];
    await this._safWalkNames(startUri, 5, acc, 200);
    const cleanPat = String(pattern).split('/').pop() || pattern;
    const pat = String(cleanPat).replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    let re;
    try { re = new RegExp('^' + pat + '$', 'i'); } catch (_) { re = null; }
    const matches = acc.filter(e => {
      if (re) return re.test(e.name);
      return e.name.toLowerCase().includes(String(cleanPat).replace(/\*/g, '').toLowerCase());
    }).map(e => e.url || e.name);
    return { success: true, via: 'saf-walk', matches: matches.slice(0, 80), message: matches.length ? undefined : 'No matches found.' };
  }

  static async _grep(pattern, pathArg, opts = {}) {
    if (!pattern) return { error: "Missing 'pattern' argument." };
    const needle = String(pattern);
    const scopeLabel = pathArg ? String(pathArg).split('/').pop() || pathArg : '.';
    let contextLines = parseInt(opts?.context_lines, 10);
    if (!Number.isFinite(contextLines)) contextLines = 1;
    contextLines = Math.max(0, Math.min(3, contextLines));
    let maxMatches = parseInt(opts?.max_matches, 10);
    if (!Number.isFinite(maxMatches)) maxMatches = 40;
    maxMatches = Math.max(1, Math.min(80, maxMatches));

    // Try fileIndex first — only use if it actually returns hits
    const fi = await this._fileIndexSearch(needle);
    if (fi) {
      const rows = Array.isArray(fi) ? fi : (fi.results || fi.matches || fi.items || []);
      if (rows.length) {
        const matches = rows.slice(0, maxMatches).map(r => {
          if (typeof r === 'string') return r;
          const file = r.path || r.url || r.file || r.name || '';
          const line = r.line != null ? r.line : (r.lineNumber != null ? r.lineNumber : '');
          const text = (r.text || r.content || r.preview || r.snippet || '').toString().slice(0, 160);
          return line !== '' ? `${file}:${line}: ${text}` : `${file}: ${text || JSON.stringify(r).slice(0, 100)}`;
        });
        return {
          success: true,
          via: 'fileIndex',
          pattern: needle,
          path: pathArg || '.',
          matchCount: matches.length,
          output: matches.join('\n'),
          matches,
          summary: `grep "${needle}" in ${scopeLabel}: ${matches.length} match(es)`
        };
      }
    }

    const project = await getProjectFolder();
    if (!project?.uri && !pathArg) return { error: 'No project open for grep.' };

    let startUri = pathArg ? await this._resolveProjectPath(pathArg) : project?.uri;
    if (!startUri) return { error: 'Could not resolve path for grep.' };

    const filesToScan = [];
    const isLikelyFile = pathArg && /\.[a-z0-9]{1,8}$/i.test(String(pathArg).split('/').pop() || '');
    if (isLikelyFile) {
      filesToScan.push({
        name: String(pathArg).split('/').pop() || 'file',
        url: startUri,
        isDirectory: false
      });
    } else {
      try {
        const probe = await readFile(startUri, 'utf-8');
        if (probe?.success && typeof probe.content === 'string') {
          filesToScan.push({
            name: String(pathArg || startUri).split('/').pop() || 'file',
            url: startUri,
            isDirectory: false
          });
        }
      } catch (_) {}
    }

    if (!filesToScan.length) {
      const acc = [];
      await this._safWalkNames(startUri, 4, acc, 120);
      for (const e of acc) {
        if (e.isDirectory || !e.url) continue;
        if (!/\.(js|ts|tsx|jsx|json|html|css|md|txt|py|java|kt|xml|php|vue|svelte)$/i.test(e.name)) continue;
        filesToScan.push(e);
      }
    }

    let regex = null;
    try {
      regex = new RegExp(needle, 'i');
    } catch (_) {
      regex = null;
    }
    const needleLower = needle.toLowerCase();

    const hits = [];
    const structured = [];
    for (const e of filesToScan) {
      if (!e.url) continue;
      try {
        const r = await readFile(e.url, 'utf-8');
        if (!r?.success || typeof r.content !== 'string') continue;
        const lines = r.content.split('\n');
        for (let i = 0; i < lines.length && hits.length < maxMatches; i++) {
          const line = lines[i];
          let matched = false;
          if (regex) {
            try { matched = regex.test(line); } catch (_) { matched = false; }
            if (regex.global) regex.lastIndex = 0;
          } else {
            matched = line.toLowerCase().includes(needleLower);
          }
          if (!matched) continue;
          const from = Math.max(0, i - contextLines);
          const to = Math.min(lines.length - 1, i + contextLines);
          const block = [];
          for (let j = from; j <= to; j++) {
            const mark = j === i ? ':' : '-';
            block.push(`${e.name}${mark}${j + 1}: ${lines[j].slice(0, 160)}`);
          }
          hits.push(block.join('\n'));
          structured.push({
            file: e.name,
            line: i + 1,
            text: line.slice(0, 160),
            context: block.join('\n')
          });
        }
      } catch (_) {}
      if (hits.length >= maxMatches) break;
    }

    const summary = `grep "${needle}" in ${scopeLabel}: ${hits.length} match(es)` +
      (hits.length ? '' : ' — none found');
    console.log(TAG, summary);

    return {
      success: true,
      via: isLikelyFile || filesToScan.length === 1 ? 'file-scan' : 'saf-scan',
      pattern: needle,
      path: pathArg || '.',
      matchCount: hits.length,
      context_lines: contextLines,
      output: hits.join('\n---\n') || `(no matches for "${needle}" in ${scopeLabel})`,
      matches: structured.length ? structured : hits,
      summary
    };
  }

  /** M7: structure map with start–end ranges (HTML/CSS/JS/TS/Python/JVM/Go). */
  static async _outline(fileUrl, opts = {}) {
    if (!fileUrl) return { error: "Missing 'path' argument." };
    const resolvedUrl = await this._resolveProjectPath(fileUrl);
    if (!resolvedUrl) return { error: `Could not resolve path: ${fileUrl}` };

    const READ_MS = 15000;
    let result;
    try {
      result = await Promise.race([
        readFile(resolvedUrl, 'utf-8'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('outline read timed out')), READ_MS))
      ]);
    } catch (e) {
      result = { success: false, error: e?.message || String(e) };
    }
    if (!result || result.success === false || (result.content == null && result.data == null)) {
      return { error: result?.error || `Cannot read file for outline: ${fileUrl}` };
    }
    const text = String(result.content != null ? result.content : result.data);
    const lines = text.split(/\r?\n/);
    const total = lines.length;
    const preferRel = String(resolvedUrl).split('/').filter(Boolean).slice(-3).join('/');
    const lang = detectLang(preferRel || fileUrl, lines.slice(0, 40).join('\n'));

    // Prefer tree-sitter when available (plugin may inject WASM later)
    let symbols = null;
    try {
      symbols = await tryTreeSitterOutline(preferRel, text);
    } catch (_) {}
    if (!symbols || !symbols.length) {
      symbols = buildStructureOutline(lines, lang, { max: 80 });
    }

    // Optional filter by kind / query substring
    const kindFilter = opts.kind || opts.filter_kind || null;
    const query = (opts.query || opts.name || '').toString().toLowerCase();
    let filtered = symbols;
    if (kindFilter) {
      const k = String(kindFilter).toLowerCase();
      filtered = filtered.filter(s => String(s.kind).toLowerCase().includes(k));
    }
    if (query) {
      filtered = filtered.filter(s =>
        String(s.name).toLowerCase().includes(query) ||
        String(s.detail || '').toLowerCase().includes(query)
      );
    }

    const linesOut = formatOutlineText(filtered.slice(0, 60), { path: preferRel, totalLines: total });

    try {
      this.markFileRead(resolvedUrl);
      this.markFileRead(fileUrl);
      _outlinedPathsThisTurn.add(normalizeSafUrl(String(resolvedUrl)));
      if (fileUrl) _outlinedPathsThisTurn.add(normalizeSafUrl(String(fileUrl)));
      try {
        const preferKey = String(preferRel || '').toLowerCase();
        if (preferKey) _outlinedPathsThisTurn.add(preferKey);
      } catch (_) {}
    } catch (_) {}

    return {
      success: true,
      path: resolvedUrl,
      pathRelative: preferRel,
      language: lang,
      engine: 'structure-outline',
      totalLines: total,
      symbolCount: filtered.length,
      symbols: filtered.slice(0, 60),
      outline: linesOut || '(no landmarks detected)',
      summary: `outline ${preferRel} (${lang}): ${total} lines, ${filtered.length} symbols with Lstart–Lend — read range then edit`,
      hint: total > 200
        ? 'Large file: pick a symbol range (Lstart–Lend), read only that slice, then str_replace. Do not sequential-read the whole file.'
        : 'Use Lstart–Lend on a symbol to target str_replace / edit_file_lines.'
    };
  }

}