// src/main/core/model/ApiKeyManager.js
import { ConfigManager } from '../utils/ConfigManager.js';

// 🟢 Multi API Key System
// Each provider (config.apiKeyName, e.g. 'geminiApiKey') can now hold a POOL of
// named keys instead of a single string. This module owns that pool: storage,
// CRUD, duplicate-name checks, the "which key to use" strategy, and the
// request-time failover loop (try key -> on failure, try the next one).
//
// Backward compatibility: `config.apiKeyName` (e.g. ConfigManager.get('geminiApiKey'))
// is kept in sync with whichever key is currently "active" so any other code that
// still reads that single slot directly (ModelManager's missing-key check, AgentRunner,
// custom-API payload building, etc.) keeps working with zero changes.

const MAX_KEYS = 50;
const MIN_TRAILING_EMPTY = 2;
const RANDOM_STRATEGY = 'random';

export class ApiKeyManager {

    static get MAX_KEYS() { return MAX_KEYS; }
    static get MIN_TRAILING_EMPTY() { return MIN_TRAILING_EMPTY; }
    static get RANDOM_STRATEGY() { return RANDOM_STRATEGY; }

    static _poolStorageKey(config) {
        return `${config.apiKeyName}Pool`;
    }

    static _strategyStorageKey(modelType) {
        return `${modelType}ApiKeyStrategy`;
    }

    static _lastUsedStorageKey(modelType) {
        return `${modelType}ApiKeyLastUsed`;
    }

    static genId() {
        return 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // ---------- Pool read/write ----------

    /**
     * Returns the saved key pool for a provider: [{ id, name, key, createdAt }, ...]
     * Auto-migrates a legacy single-string key (ConfigManager.get(config.apiKeyName))
     * into a one-item pool the first time this is called for that provider.
     */
    static getPool(modelType, config) {
        if (!config || !config.apiKeyName) return [];

        const raw = ConfigManager.get(this._poolStorageKey(config));
        if (raw && raw !== 'null') {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            } catch (e) {
                console.warn('[ApiKeyManager] Corrupt key pool, ignoring:', e);
            }
        }

        // Legacy migration: an old single-key install has a plain string under
        // config.apiKeyName. Turn it into "Key 1" the first time we see it.
        const legacy = ConfigManager.get(config.apiKeyName);
        if (legacy && legacy !== 'null' && legacy.trim() !== '') {
            const migrated = [{ id: this.genId(), name: 'Key 1', key: legacy.trim(), createdAt: Date.now() }];
            this.savePool(modelType, config, migrated, /* app */ null);
            return migrated;
        }

        return [];
    }

    /** Persists the pool and keeps the legacy single-key slot in sync. */
    static savePool(modelType, config, pool, app = null) {
        ConfigManager.set(this._poolStorageKey(config), JSON.stringify(pool));
        this.syncLegacySlot(modelType, config, app);
    }

    /**
     * Keeps ConfigManager.get(config.apiKeyName) (and app[config.apiKeyName])
     * pointing at a valid key whenever the pool isn't empty, so any code that
     * hasn't been updated for the pool system keeps working unmodified.
     */
    static syncLegacySlot(modelType, config, app = null) {
        const pool = this.getPool(modelType, config);
        if (pool.length === 0) {
            ConfigManager.remove(config.apiKeyName);
            if (app) app[config.apiKeyName] = null;
            return;
        }
        const keyObj = this.pickKey(modelType, config) || pool[0];
        ConfigManager.set(config.apiKeyName, keyObj.key);
        if (app) app[config.apiKeyName] = keyObj.key;
    }

    // ---------- CRUD ----------

    static isNameTaken(modelType, config, name, excludeId = null) {
        const norm = (name || '').trim().toLowerCase();
        if (!norm) return false;
        return this.getPool(modelType, config).some(k => k.id !== excludeId && (k.name || '').trim().toLowerCase() === norm);
    }

    /** Adds or updates a key by id. Returns { ok: true } or { ok: false, error }. */
    static upsertKey(modelType, config, { id, name, key }, app = null) {
        const trimmedKey = (key || '').trim();
        if (!trimmedKey) return { ok: false, error: 'API key value can\'t be empty.' };

        const pool = this.getPool(modelType, config);
        const existingIdx = id ? pool.findIndex(k => k.id === id) : -1;

        let finalName = (name || '').trim();
        if (!finalName) finalName = this._nextDefaultName(pool, existingIdx >= 0 ? id : null);

        if (this.isNameTaken(modelType, config, finalName, existingIdx >= 0 ? id : null)) {
            return { ok: false, error: `A key named "${finalName}" already exists. Names must be unique.` };
        }

        if (existingIdx >= 0) {
            pool[existingIdx] = { ...pool[existingIdx], name: finalName, key: trimmedKey };
        } else {
            if (pool.length >= MAX_KEYS) return { ok: false, error: `You can add up to ${MAX_KEYS} keys.` };
            pool.push({ id: this.genId(), name: finalName, key: trimmedKey, createdAt: Date.now() });
        }

        this.savePool(modelType, config, pool, app);
        return { ok: true };
    }

    static removeKey(modelType, config, id, app = null) {
        const pool = this.getPool(modelType, config).filter(k => k.id !== id);
        this.savePool(modelType, config, pool, app);

        // If the removed key was pinned as the active strategy, fall back to "first key".
        const strategy = this.getStrategy(modelType);
        if (strategy === id) ConfigManager.remove(this._strategyStorageKey(modelType));

        const lastUsed = ConfigManager.get(this._lastUsedStorageKey(modelType));
        if (lastUsed === id) ConfigManager.remove(this._lastUsedStorageKey(modelType));
    }

    static _nextDefaultName(pool, excludeId) {
        const taken = new Set(pool.filter(k => k.id !== excludeId).map(k => (k.name || '').trim().toLowerCase()));
        let n = pool.length + 1;
        let candidate = `Key ${n}`;
        while (taken.has(candidate.toLowerCase())) {
            n += 1;
            candidate = `Key ${n}`;
        }
        return candidate;
    }

    // ---------- Strategy ----------

    /** Returns a key id (pinned strategy), RANDOM_STRATEGY, or null (= default to first key). */
    static getStrategy(modelType) {
        const v = ConfigManager.get(this._strategyStorageKey(modelType));
        return (v && v !== 'null') ? v : null;
    }

    static setStrategy(modelType, value) {
        if (!value) ConfigManager.remove(this._strategyStorageKey(modelType));
        else ConfigManager.set(this._strategyStorageKey(modelType), value);
    }

    // ---------- Key selection ----------

    /**
     * Picks the key to use for the next attempt.
     * - Pinned strategy (a specific key id): use that key if available, else the first available one.
     * - Random strategy: pick randomly, avoiding the key used last time when possible
     *   (so "random" also means "rotate away from what was just used").
     * - excludeIds: keys already tried in this request (used during failover retries).
     */
    static pickKey(modelType, config, { excludeIds = [] } = {}) {
        const pool = this.getPool(modelType, config);
        const available = pool.filter(k => !excludeIds.includes(k.id));
        if (available.length === 0) return null;

        const strategy = this.getStrategy(modelType);

        if (strategy === RANDOM_STRATEGY) {
            const lastUsed = ConfigManager.get(this._lastUsedStorageKey(modelType));
            const rotated = available.length > 1 ? available.filter(k => k.id !== lastUsed) : available;
            const pickFrom = rotated.length > 0 ? rotated : available;
            // Smart random: prefer keys with more remaining credit (OpenRouter cache)
            try {
                const mod = globalThis.__ProviderUsage || null;
                if (mod?.supportsProviderUsage?.(modelType)) {
                    const scored = pickFrom.map(k => {
                        const hit = mod.getCached?.(k.key);
                        const score = mod.scoreKeyUsage?.(hit?.data) ?? 1;
                        return { k, score };
                    }).filter(x => x.score > 0);
                    if (scored.length) {
                        scored.sort((a, b) => b.score - a.score);
                        const top = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
                        return top[Math.floor(Math.random() * top.length)].k;
                    }
                }
            } catch (_) {}
            return pickFrom[Math.floor(Math.random() * pickFrom.length)];
        }

        if (strategy) {
            const pinned = available.find(k => k.id === strategy);
            if (pinned) return pinned;
        }

        return available[0];
    }

    static _syncActiveKey(app, config, keyObj) {
        if (!keyObj) return;
        ConfigManager.set(config.apiKeyName, keyObj.key);
        if (app) {
            app[config.apiKeyName] = keyObj.key;
            app._activeApiKeyId = keyObj.id;
            app._activeApiKeyName = keyObj.name;
        }
    }

    // ---------- Request-time failover ----------

    /**
     * One collapsible row for key tries:
     *   Trying with Api Key 2
     *     Api Key 1:
     *       <error>
     *     Api Key 2:
     *       …
     * After result → "Tried with …"
     */
    static _paintKeyFailBlock(app, failures, {
      tryingNext = false,
      final = false,
      currentName = '',
      success = false
    } = {}) {
        if (!app) return;
        try {
            const live = app?.chatHandler?.liveUI;
            if (!live?.logAgentAction) return;
            const lines = (failures || []).map((f) => {
                const name = f.name || 'API Key';
                const err = String(f.error || 'failed').replace(/\s+/g, ' ').trim().slice(0, 280);
                return `${name}:\n  ${err}`;
            });
            if (success && currentName) {
                lines.push(`${currentName}:\n  ok`);
            }
            const detail = lines.join('\n\n') || (currentName ? `${currentName}:\n  …` : '');
            let verb;
            if (success) {
                verb = `Tried with ${currentName || 'API key'}`;
            } else if (final) {
                verb = failures?.length
                    ? `Tried with ${failures.length} key${failures.length > 1 ? 's' : ''} — all failed`
                    : 'Tried — all keys failed';
            } else if (tryingNext && currentName) {
                verb = `Trying with ${currentName}`;
            } else if (currentName) {
                verb = `Trying with ${currentName}`;
            } else {
                verb = 'Trying next API key';
            }
            live.logAgentAction({
                id: 'api-key-failover',
                verb,
                target: '',
                status: final && !success ? 'error' : (success || final ? 'done' : 'running'),
                fcName: 'api_key_failover',
                kind: 'status',
                detail
            });
        } catch (_) {}
    }

    /**
     * Runs `taskFn` with a chosen key made active. If it throws, automatically
     * retries with the next available key (up to once per key in the pool).
     */
    static async runWithFailover(app, config, modelType, taskFn) {
        if (!config || !config.apiKeyName) {
            if (app) { app._activeApiKeyId = null; app._activeApiKeyName = null; }
            return await taskFn(null);
        }

        const pool = this.getPool(modelType, config);
        if (pool.length === 0) {
            if (app) { app._activeApiKeyId = null; app._activeApiKeyName = null; }
            return await taskFn(null);
        }

        const tried = [];
        const failures = [];
        let lastErr = null;

        for (let attempt = 0; attempt < pool.length; attempt++) {
            const keyObj = this.pickKey(modelType, config, { excludeIds: tried });
            if (!keyObj) break;
            tried.push(keyObj.id);

            this._syncActiveKey(app, config, keyObj);
            ConfigManager.set(this._lastUsedStorageKey(modelType), keyObj.id);

            const keyName = keyObj.name || `Key ${attempt + 1}`;
            // Show Trying with … before the request
            this._paintKeyFailBlock(app, failures, {
                tryingNext: true,
                final: false,
                currentName: keyName
            });

            try {
                const result = await taskFn(keyObj);
                // Success → Tried with this key (keep prior failure details if any)
                this._paintKeyFailBlock(app, failures, {
                    tryingNext: false,
                    final: true,
                    currentName: keyName,
                    success: true
                });
                return result;
            } catch (err) {
                lastErr = err;
                if (err && err.name === 'AbortError') {
                    this._paintKeyFailBlock(app, failures, {
                        tryingNext: false,
                        final: true,
                        currentName: keyName
                    });
                    throw err;
                }
                const errMsg = String(err?.message || err || 'failed').trim();
                failures.push({
                    id: keyObj.id,
                    name: keyName,
                    error: errMsg
                });
                console.warn(
                    `[ApiKeyManager] Key "${keyName}" failed for ${modelType}, trying next key…`,
                    errMsg
                );
                const more = attempt < pool.length - 1;
                // After this key failed: still "Tried" lines inside detail; title stays Trying next if more
                this._paintKeyFailBlock(app, failures, {
                    tryingNext: more,
                    final: !more,
                    currentName: more ? null : keyName
                });
                // If more keys, next loop iteration will set "Trying with next"
            }
        }

        const summary = failures.length
            ? failures.map(f => `${f.name}: ${f.error}`).join(' | ')
            : (lastErr?.message || 'All API keys failed');
        const finalErr = lastErr || new Error(`All API keys failed for ${modelType}.`);
        try {
            finalErr.message = summary.slice(0, 500);
            finalErr.keyFailures = failures;
        } catch (_) {}
        this._paintKeyFailBlock(app, failures, { tryingNext: false, final: true });
        throw finalErr;
    }
}
