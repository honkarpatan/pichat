// main/agent/tools/WebSearchAgent.js
import { WebSearch } from '../../utils/network/WebSearch.js';

const TAG = '[WebSearchAgent]';

export class WebSearchAgent {
  static getToolsSchema() {
    return [
      {
        name: 'web_search',
        description:
          'Search the live web ONLY for up-to-date facts, docs, release notes, news, or unknown URLs. ' +
          'Do NOT use for greetings/thanks or pure local coding. ' +
          'Claude-style: (1) need live data? (2) ONE focused query using the CURRENT date/year from system context — never invent an old year like 2024/2025 if the system says it is 2026. ' +
          'Prefer queries like \"Node.js LTS current\" or \"Node.js LTS site:nodejs.org\" not \"... 2025\". ' +
          '(3) Read titles/URLs in the tool result (4) optionally fetch_content on the best official URL (5) answer with citations. ' +
          'One query first; refine only if thin. include_images only if user asks for pictures.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description:
                'Specific search query (e.g. "React 19 release notes site:react.dev"). Prefer precise over broad.'
            },
            max_results: {
              type: 'NUMBER',
              description:
                'Optional. How many results to fetch (1–10). Omit to let the server choose adaptively (usually 2–3).'
            },
            include_images: {
              type: 'BOOLEAN',
              description:
                'Optional. true only if the user needs images/photos. Default false — do not request images for pure text Q&A.'
            },
            fetch_top: {
              type: 'BOOLEAN',
              description:
                'If true, automatically fetch_content the best official-looking result URL and attach page text (Claude-style search→read in one step). Prefer true when you need docs detail, not just links.'
            }
          },
          required: ['query']
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    const { name, args = {} } = functionCall || {};
    console.log(TAG, 'executeTool ->', name, args);

    try {
      if (name !== 'web_search') {
        return { error: `Unknown tool: ${name}` };
      }
      if (!args.query) return { error: "Missing 'query' argument." };

      const q = String(args.query).trim();
      const lower = q.toLowerCase().replace(/[!?.…]+$/g, '').trim();
      const trivial = /^(thanks|thank you|thank u|thx|ty|ok|okay|hi|hello|hey|yes|no|bye|cool|nice|good|great)$/i.test(lower);
      if (trivial || (q.length < 3)) {
        return {
          error:
            'web_search refused: query looks like chitchat or is too vague. ' +
            'Reply from context without searching. Use web_search only for factual / docs / news needs.',
          skipped: true
        };
      }

      let maxResults = args.max_results != null ? Number(args.max_results) : undefined;
      if (maxResults != null && !Number.isFinite(maxResults)) maxResults = undefined;
      if (maxResults != null) maxResults = Math.max(1, Math.min(10, Math.round(maxResults)));

      const includeImages =
        args.include_images === true || args.includeImages === true
          ? true
          : args.include_images === false || args.includeImages === false
            ? false
            : undefined;

      const searchResult = await WebSearch.search(q, {
        maxResults,
        includeImages
      });

      // Normalize for UI + model (keep query visible; Claude-style cite list)
      const items = Array.isArray(searchResult?.items)
        ? searchResult.items
        : Array.isArray(searchResult?.results)
          ? searchResult.results
          : [];
      const text =
        searchResult?.text ||
        searchResult?.searchContext ||
        (items.length
          ? items
              .map((r, i) => `${i + 1}. ${r.title || 'Result'}\n   ${r.url || ''}\n   ${String(r.content || r.snippet || '').slice(0, 280)}`)
              .join('\n\n')
          : '');

      const mapped = items.slice(0, 10).map(r => ({
        title: r.title || '',
        url: r.url || '',
        snippet: String(r.content || r.snippet || '').slice(0, 400)
      }));

      // Pick best URL for optional auto-fetch (official docs preferred)
      const rankUrl = (u) => {
        const s = String(u || '').toLowerCase();
        let score = 0;
        if (/nodejs\.org|react\.dev|developer\.mozilla|docs\.|github\.com|readthedocs|npmjs\.com|python\.org|kubernetes\.io/.test(s)) score += 5;
        if (/\/docs|\/documentation|\/guide|\/reference|\/api/.test(s)) score += 2;
        if (/medium\.com|stackoverflow\.com|reddit\.com|quora\.com/.test(s)) score -= 1;
        return score;
      };
      const sorted = [...mapped].filter(x => x.url).sort((a, b) => rankUrl(b.url) - rankUrl(a.url));
      const topUrl = sorted[0]?.url || null;

      let page = null;
      const wantFetch =
        args.fetch_top === true ||
        args.fetchTop === true ||
        // Auto when query looks like docs/version and we have a strong official URL
        (rankUrl(topUrl) >= 5 && /\b(docs?|api|lts|version|release|changelog|how to)\b/i.test(q));

      if (wantFetch && topUrl) {
        try {
          const { FetchContentAgent } = await import('./FetchContentAgent.js');
          page = await FetchContentAgent.executeTool({
            name: 'fetch_content',
            args: { url: topUrl, max_chars: 16000 }
          });
          console.log(TAG, 'auto fetch_top', topUrl, page?.success);
        } catch (e) {
          console.warn(TAG, 'fetch_top failed', e);
          page = { success: false, error: e?.message || String(e), url: topUrl };
        }
      }

      console.log(TAG, 'executeTool <-', name, 'done', searchResult?.plan || '', 'q=', q.slice(0, 40));
      return {
        success: true,
        query: q,
        items: mapped,
        suggested_fetch: topUrl,
        page: page && page.success
          ? {
              url: page.url,
              title: page.title,
              headings: page.headings,
              truncated: page.truncated,
              content: page.content || page.message
            }
          : page
            ? { error: page.error, url: topUrl }
            : null,
        text:
          (text ? text + '\n\n' : '') +
          (topUrl ? `Suggested next URL: ${topUrl}\n` : '') +
          (page?.success
            ? `\n--- Fetched page (${page.title || topUrl}) ---\n${String(page.message || page.content || '').slice(0, 16000)}\n`
            : '[SYSTEM: Prefer official sources. Call fetch_content on the best URL if you need full docs. Cite URLs.]'),
        result: searchResult
      };
    } catch (e) {
      console.error(TAG, 'executeTool threw for', name, e);
      return { error: e.message || String(e) };
    }
  }
}
