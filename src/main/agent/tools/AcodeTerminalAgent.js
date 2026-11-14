// src/main/core/agent/AcodeTerminalAgent.js
// Fast, SDCard-only shell agent. Blocks Termux/deep scans that hang agent mode.
import { ConfigManager } from '../../utils/ConfigManager.js';
import { getProjectFolder, createFile, createFolder, normalizeSafUrl } from '../../utils/file/fileOperations.js';
const terminal = acode.require('terminal');
const TAG = '[AcodeTerminalAgent]';
const STORAGE_KEY = 'agent_shared_terminal_id';
const PKG_CACHE_KEY = 'agent_pkg_manager_cache';

/** Extract cat/tee heredoc writes: [{ path, content }] */
function parseHeredocWrites(command) {
    const out = [];
    if (!command || typeof command !== 'string') return out;
    // cat > path << 'EOF' ... EOF   OR  cat >path <<EOF
    const re = /(?:^|[\n;&|])\s*(?:cat|tee)\s+>\s*([^\s<]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\2\s*(?=$|[\n;&|])/g;
    let m;
    while ((m = re.exec(command)) !== null) {
        const path = m[1].trim();
        const content = m[3];
        if (path && content != null) out.push({ path, content });
    }
    // Fallback: looser match without requiring trailing delimiter line alone
    if (!out.length) {
        const re2 = /(?:cat|tee)\s+>\s*([^\s<]+)\s*<<\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*)/;
        const m2 = command.match(re2);
        if (m2) {
            const delim = m2[2];
            let body = m2[3];
            const endIdx = body.lastIndexOf('\n' + delim);
            if (endIdx !== -1) body = body.slice(0, endIdx);
            else {
                const endIdx2 = body.lastIndexOf(delim);
                if (endIdx2 > 0) body = body.slice(0, endIdx2);
            }
            out.push({ path: m2[1].trim(), content: body });
        }
    }
    return out;
}

/** Map /sdcard/Project/rel → content:// project URI child */
async function writeViaNativeFs(absPath, content) {
    // Prefer per-chat ProjectWorkspace root (e.g. .../web) over generic getProjectFolder
    let project = await getProjectFolder();
    try {
        const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
        const { ConfigManager } = await import('../../utils/ConfigManager.js');
        let chatId = 'default';
        try {
            const idx = ConfigManager.get('current_chat_index', null);
            if (idx != null && idx !== '') chatId = idx;
        } catch (_) {}
        const list = ProjectWorkspace.list(chatId);
        if (list.length && list[0].url) {
            project = { uri: list[0].url, name: list[0].name || project?.name };
        }
    } catch (_) {}
    if (!project?.uri || !project.name) {
        return { success: false, error: 'No open project for FS fallback' };
    }
    const norm = absPath.replace(/^\/storage\/emulated\/0\//, '/sdcard/');
    const prefix = `/sdcard/${project.name}/`;
    let rel = norm.startsWith(prefix) ? norm.slice(prefix.length) : null;
    if (!rel && norm.startsWith('/sdcard/')) {
        const parts = norm.replace(/^\/sdcard\//, '').split('/').filter(Boolean);
        // Model often invents /sdcard/myproject — map file name into selected workspace root
        if (parts[0] === project.name) rel = parts.slice(1).join('/');
        else if (parts.length >= 1) rel = parts[parts.length - 1];
        else rel = parts.join('/');
    }
    if (!rel) return { success: false, error: `Cannot map ${absPath} to project` };

    const segments = rel.split('/').filter(Boolean);
    const fileName = segments.pop();
    let parentUrl = normalizeSafUrl(project.uri);
    for (const seg of segments) {
        const fr = await createFolder(parentUrl, seg, { overwrite: true });
        if (!fr.success || !fr.url) {
            return { success: false, error: `FS mkdir failed: ${seg} — ${fr.message || ''}` };
        }
        parentUrl = normalizeSafUrl(fr.url);
    }
    const wr = await createFile(parentUrl, fileName, content, { overwrite: true });
    return {
        success: !!(wr && wr.success),
        url: wr?.url,
        path: rel,
        error: wr?.success ? undefined : (wr?.message || 'createFile failed'),
        via: 'native_fs'
    };
}

// Paths / patterns that cause multi-minute hangs or permission storms on Android
const FORBIDDEN_PATH_RE = /\/data\/data|\/data\/user|com\.termux|\/home\/(?!sdcard)|node_modules|\.npm\/|\.cache\/|\.git\/objects/i;
const FORBIDDEN_FIND_ROOTS_RE = /find\s+(?:[^|&;]*\s+)?(?:\/data|\/home(?:\s|\/|$)|\/storage\/emulated\/0\s+\/data)/i;
// Broad multi-root finds without maxdepth are banned
const BROAD_FIND_RE = /find\s+\/(?:sdcard|storage)(?:\s+\/\S+){1,}/i;

export class AcodeTerminalAgent {

    static getToolsSchema() {
        return [
            {
                name: "run_shell_command",
                description: "Run ONE quick shell command and return stdout. ONLY use paths under /sdcard or /storage/emulated/0. NEVER search /data/data, Termux home, /home, or node_modules. Always use -maxdepth 2|3 and | head. For CREATE tasks skip device-wide find — mkdir and write files directly. If shell returns Permission denied / proot errors, stop and use native FS tools instead.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        command: {
                            type: "STRING",
                            description: "Short command. Examples: 'ls -la /sdcard | head -30', 'mkdir -p /sdcard/myproject', 'find /sdcard/myproject -maxdepth 2 -type f 2>/dev/null | head -40'. Forbidden: find across Termux or /data/data."
                        },
                        alpine: {
                            type: "BOOLEAN",
                            description: "true = Alpine (default). If Alpine fails with proot/libtalloc, the tool returns a clear error — switch to native FS tools."
                        }
                    },
                    required: ["command"]
                }
            },
            {
                name: "open_terminal",
                description: "Open/reuse shared visible Agent Terminal (createServer → Alpine). Only for long-running processes (npm run dev, servers). Not for quick ls/cat.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        command: { type: "STRING", description: "Optional command after open, e.g. 'cd /sdcard/myproject && npm start'" },
                        isAlpine: { type: "BOOLEAN", description: "true = Alpine createServer (default)." }
                    },
                    required: []
                }
            },
            {
                name: "close_terminal",
                description: "Close the shared Agent Terminal.",
                parameters: { type: "OBJECT", properties: {} }
            },
            {
                name: "detect_package_manager",
                description: "Detect package manager ONCE (apk on Alpine). Result is cached. Do not call every step.",
                parameters: { type: "OBJECT", properties: {} }
            }
        ];
    }

    static async executeTool(functionCall) {
        const { name, args = {} } = functionCall || {};
        const t0 = Date.now();
        console.log(TAG, `executeTool -> ${name}`, args);

        try {
            const allowTerm = ConfigManager.get('agentAllowTerminal');
            const isTerminalAllowed = allowTerm === null ? true : (allowTerm === true || allowTerm === 'true');

            if (!isTerminalAllowed && (name === 'run_shell_command' || name === 'open_terminal' || name === 'detect_package_manager')) {
                return { error: "Security Restriction: Terminal access is disabled by the user in Agent Settings." };
            }

            let result;
            switch (name) {
                case 'run_shell_command':
                    result = await this.runShellCommand(args.command, args.alpine !== false);
                    break;
                case 'open_terminal':
                    result = await this.openSharedTerminal(args.command, args.isAlpine !== false);
                    break;
                case 'close_terminal':
                    result = this.closeSharedTerminal();
                    break;
                case 'detect_package_manager':
                    result = await this.detectPackageManager();
                    break;
                default:
                    result = { error: `Unknown tool: ${name}` };
            }

            console.log(TAG, `executeTool <- ${name} (${Date.now() - t0}ms)`, {
                success: result?.success,
                error: result?.error ? String(result.error).slice(0, 200) : undefined,
                stdoutLen: result?.stdout != null ? String(result.stdout).length : 0
            });
            return result;
        } catch (e) {
            console.error(TAG, `executeTool threw for ${name} (${Date.now() - t0}ms):`, e);
            return { error: e.message || String(e) };
        }
    }

    /** Reject commands that will hang or scan forbidden trees / outside selected workspace. */
    static _validateCommand(command) {
        if (!command || typeof command !== 'string') {
            return { ok: false, error: "Missing 'command' argument." };
        }
        const cmd = command.trim();
        if (!cmd) return { ok: false, error: "Empty command." };

        if (FORBIDDEN_PATH_RE.test(cmd)) {
            return {
                ok: false,
                error: "BLOCKED: Command references forbidden paths (Termux /data/data /home/node_modules). Agent only allows /sdcard and /storage/emulated/0. Re-run with a narrow sdcard path, or use native FS tools."
            };
        }

        // Multi-root find without a single project subfolder
        if (/\bfind\b/i.test(cmd)) {
            if (FORBIDDEN_FIND_ROOTS_RE.test(cmd) || /find\s+[^;&|]*\/data/i.test(cmd)) {
                return {
                    ok: false,
                    error: "BLOCKED: find under /data or Termux is not allowed. Use find /sdcard/<folder> -maxdepth 2 ... | head"
                };
            }
            // find /sdcard /storage/... (two roots) without maxdepth → slow
            if (BROAD_FIND_RE.test(cmd) && !/-maxdepth\s+[1-3]\b/.test(cmd)) {
                return {
                    ok: false,
                    error: "BLOCKED: Broad multi-root find without -maxdepth 1-3. Use: find /sdcard/MyProject -maxdepth 2 -type f 2>/dev/null | head -40"
                };
            }
            if (!/-maxdepth\s+\d+/.test(cmd) && !/\|?\s*head\b/.test(cmd)) {
                return {
                    ok: false,
                    error: "BLOCKED: find without -maxdepth and without | head. Always: find /sdcard/<dir> -maxdepth 2 ... 2>/dev/null | head -40"
                };
            }
        }

        return { ok: true };
    }

    /** Sync workspace check used from executeTool (async-safe). */
    /**
     * Rewrite /sdcard/game5 → /sdcard/Ay/game5 when workspace is Ay/game5
     */
    static async _rewriteWorkspaceShellPaths(command) {
        let cmd = String(command || '');
        try {
            const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
            const { AgentSession } = await import('../../utils/agent/AgentSession.js');
            let chatId = null;
            try { chatId = ProjectWorkspace.activeChatId?.(window.gptApp || window.app) ?? null; } catch (_) {}
            if (chatId == null) chatId = window.gptApp?.currentConversationIndex ?? window.app?.currentConversationIndex ?? null;
            const list = ProjectWorkspace.list(chatId);
            if (!list.length) return cmd;
            for (const w of list) {
                const shell = AgentSession.contentUrlToShellPath(w.url);
                const name = (w.name || '').trim();
                if (!shell || !name) continue;
                if (cmd.includes(shell)) continue;
                // Plain string rewrite: /sdcard/game5 → /sdcard/Ay/game5
                const wrong1 = '/sdcard/' + name;
                const wrong2 = '/storage/emulated/0/' + name;
                if (cmd.includes(wrong1) && shell !== wrong1) {
                    cmd = cmd.split(wrong1).join(shell);
                    console.log('[AcodeTerminalAgent] rewritten', wrong1, '→', shell);
                } else if (cmd.includes(wrong2)) {
                    const shell2 = shell.replace('/sdcard/', '/storage/emulated/0/');
                    cmd = cmd.split(wrong2).join(shell2);
                    console.log('[AcodeTerminalAgent] rewritten', wrong2, '→', shell2);
                }
            }
        } catch (e) {
            console.warn('[AcodeTerminalAgent] rewrite paths', e);
        }
        return cmd;
    }

    static async _workspaceShellCheck(command) {

        try {
            const { ProjectWorkspace } = await import('../../utils/ProjectWorkspace.js');
            const { ConfigManager } = await import('../../utils/ConfigManager.js');
            const chatId = ConfigManager.get('current_chat_index', 'default') ?? 'default';
            const list = ProjectWorkspace.list(chatId);
            if (!list.length) return { ok: true };

            const cmd = String(command || '');
            // Derive readable path tails from workspace urls for matching
            const roots = list.map(w => {
                let s = String(w.url || '');
                if (s.includes('::')) s = s.slice(s.lastIndexOf('::') + 2);
                s = s.replace(/^primary:/i, '').replace(/^\/+/, '');
                const name = (w.name || s.split('/').filter(Boolean).pop() || '').trim();
                return { name, tail: s, url: w.url };
            }).filter(r => r.name || r.tail);

            // find /storage/emulated/0 or /sdcard without project subfolder
            if (/\bfind\b/i.test(cmd)) {
                const hitsRootOnly =
                    /find\s+(\/storage\/emulated\/0|\/sdcard)(\s|$)/i.test(cmd) &&
                    !roots.some(r => r.name && cmd.includes(r.name));
                if (hitsRootOnly) {
                    const hint = roots.map(r => `/sdcard/${r.name}`).join(' or ');
                    return {
                        ok: false,
                        error: `BLOCKED: Project workspace is locked for this chat. Do not scan all of /sdcard. Use only: ${hint}. Prefer list_directory / read_file with the workspace content:// url.`
                    };
                }
            }

            // Any path-like argument outside workspace names (soft: only hard-block find/ls deep roots)
            if (/\b(find|ls|rm|mv|cp)\b/i.test(cmd)) {
                const mentionsAnyRoot = roots.some(r =>
                    (r.name && cmd.includes(r.name)) ||
                    (r.tail && cmd.includes(r.tail))
                );
                const mentionsBroad = /\/storage\/emulated\/0|\/sdcard\b/i.test(cmd);
                if (mentionsBroad && !mentionsAnyRoot) {
                    const hint = roots.map(r => r.name || r.tail).join(', ');
                    return {
                        ok: false,
                        error: `BLOCKED: Shell must stay inside selected workspace(s): ${hint}. Use native FS tools with the workspace url instead of scanning /sdcard.`
                    };
                }
            }
            return { ok: true };
        } catch (_) {
            return { ok: true };
        }
    }


    /** mkdir -p via native FS (Alpine often has no cd). Paths relative to project. */
    static async mkdirViaNativeFs(command) {
        const m = String(command || '').match(/^\s*mkdir\s+(-p\s+)?(.+)$/i);
        if (!m) return null;
        let rest = m[2].trim();
        // strip cd && prefix already handled by caller
        rest = rest.replace(/[;&].*$/, '').trim();
        if (!rest) return null;
        try {
            const { getProjectFolder, createFolder, joinSafPath, normalizeSafUrl } = await import('../../utils/file/fileOperations.js');
            const project = await getProjectFolder();
            if (!project?.uri) return { success: false, error: 'No project folder for mkdir' };
            const root = normalizeSafUrl(project.uri);
            const paths = rest.split(/\s+/).filter(Boolean);
            const made = [];
            for (let raw of paths) {
                raw = raw.replace(/^["']|["']$/g, '');
                // strip absolute junk to relative under project name
                let rel = raw;
                if (project.name) {
                    const pn = project.name.toLowerCase();
                    const lower = rel.toLowerCase().replace(/\\/g, '/');
                    const idx = lower.lastIndexOf('/' + pn + '/');
                    if (idx !== -1) rel = rel.slice(idx + pn.length + 2);
                    else if (lower.endsWith('/' + pn) || lower === pn) rel = '';
                }
                rel = rel.replace(/^\/+/, '').replace(/^\.\//, '');
                if (!rel || rel === '.') continue;
                // create nested segments
                const segs = rel.split('/').filter(Boolean);
                let parent = root;
                for (const seg of segs) {
                    const res = await createFolder(parent, seg, { overwrite: true });
                    parent = res?.url ? normalizeSafUrl(res.url) : joinSafPath(parent, seg);
                }
                made.push(rel);
            }
            if (!made.length) return { success: true, stdout: 'mkdir: nothing to create (project root)', viaFs: true };
            return {
                success: true,
                stdout: made.map(p => `OK mkdir ${p}`).join('\n'),
                viaFs: true,
                message: 'Created folders via native FS (shell mkdir skipped).'
            };
        } catch (e) {
            return { success: false, error: e.message || String(e), viaFs: true };
        }
    }


    static async runShellCommand(command, alpine = true) {
        command = await this._rewriteWorkspaceShellPaths(command);
        const check = this._validateCommand(command);
        if (!check.ok) {
            console.warn(TAG, 'command blocked:', check.error, '| cmd=', command);
            return { success: false, error: check.error, blocked: true };
        }
        const wsCheck = await this._workspaceShellCheck(command);
        if (!wsCheck.ok) {
            console.warn(TAG, 'workspace blocked:', wsCheck.error, '| cmd=', command);
            return { success: false, error: wsCheck.error, blocked: true };
        }

        // Alpine often has no `cd` — pure mkdir goes through native FS
        const bare = String(command || '').trim().replace(/^(?:cd\s+[^;&]+&&\s*)+/i, '');
        if (/^\s*mkdir/i.test(bare) && !/[|><]/.test(bare)) {
            const via = await this.mkdirViaNativeFs(bare);
            if (via) {
                console.log(TAG, 'mkdir via FS', via.success, via.stdout || via.error);
                return via;
            }
        }

        if (typeof window.Executor === 'undefined' && !terminal?.Executor) {
            return {
                success: false,
                error: "Executor API is not available. Use native FS tools (create_or_update_file, create_file_tree, etc.) instead."
            };
        }

        const executor = window.Executor || terminal.Executor;
        // Prefer shorter timeout so agent does not sit on loading for minutes
        const timeoutSec = ConfigManager.get('agentTerminalTimeout') !== null
            ? parseInt(ConfigManager.get('agentTerminalTimeout'))
            : 15;
        const timeoutMs = Math.max(5, timeoutSec) * 1000;
        const t0 = Date.now();

        console.log(TAG, `runShellCommand start alpine=${alpine} timeout=${timeoutSec}s cmd=`, command.slice(0, 180));

        try {
            const stdout = await Promise.race([
                executor.execute(command, alpine),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error(`Command timed out after ${timeoutSec}s. Narrow the command (sdcard + maxdepth + head) or use open_terminal / native FS tools.`)),
                    timeoutMs
                ))
            ]);

            let out = typeof stdout === 'string' ? stdout : String(stdout);
            console.log(TAG, `runShellCommand ok (${Date.now() - t0}ms) stdoutLen=${out.length}`);

            // Verify + FS fallback for write commands (Alpine often returns success without writing real /sdcard)
            const writes = parseHeredocWrites(command);
            if (writes.length > 0) {
                const applied = [];
                let allOk = true;
                for (const w of writes) {
                    // Shell verify
                    let exists = false;
                    let size = 0;
                    try {
                        const checkCmd = `test -f "${w.path}" && wc -c < "${w.path}" || echo MISSING`;
                        const checkOut = await Promise.race([
                            executor.execute(checkCmd, alpine),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('verify timeout')), 8000))
                        ]);
                        const line = String(checkOut || '').trim();
                        if (line && !/MISSING/i.test(line)) {
                            size = parseInt(line, 10) || 0;
                            exists = size > 0;
                        }
                    } catch (ve) {
                        console.warn(TAG, 'verify failed', ve?.message || ve);
                    }

                    if (exists) {
                        applied.push({ path: w.path, success: true, size, via: 'shell' });
                        continue;
                    }

                    console.warn(TAG, 'shell write not visible on disk, FS fallback:', w.path);
                    const fb = await writeViaNativeFs(w.path, w.content);
                    applied.push({ path: w.path, ...fb, contentLen: w.content.length });
                    if (!fb.success) allOk = false;
                }

                const viaFs = applied.some(a => a.via === 'native_fs' && a.success);
                const msgLines = applied.map(a =>
                    a.success
                        ? `OK ${a.path} (${a.via}${a.size != null ? ', ' + a.size + 'b' : ''})`
                        : `FAIL ${a.path}: ${a.error || 'unknown'}`
                );
                out = (out ? out + '\n' : '') + msgLines.join('\n');

                if (!allOk) {
                    return {
                        success: false,
                        stdout: out,
                        error: 'Shell reported success but file missing; native FS fallback also failed for some paths.',
                        applied,
                        hint: 'Use create_or_update_file / create_file_tree with the open project content:// url from list_open_project_folders.'
                    };
                }
                return {
                    success: true,
                    stdout: out || (viaFs ? 'Wrote via native FS fallback' : 'Verified on disk'),
                    applied,
                    verified: true,
                    viaFs
                };
            }

            return { success: true, stdout: out };
        } catch (e) {
            const msg = (e && e.message) || String(e);
            console.error(TAG, `runShellCommand fail (${Date.now() - t0}ms):`, msg.slice(0, 300));

            // On shell hard-fail, still try FS fallback for heredoc writes
            const writes = parseHeredocWrites(command);
            if (writes.length > 0) {
                const applied = [];
                let anyOk = false;
                for (const w of writes) {
                    const fb = await writeViaNativeFs(w.path, w.content);
                    applied.push({ path: w.path, ...fb });
                    if (fb.success) anyOk = true;
                }
                if (anyOk) {
                    console.log(TAG, 'FS fallback after shell error recovered', applied.length, 'file(s)');
                    return {
                        success: true,
                        stdout: applied.map(a => a.success ? `OK FS ${a.path}` : `FAIL ${a.path}`).join('\n'),
                        applied,
                        verified: true,
                        viaFs: true,
                        shellError: msg
                    };
                }
            }

            const brokenAlpine = /libproot|libtalloc|init-sandbox|inaccessible or not found|Permission denied|cd: not found|exec:.*cd:/i.test(msg);
            return {
                success: false,
                error: msg,
                brokenAlpine: brokenAlpine || undefined,
                hint: brokenAlpine
                    ? "Shell cannot run cd/mkdir in this environment. Do NOT retry shell. Use native tools: create_folder, write, create_file_tree with relative paths like css/style.css (project root is already set)."
                    : "Retry only with a narrow /sdcard path, or use native FS tools."
            };
        }
    }

    static async detectPackageManager() {
        try {
            const cached = localStorage.getItem(PKG_CACHE_KEY);
            if (cached && ['apk', 'apt', 'pkg', 'unknown'].includes(cached)) {
                console.log(TAG, 'detect_package_manager cache hit:', cached);
                return {
                    success: true,
                    packageManager: cached,
                    cached: true,
                    message: `Cached package manager: ${cached}. Do not detect again this session.`
                };
            }

            // Tiny probe only — no find, no path walks
            const probe = `command -v apk >/dev/null 2>&1 && echo apk || (command -v apt >/dev/null 2>&1 && echo apt || (command -v pkg >/dev/null 2>&1 && echo pkg || echo unknown))`;
            const res = await this.runShellCommand(probe, true);
            let pm = 'unknown';
            if (res && res.success && res.stdout) {
                const line = String(res.stdout).trim().split(/\s+/)[0].toLowerCase();
                if (['apk', 'apt', 'pkg'].includes(line)) pm = line;
            } else if (res && res.brokenAlpine) {
                localStorage.setItem(PKG_CACHE_KEY, 'unknown');
                return {
                    success: false,
                    packageManager: 'unknown',
                    error: res.error,
                    hint: res.hint
                };
            }
            localStorage.setItem(PKG_CACHE_KEY, pm);
            console.log(TAG, 'detect_package_manager result:', pm);
            return {
                success: true,
                packageManager: pm,
                cached: false,
                message: pm === 'apk'
                    ? 'Alpine: use apk add <pkg>'
                    : pm === 'apt'
                        ? 'Use apt install <pkg>'
                        : pm === 'pkg'
                            ? 'Use pkg install <pkg>'
                            : 'No known package manager. Prefer native FS tools if shell is limited.'
            };
        } catch (e) {
            return { success: false, packageManager: 'unknown', error: e.message || String(e) };
        }
    }

    static async openSharedTerminal(command, isAlpine = true) {
        if (!terminal) return { error: "Terminal module is not available." };

        if (command) {
            const check = this._validateCommand(command);
            if (!check.ok) {
                console.warn(TAG, 'open_terminal command blocked:', check.error);
                return { success: false, error: check.error, blocked: true };
            }
        }

        const name = "Agent Terminal";
        let activeTerminalId = localStorage.getItem(STORAGE_KEY);
        let activeTerminal = null;

        if (activeTerminalId) {
            activeTerminal = terminal.get(activeTerminalId);
            if (!activeTerminal) {
                localStorage.removeItem(STORAGE_KEY);
                activeTerminalId = null;
            }
        }

        if (!activeTerminal) {
            const allTerminals = terminal.getAll && terminal.getAll();
            if (allTerminals) {
                for (const [id, termInfo] of allTerminals.entries()) {
                    if (termInfo && termInfo.name === name) {
                        activeTerminal = terminal.get(id);
                        activeTerminalId = id;
                        localStorage.setItem(STORAGE_KEY, id);
                        break;
                    }
                }
            }

            if (!activeTerminal) {
                try {
                    console.log(TAG, 'creating shared terminal isAlpine=', isAlpine);
                    activeTerminal = isAlpine
                        ? await terminal.createServer({ name, theme: 'dark' })
                        : await terminal.createLocal({ name, theme: 'dark' });
                    activeTerminalId = activeTerminal.id;
                    localStorage.setItem(STORAGE_KEY, activeTerminalId);
                    await new Promise(resolve => setTimeout(resolve, 400));
                } catch (e) {
                    return { error: "Failed to create terminal: " + (e.message || String(e)) };
                }
            }
        }

        if (command) {
            const line = (command.endsWith('\r') || command.endsWith('\n')) ? command : command + '\r';
            terminal.write(activeTerminalId, line);
        }

        return {
            success: true,
            terminalId: activeTerminalId,
            message: `Shared Terminal ready (${name}). Output visible in UI.`
        };
    }

    static closeSharedTerminal() {
        if (!terminal) return { error: "Terminal module is not available." };
        const idToClose = localStorage.getItem(STORAGE_KEY);
        if (idToClose) {
            try {
                if (terminal.get(idToClose)) terminal.close(idToClose);
            } catch (err) { /* ignore */ }
        }
        localStorage.removeItem(STORAGE_KEY);
        return { success: true, message: "Shared terminal closed." };
    }
}
