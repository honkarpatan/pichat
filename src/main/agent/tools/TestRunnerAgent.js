/**
 * run_tests — detect and run common test/build commands in the project.
 */
import { getProjectFolder, listDir, normalizeSafUrl, joinSafPath, readFile } from '../../utils/file/fileOperations.js';
import { AcodeTerminalAgent } from './AcodeTerminalAgent.js';

const TAG = '[TestRunner]';

async function fileExists(projectUri, rel) {
  try {
    const r = await readFile(normalizeSafUrl(joinSafPath(projectUri, rel)), 'utf-8');
    return !!(r?.success);
  } catch (_) {
    return false;
  }
}

async function detectCommand(projectUri) {
  // package.json scripts
  try {
    const r = await readFile(normalizeSafUrl(joinSafPath(projectUri, 'package.json')), 'utf-8');
    if (r?.success && r.content) {
      const pkg = JSON.parse(r.content);
      const scripts = pkg.scripts || {};
      if (scripts.test) return { cmd: 'npm test', reason: 'package.json scripts.test' };
      if (scripts['test:unit']) return { cmd: 'npm run test:unit', reason: 'package.json scripts.test:unit' };
      if (scripts.check) return { cmd: 'npm run check', reason: 'package.json scripts.check' };
    }
  } catch (_) {}

  if (await fileExists(projectUri, 'pytest.ini') || await fileExists(projectUri, 'pyproject.toml')) {
    return { cmd: 'python -m pytest -q', reason: 'pytest config' };
  }
  if (await fileExists(projectUri, 'manage.py')) {
    return { cmd: 'python manage.py test', reason: 'Django manage.py' };
  }
  if (await fileExists(projectUri, 'gradlew')) {
    return { cmd: './gradlew test', reason: 'gradlew' };
  }
  if (await fileExists(projectUri, 'build.gradle') || await fileExists(projectUri, 'build.gradle.kts')) {
    return { cmd: 'gradle test', reason: 'gradle' };
  }
  if (await fileExists(projectUri, 'Cargo.toml')) {
    return { cmd: 'cargo test', reason: 'Cargo.toml' };
  }
  if (await fileExists(projectUri, 'go.mod')) {
    return { cmd: 'go test ./...', reason: 'go.mod' };
  }
  if (await fileExists(projectUri, 'Makefile')) {
    try {
      const r = await readFile(normalizeSafUrl(joinSafPath(projectUri, 'Makefile')), 'utf-8');
      if (r?.content && /\btest\s*:/m.test(r.content)) {
        return { cmd: 'make test', reason: 'Makefile test target' };
      }
    } catch (_) {}
  }

  // Heuristic: list root for *test*
  try {
    const listed = await listDir(normalizeSafUrl(projectUri));
    const names = (listed?.entries || []).map(e => e.name || e);
    if (names.some(n => /test/i.test(String(n)))) {
      return { cmd: null, reason: 'test-like paths found but no runner config', hint: 'Add package.json "test" script or pass command explicitly.' };
    }
  } catch (_) {}

  return { cmd: null, reason: 'No test runner detected', hint: 'Pass args.command explicitly, e.g. "npm test".' };
}

export class TestRunnerAgent {
  static getToolsSchema() {
    return [
      {
        name: 'run_tests',
        description:
          'Detect and run project tests (npm test, pytest, gradle, cargo, go test, make test). ' +
          'Optional command overrides auto-detect. Returns truncated stdout/stderr. Requires terminal permission.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: {
              type: 'STRING',
              description: 'Optional shell command to run instead of auto-detect'
            },
            timeout_sec: {
              type: 'NUMBER',
              description: 'Max seconds to wait (default 120)'
            }
          }
        }
      }
    ];
  }

  static async executeTool(functionCall, app) {
    if (functionCall?.name !== 'run_tests') {
      return { error: `Unknown tool: ${functionCall?.name}` };
    }
    const args = functionCall.args || {};
    const project = await getProjectFolder();
    if (!project?.uri) {
      return { success: false, error: 'No project folder open' };
    }

    let cmd = typeof args.command === 'string' && args.command.trim() ? args.command.trim() : null;
    let detect = null;
    if (!cmd) {
      detect = await detectCommand(project.uri);
      cmd = detect.cmd;
    }
    if (!cmd) {
      return {
        success: false,
        error: detect?.reason || 'No test command',
        hint: detect?.hint || 'Pass command explicitly',
        detected: detect
      };
    }

    const timeoutSec = Math.min(300, Math.max(15, Number(args.timeout_sec) || 120));
    console.log(TAG, 'running', cmd, 'timeout', timeoutSec);

    // Reuse terminal agent
    const fc = {
      name: 'run_command',
      args: {
        command: cmd,
        timeout: timeoutSec
      },
      id: functionCall.id || 'run_tests'
    };

    let result;
    try {
      // Prefer registry path for MutationGate
      const { ToolRegistry } = await import('../../core/tools/ToolRegistry.js');
      ToolRegistry.loadTools?.(app, ['run_command']);
      result = await ToolRegistry.executeTool(fc, app);
    } catch (e) {
      try {
        result = await AcodeTerminalAgent.executeTool(fc);
      } catch (e2) {
        return { success: false, error: e2?.message || e?.message || String(e2) };
      }
    }

    const out = {
      success: !(result && result.error),
      command: cmd,
      detected: detect || undefined,
      result
    };
    if (result?.error) out.error = result.error;
    return out;
  }
}
