// src/main/core/agent/AcodeWorkspaceAgent.js
//
// 🟢 Gives Agent Mode control over which folders are open in Acode's sidebar,
// via the confirmed `acode.require('openFolder')` API:
// https://docs.acode.app/docs/utilities/open-folder
//
// Separate file from AcodeSettingsAgent.js on purpose (different concern:
// workspace/sidebar folders vs. app settings/themes) — same pattern used for
// AcodeFSAgent (project file contents) vs AcodeTerminalAgent (shell).
//
// NOTE the distinction from AcodeFSAgent.js: that module reads/writes file
// *content* inside whatever project is already open. This module controls
// *which folders are open in the sidebar at all* (adding/removing/reloading
// workspace folders), plus a few sidebar-tree-specific item operations
// (add/rename/remove as they appear in the sidebar UI, not full fs operations).

import { ConfigManager } from '../../utils/ConfigManager.js';
import { ProjectWorkspace, pathUnderWorkspace } from '../../utils/ProjectWorkspace.js';

const TAG = '[AcodeWorkspaceAgent]';

function getOpenFolder() { return acode.require('openFolder'); }

export class AcodeWorkspaceAgent {

    static getToolsSchema() {
        return [
            {
                name: "list_open_project_folders",
                description: "FIRST tool to call in Agent Mode. Lists every folder currently open in Acode's sidebar (real user projects). Returns name + url for each. If empty, tell the user to open a project folder in the sidebar before creating files. NEVER invent paths like Android/data/com.foxdebug.acode — those are app private, not projects.",
                parameters: {
                    type: "OBJECT",
                    properties: {},
                    required: []
                }
            },
            {
                name: "open_project_folder",
                description: "Open a folder in Acode's sidebar as a workspace folder. Use only a path the user gave or one from list_open_project_folders — never invent Android/data/com.foxdebug.acode or app-private paths.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "Full path/URI of the folder to open" },
                        name: { type: "STRING", description: "Optional display name in the sidebar (defaults to the folder's real name)" },
                        saveState: { type: "BOOLEAN", description: "Whether to remember this folder across app restarts. Default true." },
                        reloadOnResume: { type: "BOOLEAN", description: "Whether to refresh this folder's contents when the app resumes. Default true." }
                    },
                    required: ["path"]
                }
            },
            {
                name: "close_project_folder",
                description: "Remove/close a folder from Acode's sidebar (does NOT delete any files — only closes it from the workspace view).",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "Full path/URI of the folder to close, exactly as it was opened" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "reload_project_folder",
                description: "Refresh a sidebar folder's file listing (e.g. after files were changed outside Acode's own tools and the sidebar looks stale).",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "Full path/URI of the folder to reload" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "find_project_folder",
                description: "Check whether a given path is inside a currently-open sidebar folder, and get that folder's basic info. Useful before close/reload_project_folder, or to check if you need to open_project_folder first.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "Full path/URI to look up" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "add_sidebar_item",
                description: "Add an existing file or folder into the sidebar tree view. Note: this is about sidebar DISPLAY — to actually create a new file/folder on disk, use create_or_update_file / create_folder instead, then this if it doesn't show up automatically.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "Full path/URI of the file or folder" },
                        type: { type: "STRING", description: "'file' or 'folder'" }
                    },
                    required: ["path", "type"]
                }
            },
            {
                name: "rename_sidebar_item",
                description: "Rename a file/folder as shown in the sidebar tree. For actually renaming the underlying file, prefer rename_item (the file tool) — this is specifically for fixing sidebar display if it gets out of sync.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        oldPath: { type: "STRING", description: "Current full path/URI" },
                        newPath: { type: "STRING", description: "New full path/URI" },
                        newName: { type: "STRING", description: "New display name" }
                    },
                    required: ["oldPath", "newPath", "newName"]
                }
            },
            {
                name: "remove_sidebar_item",
                description: "Remove a single file/folder entry from the sidebar tree view (display only, does not delete the real file — use delete_item for that).",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        path: { type: "STRING", description: "Full path/URI of the item to remove from the sidebar" }
                    },
                    required: ["path"]
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
                case 'list_open_project_folders':
                    result = this.listOpenProjectFolders(); break;
                case 'open_project_folder':
                    result = this.openProjectFolder(args); break;
                case 'close_project_folder':
                    result = this.closeProjectFolder(args.path); break;
                case 'reload_project_folder':
                    result = this.reloadProjectFolder(args.path); break;
                case 'find_project_folder':
                    result = this.findProjectFolder(args.path); break;
                case 'add_sidebar_item':
                    result = this.addSidebarItem(args.path, args.type); break;
                case 'rename_sidebar_item':
                    result = this.renameSidebarItem(args.oldPath, args.newPath, args.newName); break;
                case 'remove_sidebar_item':
                    result = this.removeSidebarItem(args.path); break;
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

    // Opened-folder objects can carry non-serializable internals — pull out
    // just what's useful to the model.
    static _extractFolderInfo(folder) {
        if (!folder) return null;
        const plain = {};
        ['id', 'name', 'title', 'url', 'reloadOnResume', 'saveState'].forEach(k => {
            if (folder[k] !== undefined) plain[k] = folder[k];
        });
        return plain;
    }

    static _isAppDataUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const s = url.toLowerCase();
        return s.includes('com.foxdebug.acode') ||
            s.includes('android%2fdata%2fcom.foxdebug') ||
            s.includes('android/data/com.foxdebug');
    }

    /**
     * List folders currently open in the Acode sidebar (window.addedFolder).
     * Filters out Acode app-private Android/data paths.
     */
    static listOpenProjectFolders() {
        try {
            const added = (typeof window !== 'undefined' && window.addedFolder) ||
                (typeof addedFolder !== 'undefined' ? addedFolder : null);

            // NOTE: `message` is for the MODEL only (tool response JSON). UI must not render it.
            // Use `_uiSilent: true` so AgentRunner skips putting these in chat previews.
            if (!Array.isArray(added)) {
                return {
                    success: true,
                    count: 0,
                    folders: [],
                    _uiSilent: true,
                    message: 'No workspace API (addedFolder). Ask the user to open a project folder in the Acode sidebar.'
                };
            }

            let folders = [];
            for (const folder of added) {
                const info = this._extractFolderInfo(folder) || {};
                const url = info.url || folder?.url || '';
                if (!url || this._isAppDataUrl(url)) continue;
                folders.push({
                    name: info.title || info.name || url.split('/').filter(Boolean).pop() || 'folder',
                    url,
                    id: info.id,
                    saveState: info.saveState,
                    reloadOnResume: info.reloadOnResume
                });
            }

            // Per-chat workspace lock: if user selected project(s), only those roots
            try {
                const chatId = ConfigManager.get('current_chat_index', 'default') ?? 'default';
                const locked = ProjectWorkspace.list(chatId);
                if (locked.length) {
                    const filtered = folders.filter(f =>
                        locked.some(w => pathUnderWorkspace(f.url, w.url) || pathUnderWorkspace(w.url, f.url) ||
                            (f.name && w.name && String(f.name).toLowerCase() === String(w.name).toLowerCase()))
                    );
                    // Always include locked workspaces even if not in sidebar yet
                    const byUrl = new Set(filtered.map(f => f.url));
                    for (const w of locked) {
                        if (![...byUrl].some(u => pathUnderWorkspace(u, w.url) || pathUnderWorkspace(w.url, u))) {
                            filtered.push({ name: w.name, url: w.url, id: w.id });
                            byUrl.add(w.url);
                        }
                    }
                    folders = filtered;
                    return {
                        success: true,
                        count: folders.length,
                        folders,
                        _uiSilent: true,
                        message: `WORKSPACE LOCKED for this chat. ONLY use these folder url(s):\n${folders.map(f => `- ${f.name}: ${f.url}`).join('\n')}\nDo NOT find /storage/emulated/0 or other roots. Use list_directory / read_file / create_or_update_file on these urls only.`
                    };
                }
            } catch (e) {
                console.warn(TAG, 'workspace filter', e);
            }

            if (folders.length === 0) {
                return {
                    success: true,
                    count: 0,
                    folders: [],
                    _uiSilent: true,
                    message: 'No user project folder is open in the sidebar. Tell the user: open a folder on /sdcard (or storage) via Acode file browser first. Do NOT create files under Android/data/com.foxdebug.acode.'
                };
            }

            return {
                success: true,
                count: folders.length,
                folders,
                _uiSilent: true,
                // Model-only hint — never shown in chat UI
                message: `COPY the exact "url" field below for list_directory / create tools. Example form: content://.../tree/primary%3AAy::primary:Ay (document id AFTER ::, not ::/Ay). Child folder = that url + "/snake_game". Prefer the first folder unless user named another.`
            };
        } catch (e) {
            console.error(TAG, 'listOpenProjectFolders failed:', e);
            return { success: false, error: e.message || String(e), folders: [] };
        }
    }

    static openProjectFolder({ path, name, saveState, reloadOnResume } = {}) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!path) return { error: "Missing 'path' argument." };

        const opts = {};
        if (name !== undefined) opts.name = name;
        if (saveState !== undefined) opts.saveState = saveState;
        if (reloadOnResume !== undefined) opts.reloadOnResume = reloadOnResume;

        const folder = openFolder(path, opts);
        return { success: true, folder: this._extractFolderInfo(folder) || { path } };
    }

    static closeProjectFolder(path) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!path) return { error: "Missing 'path' argument." };

        const folder = openFolder.find ? openFolder.find(path) : null;
        if (!folder) return { error: `No open sidebar folder found for: ${path}` };
        if (typeof folder.remove !== 'function') return { error: 'Found the folder but it has no remove() method.' };
        folder.remove();
        return { success: true, closed: path };
    }

    static reloadProjectFolder(path) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!path) return { error: "Missing 'path' argument." };

        const folder = openFolder.find ? openFolder.find(path) : null;
        if (!folder) return { error: `No open sidebar folder found for: ${path}` };
        if (typeof folder.reload !== 'function') return { error: 'Found the folder but it has no reload() method.' };
        folder.reload();
        return { success: true, reloaded: path };
    }

    static findProjectFolder(path) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!path) return { error: "Missing 'path' argument." };
        if (typeof openFolder.find !== 'function') return { error: 'openFolder.find() not available in this Acode version.' };

        const folder = openFolder.find(path);
        if (!folder) return { success: true, found: false };
        return { success: true, found: true, folder: this._extractFolderInfo(folder) };
    }

    static addSidebarItem(path, type) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!path) return { error: "Missing 'path' argument." };
        if (type !== 'file' && type !== 'folder') return { error: "'type' must be 'file' or 'folder'." };
        if (typeof openFolder.add !== 'function') return { error: 'openFolder.add() not available in this Acode version.' };

        openFolder.add(path, type);
        return { success: true, added: path, type };
    }

    static renameSidebarItem(oldPath, newPath, newName) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!oldPath || !newPath || !newName) return { error: "Missing 'oldPath', 'newPath', or 'newName' argument." };
        if (typeof openFolder.renameItem !== 'function') return { error: 'openFolder.renameItem() not available in this Acode version.' };

        openFolder.renameItem(oldPath, newPath, newName);
        return { success: true, oldPath, newPath, newName };
    }

    static removeSidebarItem(path) {
        const openFolder = getOpenFolder();
        if (!openFolder) return { error: 'openFolder module not available' };
        if (!path) return { error: "Missing 'path' argument." };
        if (typeof openFolder.removeItem !== 'function') return { error: 'openFolder.removeItem() not available in this Acode version.' };

        openFolder.removeItem(path);
        return { success: true, removed: path };
    }
}