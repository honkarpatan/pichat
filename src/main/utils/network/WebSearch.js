// src/main/utils/network/WebSearch.js
//
// Adaptive web search (Claude / modern-agent style):
// - Infer how many results (1–10) from the query — not always 5
// - include_images ONLY when the user actually wants images
// - Prefer one focused search; callers may search again with a refined query
// - Max 10 results hard cap

export class WebSearch {
  static useWebSearchVia = 'tavily';

  static tavilyApiKeys = [
    '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' , // honkarpatan
    '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' , // soasatifona
    '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' , // sourav0titenic
    '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' , // chandsourav45
    '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' , // cosmo 
    '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'  , // devs.sourav
    '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' , // bc 
    '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' , // mono
    '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' // sourav0chand
    
  ];
  static currentKeyIndex = 0;

  /**
   * User keys from settings (one per line) + optional built-in fallback pool.
   */
  static _parseUserTavilyKeys() {
    try {
      // Lazy require-style: ConfigManager is ESM — use dynamic cache
      if (!this._cfgMod) {
        // set by ensureConfigMod() from async path; sync fallback via global
      }
    } catch (_) {}
    const raw =
      (typeof this._userKeysCache === 'string' && this._userKeysCache) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('tavilyApiKeys')) ||
      '';
    // Prefer in-memory from last refreshUserKeys()
    const fromMem = Array.isArray(this._userKeyList) ? this._userKeyList : null;
    if (fromMem && fromMem.length) return fromMem;

    const text = String(raw || '');
    return text
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s && s.startsWith('tvly-'));
  }

  /** Call before search (async) to load ConfigManager keys into memory */
  static async refreshUserKeys() {
    try {
      const { ConfigManager } = await import('../ConfigManager.js');
      const raw = ConfigManager.get('tavilyApiKeys') || '';
      this._userKeyList = String(raw)
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(s => s && (s.startsWith('tvly-') || s.length > 20));
      this._preferUserOnly =
        ConfigManager.get('tavilyPreferUserKeys') === true ||
        ConfigManager.get('tavilyPreferUserKeys') === 'true';
      const maxR = parseInt(ConfigManager.get('tavilyMaxResults'), 10);
      const maxI = parseInt(ConfigManager.get('tavilyMaxImages'), 10);
      this._settingsMaxResults = Number.isFinite(maxR) ? Math.max(1, Math.min(10, maxR)) : null;
      this._settingsMaxImages = Number.isFinite(maxI) ? Math.max(0, Math.min(10, maxI)) : null;
    } catch (e) {
      console.warn('[Web Search] refreshUserKeys', e);
    }
  }

  static _getNextTavilyKey() {
    const userKeys = Array.isArray(this._userKeyList) ? this._userKeyList : this._parseUserTavilyKeys();
    const builtIn = this.tavilyApiKeys || [];
    const preferUser = this._preferUserOnly === true;

    let pool = [];
    if (preferUser && userKeys.length) {
      pool = userKeys;
    } else if (userKeys.length && builtIn.length) {
      pool = [...userKeys, ...builtIn];
    } else if (userKeys.length) {
      pool = userKeys;
    } else {
      pool = builtIn;
    }

    if (!pool.length) {
      throw new Error(
        'No Tavily API keys configured. Add keys in Settings → Web browsing, or get one at https://app.tavily.com'
      );
    }

    if (this.currentKeyIndex >= pool.length) this.currentKeyIndex = 0;
    const key = pool[this.currentKeyIndex];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % pool.length;
    this._lastKeySource = userKeys.includes(key) ? 'user' : 'builtin';
    return key;
  }

  /**
   * Claude-like search planning from a free-text query.
   * @returns {{ maxResults: number, includeImages: boolean, searchDepth: 'basic'|'advanced', reason: string }}
   */
  static inferSearchOpts(query, explicit = {}) {
    const q = String(query || '');
    const ql = q.toLowerCase();

    const wantsImages =
      explicit.includeImages === true ||
      /\b(images?|photos?|pictures?|pics?|screenshot|logo|icon|wallpaper|gif|meme|illustration|artwork)\b/i.test(ql) ||
      /\b(show|find|get|download)\b.{0,48}\b(images?|photos?|pictures?|pics?)\b/i.test(ql);

    const broad =
      /\b(compare|versus|\bvs\b|alternatives?|best|top\s*\d+|list of|research|overview|everything about|pros and cons)\b/i.test(ql);
    const narrow =
      /\b(what is|who is|when did|version of|docs? for|documentation|error:|how to fix|stack.?trace)\b/i.test(ql) ||
      q.trim().split(/\s+/).length <= 4;

    let maxResults = 3; // default: modest, not always 5
    if (narrow) maxResults = 2;
    if (broad) maxResults = 6;
    if (wantsImages) maxResults = Math.min(maxResults, 3);
    // explicit override from tool args
    if (explicit.maxResults != null) {
      maxResults = Number(explicit.maxResults) || maxResults;
    }
    // Settings cap (user preference)
    if (this._settingsMaxResults != null) {
      maxResults = Math.min(maxResults, this._settingsMaxResults);
    }

    maxResults = Math.max(1, Math.min(10, Math.round(maxResults)));

    const searchDepth =
      explicit.searchDepth === 'advanced' || broad ? 'advanced' : 'basic';

    let includeImages =
      explicit.includeImages === false ? false : wantsImages;
    if (this._settingsMaxImages === 0) includeImages = false;

    return {
      maxResults,
      includeImages,
      searchDepth,
      reason: wantsImages
        ? 'image-intent'
        : broad
          ? 'broad-research'
          : narrow
            ? 'narrow-fact'
            : 'default'
    };
  }

  /**
   * @param {string} query
   * @param {{ maxResults?: number, includeImages?: boolean, searchDepth?: string }} [opts]
   */
  static async search(query, opts = {}) {
    await this.refreshUserKeys();
    if (this.useWebSearchVia === 'tavily') {
      return await this._searchTavily(query, opts);
    }
    return await this._searchScraping(query, opts);
  }

  static async _searchTavily(query, opts = {}) {
    const plan = this.inferSearchOpts(query, opts);
    console.log(
      `[Web Search] plan=${plan.reason} max=${plan.maxResults} images=${plan.includeImages} depth=${plan.searchDepth}`
    );

    try {
      const apiKey = this._getNextTavilyKey();
      console.log(
        `[Web Search] Tavily key source=${this._lastKeySource || 'unknown'} idx=${this.currentKeyIndex}`
      );

      const body = {
        api_key: apiKey,
        query,
        max_results: plan.maxResults,
        search_depth: plan.searchDepth,
        include_images: plan.includeImages,
        include_answer: false
      };

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Tavily API failed with status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];
      let images = plan.includeImages ? data.images || [] : [];
      const imgCap = this._settingsMaxImages != null ? this._settingsMaxImages : 4;
      if (imgCap <= 0) images = [];
      else images = images.slice(0, imgCap);

      let searchContext = `[LIVE WEB SEARCH RESULTS FOR: "${query}"]\n`;
      searchContext += `(plan: ${plan.reason}, results=${results.length}, images=${images.length})\n\n`;

      if (results.length > 0) {
        searchContext += results
          .map(
            (r, i) =>
              `${i + 1}. Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`
          )
          .join('\n\n');
      }

      if (images.length > 0) {
        searchContext += `\n\n[RELEVANT IMAGE URLs FOUND ON THE WEB]\n`;
        images.forEach((imgUrl, index) => {
          searchContext += `Image ${index + 1}: ${imgUrl}\n`;
        });
        searchContext += `\n[SYSTEM: User asked for images. Prefer showing these URLs with <img src="URL" style="max-width:400px;border-radius:12px;margin:8px 0;"> when appropriate.]`;
      } else {
        searchContext += `\n\n[SYSTEM: Use these results to answer. Cite URLs when useful. If results are thin, you may search again with a more specific query.]`;
      }

      if (results.length > 0 || images.length > 0) {
        return {
          text: searchContext,
          query,
          items: results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content
          })),
          images,
          plan
        };
      }

      return {
        text: `[System Note: No web results for "${query}". Answer from knowledge, or try a refined search query.]`,
        query,
        items: [],
        images: [],
        plan
      };
    } catch (error) {
      console.error('[Web Search] Tavily Error:', error);
      console.log('[Web Search] Falling back to DuckDuckGo scraping…');
      return await this._searchScraping(query, opts);
    }
  }

  static async _searchScraping(query, opts = {}) {
    const plan = this.inferSearchOpts(query, opts);
    try {
      console.log('[Web Search] DuckDuckGo scraping fallback');
      const targetUrl = encodeURIComponent(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      );
      const proxyUrl = `https://api.allorigins.win/get?url=${targetUrl}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Search request failed');

      const data = await response.json();
      const html = data.contents;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const results = [];
      const resultElements = doc.querySelectorAll('.result__snippet');
      resultElements.forEach((el, index) => {
        if (index < plan.maxResults) {
          results.push(el.textContent.trim());
        }
      });

      if (results.length > 0) {
        let searchContext = `[LIVE WEB SEARCH RESULTS FOR: "${query}"]\n`;
        searchContext += results.map((r, i) => `${i + 1}. ${r}`).join('\n\n');
        searchContext += `\n\n[SYSTEM: Use the above results. Refine and search again if needed.]`;
        return {
          text: searchContext,
          query,
          items: results.map((r, i) => ({
            title: `Result ${i + 1}`,
            url: '',
            content: r
          })),
          images: [],
          plan
        };
      }

      return {
        text: `[System Note: No specific web search results found for "${query}".]`,
        query,
        items: [],
        images: [],
        plan
      };
    } catch (error) {
      console.error('[Web Search] Scraping Error:', error);
      return {
        text: `[System Note: Live web search failed. Answer from internal knowledge.]`,
        query,
        items: [],
        images: [],
        plan
      };
    }
  }
}
