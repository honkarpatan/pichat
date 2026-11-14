/**
 * Per-model FIM (Fill-In-the-Middle) profiles.
 * Kept separate from ModelConfig so chat config stays lean.
 *
 * mode:
 *  - openai_suffix   → body: { prompt, suffix, … }  (OpenAI code infill style)
 *  - deepseek_tokens → special tokens in prompt
 *  - codestral       → Mistral/Codestral FIM tokens
 *  - ollama_raw      → single prompt string with markers
 *  - custom_template → user/custom API template with {{PREFIX}} {{SUFFIX}} {{MIDDLE}}
 */

export const FIM_STORAGE_KEY = (modelType) => `${modelType}FimOptions`;

/** Global defaults merged under each profile */
export const FIM_GLOBAL_DEFAULTS = {
  enabled: false,
  /** Trigger while typing (debounced) */
  autoTrigger: true,
  debounceMs: 450,
  /** Always-on vs only when wake key pressed */
  alwaysOn: false,
  /** Comma-separated key combos, e.g. "Ctrl-Space,Alt-/" */
  wakeKeys: 'Ctrl-.',
  /** Accept suggestion */
  acceptKey: 'Tab',
  dismissKey: 'Escape',
  maxTokens: 128,
  temperature: 0.2,
  topP: 0.95,
  stopSequences: '\\n\\n',
  /** Chars of context left/right of cursor */
  prefixChars: 2048,
  suffixChars: 512,
  minPrefixChars: 8,
  /** Skip FIM inside strings/comments when possible (best-effort) */
  smartSkip: true,
  /** Use Custom API payload when available */
  useCustomApi: false,
  /** Override model id for FIM only (empty = chat model id) */
  fimModelId: '',
  /** custom_template mode body */
  customTemplate: '',
  /** Show ghost overlay */
  showGhost: true,
  /** Multi-line completions */
  multiline: true
};

/**
 * @typedef {object} FimProfile
 * @property {boolean} supported
 * @property {string} mode
 * @property {string} [label]
 * @property {object} [defaults]  overrides for FIM_GLOBAL_DEFAULTS
 * @property {string[]} [stop]
 * @property {(prefix:string,suffix:string,opts:object)=>object|string} [build] optional
 */

export const FimModelProfiles = {
  chatgpt: {
    supported: true,
    mode: 'openai_suffix',
    label: 'OpenAI-style prompt+suffix',
    defaults: { maxTokens: 128, temperature: 0.2 }
  },
  deepseek: {
    supported: true,
    mode: 'deepseek_tokens',
    label: 'DeepSeek FIM tokens',
    defaults: { maxTokens: 256, temperature: 0.0 },
    stop: ['<|fim_pad|>', '<|eos_token|>', '<|EOT|>']
  },
  mistral: {
    supported: true,
    mode: 'codestral',
    label: 'Codestral FIM only (not mistral-large)',
    defaults: {
      maxTokens: 256,
      temperature: 0.0,
      fimModelId: 'codestral-latest'
    },
    stop: ['</s>']
  },
  codestral: {
    supported: true,
    mode: 'codestral',
    label: 'Codestral FIM',
    defaults: {
      maxTokens: 256,
      temperature: 0.0,
      fimModelId: 'codestral-latest'
    }
  },
  ollama: {
    supported: true,
    mode: 'ollama_raw',
    label: 'Ollama raw FIM prompt',
    defaults: { maxTokens: 128, temperature: 0.2, alwaysOn: false }
  },
  huggingface: {
    supported: true,
    mode: 'openai_suffix',
    label: 'HF OpenAI-compatible FIM',
    defaults: { maxTokens: 128 }
  },
  openrouter: {
    supported: true,
    mode: 'openai_suffix',
    label: 'OpenRouter (model-dependent)',
    defaults: { maxTokens: 128 }
  },
  groqcloud: {
    supported: true,
    mode: 'openai_suffix',
    label: 'Groq (model-dependent)',
    defaults: { maxTokens: 128 }
  },
  together: {
    supported: true,
    mode: 'openai_suffix',
    label: 'Together AI FIM-capable models',
    defaults: { maxTokens: 128 }
  },
  fireworks: {
    supported: true,
    mode: 'openai_suffix',
    label: 'Fireworks',
    defaults: { maxTokens: 128 }
  },
  deepinfra: {
    supported: true,
    mode: 'openai_suffix',
    label: 'DeepInfra',
    defaults: { maxTokens: 128 }
  },
  siliconflow: {
    supported: true,
    mode: 'openai_suffix',
    label: 'SiliconFlow',
    defaults: { maxTokens: 128 }
  },
  hyperbolic: {
    supported: true,
    mode: 'openai_suffix',
    label: 'Hyperbolic',
    defaults: { maxTokens: 128 }
  },
  sambanova: {
    supported: true,
    mode: 'openai_suffix',
    label: 'SambaNova',
    defaults: { maxTokens: 128 }
  },
  novita: {
    supported: true,
    mode: 'openai_suffix',
    label: 'Novita',
    defaults: { maxTokens: 128 }
  },
  githubmodels: {
    supported: true,
    mode: 'openai_suffix',
    label: 'GitHub Models (if model supports)',
    defaults: { maxTokens: 128 }
  },
  // Explicitly unsupported / chat-only
  gemini: { supported: false, mode: 'none', label: 'No native FIM' },
  claude: { supported: false, mode: 'none', label: 'No native FIM' },
  perplexity: { supported: false, mode: 'none', label: 'No native FIM' },
  grok: { supported: false, mode: 'none', label: 'Limited / none' },
  bedrock: { supported: false, mode: 'none', label: 'Use Converse chat only' },
  vertex: { supported: false, mode: 'none', label: 'Use chat only' },
  githubcopilot: { supported: false, mode: 'none', label: 'Use IDE Copilot inline' }
};

export function getFimProfile(modelType) {
  const key = String(modelType || '').toLowerCase();
  if (FimModelProfiles[key]) return FimModelProfiles[key];
  // custom_* models: allow custom_template
  if (key.startsWith('custom_')) {
    return {
      supported: true,
      mode: 'custom_template',
      label: 'Custom model FIM template',
      defaults: { useCustomApi: true, maxTokens: 128 }
    };
  }
  return { supported: false, mode: 'none', label: 'Not configured' };
}

export function supportsFim(modelType) {
  return !!getFimProfile(modelType).supported;
}
