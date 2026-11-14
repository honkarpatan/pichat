/**
 * M1 — lightweight task intent (mutate vs readonly).
 * Full policy table can grow later; this only drives tool preload + force ladder.
 */

const MUTATE_RE =
  /\b(creat|fix|edit|implement|add|refactor|update|write|build|patch|delete|enhance|improv|style|restyle|redesign|make|chang|modif|rewrit|rename|move|copy|remov|replac|polish|beautif|optimiz|migrat)\w*/i;

/** Strong "look only / answer only" signals — win over weak mutate words like "show" */
const READONLY_RE =
  /\b(what (is|are|does)|explain|summar|how does|describe|list (the )?files?|show me|read only|without (edit|chang|writ)|do not (edit|chang|modif|writ)|don'?t (edit|chang|writ)|no (edits?|changes?|writes?)|ranges? only|outline (tool|only)|show (function|class|symbol|ranges?)|do not read the whole|don'?t read the whole|inspect only|analyze only)\b/i;

/**
 * @returns {{ kind: 'mutate'|'readonly'|'mixed', preloadMutate: boolean }}
 */
export function classifyTaskIntent(userText = '') {
  const t = String(userText || '').trim();
  if (!t) return { kind: 'mixed', preloadMutate: false };

  const mutate = MUTATE_RE.test(t);
  const readonly = READONLY_RE.test(t);

  // Explicit no-edit / show-only wins even if a weak mutate verb also matched
  if (readonly && (
    /\b(do not|don'?t|without|no edits?|ranges? only|outline only|read only)\b/i.test(t) ||
    !mutate
  )) {
    return { kind: 'readonly', preloadMutate: false };
  }
  if (readonly && !mutate) return { kind: 'readonly', preloadMutate: false };
  if (mutate) return { kind: 'mutate', preloadMutate: true };

  // Heuristic: pure outline/grep/show structure questions
  if (/\b(outline|structure map|symbol ranges?|function ranges?)\b/i.test(t)
      && !/\b(then |and )?(edit|fix|improv|enhance|chang|writ)/i.test(t)) {
    return { kind: 'readonly', preloadMutate: false };
  }

  return { kind: 'mixed', preloadMutate: false };
}

export function shouldPreloadMutateTools(userText) {
  return classifyTaskIntent(userText).preloadMutate;
}
