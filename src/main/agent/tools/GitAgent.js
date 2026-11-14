/**
 * Lightweight git tools (status / diff / log) via shell — Claude/Codex parity.
 */
import { AcodeTerminalAgent } from './AcodeTerminalAgent.js';
import { getProjectFolder } from '../../utils/file/fileOperations.js';

const TAG = '[GitAgent]';
const MAX_OUT = 12000;

async function gitCmd(args) {
  const project = await getProjectFolder();
  const root = project?.url || project?.uri || project?.path || '';
  // Prefer plain path for shell cd; Termux content:// may need project path field
  let cwd = root;
  try {
    if (typeof root === 'string' && root.includes('::')) {
      cwd = root.split('::').pop() || root;
    }
  } catch (_) {}
  const cmd = cwd && !String(cwd).startsWith('content:')
    ? `cd ${JSON.stringify(cwd)} 2>/dev/null; git ${args}`
    : `git ${args}`;
  const res = await AcodeTerminalAgent.runShellCommand(cmd, true);
  const out = String(res?.stdout || res?.output || res?.message || '').slice(0, MAX_OUT);
  const err = String(res?.stderr || res?.error || '');
  const ok = res?.success !== false && !/not a git repository/i.test(out + err);
  return { ok, out, err, raw: res, cwd: cwd || null };
}

export class GitAgent {
  static getToolsSchema() {
    return [
      {
        name: 'git_status',
        description:
          'Run git status (short) in the project. Use before commit/review to see changed files.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'git_diff',
        description:
          'Show git diff. path optional (file). staged=true for staged diff only.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Optional file path' },
            staged: { type: 'BOOLEAN', description: 'If true, git diff --staged' }
          }
        }
      },
      {
        name: 'git_log',
        description: 'Recent git commits (oneline).',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: { type: 'NUMBER', description: 'Max commits (default 8, max 20)' }
          }
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    const name = functionCall?.name;
    const args = functionCall?.args || {};

    if (name === 'git_status') {
      const r = await gitCmd('status -sb');
      if (!r.ok && /not a git/i.test(r.out + r.err)) {
        return { success: false, error: 'Not a git repository (init git in project first).', cwd: r.cwd };
      }
      return { success: r.ok, output: r.out || r.err, cwd: r.cwd };
    }

    if (name === 'git_diff') {
      const staged = args.staged === true;
      const path = String(args.path || '').trim();
      let a = staged ? 'diff --staged' : 'diff';
      if (path) a += ` -- ${JSON.stringify(path)}`;
      const r = await gitCmd(a);
      return {
        success: true,
        staged,
        path: path || null,
        output: (r.out || r.err || '(empty diff)').slice(0, MAX_OUT)
      };
    }

    if (name === 'git_log') {
      const n = Math.min(20, Math.max(1, parseInt(args.limit, 10) || 8));
      const r = await gitCmd(`log -n ${n} --oneline`);
      return { success: r.ok, output: r.out || r.err, cwd: r.cwd };
    }

    return { error: `Unknown tool: ${name}` };
  }
}
