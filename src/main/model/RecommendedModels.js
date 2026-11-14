/**
 * Curated recommended agent models — ONLY ids verified to work without
 * max_tokens / tool errors in this plugin. Expand the list as you test more.
 *
 * Agent tab = intersection of this allowlist ∩ models returned by the provider.
 * OpenRouter shows qwen/… ; Gemini will not (different catalog).
 */

/** Full OpenRouter-style ids (preferred) + bare short forms */
export const RECOMMENDED_AGENT_IDS = [
  'qwen/qwen3.7-flash',
  'qwen/qwen3.8-flash',
  'gemini-2.5-pro'
];

/** Strip ~, :batch, :free — keep org/model when present */
export function normalizeModelId(id) {
  let s = String(id || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('~')) s = s.slice(1);
  s = s.replace(/:batch$/i, '').replace(/:free$/i, '');
  return s;
}

/** Last path segment only */
export function shortModelId(id) {
  const s = normalizeModelId(id);
  const slash = s.lastIndexOf('/');
  return slash >= 0 ? s.slice(slash + 1) : s;
}

const FULL_SET = new Set(RECOMMENDED_AGENT_IDS.map(normalizeModelId));
const SHORT_SET = new Set(RECOMMENDED_AGENT_IDS.map(shortModelId));

/**
 * True only if this model id is on our verified agent list.
 * Matches full id (qwen/qwen3.7-flash) or short (qwen3.7-flash).
 */
export function isRecommendedAgent(modelOrId) {
  const raw = typeof modelOrId === 'object'
    ? (modelOrId.id || modelOrId.name || '')
    : modelOrId;
  const full = normalizeModelId(raw);
  if (!full) return false;
  if (FULL_SET.has(full)) return true;
  const short = shortModelId(full);
  return SHORT_SET.has(short);
}

const CODING_PAT = ['coder', 'codestral', 'devstral', 'codex', 'starcoder', 'qwen3-coder', 'deepseek-coder'];
const CHAT_PAT = ['flash', 'mini', 'small', 'haiku', 'instant', 'turbo', 'lite'];
const IMAGE_PAT = ['dall-e', 'dalle', 'gpt-image', 'imagen', 'flux', 'stable-diffusion', 'sdxl', 'image'];

export const REC_TAB_DEFS = [
  { id: 'all', label: 'All' },
  { id: 'agent', label: 'Agent' },
  { id: 'coding', label: 'Coding' },
  { id: 'chat', label: 'Chat' },
  { id: 'image', label: 'Image' }
];

function haystack(model) {
  const id = String(typeof model === 'object' ? (model.id || model.name || '') : model).toLowerCase();
  const name = String(typeof model === 'object' ? (model.name || '') : '').toLowerCase();
  return `${id} ${name}`;
}

export function modelMatchesCategory(model, modelType, cat) {
  if (cat === 'all') return true;
  if (cat === 'agent') return isRecommendedAgent(model);
  const h = haystack(model);
  if (cat === 'coding') return CODING_PAT.some(p => h.includes(p));
  if (cat === 'chat') return CHAT_PAT.some(p => h.includes(p));
  if (cat === 'image') return IMAGE_PAT.some(p => h.includes(p));
  return false;
}

export function availableRecTabs(models, modelType) {
  const list = Array.isArray(models) ? models : [];
  const tabs = [];
  for (const def of REC_TAB_DEFS) {
    if (def.id === 'all') {
      if (list.length) tabs.push({ ...def, count: list.length });
      continue;
    }
    const n = list.filter(m => modelMatchesCategory(m, modelType, def.id)).length;
    if (n > 0) tabs.push({ ...def, count: n });
  }
  return tabs;
}

export function filterModelsByTab(models, modelType, tabId) {
  const list = Array.isArray(models) ? models : [];
  if (!tabId || tabId === 'all') return list;
  return list.filter(m => modelMatchesCategory(m, modelType, tabId));
}

export function filterModelsBySearch(models, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return models;
  return (models || []).filter(m => {
    const id = String(typeof m === 'object' ? (m.id || '') : m).toLowerCase();
    const name = String(typeof m === 'object' ? (m.name || '') : '').toLowerCase();
    const desc = String(typeof m === 'object' ? (m.description || '') : '').toLowerCase();
    return id.includes(q) || name.includes(q) || desc.includes(q);
  });
}

export function formatTokenLimits(m) {
  if (!m || typeof m !== 'object') return '';
  const ctx = m.contextLength || m.context_length || m.inputLimit || null;
  const out = m.maxOutput || m.max_completion_tokens
    || m.top_provider?.max_completion_tokens || null;
  const parts = [];
  if (ctx) parts.push(`in ${fmtTok(ctx)}`);
  if (out) parts.push(`out ${fmtTok(out)}`);
  if (m.supportsTools) parts.push('tools');
  return parts.join(' · ');
}

function fmtTok(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}
