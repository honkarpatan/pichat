/**
 * Thinking + text stream parts (parser, push, repair)
 * @module core/chat/ChatThinkingStream
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
  _logThinkDebug(extra = {}) {
    try {
      const base = this.app._lastThinkDebug || {};
      const parts = this.app._currentTurn?.parts || [];
      const thinking = parts.filter(p => p?.type === 'thinking').map(p => String(p.text || '').slice(0, 800));
      const texts = parts.filter(p => p?.type === 'text').map(p => String(p.text || '').slice(0, 800));
      const out = {
        ...base,
        ...extra,
        streamDbg: this.app._thinkStreamDbg || null,
        partsThinking: thinking,
        partsText: texts,
        thinkUiEffective: this.isThinkUiEnabled()
      };
      this.app._lastThinkDebug = out;
      console.log('[ThinkDebug] turn-end', JSON.stringify(out, null, 2));
    } catch (e) {
      console.warn('[ThinkDebug] turn-end failed', e);
    }
  },

  _cleanHiddenContext(hc) {
    if (!hc) return '';
    return String(hc)
      .replace(/\[System:\s*Thinking is ON[\s\S]*?\]/gi, '')
      .replace(/Thinking is ON\. Before the user-visible answer[\s\S]*?templates\./gi, '')
      .trim();
  }


  /**
   * If stream/parser left END_REASON inside a text part (mid-cut Thought),
   * rejoin thinking+text and re-parse markers once at turn end.
   */,

  _repairThinkAnswerSplit(turn) {
    if (!turn?.parts?.length) return;
    const thinkParts = turn.parts.filter(p => p && p.type === 'thinking');
    const textParts = turn.parts.filter(p => p && p.type === 'text');
    if (!textParts.length) return;

    const textJoined = textParts.map(p => String(p.text || '')).join('');
    if (!/\bEND_REASON\b/i.test(textJoined) && !/<\s*\/\s*think(?:ing)?\s*>/i.test(textJoined)) {
      // Also repair mid-word: text starts lowercase and thinking has no END
      if (!(textParts[0] && /^[a-z]/.test(String(textParts[0].text || '').trim()) && thinkParts.length)) {
        return;
      }
    }

    const thinkJoined = thinkParts.map(p => String(p.text || '')).join('');
    const raw = (thinkJoined ? `BEGIN_REASON\n${thinkJoined}\nEND_REASON\n` : '') + textJoined
      .replace(/\bBEGIN_REASON\b/gi, '')
      .replace(/\bEND_REASON\b/gi, (m, off, s) => {
        // keep first END as boundary via parser — strip all for re-wrap
        return '';
      });

    // Simpler: full reconstruct from think + text with markers restored
    let combined = '';
    if (thinkJoined || /\bEND_REASON\b/i.test(textJoined)) {
      combined = `BEGIN_REASON\n${thinkJoined}${textJoined}`;
      // If END_REASON already in textJoined, good; else if think was cut, END is in text
    } else {
      return;
    }

    const parser = new ThinkingStreamParser();
    const parsed = parser.feed(combined);
    const fl = parser.flush();
    const thinking = (parsed.thinking || '') + (fl.thinking || '');
    let answer = (parsed.text || '') + (fl.text || '');
    // Drop residual markers
    answer = answer.replace(/\bBEGIN_REASON\b/gi, '').replace(/\bEND_REASON\b/gi, '').trim();
    const thinkClean = thinking.replace(/\bBEGIN_REASON\b/gi, '').replace(/\bEND_REASON\b/gi, '').trim();

    if (!thinkClean && !answer) return;

    // Remove old thinking+text parts
    turn.parts = turn.parts.filter(p => p && p.type !== 'thinking' && p.type !== 'text');
    if (thinkClean) {
      const result = appendThinkingDelta(turn.parts, thinkClean, {
        id: 'thinking-repaired',
        provider: turn._thinkProvider || null
      });
      if (result.part) {
        result.part.simulated = !!turn._thinkSimulated;
        result.part.status = PART_STATUS.DONE;
      }
      turn._thinkingId = 'thinking-repaired';
      this._closeCurrentThinking(turn);
    }
    if (answer) {
      appendTextChunk(turn.parts, answer);
      try { sealStreamingText(turn.parts); } catch (_) {}
    }
    try {
      if (turn.renderer) {
        turn.renderer.reset?.();
        // Re-paint: simplest full refresh of parts host
        for (const p of turn.parts) {
          if (p) turn.renderer.upsert(p);
        }
      }
    } catch (_) {}
  },

  _mergeMidWordTextParts(turn) {
    if (!turn?.parts?.length) return;
    for (let i = 1; i < turn.parts.length; i++) {
      const a = turn.parts[i - 1];
      const b = turn.parts[i];
      if (!a || !b || a.type !== 'text' || b.type !== 'text') continue;
      const prev = String(a.text || '');
      const next = String(b.text || '');
      const prevT = prev.replace(/\s+$/, '');
      const nextT = next.replace(/^\s+/, '');
      if (/[A-Za-z0-9]$/.test(prevT) && /^[a-z0-9]/.test(nextT)) {
        a.text = prevT + nextT;
        a.status = b.status || a.status;
        turn.parts.splice(i, 1);
        i--;
      }
    }
  },

  isThinkUiEnabled() {
    try {
      return canUseThinkingUi(this.app);
    } catch (_) {
      try {
        return !!(this.app?.chatInputUI?.states?.think);
      } catch (_) {
        return false;
      }
    }
  }

  /** New Thought row after tools / closed segment (interleaved, not one 39s blob). */,

  _rotateThinkingId(turn) {
    if (!turn) return;
    const n = (turn._thinkingSeq = (turn._thinkingSeq || 0) + 1);
    turn._thinkingId = `thinking-${n}`;
    turn._thinkingClosed = false;
    // NEVER clear parser.inThink here — that orphaned "The user s" in Thought
    // and dumped the rest ("ent a simple…END_REASON") into answer text.
  },

  _closeCurrentThinking(turn) {
    if (!turn?._thinkingId) return;
    try {
      const fin = finalizeThinkingPart(turn.parts, { id: turn._thinkingId });
      if (fin.part) fin.part.simulated = !!turn._thinkSimulated;
      if (fin.part && turn.renderer) {
        // Drop empty shells (duration only, no text)
        if (!String(fin.part.text || '').trim() && !fin.part.redactedData) {
          const idx = turn.parts.findIndex(p => p && p.id === fin.part.id);
          if (idx >= 0) turn.parts.splice(idx, 1);
          try { turn.renderer.map?.get?.(fin.part.id)?.remove?.(); } catch (_) {}
        } else if (turn.renderer) {
          paintUpsertResult(turn, { part: fin.part, sealed: null });
        }
      }
    } catch (_) {}
    turn._thinkingClosed = true;
  },

  _pushText(turn, chunk) {
    if (!chunk) return;
    const native = modelSupportsNativeThink(this.app);
    if (!turn._thinkParser) turn._thinkParser = new ThinkingStreamParser();
    turn._thinkSimulated = !native;

    const parsed = turn._thinkParser.feed(String(chunk));
    let thinkBits = parsed.thinking || '';
    let textBits = parsed.text || '';
    try {
      if (chunk && (thinkBits || textBits) && (thinkBits.length > 0 && textBits.length > 0 || parsed.closedThinking)) {
        console.log('[TextStream] split', {
          thinkOn: this.isThinkUiEnabled(),
          inThink: !!turn._thinkParser?.inThink,
          chunkHead: String(chunk).slice(0, 40),
          thinkLen: thinkBits.length,
          textLen: textBits.length,
          closed: !!parsed.closedThinking
        });
      }
    } catch (_) {}

    // If still inside Thought, never leak "answer" text (mid-word splits)
    if (turn._thinkParser.inThink && textBits) {
      thinkBits = (thinkBits || '') + textBits;
      textBits = '';
    }

    if ((thinkBits || textBits) && this.app?.isEnableAgentMode) {
      try {
        if (turn.holder && turn.renderer?.mountWorkShell) {
          turn.renderer.mountWorkShell(turn.holder, { open: true, live: true });
        }
      } catch (_) {}
    }

    if (thinkBits) {
      try {
        if (turn.holder && turn.renderer?.mountWorkShell) {
          turn.renderer.mountWorkShell(turn.holder, { open: true, live: true });
        }
      } catch (_) {}
      if (!turn._thinkingId || turn._thinkingClosed) this._rotateThinkingId(turn);
      try {
        const result = appendThinkingDelta(turn.parts, thinkBits, {
          id: turn._thinkingId,
          provider: turn._thinkProvider || null
        });
        if (result.part) result.part.simulated = !native;
        if (turn.renderer) paintUpsertResult(turn, result);
      } catch (e) {
        console.warn('[ChatHandler] thinking delta', e);
      }
    }

    if (parsed.closedThinking) {
      this._closeCurrentThinking(turn);
    }

    if (textBits) {
      if (turn._thinkingId && !turn._thinkingClosed) {
        this._closeCurrentThinking(turn);
      }
      // appendTextChunk may merge into an earlier text part (across tool rows).
      // Always schedule THAT part — not merely parts[last], or UI stays truncated.
      const written = appendTextChunk(turn.parts, textBits);
      this._setTurnStatus(turn, null);
      if (written && turn.renderer) turn.renderer.scheduleUpsert(written);
    }
    this._autoScroll(turn);
  }

  /** Explicit reasoning_content from provider (no tags). */,

  _pushReasoning(turn, delta) {
    if (!delta || !turn) return;
    if (!this.isThinkUiEnabled()) return;
    if (!turn._thinkParser) turn._thinkParser = new ThinkingStreamParser();
    turn._thinkParser.feedReasoning(delta);
    try {
      const result = appendThinkingDelta(turn.parts, String(delta), {
        id: turn._thinkingId || (turn._thinkingId = 'thinking'),
        provider: turn._thinkProvider || 'openai'
      });
      if (turn.renderer) paintUpsertResult(turn, result);
    } catch (e) {
      console.warn('[ChatHandler] reasoning', e);
    }
    this._autoScroll(turn);
  },

  _endReasoning(turn) {
    if (!turn?._thinkParser) return;
    const parsed = turn._thinkParser.endReasoning();
    if (parsed.thinking) {
      try {
        const result = appendThinkingDelta(turn.parts, parsed.thinking, {
          id: turn._thinkingId || 'thinking'
        });
        if (turn.renderer) paintUpsertResult(turn, result);
      } catch (_) {}
    }
    try {
      const fin = finalizeThinkingPart(turn.parts, { id: turn._thinkingId || 'thinking' });
      if (fin.part && turn.renderer) {
        paintUpsertResult(turn, { part: fin.part, sealed: null });
      }
    } catch (_) {}
  },

  _pushCollectorTick(turn, collector, { newFiles, partial }) {
    for (const f of newFiles || []) {
      const result = upsertFilePart(turn.parts, {
        id: `file-${f.path}`, path: f.path,
        oldContent: f.oldContent || '', newContent: f.content,
        lang: f.lang, verb: 'Writing', status: PART_STATUS.STREAMING
      });
      paintUpsertResult(turn, result);
    }

    if (partial && partial.path) {
      const result = upsertFilePart(turn.parts, {
        id: `file-${partial.path}`, path: partial.path,
        oldContent: partial.oldContent || '', newContent: partial.content,
        lang: partial.lang, verb: 'Writing', status: PART_STATUS.STREAMING
      });
      if (result.sealed) turn.renderer.upsert(result.sealed);
      turn.renderer.scheduleUpsert(result.part);
    }

    const vis = collector.getVisible();
    if (vis && vis !== turn.lastVisible) {
      const delta = (vis.length > turn.lastVisible.length && vis.startsWith(turn.lastVisible))
        ? vis.slice(turn.lastVisible.length) : vis;
      turn.lastVisible = vis;
      this._pushText(turn, delta);
    }
    this._autoScroll(turn);
  },

};
