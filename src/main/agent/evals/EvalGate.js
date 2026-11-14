/**
 * M6 — Lightweight eval gate over RunTrace end snapshots.
 * Not a CI runner: call evaluateFixture(fixtureId, endPayload) after a run
 * or from console tests. Failures are structured for merge checks.
 */

/** @typedef {{ id: string, prompt: string, intent?: string, expect: object }} EvalFixture */

/** @type {EvalFixture[]} */
export const EVAL_FIXTURES = [
  {
    id: 'F1_enhance_mutate',
    prompt: 'enhance pokemon list and other styles in existing html',
    intent: 'mutate',
    expect: {
      hasMutateToolsAtStart: true,
      firstMutationStepMax: 6,
      endReasonNot: ['no_mutation', 'read_loop'],
      minMutations: 1
    }
  },
  {
    id: 'F2_edit_verb',
    prompt: 'edit index.html to add a red border on the body',
    intent: 'mutate',
    expect: {
      hasMutateToolsAtStart: true,
      firstMutationStepMax: 4,
      minMutations: 1
    }
  },
  {
    id: 'F3_readonly',
    prompt: 'what does index.html do? summarize structure only, do not edit files',
    intent: 'readonly',
    expect: {
      minMutations: 0,
      maxMutations: 0,
      // must not force-write path
      endReasonNot: ['force_write_exhausted']
    }
  },
  {
    id: 'F4_targeted_fix',
    prompt: 'fix the typo in the page title in index.html',
    intent: 'mutate',
    expect: {
      hasMutateToolsAtStart: true,
      firstMutationStepMax: 5,
      minMutations: 1
    }
  },
  {
    id: 'F5_create_file',
    prompt: 'create demo_note.txt with the text hello',
    intent: 'mutate',
    expect: {
      hasMutateToolsAtStart: true,
      firstMutationStepMax: 3,
      minMutations: 1
    }
  }
];

/**
 * @param {string} fixtureId
 * @param {{
 *   hasMutateTools?: boolean,
 *   firstMutationStep?: number|null,
 *   mutations?: number,
 *   reason?: string,
 *   endReason?: string,
 *   baseline?: object
 * }} endTrace  from [RunTrace] end / logRunEnd payload
 * @returns {{ pass: boolean, fixtureId: string, failures: string[], expect: object, got: object }}
 */
export function evaluateFixture(fixtureId, endTrace = {}) {
  const fixture = EVAL_FIXTURES.find(f => f.id === fixtureId);
  if (!fixture) {
    return { pass: false, fixtureId, failures: [`unknown fixture ${fixtureId}`], expect: {}, got: endTrace };
  }
  const e = fixture.expect || {};
  const failures = [];
  const reason = String(endTrace.reason || endTrace.endReason || '');
  const mutations = Number(endTrace.mutations ?? endTrace.baseline?.mutations ?? 0);
  const firstMut = endTrace.firstMutationStep != null
    ? Number(endTrace.firstMutationStep)
    : (endTrace.baseline?.firstMutationStep != null ? Number(endTrace.baseline.firstMutationStep) : null);
  const hasMut = endTrace.hasMutateToolsAtStart != null
    ? !!endTrace.hasMutateToolsAtStart
    : (endTrace.hasMutateTools != null ? !!endTrace.hasMutateTools : null);

  if (e.hasMutateToolsAtStart === true && hasMut === false) {
    failures.push('hasMutateToolsAtStart expected true');
  }
  if (e.firstMutationStepMax != null && e.minMutations !== 0) {
    if (firstMut == null || Number.isNaN(firstMut)) {
      failures.push(`firstMutationStep missing (want ≤ ${e.firstMutationStepMax})`);
    } else if (firstMut > e.firstMutationStepMax) {
      failures.push(`firstMutationStep ${firstMut} > max ${e.firstMutationStepMax}`);
    }
  }
  if (e.minMutations != null && mutations < e.minMutations) {
    failures.push(`mutations ${mutations} < min ${e.minMutations}`);
  }
  if (e.maxMutations != null && mutations > e.maxMutations) {
    failures.push(`mutations ${mutations} > max ${e.maxMutations}`);
  }
  if (Array.isArray(e.endReasonNot)) {
    for (const bad of e.endReasonNot) {
      if (reason && reason.toLowerCase().includes(String(bad).toLowerCase())) {
        failures.push(`end reason contains banned "${bad}": ${reason}`);
      }
    }
  }

  return {
    pass: failures.length === 0,
    fixtureId,
    failures,
    expect: e,
    got: {
      hasMutateToolsAtStart: hasMut,
      firstMutationStep: firstMut,
      mutations,
      reason
    }
  };
}

/** Evaluate all fixtures that have a result map fixtureId → endTrace */
export function evaluateAll(resultsById = {}) {
  const rows = EVAL_FIXTURES.map((f) => {
    if (!(f.id in resultsById)) {
      return { pass: false, fixtureId: f.id, failures: ['not run'], expect: f.expect, got: {} };
    }
    return evaluateFixture(f.id, resultsById[f.id]);
  });
  const pass = rows.every(r => r.pass);
  return { pass, rows, passed: rows.filter(r => r.pass).length, total: rows.length };
}

/** Console helper */
export function printEvalReport(report) {
  try {
    console.log('[EvalGate]', report.pass ? 'PASS' : 'FAIL', `${report.passed}/${report.total}`);
    for (const r of report.rows || []) {
      if (r.pass) console.log('[EvalGate] ✓', r.fixtureId);
      else console.warn('[EvalGate] ✗', r.fixtureId, r.failures);
    }
  } catch (_) {}
}
