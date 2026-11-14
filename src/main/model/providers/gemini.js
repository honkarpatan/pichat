import { getSystemInstruction, SYSTEM_INSTRUCTION } from "../SystemPrompt.js"
import { useBrowser2 } from '../../handler/SearchEvaluator.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { fetchWithRateLimitRetry } from '../../utils/network/RateLimitRetry.js';

function loadAdv() {
    try {
        return JSON.parse(ConfigManager.get('geminiModelOptions') || '{}') || {};
    } catch (_) {
        return {};
    }
}


/**
 * Gemini requires every ARRAY schema to include `items`.
 * Walks parameters / functionDeclarations and fills gaps (incl. nested options/tasks/edits).
 */
function ensureArrayItems(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return node;
  if (Array.isArray(node)) {
    node.forEach((x) => ensureArrayItems(x, depth + 1));
    return node;
  }
  const type = String(node.type || '').toUpperCase();
  const looksArray =
    type === 'ARRAY' ||
    type === 'LIST' ||
    // property named like an array but type omitted
    (node.items != null && type && type !== 'OBJECT' && type !== 'STRING' && type !== 'NUMBER' && type !== 'BOOLEAN' && type !== 'INTEGER');

  if (type === 'ARRAY' || type === 'LIST') {
    if (!node.items || typeof node.items !== 'object') {
      node.items = { type: 'STRING' };
    }
  }
  // Missing type but has no items while sibling schema expected ARRAY — leave alone

  if (node.items) ensureArrayItems(node.items, depth + 1);
  if (node.properties && typeof node.properties === 'object') {
    for (const [key, val] of Object.entries(node.properties)) {
      if (!val || typeof val !== 'object') continue;
      const vt = String(val.type || '').toUpperCase();
      // Known array-shaped property names Gemini complains about when items is missing
      if (
        (vt === 'ARRAY' || vt === 'LIST' || (!vt && /^(tasks|items|edits|options|questions|names|paths|files|entries|args)$/i.test(key)))
      ) {
        if (!val.type) val.type = 'ARRAY';
        if (!val.items || typeof val.items !== 'object') {
          // sensible defaults by key
          if (/^(options|questions|edits|items)$/i.test(key)) {
            val.items = {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
                label: { type: 'STRING' },
                status: { type: 'STRING' },
                search: { type: 'STRING' },
                replace: { type: 'STRING' },
                description: { type: 'STRING' }
              }
            };
          } else {
            val.items = { type: 'STRING' };
          }
        }
      }
      ensureArrayItems(val, depth + 1);
    }
  }
  if (Array.isArray(node.functionDeclarations)) {
    node.functionDeclarations.forEach((fd) => {
      if (fd?.parameters) ensureArrayItems(fd.parameters, depth + 1);
    });
  }
  // OpenAI-style { function: { parameters } }
  if (node.function?.parameters) ensureArrayItems(node.function.parameters, depth + 1);
  return node;
}

/** Deep-clone tools payload then sanitize for Gemini API. */
function sanitizeGeminiTools(tools) {
  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(tools || []));
  } catch (_) {
    cloned = Array.isArray(tools) ? tools.slice() : [];
  }
  if (Array.isArray(cloned)) cloned.forEach((block) => ensureArrayItems(block));
  else ensureArrayItems(cloned);
  return cloned;
}

export class Gemini {
    static formatMessages(messages) {
        const formatted = messages
            .filter(msg => {
                if (msg.role === 'system') {
                    console.warn('[Gemini] Dropped a system-role message in formatMessages() — route it via systemText/systemInstruction instead.');
                    return false;
                }
                return true;
            })
            .map(msg => {
                const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
                
                let parts = [];
                if (Array.isArray(msg.content)) {
                    parts = msg.content;
                } else {
                    parts = [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }];
                }

                return { role, parts };
            });

        const merged = [];
        for (const msg of formatted) {
            const last = merged[merged.length - 1];
            if (last && last.role === msg.role) {
                last.parts = [...last.parts, ...msg.parts];
            } else {
                merged.push({ role: msg.role, parts: [...msg.parts] });
            }
        }
        
        return merged;
    }

    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools, forceToolUse, maxOutputTokensOverride, disableThinking, allowedFunctionNames } = options;
        const geminiFormatData = this.formatMessages(messages);
        
        const cleanModelId = model.replace('models/', '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:streamGenerateContent?alt=sse&key=${apiKey}`;

        const adv = loadAdv();
        const hasTools = tools && tools.length > 0;
        let requestBody = {
            contents: geminiFormatData,
            generationConfig: {
                temperature: hasTools ? 0.1 : (adv.temperature != null ? Number(adv.temperature) : 0.7)
            }
        };
        if (adv.topP != null) requestBody.generationConfig.topP = Number(adv.topP);
        if (adv.topK != null) requestBody.generationConfig.topK = Number(adv.topK);
        const GEMINI_OUT_CAP = 8192;
        if (adv.maxOutputTokens != null) {
            requestBody.generationConfig.maxOutputTokens = Math.min(Number(adv.maxOutputTokens), GEMINI_OUT_CAP);
        } else if (maxOutputTokensOverride) {
            requestBody.generationConfig.maxOutputTokens = Math.min(Number(maxOutputTokensOverride), GEMINI_OUT_CAP);
        } else {
            requestBody.generationConfig.maxOutputTokens = GEMINI_OUT_CAP;
        }
        if (adv.candidateCount != null) requestBody.generationConfig.candidateCount = Number(adv.candidateCount);
        if (adv.presencePenalty != null) requestBody.generationConfig.presencePenalty = Number(adv.presencePenalty);
        if (adv.frequencyPenalty != null) requestBody.generationConfig.frequencyPenalty = Number(adv.frequencyPenalty);
        if (adv.responseMimeType && adv.responseMimeType !== 'text/plain') {
            requestBody.generationConfig.responseMimeType = adv.responseMimeType;
        }

        if (!disableThinking && app.chatInputUI && app.chatInputUI.states.think) {
            requestBody.generationConfig.thinkingConfig = {
                thinkingLevel: app.chatInputUI.states.thinkLevel || "HIGH"
            };
        }
        
        requestBody.systemInstruction = {
            role: "user",
            parts: [{ text: getSystemInstruction(app) }]
        };

        const preferNativeWeb = !!(app.isEnableWebBrowsing && !useBrowser2(app, { internal_web_browsing: true }));
        if (preferNativeWeb) {
            requestBody.tools = [{ googleSearch: {} }];
        }

        if (tools && tools.length > 0) {
            const agentTools = Array.isArray(tools) ? tools.slice() : [];
            if (preferNativeWeb && !agentTools.some((x) => x && x.googleSearch)) {
                agentTools.unshift({ googleSearch: {} });
            }
            // Gemini rejects ARRAY properties without `items` (deep sanitize + clone)
            requestBody.tools = sanitizeGeminiTools(agentTools);
            
            if (!requestBody.safetySettings) {
                requestBody.safetySettings = [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
                ];
            }

            if (forceToolUse) {
                const decls = requestBody.tools?.[0]?.functionDeclarations || [];
                const declNames = new Set(decls.map(d => d && d.name).filter(Boolean));
                let allowed = Array.isArray(allowedFunctionNames) && allowedFunctionNames.length
                    ? allowedFunctionNames.slice()
                    : ['write', 'str_replace'];
                allowed = allowed.filter(n => declNames.has(n));
                if (!allowed.length && declNames.has('write')) allowed = ['write'];
                else if (!allowed.length) allowed = [...declNames].slice(0, 2);

                if (requestBody.tools[0] && requestBody.tools[0].functionDeclarations) {
                    requestBody.tools[0].functionDeclarations =
                        requestBody.tools[0].functionDeclarations.filter(t => allowed.includes(t.name));
                }
                
                // NO toolConfig overrides here. The previous mode: 'ANY' caused 
                // massive token burns during constrained decoding. Relying entirely 
                // on pruning the functionDeclarations instead.
            }
        }

        const response = await fetchWithRateLimitRetry(
            () => fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
                signal
            }),
            { signal, maxAttempts: 6, app, provider: 'gemini' }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Gemini API Error (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const collectedParts = []; 
        let usageMetadata = null; 
        let blockReason = null;   
        let finishReason = null;  
        let safetyRatings = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            
            chunk.split("\n").forEach(line => {
                if (!line.startsWith("data:")) return;
                try {
                    const json = JSON.parse(line.slice(5));
                    if (json.promptFeedback?.blockReason) {
                        blockReason = json.promptFeedback.blockReason;
                        safetyRatings = json.promptFeedback.safetyRatings || safetyRatings;
                    }
                    const parts = json.candidates?.[0]?.content?.parts || [];
                    parts.forEach(p => {
                        if (p.text) onChunk(p.text);
                        collectedParts.push(p);
                    });
                    if (json.candidates?.[0]?.finishReason) {
                        finishReason = json.candidates[0].finishReason;
                        safetyRatings = json.candidates[0].safetyRatings || safetyRatings;
                    }
                    if (json.usageMetadata) usageMetadata = json.usageMetadata;
                } catch (e) {}
            });
        }

        const functionCalls = collectedParts
            .filter(p => p.functionCall)
            .map(p => ({
                ...p.functionCall,
                id: p.functionCall.id || p.id 
            }));

        if (app?.usageManager && usageMetadata) {
            app.usageManager.recordUsage('gemini', usageMetadata.promptTokenCount || 0, usageMetadata.candidatesTokenCount || 0, { estimated: false });
            app._lastRequestUsageRecorded = true;
        }

        // Data-driven diagnostic log for ALL empty outputs
        if (!collectedParts.length) {
            const kind = blockReason ? 'CONTENT-POLICY BLOCK'
                : finishReason === 'MAX_TOKENS' ? 'TRUNCATED (ran out of output tokens)'
                : finishReason === 'STOP' ? 'STOP WITH ZERO PARTS (no text, no tool call)'
                : 'STOPPED EARLY';
            console.warn(`[Gemini] EMPTY OUTPUT [${kind}] — blockReason=`, blockReason,
                'finishReason=', finishReason, 'safetyRatings=', safetyRatings,
                'usage=', usageMetadata);
        }

        return {
            functionCalls: functionCalls,
            rawParts: collectedParts,
            blockReason,
            finishReason,
            usage: usageMetadata ? { input_tokens: usageMetadata.promptTokenCount, output_tokens: usageMetadata.candidatesTokenCount } : null
        };
    }
    
    static async generateImage(prompt, apiKey, modelId) {
        const cleanModelId = modelId.replace('models/', '');
        const endpointModel = cleanModelId || 'imagen-3.0-generate-001';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${endpointModel}:predict?key=${apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt: prompt }],
                parameters: { sampleCount: 1, outputOptions: { mimeType: "image/jpeg" } }
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "Failed to generate image with Gemini");
        }

        const data = await response.json();
        if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64) {
            return `data:image/jpeg;base64,${data.predictions[0].bytesBase64}`;
        }
        throw new Error("No image data found in response.");
    }
    
    static async fetchModels(apiKey) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            if (!data.models) return [];
            const validModels = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
            return validModels.map(m => {
                const id = (m.name || '').replace(/^models\//, '');
                return {
                  id,
                  name: m.displayName || id,
                  description: m.description || 'Gemini Model',
                  contextLength: m.inputTokenLimit != null ? Number(m.inputTokenLimit) : null,
                  maxOutput: m.outputTokenLimit != null ? Number(m.outputTokenLimit) : null,
                  supportsTools: true
                };
            });
        } catch (error) {
            console.error("Gemini Fetch Models Error:", error);
            throw error; 
        }
    }
    
    static async generateTitle(prompt, apiKey, modelId) {
        const cleanModelId = modelId.replace('models/', '');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text;
    }
  
    static getDocsHTML() {
        return `
        <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 320px; scrollbar-width: thin;">
            <div style="background: rgba(75, 93, 209, 0.1); border-left: 3px solid var(--active-color, #4b5dd1); padding: 10px; border-radius: 0 6px 6px 0; margin-bottom: 15px;">
                <b style="color: var(--active-text-color, #4b5dd1); font-size: 13px;">⚙ How Custom API Works (Magic Placeholders)</b>
                <p style="margin: 6px 0 4px 0; font-size: 11px; color: var(--primary-text-color);">Do <b>NOT</b> manually type your chat messages or API keys in the JSON payload. Use these placeholders:</p>
                <ul style="margin: 0; padding-left: 15px; font-size: 10.5px; color: var(--secondary-text-color);">
                    <li><code style="color:#4caf50;">{{API_KEY}}</code> : Injects your saved Gemini API Key.</li>
                    <li><code style="color:#4caf50;">{{MODEL_ID}}</code> : Injects your selected Model ID.</li>
                    <li><code style="color:#f44; font-weight:bold;">"{{MESSAGES}}"</code> : <b>CRITICAL!</b> Leave this as is. The app replaces this with chat history.</li>
                </ul>
            </div>
            <a href="https://ai.google.dev/api/rest/v1beta/models/generateContent" target="_blank" style="color: var(--active-text-color); text-decoration: none; font-weight: bold; font-size: 11px;">Official Gemini API Documentation ↗</a>
        </div>
        `;
    }
}