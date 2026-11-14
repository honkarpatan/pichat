// src/main/handler/SearchEvaluator.js
//
// Live web-search for the "web" toolbar toggle (non-agent tool path).
//
// OLD behavior (removed):
//   1. await WebSearch.search() BEFORE any assistant bubble existed
//      → UI frozen for seconds with nothing on screen
//   2. After full result arrived, mountOnAssistant() faked a step-by-step
//      reveal with setTimeouts → user never saw real "Searching…" progress
//
// NEW behavior:
//   - Call runLive() AFTER _beginTurn() so a real assistant shell exists
//   - Immediately paint a RUNNING web_search part ("Searching…")
//   - When the network returns, update the SAME part to DONE with links
//   - No fake timers — what the user sees is the real state of the request

import { ConfigManager } from '../utils/ConfigManager.js';
import { WebSearch } from '../utils/network/WebSearch.js';
import { PART_STATUS, upsertToolPart } from '../utils/message/MessagePart.js';
import { paintUpsertResult } from '../utils/message/PartsRenderer.js';

export function useBrowser2(app, config) {
  if (!config?.internal_web_browsing) return true;
  const mode = String(ConfigManager.get('geminiWebMode') ?? 'false').toLowerCase();
  return mode === 'true' || mode === 'browser2' || mode === 'browser_2' || mode === '2.0' || mode === '1';
}

function toEntries(items) {
  return (items || [])
    .filter((it) => it && (it.title || it.url || it.name))
    .slice(0, 10)
    .map((it) => ({
      name: it.title || it.name || it.url || 'Link',
      url: it.url || '',
      type: 'link'
    }));
}

function parseEntriesFromText(text) {
  const items = [];
  if (!text) return items;
  const re = /(?:^|\n)\s*\d+\.\s*Title:\s*(.+?)\nURL:\s*(\S+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({ title: m[1].trim(), url: m[2].trim() });
  }
  return items;
}

function paintWebPart(turn, { id, query, verb, status, entries }) {
  if (!turn?.parts || !turn?.renderer) return;
  const result = upsertToolPart(turn.parts, {
    id,
    verb,
    target: query,
    label: query,
    fcName: 'web_search',
    kind: 'web',
    entries: entries || [],
    status
  });
  paintUpsertResult(turn, result);
  try {
    if (turn.autoScrollEnabled !== false && turn.botMessageElement?.parentElement) {
      const box = turn.botMessageElement.parentElement;
      box.scrollTop = box.scrollHeight;
    }
  } catch (_) {}
}

/**
 * Claude-style: auto web search only for factual / time-sensitive questions.
 * Skip greetings, thanks, pure coding agent tasks, and ultra-short chitchat.
 */
export function shouldAutoWebSearch(userInput, app = null) {
  const q = String(userInput || '').trim();
  if (!q) return false;

  // Agent mode: model uses web_search tool only when needed — no forced search
  if (app?.isEnableAgentMode) return false;

  // Very short / social
  const lower = q.toLowerCase().replace(/[!?.…]+$/g, '').trim();
  const social = new Set([
    'thanks', 'thank you', 'thank u', 'thx', 'ty', 'tysm',
    'ok', 'okay', 'k', 'kk', 'cool', 'nice', 'great', 'good',
    'hi', 'hello', 'hey', 'yo', 'sup',
    'bye', 'goodbye', 'see you', 'cya',
    'yes', 'no', 'yep', 'nope', 'yeah', 'nah',
    'please', 'pls', 'sorry', 'np', 'yw', "you're welcome", 'you are welcome'
  ]);
  if (social.has(lower)) return false;
  if (lower.length < 12 && !/\?/.test(q)) return false;

  // Pure acknowledgment / emoji-only
  if (/^[\s\p{Emoji}\p{P}]+$/u.test(q) && q.length < 20) return false;

  // Explicit coding-only agent-ish prompts without research signal
  const needsWeb =
    /\b(latest|current|today|news|who is|what is|when did|documentation|docs|release|changelog|search the web|look up|google|wikipedia)\b/i.test(q) ||
    /\b(20\d{2})\b/.test(q) ||
    /\?/.test(q);

  // Long factual questions still OK
  if (q.length > 80 && /\b(how|what|why|where|which|explain)\b/i.test(q)) return true;

  return needsWeb;
}

export class SearchEvaluator {
  /**
   * Progressive web search painted onto the current assistant turn.
   * @returns {string|null} hidden context text for the model, or null
   */
  static async runLive(app, userInput, config, turn) {
    if (!app.isEnableWebBrowsing) {
      app._lastWebSearch = null;
      return null;
    }

    if (!shouldAutoWebSearch(userInput, app)) {
      app._lastWebSearch = null;
      console.log('[SearchEvaluator] skip auto search (not needed for this message)');
      return null;
    }

    const query = String(userInput || '').trim() || 'web';
    const id = `web-${Date.now()}`;

    // Model has its own native web tool (e.g. Gemini) and user chose that mode
    if (config?.internal_web_browsing && !useBrowser2(app, config)) {
      app._lastWebSearch = {
        query,
        engine: config.name || 'Gemini',
        status: 'running',
        entries: []
      };
      paintWebPart(turn, {
        id,
        query,
        verb: 'Searching',
        status: PART_STATUS.RUNNING,
        entries: []
      });
      // Native path: model will search itself — mark idle card done without links
      paintWebPart(turn, {
        id,
        query,
        verb: 'Web enabled',
        status: PART_STATUS.DONE,
        entries: []
      });
      app._lastWebSearch = {
        query,
        engine: config.name || 'Gemini',
        status: 'done',
        entries: []
      };
      return null;
    }

    // ── Immediate UI: Searching… ──────────────────────────────────
    app._lastWebSearch = {
      query,
      engine: 'Browser 2.0',
      status: 'running',
      entries: []
    };
    paintWebPart(turn, {
      id,
      query,
      verb: 'Searching',
      status: PART_STATUS.RUNNING,
      entries: []
    });
    try {
      turn.renderer?.mountWorkShell?.(turn.holder, { open: true });
    } catch (_) {}

    let raw;
    try {
      raw = await WebSearch.search(query);
    } catch (e) {
      console.error('[SearchEvaluator] search failed', e);
      app._lastWebSearch = {
        query,
        engine: 'Browser 2.0',
        status: 'error',
        entries: []
      };
      paintWebPart(turn, {
        id,
        query,
        verb: 'Search failed',
        status: PART_STATUS.ERROR,
        entries: []
      });
      return null;
    }

    const payload =
      typeof raw === 'string'
        ? { text: raw, query, items: [] }
        : raw || { text: '', query, items: [] };

    if ((!payload.items || !payload.items.length) && payload.text) {
      const parsed = parseEntriesFromText(payload.text);
      if (parsed.length) payload.items = parsed;
    }

    const entries = toEntries(payload.items);
    app._lastWebSearch = {
      query: payload.query || query,
      engine: 'Browser 2.0',
      status: 'done',
      entries
    };

    // ── Same card → Searched + links (real completion, not a fake animation) ──
    paintWebPart(turn, {
      id,
      query: payload.query || query,
      verb: 'Searched',
      status: PART_STATUS.DONE,
      entries
    });

    console.log('[SearchEvaluator] live done', entries.length, 'links');
    return payload.text || null;
  }

  /**
   * @deprecated Old pre-turn blocking search. Prefer runLive() after _beginTurn.
   * Kept as a thin wrapper so any leftover callers still work.
   */
  static async evaluateAndSearch(app, userInput, config, liveUI) {
    console.warn('[SearchEvaluator] evaluateAndSearch is deprecated — use runLive(app, input, config, turn)');
    // No turn yet: cannot paint progressively. Just fetch for context.
    if (!app.isEnableWebBrowsing) {
      app._lastWebSearch = null;
      return null;
    }
    if (config?.internal_web_browsing && !useBrowser2(app, config)) {
      app._lastWebSearch = {
        query: userInput,
        engine: config.name || 'Gemini',
        status: 'done',
        entries: []
      };
      return null;
    }
    try {
      const raw = await WebSearch.search(userInput);
      const payload =
        typeof raw === 'string'
          ? { text: raw, query: userInput, items: [] }
          : raw || { text: '', query: userInput, items: [] };
      if ((!payload.items || !payload.items.length) && payload.text) {
        const parsed = parseEntriesFromText(payload.text);
        if (parsed.length) payload.items = parsed;
      }
      app._lastWebSearch = {
        query: payload.query || userInput,
        engine: 'Browser 2.0',
        status: 'done',
        entries: toEntries(payload.items)
      };
      return payload.text || null;
    } catch (e) {
      console.error('[SearchEvaluator] failed', e);
      app._lastWebSearch = {
        query: userInput,
        engine: 'Browser 2.0',
        status: 'error',
        entries: []
      };
      return null;
    }
  }

  /** @deprecated No-op — progressive paint is done inside runLive */
  static mountOnAssistant() {}

  /** @deprecated */
  static flushPendingCards() {}
}
