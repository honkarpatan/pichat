/**
 * GitHub Copilot Chat API (OpenAI-compatible surface)
 *
 * Auth flow:
 *  1) User provides a GitHub token (classic PAT with read:user, or OAuth token from IDE login)
 *  2) Exchange → short-lived Copilot JWT via api.github.com/copilot_internal/v2/token
 *  3) Call api.githubcopilot.com/chat/completions with Copilot-Integration-Id
 *
 * Requires an active GitHub Copilot subscription on the account.
 */
import { SYSTEM_INSTRUCTION } from '../SystemPrompt.js';
import { ConfigManager } from '../../utils/ConfigManager.js';

const TAG = '[GitHubCopilot]';
const COPILOT_BASE = 'https://api.githubcopilot.com';
const TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

function loadAdv() {
  try {
    return JSON.parse(ConfigManager.get('githubcopilotModelOptions') || '{}') || {};
  } catch (_) {
    return {};
  }
}

function getCachedCopilotSession() {
  try {
    return JSON.parse(ConfigManager.get('githubcopilotSession') || 'null');
  } catch (_) {
    return null;
  }
}

function setCachedCopilotSession(session) {
  ConfigManager.set('githubcopilotSession', JSON.stringify(session));
}

/** Exchange GitHub token → Copilot JWT (≈25–30 min) */
async function ensureCopilotToken(githubToken) {
  const cached = getCachedCopilotSession();
  const now = Date.now();
  if (
    cached?.token &&
    cached.githubToken === githubToken &&
    cached.expiresAt &&
    cached.expiresAt - 60_000 > now
  ) {
    return cached.token;
  }

  console.log(TAG, 'refreshing Copilot token…');
  const res = await fetch(TOKEN_URL, {
    method: 'GET',
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
      'User-Agent': 'Acode-AI-Chat/1.0',
      'Editor-Version': 'vscode/1.96.0',
      'Editor-Plugin-Version': 'copilot-chat/0.22.0'
    }
  });

  if (!res.ok) {
    const t = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Copilot token failed (${res.status}). Need a valid GitHub token + active Copilot plan. ${t.slice(0, 180)}`
      );
    }
    throw new Error(`Copilot token exchange failed (${res.status}): ${t.slice(0, 250)}`);
  }

  const data = await res.json();
  const token = data.token;
  if (!token) throw new Error('Copilot token response missing token field.');

  // expires_at is often unix seconds
  let expiresAt = now + 25 * 60 * 1000;
  if (data.expires_at) {
    const e = Number(data.expires_at);
    expiresAt = e > 1e12 ? e : e * 1000;
  }

  setCachedCopilotSession({ token, githubToken, expiresAt });
  return token;
}

function copilotHeaders(copilotToken, adv = {}) {
  const integrationId = adv.integrationId || 'vscode-chat';
  return {
    Authorization: `Bearer ${copilotToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Copilot-Integration-Id': integrationId,
    'Editor-Version': adv.editorVersion || 'vscode/1.96.0',
    'Editor-Plugin-Version': adv.editorPluginVersion || 'copilot-chat/0.22.0',
    'User-Agent': 'GitHubCopilotChat/0.22.0',
    'Openai-Intent': 'conversation-panel',
    'X-Request-Id': `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  };
}

function formatMessages(messages) {
  return (messages || []).map(m => {
    const role = m.role === 'model' ? 'assistant' : m.role || 'user';
    let content = m.content;
    if (Array.isArray(content)) {
      content = content
        .map(p => {
          if (typeof p === 'string') return p;
          if (p?.text) return p.text;
          if (p?.type === 'text') return p.text || '';
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (content == null) content = '';
    const out = { role, content: typeof content === 'string' ? content : JSON.stringify(content) };
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    return out;
  });
}

export class GitHubCopilot {
  static async generateStream(options, app, onChunk) {
    const { apiKey, model, messages, signal, tools } = options;
    const githubToken = (apiKey || '').trim();
    if (!githubToken) {
      throw new Error('GitHub Copilot: paste a GitHub token (PAT / OAuth) in API Keys.');
    }

    const adv = loadAdv();
    const copilotToken = await ensureCopilotToken(githubToken);
    const modelId = model || adv.defaultModel || 'gpt-4o';

    const msgs = formatMessages(messages);
    if (tools && tools.length && !msgs.some(m => m.role === 'system')) {
      msgs.unshift({ role: 'system', content: SYSTEM_INSTRUCTION });
    }

    const body = {
      model: modelId,
      messages: msgs,
      stream: true,
      temperature:
        tools && tools.length ? 0.1 : adv.temperature != null ? Number(adv.temperature) : 0.3,
      max_tokens: adv.max_tokens != null ? Number(adv.max_tokens) : 4096
    };
    if (adv.top_p != null) body.top_p = Number(adv.top_p);
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const url = `${COPILOT_BASE}/chat/completions`;
    console.log(TAG, 'POST', url, 'model=', modelId);

    const response = await fetch(url, {
      method: 'POST',
      headers: copilotHeaders(copilotToken, adv),
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      // Token might have expired mid-flight — clear cache
      if (response.status === 401) {
        ConfigManager.remove('githubcopilotSession');
      }
      throw new Error(`Copilot API (${response.status}): ${errText.slice(0, 400)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) onChunk(content);
      const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
      const parsed = toolCalls.map(tc => {
        let args = {};
        try {
          args =
            typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments || {};
        } catch (_) {}
        return { id: tc.id, name: tc.function?.name, args };
      });
      const parts = [];
      if (content) parts.push({ text: content });
      parsed.forEach(fc => parts.push({ functionCall: fc }));
      return { functionCalls: parsed, rawParts: parts };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let textBuffer = '';
    const currentToolCalls = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:') || trimmed.includes('[DONE]')) continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
              textBuffer += delta.content;
              onChunk(delta.content);
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!currentToolCalls[index]) {
                  currentToolCalls[index] = {
                    id: tc.id,
                    name: tc.function?.name || '',
                    argsString: tc.function?.arguments || ''
                  };
                } else {
                  if (tc.function?.name) currentToolCalls[index].name = tc.function.name;
                  if (tc.id) currentToolCalls[index].id = tc.id;
                  if (tc.function?.arguments) {
                    currentToolCalls[index].argsString += tc.function.arguments;
                  }
                }
              }
            }
          } catch (_) {}
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
    }

    const parsedFunctionCalls = Object.values(currentToolCalls).map(tc => {
      let args = {};
      try {
        args = JSON.parse(tc.argsString || '{}');
      } catch (_) {}
      return { id: tc.id, name: tc.name, args };
    });
    const parts = [];
    if (textBuffer) parts.push({ text: textBuffer });
    parsedFunctionCalls.forEach(fc => parts.push({ functionCall: fc }));
    return { functionCalls: parsedFunctionCalls, rawParts: parts };
  }

  static async fetchModels(githubToken) {
    const copilotToken = await ensureCopilotToken(githubToken);
    const res = await fetch(`${COPILOT_BASE}/models`, {
      headers: copilotHeaders(copilotToken)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Copilot models (${res.status}): ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const list = data.data || data.models || [];
    return list
      .map(m => ({
        id: m.id || m.name,
        name: m.id || m.name,
        description: m.owned_by || m.version || 'GitHub Copilot'
      }))
      .filter(m => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  static getDocsHTML() {
    return `
      <div style="padding:12px;font-size:12px;line-height:1.55;color:var(--primary-text-color);">
        <b style="color:#238636;">GitHub Copilot</b>
        <p style="margin:8px 0;">Uses <code>api.githubcopilot.com</code> (same surface many IDE integrations use). Requires an <b>active Copilot subscription</b>.</p>
        <ol style="padding-left:18px;margin:6px 0;color:var(--secondary-text-color);">
          <li><b>API Keys</b> → GitHub token:
            <ul style="margin:4px 0;padding-left:16px;">
              <li>Classic PAT with <code>read:user</code> (and Copilot access on the account), or</li>
              <li>OAuth token from a logged-in IDE (JetBrains/VS Code Copilot session)</li>
            </ul>
          </li>
          <li>App exchanges it for a short-lived Copilot JWT (auto-refresh)</li>
          <li><b>Fetch Models</b> lists models allowed for your plan</li>
          <li><b>Manual</b> → model id (e.g. <code>gpt-4o</code>, plan-dependent)</li>
        </ol>
        <p style="margin:8px 0;opacity:0.85;"><b>Note:</b> This is not an official public product API. Plan limits, model list, and ToS apply. Prefer official <b>GitHub Models</b> provider for PAT + <code>models:read</code> if you only need free/public models.</p>
      </div>`;
  }
}
