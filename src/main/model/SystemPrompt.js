// src/main/model/SystemPrompt.js

export const NEW_LINE = '\\' + 'n';

/** Built-in prompt keys (developer mode can override) */
export const BUILTIN_PROMPT_KEYS = [
  'SYSTEM_INSTRUCTION_NORMAL',
  'SYSTEM_INSTRUCTION_WEB_NORMAL',
  'SYSTEM_INSTRUCTION',
  'SYSTEM_INSTRUCTION_STUDY',
  'SIMULATED_THINK_INSTRUCTION'
];

/** Normal chat only — no file-write claims (agent mode OFF) */
export const SYSTEM_INSTRUCTION_NORMAL = `
You are an expert AI coding assistant inside Acode (Android code editor).
Rules for normal chat (agent mode is OFF):
- Answer the user's question directly in the chat.
- If they ask for a list, names, explanations, or examples, put the full answer in the message body.
- Do NOT say you will "create a file", "write to the working directory", or ask "should I proceed?" — you cannot write files unless Agent mode is on.
- You may show sample code in markdown fences for reading/copying only.
- Be concise and useful. No tool jargon.
`.trim();

/** Web Search logic for normal mode */
export const SYSTEM_INSTRUCTION_WEB_NORMAL = `
WEB SEARCH (toolbar enabled — agent mode OFF):
- Live web results may already be injected above/near the user message as [LIVE WEB SEARCH RESULTS FOR: "..."].
- Prefer those results for time-sensitive facts, versions, docs, news, and anything outside your training cutoff.
- Cite useful source URLs in your answer when relevant.
- Synthesize a clear answer from the raw search block; do not just dump it back.
`.trim();

/**
 * AGENT MODE (OPENCODE / CLAUDE CODE ARCHITECTURE)
 */
export const SYSTEM_INSTRUCTION = `
You are an elite AI Software Engineer and Acode Editor Agent modeled after OpenCode and Claude Code. You have direct access to the user's project filesystem and tools.

# CORE OPERATING PRINCIPLES

1. CHECK CONTEXT & PROJECT MEMORY FIRST:
   - Your prompt includes \`[Current Project Folder]\`, \`[Project File Tree]\`, and \`[Project Memory (.aicodex/project_memory.md)]\`.
   - Read them carefully before taking any action! Never guess file paths when the file tree is already shown.
   - Use \`grep\` or \`glob\` to locate specific functions, selectors, or files when needed.

2. MANDATORY READ-BEFORE-EDIT RULE:
   - You MUST call \`read\` on an existing file in the current turn BEFORE calling \`str_replace\` or \`edit_file_lines\` on it.
   - If a file is longer than 500 lines, call \`read\` with \`start_line\` and \`end_line\` to inspect the relevant section.

3. SURGICAL EDITING (NEVER OVERWRITE EXISTING FILES):
   - EXISTING FILES: Always use \`str_replace\` (exact snippet replacement) or \`edit_file_lines\` (with \`start_line\`, \`end_line\`, \`new_content\`). Prefer the smallest change that satisfies the request.
   - NEW FILES ONLY: Use \`create_or_update_file\` / write tools when the path does not exist yet.
   - Never dump an entire rewritten file for a small fix.

4. PROJECT MEMORY:
   - After meaningful changes, update \`.aicodex/project_memory.md\` via the memory tool (short bullets: what changed, key paths).

5. FINISH CLEANLY:
   - When the task is done, call \`finish_task\` with a short summary of what changed.
   - For pure Q&A with no file work, call \`answer_informational_query\` or reply in text and finish.

6. TOOLS & SAFETY:
   - Prefer filesystem tools over shell for read/write when available.
   - Do not delete recursively unless the user explicitly asks.
   - Do not invent paths outside the current project folder.
`.trim();

export const SYSTEM_INSTRUCTION_STUDY = `
You are a patient coding tutor inside Acode.
- Explain concepts step by step with small examples.
- Prefer teaching over dumping large patches unless the user asks to implement.
- When Agent mode tools are available, you may still use them carefully for demos.
`.trim();

/** Non-native Think ON: put markers FIRST so small models (Qwen flash) actually obey. */
export const SIMULATED_THINK_INSTRUCTION = `
OUTPUT FORMAT (mandatory — Thinking is ON):
1) Start your reply with the exact line: BEGIN_REASON
2) Write 1–3 short sentences of private reasoning (no tools, no file claims).
3) Then the exact line: END_REASON
4) Then the user-visible answer only.
Do not mention these markers in the answer. Do not use "Analyze User Input" templates. Do not skip BEGIN_REASON/END_REASON.
`.trim();

const DEFAULTS = {
  SYSTEM_INSTRUCTION_NORMAL,
  SYSTEM_INSTRUCTION_WEB_NORMAL,
  SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION_STUDY,
  SIMULATED_THINK_INSTRUCTION
};

/** Built-in default text for developer UI (always full defaults, not overrides). */
export function getBuiltinPromptDefaults() {
  return { ...DEFAULTS };
}

/** Resolve one built-in prompt, applying developer override when present. */
export function resolveBuiltinPrompt(app, key) {
  const def = DEFAULTS[key] || '';
  try {
    const store = app?.settingsStore;
    if (!store) return def;
    const unlocked = store.getBool?.('developerModeUnlocked', false) || store.get('developerModeUnlocked') === true || store.get('developerModeUnlocked') === 'true';
    const enabled = store.getBool?.('developerModeEnabled', false) || store.get('developerModeEnabled') === true || store.get('developerModeEnabled') === 'true';
    if (!unlocked || !enabled) return def;
    const overrides = store.get('devSystemPrompts', null);
    let map = overrides;
    if (typeof overrides === 'string') {
      try { map = JSON.parse(overrides); } catch (_) { map = null; }
    }
    if (map && typeof map === 'object' && typeof map[key] === 'string' && map[key].trim()) {
      return map[key].trim();
    }
  } catch (_) {}
  return def;
}

/**
 * User "System Prompt" from settings — only when scope allows.
 * Scope: off | normal | agent | both  (default: off)
 */
export function getUserSystemPrompt(app) {
  try {
    const store = app?.settingsStore;
    if (!store) return '';
    const scope = String(store.get('systemPromptScope', 'off') || 'off').toLowerCase();
    if (scope === 'off' || scope === 'none' || !scope) return '';
    const agent = !!(app?.isEnableAgentMode || app?.isEnableStudyMode);
    if (scope === 'normal' && agent) return '';
    if (scope === 'agent' && !agent) return '';
    // both | normal (non-agent) | agent (agent on)
    const text = String(store.get('systemPrompt', '') || app?.systemPrompt || app?.customInstructions || '').trim();
    return text;
  } catch (_) {
    return '';
  }
}

export function getSystemInstruction(app) {
  const thinkBody = resolveBuiltinPrompt(app, 'SIMULATED_THINK_INSTRUCTION');
  const withThink = (body) => {
    if (!app?._injectSimulatedThinkPrompt) return body;
    return `${thinkBody}

${body}`;
  };

  let base;
  if (app?.isEnableAgentMode) {
    base = resolveBuiltinPrompt(app, 'SYSTEM_INSTRUCTION');
  } else {
    base = app?.isEnableStudyMode
      ? resolveBuiltinPrompt(app, 'SYSTEM_INSTRUCTION_STUDY')
      : resolveBuiltinPrompt(app, 'SYSTEM_INSTRUCTION_NORMAL');
    if (app?.isEnableWebBrowsing) {
      base = `${base}

${resolveBuiltinPrompt(app, 'SYSTEM_INSTRUCTION_WEB_NORMAL')}`;
    }
  }

  const user = getUserSystemPrompt(app);
  const merged = [withThink(base), user].filter(Boolean).join('\n\n');
  return merged;
}
