// src/main/settings/SettingsStore.js
import { ConfigManager } from '../utils/ConfigManager.js';

/**
 * Thin, TYPE-AWARE wrapper around ConfigManager.
 *
 * ConfigManager already gives you get/set/remove — this layer adds the part
 * that was missing: knowing what TYPE each setting is, so a toggle always
 * comes back as a real boolean, a range always comes back as a real number,
 * etc, no matter how it was stored.
 *
 *   store.get('systemPrompt', '')
 *   store.getBool('isEnableWebBrowsing', false)
 *   store.getNumber('historyTokenBudget', 12000)
 *   store.set('systemPrompt', 'You are...')
 *   store.setBool('isEnableWebBrowsing', true)
 *
 * It also understands *settings schema fields* directly (the objects you
 * write in a `*Settings.js` schema file), via `.read(field)` / `.write(field, value)` —
 * that's what SettingsRenderer uses, so the renderer never has to know how a
 * value is actually stored.
 */
export class SettingsStore {
    constructor(pluginContext) {
        this.app = pluginContext;
    }

    // ---- raw, type-generic access -------------------------------------

    get(key, defaultValue = null) {
        const raw = ConfigManager.get(key);
        return (raw === null || raw === undefined || raw === 'null') ? defaultValue : raw;
    }

    set(key, value) {
        ConfigManager.set(key, value);
        return value;
    }

    remove(key) {
        ConfigManager.remove(key);
    }

    // ---- typed access ---------------------------------------------------

    getBool(key, defaultValue = false) {
        const raw = this.get(key, defaultValue);
        if (typeof raw === 'boolean') return raw;
        return raw === true || raw === 'true';
    }

    /**
     * @param legacyString store as the string 'true'/'false' instead of a real
     *        boolean. Use this for settings that older, non-schema code already
     *        reads with a strict `=== 'false'` string check (e.g. continueWOpath),
     *        so this engine doesn't silently break that code elsewhere.
     */
    setBool(key, value, legacyString = false) {
        const stored = legacyString ? (value ? 'true' : 'false') : !!value;
        ConfigManager.set(key, stored);
        return stored;
    }

    getNumber(key, defaultValue = 0) {
        const raw = this.get(key, defaultValue);
        const num = parseFloat(raw);
        return Number.isNaN(num) ? defaultValue : num;
    }

    setNumber(key, value) {
        const num = parseFloat(value);
        ConfigManager.set(key, Number.isNaN(num) ? 0 : num);
        return num;
    }

    // ---- schema-field-aware access (used by SettingsRenderer) ----------

    /** Read a field's current value using the right getter for its `type`. */
    read(field) {
        if (!field || !field.key) return undefined;
        switch (field.type) {
            case 'toggle':
                return this.getBool(field.key, field.default);
            case 'range':
                return this.getNumber(field.key, field.default);
            default:
                return this.get(field.key, field.default);
        }
    }

    /** Persist a field's value, sync `app[field.bind]` if declared, fire `field.onChange`. */
    write(field, value) {
        if (!field || !field.key) return;

        if (field.type === 'toggle') {
            value = this.setBool(field.key, value, !!field.legacyString);
        } else if (field.type === 'range') {
            value = this.setNumber(field.key, value);
        } else {
            value = this.set(field.key, value);
        }

        if (field.bind) this.app[field.bind] = value;
        if (typeof field.onChange === 'function') field.onChange(value, this.app);

        return value;
    }

    /** Apply one field's persisted value onto `app[field.bind]` (startup hydration). */
    hydrate(field) {
        if (!field || !field.bind) return;
        this.app[field.bind] = this.read(field);
    }
}

/**
 * Walk a whole schema (including nested `page` children) and hydrate every
 * field that declares a `bind`. Call this once at plugin startup so
 * previously-hardcoded state flags become settings-driven with one line —
 * add a new bound field to the schema later and it hydrates automatically,
 * no other code needs to change.
 */
export function hydrateSchema(store, schema) {
    (schema || []).forEach((field) => {
        if (field.bind) store.hydrate(field);
        if (field.type === 'page' && Array.isArray(field.children)) {
            hydrateSchema(store, field.children);
        }
    });
}