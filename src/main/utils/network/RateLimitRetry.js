/**
 * Common rate-limit / quota retry for ALL model providers.
 * - Exponential backoff + server "Please retry in Xs" / Retry-After
 * - Optional live countdown in the assistant status line
 */

const TAG = '[RateLimitRetry]';

export function isRateLimitError(err, response) {
  if (response && (response.status === 429 || response.status === 503)) return true;
  return isRateLimitMessage(err?.message || err);
}

export function isRateLimitMessage(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('rate limit') ||
    m.includes('429') ||
    m.includes('too many requests') ||
    m.includes('resource exhausted') ||
    m.includes('quota exceeded') ||
    (m.includes('quota') && m.includes('exceed')) ||
    m.includes('capacity') ||
    m.includes('overloaded') ||
    m.includes('please retry in')
  );
}

export function backoffMs(attempt) {
  const table = [3000, 8000, 20000, 45000];
  return table[Math.min(attempt, table.length - 1)];
}

export function parseRetryAfterMs(response, bodyText) {
  let ms = 0;
  try {
    const h = response?.headers?.get?.('retry-after');
    if (h) {
      const sec = Number(h);
      if (Number.isFinite(sec) && sec > 0) ms = Math.round(sec * 1000);
      else {
        const when = Date.parse(h);
        if (Number.isFinite(when)) ms = Math.max(0, when - Date.now());
      }
    }
  } catch (_) {}

  const text = String(bodyText || '');
  const m =
    text.match(/please\s+retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i) ||
    text.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i) ||
    text.match(/retryDelay["\s:]+(\d+(?:\.\d+)?)s/i);
  if (m) {
    const fromBody = Math.round(parseFloat(m[1]) * 1000);
    if (fromBody > ms) ms = fromBody;
  }
  if (ms > 0) return Math.min(Math.max(ms + 500, 1000), 90000);
  return 0;
}

/** Cancel any in-flight rate-limit UI/countdown (abort, provider switch, new run). */
export function cancelRateLimitRetry(app, reason = '') {
  try {
    const fn = app?._rateLimitRetryCancel;
    if (typeof fn === 'function') fn(reason || 'stopped');
  } catch (_) {}
  try {
    if (app) {
      app._rateLimitRetryCancel = null;
      app._rateLimitRetryProvider = null;
      app._rateLimitRetryRunId = null;
      app._rateLimitRetryActive = false;
    }
  } catch (_) {}
  try {
    document.querySelectorAll('.gpt-oc-work-title.gpt-rail-shine').forEach((el) => {
      el.classList.remove('gpt-rail-shine');
      if (el.dataset.gptRailOrig) {
        el.textContent = el.dataset.gptRailOrig;
        delete el.dataset.gptRailOrig;
      }
    });
  } catch (_) {}
}

/**
 * Live collapsible tool-row: "Retrying in 5s" + body "reason: rate limited".
 * Scoped to one provider+run — switching model/provider stops painting.
 */
export function createRateLimitRetryNotifier(app, maxAttempts = 6, scope = {}) {
  let intervalId = null;
  let doneTimer = null;
  const ROW_ID = 'rate-limit-retry';
  const provider = String(scope.provider || app?.selectedModel?.type || '').toLowerCase();
  const runId = scope.runId || app?._currentRunId || app?._agentRunId || Date.now();

  const clear = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (doneTimer) {
      clearTimeout(doneTimer);
      doneTimer = null;
    }
  };

  const stillMine = () => {
    if (!app) return true;
    // Aborted or new fetch
    if (app._userRequestedStop) return false;
    if (app._abortReason === 'user') return false;
    // Provider switched mid-retry
    const cur = String(app.selectedModel?.type || '').toLowerCase();
    if (provider && cur && provider !== cur) return false;
    // Different run
    if (app._rateLimitRetryRunId && app._rateLimitRetryRunId !== runId) return false;
    return true;
  };

  const paintRow = (verb, { status = 'running', detail = 'reason: rate limited' } = {}) => {
    if (!stillMine()) {
      clear();
      return;
    }
    try {
      const live = app?.chatHandler?.liveUI;
      if (live?.logAgentAction) {
        live.logAgentAction({
          id: ROW_ID,
          verb: verb || 'Retrying',
          target: '',
          status,
          fcName: 'rate_limit_retry',
          kind: 'status',
          detail: detail
        });
      }
    } catch (_) {}
  };

  let wasActive = false;

  const cancel = (reason = 'stopped') => {
    const had = wasActive || !!app?._rateLimitRetryActive;
    clear();
    wasActive = false;
    try {
      if (app) app._rateLimitRetryActive = false;
    } catch (_) {}
    // Only update the row if a real rate-limit wait was showing — never spam "Retry cancelled" on clean finish
    if (!had) return;
    try {
      const live = app?.chatHandler?.liveUI;
      const why =
        app?._userRequestedStop || reason === 'user'
          ? 'stopped by you'
          : reason === 'provider'
            ? 'provider changed'
            : reason === 'new_run'
              ? 'new request started'
              : String(reason || 'stopped');
      live?.logAgentAction?.({
        id: ROW_ID,
        verb: 'Retry cancelled',
        target: '',
        status: 'done',
        fcName: 'rate_limit_retry',
        kind: 'status',
        detail: why
      });
    } catch (_) {}
  };

  if (app) {
    try {
      if (typeof app._rateLimitRetryCancel === 'function') app._rateLimitRetryCancel('new_run');
    } catch (_) {}
    app._rateLimitRetryCancel = cancel;
    app._rateLimitRetryProvider = provider;
    app._rateLimitRetryRunId = runId;
    app._rateLimitRetryActive = false;
  }

  return function onRetry({ waitMs, attempt, error, bodySnippet, status } = {}) {
    if (!stillMine()) {
      clear();
      return;
    }
    clear();
    const totalSec = Math.max(1, Math.ceil((waitMs || 0) / 1000));
    let left = totalSec;
    const maxA = maxAttempts;
    const provLabel = provider ? provider : 'provider';
    const rawErr = String(error || bodySnippet || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    const reasonLine = rawErr
      ? rawErr
      : (status ? `HTTP ${status} rate/quota limit` : 'rate limited');

    // Console: only for the active provider of this run
    console.warn(
      `[RateLimitRetry] ${provLabel} — retry in ${totalSec}s (attempt ${attempt || 1}/${maxA})`,
      reasonLine.slice(0, 120)
    );

    const tick = () => {
      if (!stillMine()) {
        clear();
        return;
      }
      paintRow(`Retrying in ${left}s`, {
        status: 'running',
        detail: `${reasonLine}\n(${provLabel} · attempt ${attempt || 1}/${maxA})`
      });
    };

    wasActive = true;
    try { if (app) app._rateLimitRetryActive = true; } catch (_) {}
    tick();
    if (left === totalSec && typeof window.toast === 'function') {
      try { window.toast(`Rate limit (${provLabel}) — retry in ${left}s`, 2000); } catch (_) {}
    }

    intervalId = setInterval(() => {
      if (!stillMine()) {
        clear();
        return;
      }
      left -= 1;
      if (left <= 0) {
        clear();
        paintRow('Retrying…', {
          status: 'running',
          detail: `${reasonLine}\n(${provLabel} · sending request)`
        });
        return;
      }
      tick();
    }, 1000);

    doneTimer = setTimeout(() => {
      clear();
      if (!stillMine()) return;
      wasActive = false;
      try { if (app) app._rateLimitRetryActive = false; } catch (_) {}
      paintRow('Retried', {
        status: 'done',
        detail: `${reasonLine}\n(${provLabel} · request resumed)`
      });
    }, (waitMs || 0) + 400);
  };
}

export async function fetchWithRateLimitRetry(fetchFn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 6;
  const onRetry =
    opts.onRetry ||
    (opts.app
      ? createRateLimitRetryNotifier(opts.app, maxAttempts, {
          provider: opts.provider || opts.app?.selectedModel?.type,
          runId: opts.runId || opts.app?._currentRunId
        })
      : null);
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      const e = new Error('Aborted');
      e.name = 'AbortError';
      throw e;
    }
    try {
      const res = await fetchFn();
      if (res.ok) return res;

      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch (_) {}

      const statusHit = res.status === 429 || res.status === 503;
      const msgHit = isRateLimitMessage(bodyText);
      if ((statusHit || msgHit) && attempt < maxAttempts - 1) {
        const suggested = parseRetryAfterMs(res, bodyText);
        const wait = Math.max(backoffMs(attempt), suggested || 0);
        console.warn(
          TAG,
          `HTTP ${res.status} rate/quota — retry in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`
        );
        onRetry?.({
          status: res.status,
          waitMs: wait,
          attempt: attempt + 1,
          bodySnippet: bodyText.slice(0, 180)
        });
        await sleep(wait, opts.signal);
        continue;
      }

      return new Response(bodyText, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      });
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') { try { cancelRateLimitRetry(opts.app); } catch (_) {} throw err; }
      if (isRateLimitError(err, null) && attempt < maxAttempts - 1) {
        const suggested = parseRetryAfterMs(null, err?.message);
        const wait = Math.max(backoffMs(attempt), suggested || 0);
        console.warn(TAG, `rate limit error — retry in ${Math.round(wait / 1000)}s`, err?.message);
        onRetry?.({ error: err?.message, waitMs: wait, attempt: attempt + 1 });
        await sleep(wait, opts.signal);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Rate limit: max retries exceeded');
}

/**
 * One-liner for any provider generateStream:
 *   const response = await providerFetch(app, () => fetch(url, opts), { signal });
 */
export function providerFetch(app, fetchFn, opts = {}) {
  return fetchWithRateLimitRetry(fetchFn, {
    signal: opts.signal,
    maxAttempts: opts.maxAttempts ?? 6,
    app,
    provider: opts.provider || app?.selectedModel?.type,
    runId: opts.runId || app?._currentRunId
  });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        const e = new Error('Aborted');
        e.name = 'AbortError';
        reject(e);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
