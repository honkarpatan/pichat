/**
 * Turn lifecycle: begin/finalize, attach, status, scroll, footers
 * @module core/chat/ChatTurn
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

export const methods = {
  _beginTurn() {
    const botMessageElement = this.liveUI.createMessageElement('assistant');
    if (this.app.chatBox) this.app.chatBox.appendChild(botMessageElement);

    const holder = document.createElement('div');
    holder.className = 'gpt-message-inner-holder gpt-fast-wave';
    botMessageElement.appendChild(holder);

    const statusLine = document.createElement('div');
    statusLine.className = 'gpt-turn-status';
    statusLine.style.display = 'none';
    holder.appendChild(statusLine);

    const partsHost = document.createElement('div');
    partsHost.className = 'gpt-agent-parts';
    holder.appendChild(partsHost);

    const renderer = new PartsRenderer(partsHost, {
      app: this.app,
      renderMarkdown: (t) => this._renderMarkdown(t),
      onLinkOpen: (u) => { try { window.open(u, '_blank'); } catch (_) {} },
      maxOpenDetails: 2,
      collapseHeadings: (el) => {
        try {
          const cr = this.app.chatRenderer;
          if (cr?.shouldCollapseMarkdownHeaders?.(null) && cr._convertHeadingsToCollapsibleSections) {
            cr._convertHeadingsToCollapsibleSections(el);
          }
        } catch (_) {}
      }
    });

    const conversationIndex = String(this.app.currentConversationIndex ?? '');
    const conversationId = this.app.currentConversation?.id || conversationIndex;
    const turn = {
      botMessageElement, holder, statusLine, partsHost, renderer,
      parts: [], lastVisible: '', autoScrollEnabled: true,
      clockStartedAt: null, clockActiveMs: 0, clockSegmentStart: null,
      conversationIndex, conversationId, uiAttached: true
    };
    this.app._currentTurn = turn;
    if (!this.app._turnsByChat) this.app._turnsByChat = new Map();
    this.app._turnsByChat.set(conversationIndex, turn);

    document.querySelectorAll('.assistant-message').forEach(m => m.classList.remove('increaseChatHeight'));
    botMessageElement.classList.add('increaseChatHeight');
    turn.clockStartedAt = Date.now();
    turn.clockSegmentStart = Date.now();

    if (this.app.chatBox) {
      this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
      this.app.chatBox.addEventListener('scroll', () => {
        if (this.app.bubbleControls) {
          this.app.bubbleControls.stickyBotIcon();
          this.app.bubbleControls.stickyCopyButtons();
        }
        turn.autoScrollEnabled = this.app.chatBox.scrollHeight - this.app.chatBox.scrollTop <= this.app.chatBox.clientHeight + 50;
      });
    }

    return turn;
  },

  isTurnVisible(turn) {
    if (!turn) return false;
    return String(this.app.currentConversationIndex) === String(turn.conversationIndex) && turn.uiAttached !== false;
  },

  detachActiveTurnForSwitch() {
    const turn = this.app._currentTurn;
    if (!turn?.botMessageElement) return;
    try {
      if (turn.botMessageElement.parentNode) {
        turn.botMessageElement.parentNode.removeChild(turn.botMessageElement);
      }
    } catch (_) {}
    turn.uiAttached = false;
  },

  reattachTurnIfOwner(chatIndex) {
    const turn = this.app._currentTurn;
    if (!turn?.botMessageElement) return false;
    if (String(turn.conversationIndex) !== String(chatIndex)) return false;
    const box = this.app.chatBox || document.getElementById('chat-box');
    if (!box) return false;
    try {
      if (!turn.botMessageElement.parentNode) {
        box.appendChild(turn.botMessageElement);
      }
      turn.uiAttached = true;
      turn.autoScrollEnabled = true;
      box.scrollTop = box.scrollHeight;
      if (typeof ChatUI !== 'undefined') ChatUI.updateSendStopBtn(this.app, 'run');
      return true;
    } catch (_) {
      return false;
    }
  },

  _setTurnStatus(turn, text) {
    if (!turn?.statusLine) return;
    if (!this.isTurnVisible(turn)) return;
    if (!text) { turn.statusLine.style.display = 'none'; return; }
    turn.statusLine.style.display = '';
    turn.statusLine.innerHTML = `<span class="gpt-turn-status-dot"></span><span>${String(text).replace(/</g, '&lt;')}</span>`;
  },

  _autoScroll(turn) {
    if (!this.isTurnVisible(turn)) return;
    if (turn.autoScrollEnabled && this.app.chatBox) {
      this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
    }
  }

  /**
   * Effective thinking for stream/UI:
   * toggle ON + (native model OR settings forceEnableNonNativeThinking).
   */
  /** Console + app._lastThinkDebug for user copy (prompt/response shape). */,

  _finalizeTurn(turn) {
    try {
      if (turn._thinkParser) {
        const fl = turn._thinkParser.flush();
        // Leftover buffer still inside <think>
        if (fl.thinking) {
          if (!turn._thinkingId || turn._thinkingClosed) this._rotateThinkingId(turn);
          const result = appendThinkingDelta(turn.parts, fl.thinking, {
            id: turn._thinkingId || 'thinking'
          });
          if (result.part) result.part.simulated = !!turn._thinkSimulated;
          if (turn.renderer) paintUpsertResult(turn, result);
        }
        // Close open Thought before any trailing answer text
        if (this.isThinkUiEnabled() && (fl.closedThinking || turn._thinkParser.everThought || turn._thinkingId)) {
          this._closeCurrentThinking(turn);
        }
        // Text outside tags → answer (never fold into Thought)
        if (fl.text) {
          const written = appendTextChunk(turn.parts, fl.text);
          if (written && turn.renderer) turn.renderer.scheduleUpsert(written);
        }
      } else if (this.isThinkUiEnabled() && turn._thinkingId) {
        this._closeCurrentThinking(turn);
      }
    } catch (e) {
      console.warn('[ChatHandler] finalize thinking', e);
    }
    const sealed = sealStreamingText(turn.parts);
    turn.renderer.flushPending();
    if (sealed) turn.renderer.upsert(sealed);
    const last = turn.parts[turn.parts.length - 1];
    if (last && last !== sealed) turn.renderer.upsert(last);

    try { addCopyButton(turn.partsHost); } catch (_) {}
    try {
      if (this.app.chatRenderer?._addHtmlPreviewTriggers) {
        this.app.chatRenderer._addHtmlPreviewTriggers(turn.partsHost);
      }
    } catch (_) {}

    // Collapsible headings live (same as history) when setting enabled
    try {
      const cr = this.app.chatRenderer;
      if (cr?.shouldCollapseMarkdownHeaders?.(null) && cr._convertHeadingsToCollapsibleSections) {
        turn.partsHost?.querySelectorAll?.('.part-text')?.forEach(el => {
          cr._convertHeadingsToCollapsibleSections(el);
        });
      }
    } catch (_) {}

    // Stop Working timer only when a work shell was actually used (tools / native think)
    try {
      if (turn.holder && turn.renderer?.finalizeWorkShell) {
        const hasShell = !!turn.holder.querySelector?.(':scope > .gpt-oc-work');
        const hasWork = turn.renderer._containerHasWorkRows?.() ||
          (Array.isArray(turn.parts) && turn.parts.some(p =>
            p && (p.type === 'tool' || p.type === 'file' || p.type === 'plan' || p.type === 'thinking')
          ));
        if (hasShell || hasWork) {
          const shell = turn.holder.querySelector?.('.gpt-oc-work');
          const started = shell?._workStartedAt;
          const accum = shell?._workAccumMs || 0;
          let sec = 1;
          if (started) {
            sec = Math.max(1, Math.round((accum + (Date.now() - started)) / 1000));
          } else if (turn.clockActiveMs > 0) {
            sec = Math.max(1, Math.round(turn.clockActiveMs / 1000));
          } else if (turn.clockStartedAt) {
            sec = Math.max(1, Math.round((Date.now() - turn.clockStartedAt) / 1000));
          }
          turn._workDurationSec = sec;
          turn.renderer.finalizeWorkShell(turn.holder, sec);
        }
      }
    } catch (e) {
      console.warn('[ChatHandler] finalizeWorkShell', e);
    }

    
    // Repair: if END_REASON leaked into text parts, re-split thinking vs answer
    try {
      this._repairThinkAnswerSplit(turn);
    } catch (e) {
      console.warn('[ChatHandler] repairThinkAnswerSplit', e);
    }
    try { this._mergeMidWordTextParts(turn); } catch (_) {}
    try { this._logThinkDebug({ phase: 'finalize' }); } catch (_) {}

    // Live response actions (copy/retry/…) — don't wait for history re-render
    try {
      this._attachLiveAssistantFooter(turn);
    } catch (_) {}

    this._setTurnStatus(turn, null);
  },

  _attachLiveAssistantFooter(turn) {
    const el = turn?.botMessageElement;
    if (!el || !this.app.chatRenderer?._attachAssistantFooter) return;
    const idx = Math.max(0, (this.app.chatHistory?.length || 1) - 1);
    const hist = this.app.chatHistory?.[idx];
    const msg = {
      role: 'assistant',
      content: hist?.content || '',
      modelId: hist?.modelId || this.app.selectedModel?.id || this.app.selectedModel?.model || this.app.selectedModel?.name || '',
      modelName: hist?.modelName || this.app.selectedModel?.name || '',
      provider: hist?.provider || this.app.selectedModel?.type || '',
      apiKeyLabel: hist?.apiKeyLabel || this.app._lastApiKeyLabel || ''
    };
    this.app.chatRenderer._attachAssistantFooter(el, msg, idx);
  },

  _showStreamErrorFooter(turn, { errText, hasPartial }) {
    if (!turn?.botMessageElement) return;
    turn.botMessageElement.querySelectorAll('.gpt-stream-error').forEach(el => el.remove());

    const footer = document.createElement('div');
    footer.className = 'gpt-stream-error';
    footer.innerHTML = `
      <div class="gpt-stream-error-msg">${String(errText || 'Request failed').replace(/</g, '&lt;')}</div>
      <button type="button" class="gpt-stream-continue-btn">Continue</button>
    `;
    turn.botMessageElement.appendChild(footer);

    const btn = footer.querySelector('.gpt-stream-continue-btn');
    btn?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.app.isFetching) return;
      btn.disabled = true;
      footer.remove();
      const prompt = hasPartial
        ? 'Continue from where you left off. Do not repeat content already written.'
        : 'Please retry the previous request.';
      try { await this.handleSendMessage(prompt); } catch (_) { btn.disabled = false; }
    });
  },

};
