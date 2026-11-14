// src/main/core/usage/UsageManager.js
import { ConfigManager } from '../../utils/ConfigManager.js';

const FALLBACK_KEY = 'tokenUsageDataFallback';
const USAGE_DIR = 'usage';
const USAGE_FILE = 'token-usage.json';
const MAX_DAILY_ENTRIES = 30; // keep ~1 month of history, prune the rest
const OTHERS_BUCKET_ID = '__others__';

const DEFAULT_DATA = () => ({
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    global: { requests: 0, tokensIn: 0, tokensOut: 0, lastIn: 0, lastOut: 0, lastModel: null, lastTimestamp: null, lastEstimated: false },
    models: {},
    daily: {}
});

/**
 * 🟢 Token Usage Tracker
 * Tracks requests sent, tokens in/out (real, when a provider reports it — estimated otherwise),
 * a rolling daily history for the usage graph, AND (🟢 Multi API Key System) a per-API-key
 * breakdown for each model — so the Usage tab can show exactly which key is burning tokens.
 *
 * Per-key data lives at `models[modelType].byKey[keyId]`. The key's id/name is whatever was
 * active on `app._activeApiKeyId` / `app._activeApiKeyName` at the moment of recording
 * (ApiRouter/ApiKeyManager set those right before each request). If a key is later deleted,
 * its historical entry stays in `byKey` under its old id — getKeyBreakdown() below folds any
 * id that's no longer in the live pool into a single "Others" bucket instead of dropping it.
 *
 * Storage: prefers the SAME local folder the user already picked for saving chats
 * (`${app.pathUrl}/usage/token-usage.json`) so everything lives together. If no folder has
 * been picked yet, it falls back to ConfigManager and auto-migrates into the folder the
 * moment one is selected (see migrateToPath()).
 */
export class UsageManager {
    constructor(pluginContext) {
        this.app = pluginContext;
        this.data = DEFAULT_DATA();
        this.loaded = false;
        this._loading = null;
    }

    // ---------- Loading ----------

    load() {
        if (this._loading) return this._loading;

        this._loading = (async () => {
            try {
                if (this.app.pathUrl) {
                    const diskData = await this._loadFromDisk();
                    if (diskData) {
                        this.data = diskData;
                        this.loaded = true;
                        this._notify('all', 'loaded');
                        return;
                    }
                }
                const fallback = this._readFallback();
                if (fallback) this.data = fallback;
            } catch (e) {
                console.warn('[UsageManager] load failed:', e);
            } finally {
                this.loaded = true;
                this._notify('all', 'loaded');
            }
        })();

        return this._loading;
    }

    async _loadFromDisk() {
        try {
            const fs = acode.require("fs");
            if (!fs || !this.app.pathUrl) return null;
            const filePath = `${this.app.pathUrl}/${USAGE_DIR}/${USAGE_FILE}`;
            const exists = await fs(filePath).exists();
            if (!exists) return null;
            const raw = await fs(filePath).readFile("utf-8");
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[UsageManager] disk read failed:', e);
            return null;
        }
    }

    _readFallback() {
        try {
            const raw = ConfigManager.get(FALLBACK_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    // ---------- Saving ----------

    async save() {
        this.data.updatedAt = Date.now();
        this._pruneDaily();
        try {
            if (this.app.pathUrl) {
                await this._saveToDisk();
            } else {
                this._saveFallback();
            }
        } catch (e) {
            console.warn('[UsageManager] save failed, using local fallback instead:', e);
            try { this._saveFallback(); } catch (_) {}
        }
    }

    _saveFallback() {
        ConfigManager.set(FALLBACK_KEY, JSON.stringify(this.data));
    }

    async _saveToDisk() {
        const fs = acode.require("fs");
        if (!fs) throw new Error('fs unavailable');

        const dirPath = `${this.app.pathUrl}/${USAGE_DIR}`;
        const dirExists = await fs(dirPath).exists();
        if (!dirExists) await fs(this.app.pathUrl).createDirectory(USAGE_DIR);

        const filePath = `${dirPath}/${USAGE_FILE}`;
        const payload = JSON.stringify(this.data, null, 2);
        const fileExists = await fs(filePath).exists();

        if (fileExists) {
            await fs(filePath).writeFile(payload);
        } else {
            await fs(dirPath).createFile(USAGE_FILE, payload);
        }
    }

    /**
     * Call this right after the user selects/changes their chat storage folder
     * (StorageManager.setPath -> pathCheck). Merges any locally-stored fallback
     * usage data into the newly chosen folder so nothing gets lost.
     */
    async migrateToPath() {
        if (!this.app.pathUrl) return;
        try {
            const diskData = await this._loadFromDisk();
            const fallbackData = this._readFallback();

            if (diskData && fallbackData) {
                this.data = this._mergeData(diskData, fallbackData);
            } else {
                this.data = diskData || fallbackData || this.data || DEFAULT_DATA();
            }

            this.loaded = true;
            await this.save();
            if (fallbackData) ConfigManager.remove(FALLBACK_KEY);
            this._notify('all', 'loaded');
        } catch (e) {
            console.warn('[UsageManager] migration failed:', e);
        }
    }

    _mergeData(a, b) {
        const merged = DEFAULT_DATA();
        merged.createdAt = Math.min(a.createdAt || Date.now(), b.createdAt || Date.now());

        const mergeCounter = (x = {}, y = {}) => {
            const xT = x.lastTimestamp || 0, yT = y.lastTimestamp || 0;
            const newer = xT >= yT ? x : y;
            return {
                requests: (x.requests || 0) + (y.requests || 0),
                tokensIn: (x.tokensIn || 0) + (y.tokensIn || 0),
                tokensOut: (x.tokensOut || 0) + (y.tokensOut || 0),
                lastIn: newer.lastIn || 0,
                lastOut: newer.lastOut || 0,
                lastModel: newer.lastModel || null,
                lastTimestamp: Math.max(xT, yT) || null,
                lastEstimated: !!newer.lastEstimated
            };
        };

        const mergeByKey = (x = {}, y = {}) => {
            const merged = {};
            const ids = new Set([...Object.keys(x), ...Object.keys(y)]);
            ids.forEach(id => {
                const kx = x[id] || {}, ky = y[id] || {};
                merged[id] = {
                    name: kx.name || ky.name || 'Unknown',
                    requests: (kx.requests || 0) + (ky.requests || 0),
                    tokensIn: (kx.tokensIn || 0) + (ky.tokensIn || 0),
                    tokensOut: (kx.tokensOut || 0) + (ky.tokensOut || 0),
                    lastTimestamp: Math.max(kx.lastTimestamp || 0, ky.lastTimestamp || 0) || null
                };
            });
            return merged;
        };

        merged.global = mergeCounter(a.global, b.global);

        const modelKeys = new Set([...Object.keys(a.models || {}), ...Object.keys(b.models || {})]);
        modelKeys.forEach(k => {
            merged.models[k] = mergeCounter(a.models?.[k], b.models?.[k]);
            merged.models[k].byKey = mergeByKey(a.models?.[k]?.byKey, b.models?.[k]?.byKey);
        });

        const dayKeys = new Set([...Object.keys(a.daily || {}), ...Object.keys(b.daily || {})]);
        dayKeys.forEach(k => {
            const d1 = a.daily?.[k] || { requests: 0, tokensIn: 0, tokensOut: 0 };
            const d2 = b.daily?.[k] || { requests: 0, tokensIn: 0, tokensOut: 0 };
            merged.daily[k] = {
                requests: (d1.requests || 0) + (d2.requests || 0),
                tokensIn: (d1.tokensIn || 0) + (d2.tokensIn || 0),
                tokensOut: (d1.tokensOut || 0) + (d2.tokensOut || 0)
            };
        });

        return merged;
    }

    _pruneDaily() {
        const keys = Object.keys(this.data.daily).sort();
        if (keys.length > MAX_DAILY_ENTRIES) {
            keys.slice(0, keys.length - MAX_DAILY_ENTRIES).forEach(k => delete this.data.daily[k]);
        }
    }

    // ---------- Recording ----------

    /**
     * @param {string} modelType   e.g. 'gemini', 'claude', 'chatgpt'...
     * @param {number} tokensIn    input/prompt tokens for this single request
     * @param {number} tokensOut   output/completion tokens for this single request
     * @param {{estimated?: boolean}} opts  mark true when tokensIn/Out are character-based estimates, not provider-reported
     */
    recordUsage(modelType, tokensIn = 0, tokensOut = 0, opts = {}) {
        tokensIn = Math.max(0, Math.round(tokensIn || 0));
        tokensOut = Math.max(0, Math.round(tokensOut || 0));
        if (!modelType || (tokensIn === 0 && tokensOut === 0)) return;

        const now = Date.now();
        const key = this._dateKey(now);
        const estimated = !!opts.estimated;
        // 🟢 Multi API Key System: whichever key ApiKeyManager made active for this request.
        const keyId = this.app._activeApiKeyId || null;
        const keyName = this.app._activeApiKeyName || null;

        if (!this.loaded) {
            this.load().then(() => this._applyRecord(modelType, tokensIn, tokensOut, now, key, estimated, keyId, keyName));
            return;
        }
        this._applyRecord(modelType, tokensIn, tokensOut, now, key, estimated, keyId, keyName);
    }

    _applyRecord(modelType, tokensIn, tokensOut, now, key, estimated, keyId, keyName) {
        const g = this.data.global;
        g.requests += 1;
        g.tokensIn += tokensIn;
        g.tokensOut += tokensOut;
        g.lastIn = tokensIn;
        g.lastOut = tokensOut;
        g.lastModel = modelType;
        g.lastTimestamp = now;
        g.lastEstimated = estimated;

        if (!this.data.models[modelType]) {
            this.data.models[modelType] = { requests: 0, tokensIn: 0, tokensOut: 0, lastIn: 0, lastOut: 0, lastTimestamp: null, lastEstimated: false, byKey: {} };
        }
        const m = this.data.models[modelType];
        if (!m.byKey) m.byKey = {};
        m.requests += 1;
        m.tokensIn += tokensIn;
        m.tokensOut += tokensOut;
        m.lastIn = tokensIn;
        m.lastOut = tokensOut;
        m.lastTimestamp = now;
        m.lastEstimated = estimated;

        if (keyId) {
            if (!m.byKey[keyId]) m.byKey[keyId] = { name: keyName || 'Unknown', requests: 0, tokensIn: 0, tokensOut: 0, lastTimestamp: null };
            const bk = m.byKey[keyId];
            bk.requests += 1;
            bk.tokensIn += tokensIn;
            bk.tokensOut += tokensOut;
            bk.lastTimestamp = now;
            if (keyName) bk.name = keyName; // keep the label fresh if the key was renamed
        }

        if (!this.data.daily[key]) this.data.daily[key] = { requests: 0, tokensIn: 0, tokensOut: 0 };
        this.data.daily[key].requests += 1;
        this.data.daily[key].tokensIn += tokensIn;
        this.data.daily[key].tokensOut += tokensOut;

        this.save();
        this._notify(modelType, 'recorded');
    }

    // ---------- Reset ----------

    async reset(modelType = null) {
        if (!this.loaded) await this.load();

        if (modelType) {
            delete this.data.models[modelType];
            this._recomputeGlobalFromModels();
        } else {
            this.data = DEFAULT_DATA();
        }

        await this.save();
        this._notify(modelType || 'all', 'reset');
    }

    _recomputeGlobalFromModels() {
        const g = { requests: 0, tokensIn: 0, tokensOut: 0, lastIn: 0, lastOut: 0, lastModel: null, lastTimestamp: 0, lastEstimated: false };
        Object.entries(this.data.models).forEach(([type, m]) => {
            g.requests += m.requests;
            g.tokensIn += m.tokensIn;
            g.tokensOut += m.tokensOut;
            if ((m.lastTimestamp || 0) > (g.lastTimestamp || 0)) {
                g.lastTimestamp = m.lastTimestamp;
                g.lastIn = m.lastIn;
                g.lastOut = m.lastOut;
                g.lastModel = type;
                g.lastEstimated = m.lastEstimated;
            }
        });
        if (!g.lastTimestamp) g.lastTimestamp = null;
        this.data.global = g;
    }

    // ---------- Reading ----------

    getSnapshot(modelType, days = 14) {
        const g = this.data.global || {};
        const m = this.data.models[modelType] || { requests: 0, tokensIn: 0, tokensOut: 0, lastIn: 0, lastOut: 0, lastTimestamp: null, lastEstimated: false, byKey: {} };

        const dailyArr = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = this._dateKey(d.getTime());
            const entry = this.data.daily[key] || { requests: 0, tokensIn: 0, tokensOut: 0 };
            dailyArr.push({ date: key, requests: entry.requests, tokensIn: entry.tokensIn, tokensOut: entry.tokensOut, total: entry.tokensIn + entry.tokensOut });
        }

        return {
            model: { type: modelType, ...m, total: (m.tokensIn || 0) + (m.tokensOut || 0) },
            global: { ...g, total: (g.tokensIn || 0) + (g.tokensOut || 0) },
            daily: dailyArr,
            storageMode: this.app.pathUrl ? 'file' : 'local'
        };
    }

    /**
     * 🟢 Multi API Key System: per-key token breakdown for a model, merged against the
     * CURRENT (live) key pool. Any recorded key id that no longer exists in `livePool`
     * (i.e. the user removed that key) gets folded into a single "Others" bucket instead
     * of just vanishing, so historical usage is never silently lost.
     *
     * @param {string} modelType
     * @param {Array<{id:string,name:string}>} livePool  current pool from ApiKeyManager.getPool()
     * @returns {Array<{id,name,requests,tokensIn,tokensOut,total,lastTimestamp,removed}>} sorted by total desc
     */
    getKeyBreakdown(modelType, livePool = []) {
        const m = this.data.models[modelType] || null;
        const byKey = (m && m.byKey) ? m.byKey : {};

        const liveById = new Map((livePool || []).map(k => [k.id, k]));
        const seen = new Set();
        const rows = [];
        let others = null;

        // 1) Every LIVE key in the pool — even with 0 local tokens (so all 10 keys show)
        (livePool || []).forEach((live) => {
            if (!live?.id) return;
            seen.add(live.id);
            const stat = byKey[live.id] || {};
            const total = (stat.tokensIn || 0) + (stat.tokensOut || 0);
            rows.push({
                id: live.id,
                name: live.name || stat.name || 'Key',
                requests: stat.requests || 0,
                tokensIn: stat.tokensIn || 0,
                tokensOut: stat.tokensOut || 0,
                total,
                lastTimestamp: stat.lastTimestamp || null,
                removed: false,
                hasLocal: !!(stat.requests || total)
            });
        });

        // 2) Historical keys no longer in pool → Others bucket
        Object.entries(byKey).forEach(([id, stat]) => {
            if (seen.has(id)) return;
            const total = (stat.tokensIn || 0) + (stat.tokensOut || 0);
            if (total <= 0 && !stat.requests) return;
            if (!others) {
                others = {
                    id: OTHERS_BUCKET_ID,
                    name: 'Others (removed keys)',
                    requests: 0, tokensIn: 0, tokensOut: 0, total: 0,
                    lastTimestamp: null, removed: true, hasLocal: true
                };
            }
            others.requests += stat.requests || 0;
            others.tokensIn += stat.tokensIn || 0;
            others.tokensOut += stat.tokensOut || 0;
            others.total += total;
            others.lastTimestamp = Math.max(others.lastTimestamp || 0, stat.lastTimestamp || 0) || others.lastTimestamp;
        });

        if (others) rows.push(others);
        // Prefer keys with usage first, then by name
        return rows.sort((a, b) => (b.total - a.total) || String(a.name).localeCompare(String(b.name)));
    }

    _dateKey(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _notify(modelType, reason) {
        try {
            window.dispatchEvent(new CustomEvent('gpt-usage-updated', { detail: { modelType, reason } }));
        } catch (e) { /* no-op in non-browser context */ }
    }

    // ---------- Formatting helpers (used by the Usage tab UI) ----------

    static formatNumber(n) {
        n = Number(n) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    static timeAgo(ts) {
        if (!ts) return '—';
        const diff = Date.now() - ts;
        if (diff < 45000) return 'Just now';
        const mins = Math.round(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const daysAgo = Math.round(hrs / 24);
        if (daysAgo < 30) return `${daysAgo}d ago`;
        return new Date(ts).toLocaleDateString();
    }
}