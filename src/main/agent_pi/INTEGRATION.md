# Pi engine (`src/main/agent_pi/`)

A separate agent engine. Nothing in the default agent (`agent/main/AgentLoop.js`, PhaseController,
NoProgressGuard, force-write, nudges, TaskIntent, ModelProfiles) is imported or changed.

## Switch
Settings → AI Chat → **Agent engine → Agent mechanism**: `AiChat default` | `Pi`.
Pi runs only when Agent mode is ON and the model supports tools. Normal chat and Study mode always use the default path.
Pi-specific options live in the **Pi Agent Settings** sub-page (tool profile, tool execution, follow-up mode,
repeat-call guard, context budget, extra instructions).

## How Pi works (same shape as Pi's agent-core)
`prompt → LLM → tool calls? → run tools → results → LLM → …` until the model replies with plain text.
* no finish tool, no forced tool use, no nudges, no phases
* steering messages are checked after every tool call (remaining calls of the batch are skipped)
* follow-ups run after the agent would stop (`After finish` = existing flow, `In loop` = Pi-native)
* `transformContext` hook compacts old tool results before each LLM call
* repeat-call guard: identical call + args is blocked after N repeats until a file change happens
* truncated plain-text replies are continued (max 2x)

## Files
| file | role |
|---|---|
| `PiLoop.js` | pure loop, no plugin imports (unit tested in Node) |
| `PiAgentRunner.js` | `route(app, config, modelType, apiMessages, onChunk)` - same signature as `AgentRunner.route` |
| `PiToolset.js` | which registered tools Pi exposes (minimal / standard / full) + provider tool formatting |
| `PiSystemPrompt.js` | short Pi-style prompt: role, tool list, guidelines, project context, date |
| `PiSettings.js` | settings keys + schema (`agentEngineFields`) |
| `index.js` | exports |

## Reused plumbing (so existing features keep working)
Permissions / patterns / undo / audit / hooks / live UI rows (`executeAndLogTool`), steering + follow-up queues,
compaction + file-knowledge notes, plan mode + approve card, run checkpoints, `FileChangeHistory`,
Read-Before-Edit tracker, SubAgent runtime (`app._agentRuntime`), `ApiKeyManager` failover (errors are re-thrown).

## Hooks in existing files (`pi-hooks.patch`, 16 added lines)
| file | change |
|---|---|
| `handler/ApiRouter.js` | `if (isPiEngineActive(...)) return PiAgentRunner.route(...)` before every other path |
| `settings/schemas/chatHandlerSettings.js` | `...agentEngineFields` (selector + Pi sub-page) |
| `model/SystemPrompt.js` | `getSystemInstruction()` returns the Pi prompt while a Pi run is active (Gemini, Mistral, openai-compatible read it from here) |
| `model/providers/claude.js`, `bedrock.js`, `vertex.js` | skip the default agent prompt while a Pi run is active (they always prepend it when tools exist) |

Other providers read a `role:'system'` message from the transcript, so they need no change.
To remove Pi: revert these hooks and delete the folder.

## Tests
`node src/main/agent_pi/PiLoop.test.mjs` - 12 loop tests, pure Node.

## Known limits
* SubAgent calls made during a Pi run on Gemini/Mistral also see the Pi prompt (harmless, they use their own messages).
* `tool_search` / deferred tools are not used in Pi mode; the profile decides which tools are sent.
