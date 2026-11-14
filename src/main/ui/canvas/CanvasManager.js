// src/main/ui/canvas/CanvasManager.js
//
//  Level-up pass. What's new vs. before:
//  - Image files (png/jpg/jpeg/gif/webp/bmp/ico) now render as an actual <img>
//    instead of being force-read as UTF-8 text into the code viewer (which would
//    have shown corrupted binary garbage — real latent bug, now fixed).
//  - SVG files render VISUALLY (the actual graphic) instead of as XML source text.
//  - Mermaid diagrams: standalone .mmd/.mermaid files, AND ```mermaid fences
//    inside any markdown preview, now render as real diagrams — this is the
//    single most-requested "modern AI canvas" feature (flowcharts, sequence
//    diagrams, mind maps) and was the biggest gap vs. Claude/ChatGPT canvases.
//  - Download button in the header (file-backed previews only — nothing to
//    download for ephemeral inline content).
//
// Untouched: prepareSmartWorkspace() (the dependency-copying logic for HTML
// previews) and the overall open()/close()/bindTriggers() contract — nothing
// calling into CanvasManager needs to change.

import { ConfigManager } from '../../utils/ConfigManager.js';
import { CodeEditorViewer } from '../CodeEditor.js';
import { CanvasConsoleUI, injectConsoleBridge } from './CanvasConsole.js';
import { CanvasBundler } from '../../core/canvas/CanvasBundler.js';

const SETTING_KEY = 'canvasPreviewEnabled';

const refreshIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`;
const closeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const undoIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.9L3 13"/></svg>`;


const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];
const MARKDOWN_EXTS = ['md', 'markdown'];
const MERMAID_EXTS = ['mmd', 'mermaid'];

export class CanvasManager {
    constructor(pluginContext) {
        this.app = pluginContext;
        this.containerId = 'gpt-dedicated-canvas-container';
        this.panelEl = null;
        this.isOpen = false;
        this._lastOpen = null;
        this.consoleUI = new CanvasConsoleUI(this);
    }

    isEnabled() {
        const v = ConfigManager.get(SETTING_KEY);
        return v !== 'false';
    }

    setEnabled(value) {
        ConfigManager.set(SETTING_KEY, value ? 'true' : 'false');
    }

    _buildPanelShell() {
        this.panelEl = document.getElementById(this.containerId);
        if (!this.panelEl) {
            this.panelEl = document.createElement('div');
            this.panelEl.id = this.containerId;
            document.body.appendChild(this.panelEl);
        }

        this.panelEl.innerHTML = `
            <div class="gpt-canvas-panel">
                <div class="gpt-canvas-header">
                    <div class="gpt-canvas-title" id="gpt-canvas-title">Preview</div>
                    <div class="gpt-canvas-actions">
                        <div class="gpt-canvas-btn" id="gpt-canvas-undo" title="Undo last write" style="display:none;">${undoIcon}</div>
                        <div class="gpt-canvas-btn" id="gpt-canvas-download" title="Download" style="display:none;">${downloadIcon}</div>
                        <div class="gpt-canvas-btn" id="gpt-canvas-reload" title="Reload">${refreshIcon}</div>
                        <div class="gpt-canvas-btn" id="gpt-canvas-close" title="Close">${closeIcon}</div>
                    </div>
                </div>
                <div class="gpt-canvas-main">
                    <div class="gpt-canvas-body" id="gpt-canvas-body"></div>
                    <div class="gpt-canvas-console-host" id="gpt-canvas-console-host"></div>
                </div>
            </div>
        `;

        document.getElementById('gpt-canvas-close')?.addEventListener('click', () => this.close());
        document.getElementById('gpt-canvas-reload')?.addEventListener('click', () => this._reloadCurrent());
        document.getElementById('gpt-canvas-download')?.addEventListener('click', () => this._downloadCurrent());
        document.getElementById('gpt-canvas-undo')?.addEventListener('click', () => this._undoCurrent());

        this.panelEl.addEventListener('click', (e) => {
            if (e.target === this.panelEl) this.close();
        });

        this.consoleUI.bind();
        this.consoleUI.mountShell(document.getElementById('gpt-canvas-console-host'));
    }

    async prepareSmartWorkspace(fileUrl) {
        const fs = acode.require('fs');
        try {
            let storageRoot = window.ACODE_FILE_STORAGE || window.CACHE_STORAGE;
            if (!storageRoot.startsWith('file://')) storageRoot = `file://${storageRoot}`;

            const basePreviewDir = `${storageRoot}/preview_workspace`;

            if (!(await fs(basePreviewDir).exists())) {
                await fs(storageRoot).createDirectory('preview_workspace');
            } else {
                try {
                    const oldFiles = await fs(basePreviewDir).lsDir();
                    for (let f of oldFiles) await fs(f.url).delete();
                } catch (e) { console.warn('Workspace cleanup failed', e); }
            }

            const workspaceId = `app_${Date.now()}`;
            const workspaceUrl = `${basePreviewDir}/${workspaceId}`;
            await fs(basePreviewDir).createDirectory(workspaceId);

            let htmlContent = await fs(fileUrl).readFile('utf-8');
            // Inject console bridge so runtime errors surface in canvas console
            htmlContent = injectConsoleBridge(htmlContent);
            const dependencies = new Set();
            const srcRegex = /(?:src|href)=["']([^"']+)["']/gi;
            let match;

            while ((match = srcRegex.exec(htmlContent)) !== null) {
                const link = match[1];
                if (!link.startsWith('http') && !link.startsWith('data:') && !link.startsWith('file://') && !link.startsWith('content://') && !link.startsWith('#')) {
                    const cleanLink = link.split('?')[0].split('#')[0];
                    if (cleanLink) dependencies.add(cleanLink);
                }
            }

            const parentUrl = fileUrl.substring(0, fileUrl.lastIndexOf('/'));
            const fileName = fileUrl.substring(fileUrl.lastIndexOf('/') + 1);

            // Nested ES module imports: import ... from './x.js'
            const resolveLocal = (baseParent, rel) => {
                let cur = baseParent;
                const parts = String(rel || '').split('/');
                const clean = [];
                for (const part of parts) {
                    if (part === '..') cur = cur.substring(0, cur.lastIndexOf('/'));
                    else if (part && part !== '.') clean.push(part);
                }
                return `${cur}/${clean.join('/')}`;
            };
            const scanJsImports = async (relPath) => {
                try {
                    const abs = resolveLocal(parentUrl, relPath);
                    const text = await fs(abs).readFile('utf-8');
                    const re = /(?:import|export)\s+(?:[^'"\n]+from\s+)?["']([^"']+)["']/g;
                    let m;
                    while ((m = re.exec(text)) !== null) {
                        const dep = m[1];
                        if (!dep || /^(https?:|data:|file:|content:|\/)/i.test(dep)) continue;
                        const clean = dep.split('?')[0].split('#')[0].replace(/^\.\//, '');
                        if (!clean) continue;
                        const absDep = resolveLocal(abs.substring(0, abs.lastIndexOf('/')), clean);
                        let relFromHtml = clean;
                        if (absDep.startsWith(parentUrl + '/')) {
                            relFromHtml = absDep.slice(parentUrl.length + 1);
                        }
                        if (relFromHtml && !dependencies.has(relFromHtml)) {
                            dependencies.add(relFromHtml);
                            if (/\.(m?js)$/i.test(relFromHtml)) await scanJsImports(relFromHtml);
                        }
                    }
                } catch (e) {
                    console.warn('[CanvasManager] import scan', relPath, e);
                }
            };
            for (const dep of [...dependencies]) {
                if (/\.(m?js)$/i.test(dep)) await scanJsImports(dep);
            }

            // Resolve SAF-safe absolute URLs for each relative dep
            let joinSafPath = null;
            let normalizeSafUrl = null;
            try {
                const fo = await import('../../utils/file/fileOperations.js');
                joinSafPath = fo.joinSafPath;
                normalizeSafUrl = fo.normalizeSafUrl;
            } catch (_) {}

            for (const dep of dependencies) {
                try {
                    const parts = String(dep).split('/').filter(p => p && p !== '.');
                    if (!parts.length) continue;

                    let sourceDepUrl;
                    if (typeof joinSafPath === 'function') {
                        sourceDepUrl = joinSafPath(parentUrl, parts.join('/'));
                    } else {
                        sourceDepUrl = `${parentUrl.replace(/\/$/, '')}/${parts.join('/')}`;
                    }
                    if (typeof normalizeSafUrl === 'function') {
                        sourceDepUrl = normalizeSafUrl(sourceDepUrl);
                    }

                    let currentTempDir = workspaceUrl;
                    for (let i = 0; i < parts.length - 1; i++) {
                        const folderName = parts[i];
                        const tempParentDir = currentTempDir;
                        currentTempDir += `/${folderName}`;
                        if (!(await fs(currentTempDir).exists())) {
                            await fs(tempParentDir).createDirectory(folderName);
                        }
                    }
                    const depName = parts[parts.length - 1];
                    const destPath = `${currentTempDir}/${depName}`;

                    // Prefer read + write (SAF copyTo often fails across content:// → file://)
                    let copied = false;
                    try {
                        const body = await fs(sourceDepUrl).readFile('utf-8');
                        if (await fs(destPath).exists()) {
                            await fs(destPath).writeFile(body);
                        } else {
                            await fs(currentTempDir).createFile(depName, body);
                        }
                        copied = true;
                    } catch (rwErr) {
                        try {
                            await fs(sourceDepUrl).copyTo(currentTempDir, depName);
                            copied = true;
                        } catch (copyErr) {
                            console.warn(`[CanvasManager] Skipped dependency: ${dep}`, sourceDepUrl, rwErr || copyErr);
                        }
                    }
                    if (copied) console.log('[CanvasManager] dep ok', dep, '←', sourceDepUrl);
                } catch (err) {
                    console.warn(`[CanvasManager] Skipped dependency: ${dep}`, err);
                }
            }

            await fs(workspaceUrl).createFile(fileName, htmlContent);
            const finalHtmlPath = `${workspaceUrl}/${fileName}`;
            const toInternalUrl = acode.require('toInternalUrl');
            return await toInternalUrl(finalHtmlPath);

        } catch (error) {
            console.error('[CanvasManager] Smart Workspace creation failed:', error);
            const toInternalUrl = acode.require('toInternalUrl');
            return (await toInternalUrl(fileUrl)) || fileUrl;
        }
    }

    // 🟢 Markdown renderer — now also auto-renders ```mermaid fences as real
    // diagrams instead of leaving them as plain code text.
    _getMarkdownHTML(mdText, title) {
        const base64Md = btoa(unescape(encodeURIComponent(mdText)));
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-dark.min.css">
            <style>
                body { box-sizing: border-box; min-width: 200px; max-width: 980px; margin: 0 auto; padding: 20px; background-color: #0d1117; color: #c9d1d9; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
                pre { background-color: #161b22 !important; border-radius: 8px !important; }
                .mermaid { background: #161b22; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0; }
            </style>
        </head>
        <body class="markdown-body">
            <div id="content"><div style="text-align:center; margin-top:50px;">Rendering Markdown...</div></div>
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
            <script>
                try {
                    const decodedMd = decodeURIComponent(escape(atob("${base64Md}")));
                    document.getElementById('content').innerHTML = marked.parse(decodedMd);

                    // 🟢 Turn \`\`\`mermaid fences into real rendered diagrams
                    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
                    document.querySelectorAll('code.language-mermaid').forEach((el) => {
                        const div = document.createElement('div');
                        div.className = 'mermaid';
                        div.textContent = el.textContent;
                        el.parentElement.replaceWith(div);
                    });
                    mermaid.run().catch(e => console.warn('Mermaid render skipped:', e));
                } catch(e) {
                    document.getElementById('content').innerHTML = "<h3 style='color:red'>Failed to render Markdown</h3>";
                }
            </script>
        </body>
        </html>`;
    }

    // 🟢 NEW: standalone Mermaid diagram file (.mmd / .mermaid)
    _getMermaidHTML(mermaidText, title) {
        const base64 = btoa(unescape(encodeURIComponent(mermaidText)));
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0d1117; padding:16px; }
                .mermaid { max-width:100%; }
                #error { color:#f66; font-family:sans-serif; text-align:center; }
            </style>
        </head>
        <body>
            <div class="mermaid" id="diagram"></div>
            <div id="error" style="display:none;"></div>
            <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
            <script>
                try {
                    const decoded = decodeURIComponent(escape(atob("${base64}")));
                    document.getElementById('diagram').textContent = decoded;
                    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
                    mermaid.run().catch(e => {
                        document.getElementById('diagram').style.display = 'none';
                        const err = document.getElementById('error');
                        err.style.display = 'block';
                        err.textContent = 'Could not render diagram: ' + e.message;
                    });
                } catch(e) {
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error').textContent = 'Failed to decode diagram content.';
                }
            </script>
        </body>
        </html>`;
    }

    // 🟢 NEW: actual image files — was previously force-read as UTF-8 text and
    // sent through the code viewer, which corrupts binary image data.
    _getImageHTML(imageUrl, filename) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${filename}</title>
            <style>
                body {
                    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
                    background: repeating-conic-gradient(#2a2a2a 0% 25%, #1d1d1d 0% 50%) 50% / 24px 24px;
                }
                img { max-width:96%; max-height:96vh; border-radius:6px; box-shadow:0 10px 40px rgba(0,0,0,0.5); }
            </style>
        </head>
        <body><img src="${imageUrl}" alt="${filename}"></body>
        </html>`;
    }

    // 🟢 NEW: SVG files now render VISUALLY instead of as raw XML source text.
    _getSvgHTML(svgContent, filename) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${filename}</title>
            <style>
                body {
                    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
                    background: repeating-conic-gradient(#2a2a2a 0% 25%, #1d1d1d 0% 50%) 50% / 24px 24px;
                    padding: 16px;
                }
                svg { max-width:100%; max-height:96vh; }
            </style>
        </head>
        <body>${svgContent}</body>
        </html>`;
    }

    // 🟢 NEW: unified diff view (oldContent vs newContent) with a revert action.
    // Uses jsdiff via CDN, same pattern as marked/mermaid/Prism elsewhere in this
    // file. `filePath`, if given, enables "Revert to previous version" — writes
    // oldContent back via window.parent.acode (the iframe is same-origin thanks
    // to allow-same-origin, so it can reach the parent page's acode/fs).
    _getDiffHTML(oldContent, newContent, title, filePath) {
        const oldB64 = btoa(unescape(encodeURIComponent(oldContent || '')));
        const newB64 = btoa(unescape(encodeURIComponent(newContent || '')));
        const canRevert = !!filePath;
        const filePathJson = JSON.stringify(filePath || '');

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jsdiff/5.1.0/diff.min.js"></script>
            <style>
                * { box-sizing: border-box; }
                body { margin:0; background:#0d1117; color:#c9d1d9; font-family: Consolas, Monaco, 'Andale Mono', monospace; font-size:12.5px; }
                .diff-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#151515; border-bottom:1px solid #333; font-family: -apple-system, sans-serif; position: sticky; top:0; }
                .diff-title { font-size: 12.5px; color:#8abeb7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .diff-revert-btn { background:#3a2020; border:1px solid #663; color:#f88; padding:5px 12px; border-radius:6px; cursor:pointer; font-size:11.5px; flex-shrink:0; }
                .diff-revert-btn:active { background:#502828; }
                .diff-line { white-space:pre-wrap; word-break:break-word; padding:1px 14px; line-height:1.5; }
                .diff-added { background: rgba(46,160,67,0.15); color:#7ee787; }
                .diff-removed { background: rgba(248,81,73,0.15); color:#ff7b72; }
                .diff-context { color:#8b949e; }
                .diff-empty { padding: 24px; text-align:center; color:#666; font-family: sans-serif; }
            </style>
        </head>
        <body>
            <div class="diff-header">
                <span class="diff-title">${title}</span>
                ${canRevert ? `<div class="diff-revert-btn" id="revert-btn">⎌ Revert to previous version</div>` : ''}
            </div>
            <div id="diff-body"></div>
            <script>
                const oldText = decodeURIComponent(escape(atob("${oldB64}")));
                const newText = decodeURIComponent(escape(atob("${newB64}")));
                const body = document.getElementById('diff-body');

                if (oldText === newText) {
                    body.innerHTML = '<div class="diff-empty">No changes detected between versions.</div>';
                } else {
                    const parts = Diff.diffLines(oldText, newText);
                    parts.forEach(part => {
                        const lines = part.value.split('\\n');
                        if (lines[lines.length - 1] === '') lines.pop();
                        lines.forEach(line => {
                            const div = document.createElement('div');
                            div.className = 'diff-line ' + (part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-context');
                            div.textContent = (part.added ? '+ ' : part.removed ? '- ' : '  ') + line;
                            body.appendChild(div);
                        });
                    });
                }

                const revertBtn = document.getElementById('revert-btn');
                if (revertBtn) {
                    revertBtn.addEventListener('click', async () => {
                        try {
                            const fs = window.parent.acode.require('fs');
                            await fs(${filePathJson}).writeFile(oldText);
                            revertBtn.textContent = '✓ Reverted';
                            if (window.parent.toast) window.parent.toast('Reverted to previous version', 2000);
                        } catch (e) {
                            revertBtn.textContent = '✗ Revert failed';
                            console.error('[Canvas diff] revert failed:', e);
                        }
                    });
                }
            </script>
        </body>
        </html>`;
    }

    async open({ title = 'Preview', mode = 'inline', src = '', language = 'html', oldContent = null, newContent = null } = {}) {
        if (!this.panelEl || !document.getElementById(this.containerId)) {
            this._buildPanelShell();
        }

        this._lastOpen = { title, mode, src, language, oldContent, newContent };
        const titleEl = document.getElementById('gpt-canvas-title');
        if (titleEl) titleEl.textContent = title;

        const downloadBtn = document.getElementById('gpt-canvas-download');
        if (downloadBtn) downloadBtn.style.display = (mode === 'file') ? 'flex' : 'none';
        try { this._updateUndoButton(); } catch (_) {}

        const body = document.getElementById('gpt-canvas-body');
        if (!body) return;

        body.innerHTML = `<div class="gpt-canvas-loading" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--active-color, #4b5dd1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite; margin-bottom: 10px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
            <span style="color:var(--primary-text-color);">Loading Workspace...</span>
        </div>
        <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>`;

        this.panelEl.classList.add('gpt-canvas-open');
        this.isOpen = true;

        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups');

        // 🟢 Multi-format rendering pipeline — extension decides how to render
        if (mode === 'file') {
            const fs = acode.require('fs');
            const ext = src.split('.').pop().toLowerCase();
            const filename = src.split('/').pop() || 'file';

            if (['html', 'htm'].includes(ext)) {
                // ES modules (import/export, type=module) cannot run correctly in about:srcdoc —
                // relative imports need a real file URL (same as Acode's normal previewer).
                try {
                    const bundled = await CanvasBundler.buildFromHtmlFile(src);
                    const useModuleUrl = !!(bundled.needsModule
                      || (bundled.notes || []).some(n => String(n).startsWith('module:')));

                    if (useModuleUrl) {
                        console.log('[CanvasManager] ES module page → file URL preview (not srcdoc)');
                        // Prefer original project URL (relative CSS/JS resolve like Acode previewer).
                        // Workspace copy often fails on SAF content:// copyTo.
                        try {
                            const toInternalUrl = acode.require('toInternalUrl');
                            const direct = (await toInternalUrl(src)) || src;
                            iframe.src = direct;
                            console.log('[CanvasManager] module preview src=', direct);
                        } catch (directErr) {
                            console.warn('[CanvasManager] direct URL failed, workspace fallback', directErr);
                            try {
                                const finalSrc = await this.prepareSmartWorkspace(src);
                                iframe.src = finalSrc;
                            } catch (wsErr) {
                                console.error('[CanvasManager] workspace also failed', wsErr);
                                iframe.src = src;
                            }
                        }
                    } else if (bundled.success && bundled.html) {
                        iframe.srcdoc = injectConsoleBridge(bundled.html);
                        if (bundled.notes?.length) {
                            console.warn('[CanvasManager] bundle notes:', bundled.notes);
                            window.toast?.(`Preview: ${bundled.notes.length} asset(s) missing`, 2500);
                        }
                    } else {
                        throw new Error(bundled.error || 'bundle failed');
                    }
                } catch (bundleErr) {
                    console.warn('[CanvasManager] bundle failed, fallback workspace copy', bundleErr);
                    try {
                        const finalSrc = await this.prepareSmartWorkspace(src);
                        iframe.src = finalSrc;
                    } catch (wsErr) {
                        console.error('[CanvasManager] workspace failed', wsErr);
                        try {
                            const toInternalUrl = acode.require('toInternalUrl');
                            iframe.src = (await toInternalUrl(src)) || src;
                        } catch (_) {
                            const raw = await fs(src).readFile('utf-8');
                            iframe.srcdoc = injectConsoleBridge(raw);
                        }
                    }
                }
            } else if (MARKDOWN_EXTS.includes(ext)) {
                const content = await fs(src).readFile('utf-8');
                iframe.srcdoc = this._getMarkdownHTML(content, filename);
            } else if (MERMAID_EXTS.includes(ext)) {
                const content = await fs(src).readFile('utf-8');
                iframe.srcdoc = this._getMermaidHTML(content, filename);
            } else if (ext === 'svg') {
                const content = await fs(src).readFile('utf-8');
                iframe.srcdoc = this._getSvgHTML(content, filename);
            } else if (IMAGE_EXTS.includes(ext)) {
                const toInternalUrl = acode.require('toInternalUrl');
                const internalUrl = (await toInternalUrl(src)) || src;
                iframe.srcdoc = this._getImageHTML(internalUrl, filename);
            } else if (this._isFrameworkSource(ext, filename)) {
                // React/Vue/Svelte/etc. — no blind multi-file copy; show source + guidance
                const content = await fs(src).readFile('utf-8');
                iframe.srcdoc = this._getFrameworkNoticeHTML(content, ext, filename);
            } else {
                const content = await fs(src).readFile('utf-8');
                iframe.srcdoc = CodeEditorViewer.getViewerHTML(content, ext, filename);
            }
        } else if (mode === 'inline-md') {
            iframe.srcdoc = this._getMarkdownHTML(src, title);
        } else if (mode === 'inline-mermaid') {
            iframe.srcdoc = this._getMermaidHTML(src, title);
        } else if (mode === 'inline-code') {
            iframe.srcdoc = CodeEditorViewer.getViewerHTML(src, language, title);
        } else if (mode === 'diff') {
            iframe.srcdoc = this._getDiffHTML(oldContent, newContent, title, src);
        } else {
            // mode: inline (HTML)
            iframe.srcdoc = src;
        }

        // Console host lives beside body
        const host = document.getElementById('gpt-canvas-console-host');
        if (host) this.consoleUI.mountShell(host);
        this.consoleUI.clear();

        // Inject bridge into srcdoc HTML as well
        if (iframe.srcdoc) {
            iframe.srcdoc = injectConsoleBridge(iframe.srcdoc);
        }

        setTimeout(() => {
            body.innerHTML = '';
            body.appendChild(iframe);
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = '0';
            iframe.style.background = '#fff';
        }, 200);
    }

    _updateUndoButton() {
        const btn = document.getElementById('gpt-canvas-undo');
        if (!btn) return;
        const src = this._lastOpen?.src || this._lastOpen?.path || '';
        let show = false;
        try {
            const app = this.app || window.gptApp || window.app;
            const map = app?._fileUndoMap;
            if (map && map.size && src) {
                let s = String(src);
                const i = s.lastIndexOf('::');
                if (i !== -1) s = s.slice(i + 2);
                s = s.replace(/^primary:/i, '').replace(/^\/+/, '').toLowerCase();
                const base = s.split('/').pop();
                show = map.has(s) || [...map.keys()].some(k => k === s || k.endsWith('/' + base) || s.endsWith(k));
            }
        } catch (_) {}
        btn.style.display = show ? 'flex' : 'none';
    }

    async _undoCurrent() {
        const src = this._lastOpen?.src || this._lastOpen?.path;
        if (!src) return;
        const app = this.app || window.gptApp || window.app;
        if (!app) return;
        try {
            const { UndoStore } = await import('../../utils/editor/UndoStore.js');
            const res = await UndoStore.undo(app, src);
            if (res.success) {
                this._updateUndoButton();
                try { this._reloadCurrent(); } catch (_) {}
            } else if (typeof window.toast === 'function') {
                window.toast(res.error || 'Undo failed', 2000);
            }
        } catch (e) {
            console.error('[CanvasManager] undo', e);
            if (typeof window.toast === 'function') window.toast('Undo failed', 2000);
        }
    }

    _reloadCurrent() {
        if (this._lastOpen) this.open(this._lastOpen);
    }

    async _downloadCurrent() {
        if (!this._lastOpen || this._lastOpen.mode !== 'file' || !this._lastOpen.src) return;
        try {
            const fs = acode.require('fs');
            const downloadDir = 'file:///storage/emulated/0/Download';
            if (await fs(downloadDir).exists()) {
                await fs(this._lastOpen.src).copyTo(downloadDir);
                if (typeof window.toast === 'function') window.toast('Saved to Downloads! ✅', 2000);
            } else if (typeof window.toast === 'function') {
                window.toast('Downloads folder not accessible', 2000);
            }
        } catch (e) {
            console.error('[CanvasManager] Download failed:', e);
            if (typeof window.toast === 'function') window.toast('Download failed: ' + e.message, 2500);
        }
    }

    close() {
        if (!this.panelEl) return;
        this.panelEl.classList.remove('gpt-canvas-open');
        const body = document.getElementById('gpt-canvas-body');
        if (body) body.innerHTML = '';
        this.consoleUI?.clear();
        this.isOpen = false;
    }

    _isFrameworkSource(ext, filename) {
        const e = String(ext || '').toLowerCase();
        const n = String(filename || '').toLowerCase();
        if (['jsx', 'tsx', 'vue', 'svelte', 'astro'].includes(e)) return true;
        if (['js', 'ts', 'mjs', 'cjs'].includes(e)) {
            // Heuristic: app entry / components — not a standalone browser page
            if (/^(app|main|index|vite\.config|webpack)/i.test(n.replace(/\.[^.]+$/, ''))) return true;
        }
        return false;
    }

    _getFrameworkNoticeHTML(source, ext, filename) {
        const safe = String(source || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;}
  .banner{padding:14px 16px;background:#1f2937;border-bottom:1px solid #334155;font-size:13px;line-height:1.5;}
  .banner b{color:#93c5fd;}
  .banner code{background:#111827;padding:1px 6px;border-radius:4px;font-size:12px;}
  pre{margin:0;padding:16px;overflow:auto;font-size:12px;line-height:1.45;color:#e5e7eb;}
</style></head><body>
<div class="banner">
  <b>No live browser preview for <code>.${ext}</code></b><br>
  File <code>${filename}</code> needs a build (React/Vue/Vite/etc.). Canvas does <b>not</b> copy the whole project for this.<br>
  Use a built <code>index.html</code> / <code>dist</code> output for HTML preview, or ask the agent to generate a static HTML demo.
</div>
<pre>${safe}</pre>
</body></html>`;
    }

    bindTriggers(container) {
        if (!container) return;
        container.querySelectorAll('.gpt-canvas-trigger[data-mode="file"]:not([data-bound])').forEach(el => {
            el.setAttribute('data-bound', '1');
            el.addEventListener('click', () => {
                this.open({
                    title: el.getAttribute('data-title') || 'File Preview',
                    mode: 'file',
                    src: el.getAttribute('data-src') || ''
                });
            });
        });
    }
}