# M0 baseline fixtures

Run each prompt in **Agent mode** with the same model you use for daily work (e.g. `qwen/qwen3.7-flash`).  
Collect console lines matching **`[RunTrace]`**.

## What to copy from console

```
[RunTrace] start { toolsLoaded, deferredLoaded, hasMutateTools, toolCount, userHead }
[RunTrace] step  { step, toolsLoaded, hasMutateTools, toolsCalled, compacted, mutated }
[RunTrace] compact { step, beforeTokens, afterTokens, dropped }
[RunTrace] end    { reason, firstMutationStep, mutations, compactions, baseline }
```

### Baseline sheet (fill after each run)

| # | Prompt | hasMutateTools @step0 | firstMutationStep | mutations | compactions | end reason |
|---|--------|----------------------|-------------------|-----------|-------------|------------|
| F1 | (below) | | | | | |
| F2 | | | | | | |
| F3 | | | | | | |
| F4 | | | | | | |
| F5 | | | | | | |

---

## F1 — Mutate / enhance (RC2 + read loop)

**Prompt:**
```text
enhance pokemon list and other styles in existing html
```

**Expect (today / pre-M1):**  
- `hasMutateTools: false` at start possible (enhance not in preload regex).  
- Many `toolsCalled: ["read"]`.  
- `firstMutationStep: null`, `reason` includes `no_mutation` / `read_loop`.  
- `compactions >= 1` on long runs.

**Expect after M1:**  
- `hasMutateTools: true` at start.  
- `firstMutationStep <= 6`.

---

## F2 — Explicit edit verb (preload should work)

**Prompt:**
```text
edit index.html to add a red border on the body
```

**Expect:**  
- `hasMutateTools: true` at step 0 (regex matches `edit`).  
- Ideally `firstMutationStep <= 4`.

---

## F3 — Readonly (must not force write)

**Prompt:**
```text
what does index.html do? summarize structure only, do not edit files
```

**Expect:**  
- May or may not load mutate tools.  
- `mutations: 0` is OK.  
- Should end via `answer_informational_query` or text, not long read-only grind if possible.

---

## F4 — Targeted fix

**Prompt:**
```text
fix the typo in the page title in index.html
```

**Expect:**  
- `hasMutateTools: true` (`fix` in regex).  
- `firstMutationStep <= 4`.

---

## F5 — Large-file pressure (compaction)

**Prompt:**
```text
add a comment at the top of index.html: <!-- acodex-m0 -->
```

**Expect:**  
- If file is large / many steps: `[RunTrace] compact` appears.  
- After compact, watch whether the same ranges are re-read (RC1).  
- `firstMutationStep` should still be small if tools loaded.

---

## Pass criteria for M0 (instrumentation only)

- [ ] Every agent run prints `[RunTrace] start` with `toolsLoaded` array.  
- [ ] Every step prints `[RunTrace] step` with `toolsCalled` + `hasMutateTools`.  
- [ ] Compaction prints `[RunTrace] compact` when it runs.  
- [ ] Run end prints `[RunTrace] end` with `baseline.firstMutationStep`.  
- [ ] F1–F5 table filled once for baseline numbers.
