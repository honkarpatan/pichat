// Provider live usage (OpenRouter GET /api/v1/key, extensible for others).
// Cache per api-key value; used by UsageTab + top-bar circle + smart random pick.

const CACHE = new Map(); // keyValue -> { at, data, error }
const TTL_MS = 60_000;

function bearerHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/** Parse rate-limit headers (Groq / Together / many OpenAI-compat). */
function normalizeRateLimitHeaders(headers, provider) {
  if (!headers) return null;
  const get = (k) => {
    try {
      return headers.get ? headers.get(k) : (headers[k] || headers[k.toLowerCase()]);
    } catch (_) { return null; }
  };
  const remReq = numOrNull(get('x-ratelimit-remaining-requests'));
  const limReq = numOrNull(get('x-ratelimit-limit-requests'));
  const remTok = numOrNull(get('x-ratelimit-remaining-tokens'));
  const limTok = numOrNull(get('x-ratelimit-limit-tokens'));
  if (remReq == null && remTok == null && limReq == null && limTok == null) return null;

  let remaining = remReq;
  let limit = limReq;
  let unit = 'requests';
  if (remaining == null && remTok != null) {
    remaining = remTok;
    limit = limTok;
    unit = 'tokens';
  }
  const pctRemain = limit != null && limit > 0 && remaining != null
    ? Math.min(100, Math.max(0, (remaining / limit) * 100))
    : (remaining === 0 ? 0 : null);

  return {
    provider,
    label: '',
    limit,
    remaining,
    usage: limit != null && remaining != null ? Math.max(0, limit - remaining) : null,
    usageDaily: null,
    usageWeekly: null,
    usageMonthly: null,
    isFreeTier: false,
    freeModelDaily: null,
    effectiveBudget: null,
    budgets: [],
    expiresAt: null,
    pctUsed: pctRemain != null ? 100 - pctRemain : null,
    pctRemain,
    unit,
    source: 'headers',
    raw: { remReq, limReq, remTok, limTok }
  };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Probe an OpenAI-compat models endpoint and read rate-limit headers. */
async function probeRateLimit(url, apiKey, provider) {
  const res = await fetch(url, { method: 'GET', headers: bearerHeaders(apiKey) });
  const data = normalizeRateLimitHeaders(res.headers, provider);
  if (!res.ok && !data) {
    const t = await res.text().catch(() => '');
    throw new Error(`${provider} probe ${res.status}: ${t.slice(0, 100)}`);
  }
  if (!data) {
    // Valid key but no rate headers — mark as ok unlimited probe
    return {
      provider,
      label: '',
      limit: null,
      remaining: null,
      usage: null,
      pctRemain: null,
      pctUsed: null,
      source: 'probe',
      note: 'Key valid · no rate-limit headers'
    };
  }
  return data;
}

/** Providers that expose live usage/credits or rate-limit headers */
export const USAGE_CAPABLE = {
  openrouter: {
    label: 'OpenRouter',
    async fetchKey(apiKey) {
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        method: 'GET',
        headers: bearerHeaders(apiKey)
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`OpenRouter key API ${res.status}: ${t.slice(0, 120)}`);
      }
      const json = await res.json();
      return normalizeOpenRouter(json?.data || json);
    }
  },
  deepseek: {
    label: 'DeepSeek',
    async fetchKey(apiKey) {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET',
        headers: bearerHeaders(apiKey)
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`DeepSeek balance ${res.status}: ${t.slice(0, 120)}`);
      }
      const json = await res.json();
      return normalizeDeepSeek(json);
    }
  },
  // Groq (direct + llama-via-groq + groqcloud config keys)
  groqcloud: {
    label: 'Groq',
    async fetchKey(apiKey) {
      return probeRateLimit('https://api.groq.com/openai/v1/models', apiKey, 'groq');
    }
  },
  llama: {
    label: 'Groq',
    async fetchKey(apiKey) {
      return probeRateLimit('https://api.groq.com/openai/v1/models', apiKey, 'groq');
    }
  },
  together: {
    label: 'Together',
    async fetchKey(apiKey) {
      return probeRateLimit('https://api.together.xyz/v1/models', apiKey, 'together');
    }
  }
  // chatgpt / gemini: no reliable public balance without admin → circle uses local tokens only
};

function normalizeOpenRouter(d) {
  if (!d || typeof d !== 'object') return null;
  let limit = d.limit != null && d.limit !== '' ? Number(d.limit) : null;
  let remaining = d.limit_remaining != null && d.limit_remaining !== ''
    ? Number(d.limit_remaining)
    : null;
  // Fall back to effective_budget when key has no explicit limit
  const eb = d.effective_budget;
  if ((remaining == null || Number.isNaN(remaining)) && eb?.remaining_usd != null) {
    remaining = Number(eb.remaining_usd);
  }
  if ((limit == null || Number.isNaN(limit)) && eb?.limit_usd != null) {
    limit = Number(eb.limit_usd);
  }
  if (Number.isNaN(remaining)) remaining = null;
  if (Number.isNaN(limit)) limit = null;

  const usage = d.usage != null ? Number(d.usage) : 0;
  const usedFromLimit = limit != null && remaining != null
    ? Math.max(0, limit - remaining)
    : usage;
  const pctUsed = limit != null && limit > 0
    ? Math.min(100, Math.max(0, (usedFromLimit / limit) * 100))
    : null;
  const pctRemain = pctUsed != null ? 100 - pctUsed : (remaining === 0 ? 0 : null);

  return {
    provider: 'openrouter',
    label: d.label || '',
    limit,
    remaining,
    usage,
    usageDaily: d.usage_daily != null ? Number(d.usage_daily) : 0,
    usageWeekly: d.usage_weekly != null ? Number(d.usage_weekly) : 0,
    usageMonthly: d.usage_monthly != null ? Number(d.usage_monthly) : 0,
    isFreeTier: !!d.is_free_tier,
    freeModelDaily: d.free_model_daily_requests || null,
    effectiveBudget: d.effective_budget || null,
    budgets: Array.isArray(d.budgets) ? d.budgets : [],
    expiresAt: d.expires_at || null,
    pctUsed,
    pctRemain,
    raw: d
  };
}

export function supportsProviderUsage(modelType) {
  return !!USAGE_CAPABLE[String(modelType || '').toLowerCase()];
}

export function getCached(apiKey) {
  if (!apiKey) return null;
  const hit = CACHE.get(apiKey);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS * 5) return hit; // stale ok for display
  return hit;
}

export async function fetchProviderUsage(modelType, apiKey, { force = false } = {}) {
  const type = String(modelType || '').toLowerCase();
  const handler = USAGE_CAPABLE[type];
  if (!handler || !apiKey || apiKey === 'null') {
    return { supported: false, data: null, error: null };
  }

  const cached = CACHE.get(apiKey);
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return { supported: true, data: cached.data, error: cached.error, cached: true };
  }

  try {
    const data = await handler.fetchKey(apiKey);
    CACHE.set(apiKey, { at: Date.now(), data, error: null });
    return { supported: true, data, error: null, cached: false };
  } catch (e) {
    const err = e?.message || String(e);
    CACHE.set(apiKey, { at: Date.now(), data: cached?.data || null, error: err });
    return { supported: true, data: cached?.data || null, error: err, cached: !!cached?.data };
  }
}

/** Fetch usage for every key in a pool (parallel, best-effort). */
export async function fetchPoolUsage(modelType, pool) {
  const type = String(modelType || '').toLowerCase();
  if (!supportsProviderUsage(type) || !Array.isArray(pool) || !pool.length) return [];
  const results = await Promise.all(
    pool.map(async (k) => {
      const keyVal = k.key || k.apiKey || '';
      if (!keyVal || keyVal === 'null') {
        return {
          id: k.id,
          name: k.name || 'Key',
          keyPreview: '••••',
          supported: true,
          data: null,
          error: 'empty key'
        };
      }
      try {
        const r = await fetchProviderUsage(type, keyVal);
        return {
          id: k.id,
          name: k.name || 'Key',
          keyPreview: maskKey(keyVal),
          ...r
        };
      } catch (e) {
        return {
          id: k.id,
          name: k.name || 'Key',
          keyPreview: maskKey(keyVal),
          supported: true,
          data: null,
          error: e?.message || String(e)
        };
      }
    })
  );
  return results;
}

export function maskKey(key) {
  const s = String(key || '');
  if (s.length < 12) return '••••';
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/** Score for smart random: higher remaining = better. Rate-limit-ish → 0. */
export function scoreKeyUsage(usageData) {
  if (!usageData) return 1; // unknown — neutral
  if (usageData.remaining != null && usageData.limit != null) {
    if (usageData.remaining <= 0) return 0;
    return Math.max(0.01, usageData.remaining / Math.max(usageData.limit, 0.01));
  }
  if (usageData.pctRemain != null) return Math.max(0.01, usageData.pctRemain / 100);
  return 1;
}

export function formatUsd(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  if (v === 0) return '$0';
  if (v >= 100) return `$${v.toFixed(1)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

/** Human line for remaining credit — never blank "— left". */
export function formatRemainingLine(d) {
  if (!d) return 'no data';
  if (d.note && d.remaining == null && d.pctRemain == null) return d.note;
  if (d.remaining != null && !Number.isNaN(Number(d.remaining))) {
    const unit = d.unit || (d.source === 'headers' ? 'req' : null);
    if (unit === 'requests' || unit === 'req' || unit === 'tokens') {
      const pct = d.pctRemain != null ? ` (${Math.round(d.pctRemain)}%)` : '';
      if (Number(d.remaining) <= 0) return `exhausted · 0 ${unit}${pct || ' (0%)'}`;
      const lim = d.limit != null ? ` / ${d.limit}` : '';
      return `${d.remaining}${lim} ${unit} left${pct}`;
    }
    const u = formatUsd(d.remaining);
    const pct = d.pctRemain != null ? ` (${Math.round(d.pctRemain)}%)` : '';
    if (Number(d.remaining) <= 0) return `exhausted · $0 left${pct || ' (0%)'}`;
    return `${u} left${pct}`;
  }
  if (d.usage != null) return `used ${formatUsd(d.usage) || String(d.usage)} (no limit set)`;
  return 'no credit data';
}

function normalizeDeepSeek(json) {
  // { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
  const infos = json?.balance_infos || json?.data?.balance_infos || [];
  const usd = infos.find(b => String(b.currency || '').toUpperCase() === 'USD') || infos[0];
  if (!usd) {
    return {
      provider: 'deepseek',
      remaining: null,
      limit: null,
      usage: null,
      pctRemain: null,
      note: json?.is_available === false ? 'Balance unavailable' : 'No balance info',
      raw: json
    };
  }
  const total = numOrNull(usd.total_balance);
  const granted = numOrNull(usd.granted_balance);
  const topped = numOrNull(usd.topped_up_balance);
  return {
    provider: 'deepseek',
    label: '',
    limit: null,
    remaining: total,
    usage: null,
    usageDaily: null,
    usageWeekly: null,
    usageMonthly: null,
    isFreeTier: false,
    freeModelDaily: null,
    effectiveBudget: null,
    budgets: [],
    expiresAt: null,
    pctUsed: null,
    pctRemain: total === 0 ? 0 : null,
    granted,
    toppedUp: topped,
    source: 'balance',
    raw: json
  };
}
