import { ConfigManager } from '../utils/ConfigManager.js';
import {
  FIM_GLOBAL_DEFAULTS,
  FIM_STORAGE_KEY,
  FimModelProfiles,
  getFimProfile
} from './FimConfig.js';

export function loadFimSettings(modelType) {
  const profile = getFimProfile(modelType);
  const base = {
    ...FIM_GLOBAL_DEFAULTS,
    ...(profile.defaults || {})
  };
  try {
    const raw = ConfigManager.get(FIM_STORAGE_KEY(modelType));
    if (!raw) return { ...base, _profile: profile };
    const saved = JSON.parse(raw);
    return { ...base, ...saved, _profile: profile };
  } catch (_) {
    return { ...base, _profile: profile };
  }
}

/**
 * Only one model may have FIM enabled at a time.
 * Enabling A turns off enabled on every other stored FIM profile.
 */
export function saveFimSettings(modelType, settings) {
  const copy = { ...settings };
  delete copy._profile;
  ConfigManager.set(FIM_STORAGE_KEY(modelType), JSON.stringify(copy));

  if (copy.enabled) {
    disableFimOnOtherModels(modelType);
    ConfigManager.set('fimActiveModelType', String(modelType || '').toLowerCase());
  } else {
    const active = String(ConfigManager.get('fimActiveModelType') || '').toLowerCase();
    if (active === String(modelType || '').toLowerCase()) {
      ConfigManager.remove('fimActiveModelType');
    }
  }
}

export function disableFimOnOtherModels(exceptType) {
  const except = String(exceptType || '').toLowerCase();
  const keys = new Set(Object.keys(FimModelProfiles || {}));
  // Also scan custom_* keys that may have FIM storage
  try {
    // ConfigManager may not expose all keys — still clear known profiles
    keys.forEach((type) => {
      if (type === except) return;
      const raw = ConfigManager.get(FIM_STORAGE_KEY(type));
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (s && s.enabled) {
          s.enabled = false;
          ConfigManager.set(FIM_STORAGE_KEY(type), JSON.stringify(s));
        }
      } catch (_) {}
    });
  } catch (e) {
    console.warn('[FimSettings] disableFimOnOtherModels', e);
  }
}

export function isFimEnabled(modelType) {
  return !!loadFimSettings(modelType).enabled;
}

/** Which model type currently has FIM on (if any) */
export function getActiveFimModelType() {
  const marked = String(ConfigManager.get('fimActiveModelType') || '').toLowerCase();
  if (marked && isFimEnabled(marked)) return marked;
  for (const type of Object.keys(FimModelProfiles || {})) {
    if (isFimEnabled(type)) return type;
  }
  return null;
}
