/**
 * Builds FIM requests per profile and calls provider endpoints.
 */
import { ConfigManager } from '../utils/ConfigManager.js';
import { ModelConfig } from '../model/ModelConfig.js';
import { getFimProfile } from './FimConfig.js';
import { loadFimSettings } from './FimSettings.js';

const TAG = '[FimService]';

function deepseekPrompt(prefix, suffix) {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

function codestralPrompt(prefix, suffix) {
  // Codestral / Mistral FIM
  return `[SUFFIX]${suffix}[PREFIX]${prefix}`;
}

function ollamaPrompt(prefix, suffix) {
  return `<PRE> ${prefix} <SUF>${suffix} <MID>`;
}

function parseStop(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map(s => s.replace(/\\n/g, '\n').trim())
    .filter(Boolean);
}

export class FimService {
  /**
   * @returns {Promise<string>} completion text (middle)
   */
  static async complete({ modelType, prefix, suffix, signal }) {
    const profile = getFimProfile(modelType);
    if (!profile.supported) throw new Error(`FIM not supported for ${modelType}`);

    const settings = loadFimSettings(modelType);
    const config = ModelConfig[modelType];
    if (!config) throw new Error(`Unknown model type: ${modelType}`);

    const apiKey = config.apiKeyName ? ConfigManager.get(config.apiKeyName) || '' : '';
    let modelId =
      (settings.fimModelId && settings.fimModelId.trim()) ||
      (config.modelKeyName ? ConfigManager.get(config.modelKeyName) : '') ||
      '';

    // Mistral FIM only works on Codestral* models — never chat models like mistral-large
    if (profile.mode === 'codestral' || modelType === 'mistral') {
      const id = String(modelId || '').toLowerCase();
      if (!id.includes('codestral')) {
        console.warn(
          TAG,
          'Mistral FIM requires a Codestral model id. Chat model',
          modelId || '(empty)',
          '→ forcing codestral-latest. Set FIM tab → “FIM-only model id” to codestral-latest / codestral-2508.'
        );
        modelId = 'codestral-latest';
      }
    }

    const maxTokens = Number(settings.maxTokens) || 128;
    const temperature = Number(settings.temperature) || 0.2;
    const topP = Number(settings.topP) || 0.95;
    const stop = parseStop(settings.stopSequences).concat(profile.stop || []);

    console.log(TAG, '──────── FIM request ────────');
    console.log(TAG, 'modelType=', modelType, '| mode=', profile.mode);
    console.log(TAG, 'modelId=', modelId, '| fimModelId setting=', settings.fimModelId || '(none)');
    console.log(TAG, 'prefixLen=', prefix?.length, '| suffixLen=', suffix?.length);
    console.log(TAG, 'prefix tail=\n', String(prefix || '').slice(-200));
    console.log(TAG, 'suffix head=\n', String(suffix || '').slice(0, 200));
    console.log(TAG, 'maxTokens=', maxTokens, 'temp=', temperature);
    console.log(TAG, '─────────────────────────────');

    // Custom API override for FIM
    if (settings.useCustomApi || profile.mode === 'custom_template') {
      return this._customApiFim({
        modelType,
        apiKey,
        modelId,
        prefix,
        suffix,
        settings,
        maxTokens,
        temperature,
        signal
      });
    }

    switch (profile.mode) {
      case 'openai_suffix':
        return this._openaiStyle({
          config,
          modelType,
          apiKey,
          modelId,
          prefix,
          suffix,
          maxTokens,
          temperature,
          topP,
          stop,
          signal
        });
      case 'deepseek_tokens':
        return this._completionPrompt({
          url: 'https://api.deepseek.com/completions',
          apiKey,
          modelId: modelId || 'deepseek-coder',
          prompt: deepseekPrompt(prefix, suffix),
          maxTokens,
          temperature,
          stop,
          signal
        });
      case 'codestral':
        return this._completionPrompt({
          url: 'https://api.mistral.ai/v1/fim/completions',
          apiKey,
          modelId: modelId || 'codestral-latest',
          bodyExtra: { prompt: prefix, suffix },
          maxTokens,
          temperature,
          stop,
          signal,
          promptField: null
        });
      case 'ollama_raw':
        return this._ollama({
          modelId: modelId || 'codellama:7b-code',
          prompt: ollamaPrompt(prefix, suffix),
          maxTokens,
          temperature,
          signal
        });
      default:
        throw new Error(`FIM mode not implemented: ${profile.mode}`);
    }
  }

  static async _openaiStyle({
    config,
    modelType,
    apiKey,
    modelId,
    prefix,
    suffix,
    maxTokens,
    temperature,
    topP,
    stop,
    signal
  }) {
    // Prefer provider base from OpenAI-compatible map if present
    let url = 'https://api.openai.com/v1/completions';
    try {
      const { OPENAI_COMPAT_PROVIDERS } = await import('../model/providers/openaiCompatible.js');
      const p = OPENAI_COMPAT_PROVIDERS[modelType];
      if (p?.baseUrl) url = `${p.baseUrl.replace(/\/+$/, '')}/completions`;
    } catch (_) {}

    // ChatGPT official still uses /v1/completions for legacy FIM-capable models
    if (modelType === 'chatgpt') url = 'https://api.openai.com/v1/completions';

    const body = {
      model: modelId || 'gpt-3.5-turbo-instruct',
      prompt: prefix,
      suffix,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      stream: false
    };
    if (stop.length) body.stop = stop;

    console.log(TAG, 'openai_suffix', url, 'model=', body.model);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`FIM error (${res.status}): ${t.slice(0, 240)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.text || data.choices?.[0]?.message?.content || '';
  }

  static async _completionPrompt({
    url,
    apiKey,
    modelId,
    prompt,
    bodyExtra,
    maxTokens,
    temperature,
    stop,
    signal,
    promptField = 'prompt'
  }) {
    const body = {
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      ...(bodyExtra || {})
    };
    if (promptField && prompt != null) body[promptField] = prompt;
    if (stop?.length) body.stop = stop;

    console.log(TAG, 'POST', url);
    console.log(TAG, 'body=', {
      ...body,
      prompt: body.prompt != null ? `[${String(body.prompt).length} chars] ${String(body.prompt).slice(0, 120)}…` : undefined,
      suffix: body.suffix != null ? `[${String(body.suffix).length} chars] ${String(body.suffix).slice(0, 80)}…` : undefined
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(TAG, 'error body=', t.slice(0, 500));
      let hint = '';
      if (/FIM is not enabled|3051/i.test(t)) {
        hint =
          '\n→ Use a Codestral model id only (codestral-latest / codestral-2508). Chat models like mistral-large cannot FIM. Set FIM tab → FIM-only model id.';
      }
      throw new Error(`FIM error (${res.status}): ${t.slice(0, 240)}${hint}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.text || data.choices?.[0]?.message?.content || '';
  }

  static async _ollama({ modelId, prompt, maxTokens, temperature, signal }) {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        prompt,
        stream: false,
        options: { num_predict: maxTokens, temperature }
      }),
      signal
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Ollama FIM (${res.status}): ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.response || '';
  }

  static async _customApiFim({
    modelType,
    apiKey,
    modelId,
    prefix,
    suffix,
    settings,
    maxTokens,
    temperature,
    signal
  }) {
    let tpl =
      settings.customTemplate ||
      ConfigManager.get(`${modelType}CustomPayload_primary`) ||
      ConfigManager.get(`${modelType}CustomPayload`) ||
      '';
    if (!tpl) {
      throw new Error('FIM custom mode needs a template (FIM tab) or Custom API payload.');
    }
    tpl = tpl
      .replace(/{{API_KEY}}/g, apiKey || '')
      .replace(/{{MODEL_ID}}/g, modelId || '')
      .replace(/{{PREFIX}}/g, JSON.stringify(prefix).slice(1, -1))
      .replace(/{{SUFFIX}}/g, JSON.stringify(suffix).slice(1, -1))
      .replace(/"{{PREFIX}}"/g, JSON.stringify(prefix))
      .replace(/"{{SUFFIX}}"/g, JSON.stringify(suffix))
      .replace(/{{MAX_TOKENS}}/g, String(maxTokens))
      .replace(/{{TEMPERATURE}}/g, String(temperature));

    let req;
    try {
      req = JSON.parse(tpl);
    } catch (e) {
      throw new Error('Invalid FIM custom JSON template');
    }
    if (!req.url) throw new Error('FIM template must include url');

    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers || { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Custom FIM (${res.status}): ${t.slice(0, 240)}`);
    }
    const data = await res.json();
    return (
      data.choices?.[0]?.text ||
      data.choices?.[0]?.message?.content ||
      data.response ||
      data.completion ||
      ''
    );
  }
}
