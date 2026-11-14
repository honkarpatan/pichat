// src/main/agent/main/AgentPlanning.js
import { ToolRegistry } from '../../core/tools/ToolRegistry.js';

export const PLAN_TOOL_NAME = 'todo_write';
export const FAST_DEBUG_MARKER = 'FAST DEBUG MODE';

/** Short social / ack messages — no tools, one-shot reply */
export function isTrivialChatMessage(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 80) return false;
  // No code/path/tool-looking content
  if (/[`{}<>]|https?:\/\/|\b(read|write|fix|create|delete|explore|implement|refactor|file|folder|project)\b/i.test(t)) {
    return false;
  }
  return /^(thanks|thank you|thx|ty|ok|okay|k|cool|great|nice|good|got it|understood|perfect|awesome|👍|🙏|yes|yep|no|nope|hi|hello|hey|bye|good (?:morning|night|evening)|cheers|np|no problem)[.!\s]*$/i.test(t);
}

export function looksLikeFixRequest(text) {
  const t = typeof text === 'string' ? text : (() => {
    try { return JSON.stringify(text || ''); } catch (_) { return String(text || ''); }
  })();

  // Only treat as pure greenfield build if user explicitly asks to build/create from scratch with NO bug/fix terms
  const hasExplicitFix =
    new RegExp(FAST_DEBUG_MARKER, 'i').test(t) ||
    /Canvas preview error|Uncaught TypeError|Cannot read propert(?:y|ies) of null|addEventListener|is not a function|ReferenceError|SyntaxError/i.test(t) ||
    /\b(fix(?:ing|es)?|debug(?:ging)?|repair|bug|broken|not working|doesn['\u2019]?t work|isn['\u2019]?t working|issue|error|crash(?:es|ed|ing)?|glitch|wrong|problem)\b/i.test(t);

  if (hasExplicitFix) return true;

  if (/\b(from scratch|create a new project|build a new app|build a new game)\b/i.test(t)) {
    return false;
  }

  return /\b(can(?:['\u2019]?t|t) start|cannot start|won(?:['\u2019]?t|t) start|undefined is not|nothing happens|blank screen|won(?:['\u2019]?t|t) load|does not (?:start|run|load|open)|will not (?:start|run|load))\b/i.test(t);
}

export function isFastDebugContext(messagesOrText) {
  if (typeof messagesOrText === 'string') return looksLikeFixRequest(messagesOrText);
  try { return looksLikeFixRequest(JSON.stringify(messagesOrText || '')); } catch (_) { return false; }
}

export function createPlanState() {
  return { hasPlan: false, allDone: false, nudged: false, items: [], justPlanned: false };
}

function isGenericScaffoldPlan(items) {
  const texts = (items || []).map(i => String(i.text || i.task || '').toLowerCase());
  if (!texts.length) return false;
  let hits = 0;
  for (const t of texts) {
    if (/create\s+index\.html|create\s+.*html\s+structure/.test(t)) hits++;
    if (/create\s+style\.css|create\s+.*css/.test(t)) hits++;
    if (/create\s+script\.js|create\s+.*javascript|create\s+js/.test(t)) hits++;
  }
  return hits >= 2;
}

function isVaguePlan(items) {
  const texts = (items || []).map(i => String(i.text || i.task || '').toLowerCase());
  if (!texts.length) return false;
  const vagueHints = [
    /review (?:the )?requirements/,
    /ensure .*(?:clean|functional|working|correct)/,
    /verify (?:the )?implementation/,
    /^check (?:the )?files?/,
    /^(?:review|verify|check|ensure|confirm)\b/
  ];
  const vagueCount = texts.filter(tx => vagueHints.some(re => re.test(tx))).length;
  return vagueCount / texts.length >= 0.5;
}

function isDegradedPlan(items) {
  return isGenericScaffoldPlan(items) || isVaguePlan(items);
}

/** Fuzzy match two plan step texts (model often rephrases slightly). */
function planTextsMatch(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const y = String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 10 && y.includes(x.slice(0, Math.min(28, x.length)))) return true;
  if (y.length >= 10 && x.includes(y.slice(0, Math.min(28, y.length)))) return true;
  const fileRe = /[\w.-]+\.(?:js|ts|jsx|tsx|css|html?|json|md|py)/gi;
  const fx = x.match(fileRe) || [];
  const fy = y.match(fileRe) || [];
  if (fx.length && fy.length && fx.some(f => fy.includes(f))) {
    if (/\b(create|update|edit|fix|enhance|add|write|read|preview|test|verify)\b/i.test(x)
        && /\b(create|update|edit|fix|enhance|add|write|read|preview|test|verify)\b/i.test(y)) {
      return true;
    }
  }
  return false;
}

function normalizeIncomingPlanItems(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((it) => {
      if (it == null) return null;
      if (typeof it === 'string') return { text: it.trim(), status: 'pending' };
      const text = String(it.text || it.task || it.content || it.title || '').trim();
      if (!text) return null;
      let status = String(it.status || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
      if (status === 'completed' || status === 'complete' || status === 'finished') status = 'done';
      if (status === 'running' || status === 'active' || status === 'doing') status = 'in_progress';
      if (!['pending', 'in_progress', 'done'].includes(status)) status = 'pending';
      return { text, status };
    })
    .filter(Boolean);
}

/**
 * Once a plan exists, LOCK the step list.
 * Model may only update statuses. Wholesale new plans mid-turn (common on Qwen)
 * are merged onto the original skeleton so the sticky card does not reset.
 */
function mergeLockedPlan(prevItems, incoming) {
  const prev = (prevItems || []).map(it => ({ ...it }));
  const next = normalizeIncomingPlanItems(incoming);
  if (!prev.length) return next;
  if (!next.length) return prev;

  let matches = 0;
  for (const n of next) {
    if (prev.some(p => planTextsMatch(p.text, n.text))) matches++;
  }
  const overlap = matches / Math.max(prev.length, next.length);

  if (overlap < 0.4) {
    console.warn('[AgentPlanning] Ignoring low-overlap plan rewrite (overlap=', overlap.toFixed(2), ')');
    return prev.map((p) => {
      const hit = next.find(n => planTextsMatch(p.text, n.text));
      if (!hit) return p;
      if (p.status === 'done') return p;
      if (hit.status === 'done' || hit.status === 'in_progress') {
        return { ...p, status: hit.status };
      }
      return p;
    });
  }

  return prev.map((p) => {
    const hit = next.find(n => planTextsMatch(p.text, n.text));
    if (!hit) return p;
    if (p.status === 'done') return p;
    return { ...p, status: hit.status || p.status };
  });
}

export async function handleTodoWrite({ app, fc, safeLogAction, planState, actionsTaken = [] }) {
  let toolResult;
  try {
    toolResult = await ToolRegistry.executeTool(fc);
  } catch (e) {
    toolResult = { error: e.message || String(e) };
  }

  let items = normalizeIncomingPlanItems(toolResult?.items || fc.args?.items || []);

  // Lock: merge into existing plan instead of replacing the card
  if (planState.hasPlan && planState.items?.length) {
    items = mergeLockedPlan(planState.items, items);
  }

  if (planState.hasPlan && planState.items?.length && items.length > 0
      && isDegradedPlan(items) && !isDegradedPlan(planState.items)) {
    items = mergeLockedPlan(planState.items, items);
  }

  if (planState.hasPlan && items.length > 0) {
    const writtenFiles = actionsTaken
      .filter(a => (a.status === 'success' || a.status === 'done') &&
        ['write', 'str_replace', 'create_or_update_file', 'edit_file_lines', 'search_replace_edit', 'update_project_memory'].includes(a.fcName))
      .map(a => String(a.target || a.label || a.fullPath || '').toLowerCase());

    items = items.map((newItem) => {
      if (newItem.status !== 'done') return newItem;
      const oldItem = (planState.items || []).find(i => planTextsMatch(i.text, newItem.text));
      if (oldItem && oldItem.status === 'done') return newItem;

      const taskTxt = String(newItem.text || '').toLowerCase();
      const isMutationTask = /\b(create|write|implement|build|update|edit|change|fix|add|style|refactor|patch|enhance)\b/i.test(taskTxt);
      const isReadTask = /^\s*(read|inspect|analyze|check|find|locate|search)\b/i.test(taskTxt);

      if (isMutationTask && !isReadTask && writtenFiles.length === 0) {
        return { ...newItem, status: oldItem ? oldItem.status : 'in_progress' };
      }
      return newItem;
    });
  }

  // Single in_progress spinner
  {
    let seen = false;
    items = items.map((it) => {
      if (it.status !== 'in_progress') return it;
      if (seen) return { ...it, status: 'pending' };
      seen = true;
      return it;
    });
    if (!seen) {
      const idx = items.findIndex(it => it.status === 'pending');
      if (idx >= 0 && items.some(it => it.status === 'done')) {
        items[idx] = { ...items[idx], status: 'in_progress' };
      }
    }
  }

  if (toolResult) toolResult.items = items;

  planState.hasPlan = true;
  planState.items = items;
  planState.allDone = items.length > 0 && items.every(it => it.status === 'done');

  try {
    app.chatHandler?.liveUI?.logPlanUpdate?.(items);
  } catch (e) {
    console.warn('[AgentPlanning] logPlanUpdate failed', e);
  }
  return { functionResponse: { name: fc.name, id: fc.id, response: toolResult } };
}

const NON_TRIVIAL_HINTS = /\b(add|build|create|implement|integrate|refactor|redesign|migrate|rewrite|fix)\b.{0,40}\b(game|app|feature|module|system|page|component|api|auth|dashboard|bug|error|issue)\b/i;

export function looksNonTrivial(text) {
  const t = String(text || '');
  if (t.length > 180) return true;
  if (NON_TRIVIAL_HINTS.test(t)) return true;
  const fileWordCount = (t.match(/\.(js|ts|jsx|tsx|html|css|py|json)\b/gi) || []).length;
  return fileWordCount >= 2;
}

export function maybeNudgeForPlan({ step, userText, planState, hasAnyWrite }) {
  if (planState.nudged || planState.hasPlan) return null;
  if (step !== 2) return null;
  if (hasAnyWrite) return null;

  const isFix = looksLikeFixRequest(userText);
  if (!isFix && !looksNonTrivial(userText)) return null;

  planState.nudged = true;
  if (isFix) {
    return `[SYSTEM: Call 'todo_write' to list the specific root cause(s) and files you will patch, then apply the fix using 'str_replace' or 'edit_file_lines'.]`;
  }
  return `[SYSTEM: Call 'todo_write' with a short step-by-step plan before modifying files, then update it as you complete each step.]`;
}

/** Extract basename-ish tokens from a write action for plan matching */
function actionFileTokens(a) {
  const raw = String(a.fullPath || a.url || a.label || a.target || a.fcArgs?.path || '');
  const base = raw.split(/[/\\]/).filter(Boolean).pop() || '';
  const tokens = new Set();
  if (base) {
    tokens.add(base.toLowerCase());
    const noExt = base.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    if (noExt) tokens.add(noExt);
  }
  // Also keep last two path segments e.g. js/game.js
  const parts = raw.split(/[/\\]/).filter(Boolean);
  if (parts.length >= 2) {
    tokens.add(`${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase());
  }
  return tokens;
}

function itemMentionsFile(itemText, fileTokens) {
  const t = String(itemText || '').toLowerCase();
  if (!t || !fileTokens?.size) return false;
  for (const tok of fileTokens) {
    if (tok.length >= 3 && t.includes(tok)) return true;
  }
  // Extension-aware: "create style.css" vs style.css
  for (const tok of fileTokens) {
    if (/\.(css|js|html?|ts|jsx|tsx|json|md)$/i.test(tok) && t.includes(tok.replace(/^.*\//, ''))) {
      return true;
    }
  }
  return false;
}

const WRITE_FC = new Set([
  'write', 'str_replace', 'create_or_update_file', 'search_replace_edit',
  'edit_file_lines', 'create_file_tree', 'update_project_memory'
]);
const PREVIEW_FC = new Set(['preview_html']);

function isReadOnlyPlanStep(text) {
  const t = String(text || '').toLowerCase();
  return /^\s*(read|inspect|analyze|review|locate|find|search|list)\b/.test(t)
    && !/\b(create|write|implement|update|edit|fix|add|enhance|refactor|patch)\b/.test(t);
}

function isPreviewPlanStep(text) {
  return /\b(preview|verify|test the|test and)\b/i.test(String(text || ''));
}

/** Compact plan digest for injecting into the agent loop (OpenCode-style). */
export function formatPlanDigest(planState) {
  if (!planState?.hasPlan || !Array.isArray(planState.items) || !planState.items.length) return '';
  const lines = planState.items.map((it, i) => {
    const mark = it.status === 'done' ? 'x' : it.status === 'in_progress' ? '>' : ' ';
    return `${i + 1}. [${mark}] ${it.text || it.task || ''}`;
  });
  const next = planState.items.find(it => it.status !== 'done');
  const focus = next ? `NEXT REQUIRED: "${next.text || next.task}"` : 'All steps done — call finish_task.';
  return `[PLAN STATUS]\n${lines.join('\n')}\n${focus}`;
}

/**
 * OpenCode-style sequential progress:
 * - Only the CURRENT open step may be auto-ticked (never skip 3→5).
 * - A write to game.js must NOT mark every step that mentions game.js.
 * - Tracks processed action count so the same write is not re-applied.
 */
export function markPlanProgressFromWrites(app, planState, actionsTaken = []) {
  if (!planState?.hasPlan || !Array.isArray(planState.items) || !planState.items.length) return false;

  planState._planProgressCursor = planState._planProgressCursor || 0;
  const actions = actionsTaken || [];
  if (actions.length <= planState._planProgressCursor) {
    // Still ensure single in_progress
    return ensureSingleInProgress(app, planState);
  }

  const newActions = actions.slice(planState._planProgressCursor);
  planState._planProgressCursor = actions.length;

  const newWrites = newActions.filter(a =>
    WRITE_FC.has(a.fcName) && (a.status === 'success' || a.status === 'done')
  );
  const newPreview = newActions.some(a =>
    PREVIEW_FC.has(a.fcName) && (a.status === 'success' || a.status === 'done')
  );
  const newReads = newActions.filter(a =>
    (a.fcName === 'read' || a.fcName === 'read_file') && (a.status === 'success' || a.status === 'done')
  );

  if (!newWrites.length && !newPreview && !newReads.length) return false;

  const items = planState.items.map(it => ({ ...it }));
  let changed = false;

  // Index of first non-done step — ONLY this one can advance
  let cur = items.findIndex(it => it.status !== 'done');
  if (cur < 0) {
    planState.allDone = true;
    return false;
  }

  const curText = items[cur].text || items[cur].task || '';

  // Read-only plan step: complete after a successful read
  if (isReadOnlyPlanStep(curText) && newReads.length) {
    items[cur] = { ...items[cur], status: 'done' };
    changed = true;
    cur = items.findIndex(it => it.status !== 'done');
  }

  // Mutation step: only complete CURRENT open step when a NEW write matches its file
  if (cur >= 0 && newWrites.length) {
    const stepText = items[cur].text || items[cur].task || '';
    if (!isReadOnlyPlanStep(stepText) && !isPreviewPlanStep(stepText)) {
      const matched = newWrites.some(a => itemMentionsFile(stepText, actionFileTokens(a)));
      const namesFile = /\.[\w]+|index\.html|\b(html|css|javascript)\b/i.test(stepText);
      // Match by filename, or (no filename in step text) accept write as progress for this step only
      if (matched || !namesFile) {
        items[cur] = { ...items[cur], status: 'done' };
        changed = true;
        cur = items.findIndex(it => it.status !== 'done');
      }
    }
  }

  // Preview/verify step: only when it is the current open step
  if (cur >= 0 && newPreview && isPreviewPlanStep(items[cur].text || items[cur].task || '')) {
    items[cur] = { ...items[cur], status: 'done' };
    changed = true;
  }

  // Promote next pending → in_progress (exactly one)
  for (let i = 0; i < items.length; i++) {
    if (items[i].status === 'in_progress') items[i] = { ...items[i], status: 'pending' };
  }
  const nextIdx = items.findIndex(it => it.status !== 'done');
  if (nextIdx >= 0) {
    if (items[nextIdx].status !== 'in_progress') {
      items[nextIdx] = { ...items[nextIdx], status: 'in_progress' };
      changed = true;
    }
  }

  if (!changed) return false;

  planState.items = items;
  planState.allDone = items.length > 0 && items.every(it => it.status === 'done');

  try {
    app?.chatHandler?.liveUI?.logPlanUpdate?.(items);
  } catch (_) {}

  return true;
}

function ensureSingleInProgress(app, planState) {
  const items = planState.items.map(it => ({ ...it }));
  let changed = false;
  let seen = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].status === 'done') continue;
    if (!seen) {
      if (items[i].status !== 'in_progress') {
        items[i] = { ...items[i], status: 'in_progress' };
        changed = true;
      }
      seen = true;
    } else if (items[i].status === 'in_progress') {
      items[i] = { ...items[i], status: 'pending' };
      changed = true;
    }
  }
  if (!changed) return false;
  planState.items = items;
  try {
    app?.chatHandler?.liveUI?.logPlanUpdate?.(items);
  } catch (_) {}
  return true;
}

/**
 * Only call when EVERY plan step is truly done (or no plan).
 * Never use this to paper over skipped steps.
 */
export function forceCompletePlan(app, planState) {
  if (!planState?.hasPlan || !Array.isArray(planState.items) || !planState.items.length) return false;
  if (planState.allDone) return false;
  // Refuse if any step still open — caller must implement them
  if (planState.items.some(it => it.status !== 'done')) return false;

  planState.allDone = true;
  try {
    app?.chatHandler?.liveUI?.logPlanUpdate?.(planState.items);
  } catch (_) {}
  return true;
}

/**
 * End of agent turn: NEVER auto-complete skipped steps.
 * Only refresh UI and demote stuck spinners back to pending.
 */
export function settlePlanOnTurnEnd(app, planState) {
  if (!planState?.hasPlan || !Array.isArray(planState.items) || !planState.items.length) return;
  if (planState.allDone) {
    try {
      app?.chatHandler?.liveUI?.logPlanUpdate?.(planState.items);
    } catch (_) {}
    return;
  }

  const open = planState.items.some(it => it.status !== 'done');
  if (!open) {
    planState.allDone = true;
    try {
      app?.chatHandler?.liveUI?.logPlanUpdate?.(planState.items);
    } catch (_) {}
    return;
  }

  // Keep incomplete steps visible as pending — do NOT force-tick them
  const items = planState.items.map(it => {
    if (it.status === 'in_progress') return { ...it, status: 'pending' };
    return it;
  });
  // First incomplete stays in_progress for visual continuity
  const firstOpen = items.findIndex(it => it.status !== 'done');
  if (firstOpen >= 0) items[firstOpen] = { ...items[firstOpen], status: 'in_progress' };
  planState.items = items;
  planState.allDone = false;
  try {
    app?.chatHandler?.liveUI?.logPlanUpdate?.(items);
  } catch (_) {}
}