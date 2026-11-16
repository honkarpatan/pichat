// src/main/settings/schemas/chatHandlerSettings.js
import { agentEngineFields } from '../../agent_pi/PiSettings.js';

export const chatHandlerSettingsSchema = [
    { type: 'header', label: 'Conversation Context' },

    {
        type: 'toggle',
        key: 'isShowHistory',
        label: 'Include Chat History',
        description: 'Send earlier messages in this chat along with every new request, so the model remembers the conversation.',
        default: true,
        bind: 'isShowHistory'
    },

    { type: 'subheader', label: 'History Limits' },
    {
        type: 'info',
        label: 'These two limits control how much of your past conversation is resent with every new message — whichever limit is hit first wins. Higher values give the model more memory but cost more tokens per request.'
    },
    {
        type: 'range',
        key: 'historyTokenBudget',
        label: 'History Token Budget',
        description: 'Maximum tokens worth of past messages sent per request.',
        min: 2000,
        max: 52000,
        step: 1000,
        default: 12000,
        unit: 'tokens'
    },
    {
        type: 'range',
        key: 'historyMaxMessages',
        label: 'Max History Messages',
        description: 'Maximum number of past messages considered, even if still under the token budget.',
        min: 5,
        max: 200,
        step: 5,
        default: 60,
        unit: 'msgs'
    },

    { type: 'header', label: 'Instructions' },
    {
        type: 'textarea',
        key: 'systemPrompt',
        label: 'System Prompt',
        placeholder: 'e.g. You are a senior JavaScript engineer. Answer concisely and always show working code.',
        default: '',
        description: 'Custom instruction prepended when the scope below allows it. Works for all providers.'
    },
    {
        type: 'select',
        key: 'systemPromptScope',
        label: 'Add system instruction to',
        description: 'Where your custom System Prompt is sent. Built-in agent/normal instructions are separate. Default: Off.',
        options: [
            { label: 'Off', value: 'off' },
            { label: 'Normal chat', value: 'normal' },
            { label: 'Agent Mode', value: 'agent' },
            { label: 'Both', value: 'both' }
        ],
        default: 'off'
    },

    { type: 'header', label: 'Agent work rows (OC rail)' },
    {
        type: 'select',
        key: 'ocRowCollapseMode',
        label: 'Collapsible tool rows',
        description: 'How Read / Edited / Trying with API key / web search detail panels open. Applies to all new rows automatically.',
        options: [
            { label: 'Collapse (default closed)', value: 'collapse' },
            { label: 'Uncollapse (default open)', value: 'uncollapse' },
            { label: 'Uncollapse when running', value: 'running' },
            { label: 'Remember (closed, keep your toggles)', value: 'remember' }
        ],
        default: 'running'
    },

    { type: 'header', label: 'Markdown display' },
    {
        type: 'select',
        key: 'markdownHeadingStyle',
        label: 'Markdown heading style',
        description: 'Collapsible: headings become expandable sections (like after refresh). Normal: standard markdown headings. Applies live while streaming and on history.',
        options: [
            { label: 'Collapsible headings', value: 'collapsible' },
            { label: 'Normal markdown', value: 'normal' }
        ],
        default: 'collapsible'
    },

    { type: 'header', label: 'Capabilities' },
    {
        type: 'toggle',
        key: 'isShowImg',
        label: 'Show Image Previews',
        description: 'Render image attachments inline inside the chat.',
        default: false,
        bind: 'isShowImg'
    },

    
    {
        type: 'page',
        label: 'Web browsing',
        description: 'Tavily API keys, search limits, Browser 2.0',
        children: [
            {
                type: 'info',
                label:
                    'Browser 2.0 uses **Tavily** search and shows link cards in chat. ' +
                    'Built-in keys work until they run out — then add your own below. ' +
                    'Get a free key: [app.tavily.com](https://app.tavily.com/home)'
            },
            {
                type: 'action',
                label: 'Open Tavily dashboard',
                description: 'Create or copy API keys in the browser',
                buttonText: 'Get API key',
                onClick: async () => {
                    const url = 'https://app.tavily.com/home';
                    try {
                        if (typeof system !== 'undefined' && system.openInBrowser) {
                            system.openInBrowser(url);
                            return;
                        }
                    } catch (_) {}
                    try {
                        if (typeof acode !== 'undefined' && acode.openLink) {
                            acode.openLink(url);
                            return;
                        }
                    } catch (_) {}
                    try {
                        window.open(url, '_blank');
                    } catch (_) {
                        if (typeof window.toast === 'function') window.toast(url, 4000);
                    }
                }
            },
            {
                type: 'toggle',
                key: 'geminiWebMode',
                label: 'Gemini: use Browser 2.0',
                description: 'Off = Gemini built-in web. On = Tavily + link cards (same as other models).',
                default: false
            },
            {
                type: 'header',
                label: 'Tavily API keys'
            },
            {
                type: 'textarea',
                key: 'tavilyApiKeys',
                label: 'Your Tavily API keys',
                description:
                    'One key per line (tvly-…). Used first, then built-in pool. ' +
                    'When built-in keys fail or hit limits, these keep browsing working.',
                placeholder: 'tvly-dev-xxxxxxxx\ntvly-prod-xxxxxxxx',
                default: ''
            },
            {
                type: 'toggle',
                key: 'tavilyPreferUserKeys',
                label: 'Use only my keys (skip built-in)',
                description: 'On = only keys you pasted above. Off = your keys first, then built-in fallback.',
                default: false
            },
            {
                type: 'header',
                label: 'Search limits'
            },
            {
                type: 'select',
                key: 'tavilyMaxResults',
                label: 'Max search results',
                description: 'Hard cap per web_search call (1–10). Adaptive planner will not exceed this.',
                options: [
                    { label: '2 (fast)', value: '2' },
                    { label: '3 (default)', value: '3' },
                    { label: '5', value: '5' },
                    { label: '8', value: '8' },
                    { label: '10 (max)', value: '10' }
                ],
                default: '3'
            },
            {
                type: 'select',
                key: 'tavilyMaxImages',
                label: 'Max image results',
                description: 'When a query asks for images. 0 = never fetch images via Tavily.',
                options: [
                    { label: '0 (disabled)', value: '0' },
                    { label: '1', value: '1' },
                    { label: '3 (default)', value: '3' },
                    { label: '5', value: '5' },
                    { label: '10', value: '10' }
                ],
                default: '3'
            },
            {
                type: 'info',
                label:
                    'Agent mode uses `web_search` only when needed (not for “thanks”). ' +
                    'Optional `fetch_top` loads the best docs URL after search.'
            }
        ]
    },

{ type: 'header', label: 'Canvas preview' },
    {
        type: 'info',
        label: 'HTML previews copy files into app storage (Termux/SAF paths often cannot load multi-file sites in WebView). Console catches runtime JS errors from the preview iframe.'
    },
    {
        type: 'toggle',
        key: 'canvasAutoAskFix',
        label: 'Canvas: notice errors',
        description: 'When the preview console gets a JS error, show Fix / Auto-fix actions (and optionally auto-prompt).',
        default: true
    },
    {
        type: 'toggle',
        key: 'canvasAutoFixSend',
        label: 'Canvas: Auto-fix sends to chat',
        description: 'If on, Auto-fix fills the prompt and presses Send so you do not click Fix repeatedly.',
        default: false
    },
    {
        type: 'toggle',
        key: 'canvasAutoRunAfterAgent',
        label: 'Canvas: run after agent writes HTML',
        description: 'When the agent saves HTML/JS, run a headless preview. Errors show in chat with Fix / Auto-fix.',
        default: true
    },
    {
        type: 'toggle',
        key: 'canvasOpenOnError',
        label: 'Canvas: open panel on preview error',
        description: 'Also open the full canvas UI when the post-agent preview finds errors.',
        default: false
    },
    
    // Agent engine selector (AiChat default | Pi) + Pi settings sub-page
    ...agentEngineFields,

    // 🟢 Agent Mode Settings Sub-page
    {
        type: 'page',
        label: 'Agent Mode Settings',
        description: 'Configure agent limits, timeouts, and security permissions.',
        children: [
            { type: 'header', label: 'Agent Constraints' },
            {
                type: 'toggle',
                key: 'agentDeferredTools',
                label: 'Deferred tools (tool_search)',
                description: 'When on, write/edit/shell tools load via tool_search to save tokens each turn (Pi-style). Coding prompts still preload write tools.',
                default: true
            },
            {
                type: 'range',
                key: 'agentMaxSteps',
                label: 'Max Agent Steps',
                description: 'Maximum number of tool execution loops the agent can perform in a single turn to prevent infinite loops.',
                min: 5, max: 120, step: 1, default: 50
            },
            {
                type: 'range',
                key: 'agentMaxReadLines',
                label: 'File Read Chunk Size',
                description: 'Maximum number of lines the agent can read at once to prevent memory overflow.',
                min: 100, max: 2000, step: 100, default: 500,
                unit: 'lines'
            },
            {
                type: 'range',
                key: 'agentTerminalTimeout',
                label: 'Terminal Timeout',
                description: 'Maximum time allowed for a background shell command to complete.',
                min: 10, max: 120, step: 5, default: 30,
                unit: 'sec'
            },

            { type: 'header', label: 'Project tools (OpenCode-style)' },
            {
                type: 'info',
                label: 'Cursor/Claude keep both file tools and terminal. Prefer FS for writes (less MAX_TOKENS). Terminal-only heredoc often truncates on flash-lite.'
            },
            {
                type: 'select',
                key: 'agentProjectBackend',
                label: 'Project file operations',
                description: 'Terminal (default): shell commands for read/write like OpenCode. Filesystem: native create_or_update_file / search_replace tools. Only one is sent to the model.',
                options: [
                    { label: 'Both FS + Terminal (default, Cursor-style)', value: 'both' },
                    { label: 'Filesystem only (create_or_update_file)', value: 'fs' },
                    { label: 'Terminal only (shell / heredoc)', value: 'terminal' }
                ],
                default: 'both'
            },
            { type: 'header', label: 'Security & Permissions' },
            {
                type: 'select',
                key: 'agentPermissionMode',
                label: 'Agent permission mode',
                description: 'ask = confirm every change; edits = auto write; full = auto all; plan = research only until user Approves.',
                options: [
                    { label: 'Ask (confirm every mutation)', value: 'ask' },
                    { label: 'Allow edits (auto write; ask delete/shell)', value: 'edits' },
                    { label: 'Full access (auto allowed tools)', value: 'full' },
                    { label: 'Plan mode (research only → approve → execute)', value: 'plan' }
                ],
                default: 'ask'
            },
            {
                type: 'select',
                key: 'agentPlanExecuteMode',
                label: 'After plan Approve, run as',
                description: 'Permission mode used when user clicks Approve & execute.',
                options: [
                    { label: 'Edits (auto write; ask delete/shell)', value: 'edits' },
                    { label: 'Ask (confirm each mutation)', value: 'ask' },
                    { label: 'Full access', value: 'full' }
                ],
                default: 'edits'
            },
            {
                type: 'toggle',
                key: 'agentAutoExecuteWrites',
                label: 'Auto-execute Write Actions (legacy)',
                description: 'Legacy toggle. Prefer Agent permission mode above. If mode is unset, this maps to edits when on.',
                default: false
            },
            
            {
                type: 'toggle',
                key: 'agentAllowDelete',
                label: 'Allow File Deletion',
                description: 'Allow the agent to permanently delete files and folders.',
                default: false 
            },
            {
                type: 'toggle',
                key: 'agentAllowTerminal',
                label: 'Allow Terminal Access',
                description: 'Allow the agent to run background shell commands and open the terminal.',
                default: true
            },
            {
                type: 'toggle',
                key: 'agentAllowBackground',
                label: 'Allow background processes',
                description: 'Allow background_start / kill for dev servers and long-running commands.',
                default: true
            },
            {
                type: 'toggle',
                key: 'agentEnableAdvancedEdit',
                label: 'Advanced edit tools (multi_edit / apply_patch)',
                description:
                    'Off (default, best for free-tier): use edit_file_lines + str_replace only — smaller tool schemas, fewer tokens. ' +
                    'On: also expose multi_edit and apply_patch (unified diff) for multi-hunk edits. Needs more max_tokens/credits.',
                default: false
            },
            {
                type: 'toggle',
                key: 'agentFormatOnWrite',
                label: 'Suggest format after edit',
                description: 'After edits, model may note running a formatter if the project has one. Does not auto-run.',
                default: false
            },
            {
                type: 'textarea',
                key: 'agentPermissionAllow',
                label: 'Permission allow patterns',
                description: 'One per line. Examples: run_command(npm test*)  write(*.md)  Also stored in .aicodex/permissions.json via Always allow.',
                default: ''
            },
            {
                type: 'textarea',
                key: 'agentPermissionDeny',
                label: 'Permission deny patterns',
                description: 'Deny wins over allow. Defaults include rm* and delete_item(*) if both lists empty in project file.',
                default: ''
            },
            { type: 'header', label: 'Skills' },
            {
                type: 'textarea',
                key: 'agentSkillsPaths',
                label: 'Skills folders (relative to project)',
                description: 'One path per line (or comma-separated). Each folder should contain <name>/SKILL.md. Default: .aicodex/skills. Use . to scan every top-level folder for SKILL.md. Examples: .aicodex/skills  OR  skills  OR  .aicodex/skills, my-skills',
                default: '.aicodex/skills'
            },
            {
                type: 'toggle',
                key: 'agentDryRun',
                label: 'Dry-run mode',
                description: 'Simulate write/edit/delete/shell tools without changing the disk. Reads still work. Useful to preview agent plans safely.',
                default: false
            },
            {
                type: 'textarea',
                key: 'agentExploreModel',
                label: 'Explore subagent model (optional)',
                description: 'Model id for type=explore subagents only (e.g. qwen/qwen3.7-flash). Leave empty to use the same model as the parent chat. Saves cost on large explores.',
                default: ''
            },
            {
                type: 'textarea',
                key: 'agentSmallModel',
                label: 'Small model id (optional)',
                description:
                    'Cheaper model for future title/summary helpers. Compaction stays extractive (no extra call). Reserved for lightweight tasks.',
                default: ''
            },
            {
                type: 'select',
                key: 'agentQueueMode',
                label: 'Mid-run message queue',
                description:
                    'steer = inject into current agent run (default). followup = run after agent finishes. Prefix >> or /follow forces follow-up.',
                options: [
                    { label: 'Steer (inject now)', value: 'steer' },
                    { label: 'Follow-up (after finish)', value: 'followup' }
                ],
                default: 'steer'
            },
            {
                type: 'select',
                key: 'agentThinkingEffort',
                label: 'Default thinking effort',
                description:
                    'Only applied when the model has a native thinking channel AND Think is on (or agentThinkingAlways). Never sent to non-native models like Qwen flash.',
                options: [
                    { label: 'Low', value: 'low' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'High', value: 'high' }
                ],
                default: 'medium'
            },
            {
                type: 'toggle',
                key: 'forceEnableNonNativeThinking',
                label: 'Force enable thinking (non-native models)',
                description:[
                    'OFF by default. When OFF, the Think toggle only works on models with a real reasoning channel (Claude, DeepSeek R1, o-series, etc.). ',
                    'When ON, non-native models (e.g. Qwen flash) may use prompted “simulated” thinking. ',
                    'Warning: quality can be worse — mixed answers, cut text, or instruction leakage. Use only if you accept that risk.',
                ],
                  default: false
            },
            {
                type: 'toggle',
                key: 'agentTwoPassPlanThinking',
                label: 'Agent: two-pass plan → act (experimental)',
                description:[
                    'OFF by default. Agent mode only.\n',
                    '• Pass 1: short plan/thinking (no tools).\n',
                    '• Pass 2: tools/answer with that plan as hidden context (Think UI off on pass 2).\n',
                    'Advantages: clearer plan vs work for models without native thinking; can reduce mid-answer “thinking theatre”.\n',
                    'Disadvantages: ~2× latency and token cost; plan is only text context (not true API reasoning); simple tasks waste a full extra call. ',
                    'Prefer native thinking models when possible.',
                ],
                  default: false
            },
            {
                type: 'textarea',
                key: 'mcpServersJson',
                label: 'MCP servers JSON (HTTP only)',
                description:
                    'Optional. Same shape as .aicodex/mcp.json: { "servers": [{ "name": "x", "url": "https://…", "headers": {} }] }. Stdio MCP is not supported on mobile.',
                default: ''
            },
            {
                type: 'textarea',
                key: 'agentDefaultExploreAgent',
                label: 'Default explore agent id (optional)',
                description: 'If set, explore subagents load .aicodex/agents/<id>/AGENT.md (prompt/tools). Leave empty for built-in explore.',
                default: ''
            },
            {
                type: 'toggle',
                key: 'agentCanvasAutoFix',
                label: 'Canvas auto-fix after agent',
                description: 'When post-agent canvas preview finds runtime errors, automatically send a fix prompt (no click needed).',
                default: false
            }
        ]
    },

    { type: 'header', label: 'Composer · Paste chips' },
    {
        type: 'range',
        key: 'pasteChipThreshold',
        label: 'Paste chip when text longer than (chars)',
        description: 'Pastes at or above this length can become chips instead of filling the input.',
        min: 100,
        max: 5000,
        step: 50,
        default: 400
    },
    {
        type: 'select',
        key: 'pasteChipMode',
        label: 'On large paste',
        description: 'ask = Acode menu (chip vs input); allow = always paste as chip.',
        options: [
            { label: 'Ask (chip or input)', value: 'ask' },
            { label: 'Allow (always chip)', value: 'allow' }
        ],
        default: 'ask'
    },
    { type: 'header', label: 'Titles' },
    {
        type: 'toggle',
        key: 'autoGenerateTitle',
        label: 'Auto-generate Chat Title',
        description: 'Name a new chat automatically from your first message.',
        default: true
    },

    { type: 'header', label: 'Advanced' },
    {
        type: 'page',
        label: 'Usage & Storage',
        description: 'Token usage alerts and offline-storage behavior',
        children: [
            {
                type: 'markdown',
                content: '### Token Usage\nControls when the app warns you that a model is approaching its usage limit, and how usage is measured when a provider doesn\'t report exact numbers.'
            },
            {
                type: 'range',
                key: 'updateTokenWhen',
                label: 'Usage Alert Threshold',
                description: "Warn when a model's token usage reaches this percentage of its limit.",
                min: 0.5,
                max: 1,
                step: 0.05,
                default: 0.8,
                percent: true
            },
            {
                type: 'select',
                key: 'usageEstimationMode',
                label: 'Usage Estimation Mode',
                description: 'How token usage is recorded when a provider does not report exact numbers.',
                options: [
                    { label: 'Estimate automatically', value: 'auto' },
                    { label: 'Provider-reported only', value: 'strict' }
                ],
                default: 'auto'
            },
            { type: 'subheader', label: 'Storage' },
            {
                type: 'toggle',
                key: 'continueWOpath',
                label: 'Chat Without Local Storage',
                description: 'Allow sending messages even if no local storage folder is set. Those chats will not be saved to disk.',
                default: false,
                legacyString: true
            }
        ]
    }
];