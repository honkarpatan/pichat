// Provider → start-page theme id.
// Developers: change values here to swap layouts per provider.
// Colors always come from ModelConfig (image_bg, optional startPage colors).

/** @typedef {'chatgpt'|'codex'|'gemini'|'claude'|'openrouter'|'grok'|'minimal'|'commands'} StartPageThemeId */

/**
 * Map modelType (ModelConfig key) → theme id.
 * Unlisted providers fall back to DEFAULT_START_PAGE_THEME.
 */
export const PROVIDER_START_PAGE_THEME = {
  chatgpt: 'chatgpt',
  gemini: 'gemini',
  claude: 'claude',
  openrouter: 'openrouter',
  grok: 'grok',
  mistral: 'commands',
  deepseek: 'codex',
  ollama: 'minimal',
  huggingface: 'minimal',
  llama: 'minimal',
  llamacpp: 'minimal',
  perplexity: 'gemini',
  groq: 'codex',
  together: 'openrouter',
  fireworks: 'openrouter',
  deepinfra: 'codex',
  bedrock: 'claude',
  vertex: 'gemini',
  github_copilot: 'codex',
  github_models: 'codex',
  openai_compatible: 'chatgpt',
  // Example: use professional layout for a provider
  // bedrock: 'professional'
};

export const DEFAULT_START_PAGE_THEME = 'chatgpt';

/** Default / slash command chips when theme enables showCommandHints */
export const DEFAULT_COMMAND_HINTS = [
  { cmd: '/mode', label: 'Mode', hint: 'ask · edits · full · plan' },
  { cmd: '/settings', label: 'Settings', hint: 'API keys & options' },
  { cmd: '/perms', label: 'Perms', hint: 'allow · deny patterns' },
  { cmd: '/help', label: 'Help', hint: 'slash commands' }
];

export function resolveStartPageThemeId(modelType, modelConfigEntry = null) {
  const explicit = modelConfigEntry?.startPageTheme;
  if (explicit) return String(explicit);
  const key = String(modelType || '').toLowerCase();
  return PROVIDER_START_PAGE_THEME[key] || DEFAULT_START_PAGE_THEME;
}
