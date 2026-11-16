/**
 * Pi engine settings.
 *
 * PURE module: only imports ConfigManager, so it is safe to import from the
 * settings schema (no circular imports with the agent code).
 *
 * Keys (all stored through ConfigManager, same as every other setting):
 *   agentEngine         'aichat' (default) | 'pi'
 *   piToolProfile       'minimal' | 'standard' (default) | 'full'
 *   piToolExecution     'sequential' (default) | 'parallel'
 *   piFollowUpMode      'after' (default) | 'inloop'
 *   piMaxIdenticalCalls number, default 4
 *   piContextBudget     number (tokens), default 28000
 *   piSystemPromptExtra string appended to the Pi system prompt
 */
import { ConfigManager } from '../utils/ConfigManager.js';

function str(key, def) {
  try {
    const v = ConfigManager.get(key);
    if (v === null || v === undefined || v === '' || v === 'null') return def;
    return String(v);
  } catch (_) {
    return def;
  }
}

function num(key, def, min, max) {
  try {
    const n = parseFloat(ConfigManager.get(key));
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  } catch (_) {
    return def;
  }
}

export function getAgentEngine() {
  return str('agentEngine', 'aichat').toLowerCase() === 'pi' ? 'pi' : 'aichat';
}

/** Pi only replaces the AGENT loop. Normal chat / study mode keep the default path. */
export function isPiEngineActive(app, config) {
  return getAgentEngine() === 'pi' && !!app?.isEnableAgentMode && !!config?.supportsTools;
}

export function readPiSettings() {
  const profile = str('piToolProfile', 'standard').toLowerCase();
  return {
    toolProfile: ['minimal', 'standard', 'full'].includes(profile) ? profile : 'standard',
    toolExecution: str('piToolExecution', 'sequential').toLowerCase() === 'parallel' ? 'parallel' : 'sequential',
    followUpMode: str('piFollowUpMode', 'after').toLowerCase() === 'inloop' ? 'inloop' : 'after',
    maxIdenticalCalls: Math.round(num('piMaxIdenticalCalls', 4, 2, 10)),
    contextBudget: Math.round(num('piContextBudget', 28000, 8000, 120000)),
    maxTurns: Math.round(num('agentMaxSteps', 50, 5, 120)),
    extraPrompt: str('piSystemPromptExtra', '')
  };
}

/** Children of the "Pi Agent Settings" sub-page. */
export const piSettingsSchema = [
  { type: 'header', label: 'Pi engine' },
  {
    type: 'info',
    label:
      'Active only when **Agent engine = Pi** and the Agent toggle is on. ' +
      'Pi uses a minimal loop: the model keeps calling tools until it answers in plain text. ' +
      'No forced tool use, no finish_task, no nudges. Permissions, undo, plan card, workspace lock and queues still work.'
  },
  {
    type: 'select',
    key: 'piToolProfile',
    label: 'Tool profile',
    description: 'minimal = Pi core tools only. standard = core + plan, ask, web, skills, memory, git, file ops. full = every registered tool.',
    options: [
      { label: 'Minimal (Pi core)', value: 'minimal' },
      { label: 'Standard (recommended)', value: 'standard' },
      { label: 'Full (all tools)', value: 'full' }
    ],
    default: 'standard'
  },
  {
    type: 'select',
    key: 'piToolExecution',
    label: 'Tool execution',
    description: 'Sequential runs one tool at a time. Parallel runs a batch concurrently only when every call is read-only.',
    options: [
      { label: 'Sequential (default)', value: 'sequential' },
      { label: 'Parallel (read-only batches)', value: 'parallel' }
    ],
    default: 'sequential'
  },
  {
    type: 'select',
    key: 'piFollowUpMode',
    label: 'Follow-up messages',
    description: 'after = existing flow runs queued follow-ups as new turns once Pi finishes. inloop = Pi consumes them itself inside the same run.',
    options: [
      { label: 'After finish (existing flow)', value: 'after' },
      { label: 'In loop (Pi-native)', value: 'inloop' }
    ],
    default: 'after'
  },
  {
    type: 'range',
    key: 'piMaxIdenticalCalls',
    label: 'Repeat-call guard',
    description: 'Block the same tool call (same args) after this many repeats, until a file change happens.',
    min: 2, max: 10, step: 1, default: 4
  },
  {
    type: 'range',
    key: 'piContextBudget',
    label: 'Context budget',
    description: 'Compact old tool results when the working context exceeds this many tokens.',
    min: 8000, max: 120000, step: 2000, default: 28000, unit: 'tokens'
  },
  {
    type: 'textarea',
    key: 'piSystemPromptExtra',
    label: 'Extra Pi instructions',
    description: 'Appended to the Pi system prompt (like Pi\'s APPEND_SYSTEM). Leave empty for none.',
    placeholder: 'e.g. Always use 2-space indentation.',
    default: ''
  }
];

/** Fields shown in AI Chat Settings (top level). Spread this into chatHandlerSettingsSchema. */
export const agentEngineFields = [
  { type: 'header', label: 'Agent engine' },
  {
    type: 'select',
    key: 'agentEngine',
    label: 'Agent mechanism',
    description:
      'AiChat default = the built-in agent. Pi = the Pi harness mechanism (separate engine). ' +
      'Applies to the next Agent-mode message.',
    options: [
      { label: 'AiChat default', value: 'aichat' },
      { label: 'Pi', value: 'pi' }
    ],
    default: 'aichat'
  },
  {
    type: 'page',
    label: 'Pi Agent Settings',
    description: 'Tool profile, execution mode, context budget',
    children: piSettingsSchema
  }
];
