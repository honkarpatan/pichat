/**
 * Background shell processes (dev servers, long runners).
 * Termux-friendly: nohup + log file + pid tracking on app session.
 */
import { ConfigManager } from '../../utils/ConfigManager.js';
import { AcodeTerminalAgent } from './AcodeTerminalAgent.js';

const TAG = '[BackgroundProc]';

function allowed() {
  const v = ConfigManager.get('agentAllowBackground');
  if (v === null || v === undefined) return true;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function store(app) {
  if (!app._bgProcesses) app._bgProcesses = [];
  return app._bgProcesses;
}

function nextId(app) {
  app._bgSeq = (app._bgSeq || 0) + 1;
  return `bg_${app._bgSeq}_${Date.now().toString(36)}`;
}

async function shell(command) {
  return AcodeTerminalAgent.runShellCommand(command, true);
}

export class BackgroundProcessAgent {
  static getToolsSchema() {
    return [
      {
        name: 'background_start',
        description:
          'Start a long-running command in the background (e.g. dev server: python -m http.server 8080). ' +
          'Returns an id + pid. Use background_log to read output, background_kill to stop. ' +
          'Prefer this over run_command for servers that must keep running.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: {
              type: 'STRING',
              description: 'Shell command to run in background'
            },
            label: {
              type: 'STRING',
              description: 'Optional short label (e.g. "http-server")'
            }
          },
          required: ['command']
        }
      },
      {
        name: 'background_list',
        description: 'List background processes started in this session (id, pid, command, status).',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'background_log',
        description: 'Read the last lines of a background process log file.',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', description: 'Process id from background_start' },
            lines: { type: 'NUMBER', description: 'Tail lines (default 40, max 200)' }
          },
          required: ['id']
        }
      },
      {
        name: 'background_kill',
        description: 'Stop a background process by id (SIGTERM then SIGKILL).',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', description: 'Process id from background_start' }
          },
          required: ['id']
        }
      }
    ];
  }

  static async executeTool(functionCall, app) {
    const name = functionCall?.name;
    const args = functionCall?.args || {};

    if (!allowed()) {
      return {
        error: 'Background processes are disabled in Agent Settings (Allow background processes).',
        blocked: true
      };
    }

    if (name === 'background_list') {
      const list = store(app).map(p => ({
        id: p.id,
        pid: p.pid,
        label: p.label,
        command: p.command,
        logFile: p.logFile,
        startedAt: p.startedAt,
        alive: p.alive !== false
      }));
      return { success: true, processes: list, count: list.length };
    }

    if (name === 'background_start') {
      const command = String(args.command || '').trim();
      if (!command) return { error: 'Missing command' };
      if (/\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)/i.test(command) || /rm\s+-rf/i.test(command)) {
        return { error: 'Refusing dangerous background command', blocked: true };
      }

      const id = nextId(app);
      const logFile = `/tmp/aicode_${id}.log`;
      const label = String(args.label || command.slice(0, 40));

      // Start with nohup; print PID
      const starter =
        `mkdir -p /tmp; ` +
        `nohup sh -c ${JSON.stringify(command)} > ${JSON.stringify(logFile)} 2>&1 & ` +
        `echo $!`;

      let res;
      try {
        res = await shell(starter);
      } catch (e) {
        return { error: e?.message || String(e) };
      }

      const out = String(res?.stdout || res?.output || res?.message || '');
      const pidMatch = out.match(/(\d+)\s*$/m) || out.match(/(\d+)/);
      const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;

      if (!pid || !Number.isFinite(pid)) {
        return {
          success: false,
          error: 'Could not capture PID. stdout: ' + out.slice(0, 300),
          raw: res
        };
      }

      const entry = {
        id,
        pid,
        command,
        label,
        logFile,
        startedAt: Date.now(),
        alive: true
      };
      store(app).push(entry);
      console.log(TAG, 'started', id, 'pid', pid, command.slice(0, 60));

      return {
        success: true,
        id,
        pid,
        logFile,
        label,
        message: `Started background process ${id} (pid ${pid}). Use background_log / background_kill.`
      };
    }

    if (name === 'background_log') {
      const id = String(args.id || '').trim();
      const lines = Math.min(200, Math.max(5, Number(args.lines) || 40));
      const entry = store(app).find(p => p.id === id);
      if (!entry) return { error: `Unknown process id: ${id}. Call background_list.` };

      const cmd = `tail -n ${lines} ${JSON.stringify(entry.logFile)} 2>/dev/null || echo "(no log yet)"`;
      let res;
      try {
        res = await shell(cmd);
      } catch (e) {
        return { error: e?.message || String(e), id };
      }
      const text = String(res?.stdout || res?.output || '').slice(0, 12000);
      return { success: true, id, pid: entry.pid, log: text };
    }

    if (name === 'background_kill') {
      const id = String(args.id || '').trim();
      const entry = store(app).find(p => p.id === id);
      if (!entry) return { error: `Unknown process id: ${id}` };

      const cmd =
        `kill ${entry.pid} 2>/dev/null; sleep 0.3; ` +
        `kill -9 ${entry.pid} 2>/dev/null; ` +
        `echo killed`;
      try {
        await shell(cmd);
      } catch (_) {}
      entry.alive = false;
      console.log(TAG, 'killed', id, entry.pid);
      return { success: true, id, pid: entry.pid, message: `Killed ${id} (pid ${entry.pid})` };
    }

    return { error: `Unknown tool: ${name}` };
  }
}
