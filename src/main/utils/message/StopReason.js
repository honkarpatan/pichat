/**
 * Human-readable stop / abort reasons for gpt-event messages.
 * Users should see WHY a run ended — not blame the model blindly.
 */

export function classifyStopReason(error, app = null) {
  const userStop = !!(app && (app._userRequestedStop || app._abortReason === 'user'));
  const msg = String(error?.message || error || '').trim();
  const name = String(error?.name || '');

  if (userStop || (name === 'AbortError' && userStop)) {
    return {
      code: 'user_stop',
      event: 'Stopped by you'
    };
  }

  if (name === 'AbortError') {
    return {
      code: 'aborted',
      event: 'Stopped — request aborted'
    };
  }

  const lower = msg.toLowerCase();

  if (/prompt tokens limit exceeded|prompt is too long|maximum prompt/i.test(msg)) {
    return {
      code: 'prompt_limit',
      event: 'Stopped — prompt too large for this API key limit. Start a new chat or use a key with higher limits.'
    };
  }
  if (/can only afford|requires more credits|fewer max_tokens|insufficient.?credits|credit limit/i.test(msg)) {
    return {
      code: 'credits',
      event: 'Stopped — OpenRouter credits / max_tokens limit. Check API key balance.'
    };
  }
  if (/rate limit|429|too many requests|temporar(y|ily) rate/i.test(msg)) {
    return {
      code: 'rate_limit',
      event: 'Stopped — rate limit. Wait a moment or switch API key.'
    };
  }
  if (/all api keys failed|no api key|invalid api key|unauthorized|401|403/i.test(msg)) {
    return {
      code: 'api_key',
      event: 'Stopped — API key error. Check keys in settings.'
    };
  }
  if (/model .+ not found|404|no endpoints|not available/i.test(msg)) {
    return {
      code: 'model',
      event: 'Stopped — model unavailable. Pick another model.'
    };
  }
  if (/context length|maximum context|too many tokens|payload too large/i.test(msg)) {
    return {
      code: 'context',
      event: 'Stopped — context too long. Start a new chat or shorten history.'
    };
  }
  if (/network|failed to fetch|timeout|econnreset|enotfound|dns/i.test(msg)) {
    return {
      code: 'network',
      event: 'Stopped — network error. Check connection and retry.'
    };
  }
  if (/tool/i.test(msg) && /not support|does not support/i.test(msg)) {
    return {
      code: 'tools',
      event: 'Stopped — this model does not support tools. Use an agent-capable model.'
    };
  }

  // Prefer structured multi-key failure summary when present
  try {
    const kf = error?.keyFailures;
    if (Array.isArray(kf) && kf.length) {
      const first = String(kf[0].error || '').replace(/\s+/g, ' ').slice(0, 100);
      return {
        code: /prompt tokens limit|prompt too large|3982|credit/i.test(msg) ? 'prompt_limit' : 'error',
        event: first
          ? `Stopped — ${kf.length} key(s) failed. ${first}${first.length >= 100 ? '…' : ''}`
          : `Stopped — ${kf.length} API key(s) failed`
      };
    }
  } catch (_) {}

  // Truncate long provider messages for the event line
  let short = msg.replace(/\s+/g, ' ').slice(0, 120);
  if (msg.length > 120) short += '…';
  return {
    code: 'error',
    event: short ? `Stopped — ${short}` : 'Stopped — request failed'
  };
}

const EXTRA_STOP = {
  force_write_no_edit: {
    type: 'error',
    text: 'Stopped — force-write was on but the model only read/explored and never edited. Retry, or use a stronger model.'
  },
  empty_stop: {
    type: 'error',
    text: 'Stopped — empty response with no file changes.'
  }
};

export function eventForAgentStop(reason) {
  if (EXTRA_STOP[reason]) return { ...EXTRA_STOP[reason] };

  const map = {
    user_stop: 'Stopped by you',
    aborted: 'Stopped — request aborted',
    no_progress: 'Stopped — agent repeated the same steps with no progress',
    read_loop: 'Stopped — agent kept re-reading files without editing. Retry; if it persists, check API key prompt limits.',
    identical_read: 'Stopped — agent stuck re-reading the same file',
    cycling_reads: 'Stopped — agent stuck in a read/explore loop',
    no_mutation: 'Stopped — many steps with no file changes',
    explore_budget: 'Stopped — explore budget used without edits. Summary was requested; retry or switch model.',
    force_write_failed: 'Stopped — forced edit pass did not modify files.',
    force_write_no_edit: 'Stopped — force-write was on but the model only read/explored and never edited. Retry, or use a stronger model.',
    empty_stop: 'Stopped — empty response with no file changes.',
    phase_finalize: 'Stopped — agent could not complete edits; see summary above.',
    max_steps: 'Stopped — max agent steps reached',
    credits: 'Stopped — credits / max_tokens limit. Check API key balance.',
    prompt_limit: 'Stopped — prompt too large for this API key limit. New chat or shorter context.',
    length: 'Stopped — output truncated (token limit). Raise max_tokens or top up credits.',
    done: null,
    finished: null
  };
  if (reason && map[reason] !== undefined) return map[reason];
  if (!reason) return null;
  return `Stopped — ${String(reason).replace(/_/g, ' ')}`;
}
