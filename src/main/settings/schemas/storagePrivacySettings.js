// src/main/settings/schemas/storagePrivacySettings.js
import { HistoryFileOps } from '../../history/HistoryFileOps.js';
import { ConfigManager } from '../../utils/ConfigManager.js'; 

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getDirSize = async (url) => {
    let size = 0;
    try {
        const fs = acode.require('fs');
        if (!(await fs(url).exists())) return 0;
        const ls = await fs(url).lsDir();
        for (const f of ls) {
            if (f.isFile) {
                const stat = await fs(f.url).stat();
                size += stat.length || stat.size || 0;
            } else {
                size += await getDirSize(f.url);
            }
        }
    } catch(e) {}
    return size;
};

const executeClear = async (app, filterFn, confirmMsg) => {
    const DialogBox = window.acode ? acode.require('dialogBox') : null;
    
    const toDelete = app.conversations.filter(filterFn);
    if (toDelete.length === 0) {
        window.toast('No chats found for this criteria.', 2000);
        return;
    }

    const isConfirmed = DialogBox ? 
        await DialogBox('Confirm Delete', `Are you sure you want to permanently delete ${toDelete.length} chats? ${confirmMsg}`, 'Delete') : 
        confirm(`Delete ${toDelete.length} chats?`);
        
    if (!isConfirmed) return;

    for (let conv of toDelete) {
        await HistoryFileOps.deleteChatFiles(app, conv);
    }

    app.conversations = app.conversations.filter(c => !toDelete.includes(c));
    
    if (app.conversations.length === 0) {
        await app.chatHistoryManager.startNewConversation();
    } else {
        await app.chatHistoryManager.loadConversation(0);
    }
    app.chatHistoryManager.renderChatHistory();
    window.toast(`Successfully deleted ${toDelete.length} chats`, 2000);
};

export const storagePrivacySettingsSchema = [
    { type: 'header', label: 'Data Location' },
    {
        type: 'action',
        label: 'Set Local Path',
        description: 'Select a local folder to save chats and images.',
        buttonText: 'Select Folder',
        onInit: (btn, app) => {
            if (app.pathUrl) {
                btn.textContent = 'Change Folder';
                // 🟢 PRO FIX: Using closest() is much safer than parentElement.parentElement
                const row = btn.closest('.sce-row');
                if (row) {
                    const descEl = row.querySelector('.sce-row-desc');
                    if (descEl) descEl.innerHTML = `Current: <b>${app.storageManager ? app.storageManager.contentToFile(app.pathUrl) : app.pathUrl}</b>`;
                }
            }
        },
        onClick: async (app, btn) => {
            if (app.storageManager) {
                const newPath = await app.storageManager.setPath();
                if (newPath) {
                    btn.textContent = 'Change Folder';
                    const row = btn.closest('.sce-row');
                    if (row) {
                        const descEl = row.querySelector('.sce-row-desc');
                        if (descEl) descEl.innerHTML = `Current: <b>${app.storageManager.contentToFile(newPath)}</b>`;
                    }
                }
            }
        }
    },
    {
        type: 'action',
        label: 'Remove Local Path',
        description: 'Revert to temporary/plugin storage. (Does not delete files).',
        buttonText: 'Remove Path',
        danger: true,
        onClick: async (app, btn) => {
            ConfigManager.remove("selectedPath");
            app.pathUrl = null;
            app.continueWOpath = 'true';
            
            const row = btn.closest('.sce-row');
            if (row) {
                const descEl = row.querySelector('.sce-row-desc');
                if (descEl) descEl.innerHTML = 'Select a local folder to save chats and images.';
            }
            
            window.toast('Successfully removed! Restart app to continue as temporary conversation', 3000);
            if (app.chatHistoryManager) {
                await app.chatHistoryManager.loadConversation(0, false);
                await app.chatHistoryManager.renderChatHistory();
            }
        }
    },

    { type: 'header', label: 'Privacy & Security' },
    {
        type: 'toggle',
        key: 'enableEncryption',
        label: 'Save Chat as Encrypted',
        description: 'Applies AES encryption to chat JSON files on disk.',
        default: true,
        bind: 'enableEncryption'
    },
    
    { type: 'header', label: 'Clear Chat History' },
    {
        type: 'action',
        label: 'Clear Today\'s Chat',
        buttonText: 'Clear',
        danger: true,
        onClick: async (app) => {
            const today = new Date().setHours(0,0,0,0);
            await executeClear(app, c => c.lastUpdated >= today, 'This deletes today\'s history.');
        }
    },
    {
        type: 'action',
        label: 'Clear Last 7 Days',
        buttonText: 'Clear',
        danger: true,
        onClick: async (app) => {
            const sevenDaysAgo = new Date().setHours(0,0,0,0) - (7 * 24 * 60 * 60 * 1000);
            await executeClear(app, c => c.lastUpdated >= sevenDaysAgo, 'This deletes the last 7 days of history.');
        }
    },
    {
        type: 'action',
        label: 'Clear This Month',
        buttonText: 'Clear',
        danger: true,
        onClick: async (app) => {
            const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
            await executeClear(app, c => c.lastUpdated >= startOfMonth, 'This deletes all chats from this month.');
        }
    },
    {
        type: 'action',
        label: 'Clear Previous Month',
        buttonText: 'Clear',
        danger: true,
        onClick: async (app) => {
            const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
            const startOfPrevMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime();
            await executeClear(app, c => (c.lastUpdated >= startOfPrevMonth && c.lastUpdated < startOfMonth), 'This deletes all chats from the previous month.');
        }
    },
    {
        type: 'action',
        label: 'Custom Clear Range',
        description: 'Delete chats older than X days.',
        buttonText: 'Choose',
        danger: true,
        onClick: async (app) => {
            const daysStr = prompt("Delete chats older than how many days?", "30");
            if (!daysStr) return;
            const days = parseInt(daysStr, 10);
            if (isNaN(days) || days < 0) return window.toast("Invalid number of days");
            
            const threshold = new Date().setHours(0,0,0,0) - (days * 24 * 60 * 60 * 1000);
            await executeClear(app, c => c.lastUpdated < threshold, `This deletes all chats older than ${days} days.`);
        }
    },
    {
        type: 'action',
        label: 'Clear All Chats',
        buttonText: 'Delete All',
        danger: true,
        onClick: async (app) => {
            await executeClear(app, c => true, 'This will wipe out everything permanently!');
        }
    },

    { type: 'header', label: 'Cache & System Storage' },
    {
        type: 'action',
        label: 'Clear Preview Canvas Storage',
        description: 'Removes cached Smart Workspace files generated for HTML/Canvas previews.',
        buttonText: 'Calculating...',
        onInit: async (btn, app) => {
            let storageRoot = window.ACODE_FILE_STORAGE || window.CACHE_STORAGE || '';
            if (storageRoot && !storageRoot.startsWith('file://')) storageRoot = `file://${storageRoot}`;
            const workspaceUrl = `${storageRoot}/preview_workspace`;
            const size = await getDirSize(workspaceUrl);
            btn.textContent = `Clear (${formatBytes(size)})`;
        },
        onClick: async (app, btn) => {
            let storageRoot = window.ACODE_FILE_STORAGE || window.CACHE_STORAGE || '';
            if (storageRoot && !storageRoot.startsWith('file://')) storageRoot = `file://${storageRoot}`;
            const workspaceUrl = `${storageRoot}/preview_workspace`;
            const fs = acode.require('fs');
            
            if (await fs(workspaceUrl).exists()) {
                await fs(workspaceUrl).delete();
            }
            window.toast("Canvas Cache Cleared!", 2000);
            btn.textContent = `Clear (0 B)`;
        }
    },

    
    { type: 'header', label: 'Undo history' },
    {
        type: 'range',
        key: 'undoMaxBatches',
        label: 'Max responses to remember',
        description: 'How many agent responses with file changes stay undoable per chat (1–50).',
        min: 1,
        max: 50,
        step: 1,
        default: 20
    },
    {
        type: 'range',
        key: 'undoMaxStorageMb',
        label: 'Max undo storage (MB)',
        description: 'When total undo snapshots exceed this, the oldest batches are dropped automatically.',
        min: 5,
        max: 100,
        step: 5,
        default: 25
    },
    {
        type: 'action',
        label: 'Undo history by chat',
        description: 'See which chats still have file undo data. Clear one chat or everything.',
        buttonText: 'Manage',
        onClick: async (app) => {
            try {
                const { FileChangeHistory } = await import('../../utils/agent/FileChangeHistory.js');
                FileChangeHistory.hydrate(app);
                const rows = FileChangeHistory.listAllChats(app);
                const total = FileChangeHistory.totalStorageBytes(app);
                const fmt = (n) => {
                    if (n < 1024) return n + ' B';
                    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
                    return (n / (1024 * 1024)).toFixed(1) + ' MB';
                };
                const clockSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
                const fileSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                const trashSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

                const host = document.createElement('div');
                host.style.cssText = 'max-height:60vh;overflow:auto;padding:4px;color:var(--primary-text-color);';
                host.innerHTML = `<div style="font-size:12px;opacity:0.7;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                  ${fileSvg}<span>Stored undo data: <b>${fmt(total)}</b>${rows.length ? ` · ${rows.length} chat(s)` : ''}</span>
                </div>`;

                if (!rows.length) {
                    host.innerHTML += `<div style="font-size:12px;opacity:0.55;padding:12px 4px;">No undo history yet. Agent file edits will appear here.</div>`;
                } else {
                    for (const row of rows) {
                        const t = row.lastAt ? new Date(row.lastAt).toLocaleString() : '—';
                        const samples = (row.sampleOps || []).slice(0, 5).join(', ') || 'file changes';
                        const card = document.createElement('div');
                        card.style.cssText = 'border:1px solid var(--border-color,#333);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--secondary-color,rgba(0,0,0,0.15));';
                        card.innerHTML = `
                          <div style="display:flex;align-items:flex-start;gap:8px;">
                            <div style="flex:1;min-width:0;">
                              <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(row.title || '').replace(/</g,'&lt;')}</div>
                              <div style="font-size:11px;opacity:0.6;margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <span style="display:inline-flex;align-items:center;gap:4px;">${clockSvg}${t}</span>
                                <span>${row.undoBatches} undo · ${row.opCount} ops · ${fmt(row.bytes)}</span>
                              </div>
                              <div style="font-size:11px;opacity:0.5;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(samples).replace(/</g,'&lt;')}</div>
                            </div>
                            <button type="button" data-clear-idx="${row.chatIndex}" title="Clear this chat undo"
                              style="border:1px solid var(--border-color,#555);background:transparent;color:inherit;border-radius:8px;padding:6px 8px;cursor:pointer;display:inline-flex;align-items:center;">
                              ${trashSvg}
                            </button>
                          </div>`;
                        host.appendChild(card);
                    }
                }

                const footer = document.createElement('div');
                footer.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';
                footer.innerHTML = `
                  <button type="button" data-clear-all style="padding:8px 12px;border-radius:8px;border:1px solid rgba(244,67,54,0.5);background:rgba(244,67,54,0.12);color:inherit;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:6px;">
                    ${trashSvg} Clear all undo history
                  </button>`;
                host.appendChild(footer);

                const DialogBox = window.acode ? acode.require('dialogBox') : null;
                if (DialogBox) {
                    // Prefer select / prompt style if available — fall back to overlay
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:16px;';
                    const panel = document.createElement('div');
                    panel.style.cssText = 'width:min(420px,100%);max-height:80vh;overflow:auto;background:var(--secondary-color,#1e1e2e);border:1px solid var(--border-color,#333);border-radius:12px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,0.4);';
                    panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                      <div style="font-weight:600;font-size:14px;">Undo history</div>
                      <button type="button" data-close style="border:none;background:transparent;color:inherit;font-size:18px;cursor:pointer;line-height:1;">×</button>
                    </div>`;
                    panel.appendChild(host);
                    overlay.appendChild(panel);
                    document.body.appendChild(overlay);
                    const close = () => overlay.remove();
                    panel.querySelector('[data-close]')?.addEventListener('click', close);
                    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
                    host.querySelectorAll('[data-clear-idx]').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const idx = btn.getAttribute('data-clear-idx');
                            const ok = DialogBox
                              ? await DialogBox('Clear undo', 'Remove undo history for this chat only?', 'Clear')
                              : confirm('Clear undo for this chat?');
                            if (!ok) return;
                            FileChangeHistory.clearChat(app, idx);
                            window.toast?.('Chat undo history cleared', 2000);
                            close();
                        });
                    });
                    host.querySelector('[data-clear-all]')?.addEventListener('click', async () => {
                        const ok = DialogBox
                          ? await DialogBox('Clear all', 'Delete undo history for every chat? This cannot be undone.', 'Clear all')
                          : confirm('Clear ALL undo history?');
                        if (!ok) return;
                        FileChangeHistory.clearAll(app);
                        window.toast?.('All undo history cleared', 2000);
                        close();
                    });
                } else {
                    // Minimal fallback
                    const lines = rows.map(r => `${r.title}: ${r.undoBatches} undo, ${fmt(r.bytes)}`).join('\n') || 'None';
                    alert('Undo history\n' + lines + `\nTotal: ${fmt(total)}`);
                }
            } catch (e) {
                console.error(e);
                window.toast?.(e.message || 'Could not open undo history', 2500);
            }
        }
    },

    { type: 'header', label: 'Danger Zone' },
    {
        type: 'action',
        label: 'Delete ALL Saved Data',
        description: 'Permanently deletes all app data, conversations, and images from the device.',
        buttonText: 'Delete Data',
        danger: true,
        onClick: async (app) => {
            const DialogBox = window.acode ? acode.require('dialogBox') : null;
            const isConfirmed = DialogBox ? 
                await DialogBox('Warning', 'Are you sure you want to completely wipe all Aicode Cosmo data? This cannot be undone.', 'Wipe Data') : 
                confirm('Are you sure you want to completely wipe all Aicode Cosmo data? This cannot be undone.');
            
            if (!isConfirmed) return;

            ConfigManager.set('current_chat_index', '0');
            if (window.fs && window.PLUGIN_DIR && app.plugin) {
                const existImagesDir = await window.fs(`${window.PLUGIN_DIR}/${app.plugin.id}/images`).exists();
                if (existImagesDir) await window.fs(`${window.PLUGIN_DIR}/${app.plugin.id}/images`).delete();
            }
          
            if (window.fs && app.pathUrl) {
                const existConvDir = await window.fs(`${app.pathUrl}/conversations`).exists();
                if (existConvDir) await window.fs(`${app.pathUrl}/conversations`).delete(); 
                
                const passageFile = await window.fs(`${app.pathUrl}/.passage.json`).exists();
                if (passageFile) await window.fs(`${app.pathUrl}/.passage.json`).delete();
            }  
          
            window.toast('All data deleted. Restart app to apply changes', 3000);
        }
    }
];