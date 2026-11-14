/**
 * Edit quality tools (OpenCode / Claude-style):
 *  - apply_patch: unified diff (---/+++ @@ hunks)
 *  - multi_edit: several search/replace on one file, atomic accept
 *  - get_diagnostics: best-effort syntax/lint hints after edits
 */
import { AcodeFSAgent } from './AcodeFSAgent.js';

const TAG = '[EditQuality]';

/**
 * Parse a simplified unified diff into file operations.
 * Supports:
 *   --- a/path
 *   +++ b/path
 *   @@ -start,count +start,count @@
 *   context / -old / +new lines
 */
export function parseUnifiedDiff(patch) {
  const text = String(patch || '').replace(/\r\n/g, '\n');
  const files = [];
  let current = null;
  let hunkLines = [];

  const flushHunk = () => {
    if (!current || !hunkLines.length) {
      hunkLines = [];
      return;
    }
    const oldLines = [];
    const newLines = [];
    for (const line of hunkLines) {
      if (line.startsWith(' ')) {
        oldLines.push(line.slice(1));
        newLines.push(line.slice(1));
      } else if (line.startsWith('-')) {
        oldLines.push(line.slice(1));
      } else if (line.startsWith('+')) {
        newLines.push(line.slice(1));
      } else if (line.startsWith('\\')) {
        // \ No newline at end of file
      } else {
        // treat as context
        oldLines.push(line);
        newLines.push(line);
      }
    }
    current.hunks.push({
      oldText: oldLines.join('\n'),
      newText: newLines.join('\n')
    });
    hunkLines = [];
  };

  const flushFile = () => {
    flushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (const raw of text.split('\n')) {
    if (raw.startsWith('--- ')) {
      flushFile();
      let p = raw.slice(4).trim();
      if (p.startsWith('a/')) p = p.slice(2);
      if (p === '/dev/null') p = '';
      current = { path: p, hunks: [] };
      continue;
    }
    if (raw.startsWith('+++ ')) {
      let p = raw.slice(4).trim();
      if (p.startsWith('b/')) p = p.slice(2);
      if (p === '/dev/null') p = '';
      if (!current) current = { path: p, hunks: [] };
      else if (p) current.path = p;
      continue;
    }
    if (raw.startsWith('@@')) {
      flushHunk();
      continue;
    }
    if (current) hunkLines.push(raw);
  }
  flushFile();
  return files.filter(f => f.path && f.hunks.length);
}

async function runStrReplace(path, search, replace, dryRun) {
  return AcodeFSAgent.executeTool({
    name: 'str_replace',
    args: { path, search, replace, _dryRun: !!dryRun }
  });
}

async function readFileContent(path) {
  const r = await AcodeFSAgent.executeTool({
    name: 'read',
    args: { path }
  });
  if (r?.error) return { ok: false, error: r.error };
  // read returns numbered lines sometimes
  let content = r?.content ?? r?.text ?? r?.data ?? '';
  if (typeof content !== 'string') content = String(content || '');
  // strip line number prefixes "   12|..."
  if (/^\s*\d+\|/.test(content.split('\n')[0] || '')) {
    content = content
      .split('\n')
      .map(line => line.replace(/^\s*\d+\|/, ''))
      .join('\n');
  }
  return { ok: true, content, raw: r };
}

/**
 * Best-effort diagnostics via Acode editor APIs or simple syntax checks.
 */
export async function collectDiagnostics(path, content) {
  const hints = [];
  const p = String(path || '');
  const src = String(content || '');

  // Try Acode / ace session annotations
  try {
    const editor = window.editorManager?.activeFile?.session || window.editor?.session;
    if (editor?.getAnnotations) {
      const ann = editor.getAnnotations() || [];
      for (const a of ann) {
        if (a.type === 'error' || a.type === 'warning') {
          hints.push({
            severity: a.type,
            line: (a.row != null ? a.row + 1 : null),
            message: a.text || a.message || String(a)
          });
        }
      }
    }
  } catch (_) {}

  // Lightweight JS/JSON balance checks
  if (/\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(p) || /\.(json)$/i.test(p)) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    let inStr = null;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === '\\') {
          esc = true;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c;
        continue;
      }
      if (pairs[c]) stack.push(pairs[c]);
      else if (c === ')' || c === ']' || c === '}') {
        const want = stack.pop();
        if (want !== c) {
          hints.push({
            severity: 'error',
            message: `Unbalanced bracket near offset ${i}: expected ${want || 'none'}, got ${c}`
          });
          break;
        }
      }
    }
    if (stack.length) {
      hints.push({
        severity: 'warning',
        message: `Unclosed brackets: ${stack.length} remaining`
      });
    }
  }

  if (/\.json$/i.test(p)) {
    try {
      JSON.parse(src);
    } catch (e) {
      hints.push({ severity: 'error', message: 'JSON parse: ' + (e.message || e) });
    }
  }

  return hints.slice(0, 20);
}

export class EditQualityAgent {
  static getToolsSchema() {
    return [
      {
        name: 'apply_patch',
        description:
          'Apply a unified diff patch to one or more files (OpenCode/Claude-style). ' +
          'Use when fixing several places in one or more files in ONE tool call. ' +
          'Patch format MUST include path headers and context lines:\n' +
          '--- a/js/chess.js\n+++ b/js/chess.js\n@@\n context\n-old line\n+new line\n context\n' +
          'Each hunk is exact search→replace (include 2–3 context lines). ' +
          'Prefer multi_edit if you only have search/replace pairs. Set dry_run true to validate only.',
        parameters: {
          type: 'OBJECT',
          properties: {
            patch: {
              type: 'STRING',
              description: 'Unified diff text'
            },
            dry_run: {
              type: 'BOOLEAN',
              description: 'If true, only validate matches — no disk write'
            }
          },
          required: ['patch']
        }
      },
      {
        name: 'multi_edit',
        description:
          'Apply multiple search/replace edits to a SINGLE file in order (atomic intent). ' +
          'Better than many separate str_replace calls when fixing several spots in one file. ' +
          'Stops on first failure and reports which edit index failed.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'File path relative to project' },
            edits: {
              type: 'ARRAY',
              description: 'Ordered list of { search, replace }',
              items: {
                type: 'OBJECT',
                properties: {
                  search: { type: 'STRING' },
                  replace: { type: 'STRING' }
                }
              }
            },
            dry_run: { type: 'BOOLEAN' }
          },
          required: ['path', 'edits']
        }
      },
      {
        name: 'get_diagnostics',
        description:
          'After edits, get lightweight diagnostics (bracket balance, JSON parse, editor annotations if available). ' +
          'Call on a path you just changed when the user reports errors or you want to verify syntax.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'File to check' }
          },
          required: ['path']
        }
      }
    ];
  }

  static async executeTool(functionCall, app) {
    const name = functionCall?.name;
    const args = functionCall?.args || {};

    if (name === 'get_diagnostics') {
      const path = String(args.path || '').trim();
      if (!path) return { error: 'Missing path' };
      const read = await readFileContent(path);
      if (!read.ok) return { success: false, path, error: read.error };
      const diagnostics = await collectDiagnostics(path, read.content);
      return {
        success: true,
        path,
        diagnostics,
        clean: diagnostics.length === 0,
        message:
          diagnostics.length === 0
            ? `No diagnostics for ${path}`
            : diagnostics.map(d => `${d.severity}${d.line ? ` L${d.line}` : ''}: ${d.message}`).join('\n')
      };
    }

    if (name === 'multi_edit') {
      const path = String(args.path || '').trim();
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const dryRun = !!(args.dry_run || args.dryRun || args._dryRun);
      if (!path) return { error: 'Missing path' };
      if (!edits.length) return { error: 'edits array is empty' };

      const applied = [];
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i] || {};
        const search = e.search ?? e.old_string ?? e.oldString;
        const replace = e.replace ?? e.new_string ?? e.newString ?? '';
        if (search == null || search === '') {
          return {
            success: false,
            path,
            failedIndex: i,
            error: `Edit #${i}: missing search string`,
            applied
          };
        }
        const r = await runStrReplace(path, String(search), String(replace), dryRun);
        if (r?.error || r?.success === false) {
          return {
            success: false,
            path,
            failedIndex: i,
            error: r?.error || `Edit #${i} failed`,
            applied,
            dryRun
          };
        }
        applied.push({ index: i, ok: true });
      }

      let diagnostics = [];
      if (!dryRun) {
        try {
          const read = await readFileContent(path);
          if (read.ok) diagnostics = await collectDiagnostics(path, read.content);
        } catch (_) {}
      }

      return {
        success: true,
        path,
        editsApplied: applied.length,
        dryRun,
        diagnostics,
        message: dryRun
          ? `Dry-run: ${applied.length} edit(s) would apply to ${path}`
          : `Applied ${applied.length} edit(s) to ${path}` +
            (diagnostics.length ? `\nDiagnostics:\n${diagnostics.map(d => d.message).join('\n')}` : '')
      };
    }

    if (name === 'apply_patch') {
      const patch = String(args.patch || args.diff || '');
      const dryRun = !!(args.dry_run || args.dryRun || args._dryRun);
      if (!patch.trim()) return { error: 'Missing patch' };

      const files = parseUnifiedDiff(patch);
      if (!files.length) {
        return {
          error:
            'Could not parse unified diff. Expected --- a/path, +++ b/path, @@ hunks with -/+/ context lines.'
        };
      }

      const results = [];
      for (const f of files) {
        const fileRes = { path: f.path, hunks: [] };
        for (let i = 0; i < f.hunks.length; i++) {
          const h = f.hunks[i];
          if (!h.oldText && h.newText) {
            // pure add — fall back to append via str_replace empty fail; use write not allowed on existing
            fileRes.hunks.push({
              index: i,
              ok: false,
              error: 'Pure-add hunk without context not supported; use write or str_replace with surrounding context'
            });
            results.push(fileRes);
            return {
              success: false,
              dryRun,
              results,
              error: `Hunk #${i} on ${f.path}: pure additions need context lines`
            };
          }
          const r = await runStrReplace(f.path, h.oldText, h.newText, dryRun);
          if (r?.error || r?.success === false) {
            fileRes.hunks.push({ index: i, ok: false, error: r?.error || 'hunk failed' });
            results.push(fileRes);
            return {
              success: false,
              dryRun,
              results,
              error: `Patch failed at ${f.path} hunk #${i}: ${r?.error || 'search not found'}. Re-read the file and regenerate the patch.`
            };
          }
          fileRes.hunks.push({ index: i, ok: true });
        }
        results.push(fileRes);
      }

      // Diagnostics on last touched file
      let diagnostics = [];
      const lastPath = files[files.length - 1]?.path;
      if (!dryRun && lastPath) {
        try {
          const read = await readFileContent(lastPath);
          if (read.ok) diagnostics = await collectDiagnostics(lastPath, read.content);
        } catch (_) {}
      }

      const nH = results.reduce((a, f) => a + f.hunks.filter(h => h.ok).length, 0);
      console.log(TAG, 'apply_patch files=', results.length, 'hunks=', nH, 'dry=', dryRun);
      return {
        success: true,
        dryRun,
        files: results.map(f => f.path),
        hunksApplied: nH,
        results,
        diagnostics,
        message:
          (dryRun ? 'Dry-run OK: ' : 'Applied ') +
          `${nH} hunk(s) across ${results.length} file(s)` +
          (diagnostics.length ? `\nDiagnostics:\n${diagnostics.map(d => d.message).join('\n')}` : '')
      };
    }

    return { error: `Unknown tool: ${name}` };
  }
}
