/**
 * Attach web search results to last assistant message
 * @module core/chat/ChatWebSearchAttach
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
  _attachWebSearchToLastAssistant() {
    const ws = this.app._lastWebSearch;
    if (!ws || !this.app.currentConversation?.chat?.length) return;
    const chat = this.app.currentConversation.chat;
    const webPart = {
      id: 'web-' + Date.now(), type: 'tool',
      status: ws.status === 'error' ? PART_STATUS.ERROR : PART_STATUS.DONE,
      verb: 'Searched', target: ws.query || 'web', label: ws.query || 'web',
      fcName: 'web_search', kind: 'web',
      entries: (ws.entries || []).map(e => ({ name: e.name || e.title || e.url || 'Link', url: e.url || '', type: 'link' }))
    };
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role !== 'assistant') continue;
      const parts = Array.isArray(chat[i].parts) ? chat[i].parts.slice() : [];
      const idx = parts.findIndex(p => p.fcName === 'web_search' || p.kind === 'web');
      if (idx >= 0) {
        const prevHasUrls = Array.isArray(parts[idx].entries) && parts[idx].entries.some(e => e.url);
        if (!prevHasUrls && webPart.entries.length) { parts[idx] = webPart; chat[i].parts = parts; }
      } else {
        parts.unshift(webPart);
        chat[i].parts = parts;
      }
      break;
    }
    this.app.chatHistory = [...chat];
    this.app._lastWebSearch = null;
    try {
      if (this.app.chatHistoryManager?.saveCurrentConversation) this.app.chatHistoryManager.saveCurrentConversation();
      else if (this.app.storageManager?.saveConversations) this.app.storageManager.saveConversations();
    } catch (_) {}
  },

};
