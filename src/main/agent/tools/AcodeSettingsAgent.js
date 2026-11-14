// src/main/core/AcodeSettingsAgent.js
//
// 🟢 Gives Agent Mode control over Acode itself — settings, editor (CodeMirror)
// themes, app UI themes. Based on confirmed API from docs.acode.app (not guessed):
//   - Settings:      https://docs.acode.app/docs/editor-components/settings
//   - Editor Themes: https://docs.acode.app/docs/utilities/editor-themes
//   - App Themes:    https://docs.acode.app/docs/helpers/themes
//
// 🟢 IMPORTANT (confirmed against real Acode source, not just docs): app UI theme
// "apply" is currently a DEPRECATED NO-OP in Acode itself —
//   const themesModule = { add, get, list, update, apply: () => {} }
// So `themes.apply()` silently does nothing. Only EDITOR (syntax) themes actually
// apply visually, via editorThemes.apply(). There is deliberately no
// "apply_app_theme" tool here — adding one would let the model claim success on
// something that visibly does nothing. Tool descriptions below say this plainly
// so the model tells the user the truth instead of hallucinating success.
//
// 🟢 Key design choice: instead of a static "here are all valid values" reference
// file (which goes stale the moment Acode adds/removes a theme or setting), the
// tools below do LIVE DISCOVERY — list_acode_setting_constants, list_editor_themes,
// and list_app_themes read Acode's own live objects, so they can never be out of
// date, and work the same on any Acode version/install.

const TAG = '[AcodeSettingsAgent]';

function getSettings() { return acode.require('settings'); }
function getEditorThemes() { return acode.require('editorThemes'); }
function getAppThemes() { return acode.require('themes'); }

export class AcodeSettingsAgent {

    static getToolsSchema() {
        return [
            {
                name: "read_acode_settings",
                description: "Read Acode's current settings. Omit `key` to get ALL current settings at once (font size, theme, tab size, etc.) — do this first before changing anything, so you don't overwrite unrelated settings. Pass `key` to read just one value.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        key: { type: "STRING", description: "Optional: a single setting name, e.g. 'fontSize' or 'appTheme'. Omit to get everything." }
                    },
                    required: []
                }
            },
            {
                name: "list_acode_setting_constants",
                description: "List Acode's built-in enum-style constants (e.g. valid values for keyboardMode, previewMode, console, openFileListPos, quickToolsTriggerMode). ALWAYS call this before setting a value you're not 100% sure is valid — never guess a setting's valid options from memory.",
                parameters: { type: "OBJECT", properties: {} }
            },
            {
                name: "update_acode_settings",
                description: "Change one or more Acode settings at once. `changes` is a flat object of {settingName: newValue}. Only include the keys you actually want to change — everything else stays untouched. Common value formats: fontSize is a string like '16px' (not a number), tabSize is a number. NOTE: changing 'appTheme' here will save the value but will NOT visually change the app's UI theme — Acode's own theme-apply mechanism is currently a deprecated no-op in this version. Only editor (syntax highlighting) themes actually apply visually — use apply_editor_theme for that. If the user asks to change the overall app look/color scheme, tell them this isn't currently supported by Acode rather than claiming it worked.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        changes: { type: "OBJECT", description: "e.g. {\"fontSize\": \"20px\", \"tabSize\": 4}" }
                    },
                    required: ["changes"]
                }
            },
            {
                name: "reset_acode_setting",
                description: "Reset one setting back to its default value, or ALL settings if `key` is omitted (careful — that's a bigger change, confirm with the user first if they didn't explicitly ask to reset everything).",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        key: { type: "STRING", description: "Optional: the single setting to reset. Omit to reset everything." }
                    },
                    required: []
                }
            },
            {
                name: "list_editor_themes",
                description: "List all editor (syntax highlighting) themes currently registered in Acode, with their id, display name, and whether they're dark. Use this to find the correct theme id before calling apply_editor_theme — never guess a theme id (e.g. don't assume 'dracula' exists, check the list first). These are the ONLY themes that actually apply visually right now.",
                parameters: { type: "OBJECT", properties: {} }
            },
            {
                name: "apply_editor_theme",
                description: "Apply an editor (syntax highlighting) theme by its id. Get valid ids from list_editor_themes first. This is the one theme change that actually takes visual effect in the current Acode version.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        id: { type: "STRING", description: "Theme id, exactly as returned by list_editor_themes" }
                    },
                    required: ["id"]
                }
            },
            {
                name: "get_editor_theme_config",
                description: "Get the color/style details of a specific editor theme by id (useful if the user asks what a theme looks like, or wants a theme 'similar to X').",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        id: { type: "STRING", description: "Theme id, exactly as returned by list_editor_themes" }
                    },
                    required: ["id"]
                }
            },
            {
                name: "list_app_themes",
                description: "List the named app UI themes Acode knows about, with basic color info. Informational only — applying an app UI theme is currently a deprecated no-op in Acode (unlike editor themes), so there is no apply tool for these. Use this only to answer questions like 'what app themes exist', not to actually change the UI.",
                parameters: { type: "OBJECT", properties: {} }
            },
            {
                name: "get_app_theme",
                description: "Get the details (colors etc.) of one named app UI theme. Informational only — see list_app_themes for why there's no apply tool for this.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        name: { type: "STRING", description: "Theme name, e.g. 'Modern Dark'" }
                    },
                    required: ["name"]
                }
            }
        ];
    }

    static async executeTool(functionCall) {
        const { name, args = {} } = functionCall || {};
        console.log(TAG, 'executeTool ->', name, args);
        try {
            let result;
            switch (name) {
                case 'read_acode_settings':
                    result = this.readSettings(args.key); break;
                case 'list_acode_setting_constants':
                    result = this.listSettingConstants(); break;
                case 'update_acode_settings':
                    result = this.updateSettings(args.changes); break;
                case 'reset_acode_setting':
                    result = this.resetSetting(args.key); break;
                case 'list_editor_themes':
                    result = this.listEditorThemes(); break;
                case 'apply_editor_theme':
                    result = this.applyEditorTheme(args.id); break;
                case 'get_editor_theme_config':
                    result = this.getEditorThemeConfig(args.id); break;
                case 'list_app_themes':
                    result = this.listAppThemes(); break;
                case 'get_app_theme':
                    result = this.getAppTheme(args.name); break;
                default:
                    result = { error: `Unknown tool: ${name}` };
            }
            console.log(TAG, 'executeTool <-', name, result);
            return result;
        } catch (e) {
            console.error(TAG, 'executeTool threw for', name, '- raw error:', e);
            return { error: e.message || String(e) };
        }
    }

    static readSettings(key) {
        const settings = getSettings();
        if (!settings) return { error: 'settings module not available' };
        if (key) return { success: true, key, value: settings.get(key) };
        return { success: true, value: settings.value };
    }

    // 🟢 Live discovery — reads whatever UPPER_SNAKE_CASE constants Acode
    // currently exposes on the settings module, instead of a hardcoded list that
    // could go stale. (Confirmed present in a real settings.value dump: things
    // like KEYBOARD_MODE_NORMAL, PREVIEW_MODE_BROWSER, CONSOLE_LEGACY, etc.)
    static listSettingConstants() {
        const settings = getSettings();
        if (!settings) return { error: 'settings module not available' };
        const constants = {};
        for (const key in settings) {
            if (/^[A-Z][A-Z0-9_]*$/.test(key)) constants[key] = settings[key];
        }
        return { success: true, constants };
    }

    static updateSettings(changes) {
        const settings = getSettings();
        if (!settings) return { error: 'settings module not available' };
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
            return { error: "Missing or invalid 'changes' argument — expected a flat object." };
        }
        settings.update(changes, true);

        const result = { success: true, applied: changes };
        if ('appTheme' in changes) {
            result.warning = "appTheme was saved but will NOT visually change the app UI — Acode's app-theme apply is currently a deprecated no-op. Only editor themes (apply_editor_theme) actually apply visually.";
        }
        return result;
    }

    static resetSetting(key) {
        const settings = getSettings();
        if (!settings) return { error: 'settings module not available' };
        settings.reset(key);
        return { success: true, reset: key || 'ALL_SETTINGS' };
    }

    static listEditorThemes() {
        const editorThemes = getEditorThemes();
        if (!editorThemes) return { error: 'editorThemes module not available' };
        const list = (editorThemes.list() || []).map(t => ({ id: t.id, caption: t.caption, dark: !!t.dark }));
        return { success: true, themes: list };
    }

    static applyEditorTheme(id) {
        const editorThemes = getEditorThemes();
        if (!editorThemes) return { error: 'editorThemes module not available' };
        if (!id) return { error: "Missing 'id' argument." };
        editorThemes.apply(id);
        return { success: true, applied: id };
    }

    static getEditorThemeConfig(id) {
        const editorThemes = getEditorThemes();
        if (!editorThemes) return { error: 'editorThemes module not available' };
        if (!id) return { error: "Missing 'id' argument." };
        const config = editorThemes.getConfig ? editorThemes.getConfig(id) : null;
        return { success: true, id, config: config || null };
    }

    // ThemeBuilder instances carry methods/prototype data that don't serialize
    // cleanly — pull out just the plain color/label fields a model would find useful.
    static _extractThemeFields(theme) {
        const plain = {};
        ['name', 'type', 'primaryColor', 'secondaryColor', 'textColor', 'backgroundColor',
         'popupBorderRadius', 'activeColor'].forEach(k => {
            if (theme[k] !== undefined) plain[k] = theme[k];
        });
        return plain;
    }

    static listAppThemes() {
        const themes = getAppThemes();
        if (!themes) return { error: 'themes module not available' };
        if (typeof themes.list !== 'function') return { error: 'themes.list() not available in this Acode version.' };
        const list = (themes.list() || []).map(t => this._extractThemeFields(t));
        return { success: true, themes: list, note: 'Informational only — applying an app UI theme is currently a no-op in Acode.' };
    }

    static getAppTheme(name) {
        const themes = getAppThemes();
        if (!themes) return { error: 'themes module not available' };
        if (!name) return { error: "Missing 'name' argument." };
        const theme = themes.get(name);
        if (!theme) return { error: `No app theme named "${name}" found.` };
        return { success: true, theme: this._extractThemeFields(theme) };
    }
}