// AWS Bedrock Runtime — ConverseStream (SigV4)
import { SYSTEM_INSTRUCTION } from '../SystemPrompt.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { signAwsRequest } from './awsSigV4.js';

function loadAdv() {
  try {
    return JSON.parse(ConfigManager.get('bedrockModelOptions') || '{}') || {};
  } catch (_) {
    return {};
  }
}

function formatMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || m.role === 'system') continue;
    const role = m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user';
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      text = m.content
        .map(p => {
          if (typeof p === 'string') return p;
          if (p?.text) return p.text;
          if (p?.type === 'text') return p.text || '';
          return '';
        })
        .filter(Boolean)
        .join('\n');
    } else if (m.content != null) text = JSON.stringify(m.content);
    if (!text && role === 'assistant') continue;
    out.push({ role, content: [{ text: text || ' ' }] });
  }
  return out;
}

/** Parse Bedrock event-stream (application/vnd.amazon.eventstream) loosely via text chunks */
async function readConverseStream(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let textOut = '';
  const functionCalls = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Event stream embeds JSON payloads; extract message text deltas
      // Pattern: "text":"..." inside contentBlockDelta / message events
      const re = /"delta"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let match;
      while ((match = re.exec(buffer)) !== null) {
        try {
          const piece = JSON.parse(`"${match[1]}"`);
          if (piece) {
            textOut += piece;
            onChunk(piece);
          }
        } catch (_) {}
      }

      // Also try line-oriented JSON if gateway returns NDJSON
      if (buffer.includes('\n')) {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('{')) continue;
          try {
            const j = JSON.parse(t);
            const delta =
              j.contentBlockDelta?.delta?.text ||
              j.delta?.text ||
              j.output?.message?.content?.[0]?.text;
            if (delta) {
              textOut += delta;
              onChunk(delta);
            }
          } catch (_) {}
        }
      }

      // Keep buffer from growing forever — keep last 64KB
      if (buffer.length > 65536) buffer = buffer.slice(-32768);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {}
  }

  const parts = textOut ? [{ text: textOut }] : [];
  return { functionCalls, rawParts: parts };
}

export class Bedrock {
  static async generateStream(options, app, onChunk) {
    const { apiKey, model, messages, signal, tools } = options;
    const adv = loadAdv();

    const accessKeyId = (apiKey || '').trim();
    const secretAccessKey = (adv.secretAccessKey || '').trim();
    const sessionToken = (adv.sessionToken || '').trim();
    const region = (adv.region || 'us-east-1').trim();
    const modelId = (model || adv.defaultModel || 'anthropic.claude-3-5-sonnet-20240620-v1:0').trim();

    if (!accessKeyId) throw new Error('Bedrock: set Access Key ID in API Keys tab.');
    if (!secretAccessKey) {
      throw new Error('Bedrock: set Secret Access Key in Settings → Advanced.');
    }

    const host = `bedrock-runtime.${region}.amazonaws.com`;
    // Prefer converse-stream (unified API)
    const path = `/model/${encodeURIComponent(modelId)}/converse-stream`;
    const url = `https://${host}${path}`;

    let system = [];
    if (tools && tools.length && !app?._piActive) {
      system.push({ text: SYSTEM_INSTRUCTION });
    }
    const systemFromMsgs = (messages || [])
      .filter(m => m?.role === 'system')
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .filter(Boolean);
    systemFromMsgs.forEach(t => system.push({ text: t }));

    const bodyObj = {
      messages: formatMessages(messages),
      inferenceConfig: {
        temperature:
          tools && tools.length
            ? 0.1
            : adv.temperature != null
              ? Number(adv.temperature)
              : 0.7,
        maxTokens: adv.max_tokens != null ? Number(adv.max_tokens) : 4096
      }
    };
    if (system.length) bodyObj.system = system;
    if (adv.top_p != null) bodyObj.inferenceConfig.topP = Number(adv.top_p);

    // Map OpenAI-style tools → Bedrock toolConfig (basic)
    if (tools && tools.length) {
      bodyObj.toolConfig = {
        tools: tools.map(t => {
          const fn = t.function || t;
          return {
            toolSpec: {
              name: fn.name,
              description: fn.description || '',
              inputSchema: {
                json: fn.parameters || fn.input_schema || { type: 'object', properties: {} }
              }
            }
          };
        })
      };
    }

    const body = JSON.stringify(bodyObj);
    console.log('[Bedrock] POST', url, 'model=', modelId, 'region=', region);

    const headers = await signAwsRequest({
      method: 'POST',
      service: 'bedrock-runtime',
      region,
      host,
      path,
      body,
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined
    });

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal
      });
    } catch (e) {
      throw new Error(
        `Bedrock fetch failed: ${e.message}. Check network/CORS — some WebViews block bedrock-runtime.*.amazonaws.com.`
      );
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Bedrock] error', response.status, errText.slice(0, 500));
      throw new Error(`Bedrock Error (${response.status}): ${errText.slice(0, 400)}`);
    }

    return readConverseStream(response, onChunk);
  }

  static async fetchModels(accessKeyId, meta = {}) {
    const adv = loadAdv();
    const secretAccessKey = (adv.secretAccessKey || '').trim();
    const sessionToken = (adv.sessionToken || '').trim();
    const region = (adv.region || 'us-east-1').trim();
    if (!secretAccessKey) {
      throw new Error('Save Secret Access Key in Advanced tab first, then Fetch Models.');
    }

    const host = `bedrock.${region}.amazonaws.com`;
    const path = '/foundation-models';
    const url = `https://${host}${path}`;
    const headers = await signAwsRequest({
      method: 'GET',
      service: 'bedrock',
      region,
      host,
      path,
      body: '',
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined,
      extraHeaders: { accept: 'application/json' }
    });
    delete headers['content-type'];

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Bedrock list models (${res.status}): ${t.slice(0, 250)}`);
    }
    const data = await res.json();
    const models = data.modelSummaries || data.models || [];
    return models
      .map(m => ({
        id: m.modelId || m.modelArn,
        name: m.modelId || m.modelName,
        description: [m.providerName, m.modelLifecycle?.status].filter(Boolean).join(' · ')
      }))
      .filter(m => m.id)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  static getDocsHTML() {
    return `
      <div style="padding:12px;font-size:12px;line-height:1.55;color:var(--primary-text-color);">
        <b style="color:#ff9900;">AWS Bedrock</b>
        <p style="margin:8px 0;">Uses <code>ConverseStream</code> with SigV4. Credentials are <b>IAM Access Key ID + Secret</b> (not a Bedrock-only API key product).</p>
        <ol style="padding-left:18px;margin:6px 0;color:var(--secondary-text-color);">
          <li><b>API Keys</b> → Access Key ID</li>
          <li><b>Advanced</b> → Secret + Region → <b>Save</b></li>
          <li><b>Fetch Models</b> → ListFoundationModels</li>
          <li>Or type model id in <b>Manual</b></li>
        </ol>
        <p style="margin:8px 0;opacity:0.85;">IAM: InvokeModel* + ListFoundationModels. Enable models in Bedrock console.</p>
      </div>`;
  }
}
