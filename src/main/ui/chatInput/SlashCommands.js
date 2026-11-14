/**
 * Extensible `/` command registry (OpenCode-style).
 * Add commands with registerSlashCommand({ id, name, description, run }).
 */
import { FileChangeHistory } from '../../utils/agent/FileChangeHistory.js';

/** @type {Array<{id:string,name:string,description:string,run:Function}>} */
const _commands = [];

export function registerSlashCommand(cmd) {
  if (!cmd?.id || !cmd?.name || typeof cmd.run !== 'function') return;
  const i = _commands.findIndex(c => c.id === cmd.id);
  if (i >= 0) _commands[i] = cmd;
  else _commands.push(cmd);
}

export function listSlashCommands() {
  return _commands.slice();
}

export function matchSlashCommands(query) {
  const q = String(query || '').replace(/^\//, '').toLowerCase();
  if (!q) return _commands.slice();
  return _commands.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q) ||
    (c.description || '').toLowerCase().includes(q)
  );
}

/**
 * Expand parent command into subcommand chips when user typed /mode, /perms, etc.
 * @returns {Array<{name,description,insert?:boolean,run?:boolean}>}
 */
function expandSlashSuggestions(inputValue) {
  const v = String(inputValue || '');
  if (!v.startsWith('/')) return [];
  if (v.includes('\n')) return [];

  const raw = v;
  const parts = raw.trim().split(/\s+/);
  const token = (parts[0] || '').toLowerCase();
  const typed = raw.toLowerCase();

  // Exact parent with subcommands → show subs (also when "/mode " trailing space)
  const parent = _commands.find(
    c => c.name.toLowerCase() === token || `/${c.id}` === token
  );

  if (parent && Array.isArray(parent.subcommands) && parent.subcommands.length) {
    const subs = parent.subcommands
      .map(s => ({
        name: s.name,
        description: s.description || parent.description || '',
        insert: !!s.insert,
        run: s.run !== false && !s.insert
      }))
      .filter(s => {
        // Show all subs when only parent token (+ optional space)
        if (parts.length <= 1) return true;
        // Filter by partial second token e.g. "/mode as" → ask
        const subq = typed.trim();
        return s.name.toLowerCase().startsWith(subq) || subq.startsWith(s.name.toLowerCase().trim());
      });
    if (subs.length) return subs;
  }

  // Typing /mo → list parents (and parents with matching sub names)
  const parents = matchSlashCommands(token);
  const out = [];
  for (const c of parents) {
    if (Array.isArray(c.subcommands) && c.subcommands.length && token.replace(/^\//,'') === c.id) {
      // already handled above
      continue;
    }
    out.push({
      name: c.name,
      description: c.description || '',
      // Parent with subcommands: insert only (expand on next paint) unless no subs
      insert: !!(c.subcommands && c.subcommands.length),
      run: !(c.subcommands && c.subcommands.length)
    });
  }
  return out;
}

/**
 * Persist + show centered event in chat (WhatsApp-style).
 * @param {string|object} textOrOpts - string message, or { text, type, action, continuePrompt }
 * @param {object} [opts] - { type: 'info'|'error'|'warn', action: 'continue'|null, continuePrompt }
 */
export async function pushChatEvent(app, textOrOpts, opts = {}) {
  if (!app) return;
  let text = '';
  let type = 'info';
  let action = null;
  let continuePrompt = null;
  if (textOrOpts && typeof textOrOpts === 'object' && !Array.isArray(textOrOpts)) {
    text = String(textOrOpts.text || textOrOpts.content || textOrOpts.event || '');
    type = textOrOpts.type || opts.type || 'info';
    action = textOrOpts.action || opts.action || null;
    continuePrompt = textOrOpts.continuePrompt || opts.continuePrompt || null;
  } else {
    text = String(textOrOpts || '');
    type = opts.type || 'info';
    action = opts.action || null;
    continuePrompt = opts.continuePrompt || null;
  }
  if (!text) return;

  // Heuristic: stop/error phrases → error type unless overridden
  if (!opts.type && type === 'info' && /stopped\s*—|error|failed|limit|credits|exceed/i.test(text)) {
    type = 'error';
  }
  // Prompt/credit limits get continue affordance
  if (!action && type === 'error' && /prompt too large|credits|rate limit|truncated|token/i.test(text)) {
    action = 'continue';
  }

  const msg = {
    role: 'event',
    type,
    content: text,
    action: action || undefined,
    continuePrompt: continuePrompt || undefined,
    createdAt: Date.now()
  };
  try {
    const convIdx = parseInt(app.currentConversationIndex, 10);
    const conv = app.conversations?.[convIdx];
    if (conv?.chat) {
      // Always place event AFTER the latest assistant (never between user and assistant)
      let insertAt = conv.chat.length;
      for (let i = conv.chat.length - 1; i >= 0; i--) {
        const r = conv.chat[i]?.role;
        if (r === 'assistant') {
          insertAt = i + 1;
          break;
        }
        // keep scanning; if only user at end, still append (insertAt = length)
      }
      // If last message is already event(s) after assistant, append after those events
      while (insertAt < conv.chat.length && conv.chat[insertAt]?.role === 'event') {
        insertAt++;
      }
      conv.chat.splice(insertAt, 0, msg);
      app.chatHistory = [...conv.chat];
      try {
        const { HistoryFileOps } = await import('../../history/HistoryFileOps.js');
        await HistoryFileOps.saveActiveChat(app);
      } catch (_) {}

      const box = app.chatBox || document.getElementById('chat-box');
      if (box) {
        try {
          box.querySelectorAll('.assistant-message.increaseChatHeight').forEach(el => {
            el.classList.remove('increaseChatHeight');
          });
        } catch (_) {}

        const { buildEventMessageElement, applyEventMessageStylesOnce, appendEventToChatBox } = await import('../ChatEventUI.js');
        applyEventMessageStylesOnce();
        const { el, bind } = buildEventMessageElement(msg);
        bind(app);
        const after = app._eventAfterEl;
        app._eventAfterEl = null;
        appendEventToChatBox(box, el, after);
      }
    }
  } catch (e) {
    console.warn('[pushChatEvent]', e);
  }
}

function ensureDefaults(app) {
  if (_commands.length) {
    // Still refresh custom commands when project may have changed
    try {
      if (!ensureDefaults._customLoading) {
        ensureDefaults._customLoading = true;
        import('./CustomSlashLoader.js')
          .then(m => m.registerCustomSlashCommands(app))
          .catch(() => {})
          .finally(() => { ensureDefaults._customLoading = false; });
      }
    } catch (_) {}
    return;
  }

  registerSlashCommand({
    id: 'undo',
    name: '/undo',
    description: 'Undo all file changes from the last agent response (this chat only)',
    run: async (ctx) => {
      FileChangeHistory.hydrate(ctx.app);
      const r = await FileChangeHistory.undo(ctx.app);
      await pushChatEvent(ctx.app, r.message);
      return r;
    }
  });

  registerSlashCommand({
    id: 'redo',
    name: '/redo',
    description: 'Redo the last undone response batch (this chat only)',
    run: async (ctx) => {
      FileChangeHistory.hydrate(ctx.app);
      const r = await FileChangeHistory.redo(ctx.app);
      await pushChatEvent(ctx.app, r.message);
      return r;
    }
  });

  registerSlashCommand({
    id: 'path',
    name: '/path',
    description: 'Add or change chat storage / project path',
    run: async (ctx) => {
      try {
        if (ctx.app.storageManager?.setPath) await ctx.app.storageManager.setPath();
        else if (window.gptSetStoragePath) await window.gptSetStoragePath();
        await pushChatEvent(ctx.app, 'Storage / project path updated');
      } catch (e) {
        await pushChatEvent(ctx.app, `Path change failed: ${e.message || e}`);
      }
    }
  });

  registerSlashCommand({
    id: 'compact',
    name: '/compact',
    description: 'Compact agent context (summarize older tool steps this turn)',
    run: async (ctx) => {
      try {
        const app = ctx.app;
        app._forceCompactNext = true;
        await pushChatEvent(app, 'Context will compact on the next agent step (older tool output summarized).');
      } catch (e) {
        await pushChatEvent(ctx.app, `Compact failed: ${e.message || e}`);
      }
    }
  });


  registerSlashCommand({
    id: 'skills',
    name: '/skills',
    description: 'List project skills (.aicodex/skills, .agents/skills)',
    run: async (ctx) => {
      try {
        const { discoverSkills, getSkillsRoots } = await import('../../context/SkillsLoader.js');
        const roots = getSkillsRoots();
        const items = await discoverSkills();
        if (!items.length) {
          await pushChatEvent(ctx.app,
            'No skills under: ' + roots.join(', ') +
            '. Add .aicodex/skills/<name>/SKILL.md (or change Skills folders in settings).');
          return;
        }
        const line = items.map(x => x.name + ' (' + x.path + ')').join(', ');
        await pushChatEvent(ctx.app, 'Skills [' + roots.join(', ') + ']: ' + line);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Skills list failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'audit',
    name: '/audit',
    description: 'Show last lines of .aicodex/audit.jsonl',
    run: async (ctx) => {
      try {
        const { getProjectFolder, readFile, normalizeSafUrl, joinSafPath } = await import('../../utils/file/fileOperations.js');
        const project = await getProjectFolder();
        if (!project?.uri) {
          await pushChatEvent(ctx.app, 'No project folder');
          return;
        }
        const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, '.aicodex/audit.jsonl')), 'utf-8');
        if (!r?.success || !r.content) {
          await pushChatEvent(ctx.app, 'No audit log yet (mutations will append here)');
          return;
        }
        const lines = r.content.trim().split('\n').filter(Boolean).slice(-12);
        await pushChatEvent(ctx.app, 'Audit (last ' + lines.length + '):\n' + lines.join('\n'));
      } catch (e) {
        await pushChatEvent(ctx.app, 'Audit failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'rewind',
    name: '/rewind',
    description: 'Rewind chat + files to a checkpoint',
    subcommands: [
      { name: '/rewind', description: 'List rewind points', run: true },
      { name: '/rewind -1', description: 'Rewind to last checkpoint', run: true },
      { name: '/rewind 0', description: 'Rewind to oldest checkpoint', run: true }
    ],
    run: async (ctx) => {
      try {
        const { formatRewindList, rewindTo, listRewindPoints } = await import('../../core/chat/SessionRewind.js');
        const arg = String(ctx.args || '').trim();
        if (!arg) {
          await pushChatEvent(ctx.app, formatRewindList(ctx.app) +
            '\n\nUsage: /rewind <index>  (0=oldest, -1=latest)');
          return;
        }
        const n = parseInt(arg, 10);
        if (!Number.isFinite(n)) {
          await pushChatEvent(ctx.app, 'Usage: /rewind <index>');
          return;
        }
        const r = await rewindTo(ctx.app, n);
        if (!r.success) {
          await pushChatEvent(ctx.app, 'Rewind failed: ' + (r.error || 'unknown'));
          return;
        }
        await pushChatEvent(ctx.app, r.message);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Rewind failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'fork',
    name: '/fork',
    description: 'Fork this chat into a new conversation (optional: /fork 3 = up to message index 3)',
    run: async (ctx) => {
      try {
        const { forkConversation } = await import('../../core/chat/SessionFork.js');
        const argStr = String(ctx.args || '').trim();
        const m = argStr.match(/^(\d+)/);
        const upTo = m ? parseInt(m[1], 10) : undefined;
        const r = await forkConversation(ctx.app, { upToIndex: upTo });
        if (!r.success) {
          await pushChatEvent(ctx.app, 'Fork failed: ' + (r.error || 'unknown'));
          return;
        }
        await pushChatEvent(ctx.app,
          `Forked ${r.messageCount} message(s) → "${r.title}"`);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Fork failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'tree',
    name: '/tree',
    description: 'Show message index tree for this chat (use with /fork N)',
    run: async (ctx) => {
      try {
        const { conversationTreeText } = await import('../../core/chat/SessionFork.js');
        const text = conversationTreeText(ctx.app);
        await pushChatEvent(ctx.app, 'Chat tree:\n' + text);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Tree failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'export-aicodex',
    name: '/export-aicodex',
    description: 'Export .aicodex (memory, skills, repomap) to aicodex-pack.json',
    run: async (ctx) => {
      try {
        const { buildAicodePack } = await import('../../context/AicodePack.js');
        const r = await buildAicodePack();
        if (!r.success) {
          await pushChatEvent(ctx.app, 'Export failed: ' + (r.error || 'unknown'));
          return;
        }
        await pushChatEvent(ctx.app,
          `Exported ${r.fileCount} item(s) → ${r.path}`);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Export failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'import-aicodex',
    name: '/import-aicodex',
    description: 'Import .aicodex/aicodex-pack.json into this project',
    run: async (ctx) => {
      try {
        const { importAicodePack } = await import('../../context/AicodePack.js');
        const r = await importAicodePack();
        await pushChatEvent(ctx.app, r.message || (r.success ? 'Import done' : ('Import failed: ' + (r.error || ''))));
      } catch (e) {
        await pushChatEvent(ctx.app, 'Import failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'repomap',
    name: '/repomap',
    description: 'Rebuild project file map (.aicodex/repomap.json)',
    run: async (ctx) => {
      try {
        const { buildRepoMap } = await import('../../context/RepoMap.js');
        const { map, fromCache, path, error } = await buildRepoMap({ force: true });
        if (error || !map) {
          await pushChatEvent(ctx.app, 'Repomap failed: ' + (error || 'unknown'));
          return;
        }
        await pushChatEvent(ctx.app,
          `Repomap ${fromCache ? '(cache)' : 'rebuilt'}: ${map.fileCount} files → ${path}`);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Repomap failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'dryrun',
    name: '/dryrun',
    description: 'Toggle dry-run (no disk writes)',
    subcommands: [
      { name: '/dryrun', description: 'Toggle dry-run on/off', run: true }
    ],
    run: async (ctx) => {
      try {
        const { ConfigManager } = await import('../../utils/ConfigManager.js');
        const cur = ConfigManager.get('agentDryRun');
        const on = !(cur === true || cur === 'true' || cur === 1 || cur === '1');
        ConfigManager.set('agentDryRun', on);
        await pushChatEvent(ctx.app, on ? 'Dry-run ON — writes are simulated only' : 'Dry-run OFF — normal writes');
      } catch (e) {
        await pushChatEvent(ctx.app, 'Dry-run toggle failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'test-guide',
    name: '/test-guide',
    description: 'Short Plan 2 smoke-test prompts',
    run: async (ctx) => {
      await pushChatEvent(ctx.app,
        'Smoke tests (see docs/TEST_PLAN1.md + TEST_PLAN2.md):\n' +
        '1) Local: Fix a JS syntax line with edit_file_lines — no web\n' +
        '2) /plan on → research only → Approve\n' +
        '3) thanks → must NOT web_search\n' +
        '4) /export-session\n' +
        '5) /marketplace install explain-code\n' +
        '6) /review (git repo)\n' +
        '7) Mid-run send a steer message on a long task'
      );
    }
  });

  registerSlashCommand({
    id: 'export-session',
    name: '/export-session',
    description: 'Export this chat as HTML into .aicodex/exports/',
    run: async (ctx) => {
      try {
        const { exportSessionToProject } = await import('../../utils/session/SessionHtmlExport.js');
        const r = await exportSessionToProject(ctx.app);
        if (r.success) await pushChatEvent(ctx.app, 'Exported → ' + r.path + ' (' + r.bytes + ' bytes)');
        else await pushChatEvent(ctx.app, 'Export failed: ' + (r.error || 'unknown') + (r.html ? ' (HTML still built in memory)' : ''));
      } catch (e) {
        await pushChatEvent(ctx.app, 'Export failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'marketplace',
    name: '/marketplace',
    description: 'List/install bundled skills: /marketplace install code-review',
    subcommands: [
      { name: '/marketplace', description: 'List skill templates', run: true },
      { name: '/marketplace install code-review', description: 'Install code-review skill', run: true },
      { name: '/marketplace install write-tests', description: 'Install write-tests skill', run: true },
      { name: '/marketplace install explain-code', description: 'Install explain-code skill', run: true }
    ],
    run: async (ctx) => {
      try {
        const { listMarketplaceSkills, installSkill, listInstalledSkills } =
          await import('../../agent/context/SkillMarketplace.js');
        const arg = String(ctx.args || '').trim();
        const m = arg.match(/^install\s+(\S+)/i);
        if (m) {
          const r = await installSkill(m[1]);
          await pushChatEvent(ctx.app, r.success ? 'Installed skill → ' + r.path : ('Failed: ' + r.error));
          return;
        }
        const avail = listMarketplaceSkills()
          .map(s => s.id + ' — ' + s.description)
          .join('\n');
        const inst = (await listInstalledSkills()).join(', ') || '(none)';
        await pushChatEvent(ctx.app,
          'Marketplace skills:\n' + avail +
          '\n\nInstalled: ' + inst +
          '\n\nUsage: /marketplace install code-review');
      } catch (e) {
        await pushChatEvent(ctx.app, 'Marketplace failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'mcp',
    name: '/mcp',
    description: 'List MCP HTTP servers (/mcp tools <name>)',
    run: async (ctx) => {
      try {
        const { listMcpServers, listMcpTools } = await import('../../agent/mcp/McpHttpClient.js');
        const arg = String(ctx.args || '').trim();
        const tm = arg.match(/^tools\s+(\S+)/i);
        if (tm) {
          const tools = await listMcpTools(tm[1]);
          await pushChatEvent(ctx.app, 'MCP tools (' + tm[1] + '):\n' + JSON.stringify(tools, null, 2).slice(0, 4000));
          return;
        }
        const servers = await listMcpServers();
        await pushChatEvent(ctx.app,
          servers.length
            ? ('MCP servers:\n' + servers.map(s => s.name + ' → ' + s.url).join('\n') + '\n\n/mcp tools <name>')
            : 'No MCP servers. Add .aicodex/mcp.json or Settings → MCP servers JSON.');
      } catch (e) {
        await pushChatEvent(ctx.app, 'MCP: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'commit',
    name: '/commit',
    description: 'Show git status + staged/unstaged diff (then draft a message yourself)',
    run: async (ctx) => {
      try {
        const { GitAgent } = await import('../../agent/tools/GitAgent.js');
        const st = await GitAgent.executeTool({ name: 'git_status', args: {} });
        const df = await GitAgent.executeTool({ name: 'git_diff', args: {} });
        await pushChatEvent(ctx.app,
          'git status:\n' + (st.output || st.error || '') +
          '\n\ngit diff (trunc):\n' + String(df.output || '').slice(0, 4000) +
          '\n\nTip: stage files in terminal, then ask the agent to propose a commit message.');
      } catch (e) {
        await pushChatEvent(ctx.app, 'git failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'review',
    name: '/review',
    description: 'Git status + recent log for a quick review context',
    run: async (ctx) => {
      try {
        const { GitAgent } = await import('../../agent/tools/GitAgent.js');
        const st = await GitAgent.executeTool({ name: 'git_status', args: {} });
        const log = await GitAgent.executeTool({ name: 'git_log', args: { limit: 6 } });
        const df = await GitAgent.executeTool({ name: 'git_diff', args: {} });
        await pushChatEvent(ctx.app,
          'Review context\n\nstatus:\n' + (st.output || st.error) +
          '\n\nlog:\n' + (log.output || '') +
          '\n\ndiff:\n' + String(df.output || '').slice(0, 3500));
      } catch (e) {
        await pushChatEvent(ctx.app, 'review failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'hooks',
    name: '/hooks',
    description: 'Show loaded .aicodex/hooks.json summary',
    run: async (ctx) => {
      try {
        const { loadHooks, REL } = await import('../../agent/harness/AgentHooks.js');
        const h = await loadHooks(true);
        const lines = [
          'Hooks file: ' + REL,
          'UserPromptSubmit: ' + (h.UserPromptSubmit?.length || 0),
          'PreToolUse: ' + (h.PreToolUse?.length || 0),
          'PostToolUse: ' + (h.PostToolUse?.length || 0),
          'AgentStop: ' + (h.AgentStop?.length || 0),
          '',
          'Example PreToolUse deny delete:',
          '{ "PreToolUse": [{ "match": "delete_item", "deny": true, "reason": "No deletes" }] }'
        ];
        await pushChatEvent(ctx.app, lines.join('\n'));
      } catch (e) {
        await pushChatEvent(ctx.app, 'Hooks failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'agents',
    name: '/agents',
    description: 'List custom agents (.aicodex/agents)',
    subcommands: [
      { name: '/agents', description: 'List project agents', run: true }
    ],
    run: async (ctx) => {
      try {
        const { discoverCustomAgents, ROOT } = await import('../../agent/context/CustomAgentsLoader.js');
        const list = await discoverCustomAgents();
        if (!list.length) {
          await pushChatEvent(ctx.app,
            'No custom agents. Add ' + ROOT + '/<name>/AGENT.md\n' +
            'Example frontmatter: name, description, readonly: true, tools: read,grep,finish_task');
          return;
        }
        const lines = list.map(a =>
          '/' + a.id + (a.readonly ? ' [RO]' : ' [RW]') +
          (a.model ? ' model=' + a.model : '') +
          ' — ' + (a.description || '') +
          (a.rel ? ' (' + a.rel + ')' : '')
        ).join('\n');
        await pushChatEvent(ctx.app, 'Custom agents:\n' + lines +
          '\n\nUse: subagent tool with agent="<id>" or ask the model to use agent <id>.');
      } catch (e) {
        await pushChatEvent(ctx.app, 'Agents failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'commands',
    name: '/commands',
    description: 'List built-in + custom slash commands',
    run: async (ctx) => {
      try {
        ensureDefaults(ctx.app);
        const built = listSlashCommands()
          .filter(c => !String(c.id).startsWith('custom_'))
          .map(c => c.name + (c.description ? ' — ' + c.description : ''))
          .join('\n');
        let custom = '';
        try {
          const { listCustomCommands } = await import('./CustomSlashLoader.js');
          const list = await listCustomCommands();
          custom = list.length
            ? list.map(c => c.name + ' — ' + (c.description || '') + ' (' + c.rel + ')').join('\n')
            : '(none — add .aicodex/commands/<name>.md)';
        } catch (_) {
          custom = '(unavailable)';
        }
        await pushChatEvent(ctx.app,
          'Built-in:\n' + built + '\n\nCustom (.aicodex/commands):\n' + custom);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Commands list failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'perms',
    name: '/perms',
    description: 'Permission patterns',
    subcommands: [
      { name: '/perms', description: 'List current allow/deny rules', run: true },
      { name: '/perms allow run_command(npm test*)', description: 'Example: allow npm test', run: true },
      { name: '/perms allow write(*.md)', description: 'Example: allow writing markdown', run: true },
      { name: '/perms allow ', description: 'Custom allow — type: tool(pattern*)', insert: true },
      { name: '/perms deny run_command(rm*)', description: 'Example: deny rm commands', run: true },
      { name: '/perms deny delete_item(*)', description: 'Example: deny all deletes', run: true },
      { name: '/perms deny ', description: 'Custom deny — type: tool(pattern*)', insert: true }
    ],
    run: async (ctx) => {
      try {
        const {
          loadPermissionRules, addAllowPattern, addDenyPattern, REL
        } = await import('../../agent/harness/PatternPermissions.js');
        const arg = String(ctx.args || '').trim();
        const m = arg.match(/^(allow|deny)\s+(.+)$/i);
        if (m) {
          const kind = m[1].toLowerCase();
          const pat = m[2].trim();
          const res = kind === 'deny' ? await addDenyPattern(pat) : await addAllowPattern(pat);
          await pushChatEvent(ctx.app, res.success
            ? `Permission ${kind}: ${pat} → ${REL}`
            : ('Failed: ' + (res.error || 'unknown')));
          return;
        }
        const rules = await loadPermissionRules(true);
        const allow = (rules.allow || []).map(p => '  allow  ' + p).join('\n') || '  (none)';
        const deny = (rules.deny || []).map(p => '  deny   ' + p).join('\n') || '  (none)';
        await pushChatEvent(ctx.app,
          'Permission patterns (' + REL + ' + settings):\n' + deny + '\n' + allow +
          '\n\nUsage: /perms allow run_command(npm test*) | /perms deny delete_item(*)');
      } catch (e) {
        await pushChatEvent(ctx.app, 'Perms failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'plan',
    name: '/plan',
    description: 'Plan mode on/off',
    subcommands: [
      { name: '/plan on', description: 'Research only — block writes', run: true },
      { name: '/plan off', description: 'Leave plan mode', run: true }
    ],
    run: async (ctx) => {
      try {
        const { setPlanMode, isPlanMode } = await import('../../agent/harness/PlanMode.js');
        const arg = String(ctx.args || '').trim().toLowerCase();
        if (arg === 'on' || arg === '1' || arg === 'true') {
          setPlanMode(true);
          await pushChatEvent(ctx.app, 'Plan mode ON — research only; mutations blocked until you Approve.');
        } else if (arg === 'off' || arg === '0' || arg === 'false') {
          setPlanMode(false);
          await pushChatEvent(ctx.app, 'Plan mode OFF.');
        } else {
          await pushChatEvent(ctx.app, 'Plan mode is ' + (isPlanMode() ? 'ON' : 'OFF') + '. Usage: /plan on | /plan off');
        }
      } catch (e) {
        await pushChatEvent(ctx.app, 'Plan mode failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'mode',
    name: '/mode',
    description: 'Permission mode',
    subcommands: [
      { name: '/mode ask', description: 'Confirm every mutation', run: true },
      { name: '/mode edits', description: 'Auto write; ask delete/shell', run: true },
      { name: '/mode full', description: 'Auto all allowed tools', run: true },
      { name: '/mode plan', description: 'Research only until Approve', run: true }
    ],
    run: async (ctx) => {
      try {
        const { ConfigManager } = await import('../../utils/ConfigManager.js');
        const arg = String(ctx.args || '').trim().toLowerCase();
        if (!arg || !['ask', 'edits', 'full', 'plan'].includes(arg)) {
          const cur = ConfigManager.get('agentPermissionMode') || 'ask';
          await pushChatEvent(ctx.app, 'Permission mode: ' + cur + '. Usage: /mode ask | edits | full | plan');
          return;
        }
        ConfigManager.set('agentPermissionMode', arg);
        await pushChatEvent(ctx.app, 'Permission mode set to: ' + arg);
      } catch (e) {
        await pushChatEvent(ctx.app, 'Mode failed: ' + (e.message || e));
      }
    }
  });

  registerSlashCommand({
    id: 'settings',
    name: '/settings',
    description: 'Open AI model settings (API keys, advanced…)',
    run: async (ctx) => {
      try {
        const app = ctx.app;
        const model = app.selectedModel || app.allModels?.find(m => m.model === app.lastSelectedModel) || app.allModels?.[0];
        if (!model) {
          await pushChatEvent(app, 'No model selected');
          return;
        }
        // Same path as gpt-threedot-setting → ModelSetupUI.showModelModal
        const type = String(model.type || '').toLowerCase();
        if (app.modelManager?.handleModelClick) {
          await app.modelManager.handleModelClick(model, { [type]: true });
          return;
        }
        try {
          const { ModelSetupUI } = await import('../ModelSetupUI.js');
          if (ModelSetupUI?.showModelModal) {
            ModelSetupUI.showModelModal(app, model);
            return;
          }
        } catch (_) {}
        // global fallback (non-module build)
        if (typeof ModelSetupUI !== 'undefined' && ModelSetupUI.showModelModal) {
          ModelSetupUI.showModelModal(app, model);
        }
      } catch (e) {
        console.warn('[slash /settings]', e);
      }
    }
  });

  // Project custom commands (.aicodex/commands)
  try {
    import('./CustomSlashLoader.js')
      .then(m => m.registerCustomSlashCommands(app))
      .catch(e => console.warn('[slash] custom load', e));
  } catch (_) {}
}

/**
 * If input is a pure slash command, run it and return true (don't send as chat).
 */
export async function tryHandleSlashCommand(app, rawInput) {
  ensureDefaults(app);
  const text = String(rawInput || '').trim();
  if (!text.startsWith('/')) return false;
  const token = text.split(/\s+/)[0].toLowerCase();
  const cmd = _commands.find(c => c.name.toLowerCase() === token || `/${c.id}` === token);
  if (!cmd) return false;
  await cmd.run({ app, args: text.slice(token.length).trim() });
  return true;
}

export function getSlashSuggestions(app, inputValue) {
  ensureDefaults(app);
  return expandSlashSuggestions(inputValue);
}
