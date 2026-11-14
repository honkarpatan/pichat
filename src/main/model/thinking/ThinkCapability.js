/**
 * Real thinking = API-native channels only.
 * Fake prompt-thinking is opt-in via forceEnableNonNativeThinking setting.
 */

import { ConfigManager } from '../../utils/ConfigManager.js';

const NATIVE_ID_RE = /(?:^|\/)(o1|o3|o4)(?:-|$)|deepseek-r1|deepseek-reasoner|reasoner|sonar-reasoning|qwq|qwen3.*?thinking|thinking.*?qwen|claude-(?:3-7|4|sonnet-4|opus-4)|gemini.*?thinking|grok-3-mini|magistral/i;

export function getModelThinkMeta(app) {
  const sel = app?.selectedModel || {};
  const id = String(sel.id || sel.model || sel.name || '').toLowerCase();
  const type = String(sel.type || sel.provider || '').toLowerCase();
  let native = false;
  try {
    const cfg = app?.modelConfig || app?.config;
    if (cfg?.nativeThink) native = true;
  } catch (_) {}
  if (sel.nativeThink === true) native = true;
  if (NATIVE_ID_RE.test(id)) native = true;
  if (type === 'claude' || type === 'anthropic') native = true;
  if (type === 'deepseek') native = true;
  if (type === 'perplexity' && /reason/i.test(id)) native = true;
  return { native, id, type };
}

export function modelSupportsNativeThink(app) {
  return !!getModelThinkMeta(app).native;
}

function readConfigBool(key, defaultVal = false) {
  try {
    const v = ConfigManager.get(key);
    if (v === true || v === 'true' || v === 1) return true;
    if (v === false || v === 'false' || v === 0) return false;
    if (v == null || v === '') return defaultVal;
    return !!v;
  } catch (_) {
    return defaultVal;
  }
}

/** Allow simulated think on non-native models (default OFF). */
export function isForceNonNativeThinkingEnabled(_app) {
  return readConfigBool('forceEnableNonNativeThinking', false);
}

/** Agent two-pass plan → act (default OFF). */
export function isAgentTwoPassPlanEnabled(_app) {
  return readConfigBool('agentTwoPassPlanThinking', false);
}

/** Think toggle ON and allowed for this model (native or force). */
export function canUseThinkingUi(app) {
  let thinkOn = false;
  try {
    thinkOn = !!(app?.chatInputUI?.states?.think);
  } catch (_) {}
  if (!thinkOn) return false;
  if (modelSupportsNativeThink(app)) return true;
  return isForceNonNativeThinkingEnabled(app);
}
