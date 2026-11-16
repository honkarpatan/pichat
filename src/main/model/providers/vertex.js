// Google Vertex AI — Gemini streamGenerateContent
import { SYSTEM_INSTRUCTION } from '../SystemPrompt.js';
import { ConfigManager } from '../../utils/ConfigManager.js';

function loadAdv() {
  try {
    return JSON.parse(ConfigManager.get('vertexModelOptions') || '{}') || {};
  } catch (_) {
    return {};
  }
}

function formatMessages(messages) {
  return (messages || [])
    .filter(m => m && m.role !== 'system')
    .map(m => {
      if (m.role === 'model' && Array.isArray(m.content)) {
        return { role: 'model', parts: m.content };
      }
      if (m.role === 'user' && Array.isArray(m.content) && m.content[0]?.functionResponse) {
        return { role: 'user', parts: m.content };
      }
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) {
        text = m.content.map(p => p?.text || (typeof p === 'string' ? p : '')).filter(Boolean).join('\n');
      } else if (m.content != null) text = JSON.stringify(m.content);
      const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
      return { role, parts: [{ text }] };
    });
}

export class VertexAI {
  static async generateStream(options, app, onChunk) {
    const { apiKey, model, messages, signal, tools, forceToolUse } = options;
    const adv = loadAdv();

    const projectId = (adv.projectId || '').trim();
    const location = (adv.location || 'us-central1').trim();
    const modelId = (model || 'gemini-2.0-flash-001').replace(/^models\//, '').trim();
    const token = (apiKey || '').trim();

    if (!projectId) throw new Error('Vertex AI: set Project ID in Settings → Advanced.');
    if (!token) {
      throw new Error('Vertex AI: set OAuth Access Token (or API key) in API Keys tab.');
    }

    // Regional endpoint
    const host =
      location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${location}-aiplatform.googleapis.com`;
    const path =
      `/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}` +
      `/publishers/google/models/${encodeURIComponent(modelId)}:streamGenerateContent`;
    const url = `https://${host}${path}`;

    const requestBody = {
      contents: formatMessages(messages),
      generationConfig: {
        temperature: tools && tools.length ? 0.1 : adv.temperature != null ? Number(adv.temperature) : 0.7
      }
    };
    if (adv.topP != null) requestBody.generationConfig.topP = Number(adv.topP);
    if (adv.topK != null) requestBody.generationConfig.topK = Number(adv.topK);
    if (adv.maxOutputTokens != null) {
      requestBody.generationConfig.maxOutputTokens = Number(adv.maxOutputTokens);
    }

    if (app?.chatInputUI?.states?.think) {
      requestBody.generationConfig.thinkingConfig = {
        thinkingLevel: String(app.chatInputUI.states.thinkLevel || 'HIGH').toUpperCase()
      };
    }

    const systemBits = (messages || [])
      .filter(m => m?.role === 'system')
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .filter(Boolean);
    if (tools && tools.length && !app?._piActive) systemBits.unshift(SYSTEM_INSTRUCTION);
    if (systemBits.length) {
      requestBody.systemInstruction = {
        role: 'user',
        parts: [{ text: systemBits.join('\n\n') }]
      };
    }

    if (tools && tools.length) {
      // Vertex Gemini functionDeclarations
      requestBody.tools = [
        {
          functionDeclarations: tools.map(t => {
            const fn = t.function || t;
            return {
              name: fn.name,
              description: fn.description || '',
              parameters: fn.parameters || fn.input_schema || { type: 'object', properties: {} }
            };
          })
        }
      ];
      if (forceToolUse) {
        requestBody.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
      }
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    // Access token preferred; some setups use API key as query
    if (token.startsWith('ya29.') || token.length > 40) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      // API key style
      headers['x-goog-api-key'] = token;
    }

    console.log('[VertexAI] POST', url, 'model=', modelId);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal
      });
    } catch (e) {
      throw new Error(`Vertex AI fetch failed: ${e.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('[VertexAI]', response.status, errText.slice(0, 600));
      throw new Error(`Vertex AI Error (${response.status}): ${errText.slice(0, 400)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    // Vertex often returns a JSON array of chunks for streamGenerateContent
    if (contentType.includes('application/json')) {
      const data = await response.json();
      const chunks = Array.isArray(data) ? data : [data];
      let text = '';
      const functionCalls = [];
      for (const chunk of chunks) {
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.text) {
            text += p.text;
            onChunk(p.text);
          }
          if (p.functionCall) {
            functionCalls.push({
              name: p.functionCall.name,
              args: p.functionCall.args || {}
            });
          }
        }
      }
      const rawParts = [];
      if (text) rawParts.push({ text });
      functionCalls.forEach(fc => rawParts.push({ functionCall: fc }));
      return { functionCalls, rawParts };
    }

    // SSE fallback
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let textBuffer = '';
    const functionCalls = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const parts = json.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
              if (p.text) {
                textBuffer += p.text;
                onChunk(p.text);
              }
              if (p.functionCall) {
                functionCalls.push({
                  name: p.functionCall.name,
                  args: p.functionCall.args || {}
                });
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
    const rawParts = [];
    if (textBuffer) rawParts.push({ text: textBuffer });
    functionCalls.forEach(fc => rawParts.push({ functionCall: fc }));
    return { functionCalls, rawParts };
  }

  static async fetchModels(token, meta = {}) {
    const adv = loadAdv();
    const projectId = (adv.projectId || '').trim();
    const location = (adv.location || 'us-central1').trim();
    if (!projectId) {
      throw new Error('Save GCP Project ID in Advanced tab first, then Fetch Models.');
    }

    const host =
      location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${location}-aiplatform.googleapis.com`;
    const path =
      `/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models`;
    const url = `https://${host}${path}`;

    const headers = { 'Content-Type': 'application/json' };
    if (token.startsWith('ya29.') || token.length > 40) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers['x-goog-api-key'] = token;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 403 || res.status === 404) {
        return [
          { id: 'gemini-2.0-flash-001', name: 'gemini-2.0-flash-001', description: 'Gemini 2.0 Flash (fallback)' },
          { id: 'gemini-2.0-flash-lite-001', name: 'gemini-2.0-flash-lite-001', description: 'Flash Lite' },
          { id: 'gemini-1.5-pro-002', name: 'gemini-1.5-pro-002', description: '1.5 Pro' },
          { id: 'gemini-1.5-flash-002', name: 'gemini-1.5-flash-002', description: '1.5 Flash' }
        ];
      }
      throw new Error(`Vertex list models (${res.status}): ${t.slice(0, 250)}`);
    }
    const data = await res.json();
    const models = data.publisherModels || data.models || data || [];
    const arr = Array.isArray(models) ? models : [];
    const mapped = arr
      .map(m => {
        const full = m.name || m.model || '';
        const id = full.split('/').pop() || full;
        return { id, name: id, description: m.displayName || m.versionId || '' };
      })
      .filter(m => m.id);
    if (mapped.length) return mapped.sort((a, b) => a.id.localeCompare(b.id));
    return [
      { id: 'gemini-2.0-flash-001', name: 'gemini-2.0-flash-001', description: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro-002', name: 'gemini-1.5-pro-002', description: '1.5 Pro' }
    ];
  }

  static getDocsHTML() {
    return `
      <div style="padding:12px;font-size:12px;line-height:1.55;color:var(--primary-text-color);">
        <b style="color:#4285f4;">Google Vertex AI</b>
        <p style="margin:8px 0;">Auth is usually an OAuth <b>access token</b> (or API key if enabled). Not the same as AI Studio key-only flow.</p>
        <ol style="padding-left:18px;margin:6px 0;color:var(--secondary-text-color);">
          <li><b>Advanced</b> → Project ID + Location → Save</li>
          <li><b>API Keys</b> → access token / API key</li>
          <li><b>Fetch Models</b> lists publisher models (fallback list if API restricted)</li>
        </ol>
        <p style="margin:8px 0;opacity:0.85;">Token ~1h — refresh on 401.</p>
      </div>`;
  }
}
