/**
 * Agent tool: preview / "run" HTML in chat (not terminal).
 * Replaces mistaken node -c / find attempts when user asks to run HTML.
 */
import { runInChatHtmlPreview } from '../../ui/canvas/CanvasInChatPreview.js';
import { normalizeSafUrl, joinSafPath, getAllProjectFolders } from '../../utils/file/fileOperations.js';

const TOOL = 'preview_html';

export class AcodeCanvasAgent {
  static getToolsSchema() {
    return [
      {
        name: TOOL,
        description:
          'Run/preview an HTML file in the chat UI (bundled CSS/JS, scan+iframe, runtime error check). Use when the user asks to run HTML, check page errors, or preview index.html. Do NOT use terminal (node -c, find) for HTML preview.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: {
              type: 'STRING',
              description: 'Path or URI to the HTML file (e.g. index.html, game/index.html, /sdcard/.../index.html, file:// or content://)'
            }
          },
          required: ['path']
        }
      }
    ];
  }

  static async _resolveHtmlUrl(path) {
    let fileUrl = normalizeSafUrl(path);
    const fs = acode.require('fs');

    if (await fs(fileUrl).exists()) return fileUrl;

    // Relative to opened project folders
    try {
      const folders = (await getAllProjectFolders?.()) || [];
      for (const f of folders) {
        const root = f.url || f.uri || f;
        if (!root) continue;
        const cand = joinSafPath(root, path.replace(/^\//, ''));
        if (cand && (await fs(cand).exists())) return cand;
      }
    } catch (_) {}

    // Active editor file if HTML
    const active = window.editorManager?.activeFile?.uri || window.editorManager?.activeFile?.url;
    if (active && /\.html?$/i.test(active) && (await fs(active).exists())) return active;

    // Same folder as active file + relative path
    if (active) {
      const base = String(active).replace(/\/[^/]+$/, '');
      const cand = `${base}/${path.replace(/^\.\//, '')}`;
      if (await fs(cand).exists()) return cand;
    }
    return null;
  }

  static async executeTool(functionCall) {
    const name = functionCall?.name || functionCall?.function?.name;
    if (name !== TOOL) return { error: `Unknown tool: ${name}` };

    const args = functionCall.args || functionCall.arguments || {};
    let path = (args.path || '').trim();
    if (!path) return { error: 'path is required' };

    let fileUrl;
    try {
      fileUrl = await this._resolveHtmlUrl(path);
    } catch (e) {
      return { error: e.message || String(e) };
    }
    if (!fileUrl) {
      return {
        error: `HTML file not found: ${path}. Pass full path (e.g. /sdcard/Ay/game/index.html) or open the project folder in Acode.`
      };
    }

    const label = fileUrl.split('/').pop() || path;
    try {
      const result = await runInChatHtmlPreview({
        fileUrl,
        label,
        minMs: 3000,
        timeoutMs: 4500
      });
      if (result.ok) {
        return {
          success: true,
          message: `Previewed ${label}: no runtime errors in the check window.`,
          path: fileUrl,
          errors: []
        };
      }
      return {
        success: false,
        message: `Previewed ${label}: ${result.errors.length} runtime error(s).`,
        path: fileUrl,
        errors: result.errors.slice(0, 12)
      };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }
}
