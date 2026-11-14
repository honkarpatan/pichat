// src/main/core/handler/LiveChatUI.js
import { Formatter } from '../utils/Formatter.js'; 
import { hasBalancedCodeBlocks, addCopyButton } from '../utils/editor/CodeBlockHelper.js'; 
import { ensureGroup, getOrCreateCard, paintCard } from '../utils/file/FileCards.js';
import { diffView } from '../utils/file/DiffUtil.js'; 
import { HeldWrites } from '../utils/file/HeldWrites.js'; 
import {
  buildActionDetailsHtml,
  collapseAgentLog,
  AGENT_COLLAPSE_CSS,
  actionSummary,
  formatWorkedDuration,
  isInternalAction,
  renderAgentLogHtml
} from '../utils/agent/AgentActionUI.js';

import { PART_STATUS, upsertToolPart, upsertFilePart, upsertPlanPart, upsertReadCoveragePart } from '../utils/message/MessagePart.js';
import { estimateTotalLines, rangesFromLineEdit, rangesFromFullFileDiff, looksLikeNonFileContent } from '../utils/file/FileCoverage.js';
import { paintUpsertResult } from '../utils/message/PartsRenderer.js'; 

const TASK_COMPLETE_MARKER = /\s*TASK_COMPLETED\s*$/;

function taskCompleteBadgeHtml() {
  return `<div class="gpt-task-complete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Task completed</span></div>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class LiveChatUI {
    constructor(app) {
        this.app = app;
        this.nowThinking = false;
        // Status line under live assistant (rate-limit countdown, etc.)
        this._setStatusRef = (turn, text) => {
            try {
                if (app.chatHandler && typeof app.chatHandler._setTurnStatus === 'function') {
                    app.chatHandler._setTurnStatus(turn, text);
                }
            } catch (_) {}
        };
        // Stream UI throttle — full markdown on every token freezes Acode's main thread
        this._liveRaf = null;
        this._livePending = null;
        this._liveLastPaint = 0;
        this._liveMinIntervalMs = 120; // \\~8 fps max during stream
    }

    injectImageActionGlobals() {
        if (!window.gptImageActionsInjected) {
            window.gptPreviewImage = (url) => {
                let overlay = document.createElement('div');
                overlay.style = "position:fixed; top=0; left=0; width=100vw; height=100vh; background:rgba(0,0,0,0.85); z-index:999999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); cursor:zoom-out; opacity=0; transition:opacity 0.3s ease;";
                let img = document.createElement('img');
                img.src = url;
                img.style = "max-width:90%; max-height:90%; border-radius:12px; box-shadow:0 15px 40px rgba(0,0,0,0.6); object-fit:contain; transform:scale(0.9); transition:transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);";
                overlay.appendChild(img);
                document.body.appendChild(overlay);
                requestAnimationFrame(() => { overlay.style.opacity = '1'; img.style.transform = 'scale(1)'; });
                overlay.onclick = () => {
                    overlay.style.opacity = '0';
                    img.style.transform = 'scale(0.9)';
                    setTimeout(() => overlay.remove(), 300);
                };
            };
            window.gptDownloadImage = async (pathOrUrl) => {
                try {
                    if (typeof window.toast === 'function') window.toast('Downloading image...', 2000);
                    if (pathOrUrl.startsWith('file:///')) {
                        const fs = acode.require("fs");
                        const downloadDir = 'file:///storage/emulated/0/Download';
                        const destFs = fs(downloadDir);
                        if (await destFs.exists()) {
                            await fs(pathOrUrl).copyTo(downloadDir);
                            if (typeof window.toast === 'function') window.toast(`Saved to Downloads folder!`, 2000);
                            return; 
                        }
                    } 
                    const a = document.createElement('a');
                    a.href = pathOrUrl;
                    a.download = `Aicode_Generated_Image_${Date.now()}.png`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                } catch(e) {}
            };
            window.gptImageActionsInjected = true;
        }
    }

    createMessageElement(role) {
        const el = document.createElement('div');
        el.className = `gpt-message ${role}-message`;
        return el;
    }

    /**
     * Throttled live paint. Full markdown+DOM on every token freezes Acode's main thread.
     * @param {boolean} [force=false] final flush after stream ends
     */
    updateLiveUI(botMessage, messageContainer, typingDot, botMessageElement, autoScrollEnabled, force = false) {
        this._livePending = { botMessage, messageContainer, typingDot, botMessageElement, autoScrollEnabled };

        const run = () => {
            this._liveRaf = null;
            const p = this._livePending;
            if (!p) return;
            this._liveLastPaint = Date.now();
            this._paintLiveUI(p.botMessage, p.messageContainer, p.typingDot, p.botMessageElement, p.autoScrollEnabled, !!force);
        };

        if (force) {
            if (this._liveRaf) {
                cancelAnimationFrame(this._liveRaf);
                this._liveRaf = null;
            }
            run();
            return;
        }

        const elapsed = Date.now() - this._liveLastPaint;
        if (elapsed >= this._liveMinIntervalMs) {
            if (this._liveRaf) cancelAnimationFrame(this._liveRaf);
            this._liveRaf = requestAnimationFrame(run);
        } else if (!this._liveRaf) {
            const wait = this._liveMinIntervalMs - elapsed;
            this._liveRaf = requestAnimationFrame(() => {
                setTimeout(run, Math.max(0, wait));
            });
        }
    }

    /** Lightweight stream render: skip heavy post-processors until fences balance / force */
    _paintLiveUI(botMessage, messageContainer, typingDot, botMessageElement, autoScrollEnabled, isFinal) {
        const thinkMatch = botMessage.match(/<think>/gi);
        const thinkCloseMatch = botMessage.match(/<\/think>/gi);
        const isCurrentlyThinking = thinkMatch && (!thinkCloseMatch || thinkMatch.length > thinkCloseMatch.length);

        if (isCurrentlyThinking && !this.nowThinking) {
            this.updateAssistantMessage(true, 'Thinking deeply...');
            this.nowThinking = true;
        } else if (!isCurrentlyThinking && this.nowThinking) {
            this.updateAssistantMessage(false, '');
            this.nowThinking = false;
        }

        let parsedMessage = botMessage;
        parsedMessage = parsedMessage.replace(/@@@AGENT_ACTIONS@@@[\s\S]*?@@@END_AGENT_ACTIONS@@@\n*/g, '');

        let canvasTriggersHtml = '';
        const canvasRegex = /@@@CANVAS_FILE@@@(.*?)@@@(.*?)@@@END_CANVAS_FILE@@@\n*/g;
        let match;
        while ((match = canvasRegex.exec(parsedMessage)) !== null) {
            const url = decodeURIComponent(match[1] || '');
            const label = decodeURIComponent(match[2]||'Preview').replace(/"/g, '&quot;');
            if (url) {
                canvasTriggersHtml += `<button type="button" class="gpt-canvas-eye gpt-canvas-trigger" data-mode="file" data-src="\( {url.replace(/"/g, '&quot;')}" data-title=" \){label}" title="Preview ${label}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>`;
            }
        }
        parsedMessage = parsedMessage.replace(canvasRegex, '').trim();

        let taskCompleted = false;
        if (TASK_COMPLETE_MARKER.test(parsedMessage)) {
            taskCompleted = true;
            parsedMessage = parsedMessage.replace(TASK_COMPLETE_MARKER, '').trim();
        }

        const balanced = hasBalancedCodeBlocks(botMessage);
        // During long unbalanced streams, avoid full markdown (Prism/md) — plain pre escape
        if (!isFinal && !balanced && botMessage.length > 4000) {
            const esc = this._escapeHtml(parsedMessage);
            {
            let logEl = messageContainer.querySelector('.gpt-agent-log');
            const body = `<pre class="gpt-stream-plain" style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;margin:0;opacity:.9">${esc}</pre>` +
                canvasTriggersHtml + (taskCompleted ? taskCompleteBadgeHtml() : '');
            if (logEl) {
              messageContainer.innerHTML = '';
              messageContainer.appendChild(logEl);
              const prose = document.createElement('div');
              prose.className = 'gpt-stream-prose';
              prose.innerHTML = body;
              messageContainer.appendChild(prose);
            } else {
              messageContainer.innerHTML = body;
            }
            }
            if (typingDot) messageContainer.appendChild(typingDot);
            if (autoScrollEnabled && this.app.chatBox) {
                this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
            }
            return;
        }

        if (this.app.md && typeof this.app.md.render === 'function') parsedMessage = this.app.md.render(parsedMessage);
        if (typeof this.app.parseImageLinks === 'function') parsedMessage = this.app.parseImageLinks(parsedMessage);
        else if (Formatter && typeof Formatter.parseImageLinks === 'function') parsedMessage = Formatter.parseImageLinks(parsedMessage);

        if (typeof this.app.replaceThinkDivTags === 'function') parsedMessage = this.app.replaceThinkDivTags(parsedMessage);
        else if (Formatter && typeof Formatter.replaceThinkDivTags === 'function') parsedMessage = Formatter.replaceThinkDivTags(parsedMessage);

        // Keep agent work log above prose; never wipe it when streaming text
        let logEl = messageContainer.querySelector('.gpt-agent-log');
        let proseEl = messageContainer.querySelector('.gpt-stream-prose');
        if (!proseEl) {
          proseEl = document.createElement('div');
          proseEl.className = 'gpt-stream-prose';
        }
        proseEl.innerHTML = parsedMessage + canvasTriggersHtml + (taskCompleted ? taskCompleteBadgeHtml() : '');
        if (logEl) {
          messageContainer.innerHTML = '';
          messageContainer.appendChild(logEl);
          messageContainer.appendChild(proseEl);
        } else {
          messageContainer.innerHTML = '';
          messageContainer.appendChild(proseEl);
        }
        if (typingDot) messageContainer.appendChild(typingDot);

        try {
          this.app.popupManager?.setupImagePopup?.();
          this.app.popupManager?.tagChatImages?.(messageContainer);
        } catch (_) {}

        if (canvasTriggersHtml.length > 0 && this.app.canvasManager) this.app.canvasManager.bindTriggers(messageContainer);

        // Professional gpt-code-view shell as soon as closed fences exist (same as final render)
        if (typeof addCopyButton === 'function') {
            try { addCopyButton(messageContainer); } catch (_) {}
        }

        if (this.app.chatRenderer) {
            if (typeof this.app.chatRenderer._addHtmlPreviewTriggers === 'function') this.app.chatRenderer._addHtmlPreviewTriggers(messageContainer);
            // Collapse on the prose node (headings live here), not messageContainer wrapper
            const collapseMd = this.app.chatRenderer.shouldCollapseMarkdownHeaders
                ? this.app.chatRenderer.shouldCollapseMarkdownHeaders(null)
                : true;
            if (collapseMd && typeof this.app.chatRenderer._convertHeadingsToCollapsibleSections === 'function') {
                const target = proseEl || messageContainer.querySelector('.gpt-stream-prose') || messageContainer;
                this.app.chatRenderer._convertHeadingsToCollapsibleSections(target);
            }
        }

        if (autoScrollEnabled && this.app.chatBox) {
            this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
            const thinkBox = messageContainer.querySelector('.gpt-think-content');
            if (thinkBox) thinkBox.scrollTop = thinkBox.scrollHeight;
        }
    }

    /** Call once when stream ends so final markdown + copy buttons apply */
    flushLiveUI(botMessage, messageContainer, typingDot, botMessageElement, autoScrollEnabled) {
        this.updateLiveUI(botMessage, messageContainer, typingDot, botMessageElement, autoScrollEnabled, true);
    }

    _escapeHtml(str) {
    return String(str || '').replace(
        /[&<>"']/g,
        c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c])
    );
}

    _generateDiffHtml(fcName, args) {
        if (!args) return '';

        // search_replace_edit → show each search/replace as -/+ line blocks
        if (fcName === 'search_replace_edit') {
            const edits = args.edits || [];
            if (!edits.length) return '';
            let rowsHtml = '';
            edits.slice(0, 12).forEach((ed, i) => {
                const searchLines = String(ed.search || '').split('\n').slice(0, 20);
                const replaceLines = String(ed.replace || '').split('\n').slice(0, 20);
                searchLines.forEach(line => {
                    rowsHtml += `<div class="gpt-diff-row gpt-diff-del"><span class="gpt-diff-ln">-</span><span class="gpt-diff-sign">-</span><span class="gpt-diff-text">${this._escapeHtml(line)}</span></div>`;
                });
                if (ed.replace === '') {
                    rowsHtml += `<div class="gpt-diff-row gpt-diff-del"><span class="gpt-diff-ln">-</span><span class="gpt-diff-sign">-</span><span class="gpt-diff-text"><em>removed</em></span></div>`;
                } else {
                    replaceLines.forEach(line => {
                        rowsHtml += `<div class="gpt-diff-row gpt-diff-add"><span class="gpt-diff-ln">+</span><span class="gpt-diff-sign">+</span><span class="gpt-diff-text">${this._escapeHtml(line)}</span></div>`;
                    });
                }
                if (i < edits.length - 1) {
                    rowsHtml += `<div class="gpt-diff-row gpt-diff-sep"><span class="gpt-diff-text">···</span></div>`;
                }
            });
            return `
            <div class="gpt-diff-view">
                <div class="gpt-diff-header">Edit · ${(args.path || 'file').split('/').pop()} · ${edits.length} change(s)</div>
                <div class="gpt-diff-content">${rowsHtml}</div>
            </div>`;
        }

        if (fcName === 'edit_file_lines') {
            const lines = args.lines || [];
            if (lines.length === 0) return '';
            let rowsHtml = lines.sort((a, b) => a.line - b.line).map(l => {
                const isDel = l.text === '';
                const txt = isDel ? 'Line removed' : l.text;
                const cls = isDel ? 'gpt-diff-del' : 'gpt-diff-add';
                const sign = isDel ? '-' : '+';
                return `<div class="gpt-diff-row \( {cls}"><span class="gpt-diff-ln"> \){l.line}</span><span class="gpt-diff-sign">\( {sign}</span><span class="gpt-diff-text"> \){this._escapeHtml(txt)}</span></div>`;
            }).join('');
            return `
            <div class="gpt-diff-view">
                <div class="gpt-diff-header">Line edits</div>
                <div class="gpt-diff-content">${rowsHtml}</div>
            </div>`;
        }

        if (fcName === 'create_or_update_file') {
            const content = args.content || '';
            if (!content) return '';
            const preview = content.split('\n').slice(0, 40).map(line =>
                `<div class="gpt-diff-row gpt-diff-add"><span class="gpt-diff-sign">+</span><span class="gpt-diff-text">${this._escapeHtml(line)}</span></div>`
            ).join('');
            return `
            <div class="gpt-diff-view">
                <div class="gpt-diff-header">New / rewrite file</div>
                <div class="gpt-diff-content">${preview}</div>
            </div>`;
        }

        if (fcName === 'create_file_tree') {
            const nodes = args.nodes || [];
            if (!nodes.length) return '';
            const walk = (arr, depth) => arr.slice(0, 30).map(n => {
                const pad = depth * 12;
                const isDir = n.type === 'directory';
                const name = this._escapeHtml(n.name || '');
                return `<div class="gpt-file-row \( {isDir ? 'is-dir' : 'is-file'}" style="padding-left: \){8 + pad}px"><span class="gpt-file-name">${isDir ? '📁' : '📄'} \( {name}</span></div> \){isDir && n.children ? walk(n.children, depth + 1) : ''}`;
            }).join('');
            return `<div class="gpt-file-tree gpt-diff-view"><div class="gpt-diff-header">Scaffold</div>${walk(nodes, 0)}</div>`;
        }
        return '';
    }

    // ==================== নতুন adapter methods (পুরোনো সব replace করুন) ====================

    resetAgentClock() {
        const turn = this.app._currentTurn;
        if (!turn) return;
        turn.clockStartedAt = Date.now();
        turn.clockActiveMs = 0;
        turn.clockSegmentStart = Date.now();
        this._lastAgentDurationSec = null;
    }

    pauseAgentClock() {
        const turn = this.app._currentTurn;
        if (!turn) return;
        if (turn.clockSegmentStart) {
            turn.clockActiveMs += (Date.now() - turn.clockSegmentStart);
            turn.clockSegmentStart = null;
        }
        // Freeze live "Working for Xs" header while waiting Accept/Reject
        try {
            const shell = turn.holder?.querySelector?.(':scope > .gpt-oc-work')
              || turn.holder?.querySelector?.('.gpt-oc-work');
            if (shell) {
                shell._workPaused = true;
                shell.classList.add('is-paused');
                if (shell._workStartedAt && shell._workPausedAt == null) {
                    shell._workAccumMs = (shell._workAccumMs || 0) + (Date.now() - shell._workStartedAt);
                    shell._workPausedAt = Date.now();
                    // freeze displayed time
                    const title = shell.querySelector('.gpt-oc-work-title');
                    if (title) {
                        const sec = Math.max(0, Math.floor((shell._workAccumMs || 0) / 1000));
                        const m = Math.floor(sec / 60);
                        const s = sec % 60;
                        title.textContent = m > 0
                          ? `Working for ${m}m ${s}s (paused)`
                          : `Working for ${s}s (paused)`;
                    }
                }
                turn.renderer?._stopWorkTimer?.(shell);
            }
        } catch (_) {}
    }

    resumeAgentClock() {
        const turn = this.app._currentTurn;
        if (!turn) return;
        turn.clockSegmentStart = Date.now();
        try {
            const shell = turn.holder?.querySelector?.(':scope > .gpt-oc-work');
            if (shell) {
                shell._workPaused = false;
                shell._workPausedAt = null;
                shell._workStartedAt = Date.now();
                shell.classList.add('is-working');
                turn.renderer?._startWorkTimer?.(shell);
                turn.renderer?._tickWorkTitle?.(shell);
            }
        } catch (_) {}
    }

    finalizeAgentLog() {
        const turn = this.app._currentTurn;
        if (!turn) return;
        let sec = null;
        if (turn.clockActiveMs > 0) sec = Math.max(1, Math.round(turn.clockActiveMs / 1000));
        else if (turn.clockStartedAt) sec = Math.max(1, Math.round((Date.now() - turn.clockStartedAt) / 1000));
        if (sec != null && sec > 1800) sec = 1800;
        this._lastAgentDurationSec = sec;

        // Mark plan card done so it loses sticky before next message
        try {
            const planPart = (turn.parts || []).find(p => p.type === 'plan' || p.fcName === 'todo_write');
            if (planPart) {
                planPart.status = PART_STATUS.DONE;
                turn.renderer.upsert(planPart);
            }
        } catch (_) {}

        turn.renderer.finalizeWorkShell(turn.holder, sec);
        // Global safety: no leftover sticky plans from earlier turns
        try { turn.renderer._releaseAllPlanSticky?.(document.getElementById('chat-box') || document); } catch (_) {}
    }

    /** Single entry point — AgentRunner / PendingWriteGate / SequentialFileGate এখন call করে */
  
  /**
   * Append reasoning delta / finalize thinking card on the live turn (Plan 3 T1).
   * @param {{ delta?: string, text?: string, done?: boolean, id?: string, redacted?: boolean, signature?: string, provider?: string }} opts
   */
  async pushThinking(opts = {}) {
    try {
      const turn = this.turn || this._currentTurn;
      if (!turn) return;
      if (!Array.isArray(turn.parts)) turn.parts = [];
      const {
        appendThinkingDelta,
        finalizeThinkingPart,
        upsertThinkingPart,
        PART_STATUS
      } = await import('../utils/message/MessagePart.js');
      const { paintUpsertResult } = await import('../utils/message/PartsRenderer.js');
      const id = opts.id || 'thinking';
      let result;
      if (opts.delta) {
        result = appendThinkingDelta(turn.parts, opts.delta, { id, provider: opts.provider });
      } else if (opts.text != null) {
        result = upsertThinkingPart(turn.parts, {
          id,
          text: opts.text,
          status: opts.done ? PART_STATUS.DONE : PART_STATUS.STREAMING,
          provider: opts.provider,
          signature: opts.signature,
          redactedData: opts.redacted ? (opts.redactedData || '1') : undefined,
          endedAt: opts.done ? Date.now() : undefined
        });
      } else if (opts.done) {
        result = finalizeThinkingPart(turn.parts, {
          id,
          signature: opts.signature,
          redacted: opts.redacted,
          redactedData: opts.redactedData
        });
        if (result.part) result = { part: result.part, sealed: null };
      }
      try {
        if (turn.holder && turn.renderer?.mountWorkShell) {
          turn.renderer.mountWorkShell(turn.holder, { open: true, live: true });
        }
      } catch (_) {}
      if (result?.part && turn.renderer) {
        paintUpsertResult(turn, result);
      } else if (result?.part && turn.renderer?.scheduleUpsert) {
        turn.renderer.scheduleUpsert(result.part);
      }
      // Persist on message for history re-render
      try {
        if (turn.message) turn.message.parts = turn.parts;
      } catch (_) {}
    } catch (e) {
      console.warn('[LiveChatUI] pushThinking', e);
    }
  }

  logAgentAction({ id, verb = '', target = '', status = 'running', url = null, oldContent = null, newContent = null,
                     fullPath = '', fcName = '', fcArgs = null, detail = null, kind = null, entries = null, fileTotalLines = null }) {
        const turn = this.app._currentTurn;
        if (!turn) return;

        turn.renderer.mountWorkShell(turn.holder, { open: true });
        // Interleave: close current Thought before this tool row (Thought → tool → Thought)
        try {
          const ch = this.app?.chatHandler;
          if (ch && turn) {
            ch._closeCurrentThinking?.(turn);
            ch._rotateThinkingId?.(turn);
          }
        } catch (_) {}


        const isFileWrite = oldContent != null || newContent != null ||
            ['write', 'str_replace', 'create_or_update_file', 'search_replace_edit',
             'edit_file_lines', 'create_file_tree'].includes(fcName);

        const partStatus = status === 'running' ? PART_STATUS.RUNNING
            : status === 'error' ? PART_STATUS.ERROR
            : status === 'rejected' ? PART_STATUS.REJECTED
            : (isFileWrite ? PART_STATUS.SAVED : PART_STATUS.DONE);

        let result;
        if (isFileWrite && (oldContent != null || newContent != null ||
            ['write', 'str_replace', 'create_or_update_file', 'search_replace_edit', 'edit_file_lines', 'create_file_tree'].includes(fcName))) {
            // Stable id by basename so stream-Writing and final Created share ONE row
            const pathForId = String(target || fullPath || '').split(/[/\\]/).filter(Boolean).pop() || '';
            const stableId = pathForId ? `file-${pathForId.toLowerCase()}` : id;
            let editRanges = [];
            let addRanges = [];
            let removeRanges = [];
            let safeOld = oldContent;
            let safeNew = newContent;
            try {
                if (looksLikeNonFileContent(safeOld)) safeOld = null;
                if (looksLikeNonFileContent(safeNew)) safeNew = null;
                const sArg = fcArgs && (fcArgs.start_line != null || fcArgs.startLine != null)
                  ? Number(fcArgs.start_line ?? fcArgs.startLine) || 1
                  : null;
                const eArg = fcArgs && (fcArgs.end_line != null || fcArgs.endLine != null)
                  ? Number(fcArgs.end_line ?? fcArgs.endLine) || sArg
                  : sArg;
                if (sArg != null) {
                    const built = rangesFromLineEdit({
                      start: sArg,
                      end: eArg != null ? eArg : sArg,
                      newContent: safeNew != null ? safeNew : (fcArgs.new_content ?? fcArgs.content ?? '')
                    });
                    removeRanges = built.removeRanges;
                    addRanges = built.addRanges;
                    editRanges = built.editRanges;
                } else if (safeOld != null && safeNew != null) {
                    // Line-accurate marks from real diff (not whole-file blue/green)
                    const built = rangesFromFullFileDiff(safeOld, safeNew);
                    removeRanges = built.removeRanges || [];
                    addRanges = built.addRanges || [];
                    editRanges = built.editRanges || [];
                }
            } catch (_) {}
            let fileTotalLines = estimateTotalLines({
              content: safeNew != null ? safeNew : safeOld,
              ranges: [...removeRanges, ...addRanges, ...editRanges],
              previousTotal: 0
            });
            if (safeOld != null && safeNew != null) {
              try {
                const builtT = rangesFromFullFileDiff(safeOld, safeNew);
                fileTotalLines = Math.max(fileTotalLines, builtT.fileTotalLines || 0);
                if (!removeRanges.length && !addRanges.length) {
                  removeRanges = builtT.removeRanges || [];
                  addRanges = builtT.addRanges || [];
                  editRanges = builtT.editRanges || [];
                }
              } catch (_) {}
            }
            result = upsertFilePart(turn.parts, {
                id: stableId,
                path: target || fullPath || pathForId,
                oldContent: safeOld,
                newContent: safeNew,
                url,
                fcName,
                fcArgs: fcArgs || null,
                verb,
                status: partStatus,
                editRanges,
                addRanges,
                removeRanges,
                kind: 'file-coverage',
                fileTotalLines
            });
            // Remove any orphan DOM rows for this file (stream or stuck running)
            try {
                const pathKey = String(target || fullPath || '').split(/[/\\]/).pop()?.toLowerCase();
                const keepId = result?.part?.id;
                if (pathKey && turn.renderer) {
                    for (const [pid, el] of [...(turn.renderer.map?.entries?.() || [])]) {
                        if (!el || pid === keepId) continue;
                        const meta = (el.getAttribute?.('data-path') ||
                          el.querySelector?.('.gpt-oc-row-meta')?.textContent || '')
                          .split(/[/\\]/).pop()?.toLowerCase() || '';
                        if (meta === pathKey) {
                            try { el.remove(); } catch (_) {}
                            turn.renderer.map.delete(pid);
                            turn.renderer._topEls?.delete?.(pid);
                        }
                    }
                    // parts[]: drop stream duplicates not equal to keepId
                    for (let i = turn.parts.length - 1; i >= 0; i--) {
                        const p = turn.parts[i];
                        if (p.id === keepId) continue;
                        const pPath = String(p.path || p.label || '').split(/[/\\]/).pop()?.toLowerCase() || '';
                        if (pPath === pathKey && (String(p.id || '').startsWith('stream-') ||
                            p.status === 'running' || p.status === 'streaming')) {
                            turn.parts.splice(i, 1);
                        }
                    }
                }
            } catch (_) {}
        } else {
            const isRead = fcName === 'read' || fcName === 'read_file' ||
              /^read(ing)?$/i.test(String(verb || ''));
            if (isRead) {
                let readRange = null;
                // Prefer disk totalLines from tool result (e.g. 709), NOT max(end)=165
                let totalForTrack = Math.max(0, Number(fileTotalLines) || 0);
                try {
                    const args = fcArgs || {};
                    let start = args.start_line ?? args.startLine ?? args.offset;
                    let end = args.end_line ?? args.endLine;
                    if (start != null && end == null && args.limit != null) {
                        end = Number(start) + Number(args.limit) - 1;
                    }
                    if (start != null || end != null) {
                        start = Math.max(1, Number(start) || 1);
                        end = Math.max(start, Number(end) || start);
                        readRange = { start, end };
                        // only use end as total if we truly don't know file length
                        if (!totalForTrack) totalForTrack = end;
                    } else if (detail) {
                        const n = String(detail).split(/\r?\n/).length;
                        readRange = { start: 1, end: Math.max(1, n) };
                        if (!totalForTrack) totalForTrack = n;
                    }
                } catch (_) {}
                result = upsertReadCoveragePart(turn.parts, {
                    id,
                    verb: verb || 'Read',
                    target,
                    label: target,
                    fcName: fcName || 'read',
                    kind: kind || 'file-coverage',
                    entries,
                    detail,
                    fcArgs,
                    fullPath,
                    fileTotalLines: totalForTrack || 0,
                    path: fullPath || target,
                    url,
                    status: partStatus,
                    readRange,
                    fileTotalLines
                });
            } else {
                result = upsertToolPart(turn.parts, {
                    id, verb, target, label: target, fcName, kind, entries, detail, fcArgs, fullPath, url, status: partStatus
                });
            }
        }
        if (!result?.part) return;
        paintUpsertResult(turn, result);
        if (this.app.chatBox) this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
    }

    /** Plan / todo_write card — same seal→paint path as tool/file parts */
    logPlanUpdate(items) {
        const turn = this.app._currentTurn;
        if (!turn) return;
        const result = upsertPlanPart(turn.parts, items, { id: 'plan' });
        paintUpsertResult(turn, result);
        if (this.app.chatBox) this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
    }

    /**
     * Natural live paint while the model streams tool-call JSON
     * (write/str_replace args). No fake typing — only real partial args.
     */
    logStreamingToolArgs(partial) {
        const turn = this.app._currentTurn;
        if (!turn || !partial) return;

        const name = partial.name || '';
        const raw = String(partial.argsString || '');
        if (!raw || raw.length < 8) return;

        // Extract path + growing content/replace from incomplete JSON
        let path = '';
        const pathM = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (pathM) {
            try { path = pathM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'); } catch (_) { path = pathM[1]; }
        }

        let partialNew = null;
        for (const key of ['content', 'replace', 'new_content']) {
            const re = new RegExp(`"${key}"\\s*:\\s*"`);
            const m = re.exec(raw);
            if (!m) continue;
            let i = m.index + m[0].length;
            let out = '';
            while (i < raw.length) {
                const ch = raw[i];
                if (ch === '\\') {
                    if (i + 1 >= raw.length) break;
                    const n = raw[i + 1];
                    if (n === 'n') out += '\n';
                    else if (n === 't') out += '\t';
                    else if (n === '"') out += '"';
                    else if (n === '\\') out += '\\';
                    else out += n;
                    i += 2;
                    continue;
                }
                if (ch === '"') break;
                out += ch;
                i++;
            }
            partialNew = out;
            break;
        }

        // Stable id by basename — same as final logAgentAction (never Writing + Created)
        const short = (path || 'file').split(/[/\\]/).pop() || 'file';
        const streamId = `file-${short.toLowerCase()}`;
        turn.renderer.mountWorkShell(turn.holder, { open: true });

        if (partialNew == null || partialNew.length < 4) {
            if (!path) return;
            const result = upsertFilePart(turn.parts, {
                id: streamId,
                path: short,
                oldContent: '',
                newContent: '',
                fcName: name,
                verb: 'Writing',
                status: PART_STATUS.RUNNING
            });
            if (result?.part) paintUpsertResult(turn, result);
            return;
        }

        const result = upsertFilePart(turn.parts, {
            id: streamId,
            path: short,
            oldContent: '',
            newContent: partialNew,
            fcName: name,
            verb: 'Writing',
            status: PART_STATUS.STREAMING
        });
        if (result?.part) paintUpsertResult(turn, result);
        if (this.app.chatBox) this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
    }

    /**
     * Accept/Reject gate — thin bar fixed just above #input-container so user
     * never has to scroll up to find buttons (write card may be off-screen).
     * NEVER auto-grants when auto-exec is off.
     */
    async askForPermission(fc, actionId) {
        try {
            const { getPermissionMode } = await import('../agent/harness/MutationGate.js');
            const mode = getPermissionMode();
            // executeAndLogTool already decided needPrompt; if UI is called, still allow legacy auto
            if (mode === 'full') return { granted: true };
            const { ConfigManager } = await import('../utils/ConfigManager.js');
            const raw = ConfigManager.get('agentAutoExecuteWrites');
            const autoExec = raw === true || raw === 'true' || raw === 1 || raw === '1';
            if (autoExec && mode !== 'ask') return { granted: true };
        } catch (_) {}

        const turn = this.app._currentTurn;
        const pathHint = String(fc?.args?.path || fc?.args?.sourcePath || '').split(/[/\\]/).pop() || '';
        const toolName = String(fc?.name || 'write');

        // Highlight matching card in chat if present (optional)
        try {
            const map = turn?.renderer?.map;
            if (map && pathHint) {
                for (const [, node] of map.entries()) {
                    if (!node) continue;
                    const meta = node.querySelector?.('.gpt-oc-row-meta')?.textContent?.toLowerCase() || '';
                    if (meta === pathHint.toLowerCase()) {
                        node.classList.add('gpt-awaiting-permission');
                        break;
                    }
                }
            }
        } catch (_) {}

        return new Promise((resolve) => {
            // Remove any previous sticky confirm bar
            document.getElementById('gpt-write-confirm-bar')?.remove();

            const bar = document.createElement('div');
            bar.id = 'gpt-write-confirm-bar';
            bar.setAttribute('role', 'dialog');
            bar.style.cssText = [
                'position:fixed',
                'left:0',
                'right:0',
                'z-index:9999',
                'display:flex',
                'align-items:center',
                'justify-content:space-between',
                'gap:10px',
                'padding:8px 12px',
                'background:var(--secondary-color,#1e1e2e)',
                'border-top:1px solid var(--border-color,#333)',
                'box-shadow:0 -4px 16px rgba(0,0,0,0.25)',
                'font-size:12px',
                'color:var(--primary-text-color,#eee)',
                'width: auto !important'
            ].join(';');

            const label = pathHint || toolName;
            bar.innerHTML = `
              <div style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                <span style="opacity:0.7;">Confirm write</span>
                <b style="margin-left:6px;">${String(label).replace(/</g, '&lt;')}</b>
                <span style="opacity:0.5;margin-left:6px;font-size:10px;">${toolName.replace(/</g, '&lt;')}</span>
              </div>
              <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">
                <button type="button" class="gpt-btn-reject" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border-color,#555);background:transparent;color:var(--primary-text-color);cursor:pointer;">Reject</button>
                <button type="button" class="gpt-btn-always" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border-color,#555);background:transparent;color:var(--primary-text-color);cursor:pointer;font-size:11px;" title="Save allow pattern for this project">Always allow</button>
                <button type="button" class="gpt-btn-accept" style="padding:6px 14px;border-radius:8px;border:none;background:rgba(85, 102, 255, 0.333);color:#fff;cursor:pointer;font-weight:600;">Accept</button>
              </div>
            `;

            const placeBar = () => {
                const input = document.getElementById('input-container');
                if (input) {
                    const r = input.getBoundingClientRect();
                    bar.style.bottom = `${Math.max(0, window.innerHeight - r.top)}px`;
                    bar.style.left = `${Math.max(0, r.left)}px`;
                    bar.style.right = `${Math.max(0, window.innerWidth - r.right)}px`;
                    bar.style.width = 'auto';
                } else {
                    bar.style.bottom = '56px';
                    bar.style.left = '0';
                    bar.style.right = '0';
                }
            };
            const inputEl = document.getElementById('input-container');
            if (inputEl && inputEl.parentElement) {
                bar.style.position = 'relative';
                bar.style.bottom = 'auto';
                bar.style.left = 'auto';
                bar.style.right = 'auto';
                bar.style.width = '100%';
                bar.style.zIndex = '50';
                inputEl.parentElement.insertBefore(bar, inputEl);
            } else {
                document.body.appendChild(bar);
                placeBar();
            }
            const onResize = () => {
                if (!inputEl || !inputEl.parentElement || !inputEl.parentElement.contains(bar)) placeBar();
            };
            window.addEventListener('resize', onResize);

            const close = (result) => {
                window.removeEventListener('resize', onResize);
                try { bar.remove(); } catch (_) {}
                try {
                    document.querySelectorAll('.gpt-awaiting-permission').forEach(n => n.classList.remove('gpt-awaiting-permission'));
                } catch (_) {}
                resolve(result);
            };
            bar.querySelector('.gpt-btn-reject').onclick = () => close({ granted: false });
            bar.querySelector('.gpt-btn-accept').onclick = () => close({ granted: true });
            const alwaysBtn = bar.querySelector('.gpt-btn-always');
            if (alwaysBtn) {
                alwaysBtn.onclick = async () => {
                    try {
                        const { suggestPattern, addAllowPattern } = await import('../agent/harness/PatternPermissions.js');
                        const pat = suggestPattern(toolName, fc?.args || {});
                        const res = await addAllowPattern(pat);
                        if (typeof window.toast === 'function') {
                            window.toast(res?.success ? `Allowed: ${pat}` : (res?.error || 'Failed'), 2500);
                        }
                    } catch (e) {
                        console.warn('[LiveChatUI] always allow', e);
                    }
                    close({ granted: true, always: true });
                };
            }
        });
    }

    /**
     * Structured questionnaire for ask_user_question tool.
     * @param {Array} questions - parsed questions from AskUserAgent
     * @returns {Promise<{ cancelled: boolean, answers: Array }>}
     */
    async askUserQuestions(questions) {
        const list = Array.isArray(questions) ? questions : [];
        if (!list.length) return { cancelled: true, answers: [], error: 'no questions' };

        return new Promise((resolve) => {
            document.getElementById('gpt-ask-user-bar')?.remove();

            const bar = document.createElement('div');
            bar.id = 'gpt-ask-user-bar';
            bar.setAttribute('role', 'dialog');
            bar.style.cssText = [
                'position:relative',
                'z-index:50',
                'width:100%',
                'box-sizing:border-box',
                'padding:10px 12px',
                'background:var(--secondary-color,#1e1e2e)',
                'border-top:1px solid var(--border-color,#333)',
                'box-shadow:0 -4px 16px rgba(0,0,0,0.25)',
                'color:var(--primary-text-color,#eee)',
                'font-size:12px',
                'max-height:45vh',
                'overflow:auto'
            ].join(';');

            const answers = {}; // qid -> { labels: string[], custom?: string }

            let html = `<div style="font-size:11px;opacity:0.55;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:8px;">Agent is asking</div>`;
            list.forEach((q, qi) => {
                const qid = q.id || `q_${qi}`;
                html += `<div class="gpt-ask-q" data-qid="${qid}" style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border-color,#333);">`;
                if (q.header) html += `<div style="font-size:10px;opacity:0.5;margin-bottom:2px;">${String(q.header).replace(/</g, '&lt;')}</div>`;
                html += `<div style="font-weight:600;margin-bottom:6px;">${String(q.question).replace(/</g, '&lt;')}</div>`;
                html += `<div class="gpt-ask-opts" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">`;
                (q.options || []).forEach((o) => {
                    const oid = o.id || o.label;
                    html += `<button type="button" class="gpt-ask-opt" data-qid="${qid}" data-oid="${String(oid).replace(/"/g, '')}" data-label="${String(o.label).replace(/"/g, '&quot;')}" data-multi="${q.multiSelect ? '1' : '0'}"
                      style="padding:6px 10px;border-radius:8px;border:1px solid var(--border-color,#555);background:transparent;color:inherit;cursor:pointer;font-size:11px;text-align:left;max-width:100%;">
                      <b>${String(o.label).replace(/</g, '&lt;')}</b>
                      ${o.description ? `<div style="opacity:0.55;font-weight:400;margin-top:2px;">${String(o.description).replace(/</g, '&lt;')}</div>` : ''}
                    </button>`;
                });
                html += `</div>`;
                html += `<input type="text" class="gpt-ask-custom" data-qid="${qid}" placeholder="Or type your answer…"
                  style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--border-color,#444);background:var(--popup-background-color,#16161e);color:inherit;font-size:12px;" />`;
                html += `</div>`;
            });
            html += `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
                <button type="button" class="gpt-ask-skip" style="padding:7px 14px;border-radius:8px;border:1px solid var(--border-color,#555);background:transparent;color:inherit;cursor:pointer;">Skip</button>
                <button type="button" class="gpt-ask-submit" style="padding:7px 16px;border-radius:8px;border:none;background:var(--button-background-color,#4b5dd1);color:#fff;cursor:pointer;font-weight:600;">Submit</button>
              </div>`;
            bar.innerHTML = html;

            const inputEl = document.getElementById('input-container');
            if (inputEl && inputEl.parentElement) {
                inputEl.parentElement.insertBefore(bar, inputEl);
            } else {
                document.body.appendChild(bar);
            }

            const selected = {}; // qid -> Set of labels
            list.forEach((q, qi) => {
                const qid = q.id || `q_${qi}`;
                selected[qid] = new Set();
            });

            bar.querySelectorAll('.gpt-ask-opt').forEach(btn => {
                btn.onclick = () => {
                    const qid = btn.getAttribute('data-qid');
                    const label = btn.getAttribute('data-label');
                    const multi = btn.getAttribute('data-multi') === '1';
                    if (!multi) {
                        selected[qid] = new Set([label]);
                        bar.querySelectorAll(`.gpt-ask-opt[data-qid="${qid}"]`).forEach(b => {
                            b.style.background = 'transparent';
                            b.style.borderColor = 'var(--border-color,#555)';
                        });
                        btn.style.background = 'var(--button-background-color,#4b5dd1)';
                        btn.style.borderColor = 'var(--button-background-color,#4b5dd1)';
                    } else {
                        if (selected[qid].has(label)) selected[qid].delete(label);
                        else selected[qid].add(label);
                        const on = selected[qid].has(label);
                        btn.style.background = on ? 'var(--button-background-color,#4b5dd1)' : 'transparent';
                        btn.style.borderColor = on ? 'var(--button-background-color,#4b5dd1)' : 'var(--border-color,#555)';
                    }
                };
            });

            const close = (result) => {
                try { bar.remove(); } catch (_) {}
                resolve(result);
            };

            bar.querySelector('.gpt-ask-skip').onclick = () => close({ cancelled: true, answers: [], skipped: true });
            bar.querySelector('.gpt-ask-submit').onclick = () => {
                const out = [];
                list.forEach((q, qi) => {
                    const qid = q.id || `q_${qi}`;
                    const custom = bar.querySelector(`.gpt-ask-custom[data-qid="${qid}"]`)?.value?.trim() || '';
                    const labels = [...(selected[qid] || [])];
                    out.push({
                        id: qid,
                        question: q.question,
                        selected: labels,
                        custom: custom || undefined,
                        answer: custom || labels.join(', ') || null
                    });
                });
                close({ cancelled: false, answers: out });
            };
        });
    }


    /**
     * Temporary shining work-title rail: "Rate limited — retrying in 5s…"
     * Falls back to status line if no work shell.
     */
    setRateLimitRail(message, { active = true } = {}) {
        // Prefer single collapsible row (same as Read/Edited) — no title+status double UI
        try {
            const title = document.querySelector('.assistant-message:last-child .gpt-oc-work-title') ||
                document.querySelector('.gpt-oc-work-title');
            if (title) {
                title.classList.remove('gpt-rail-shine');
                if (title.dataset.gptRailOrig) {
                    title.textContent = title.dataset.gptRailOrig;
                    delete title.dataset.gptRailOrig;
                }
            }
            this.updateAssistantMessage(false, '', 0);
            if (active && message) {
                this.logAgentAction({
                    id: 'rate-limit-retry',
                    verb: String(message).replace(/^Rate limited — /i, '').replace(/…/g, '').trim() || 'Retrying',
                    target: '',
                    status: 'running',
                    fcName: 'rate_limit_retry',
                    kind: 'status',
                    detail: 'reason: rate limited'
                });
            }
        } catch (_) {}
    }

    /** Status line replaces the old floating typing-dot text. */
    async updateAssistantMessage(show, messages = 'Loading...', showUntil = 1000) {
        const turn = this.app._currentTurn;
        const setMsg = (msg) => { if (turn && this._setStatusRef) this._setStatusRef(turn, msg); };
        const clrMsg = () => { if (turn && this._setStatusRef) this._setStatusRef(turn, null); };
        // Cancel any pending auto-clear from a previous status
        if (this._statusClearTimer) {
            clearTimeout(this._statusClearTimer);
            this._statusClearTimer = null;
        }
        if (show) {
            if (typeof messages === 'string') {
                setMsg(messages);
                // Auto-clear after showUntil so "Running canvas preview…" never sticks forever
                const ms = Math.max(0, Number(showUntil) || 0);
                if (ms > 0) {
                    this._statusClearTimer = setTimeout(clrMsg, ms);
                }
                return true;
            }
            for (let i = 0; i < messages.length; i++) {
                setMsg(messages[i]);
                await new Promise(res => setTimeout(res, 300 + Math.random() * 500));
            }
            const ms = Math.max(0, Number(showUntil) || 0);
            if (ms > 0) this._statusClearTimer = setTimeout(clrMsg, ms);
        } else {
            if (Number(showUntil) <= 0) clrMsg();
            else this._statusClearTimer = setTimeout(clrMsg, showUntil);
        }
        return true;
    }
}