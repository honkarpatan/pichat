/**
 * Official GitHub Models inference (OpenAI-compatible)
 * https://models.github.ai/inference
 * Auth: GitHub PAT with models:read (or GITHUB_TOKEN in Actions)
 */
import { SYSTEM_INSTRUCTION } from '../SystemPrompt.js';
import { ConfigManager } from '../../utils/ConfigManager.js';

const TAG = '[GitHubModels]';
const BASE = 'https://models.github.ai/inference';

function loadAdv() {
  try {
    return JSON.parse(ConfigManager.get('githubmodelsModelOptions') || '{}') || {};
  } catch (_) {
    return {};
  }
}

function formatMessages(messages) {
  return (messages || []).map(m => {
    const role = m.role === 'model' ? 'assistant' : m.role || 'user';
    let content = m.content;
    if (Array.isArray(content)) {
      content = content
        .map(p => (typeof p === 'string' ? p : p?.text || ''))
        .filter(Boolean)
        .join('\n');
    }
    if (content == null) content = '';
    return {
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content)
    };
  });
}

export class GitHubModels {
  static async generateStream(options, app, onChunk) {
    const { apiKey, model, messages, signal, tools } = options;
    const token = (apiKey || '').trim();
    if (!token) throw new Error('GitHub Models: set a PAT with models:read in API Keys.');

    const adv = loadAdv();
    const modelId = model || 'openai/gpt-4o';
    const msgs = formatMessages(messages);
    if (tools && tools.length && !msgs.some(m => m.role === 'system')) {
      msgs.unshift({ role: 'system', content: SYSTEM_INSTRUCTION });
    }

    const body = {
      model: modelId,
      messages: msgs,
      stream: true,
      temperature:
        tools && tools.length ? 0.1 : adv.temperature != null ? Number(adv.temperature) : 0.7,
      max_tokens: adv.max_tokens != null ? Number(adv.max_tokens) : 4096
    };
    if (adv.top_p != null) body.top_p = Number(adv.top_p);
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const url = `${BASE}/chat/completions`;
    console.log(TAG, 'POST', url, 'model=', modelId);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GitHub Models (${response.status}): ${errText.slice(0, 400)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) onChunk(content);
      return { functionCalls: [], rawParts: content ? [{ text: content }] : [] };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let textBuffer = '';
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
            const piece = json.choices?.[0]?.delta?.content;
            if (piece) {
              textBuffer += piece;
              onChunk(piece);
            }
          } catch (_) {}
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
    }
    return { functionCalls: [], rawParts: textBuffer ? [{ text: textBuffer }] : [] };
  }

  static async fetchModels(apiKey) {
    // Catalog endpoint (may vary); try models.github.ai
    const urls = [
      'https://models.github.ai/catalog/models',
      'https://api.github.com/models'
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        if (!res.ok) continue;
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.data || data.models || [];
        const mapped = list
          .map(m => {
            const id = m.id || m.name || m.model_name;
            return {
              id,
              name: id,
              description: m.publisher || m.summary || 'GitHub Models'
            };
          })
          .filter(m => m.id);
        if (mapped.length) return mapped.sort((a, b) => a.id.localeCompare(b.id));
      } catch (_) {}
    }
    // Curated fallback
    return [
      { id: 'openai/gpt-4o', name: 'openai/gpt-4o', description: 'GPT-4o' },
      { id: 'openai/gpt-4.1', name: 'openai/gpt-4.1', description: 'GPT-4.1' },
      { id: 'openai/gpt-4o-mini', name: 'openai/gpt-4o-mini', description: 'GPT-4o mini' },
      { id: 'deepseek/DeepSeek-R1', name: 'deepseek/DeepSeek-R1', description: 'DeepSeek R1' },
      { id: 'meta/Meta-Llama-3.1-405B-Instruct', name: 'meta/Meta-Llama-3.1-405B-Instruct', description: 'Llama 3.1 405B' }
    ];
  }

  static getDocsHTML() {
    return `
      <div style="padding:12px;font-size:12px;line-height:1.55;color:var(--primary-text-color);">
        <b style="color:#0969da;">GitHub Models</b>
        <p style="margin:8px 0;">Official inference API at <code>models.github.ai</code> — OpenAI-compatible.</p>
        <ol style="padding-left:18px;margin:6px 0;color:var(--secondary-text-color);">
          <li>Create a fine-grained PAT with <code>models: read</code></li>
          <li>Paste in <b>API Keys</b></li>
          <li>Model ids look like <code>openai/gpt-4o</code> (publisher/name)</li>
        </ol>
        <p style="margin:8px 0;opacity:0.85;">Free tier + paid limits apply per GitHub account. This is the supported alternative to unofficial Copilot gateway use.</p>
      </div>`;
  }
}
