import { runCodemode } from '../codemode/CodemodeRunner.js';

export class CodemodeAgent {
  static getToolsSchema() {
    return [
      {
        name: 'codemode',
        description:
          'Run a short async JavaScript snippet with an injected tools API (batch many reads/edits in one card). ' +
          'Available: await tools.read(path), tools.list_directory(path), tools.glob(pattern), tools.grep({pattern,path}), ' +
          'tools.write({path,content}), tools.str_replace({path,search,replace}), tools.edit_file_lines(...), ' +
          'tools.delete_item(path), tools.create_folder(path), tools.fetch_content(url), tools.log(...). ' +
          'No require/import/eval. Prefer for multi-step file inspection/edits in one shot.',
        parameters: {
          type: 'OBJECT',
          properties: {
            code: {
              type: 'STRING',
              description: 'Async JS body using await tools.* — do not wrap in async function'
            }
          },
          required: ['code']
        }
      }
    ];
  }

  static async executeTool(functionCall, app) {
    if (functionCall?.name !== 'codemode') {
      return { error: `Unknown tool: ${functionCall?.name}` };
    }
    const code = functionCall?.args?.code;
    if (!code || !String(code).trim()) {
      return { error: 'Missing code argument for codemode' };
    }
    const live = app?.chatHandler?.liveUI;
    const logId = `codemode-${Date.now()}`;
    try {
      live?.logAgentAction?.({
        id: logId,
        verb: 'Codemode',
        target: `${String(code).slice(0, 48).replace(/\s+/g, ' ')}…`,
        status: 'running',
        fcName: 'codemode'
      });
    } catch (_) {}

    const result = await runCodemode(app, code, {
      onCall: ({ tool, callCount }) => {
        try {
          live?.logAgentAction?.({
            id: logId,
            verb: 'Codemode',
            target: `${tool} · ${callCount} calls`,
            status: 'running',
            fcName: 'codemode'
          });
        } catch (_) {}
      }
    });

    try {
      live?.logAgentAction?.({
        id: logId,
        verb: result.success ? 'Codemode done' : 'Codemode failed',
        target: result.success
          ? `${result.callCount || 0} calls`
          : String(result.error || 'error').slice(0, 60),
        status: result.success ? 'done' : 'error',
        fcName: 'codemode'
      });
    } catch (_) {}

    // Trim large payloads for model context
    if (result.calls?.length) {
      result.calls = result.calls.map(c => ({
        tool: c.tool,
        ok: c.ok,
        error: c.error || undefined,
        args: c.args
          ? Object.fromEntries(
              Object.entries(c.args).map(([k, v]) => [
                k,
                typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v
              ])
            )
          : undefined
      }));
    }
    return result;
  }
}
