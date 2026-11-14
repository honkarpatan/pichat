/**
 * History window + API message build + static token helpers
 * @module core/chat/ChatApiContext
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

/** Instance methods */
export function _estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

export function _contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(item => (item.type === 'text' ? item.text : '[image]')).join(' ');
    return '';
  }

  /**
   * Token-aware history for Gemini / Mistral / OpenAI-compat.
   * Agent mode keeps more turns (was 20 → now up to 48) so multi-step work
   * does not forget the user goal after 2–3 messages.
   * Always prefers: latest turns + first user goal message when budget allows.
   */

export function _deriveLegacyFromParts(parts) {
    const textBits = [];
    const agentActions = [];
    for (const p of parts) {
      if (p.type === 'text') { textBits.push(p.text || ''); continue; }
      if (p.type === 'tool') {
        agentActions.push({
          verb: p.verb, label: p.label || p.target, target: p.target || p.label,
          status: p.status === PART_STATUS.ERROR ? 'error' : 'success',
          fcName: p.fcName, kind: p.kind, entries: p.entries, detail: p.detail,
          url: p.url, fullPath: p.fullPath, fcArgs: p.fcArgs
        });
        continue;
      }
      if (p.type === 'file') {
        agentActions.push({
          verb: p.status === PART_STATUS.SAVED ? 'Saved' : (p.status === PART_STATUS.ERROR ? 'Save failed' : 'Writing'),
          label: p.path, target: p.path,
          status: p.status === PART_STATUS.ERROR ? 'error' : 'success',
          fcName: p.fcName, url: p.url,
          oldContent: p.oldContent, newContent: p.newContent
        });
        continue;
      }
      if (p.type === 'plan') {
        agentActions.push({
          verb: 'Plan', label: 'Plan', target: 'Plan',
          status: 'success', fcName: 'todo_write',
          items: Array.isArray(p.items) ? p.items : []
        });
        continue;
      }
    }
    return { content: textBits.join(''), agentActions };
  }

  /**
   * Richer turn digest so Gemini / Mistral / OpenAI-compat remember WHAT changed across turns.
   * Keeps paths, tool names, and short outcome — not full file bodies.
   */

export function _formatTurnActionsSummary(msg) {
    const actions = Array.isArray(msg?.agentActions) ? msg.agentActions : [];
    if (!actions.length) return '';
    const items = [];
    const seen = new Set();
    for (const a of actions) {
      if (!a || a.fcName === 'todo_write') continue;
      const tool = a.fcName || a.verb || 'action';
      const pathFull = String(a.fullPath || a.url || a.label || a.target || '').trim();
      const pathShort = pathFull
        ? pathFull.split(/[/\\]/).filter(Boolean).slice(-2).join('/')
        : '';
      const status = a.status === 'error' ? 'FAIL' : (a.status === 'success' || a.status === 'done' ? 'ok' : (a.status || 'ok'));
      let extra = '';
      if (a.status === 'error' && a.detail) {
        const d = String(a.detail).replace(/\s+/g, ' ').slice(0, 80);
        if (d) extra = ` — ${d}`;
      } else if (a.verb && a.verb !== tool) {
        extra = ` (${a.verb})`;
      }
      const entry = pathShort
        ? `${tool} ${pathShort} [${status}]${extra}`
        : `${tool} [${status}]${extra}`;
      const key = entry.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push(entry);
      }
    }
    if (!items.length) return '';
    return `[Turn Actions Summary]\n- ${items.slice(0, 20).join('\n- ')}`;
  }

  /**
   * @param {string|null} isResend - text to send (null = read from input)
   * @param {{ regenerate?: boolean }} opts - regenerate: keep last user row, don't append another
   */

export const methods = {
  _selectBoundedHistory(turns) {
    const isAgent = !!this.app.isEnableAgentMode;
    const defaultBudget = isAgent ? 28000 : 16000;
    const defaultMax = isAgent ? 48 : 60;
    const HISTORY_TOKEN_BUDGET = this.app.settingsStore
      ? this.app.settingsStore.getNumber('historyTokenBudget', defaultBudget)
      : defaultBudget;
    let HISTORY_MAX_MESSAGES = this.app.settingsStore
      ? this.app.settingsStore.getNumber('historyMaxMessages', defaultMax)
      : defaultMax;
    if (isAgent) HISTORY_MAX_MESSAGES = Math.min(Math.max(HISTORY_MAX_MESSAGES, 32), 64);

    const selected = [];
    let tokenSum = 0;
    const lastUserIdx = turns.map(m => m.role).lastIndexOf('user');

    // Walk newest → oldest
    for (let i = turns.length - 1; i >= 0 && selected.length < HISTORY_MAX_MESSAGES; i--) {
      const msg = turns[i];
      const hc = (i === lastUserIdx) ? (msg.hidden_context || '') : '';
      const actionLog = msg.role === 'assistant' ? _formatTurnActionsSummary(msg) : '';
      const text = _contentToText(msg.content) + hc + actionLog;
      const cost = _estimateTokens(text);
      if (selected.length > 0 && tokenSum + cost > HISTORY_TOKEN_BUDGET) break;
      selected.unshift(msg);
      tokenSum += cost;
    }

    // Ensure the earliest user goal in the chat is not dropped when we still have budget
    if (selected.length && turns.length > selected.length) {
      const firstUser = turns.find(m => m.role === 'user');
      if (firstUser && !selected.includes(firstUser)) {
        const goalText = _contentToText(firstUser.content);
        const goalCost = _estimateTokens(goalText);
        if (tokenSum + goalCost <= HISTORY_TOKEN_BUDGET && selected.length < HISTORY_MAX_MESSAGES) {
          selected.unshift(firstUser);
        } else if (selected[0] !== firstUser && goalText) {
          // Inject a tiny synthetic reminder as prefix on the oldest selected user msg
          const oldest = selected.find(m => m.role === 'user');
          if (oldest && typeof oldest.content === 'string' && !oldest.content.includes('[Earlier user goal]')) {
            const shortGoal = goalText.replace(/\s+/g, ' ').slice(0, 240);
            oldest._historyGoalPrefix = `[Earlier user goal]: ${shortGoal}`;
          }
        }
      }
    }
    return selected;
  },

  _buildApiMessages(chatArray) {
    const historyEnabledSetting = this.app.settingsStore ? this.app.settingsStore.getBool('isShowHistory', true) : true;
    const isHistoryEnabled = historyEnabledSetting && (this.app.chatInputUI ? this.app.chatInputUI.states.history : true);

    const systemMessages = chatArray.filter(m => m.role === 'system');
    const systemTextFromHistory = systemMessages.map(m => _contentToText(m.content)).filter(Boolean).join('\n\n');

    // User systemPrompt is merged inside getSystemInstruction() when systemPromptScope allows.
    // Only pass role=system messages from chat history here (avoid double-send).
    const systemText = [systemTextFromHistory].filter(Boolean).join('\n\n');

    const turnMessages = chatArray.filter(m => m.role !== 'system');
    let recentChat;
    if (!isHistoryEnabled) recentChat = turnMessages.slice(-1);
    else if (this.app.isShowHistory) recentChat = this._selectBoundedHistory(turnMessages);
    else recentChat = turnMessages.slice(-1);

    const lastUserIndex = recentChat.map(m => m.role).lastIndexOf('user');

    const apiMessages = recentChat.map((msg, index) => {
      let cleanContent = msg.content;
      if (typeof cleanContent === 'string') {
        cleanContent = cleanContent.replace(/@@@AGENT_ACTIONS@@@[\s\S]*?@@@END_AGENT_ACTIONS@@@\n*/g, '');
        cleanContent = cleanContent.replace(/@@@CANVAS_FILE@@@[\s\S]*?@@@END_CANVAS_FILE@@@\n*/g, '');
        cleanContent = cleanContent.trim();
      }

      // Attach compact Turn Actions Summary to assistant messages so the model remembers files it read/edited!
      if (msg.role === 'assistant') {
        const actionSummary = _formatTurnActionsSummary(msg);
        if (actionSummary) {
          // Prefer summary + short body so long chat dumps don't blow the budget
          let body = typeof cleanContent === 'string' ? cleanContent : _contentToText(cleanContent);
          if (body && body.length > 2500) {
            body = body.slice(0, 2200) + '\n…[truncated for context budget]';
          }
          cleanContent = body ? `${actionSummary}\n${body}` : actionSummary;
        }
      }

      // Inject earlier-goal reminder when oldest user turn was compacted away
      if (msg.role === 'user' && msg._historyGoalPrefix && typeof cleanContent === 'string') {
        cleanContent = `${msg._historyGoalPrefix}\n\n${cleanContent}`;
      }

      let apiMsg = { role: msg.role, content: cleanContent };
      if (msg.role === 'user' && msg.hidden_context && index === lastUserIndex) {
        if (typeof apiMsg.content === 'string') {
          apiMsg.content = `${this._cleanHiddenContext(msg.hidden_context)}\n\n${apiMsg.content}`.replace(/^\n+/, '');
        } else if (Array.isArray(apiMsg.content)) {
          apiMsg.content = apiMsg.content.map(item =>
            item.type === 'text' ? { type: 'text', text: `${this._cleanHiddenContext(msg.hidden_context)}\n\n${item.text}`.replace(/^\n+/, '') } : item
          );
        }
      }
      return apiMsg;
    });

    return { apiMessages, systemText };
  },

};

