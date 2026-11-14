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

import { methods as turnMethods } from './ChatTurn.js';
import { methods as thinkMethods } from './ChatThinkingStream.js';
import { methods as webMethods } from './ChatWebSearchAttach.js';
import { methods as apiMethods } from './ChatApiContext.js';
import {
  _estimateTokens as estimateTokensFn,
  _contentToText as contentToTextFn,
  _deriveLegacyFromParts as deriveLegacyFromPartsFn,
  _formatTurnActionsSummary as formatTurnActionsSummaryFn
} from './ChatApiContext.js';
import { methods as sendMethods } from './ChatSendFlow.js';

export class ChatHandler {
  constructor(pluginContext) {
    this.plugin = pluginContext;
    this.app = pluginContext;
    this.liveUI = new LiveChatUI(pluginContext);
  }

  _renderMarkdown(text) {
    return Formatter.renderMarkdown(this.app, text);
  }
}

Object.assign(
  ChatHandler.prototype,
  turnMethods,
  thinkMethods,
  webMethods,
  apiMethods,
  sendMethods
);

// Preserve static helpers used across stream error / finalize paths
ChatHandler._estimateTokens = estimateTokensFn;
ChatHandler._contentToText = contentToTextFn;
ChatHandler._deriveLegacyFromParts = deriveLegacyFromPartsFn;
ChatHandler._formatTurnActionsSummary = formatTurnActionsSummaryFn;
