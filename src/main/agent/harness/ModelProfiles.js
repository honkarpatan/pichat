/**
 * M6 — Model family profiles (secondary to PhaseController L1–L4).
 * Tune explore budget / force-write timing for weaker or faster models.
 *
 * Colors / UI are unrelated — this only affects agent harness pacing.
 */

const TAG = '[ModelProfile]';

/**
 * @typedef {Object} ModelProfile
 * @property {string} id
 * @property {string} label
 * @property {(id: string) => boolean} match
 * @property {number} exploreBudgetMutate   steps of pure explore before force path
 * @property {number} exploreBudgetMixed
 * @property {number} exploreBudgetReadonly
 * @property {number} maxForceWriteAttempts
 * @property {number} forceAfterExploreExtra  finalize if still no mutation after budget+extra
 * @property {number} compactKeepTail
 * @property {number} compactMaxExtraMsgs
 * @property {string} [notes]
 */

/** @type {ModelProfile[]} */
export const MODEL_PROFILES = [
  {
    id: 'qwen_flash',
    label: 'Qwen Flash',
    match: (id) => /qwen.*flash|qwen3\.?[578]-?flash|qwen\/qwen3/i.test(id),
    exploreBudgetMutate: 2,
    exploreBudgetMixed: 4,
    exploreBudgetReadonly: 40,
    maxForceWriteAttempts: 1,
    forceAfterExploreExtra: 1,
    compactKeepTail: 12,
    compactMaxExtraMsgs: 14,
    notes: 'Shorter explore, earlier force-write — flash models drift into read loops.'
  },
  {
    id: 'qwen_coder',
    label: 'Qwen Coder',
    match: (id) => /qwen.*coder|qwen2\.5-coder|qwq/i.test(id),
    exploreBudgetMutate: 3,
    exploreBudgetMixed: 5,
    exploreBudgetReadonly: 60,
    maxForceWriteAttempts: 1,
    forceAfterExploreExtra: 2,
    compactKeepTail: 12,
    compactMaxExtraMsgs: 16,
    notes: 'Slightly more explore than flash; still force early on mutate.'
  },
  {
    id: 'gemini_flash',
    label: 'Gemini Flash',
    match: (id) => /gemini/i.test(id),
    exploreBudgetMutate: 3,
    exploreBudgetMixed: 5,
    exploreBudgetReadonly: 50,
    maxForceWriteAttempts: 1,
    forceAfterExploreExtra: 2,
    compactKeepTail: 14,
    compactMaxExtraMsgs: 16,
    notes: 'All Gemini ids (incl. 2.5 Flash & bare provider type). Rate-limit sensitive — short explore on mutate.'
  },
  {
    id: 'claude',
    label: 'Claude',
    match: (id) => /claude|anthropic|sonnet|opus|haiku/i.test(id),
    exploreBudgetMutate: 4,
    exploreBudgetMixed: 8,
    exploreBudgetReadonly: 99,
    maxForceWriteAttempts: 1,
    forceAfterExploreExtra: 3,
    compactKeepTail: 14,
    compactMaxExtraMsgs: 18,
    notes: 'Strong tool use — default-ish budgets.'
  },
  {
    id: 'gpt',
    label: 'OpenAI GPT',
    match: (id) => /gpt-4|gpt-5|o1|o3|o4|chatgpt/i.test(id),
    exploreBudgetMutate: 4,
    exploreBudgetMixed: 8,
    exploreBudgetReadonly: 99,
    maxForceWriteAttempts: 1,
    forceAfterExploreExtra: 3,
    compactKeepTail: 14,
    compactMaxExtraMsgs: 18,
    notes: 'Default budgets.'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    match: (id) => /mistral|mixtral|codestral|devstral/i.test(id),
    exploreBudgetMutate: 3,
    exploreBudgetMixed: 5,
    exploreBudgetReadonly: 50,
    maxForceWriteAttempts: 1,
    forceAfterExploreExtra: 2,
    compactKeepTail: 12,
    compactMaxExtraMsgs: 16,
    notes: 'Medium explore; watch large-context drift.'
  }
];

/** Safe defaults when no family matches */
export const DEFAULT_MODEL_PROFILE = {
  id: 'default',
  label: 'Default',
  match: () => true,
  exploreBudgetMutate: 3,
  exploreBudgetMixed: 6,
  exploreBudgetReadonly: 99,
  maxForceWriteAttempts: 1,
  forceAfterExploreExtra: 2,
  compactKeepTail: 10,
  compactMaxExtraMsgs: 16,
  notes: 'Baseline PhaseController budgets.'
};

/**
 * Resolve profile from model id / OpenRouter slug / display name.
 * @param {string} modelId
 * @returns {ModelProfile}
 */
export function resolveModelProfile(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return { ...DEFAULT_MODEL_PROFILE };
  for (const p of MODEL_PROFILES) {
    try {
      if (p.match(id)) return { ...p };
    } catch (_) {}
  }
  return { ...DEFAULT_MODEL_PROFILE };
}

/**
 * Apply profile numbers onto a phase state (from createPhaseState).
 * @param {object} state
 * @param {ModelProfile} profile
 */
export function applyProfileToPhaseState(state, profile) {
  if (!state || !profile) return state;
  const kind = state.kind || 'mixed';
  if (kind === 'mutate') state.exploreBudget = profile.exploreBudgetMutate;
  else if (kind === 'readonly') state.exploreBudget = profile.exploreBudgetReadonly;
  else state.exploreBudget = profile.exploreBudgetMixed;

  state.maxForceWriteAttempts = profile.maxForceWriteAttempts ?? 1;
  state.forceAfterExploreExtra = profile.forceAfterExploreExtra ?? 2;
  state.modelProfileId = profile.id;
  return state;
}

export function logModelProfile(profile, modelId) {
  try {
    console.log(TAG, {
      model: String(modelId || '').slice(0, 80),
      profile: profile?.id,
      exploreMutate: profile?.exploreBudgetMutate,
      exploreMixed: profile?.exploreBudgetMixed,
      forceExtra: profile?.forceAfterExploreExtra
    });
  } catch (_) {}
}
