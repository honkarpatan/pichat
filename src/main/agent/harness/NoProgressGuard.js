/**
 * Detect stuck agent loops — OpenCode-style.
 *
 * Progressive section reads (1–100, then 101–200) are progress, not loops.
 * Force-finish only when the *exact same* read range is hammered repeatedly.
 * Plan tools (todo_write) are not treated as file re-reads.
 * Successful mutations reset nudge counters so earlier explores don't burn the budget.
 */
const TAG = '[NoProgress]';

/** Explore / inspect — not mutations */
const EXPLORE = new Set([
  'read', 'list_directory', 'grep', 'glob', 'tool_search',
  'web_search', 'fetch_content', 'get_diagnostics', 'answer_informational_query'
]);

/** Plan updates — allowed to repeat without counting as a read-loop */
const PLAN_ONLY = new Set(['todo_write']);

const READ_ONLY = new Set([...EXPLORE, ...PLAN_ONLY]);

const MUTATING = new Set([
  'write', 'str_replace', 'edit_file_lines', 'create_or_update_file', 'search_replace_edit',
  'delete_item', 'create_folder', 'create_file_tree', 'rename_path', 'move_path', 'copy_path',
  'update_project_memory', 'run_command', 'run_shell_command', 'codemode', 'apply_patch', 'multi_edit'
]);

/** Consecutive identical *read* batches before hard stop */
const SAME_READ_FORCE_AFTER = 3;
/** Same exact range seen this many times (non-consecutive) before hard stop */
const SAME_RANGE_FORCE_AFTER = 3;
/** Soft nudge after this many steps with no mutation (progressive reads still allowed) */
const READ_CHURN_NUDGE_AT = 8;
/** Hard stop after this many steps with no mutation at all */
const NO_MUTATION_FORCE_AT = 18;

export function createNoProgressState() {
  return {
    recentBatches: [],
    pathErrors: new Map(),
    stepsWithoutMutation: 0,
    identicalBatchCount: 0,
    lastMutationStep: 0,
    readPathCounts: new Map(), // "file#start-end" -> count
    readOnlyStreak: 0,
    editNudgesGiven: 0,
    identicalReadStreak: 0 // consecutive identical *explore* batches only
  };
}

function batchKey(functionCalls) {
  try {
    return JSON.stringify(
      (functionCalls || []).map(f => ({
        n: f.name,
        a: f.args
          ? {
              path: f.args.path || f.args.url || undefined,
              // Line ranges matter: read 1–100 ≠ read 100–250 (progressive section reads)
              start_line: f.args.start_line ?? f.args.startLine ?? undefined,
              end_line: f.args.end_line ?? f.args.endLine ?? undefined,
              offset: f.args.offset ?? undefined,
              limit: f.args.limit ?? undefined,
              pattern: f.args.pattern,
              command: f.args.command ? String(f.args.command).slice(0, 80) : undefined,
              search: f.args.search ? String(f.args.search).slice(0, 40) : undefined
            }
          : {}
      }))
    );
  } catch (_) {
    return String(Date.now());
  }
}

/** Exact read fingerprint including range — only identical ranges count as re-read */
function readRangeKey(f) {
  if (!f || f.name !== 'read') return null;
  const p = f.args?.path || f.args?.url || '';
  const base = String(p).split(/[/\\]/).filter(Boolean).pop() || String(p);
  const a = f.args || {};
  const sl = a.start_line ?? a.startLine ?? '';
  const el = a.end_line ?? a.endLine ?? '';
  return `${base.toLowerCase()}#${sl}-${el}`;
}

function isReadOnlyBatch(functionCalls) {
  const list = functionCalls || [];
  if (!list.length) return false;
  return list.every(f => READ_ONLY.has(f?.name));
}

function isPlanOnlyBatch(functionCalls) {
  const list = functionCalls || [];
  if (!list.length) return false;
  return list.every(f => PLAN_ONLY.has(f?.name));
}

function isExploreBatch(functionCalls) {
  const list = functionCalls || [];
  if (!list.length) return false;
  // At least one explore tool; no mutations; plan-only alone doesn't count
  const names = list.map(f => f?.name);
  if (names.every(n => PLAN_ONLY.has(n))) return false;
  return names.every(n => EXPLORE.has(n) || PLAN_ONLY.has(n)) &&
    names.some(n => EXPLORE.has(n));
}

/**
 * Call after each tool batch is planned (before execute).
 */
export function noteToolBatch(state, functionCalls) {
  const key = batchKey(functionCalls);
  const readOnly = isReadOnlyBatch(functionCalls);
  const planOnly = isPlanOnlyBatch(functionCalls);
  const explore = isExploreBatch(functionCalls);

  if (state.recentBatches.length && state.recentBatches[state.recentBatches.length - 1] === key) {
    state.identicalBatchCount = (state.identicalBatchCount || 0) + 1;
  } else {
    state.identicalBatchCount = 0;
  }
  state.recentBatches.push(key);
  if (state.recentBatches.length > 8) state.recentBatches.shift();

  // Track exact read ranges (path + start–end). Section reads 1–100 then 101–250 are NOT duplicates.
  for (const f of functionCalls || []) {
    const rk = readRangeKey(f);
    if (rk) {
      state.readPathCounts.set(rk, (state.readPathCounts.get(rk) || 0) + 1);
    }
  }

  if (readOnly && !planOnly) state.readOnlyStreak = (state.readOnlyStreak || 0) + 1;
  else if (!readOnly) state.readOnlyStreak = 0;

  // --- Plan-only batches (todo_write): soft nudge only, never force-finish ---
  if (planOnly && state.identicalBatchCount >= 1) {
    console.warn(TAG, 'identical plan-only batch', {
      identicalBatchCount: state.identicalBatchCount,
      key
    });
    if (state.identicalBatchCount >= 2) {
      return {
        stuck: true,
        forceFinish: false,
        reason: 'identical_plan',
        nudge:
          '[SYSTEM: You repeated todo_write with the same (or empty) args. Update the plan with real items, or call str_replace/edit_file_lines to apply the next change.]'
      };
    }
    return { stuck: false };
  }

  // --- Explore / read batches ---
  if (state.identicalBatchCount >= 1 && explore) {
    state.identicalReadStreak = (state.identicalReadStreak || 0) + 1;
    const rangeKeys = (functionCalls || []).map(readRangeKey).filter(Boolean);
    const hotRange = rangeKeys.find(k => (state.readPathCounts.get(k) || 0) >= 2);
    const maxRangeHits = rangeKeys.reduce(
      (m, k) => Math.max(m, state.readPathCounts.get(k) || 0),
      0
    );

    // Force-finish ONLY when the exact same read range is hammered (OpenCode-style)
    const forceFinish =
      state.identicalReadStreak >= SAME_READ_FORCE_AFTER ||
      maxRangeHits >= SAME_RANGE_FORCE_AFTER;

    if (hotRange || state.identicalBatchCount >= 1) {
      state.editNudgesGiven = (state.editNudgesGiven || 0) + 1;
      console.warn(TAG, 'identical explore batch', {
        identicalBatchCount: state.identicalBatchCount,
        identicalReadStreak: state.identicalReadStreak,
        editNudgesGiven: state.editNudgesGiven,
        hotRange: hotRange || null,
        maxRangeHits,
        forceFinish,
        key
      });
      return {
        stuck: true,
        forceFinish,
        reason: forceFinish ? 'read_loop' : 'identical_read',
        nudge: hotRange
          ? `[SYSTEM: You already ran the exact same read (${hotRange}) repeatedly. Do NOT repeat that range. Either read a *different* section (new start_line/end_line) or apply edits with str_replace/edit_file_lines now. Prefer grep to locate symbols before another full-range read.]`
          : `[SYSTEM: You repeated the exact same explore call. Change line range, use grep, or apply the edit with str_replace/edit_file_lines.]`
      };
    }
  } else {
    state.identicalReadStreak = 0;
  }

  // Mutating tools repeated identically — more aggressive finish
  if (state.identicalBatchCount >= 1 && !readOnly) {
    if (state.identicalBatchCount >= 2) {
      return {
        stuck: true,
        forceFinish: state.identicalBatchCount >= 3,
        reason: 'identical_batch',
        nudge:
          state.identicalBatchCount >= 3
            ? '[SYSTEM: No progress — the same tool calls repeated 3 times. Call finish_task with what is done and what is blocked.]'
            : '[SYSTEM: You repeated the same tool batch. Change arguments or approach.]'
      };
    }
  }

  // Non-consecutive cycle of same explore batch in recent window
  const tail = state.recentBatches.slice(-5);
  const hits = tail.filter(k => k === key).length;
  if (hits >= 3 && explore) {
    const rangeKeys = (functionCalls || []).map(readRangeKey).filter(Boolean);
    const maxRangeHits = rangeKeys.reduce(
      (m, k) => Math.max(m, state.readPathCounts.get(k) || 0),
      0
    );
    const forceFinish = maxRangeHits >= SAME_RANGE_FORCE_AFTER;
    state.editNudgesGiven = (state.editNudgesGiven || 0) + 1;
    return {
      stuck: true,
      forceFinish,
      reason: 'cycling_reads',
      nudge:
        '[SYSTEM: Read/explore cycle detected. Do NOT list or re-read the same range. Prefer grep, or apply edits with str_replace/edit_file_lines now.]'
    };
  }
  if (hits >= 3 && !readOnly) {
    return {
      stuck: true,
      forceFinish: true,
      reason: 'cycling_batches',
      nudge:
        '[SYSTEM: Tool-call cycle detected. Call finish_task explaining the blocker.]'
    };
  }

  return { stuck: false };
}

/**
 * Call after tools execute.
 */
export function noteToolResults(state, step, functionCalls, results) {
  let mutated = false;
  const list = results || [];
  for (let i = 0; i < (functionCalls || []).length; i++) {
    const fc = functionCalls[i];
    const res = list[i];
    const path = fc?.args?.path || fc?.args?.url || res?.path || '';
    if (MUTATING.has(fc?.name) && res && !res.error && !res.rejected && !res.dryRun) {
      mutated = true;
    }
    if (res?.error && path) {
      const k = String(path).toLowerCase();
      state.pathErrors.set(k, (state.pathErrors.get(k) || 0) + 1);
      if (state.pathErrors.get(k) >= 3) {
        return {
          stuck: true,
          forceFinish: false,
          reason: 'path_errors',
          nudge:
            `[SYSTEM: Path "${String(path).slice(0, 80)}" failed ${state.pathErrors.get(k)} times. Try a different path or finish_task. Do not retry the same path.]`
        };
      }
    }
  }

  if (mutated) {
    state.stepsWithoutMutation = 0;
    state.lastMutationStep = step;
    state.readOnlyStreak = 0;
    // OpenCode-style: successful edit resets explore-nudge budget so earlier
    // todo_write / section reads don't force-finish a later legitimate re-read.
    state.editNudgesGiven = 0;
    state.identicalReadStreak = 0;
  } else {
    state.stepsWithoutMutation = (state.stepsWithoutMutation || 0) + 1;
  }

  // Progressive section reads are progress — soft nudge only after several explore steps
  if (state.stepsWithoutMutation >= READ_CHURN_NUDGE_AT && state.stepsWithoutMutation < NO_MUTATION_FORCE_AT) {
    const ranges = [...state.readPathCounts.keys()].slice(0, 6);
    return {
      stuck: true,
      forceFinish: false,
      reason: 'read_churn',
      nudge: ranges.length
        ? `[SYSTEM: ${state.stepsWithoutMutation} steps with no file edits. Ranges already read: ${ranges.join('; ')}. If you have enough context, apply the change with str_replace/edit_file_lines now. Prefer grep to find a symbol. Only read a *new* line range if still needed.]`
        : `[SYSTEM: ${state.stepsWithoutMutation} steps with no file edits. Call str_replace/edit_file_lines/write to apply the user request.]`
    };
  }

  if (state.stepsWithoutMutation >= NO_MUTATION_FORCE_AT) {
    return {
      stuck: true,
      forceFinish: true,
      reason: 'no_mutation',
      nudge:
        `[SYSTEM: ${NO_MUTATION_FORCE_AT} steps with no file mutations. Call finish_task summarizing what blocked you, or make one concrete write/edit now.]`
    };
  }

  return { stuck: false };
}

export const NoProgressGuard = {
  createNoProgressState,
  noteToolBatch,
  noteToolResults
};
