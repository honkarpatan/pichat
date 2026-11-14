/**
 * M0 — Run trace: structured per-step logs for baseline / RC verification.
 * Console only (no UI). Search logs for [RunTrace].
 */

const TAG = '[RunTrace]';

export function createRunTrace(meta = {}) {
  return {
    runId: meta.runId || `run-${Date.now()}`,
    startedAt: Date.now(),
    model: meta.model || '',
    userHead: String(meta.userHead || '').slice(0, 120),
    maxSteps: meta.maxSteps || 0,
    steps: [],
    compactions: 0,
    mutations: 0,
    firstMutationStep: null
  };
}

/** Names from provider tool schema (CORE + deferred loaded). */
export function toolNamesFromSchema(tools) {
  const names = new Set();
  if (!Array.isArray(tools)) return [];
  for (const t of tools) {
    if (!t) continue;
    if (t.function?.name) names.add(t.function.name);
    if (Array.isArray(t.functionDeclarations)) {
      for (const d of t.functionDeclarations) {
        if (d?.name) names.add(d.name);
      }
    }
    // Anthropic-style
    if (t.name && t.input_schema) names.add(t.name);
  }
  return [...names].sort();
}

export function hasMutateTools(toolNames) {
  const set = new Set(toolNames || []);
  return (
    set.has('str_replace') ||
    set.has('edit_file_lines') ||
    set.has('write') ||
    set.has('create_or_update_file') ||
    set.has('search_replace_edit') ||
    set.has('apply_patch') ||
    set.has('multi_edit')
  );
}

/**
 * Log start of agent run (step 0 / pre-loop).
 */
export function logRunStart(trace, { tools, deferredLoaded, phase } = {}) {
  if (!trace) return;
  const toolNames = toolNamesFromSchema(tools);
  const deferred = Array.isArray(deferredLoaded) ? deferredLoaded : [];
  const row = {
    step: 0,
    phase: phase || 'start',
    toolsLoaded: toolNames,
    deferredLoaded: deferred,
    hasMutateTools: hasMutateTools(toolNames),
    compacted: false
  };
  try {
    console.log(TAG, 'start', {
      runId: trace.runId,
      model: trace.model,
      maxSteps: trace.maxSteps,
      userHead: trace.userHead,
      toolsLoaded: toolNames,
      deferredLoaded: deferred,
      hasMutateTools: row.hasMutateTools,
      toolCount: toolNames.length
    });
  } catch (_) {}
  return row;
}

/**
 * Log one agent step (after model returns / tools known).
 */
export function logStep(trace, info = {}) {
  if (!trace) return info;
  const toolNames = info.toolsLoaded || toolNamesFromSchema(info.tools);
  const called = (info.toolsCalled || []).map(n => String(n || '')).filter(Boolean);
  const mutated = !!(info.mutated || called.some(n =>
    /^(write|str_replace|edit_file_lines|create_or_update_file|search_replace_edit|apply_patch|multi_edit|delete_item|update_project_memory)$/.test(n)
  ));
  if (mutated) {
    trace.mutations = (trace.mutations || 0) + 1;
    if (trace.firstMutationStep == null) trace.firstMutationStep = info.step;
  }
  if (info.compacted) trace.compactions = (trace.compactions || 0) + 1;

  const row = {
    step: info.step,
    phase: info.phase || 'explore',
    toolsLoaded: toolNames,
    hasMutateTools: hasMutateTools(toolNames),
    toolsCalled: called,
    textLen: info.textLen ?? 0,
    textHead: String(info.textHead || '').slice(0, 80),
    finishReason: info.finishReason || null,
    compacted: !!info.compacted,
    compactTokens: info.compactTokens || null,
    mutated,
    forceToolUse: !!info.forceToolUse
  };
  try {
    console.log(TAG, 'step', row);
  } catch (_) {}
  try {
    if (trace.steps.length < 80) trace.steps.push(row);
  } catch (_) {}
  return row;
}

export function logCompact(trace, { beforeTokens, afterTokens, dropped, step } = {}) {
  if (!trace) return;
  trace.compactions = (trace.compactions || 0) + 1;
  try {
    console.log(TAG, 'compact', {
      step,
      beforeTokens,
      afterTokens,
      dropped,
      runId: trace.runId
    });
  } catch (_) {}
}

export function logRunEnd(trace, reason = 'done') {
  if (!trace) return;
  const elapsed = Date.now() - (trace.startedAt || Date.now());
  try {
    console.log(TAG, 'end', {
      runId: trace.runId,
      reason,
      elapsedMs: elapsed,
      steps: (trace.steps || []).length,
      compactions: trace.compactions || 0,
      mutations: trace.mutations || 0,
      firstMutationStep: trace.firstMutationStep,
      // M0 baseline fields — copy from console for fixtures
      baseline: {
        firstMutationStep: trace.firstMutationStep,
        mutations: trace.mutations || 0,
        compactions: trace.compactions || 0,
        reason
      }
    });
  } catch (_) {}
}

export const RunTrace = {
  createRunTrace,
  toolNamesFromSchema,
  hasMutateTools,
  logRunStart,
  logStep,
  logCompact,
  logRunEnd
};
