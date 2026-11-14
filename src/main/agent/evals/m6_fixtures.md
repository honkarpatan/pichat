# M6 — Model profiles + eval gate

## Model profiles

`harness/ModelProfiles.js` shortens explore / advances force-write for flash-class models.

| Profile | Match | explore mutate | force extra |
|---------|-------|----------------|-------------|
| qwen_flash | qwen*flash / qwen3 | 2 | +1 |
| gemini_flash | gemini*flash | 3 | +2 |
| claude / gpt | claude, gpt-4… | 4 | +3 |
| default | other | 3 | +2 |

Console: `[ModelProfile] { model, profile, exploreMutate, … }`

## Eval gate

```js
import { evaluateFixture, evaluateAll, printEvalReport, EVAL_FIXTURES } from './EvalGate.js';

// After a run, pass the [RunTrace] end object:
evaluateFixture('F1_enhance_mutate', {
  hasMutateToolsAtStart: true,
  firstMutationStep: 3,
  mutations: 2,
  reason: 'finish_task'
});
```

Fixtures F1–F5 mirror `m0_fixtures.md` prompts with **hard gates** for merge checks.

### Acceptance (M6)

- [ ] Flash model on F1: `hasMutateTools: true`, `firstMutationStep ≤ 6`
- [ ] `[ModelProfile] profile: qwen_flash` (or matching family) on start
- [ ] Readonly F3: `mutations: 0`
- [ ] `evaluateAll` all green before treating harness change as done
