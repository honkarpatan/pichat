/**
 * Send / stop / API stream orchestration
 * @module core/chat/ChatSendFlow
 */
import { ChatUI } from '../../ui/ChatUI.js';
import { PreFlight } from '../../handler/PreFlight.js';
import { ContextBuilder } from '../../handler/ContextBuilder.js';
import { ModelConfig } from '../../model/ModelConfig.js';
import { ImageGenerationHandler } from '../../handler/ImageGenerationHandler.js';
import { LiveChatUI } from '../../ui/LiveChatUI.js';
import { ApiRouter } from '../../handler/ApiRouter.js';
import { TitleGenerator } from '../../handler/TitleGenerator.js';
import { SearchEvaluator } from '../../handler/SearchEvaluator.js';
import { StreamFileCollector } from '../../utils/file/StreamFileCollector.js';
import { AgentSession } from '../../utils/agent/AgentSession.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { requestApplyMarkdown } from '../../utils/file/PendingWriteGate.js';
import { PartsRenderer, paintUpsertResult } from '../../utils/message/PartsRenderer.js';
import { PART_STATUS, appendTextChunk, sealStreamingText, upsertFilePart, compactParts, appendThinkingDelta, finalizeThinkingPart } from '../../utils/message/MessagePart.js';
import { ThinkingStreamParser } from '../../model/thinking/ThinkingStreamParser.js';
import { modelSupportsNativeThink, canUseThinkingUi, isForceNonNativeThinkingEnabled } from '../../model/thinking/ThinkCapability.js';
import { Formatter } from '../../utils/Formatter.js';
import { looksLikeFixRequest, FAST_DEBUG_MARKER } from '../../agent/main/AgentPlanning.js';
import { addCopyButton } from '../../utils/editor/CodeBlockHelper.js';
import { scheduleResumeBannerCheck } from '../../ui/ResumeBanner.js';

import {
  _deriveLegacyFromParts,
  _formatTurnActionsSummary,
  _contentToText,
  _estimateTokens
} from './ChatApiContext.js';

// Compatibility alias for inlined ChatHandler._* calls
const ChatHandler = {
  _deriveLegacyFromParts,
  _formatTurnActionsSummary,
  _contentToText,
  _estimateTokens
};

export const methods = {
  async handleSendMessage(isResend = null, opts = {}) {
    let regenerate = !!(opts && opts.regenerate);

    // Read input FIRST — if agent is running, queue as steering (do NOT abort the run)
    let userInput = isResend !== null ? isResend : (document.getElementById('gpt-user-input')?.value || '').trim();
    if (userInput === '' && isResend === null) {
      return;
    }

    if (this.app.isFetching && !regenerate && !opts?.skipSteering) {
      if (isResend === null) {
        try {
          const el = document.getElementById('gpt-user-input');
          if (el) el.value = '';
          if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
        } catch (_) {}
      }
      try {
        const {
          enqueueSteering, enqueueFollowUp
        } = await import('../../agent/harness/SteeringQueue.js');
        const { ConfigManager } = await import('../../utils/ConfigManager.js');
        const mode = String(ConfigManager.get('agentQueueMode') || 'steer').toLowerCase();
        const forceFollow =
          mode === 'followup' ||
          mode === 'follow-up' ||
          /^\s*>>/.test(userInput) ||
          /^\s*\/follow\b/i.test(userInput);
        const text = forceFollow
          ? userInput.replace(/^\s*>>\s*/, '').replace(/^\s*\/follow\b\s*/i, '').trim()
          : userInput;
        const r = forceFollow
          ? enqueueFollowUp(this.app, text || userInput)
          : enqueueSteering(this.app, userInput);
        if (!r.ok) {
          const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
          await pushChatEvent(this.app, r.error || 'Could not queue message');
        }
      } catch (e) {
        console.warn('[ChatHandler] steering/follow-up queue', e);
      }
      return;
    }

    this.app._isMessageTransactionActive = true;
    this.app.currentRequestController = new AbortController();
    if (typeof this.app.modelManager?.setActiveChat === 'function') {
      this.app.modelManager.setActiveChat(parseInt(this.app.currentConversationIndex));
    }

    this.app.optimize = (this.app.selectedModel && this.app.selectedModel.type === 'ollama');
    this.app.invokeToImageGenerate = { model: null };
    this.app.web_results = '';

    if (isResend === null) {
      try {
        document.getElementById('gpt-user-input').value = '';
        if (typeof window.fixInputHeight === 'function') window.fixInputHeight();
      } catch (_) {}
    }
    if (userInput === '') {
      this.app._isMessageTransactionActive = false;
      return;
    }

    // Slash commands: /undo /redo /path /settings — not sent as chat
    try {
      const { tryHandleSlashCommand } = await import('../../ui/chatInput/SlashCommands.js');
      if (await tryHandleSlashCommand(this.app, userInput)) {
        this.app._isMessageTransactionActive = false;
        try {
          const el = document.getElementById('gpt-user-input');
          if (el) el.value = '';
        } catch (_) {}
        return;
      }
    } catch (_) {}

    try {
      const { ChatInputEvents } = await import('../../ui/chatInput/ChatInputEvents.js');
      ChatInputEvents.dismissAgentProjectWarning?.();
    } catch (_) {}

    const modelType = this.app.selectedModel?.type?.toLowerCase() || '';
    const config = ModelConfig[modelType] || {};
    const supportsImages = config.supportsImages || false;

    if (this.app.chatInputUI?.states?.imageGen && config.supportsImageGeneration) {
      await ImageGenerationHandler.run(this, userInput, config, modelType);
      return;
    }

    let finalHiddenContext = "";
    try {
      const thinkOn = !!(this.app?.chatInputUI?.states?.think);
      const native = modelSupportsNativeThink(this.app);
      const force = isForceNonNativeThinkingEnabled(this.app);
      this.app._injectSimulatedThinkPrompt = !!(thinkOn && !native && force);
    } catch (_) {
      this.app._injectSimulatedThinkPrompt = false;
    }

    // Simulated think markers: system prompt only (getSystemInstruction), never user hidden_context.

    if (this.app.isEnableAgentMode) {
      if (looksLikeFixRequest(userInput)) {
        finalHiddenContext += `[SYSTEM: ${FAST_DEBUG_MARKER} ENABLED]
This is a targeted fix/modification on an existing project:
1. INSPECT: Check [Project File Tree] and [Project Memory], then call 'read' on the affected file(s).
2. PLAN: For multi-issue fixes, call 'todo_write' with a short checklist.
3. PATCH SAFELY: Use 'str_replace' or 'edit_file_lines' (with start_line, end_line, new_content) to modify ONLY the relevant lines. Never overwrite existing files with 'write'.
4. MEMORY: Call 'update_project_memory' if you changed architecture or key functions.\n\n`;
      } else {
        finalHiddenContext += `[SYSTEM: AGENT DEVELOPMENT MODE]
- Check [Project File Tree] and [Project Memory] first.
- For EXISTING files: call 'read' first, then use 'str_replace' or 'edit_file_lines'. The 'write' tool is strictly blocked on existing files.
- For brand NEW files: use 'write'.
- Call 'update_project_memory' to record the project structure and changes in 'project_memory.md' before calling 'finish_task'.\n\n`;
      }
    }

    if (this.app.attachedFiles && this.app.attachedFiles.length > 0) {
      let fileContext = "";
      this.app.attachedFiles.forEach(file => {
        if (file.type === 'text') fileContext += `[Attached File: ${file.name}]\n${file.data}\n\n`;
      });
      if (fileContext) finalHiddenContext += `[User Attached Files Context]\n${fileContext}`;
    }

    try {
      const { buildAtMentionContext } = await import('../../ui/chatInput/FileMention.js');
      const atCtx = await buildAtMentionContext(userInput);
      if (atCtx) finalHiddenContext += (finalHiddenContext ? '\n\n' : '') + atCtx;
    } catch (_) {}
    try {
      const { getPasteChipsContext, clearPasteChips } = await import('../../ui/chatInput/PasteChips.js');
      const pasteCtx = getPasteChipsContext(this.app);
      if (pasteCtx) {
        finalHiddenContext += (finalHiddenContext ? '\n\n' : '') + pasteCtx;
        clearPasteChips(this.app);
      }
    } catch (_) {}

    this.app.web_results = finalHiddenContext.trim() !== "" ? finalHiddenContext.trim() : null;
    this.app._pendingWebSearchQuery = null;
    try {
      if (this.app.isEnableWebBrowsing) {
        const { shouldAutoWebSearch } = await import('../../handler/SearchEvaluator.js');
        if (shouldAutoWebSearch(userInput, this.app)) {
          this.app._pendingWebSearchQuery = userInput;
        }
      }
    } catch (_) {
      // fallback: never force entire userInput as search in agent mode
      if (this.app.isEnableWebBrowsing && !this.app.isEnableAgentMode) {
        this.app._pendingWebSearchQuery = userInput;
      }
    }

    let contentForHistory = userInput;
    const attached = this.app.attachedFiles || [];
    const imagesToAttach = attached.filter(f => f.type === 'image');
    const filesToAttach = attached.filter(f => f.type === 'text' || f.type === 'file');
    // Always persist attachments on the user message so edit/regenerate can restore them
    if (imagesToAttach.length > 0 || filesToAttach.length > 0) {
      contentForHistory = [{ type: 'text', text: userInput }];
      imagesToAttach.forEach((img, i) => {
        contentForHistory.push({
          type: 'image_url',
          image_url: { url: img.data },
          name: img.name || `image_${i + 1}`
        });
      });
      filesToAttach.forEach((f) => {
        contentForHistory.push({
          type: 'file',
          name: f.name || 'file',
          text: typeof f.data === 'string' ? f.data : String(f.data || '')
        });
      });
    }

    // Regenerate / edit-branch: history already has the user row — do not duplicate it
    if (!regenerate) {
      const draft = this.app._editDraft;
      if (draft && draft.userIdx != null) {
        // ChatGPT-style branch: keep old version + its lower chats; start new version
        try {
          const { BranchHistory } = await import('../../utils/agent/BranchHistory.js');
          // Keep full multimodal content (text + images + files) on the user message
          const newContent = (imagesToAttach.length || filesToAttach.length)
            ? contentForHistory
            : (typeof contentForHistory === 'string'
                ? contentForHistory
                : (Array.isArray(contentForHistory)
                    ? (contentForHistory.find(x => x?.type === 'text')?.text || draft.text || userInput)
                    : (draft.text || userInput)));
          BranchHistory.commitEdit(this.app, draft.userIdx, newContent);
          try {
            const { HistoryFileOps } = await import('../../history/HistoryFileOps.js');
            await HistoryFileOps.saveActiveChat(this.app);
          } catch (_) {}
          await this.app.chatHistoryManager?.renderChatHistory?.();
          regenerate = true; // skip adding another user message
        } catch (e) {
          console.warn('[edit branch]', e);
          try {
            if (this.app.chatHistoryManager?.deleteFrom) {
              await this.app.chatHistoryManager.deleteFrom(draft.userIdx);
            }
          } catch (_) {}
          await this.app.chatHistoryManager.addMessageToHistory('user', contentForHistory, null, this.app.web_results, true, false);
        try {
          const { recordRewindPoint } = await import('./SessionRewind.js');
          recordRewindPoint(this.app, String(userInput || '').slice(0, 64));
        } catch (_) {}
        }
        this.app._editDraft = null;
        try { document.getElementById('gpt-edit-draft-bar')?.remove(); } catch (_) {}
        try {
          this.app.chatBox?.querySelectorAll?.('.gpt-message[data-edit-hidden="1"]').forEach(el => el.remove());
        } catch (_) {}
      } else {
        this.app._editDraft = null;
        try { document.getElementById('gpt-edit-draft-bar')?.remove(); } catch (_) {}
        await this.app.chatHistoryManager.addMessageToHistory('user', contentForHistory, null, this.app.web_results, true, false);
        try {
          const { recordRewindPoint } = await import('./SessionRewind.js');
          recordRewindPoint(this.app, String(userInput || '').slice(0, 64));
        } catch (_) {}
      }
    }
    if (regenerate) {
      // Refresh hidden context on the existing last user turn if present
      try {
        const chat = this.app.chatHistory;
        const last = chat && chat[chat.length - 1];
        if (last?.role === 'user' && this.app.web_results) {
          last.hidden_context = this.app.web_results;
        }
      } catch (_) {}
    }

    const allowChatWithoutPath = this.app.settingsStore
      ? this.app.settingsStore.getBool('continueWOpath', false)
      : (this.app.continueWOpath === 'true');

    if (!this.app.pathUrl && !allowChatWithoutPath) {
      ChatUI.toggleStopBtnLoading(false);
      if (!window.gptSetStoragePath) {
        window.gptSetStoragePath = async () => { if (this.app.storageManager) await this.app.storageManager.setPath(); };
      }
      let primaryInfo = `To save your chat history, please <span id="gpt-add-directory" style="color:#56aedd; text-decoration:underline; cursor:pointer; font-weight:bold;">click here to add a storage directory</span>.`;
      this.app._isMessageTransactionActive = false;
      const { makeErrorMessage } = await import('../../utils/message/MessageSchema.js');
      await this.app.chatHistoryManager.addMessageToHistory('assistant', makeErrorMessage('assistant', `<p style="color:#ff9611;">${primaryInfo}</p>`), null, null, false, false);
      const gptAddDirectory = document.getElementById('gpt-add-directory');
      if (gptAddDirectory) gptAddDirectory.addEventListener('click', async () => await this.app.storageManager.setPath());
      return;
    }

    if (this.app.chatHistoryManager && typeof this.app.chatHistoryManager.renderChatHistory === 'function') {
      await this.app.chatHistoryManager.renderChatHistory(true, false);
      try {
        const { HeldWrites } = await import('../../utils/file/HeldWrites.js');
        HeldWrites.showBatchUI(this.app);
      } catch (_) {}
    }

    this.app.isFetching = false;
    this.app.attachedFiles = [];
    const previewContainer = document.getElementById('previewContainer');
    if (previewContainer) previewContainer.innerHTML = '';

    await this.sendMessageToApi(userInput);
    if (this.app.chatHistoryManager) this.app.chatHistoryManager.updateCurrentConversationIndex();
    this._setTurnStatus(this.app._currentTurn, null);
  },

  async handleStopFetching() {
    try {
      this.app._userRequestedStop = true;
      this.app._abortReason = 'user';
    } catch (_) {}
    // Stop rate-limit countdown UI immediately
    try {
      const { cancelRateLimitRetry } = await import('../../utils/network/RateLimitRetry.js');
      cancelRateLimitRetry(this.app);
    } catch (_) {}
    // Freeze Working-for timer on the live turn
    try {
      const turn = this.app._currentTurn;
      if (turn?.holder && turn?.renderer) {
        let sec = 1;
        if (turn.clockSegmentStart) {
          turn.clockActiveMs = (turn.clockActiveMs || 0) + (Date.now() - turn.clockSegmentStart);
          turn.clockSegmentStart = null;
        }
        if (turn.clockActiveMs > 0) sec = Math.max(1, Math.round(turn.clockActiveMs / 1000));
        else if (turn.clockStartedAt) sec = Math.max(1, Math.round((Date.now() - turn.clockStartedAt) / 1000));
        else {
          const shell = turn.holder.querySelector?.(':scope > .gpt-oc-work');
          if (shell?._workStartedAt) {
            const accum = shell._workAccumMs || 0;
            sec = Math.max(1, Math.floor((accum + (Date.now() - shell._workStartedAt)) / 1000));
          }
        }
        turn._workDurationSec = sec;
        turn.renderer.finalizeWorkShell?.(turn.holder, sec);
        // Belt-and-suspenders: clear is-working on any shell in chat
        document.querySelectorAll('.gpt-oc-work.is-working').forEach((sh) => {
          try {
            turn.renderer._stopWorkTimer?.(sh);
            sh.classList.remove('is-working');
          } catch (_) {}
        });
      } else {
        document.querySelectorAll('.gpt-oc-work.is-working').forEach((sh) => {
          try {
            if (sh._workTimer) { clearInterval(sh._workTimer); sh._workTimer = null; }
            sh.classList.remove('is-working');
          } catch (_) {}
        });
      }
    } catch (_) {}
    if (this.app.currentRequestController) this.app.currentRequestController.abort();
    ChatUI.updateSendStopBtn(this.app, 'stop');
  },

  async sendMessageToApi(message, regenHelper) {
    if (this.app.isFetching) return;
    this.app.isFetching = true;
    this.app._lastRequestUsageRecorded = false;
    try {
      this.app._userRequestedStop = false;
      this.app._abortReason = null;
      this.app._currentRunId = 'run-' + Date.now();
    } catch (_) {}
    // Drop previous provider's rate-limit countdown so it never paints on the new run
    try {
      const { cancelRateLimitRetry } = await import('../../utils/network/RateLimitRetry.js');
      cancelRateLimitRetry(this.app);
    } catch (_) {}


    let apiMessages = [];
    let systemText = '';
    let modelType = this.app.selectedModel?.type?.toLowerCase() || '';
    let config = ModelConfig[modelType] || {};

    const turn = this._beginTurn();
    ChatUI.updateSendStopBtn(this.app, 'run');

    try {
      await PreFlight.run(this.app, regenHelper);
      await ContextBuilder.build(this.app, message);

      modelType = this.app.selectedModel.type.toLowerCase();
      config = ModelConfig[modelType];
      const webQuery = this.app._pendingWebSearchQuery || message;
      this.app._pendingWebSearchQuery = null;
      if (this.app.isEnableWebBrowsing) {
        try {
          const webText = await SearchEvaluator.runLive(this.app, webQuery, config, turn);
          if (webText) {
            this.app.web_results = [this.app.web_results, webText].filter(Boolean).join('\n\n');
          }
        } catch (e) {
          console.warn('[ChatHandler] live web search', e);
        }
      }

      if (this.app.web_results && this.app.currentConversation.chat.length > 0) {
        const lastMsgIndex = this.app.currentConversation.chat.length - 1;
        if (this.app.currentConversation.chat[lastMsgIndex].role === 'user') {
          this.app.currentConversation.chat[lastMsgIndex].hidden_context = this.app.web_results;
        }
      }

      ({ apiMessages, systemText } = this._buildApiMessages(this.app.currentConversation.chat));
      modelType = this.app.selectedModel.type.toLowerCase();
      config = ModelConfig[modelType];

      // Only use StreamFileCollector when the selected model does NOT support native tool calls!
      const useCollector = !!(this.app.isEnableAgentMode && !config.supportsTools);
      const collector = useCollector ? new StreamFileCollector() : null;

      const routeResult = await ApiRouter.route(this.app, config, modelType, apiMessages, (chunk) => {
        if (collector) {
          const tick = collector.push(chunk);
          this._pushCollectorTick(turn, collector, tick);
        } else {
          this._pushText(turn, chunk);
        }
      }, systemText);

      if (collector && !routeResult?.filesHandled) {
        try {
          const md = (collector.files || []).map(f =>
            '```' + (f.lang || '') + ' file="' + f.path + '"\n' + f.content + '\n```'
          ).join('\n\n');
          if (md.trim()) {
            const autoApply = ConfigManager.get('agentAutoExecuteWrites') === 'true' || ConfigManager.get('agentAutoExecuteWrites') === true;
            await requestApplyMarkdown(this.app, md, {
              autoApply,
              onApplied: (row) => {
                const result = upsertFilePart(turn.parts, {
                  id: `file-${row.path}`, path: row.path,
                  oldContent: row.oldContent || '', newContent: row.newContent || '',
                  url: row.url, fcName: 'create_or_update_file',
                  status: row.success ? PART_STATUS.SAVED : PART_STATUS.ERROR,
                  verb: row.success ? 'Saved' : 'Save failed'
                });
                paintUpsertResult(turn, result);
                if (row.success) {
                  try { AgentSession.noteWrite(this.app.currentConversationIndex, { path: row.path, fileNames: [row.path] }); } catch (_) {}
                }
              }
            });
          }
        } catch (e) {
          console.error('[ChatHandler] pending write gate', e);
        }
      }

      this._finalizeTurn(turn);

    } catch (error) {
      this.app._isMessageTransactionActive = false;
      if (error.message === 'PRECHECK_FAILED') {
        sealStreamingText(turn.parts);
      } else if (error.name === 'AbortError') {
        // Keep [user, assistant_partial] so Regenerate never treats AI text as a new user bubble
        try {
          const { cancelRateLimitRetry } = await import('../../utils/network/RateLimitRetry.js');
          cancelRateLimitRetry(this.app);
        } catch (_) {}
        try { this._finalizeTurn(turn); } catch (_) { sealStreamingText(turn.parts); }
        const compactedAbort = compactParts(turn.parts);
        const { content, agentActions } = ChatHandler._deriveLegacyFromParts(compactedAbort);
        const partial = (content || '').trim();
        // Duration for history (avoid Working for 1s after refresh)
        let durationSec = turn._workDurationSec;
        if (durationSec == null) {
          if (turn.clockSegmentStart) {
            turn.clockActiveMs = (turn.clockActiveMs || 0) + (Date.now() - turn.clockSegmentStart);
            turn.clockSegmentStart = null;
          }
          if (turn.clockActiveMs > 0) durationSec = Math.max(1, Math.round(turn.clockActiveMs / 1000));
          else if (turn.clockStartedAt) durationSec = Math.max(1, Math.round((Date.now() - turn.clockStartedAt) / 1000));
        }
        if (durationSec != null) turn._workDurationSec = durationSec;
        // Always persist assistant first so event history order is user → assistant → event
        try {
          let historyPayload = partial || ' ';
          try {
            const { makeMessage, MSG_TYPE } = await import('../../utils/message/MessageSchema.js');
            historyPayload = makeMessage('assistant', {
              type: MSG_TYPE.TEXT,
              content: partial || ' ',
              parts: compactedAbort,
              agentActions: agentActions || null,
              durationSec: durationSec != null ? durationSec : undefined,
              agentDurationSec: durationSec != null ? durationSec : undefined,
              completedAt: Date.now()
            });
          } catch (_) {}
          await this.app.chatHistoryManager?.addMessageToHistory(
            'assistant',
            historyPayload,
            null, null, false, true, agentActions || null, turn.conversationIndex
          );
          turn._historySavedOnError = true;
        } catch (_) {}
        if (typeof ChatUI !== 'undefined' && typeof ChatUI.addLongPressListener === 'function') {
          const index = this.app.chatHistory.length - 1;
          const el = turn.botMessageElement;
          if (el) ChatUI.addLongPressListener(this.app, el, index, 'assistant');
        }
        try {
          const { classifyStopReason } = await import('../../utils/message/StopReason.js');
          const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
          const info = classifyStopReason(error, this.app);
          try { this.app._eventAfterEl = turn?.botMessageElement || null; } catch (_) {}
          await pushChatEvent(this.app, {
            text: info.event,
            type: info.code === 'user_stop' ? 'info' : 'error',
            action: (info.code === 'user_stop' || info.code === 'done') ? null : 'continue',
            continuePrompt: info.code === 'prompt_limit'
              ? 'Continue with a shorter plan. Prefer editing known files; do not re-dump large context.'
              : (info.code === 'credits'
                ? 'Continue from where you left off with minimal context.'
                : 'Continue from where you left off. Do not repeat content already written.')
          });
          console.log('[StopReason]', info.code, info.event);
        } catch (_) {}
      } else {
        console.error('Fetch error:', error);
        const errText = error.message.replace(/hf|HF|huggingface|hf.co\/pricing/gi, '').trim();
        sealStreamingText(turn.parts);
        const { content } = ChatHandler._deriveLegacyFromParts(compactParts(turn.parts));
        const partial = (content || '').trim();

        // Errors shown as event rows (not assistant bubble). Continue via event action.
        // Keep partial assistant content if any was streamed.


        // Always persist assistant before event (order: user → assistant → event)
        try {
          await this.app.chatHistoryManager?.addMessageToHistory(
            'assistant', partial || ' ', null, null, false, true, null, turn.conversationIndex
          );
          turn._historySavedOnError = true;
        } catch (_) {}

        if (typeof ChatUI !== 'undefined' && typeof ChatUI.addLongPressListener === 'function') {
          const index = this.app.chatHistory.length - 1;
          ChatUI.addLongPressListener(this.app, turn.botMessageElement, index, 'assistant');
        }
        try {
          const { classifyStopReason } = await import('../../utils/message/StopReason.js');
          const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
          const info = classifyStopReason(error, this.app);
          try { this.app._eventAfterEl = turn?.botMessageElement || null; } catch (_) {}
          await pushChatEvent(this.app, {
            text: info.event,
            type: info.code === 'user_stop' ? 'info' : 'error',
            action: (info.code === 'user_stop' || info.code === 'done') ? null : 'continue',
            continuePrompt: info.code === 'prompt_limit'
              ? 'Continue with a shorter plan. Prefer editing known files; do not re-dump large context.'
              : (info.code === 'credits'
                ? 'Continue from where you left off with minimal context.'
                : 'Continue from where you left off. Do not repeat content already written.')
          });
          console.log('[StopReason]', info.code, info.event);
        } catch (_) {}
      }
    } finally {
      this.app._isMessageTransactionActive = false;
      this.app.isFetching = false;
      this.app.invokeToAddNewTitle = false;
      ChatUI.updateSendStopBtn(this.app, 'stop');

      // Always freeze Working-for timer (prompt_limit / key fail / abort / any end)
      try {
        const { cancelRateLimitRetry } = await import('../../utils/network/RateLimitRetry.js');
        cancelRateLimitRetry(this.app);
      } catch (_) {}
      try {
        if (turn && !turn._workDurationSec) {
          if (turn.clockSegmentStart) {
            turn.clockActiveMs = (turn.clockActiveMs || 0) + (Date.now() - turn.clockSegmentStart);
            turn.clockSegmentStart = null;
          }
          let sec = null;
          if (turn.clockActiveMs > 0) sec = Math.max(1, Math.round(turn.clockActiveMs / 1000));
          else if (turn.clockStartedAt) sec = Math.max(1, Math.round((Date.now() - turn.clockStartedAt) / 1000));
          else {
            const shell = turn.holder?.querySelector?.(':scope > .gpt-oc-work');
            if (shell?._workStartedAt) {
              const accum = shell._workAccumMs || 0;
              sec = Math.max(1, Math.floor((accum + (Date.now() - shell._workStartedAt)) / 1000));
            }
          }
          if (sec != null) turn._workDurationSec = sec;
        }
        if (turn?.holder && turn?.renderer?.finalizeWorkShell) {
          turn.renderer.finalizeWorkShell(turn.holder, turn._workDurationSec || 1);
        }
        document.querySelectorAll('.gpt-oc-work.is-working').forEach((sh) => {
          try {
            if (sh._workTimer) { clearInterval(sh._workTimer); sh._workTimer = null; }
            sh.classList.remove('is-working');
          } catch (_) {}
        });
      } catch (_) {}

      const compacted = compactParts(turn.parts);
      const { content: botMessage, agentActions } = ChatHandler._deriveLegacyFromParts(compacted);

      const usageEstimationMode = this.app.settingsStore ? this.app.settingsStore.get('usageEstimationMode', 'auto') : 'auto';
      if (!this.app._lastRequestUsageRecorded && this.app.usageManager && modelType && usageEstimationMode !== 'strict') {
        const inputText = `${systemText || ''}\n${(apiMessages || []).map(m => ChatHandler._contentToText(m.content)).join('\n')}`;
        const estIn = ChatHandler._estimateTokens(inputText);
        const estOut = ChatHandler._estimateTokens(botMessage);
        if (estIn > 0 || estOut > 0) this.app.usageManager.recordUsage(modelType, estIn, estOut, { estimated: true });
      }

      let title = null;
      const ownerIdx = parseInt(turn.conversationIndex, 10);
      const ownerChat = this.app.conversations[ownerIdx] || this.app.conversations[parseInt(this.app.currentConversationIndex)];
      const viewingOwner = String(this.app.currentConversationIndex) === String(turn.conversationIndex);
      const autoTitleEnabled = this.app.settingsStore ? this.app.settingsStore.getBool('autoGenerateTitle', true) : true;
      if (autoTitleEnabled && ownerChat && ownerChat.chat.length === 1 && (botMessage.trim().length > 0 || compacted.length > 0)) {
        title = await TitleGenerator.generate(this.app, message, config, modelType);
        if (viewingOwner && this.app.chatRenderer?.pushTitle) this.app.chatRenderer.pushTitle(title);
      }

      if (!turn._historySavedOnError && (botMessage.trim().length > 0 || compacted.length > 0 || this.app._lastWebSearch)) {
        const hasWebPart = compacted.some(p => p.fcName === 'web_search' || p.kind === 'web');
        if (this.app._lastWebSearch && !hasWebPart) {
          const ws = this.app._lastWebSearch;
          compacted.unshift({
            id: 'web-' + Date.now(), type: 'tool',
            status: ws.status === 'error' ? PART_STATUS.ERROR : PART_STATUS.DONE,
            verb: 'Searched', target: ws.query || 'web', label: ws.query || 'web',
            fcName: 'web_search', kind: 'web',
            entries: (ws.entries || []).map(e => ({ name: e.name || e.title || e.url || 'Link', url: e.url || '', type: 'link' }))
          });
        }

        const canvasFiles = [];
        compacted.forEach(p => {
          if (p.type === 'file' && p.status === PART_STATUS.SAVED && p.url && p.path) {
            canvasFiles.push({ url: p.url, label: p.path });
          }
        });

        let historyPayload;
        try {
          const { makeMessage, MSG_TYPE } = await import('../../utils/message/MessageSchema.js');
          let durationSec = null;
          try {
            if (turn._workDurationSec != null) durationSec = turn._workDurationSec;
            else if (turn.clockActiveMs > 0) durationSec = Math.max(1, Math.round(turn.clockActiveMs / 1000));
            else if (turn.clockStartedAt) durationSec = Math.max(1, Math.round((Date.now() - turn.clockStartedAt) / 1000));
          } catch (_) {}
          if (durationSec != null && agentActions && typeof agentActions === 'object') {
            try { agentActions._durationSec = durationSec; } catch (_) {}
          }
          historyPayload = makeMessage('assistant', {
            type: MSG_TYPE.TEXT,
            content: botMessage,
            parts: compacted,
            agentActions,
            canvasFiles: canvasFiles.length ? canvasFiles : null,
            durationSec,
            agentDurationSec: durationSec,
            completedAt: Date.now()
          });
        } catch (_) {
          historyPayload = botMessage;
        }

        await this.app.chatHistoryManager?.addMessageToHistory(
          'assistant', historyPayload, title, null, false, true, agentActions,
          turn.conversationIndex
        );
        if (viewingOwner) this._attachWebSearchToLastAssistant();

        try {
          if (viewingOwner) {
            const { HeldWrites } = await import('../../utils/file/HeldWrites.js');
            HeldWrites.showBatchUI(this.app);
          }
        } catch (_) {}

        if (viewingOwner && typeof ChatUI !== 'undefined' && typeof ChatUI.addLongPressListener === 'function') {
          const index = this.app.chatHistory.length - 1;
          const lastAssistant = this.app.chatBox?.querySelector('.assistant-message:last-child');
          ChatUI.addLongPressListener(this.app, lastAssistant || turn.botMessageElement, index, 'assistant');
          // Ensure action buttons exist after history save (correct index + model meta)
          try {
            const histMsg = this.app.chatHistory[index];
            this.app.chatRenderer?._attachAssistantFooter?.(
              lastAssistant || turn.botMessageElement,
              histMsg || {
                role: 'assistant',
                content: botMessage,
                modelId: this.app.selectedModel?.id || this.app.selectedModel?.model || this.app.selectedModel?.name,
                provider: this.app.selectedModel?.type
              },
              index
            );
          } catch (_) {}
        }
        if (viewingOwner && window.MathJax && typeof window.MathJax.typeset === 'function') {
          const lastAssistant = this.app.chatBox?.querySelector('.assistant-message:last-child');
          window.MathJax.typeset([lastAssistant || turn.botMessageElement]);
        }
      }

      try {
        if (this.app._turnsByChat && turn.conversationIndex != null) {
          this.app._turnsByChat.delete(String(turn.conversationIndex));
        }
      } catch (_) {}
      if (this.app._currentTurn === turn) this.app._currentTurn = null;
      if (!viewingOwner && typeof ChatUI !== 'undefined') {
        ChatUI.updateSendStopBtn(this.app, 'stop');
      }
    }
  },

};
