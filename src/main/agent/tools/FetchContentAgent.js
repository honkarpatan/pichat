/**
 * fetch_content — public http(s) only.
 * 1) browser fetch
 * 2) fallback: Termux/Acode shell curl (WebView CORS often blocks fetch)
 */
const TAG = '[FetchContent]';
const MAX_BYTES = 500_000;
const MAX_TEXT = 24_000;
const TIMEOUT_MS = 20_000;

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.', '0.0.0.0', '127.0.0.1', '::1', '[::1]'
]);

function isPrivateHostname(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

/**
 * Extract and validate a single public http(s) URL.
 * Strips HTML junk the model often pastes: href="...", target="_blank", etc.
 */
function assertPublicHttpUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'Empty URL' };

  // 1) Prefer first clean http(s) token (stop at quotes, spaces, <>, etc.)
  const m = s.match(/https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>\\`]*)?/i);
  if (m) s = m[0];
  // 2) Strip common trailing junk
  s = s
    .replace(/&amp;/g, '&')
    .replace(/["'<>].*$/, '')
    .replace(/[.,);]+$/g, '')
    .trim();

  // Drop accidental HTML attribute tails if still present
  if (/\s|target=|href=|rel=/i.test(s)) {
    const m2 = s.match(/https?:\/\/[^\s"'<>]+/i);
    if (m2) s = m2[0].replace(/[.,);]+$/g, '');
  }

  let u;
  try {
    u = new URL(s);
  } catch (_) {
    return { ok: false, error: 'Invalid URL (could not parse). Pass a plain https://… link only.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: `Blocked protocol: ${u.protocol} (only http/https)` };
  }
  if (u.username || u.password) {
    return { ok: false, error: 'URLs with credentials are blocked' };
  }
  if (isPrivateHostname(u.hostname)) {
    return { ok: false, error: `Blocked host (private/local): ${u.hostname}` };
  }

  // Normalize: drop hash for fetch stability; keep search
  u.hash = '';
  const abs = u.toString();
  if (/[\s'"\\`$]/.test(abs)) {
    return { ok: false, error: 'URL contains unsafe characters' };
  }
  // Reject obviously truncated HTML fragments
  if (/["']/.test(String(raw || '')) && abs.length < 12) {
    return { ok: false, error: 'URL looks like an HTML fragment' };
  }
  return { ok: true, url: abs };
}

/**
 * Claude-style page extract: prefer main/article, keep headings, drop chrome.
 */
function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function extractMainHtml(html) {
  let s = String(html || '');
  // Drop non-content early
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ');

  // Prefer semantic main content (first match)
  const candidates = [
    /<main[\s\S]*?<\/main>/i,
    /<article[\s\S]*?<\/article>/i,
    /<div[^>]*(?:role=["']main["']|id=["']content["']|class=["'][^"']*content[^"']*["'])[^>]*>[\s\S]*?<\/div>/i,
    /<body[\s\S]*?<\/body>/i
  ];
  for (const re of candidates) {
    const m = s.match(re);
    if (m && m[0].length > 200) return m[0];
  }
  return s;
}

function htmlToText(html) {
  const title = extractTitle(html);
  let s = extractMainHtml(html);

  // Headings → markdown-ish structure (helps model scan large docs)
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${stripTags(t)}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${stripTags(t)}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${stripTags(t)}\n\n`);
  s = s.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, t) => `\n\n#### ${stripTags(t)}\n\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${stripTags(t)}`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|section|article)>/gi, '\n');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${stripTags(t)}\``);
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\`\`\`\n${stripTags(t)}\n\`\`\`\n`);
  s = s.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
    const label = stripTags(t) || href;
    return `${label} (${href})`;
  });
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();

  if (title && !s.toLowerCase().includes(title.toLowerCase().slice(0, 40))) {
    s = `# ${title}\n\n${s}`;
  }
  return s;
}

function stripTags(x) {
  return String(x || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function finalizeText(text, ctype, maxChars, url, via) {
  let body = String(text || '');
  const rawHtml = body;
  const isHtml = /html|xml/.test(ctype || '') || /^\s*</.test(body);
  const pageTitle = isHtml ? extractTitle(rawHtml) : '';
  if (isHtml) body = htmlToText(body);
  else if (/json/.test(ctype || '')) {
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch (_) {}
  }

  // Prefer start of doc (title + early headings) — Claude-style: front matter first
  const truncated = body.length > maxChars;
  let out = body;
  if (truncated) {
    // Keep head + a middle slice of remaining if very long
    const head = Math.floor(maxChars * 0.85);
    out = body.slice(0, head) + '\n\n…[truncated ' + (body.length - head) + ' chars — use a more specific URL or section if needed]…\n';
  }

  const headings = [];
  const hm = body.matchAll(/^#{1,4}\s+(.+)$/gm);
  for (const x of hm) {
    headings.push(x[1].slice(0, 120));
    if (headings.length >= 20) break;
  }

  console.log(TAG, via, url, 'chars=', out.length, 'title=', pageTitle.slice(0, 40));
  return {
    success: true,
    url,
    title: pageTitle || null,
    headings: headings.length ? headings : undefined,
    content_type: ctype || 'text/plain',
    truncated,
    char_count: out.length,
    via,
    content: out,
    message:
      (pageTitle ? `Title: ${pageTitle}\n` : '') +
      (headings.length ? `Sections: ${headings.slice(0, 8).join(' | ')}\n\n` : '') +
      out
  };
}

async function fetchBrowser(url, maxChars) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller?.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'AicodeGPT-Agent/1.0 (fetch_content)'
      }
    });
    const finalCheck = assertPublicHttpUrl(res.url || url);
    if (!finalCheck.ok) {
      return { success: false, error: `Redirect blocked: ${finalCheck.error}` };
    }
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status} ${res.statusText || ''}`.trim(), url: res.url };
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (/image\/|audio\/|video\/|octet-stream|zip|pdf|wasm/.test(ctype) && !/json|xml|html|text/.test(ctype)) {
      return { success: false, error: `Unsupported content-type: ${ctype}`, url: res.url };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { success: false, error: `Response too large (${buf.byteLength} bytes)`, url: res.url };
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return finalizeText(text, ctype, maxChars, res.url || url, 'browser');
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `Timeout after ${TIMEOUT_MS}ms` : (e?.message || String(e));
    return { success: false, error: msg };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchViaCurl(url, maxChars) {
  try {
    const { AcodeTerminalAgent } = await import('./AcodeTerminalAgent.js');
    // Prefer curl, fall back to wget
    // url is already assertPublicHttpUrl-validated — still quote for shell
    const safe = String(url).replace(/'/g, "%27");
    const cmd =
      `curl -sL --max-time 15 -A 'AicodeGPT-Agent/1.0' ` +
      `-H 'Accept: text/html,application/json,text/plain,*/*' ` +
      `'${safe}' 2>/dev/null || wget -qO- --timeout=15 '${safe}' 2>/dev/null`;
    const res = await AcodeTerminalAgent.runShellCommand(cmd, true);
    if (!res?.success && res?.error) {
      return { success: false, error: res.error, via: 'curl' };
    }
    const text = typeof res?.stdout === 'string' ? res.stdout
      : (typeof res?.output === 'string' ? res.output
        : (typeof res === 'string' ? res : String(res?.message || res?.stdout || '')));
    // runShellCommand returns { success, stdout } or similar
    let body = text;
    if (res && typeof res === 'object') {
      body = res.stdout || res.output || res.message || '';
      if (!res.success && !body) return { success: false, error: res.error || 'curl failed', via: 'curl' };
    }
    body = String(body || '');
    if (!body.trim()) {
      return { success: false, error: 'curl/wget returned empty body', via: 'curl' };
    }
    if (body.length > MAX_BYTES) body = body.slice(0, MAX_BYTES);
    return finalizeText(body, 'text/html', maxChars, url, 'curl');
  } catch (e) {
    return { success: false, error: e?.message || String(e), via: 'curl' };
  }
}

export class FetchContentAgent {
  static getToolsSchema() {
    return [
      {
        name: 'fetch_content',
        description:
          'Fetch a public http(s) URL (Claude-style web fetch). Returns title, section headings, and main-content text (nav/footer stripped). ' +
          'Blocked: localhost, private IPs, file://. Uses browser or shell curl fallback.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Public https:// or http:// URL' },
            max_chars: {
              type: 'NUMBER',
              description: `Optional max characters (default ${MAX_TEXT})`
            }
          },
          required: ['url']
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    const name = functionCall?.name;
    if (name !== 'fetch_content') {
      return { error: `Unknown tool: ${name}` };
    }
    const args = functionCall?.args || {};
    const check = assertPublicHttpUrl(args.url);
    if (!check.ok) {
      return { success: false, error: check.error };
    }

    const maxChars = Math.min(
      MAX_TEXT,
      Math.max(500, parseInt(args.max_chars, 10) || MAX_TEXT)
    );

    // 1) Browser fetch
    const browser = await fetchBrowser(check.url, maxChars);
    if (browser.success) return browser;

    console.warn(TAG, 'browser failed:', browser.error, '→ trying curl');

    // 2) Shell curl (Acode/Termux — bypasses WebView CORS)
    const curl = await fetchViaCurl(check.url, maxChars);
    if (curl.success) return curl;

    return {
      success: false,
      error: `Failed to fetch (${browser.error || 'browser'}; curl: ${curl.error || 'n/a'})`,
      url: check.url
    };
  }
}
