/**
 * M3 — Agent phase machine + escalation ladder (OpenCode-style).
 *
 * EXPLORE → IMPLEMENT → FORCE_WRITE → FINALIZE
 *
 * mutate intent: short explore budget, then mutate-only tools, then graceful summary (no silent kill).
 */

const TAG = '[PhaseController]';

export const PHASE = {
  EXPLORE: 'explore',
  IMPLEMENT: 'implement',
  FORCE_WRITE: 'force_write',
  VERIFY: 'verify',
  FINALIZE: 'finalize',
  DONE: 'done'
};

const EXPLORE_TOOLS = new Set([
  'read', 'read_file', 'list_directory', 'glob', 'grep', 'outline', 'todo_write',
  'tool_search', 'subagent', 'web_search', 'fetch_content'
]);

const MUTATE_TOOLS = new Set([
  'str_replace', 'edit_file_lines', 'write', 'create_or_update_file',
  'search_replace_edit', 'apply_patch', 'multi_edit', 'update_project_memory',
  'delete_item', 'rename_path', 'move_path', 'copy_path'
]);

/** Mutate-only allowlist when forcing implementation */
export const MUTATE_ONLY_ALLOWLIST = [
  'str_replace',
  'edit_file_lines',
  'write',
  'update_project_memory',
  'finish_task',
  'ask_user_question',
  'answer_informational_query'
];

/**
 * @param {{ kind?: string }} intent
 */
export function createPhaseState(intent = {}, profile = null) {
  const kind = intent.kind || 'mixed';
  // explore steps without mutation before first nudge / force
  // Profile (M6) can tighten budgets for flash-class models.
  let exploreBudget =
    kind === 'mutate' ? 3 :
    kind === 'readonly' ? 99 :
    6;
  let maxForceWriteAttempts = 1;
  let forceAfterExploreExtra = 2;
  let modelProfileId = 'default';

  if (profile) {
    if (kind === 'mutate' && profile.exploreBudgetMutate != null) {
      exploreBudget = profile.exploreBudgetMutate;
    } else if (kind === 'readonly' && profile.exploreBudgetReadonly != null) {
      exploreBudget = profile.exploreBudgetReadonly;
    } else if (kind !== 'mutate' && kind !== 'readonly' && profile.exploreBudgetMixed != null) {
      exploreBudget = profile.exploreBudgetMixed;
    }
    if (profile.maxForceWriteAttempts != null) maxForceWriteAttempts = profile.maxForceWriteAttempts;
    if (profile.forceAfterExploreExtra != null) forceAfterExploreExtra = profile.forceAfterExploreExtra;
    if (profile.id) modelProfileId = profile.id;
  }

  return {
    phase: PHASE.EXPLORE,
    kind,
    exploreBudget,
    exploreSteps: 0,
    implementSteps: 0,
    forceWriteAttempts: 0,
    maxForceWriteAttempts,
    forceAfterExploreExtra,
    modelProfileId,
    mutated: false,
    nudgeSent: false,
    forceArmed: false,
    finalizeRequested: false,
    lastPhaseLog: ''
  };
}

export function isExploreOnlyBatch(functionCalls = []) {
  if (!functionCalls.length) return false;
  return functionCalls.every(f => EXPLORE_TOOLS.has(f?.name));
}

export function batchHasMutation(functionCalls = []) {
  return functionCalls.some(f => MUTATE_TOOLS.has(f?.name));
}

/**
 * Call after each model step's tool list is known.
 * @returns {{ phase, forceToolUse, inject?, finalize?, allowlist? }}
 */
export function notePhaseStep(state, { step, functionCalls, hasMutated } = {}) {
  if (!state || state.phase === PHASE.DONE || state.phase === PHASE.FINALIZE) {
    return { phase: state?.phase || PHASE.DONE, forceToolUse: false };
  }

  if (hasMutated || batchHasMutation(functionCalls)) {
    state.mutated = true;
    state.exploreSteps = 0;
    if (state.phase === PHASE.EXPLORE || state.phase === PHASE.FORCE_WRITE) {
      state.phase = PHASE.IMPLEMENT;
    }
    state.forceArmed = false;
    return { phase: state.phase, forceToolUse: false };
  }

  const exploreOnly = isExploreOnlyBatch(functionCalls);
  const empty = !functionCalls?.length;

  if (state.kind === 'readonly') {
    return { phase: state.phase, forceToolUse: false };
  }

  if (exploreOnly || (empty && state.phase === PHASE.EXPLORE)) {
    if (exploreOnly) state.exploreSteps += 1;
  }

  // Ladder step 1: nudge once at budget
  if (
    !state.mutated &&
    state.exploreSteps >= state.exploreBudget &&
    !state.nudgeSent &&
    state.phase === PHASE.EXPLORE
  ) {
    state.nudgeSent = true;
    state.phase = PHASE.IMPLEMENT;
    state.forceArmed = true;
    const inject =
      state.kind === 'readonly'
        ? '[SYSTEM: If you have enough context, call answer_informational_query. Do not keep reading.]'
        : '[SYSTEM: Explore budget used (phase→implement). Do NOT read/list/grep/outline again. Apply the user change NOW with str_replace or edit_file_lines (or write for a new file), then finish_task.]';
    console.log(TAG, 'nudge→implement', { step, exploreSteps: state.exploreSteps, budget: state.exploreBudget });
    return {
      phase: state.phase,
      forceToolUse: true,
      allowlist: MUTATE_ONLY_ALLOWLIST,
      inject
    };
  }

  // Already nudged / in implement but still no mutation after another explore-ish step
  if (
    !state.mutated &&
    state.nudgeSent &&
    state.forceWriteAttempts < state.maxForceWriteAttempts &&
    state.exploreSteps >= state.exploreBudget + 1
  ) {
    state.phase = PHASE.FORCE_WRITE;
    state.forceWriteAttempts += 1;
    state.forceArmed = true;
    console.log(TAG, 'arm force_write', { step, attempts: state.forceWriteAttempts });
    return {
      phase: state.phase,
      forceToolUse: true,
      allowlist: MUTATE_ONLY_ALLOWLIST,
      inject:
        '[SYSTEM: FORCE WRITE. Tools are limited to edit/write only. Call str_replace or edit_file_lines now. If blocked, call finish_task with what you could not change.]',
      runForceWritePass: true
    };
  }

  // Force already tried — graceful finalize
  if (
    !state.mutated &&
    state.forceWriteAttempts >= state.maxForceWriteAttempts &&
    state.exploreSteps >= state.exploreBudget + (state.forceAfterExploreExtra != null ? state.forceAfterExploreExtra : 2)
  ) {
    state.phase = PHASE.FINALIZE;
    state.finalizeRequested = true;
    console.log(TAG, 'finalize (no mutation)', { step });
    return {
      phase: state.phase,
      forceToolUse: false,
      finalize: true,
      reason: 'explore_budget',
      inject:
        '[SYSTEM: Tools disabled for this final message. Briefly summarize what you learned, what blocked you from editing, and the exact next edit the user should approve. Do not call tools.]'
    };
  }

  // Stay in implement with force tools if armed — re-inject edit demand each step
  if (state.forceArmed && !state.mutated) {
    return {
      phase: state.phase,
      forceToolUse: true,
      allowlist: MUTATE_ONLY_ALLOWLIST,
      inject:
        '[SYSTEM: Still no file edit. Call str_replace or edit_file_lines NOW on the target path. Do not read/grep/outline.]'
    };
  }

  return { phase: state.phase, forceToolUse: false };
}

export function phaseLabel(state) {
  if (!state) return '';
  const p = state.phase || '';
  if (p === PHASE.EXPLORE) {
    return `Exploring ${Math.min(state.exploreSteps, state.exploreBudget)}/${state.exploreBudget}`;
  }
  if (p === PHASE.IMPLEMENT) return 'Implementing';
  if (p === PHASE.FORCE_WRITE) return 'Forced edit pass';
  if (p === PHASE.FINALIZE) return 'Summarizing';
  if (p === PHASE.VERIFY) return 'Verifying';
  return p;
}

export function stopReasonForPhase(reason) {
  if (reason === 'explore_budget') return 'explore_budget';
  if (reason === 'force_write_failed') return 'force_write_failed';
  return reason || 'no_mutation';
}
