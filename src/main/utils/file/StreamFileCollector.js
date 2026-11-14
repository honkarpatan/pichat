/**
 * StreamFileCollector — during agent-mode streaming, hide raw code bodies from chat
 * and surface per-file progress ("index.html ready"). Completed fences are held for
 * disk write via FileBlockApplier.
 *
 * 🟢 LIVE DIFF UPDATE: this used to only report a file once its fence fully closed —
 * so a single big file streaming in showed NOTHING until the very end. Now push()
 * also returns `partial`: the currently-OPEN fence's path/content, updated on every
 * chunk, so the caller can paint a live "Writing…" diff card as it streams — same
 * idea as Claude/Grok's live code panel, not a final-only reveal.
 *
 * It also opportunistically (fire-and-forget, non-blocking) fetches the EXISTING
 * on-disk content for a path the moment its fence opens, and caches it — so the
 * live card can render a real +/- diff instead of an all-green "new file" dump
 * once the old content resolves.
 */

import { parseFileBlocks, applyFileBlocks, resolveProjectPath } from './FileBlockApplier.js';
import { readFile } from './fileOperations.js';

const FENCE_OPEN = /^```([a-zA-Z0-9_+-]*)[ \t]*(.*)$/;

function looksLikePath(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.length > 240) return false;
  if (/^(javascript|typescript|python|html|css|json|bash|shell|text|xml|markdown|jsx|tsx|diff|plaintext)$/i.test(t)) return false;
  return /\.[a-zA-Z0-9]{1,12}$/.test(t) || t.includes('/');
}

function pathFromFenceRest(rest) {
  const r = (rest || '').trim();
  const attr = r.match(/(?:file|title|path)\s*=\s*["']([^"']+)["']/i);
  if (attr) return attr[1];
  if (r.startsWith(':')) return r.slice(1).trim();
  if (looksLikePath(r)) return r;
  return null;
}

function pathFromHeading(line) {
  const m = String(line || '').trim().match(/^(?:#{1,6}|\/\/)\s*(?:file\s*[:=]\s*)?([^\s*][^\n]*?\.[a-zA-Z0-9]{1,12})\s*$/);
  return m && looksLikePath(m[1]) ? m[1].trim() : null;
}

export class StreamFileCollector {
  constructor() {
    this.raw = '';
    /** @type {{ path: string, content: string, lang: string, lines: number }[]} */
    this.files = [];
    this._seenPaths = new Set();
    this._inFence = false;
    this._fenceLang = '';
    this._fencePath = '';
    this._fenceBody = [];
    this._proseLines = [];
    this._lastHeadingPath = null;
    this._statusLines = []; // human progress lines injected into visible text

    // 🟢 path -> old file content ('' if none/not found, null while still loading)
    this._oldContentCache = new Map();
  }

  /** Ingest a stream chunk; returns { visible, newFiles, partial } */
  push(chunk) {
    if (!chunk) return { visible: this.getVisible(), newFiles: [], partial: this._currentPartial() };
    this.raw += chunk;
    return this._reparse();
  }

  /** Fire-and-forget background lookup of existing on-disk content for a path. */
  _ensureOldContent(path) {
    if (!path || this._oldContentCache.has(path)) return;
    this._oldContentCache.set(path, null); // mark "loading" so we don't double-fetch
    (async () => {
      try {
        const resolved = await resolveProjectPath(path);
        if (resolved && !resolved.error && resolved.fullPath) {
          const res = await readFile(resolved.fullPath, 'utf-8');
          let content = '';
          if (res != null) {
            content = typeof res === 'string' ? res : (res.content ?? res.data ?? '');
          }
          this._oldContentCache.set(path, content || '');
        } else {
          this._oldContentCache.set(path, '');
        }
      } catch (_) {
        this._oldContentCache.set(path, '');
      }
    })();
  }

  /** Build the "currently streaming" file object from live fence state (or null). */
  _currentPartial() {
    if (!this._inFence || !this._fencePath || !looksLikePath(this._fencePath)) return null;
    const content = this._fenceBody.join('\n');
    if (!content.trim()) return null;
    const cached = this._oldContentCache.has(this._fencePath) ? this._oldContentCache.get(this._fencePath) : undefined;
    return {
      path: this._fencePath,
      content,
      lang: this._fenceLang,
      oldContent: cached || '',
      loadingOld: cached === null,
      lines: content.split('\n').length,
      streaming: true
    };
  }

  _reparse() {
    // Full reparse from raw keeps state correct if chunks split mid-line
    const text = this.raw.replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const newFiles = [];

    this._inFence = false;
    this._fenceLang = '';
    this._fencePath = '';
    this._fenceBody = [];
    this._proseLines = [];
    this._lastHeadingPath = null;
    // Keep status from already-committed files
    const committed = new Map(this.files.map(f => [f.path, f]));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const open = line.match(FENCE_OPEN);

      if (!this._inFence && open) {
        this._inFence = true;
        this._fenceLang = (open[1] || '').trim();
        this._fencePath = pathFromFenceRest(open[2]) || this._lastHeadingPath || '';
        this._fenceBody = [];
        if (this._fencePath && looksLikePath(this._fencePath)) this._ensureOldContent(this._fencePath);
        continue;
      }

      if (this._inFence) {
        if (line.startsWith('```')) {
          // complete fence
          const content = this._fenceBody.join('\n');
          const path = (this._fencePath || '').replace(/^\/+/, '');
          this._inFence = false;
          if (path && looksLikePath(path) && content.trim().length >= 40) {
            const stripped = content.replace(/^\s*#{1,6}\s+\S+\s*$/gm, '').trim();
            if (stripped.length >= 40) {
              const oldContent = this._oldContentCache.has(path) ? (this._oldContentCache.get(path) || '') : '';
              const entry = {
                path,
                content,
                oldContent,
                lang: this._fenceLang,
                lines: content.split('\n').length
              };
              if (!committed.has(path) || committed.get(path).content !== content) {
                committed.set(path, entry);
                if (!this._seenPaths.has(path + '::' + content.length)) {
                  this._seenPaths.add(path + '::' + content.length);
                  newFiles.push(entry);
                }
              }
            }
          }
          this._fencePath = '';
          this._fenceBody = [];
          continue;
        }
        this._fenceBody.push(line);
        continue;
      }

      // prose
      const hp = pathFromHeading(line);
      if (hp) {
        this._lastHeadingPath = hp;
        // don't show ### path as big heading spam — light status only
        continue;
      }
      // Skip pure planning noise optional? keep short prose
      this._proseLines.push(line);
    }

    this.files = Array.from(committed.values());
    return { visible: this.getVisible(), newFiles, partial: this._currentPartial() };
  }

  getVisible() {
    // Never emit "✓ file ready (N lines)" as chat text — live UI cards handle that.
    const prose = this._proseLines.join('\n').trim();
    let head = prose;
    if (head.length > 600) head = head.slice(0, 600) + '\n…';
    // Strip accidental ready-lines if model echoed them
    head = head
      .replace(/^✓\s*\*?\*?[^\n]+ready\s*\([^)]*\)\*?\*?\s*$/gim, '')
      .replace(/✓\s*\*?\*?\d+\s*file\(s\)\s*applied\.?\*?\*?/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return head;
  }

  /** Final parse + apply all files to project disk */
  async flushToDisk(onProgress) {
    // Prefer structured parseFileBlocks on full raw as well
    const fromParser = parseFileBlocks(this.raw);
    const byPath = new Map(this.files.map(f => [f.path, f]));
    for (const b of fromParser) {
      byPath.set(b.path, { path: b.path, content: b.content, lang: b.lang, lines: b.content.split('\n').length });
    }
    this.files = Array.from(byPath.values());

    if (!this.files.length) {
      return { successCount: 0, failCount: 0, applied: [], skipped: true };
    }

    // Build synthetic markdown for applyFileBlocks
    const md = this.files.map(f =>
      '```' + (f.lang || '') + ' file="' + f.path + '"\n' + f.content + '\n```'
    ).join('\n\n');

    return applyFileBlocks(md, { onProgress });
  }
}