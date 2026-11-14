/**
 * Resolve the API model id actually used for generation.
 * selectedModel.model is often just the provider slug ("openrouter") —
 * the real id lives in ConfigManager under config.modelKeyName
 * e.g. openrouterSelectedModel → "qwen/qwen3.7-flash"
 */
import { ConfigManager } from './ConfigManager.js';
import { ModelConfig } from '../model/ModelConfig.js';

const PROVIDER_SLUGS = new Set([
  'openrouter', 'openai', 'gemini', 'mistral', 'deepseek', 'ollama',
  'anthropic', 'claude', 'groq', 'groqcloud', 'together', 'fireworks',
  'deepinfra', 'siliconflow', 'hyperbolic', 'sambanova', 'novita',
  'huggingface', 'gpt', 'chatgpt', 'perplexity', 'bedrock', 'vertex'
]);

export function resolveApiModelId(app, msg = null) {
  if (msg?.modelId && !isProviderSlug(msg.modelId)) return String(msg.modelId).trim();

  const sm = app?.selectedModel || {};
  const type = String(sm.type || msg?.provider || '').toLowerCase();

  // 1) Config storage key (primary source for OpenRouter etc.)
  try {
    const cfg = ModelConfig[type] || {};
    const key = cfg.modelKeyName;
    if (key) {
      const v = ConfigManager.get(key);
      if (v && String(v) !== 'null' && !isProviderSlug(v)) return String(v).trim();
    }
  } catch (_) {}

  // 2) lastSelectedModel / selectedModel fields
  const cands = [
    app?.lastSelectedModel,
    sm.modelId,
    sm.apiModel,
    sm.model,
    sm.id,
    msg?.modelName,
    sm.name
  ];
  for (const c of cands) {
    if (!c) continue;
    const s = String(c).trim();
    if (!s || s === 'null') continue;
    if (type && s.toLowerCase() === type) continue;
    if (isProviderSlug(s)) continue;
    return s;
  }

  return '';
}

export function isProviderSlug(s) {
  return PROVIDER_SLUGS.has(String(s || '').toLowerCase().trim());
}

/** Pretty label for footer: "OpenRouter · qwen/qwen3.7-flash" */
export function formatModelFooter(app, msg = null) {
  const type = String(msg?.provider || app?.selectedModel?.type || '').toLowerCase();
  const map = {
    openrouter: 'OpenRouter', openai: 'OpenAI', gpt: 'OpenAI', chatgpt: 'OpenAI',
    gemini: 'Gemini', mistral: 'Mistral', deepseek: 'DeepSeek', ollama: 'Ollama',
    anthropic: 'Claude', claude: 'Claude', groq: 'Groq', groqcloud: 'Groq',
    together: 'Together', fireworks: 'Fireworks', huggingface: 'HuggingFace'
  };
  const provider = map[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
  const modelId = resolveApiModelId(app, msg);
  if (provider && modelId) return `${provider} · ${modelId}`;
  return modelId || provider || '';
}
