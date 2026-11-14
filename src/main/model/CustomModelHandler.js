// src/main/core/model/CustomModelHandler.js
import { ConfigManager } from '../utils/ConfigManager.js';
import { CustomModelManager } from './CustomModelManager.js';

/**
 * Custom model stream — supports OpenAI-compatible + Gemini-style payloads.
 * Placeholders: {{API_KEY}} {{MODEL_ID}} "{{MESSAGES}}"
 */

const TAG = '[CustomModelHandler]';

function maskSecrets(str) {
  return String(str || '')
    .replace(/([?&]key=)[^&\s"']+/gi, '$1***')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
    .replace(/(x-api-key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1***');
}

function formatMessagesOpenAI(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(m => {
    const role = m.role === 'model' ? 'assistant' : (m.role || 'user');
    let content = m.content;
    if (Array.isArray(content)) {
      content = content.map(p => {
        if (typeof p === 'string') return p;
        if (p?.text) return p.text;
        if (p?.type === 'text') return p.text || '';
        return '';
      }).filter(Boolean).join('\n');
    }
    if (content == null) content = '';
    const out = { role, content: typeof content === 'string' ? content : JSON.stringify(content) };
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    return out;
  });
}

/** Gemini REST: { role, parts: [{ text }] } — drop system role */
function formatMessagesGemini(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
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
      const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
      return { role, parts: [{ text }] };
    });
}

function isGeminiStylePayload(url, body) {
  const u = String(url || '').toLowerCase();
  if (u.includes('generativelanguage.googleapis.com') || u.includes('gemini')) return true;
  if (body && (body.contents != null || body.generationConfig != null)) return true;
  return false;
}

function loadPayloadConfig(modelType, apiKey, modelId, messages, tools) {
  let customJsonStr =
    ConfigManager.get(`${modelType}CustomPayload_primary`) ||
    ConfigManager.get(`${modelType}CustomPayload`);
  if (!customJsonStr) {
    throw new Error(
      'No Custom API payload for this model. Open Settings → Custom API and set url/headers/body.'
    );
  }

  console.log(TAG, 'raw payload template (secrets masked):\n', maskSecrets(customJsonStr).slice(0, 800));

  // Detect Gemini before replacing MESSAGES so we format correctly
  const looksGemini =
    /generativelanguage\.googleapis\.com/i.test(customJsonStr) ||
    /"contents"\s*:/.test(customJsonStr);

  const historyData = looksGemini
    ? formatMessagesGemini(messages)
    : formatMessagesOpenAI(messages);

  customJsonStr = customJsonStr
    .replace(/{{API_KEY}}/g, apiKey || '')
    .replace(/{{MODEL_ID}}/g, modelId || '');

  customJsonStr = customJsonStr.replace(/"{{MESSAGES}}"/g, JSON.stringify(historyData));
  if (customJsonStr.includes('{{MESSAGES}}')) {
    customJsonStr = customJsonStr.replace(/{{MESSAGES}}/g, JSON.stringify(historyData));
  }

  let reqConfig;
  try {
    reqConfig = JSON.parse(customJsonStr);
  } catch (e) {
    console.error(TAG, 'JSON parse failed after placeholder replace', e);
    throw new Error('Invalid JSON in Custom API settings. Check syntax.');
  }
  if (!reqConfig.url) throw new Error('Custom API payload must include "url".');

  const gemini = isGeminiStylePayload(reqConfig.url, reqConfig.body);

  if (!reqConfig.body || typeof reqConfig.body !== 'object') {
    reqConfig.body = gemini
      ? { contents: historyData, generationConfig: { temperature: 0.7 } }
      : { model: modelId, messages: historyData, stream: true };
  }

  if (gemini) {
    // Gemini uses contents — never inject OpenAI "messages"
    if (!reqConfig.body.contents) reqConfig.body.contents = historyData;
    delete reqConfig.body.messages;
    delete reqConfig.body.stream; // Gemini stream is via URL alt=sse
    if (tools && tools.length) {
      reqConfig.body.tools = tools;
    }
  } else {
    if (!reqConfig.body.messages) reqConfig.body.messages = historyData;
    if (tools && tools.length) {
      reqConfig.body.tools = tools;
      if (reqConfig.body.tool_choice == null) reqConfig.body.tool_choice = 'auto';
    }
    if (reqConfig.body.stream == null) reqConfig.body.stream = true;
  }

  return { reqConfig, gemini, historyLen: historyData.length };
}

export const CustomModelHandler = {
  /**
   * @param {object} options — { apiKey, model, messages, signal, tools, forceToolUse }
   * @param {object} app
   * @param {(chunk: string) => void} onChunk
   * @returns {Promise<{ functionCalls: any[], rawParts: any[] }>}
   */
  async generateStream(options, app, onChunk) {
    const modelType = app?.selectedModel?.type;
    if (!modelType) throw new Error('No model type selected.');

    const apiKey = options.apiKey || (ConfigManager.get(`${modelType}ApiKey`) || '');
    const modelId = options.model || (ConfigManager.get(`${modelType}Model`) || '');
    const messages = options.messages || [];
    const tools = options.tools || null;
    const signal = options.signal || app?.currentRequestController?.signal;

    const { reqConfig, gemini, historyLen } = loadPayloadConfig(
      modelType, apiKey, modelId, messages, tools
    );
    if (!gemini && tools && tools.length && options.forceToolUse) {
      reqConfig.body.tool_choice = 'required';
    }

    // Think / power level from input bar (cloned Gemini HIGH/MEDIUM/LOW, OpenAI effort, …)
    if (app?.chatInputUI?.states?.think) {
      const level = app.chatInputUI.states.thinkLevel || 'HIGH';
      if (gemini) {
        if (!reqConfig.body.generationConfig) reqConfig.body.generationConfig = {};
        reqConfig.body.generationConfig.thinkingConfig = {
          thinkingLevel: String(level).toUpperCase()
        };
        console.log(TAG, 'Gemini thinkingConfig.thinkingLevel=', String(level).toUpperCase());
      } else {
        const low = String(level).toLowerCase();
        if (['low', 'medium', 'high'].includes(low)) {
          reqConfig.body.reasoning_effort = low;
          console.log(TAG, 'reasoning_effort=', low);
        } else if (['ON', 'OFF'].includes(String(level).toUpperCase())) {
          reqConfig.body.thinking = {
            type: String(level).toUpperCase() === 'OFF' ? 'disabled' : 'enabled'
          };
        }
      }
    }

    const headers = reqConfig.headers || { 'Content-Type': 'application/json' };
    const bodyStr = JSON.stringify(reqConfig.body);
    const safeUrl = maskSecrets(reqConfig.url);
    const safeHeaders = JSON.parse(maskSecrets(JSON.stringify(headers)));

    console.log(TAG, '──────── outgoing request ────────');
    console.log(TAG, 'modelType=', modelType, '| modelId=', modelId, '| geminiStyle=', gemini);
    console.log(TAG, 'apiKey present=', !!(apiKey && String(apiKey).trim()), '| len=', (apiKey || '').length);
    console.log(TAG, 'URL=', safeUrl);
    console.log(TAG, 'headers=', safeHeaders);
    console.log(TAG, 'messages/contents count=', historyLen, '| body bytes=', bodyStr.length);
    console.log(TAG, 'body preview=\n', maskSecrets(bodyStr).slice(0, 1200));
    console.log(TAG, '──────────────────────────────────');

    let response;
    try {
      response = await fetch(reqConfig.url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal
      });
    } catch (netErr) {
      // Failed to fetch = network / CORS / cleartext / DNS — not an HTTP error status
      console.error(TAG, 'fetch threw', netErr?.name, netErr?.message, netErr);
      console.error(TAG, 'failed URL was:', safeUrl);
      const hint = gemini
        ? ' Gemini from WebView sometimes needs the built-in Gemini model (not custom clone) if CORS blocks generativelanguage.googleapis.com. Check API key is set on this custom model, model id (e.g. gemini-2.0-flash), and URL has ?alt=sse&key=…'
        : ' Check URL, HTTPS, CORS, and that the device can reach the host.';
      throw new Error(
        `Failed to fetch → ${netErr?.message || netErr}\nURL: ${safeUrl}\n${hint}`
      );
    }

    console.log(TAG, 'response status=', response.status, response.statusText,
      '| content-type=', response.headers.get('content-type'));

    if (!response.ok) {
      const errText = await response.text();
      console.error(TAG, 'error body=', errText.slice(0, 800));
      throw new Error(`Custom API Error (${response.status}): ${errText.slice(0, 500)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const data = await response.json();
      // Gemini non-stream
      if (data.candidates?.[0]?.content?.parts) {
        const text = data.candidates[0].content.parts.map(p => p.text || '').join('');
        if (text) onChunk(text);
        const fcs = [];
        data.candidates[0].content.parts.forEach(p => {
          if (p.functionCall) fcs.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
        });
        return { functionCalls: fcs, rawParts: text ? [{ text }, ...fcs.map(fc => ({ functionCall: fc }))] : fcs.map(fc => ({ functionCall: fc })) };
      }
      const msg = data.choices?.[0]?.message || data.message || {};
      const content = msg.content || data.response || '';
      if (content) onChunk(content);

      const toolCalls = msg.tool_calls || [];
      const parsedFunctionCalls = (toolCalls || []).map(tc => {
        let args = {};
        try {
          args = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {});
        } catch (_) {}
        return { id: tc.id, name: tc.function?.name || tc.name, args };
      });
      const parts = [];
      if (content) parts.push({ text: content });
      parsedFunctionCalls.forEach(fc => parts.push({ functionCall: fc }));
      return { functionCalls: parsedFunctionCalls, rawParts: parts };
    }

    // SSE stream (OpenAI-style)
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const currentToolCalls = {};
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
          if (!trimmed) continue;

          // Ollama non-SSE JSON lines
          if (trimmed.startsWith('{') && !trimmed.startsWith('data:')) {
            try {
              const json = JSON.parse(trimmed);
              const piece = json.message?.content || json.response || json.choices?.[0]?.delta?.content;
              if (piece) {
                textBuffer += piece;
                onChunk(piece);
              }
            } catch (_) {}
            continue;
          }

          if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
            try {
              const json = JSON.parse(trimmed.slice(5).trim());
              // Gemini SSE: candidates[].content.parts[].text
              const gParts = json.candidates?.[0]?.content?.parts;
              if (gParts) {
                for (const p of gParts) {
                  if (p.text) {
                    textBuffer += p.text;
                    onChunk(p.text);
                  }
                  if (p.functionCall) {
                    const idx = Object.keys(currentToolCalls).length;
                    currentToolCalls[idx] = {
                      id: `gfc_${idx}`,
                      name: p.functionCall.name || '',
                      argsString: JSON.stringify(p.functionCall.args || {})
                    };
                  }
                }
                continue;
              }
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
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }

    const parsedFunctionCalls = Object.values(currentToolCalls).map(tc => {
      let args = {};
      try { args = JSON.parse(tc.argsString || '{}'); } catch (_) {}
      return { id: tc.id, name: tc.name, args };
    });
    const parts = [];
    if (textBuffer) parts.push({ text: textBuffer });
    parsedFunctionCalls.forEach(fc => parts.push({ functionCall: fc }));
    return { functionCalls: parsedFunctionCalls, rawParts: parts };
  },

  getDocsHTML() {
    return `
        <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.6;">
            <b style="font-size:13px; color:#4b5dd1;">Custom model</b>
            <p style="margin:8px 0;">Endpoint comes from the <b>Custom API</b> tab. Placeholders: <code>{{API_KEY}}</code>, <code>{{MODEL_ID}}</code>, <code>"{{MESSAGES}}"</code>.</p>
            <p style="margin:8px 0; opacity:0.8;">Write your own docs in <b>Manager</b> — they appear on this Docs tab.</p>
        </div>`;
  },

  renderManagerTab(container, app, ctx) {
    const def = CustomModelManager.get(ctx.modelType);
    if (!def) return;

    const esc = (s) => String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const editableConfig = {
      name: def.name || 'Custom Model',
      image: def.image || '',
      imageBg: def.imageBg || '#4b5dd1',
      level: def.level || 'standard',
      capabilities: def.capabilities || {
        supportsImages: false,
        supportsFiles: false,
        supportsWeb: false,
        supportsThink: false,
        supportsStudyMode: true,
        supportsTools: true,
        supportsProject: true
      }
    };

    const jsonStr = JSON.stringify(editableConfig, null, 4);
    const docsVal = def.docsHtml || '';

    container.innerHTML = `
            <div style="padding: 12px; height: 100%; display: flex; flex-direction: column; gap:10px; overflow:auto;">
                <p style="font-size:11px; color:#888; margin:0;">
                    Identity JSON + Docs. <code>supportsTools: true</code> enables Agent mode on OpenAI-compatible APIs.
                </p>
                <label class="gpt-field-label">Config JSON</label>
                <textarea id="edit-cm-json" class="gpt-textarea" spellcheck="false" style="height:140px;font-family:monospace;font-size:11px;color:#4caf50;">${esc(jsonStr)}</textarea>
                <label class="gpt-field-label">Docs (HTML)</label>
                <textarea id="edit-cm-docs" class="gpt-textarea" spellcheck="false" style="height:120px;font-size:12px;" placeholder="Your notes about this API…">${esc(docsVal)}</textarea>
                <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:12px; border-top:1px solid var(--border-color);">
                    <button id="cm-delete-btn" type="button" class="gpt-ui-btn" style="color:#f44336;border-color:rgba(244,67,54,.35);">Delete</button>
                    <button id="cm-update-btn" type="button" class="gpt-ui-btn gpt-ui-btn-primary">Save</button>
                </div>
            </div>
        `;

    container.querySelector('#cm-update-btn').onclick = async () => {
      const jsonText = container.querySelector('#edit-cm-json').value;
      const docsHtml = container.querySelector('#edit-cm-docs').value;
      try {
        const parsed = JSON.parse(jsonText);
        def.name = parsed.name || def.name;
        def.image = parsed.image || def.image;
        def.imageBg = parsed.imageBg || def.imageBg;
        def.level = parsed.level || def.level;
        def.capabilities = parsed.capabilities || def.capabilities;
        def.docsHtml = docsHtml;
        CustomModelManager.save(def);
        await CustomModelManager.refreshSidebar(app);
        window.toast('Custom model updated');
      } catch (e) {
        window.toast('Invalid JSON format');
      }
    };

    container.querySelector('#cm-delete-btn').onclick = () => {
      ctx.confirmThenRun(`Delete "${def.name}" permanently?`, async () => {
        CustomModelManager.remove(ctx.modelType, app);
        await CustomModelManager.refreshSidebar(app);
        window.toast(`Deleted "${def.name}"`);
        document.querySelector('.generic-settings-modal .modal-close-btn')?.click();
      });
    };
  }
};
