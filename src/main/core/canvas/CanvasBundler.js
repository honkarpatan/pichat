// src/main/core/canvasCanvasBundler.js
//
// Bundle a real .html file + local .css/.js into ONE self-contained HTML string
// for iframe srcdoc — most reliable path on Android WebView (no multi-file HTTP).

import { readFile } from '../../utils/file/fileOperations.js';

const TAG = '[CanvasBundler]';

export class CanvasBundler {

  static async buildFromHtmlFile(htmlFileUrl) {
    if (!htmlFileUrl) return { success: false, error: 'Missing file url.' };

    const htmlResult = await this._readText(htmlFileUrl);
    if (!htmlResult.ok) {
      return { success: false, error: htmlResult.error || 'Could not read the HTML file.' };
    }

    const baseUrl = htmlFileUrl.substring(0, htmlFileUrl.lastIndexOf('/'));
    let html = htmlResult.content;
    const notes = [];

    // <link rel="stylesheet" href="...">  OR  <link href="....css">
    html = await this._replaceAllAsync(
      html,
      /<link\b[^>]*>/gi,
      async (match) => {
        if (!/\brel\s*=\s*["']stylesheet["']/i.test(match) && !/\.css(['"]|\s|>)/i.test(match)) {
          return match;
        }
        const href = this._attr(match, 'href');
        if (!href || this._isExternal(href) || href.startsWith('data:')) return match;
        const resolved = this._resolve(baseUrl, href);
        const css = await this._readText(resolved);
        if (!css.ok) {
          notes.push(`CSS miss: ${href}`);
          console.warn(TAG, 'stylesheet', href, css.error);
          return `<!-- gpt-canvas: missing stylesheet ${href} -->`;
        }
        return `<style data-gpt-inline="${this._escAttr(href)}">\n${css.content}\n</style>`;
      }
    );

    // Detect ES modules early (type=module or import in page)
    let needsModule = /\btype\s*=\s*["']module["']/i.test(html)
      || /<script\b[^>]*>[\s\S]*?\bimport\s+/i.test(html);

    // <script src="...">
    html = await this._replaceAllAsync(
      html,
      /<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi,
      async (match) => {
        const src = this._attr(match, 'src');
        if (!src || this._isExternal(src) || src.startsWith('data:')) return match;
        const isModule = /\btype\s*=\s*["']module["']/i.test(match);
        const resolved = this._resolve(baseUrl, src);
        const js = await this._readText(resolved);
        if (!js.ok) {
          notes.push(`JS miss: ${src}`);
          console.warn(TAG, 'script', src, js.error);
          return `<!-- gpt-canvas: missing script ${src} -->`;
        }
        if (isModule || /\bimport\s+/.test(js.content) || /\bexport\s+/.test(js.content)) {
          needsModule = true;
          // Keep as external module reference — srcdoc cannot resolve relative imports.
          // Caller should load via file URL / workspace instead of inlining.
          notes.push(`module: ${src}`);
          return match;
        }
        // Classic script — safe to inline without type=module
        return `<script data-gpt-inline="${this._escAttr(src)}">\n${js.content}\n</script>`;
      }
    );

    // Inline classic scripts only; leave type=module src tags intact
    // Inline <script type="module"> without src still needs a real base URL
    if (/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/i.test(html)) {
      needsModule = true;
    }

    // Also: @import url("x.css") inside inlined styles — one level
    html = await this._replaceAllAsync(
      html,
      /@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/gi,
      async (match, imp) => {
        if (this._isExternal(imp)) return match;
        const resolved = this._resolve(baseUrl, imp);
        const css = await this._readText(resolved);
        if (!css.ok) return `/* missing @import ${imp} */`;
        return `/* inlined @import ${imp} */\n${css.content}\n`;
      }
    );

    console.log(TAG, 'bundled', htmlFileUrl, 'notes=', notes);
    return { success: true, html, notes, needsModule: !!needsModule };
  }

  static wrapSnippet(snippet) {
    const looksLikeFullDoc = /<!DOCTYPE html>|<html[\s>]/i.test(snippet);
    if (looksLikeFullDoc) return snippet;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${snippet}</body></html>`;
  }

  static _isExternal(url) {
    return /^(https?:)?\/\//i.test(url) || /^[a-z]+:/i.test(url) && !url.startsWith('file:') && !url.startsWith('content:');
  }

  static _attr(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? m[1] : null;
  }

  static _escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }

  /** Resolve relative path against parent folder URL (handles ../) */
  static _resolve(baseUrl, rel) {
    const clean = String(rel).split('?')[0].split('#')[0];
    if (clean.startsWith('file://') || clean.startsWith('content://')) return clean;
    if (clean.startsWith('/')) {
      // absolute path on device — rare in HTML; treat as relative to base root best-effort
      return baseUrl.replace(/\/[^/]*$/, '') + clean;
    }
    let base = baseUrl.replace(/\/+$/, '');
    const parts = clean.split('/');
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') {
        base = base.substring(0, base.lastIndexOf('/'));
      } else {
        base = `${base}/${p}`;
      }
    }
    return base;
  }

  static async _readText(url) {
    // 1) fileOperations helper
    try {
      const r = await readFile(url, 'utf-8');
      if (r?.success && r.content != null) return { ok: true, content: r.content };
    } catch (e) {
      console.warn(TAG, 'readFile helper failed', url, e?.message);
    }
    // 2) raw Acode fs
    try {
      const fs = acode.require('fs');
      if (await fs(url).exists()) {
        const content = await fs(url).readFile('utf-8');
        return { ok: true, content: typeof content === 'string' ? content : String(content) };
      }
      return { ok: false, error: 'not found: ' + url };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  static async _replaceAllAsync(str, regex, asyncFn) {
    const matches = [...str.matchAll(regex)];
    let result = str;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const replacement = await asyncFn(...m);
      result = result.slice(0, m.index) + replacement + result.slice(m.index + m[0].length);
    }
    return result;
  }
}
