/**
 * Parent-only tool: spawn explore/general subagent.
 */
import { runSubAgent } from '../main/SubAgentRunner.js';

/** Pull simple action-like lines from explore report for parent todo_write */
function extractSuggestedTodos(report, max = 8) {
  const text = String(report || '');
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const todos = [];
  for (const line of lines) {
    // numbered or bullet findings that look actionable
    let m = line.match(/^(?:\d+[.)]|[-*•])\s+(.+)/);
    const body = m ? m[1] : line;
    if (body.length < 12 || body.length > 160) continue;
    if (/^(error|failed|aborted)/i.test(body)) continue;
    if (/\b(should|need to|fix|add|update|create|implement|remove|refactor)\b/i.test(body) || m) {
      todos.push({ text: body.slice(0, 140), status: 'pending' });
    }
    if (todos.length >= max) break;
  }
  return todos;
}


export const SUBAGENT_TOOL = 'subagent';

export class SubAgentTool {
  static getToolsSchema() {
    return [
      {
        name: SUBAGENT_TOOL,
        description:
          'REQUIRED when the user says "use a subagent", "subagent", or asks to explore the project without editing. ' +
          'Spawns a child agent. type=explore is READ-ONLY; type=general can edit. ' +
          'Optional agent="<name>" loads .aicodex/agents/<name>/AGENT.md (custom prompt/tools/model). ' +
          'After explore: if suggestedTodos present, call todo_write then implement as parent.',
        parameters: {
          type: 'OBJECT',
          properties: {
            type: {
              type: 'STRING',
              description: '"explore" (read-only) or "general" (can write). Ignored if agent= custom is readonly.'
            },
            agent: {
              type: 'STRING',
              description: 'Custom agent id from .aicodex/agents/<id>/AGENT.md (e.g. security-review)'
            },
            task: {
              type: 'STRING',
              description: 'What the subagent should accomplish or find'
            },
            tasks: {
              type: "ARRAY",
              description:
                "Optional: up to 3 explore tasks to run in parallel (explore only). Merged reports returned. Ignores task if set.",
              items: {
                type: "STRING",
                description: "One explore task description"
              }
            }
          },
          required: []
        }
      }
    ];
  }

  static async executeTool(functionCall, app) {
    const args = functionCall?.args || {};
    const tasksArr = Array.isArray(args.tasks)
      ? args.tasks.map(t => String(t || '').trim()).filter(Boolean).slice(0, 3)
      : [];
    let task = String(args.task || '').trim();
    if (!task && tasksArr.length === 1) task = tasksArr[0];

    let type = String(args.type || 'explore').toLowerCase();
    if (type !== 'general') type = 'explore';
    let agentDef = null;
    const agentName = String(args.agent || args.agent_name || '').trim();
    try {
      const { getCustomAgent, discoverCustomAgents } = await import('../context/CustomAgentsLoader.js');
      if (agentName) {
        agentDef = await getCustomAgent(agentName);
        if (!agentDef) {
          const available = (await discoverCustomAgents()).map(a => a.id).join(', ') || 'none';
          return {
            success: false,
            error: `Unknown agent "${agentName}". Available: ${available}. Add .aicodex/agents/<name>/AGENT.md`
          };
        }
        type = agentDef.readonly ? 'explore' : 'general';
        console.log('[SubAgentTool] custom agent', agentDef.id, 'readonly=', agentDef.readonly);
      } else {
        // Optional default explore agent from settings
        try {
          const { ConfigManager } = await import('../../utils/ConfigManager.js');
          const def = String(ConfigManager.get('agentDefaultExploreAgent') || '').trim();
          if (def && type === 'explore') {
            agentDef = await getCustomAgent(def);
            if (agentDef) console.log('[SubAgentTool] default explore agent', def);
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[SubAgentTool] custom agent load', e);
    }
    try {
      const { isPlanMode } = await import('../harness/PlanMode.js');
      if (isPlanMode() && type === 'general') {
        type = 'explore';
        if (agentDef) agentDef = { ...agentDef, readonly: true };
        console.log('[SubAgentTool] Plan mode — forced type=explore');
      }
    } catch (_) {}

    // Prevent nested subagents
    if (app?._inSubAgent) {
      return { success: false, error: 'Nested subagents are not allowed' };
    }

    if (!task && !tasksArr.length) {
      return { success: false, error: 'Missing task (or tasks[] for parallel explore)' };
    }

    // Parallel explore (max 3)
    if (tasksArr.length > 1) {
      type = 'explore';
      const liveP = app?.chatHandler?.liveUI;
      const logIdP = `subagent-parallel-${Date.now()}`;
      try {
        app._inSubAgent = true;
        liveP?.logAgentAction?.({
          id: logIdP,
          verb: 'Explore×' + tasksArr.length,
          target: tasksArr.map(t => t.slice(0, 20)).join(' | '),
          status: 'running',
          fcName: 'subagent'
        });
        const results = await Promise.all(
          tasksArr.map(t => runSubAgent({ app, type: 'explore', task: t, agentDef, onProgress: () => {} }))
        );
        const merged = results
          .map((r, i) => `### Explore ${i + 1}: ${tasksArr[i].slice(0, 80)}\n${r.report || r.error || ''}`)
          .join('\n\n')
          .slice(0, 24000);
        liveP?.logAgentAction?.({
          id: logIdP,
          verb: 'Explored×' + tasksArr.length,
          target: tasksArr.length + ' reports',
          status: results.some(r => r.success) ? 'done' : 'error',
          fcName: 'subagent'
        });
        return {
          success: results.some(r => r.success),
          type: 'explore',
          parallel: true,
          count: tasksArr.length,
          report: merged,
          message: merged,
          results: results.map(r => ({ success: !!r.success, steps: r.steps }))
        };
      } finally {
        app._inSubAgent = false;
      }
    }

    const live = app?.chatHandler?.liveUI;
    // One work-log row for the whole subagent run (Explore → Explored in place)
    const logId = `subagent-${type}-${Date.now()}`;
    try {
      app._inSubAgent = true;
      live?.logAgentAction?.({
        id: logId,
        verb: agentDef ? `Agent:${agentDef.id}` : (type === 'explore' ? 'Explore' : 'Subagent'),
        target: task.slice(0, 72),
        status: 'running',
        fcName: 'subagent'
      });

      const result = await runSubAgent({
        app,
        type,
        task,
        agentDef,
        onProgress: ({ step }) => {
          try {
            live?.updateAssistantMessage?.(true, `Subagent ${type} · step ${step}…`);
            // same id → title can stay "Explore" while running
            live?.logAgentAction?.({
              id: logId,
              verb: type === 'explore' ? 'Explore' : 'Subagent',
              target: `${task.slice(0, 48)} · step ${step}`,
              status: 'running',
              fcName: 'subagent'
            });
          } catch (_) {}
        }
      });

      live?.logAgentAction?.({
        id: logId,
        verb: agentDef ? `Agent:${agentDef.id}` : (type === 'explore' ? 'Explored' : 'Subagent done'),
        target: task.slice(0, 72),
        status: result.success ? 'done' : 'error',
        fcName: 'subagent'
      });

      const suggestedTodos = type === 'explore'
        ? extractSuggestedTodos(result.report)
        : [];
      return {
        success: !!result.success,
        type,
        agent: agentDef?.id || null,
        steps: result.steps,
        actions: result.actions,
        report: result.report,
        structured: result.structured || null,
        message: result.report,
        // Plan ↔ subagent bridge: parent should todo_write then execute
        suggestedTodos,
        planHint: type === 'explore'
          ? (suggestedTodos.length
            ? 'Call todo_write with suggestedTodos (or refine them), then implement as parent.'
            : 'If the report lists work items, call todo_write then implement as parent — do not re-explore the same files.')
          : undefined
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    } finally {
      app._inSubAgent = false;
      try { live?.updateAssistantMessage?.(false, ''); } catch (_) {}
    }
  }
}
