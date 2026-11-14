// src/main/core/handler/ApiRouter.js
import { ConfigManager } from '../utils/ConfigManager.js';
import { AgentRunner } from '../agent/main/AgentLoop.js';
import { ApiKeyManager } from '../model/ApiKeyManager.js';

const TAG = '[ApiRouter]';

function maskSecrets(str) {
    return String(str || '')
        .replace(/([?&]key=)[^&\s"']+/gi, '$1***')
        .replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
        .replace(/(x-api-key["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1***');
}

export class ApiRouter {
    static async route(app, config, modelType, apiMessages, onChunk) {
        if (!config) throw new Error(`Integration for ${modelType} stream is missing.`);

        return await ApiKeyManager.runWithFailover(app, config, modelType, async () => {
            const isCustomFlag =
                ConfigManager.get(`${modelType}UseCustomApi_primary`) === 'true' ||
                ConfigManager.get(`${modelType}UseCustomApi`) === 'true';
            const isPureCustom = !!config.isCustomModel;
            const needsAgentTools =
                (app.isEnableAgentMode || app.isEnableStudyMode) && !!config.supportsTools;

            console.log(TAG, 'route decision', {
                modelType,
                isCustomFlag,
                isPureCustom,
                agent: !!app.isEnableAgentMode,
                study: !!app.isEnableStudyMode,
                supportsTools: !!config.supportsTools,
                needsAgentTools,
                handler: config.handler?.name || config.handler?.generateStream ? 'has generateStream' : 'no handler'
            });

            // User-created custom_* models always use CustomModelHandler via AgentRunner
            // (same path for normal chat + agent). Never the old _tryCustomApi-only path.
            if (isPureCustom) {
                console.log(TAG, '→ PATH: AgentRunner (pure custom model / CustomModelHandler)');
                return await AgentRunner.route(app, config, modelType, apiMessages, onChunk);
            }

            // Built-in model with "Override payload" — only for non-agent turns
            if (isCustomFlag && !needsAgentTools) {
                console.log(TAG, '→ PATH: _tryCustomApi (built-in model custom payload override)');
                const customResult = await ApiRouter._tryCustomApi(app, config, modelType, apiMessages, onChunk);
                if (customResult !== undefined) return customResult;
                console.log(TAG, '_tryCustomApi returned undefined (no payload) → fall through AgentRunner');
            } else if (isCustomFlag && needsAgentTools) {
                console.log(TAG, '→ PATH: AgentRunner (Agent/Study ON — skip custom override for tools)');
            } else {
                console.log(TAG, '→ PATH: AgentRunner (built-in handler)');
            }

            return await AgentRunner.route(app, config, modelType, apiMessages, onChunk);
        });
    }

    /**
     * Built-in model custom JSON payload path.
     * @returns null on success, undefined if no payload (caller falls through)
     */
    static async _tryCustomApi(app, config, modelType, apiMessages, onChunk) {
        let customJsonStr =
            ConfigManager.get(`${modelType}CustomPayload_primary`) ||
            ConfigManager.get(`${modelType}CustomPayload`);
        if (!customJsonStr) {
            console.log(TAG, '_tryCustomApi: no payload string for', modelType);
            return undefined;
        }

        const apiKey = config.apiKeyName ? ConfigManager.get(config.apiKeyName) : '';
        let modelId = config.modelKeyName ? ConfigManager.get(config.modelKeyName) : '';
        if ((modelType === 'gemini' || /gemini/i.test(modelType)) && modelId) {
            modelId = String(modelId).replace(/^models\//, '');
        }

        const looksGemini =
            /generativelanguage\.googleapis\.com/i.test(customJsonStr) ||
            /"contents"\s*:/.test(customJsonStr);

        let historyData;
        if (looksGemini) {
            // Gemini shape — do not use OpenAI messages if handler only has formatMessages for gemini
            if (config.handler?.formatMessages) {
                historyData = config.handler.formatMessages(apiMessages);
            } else {
                historyData = (apiMessages || [])
                    .filter(m => m && m.role !== 'system')
                    .map(m => {
                        const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
                        let text = '';
                        if (typeof m.content === 'string') text = m.content;
                        else if (Array.isArray(m.content)) {
                            text = m.content.map(p => p?.text || '').filter(Boolean).join('\n');
                        } else if (m.content != null) text = JSON.stringify(m.content);
                        return { role, parts: [{ text }] };
                    });
            }
        } else {
            historyData = config.handler?.formatMessages
                ? config.handler.formatMessages(apiMessages)
                : apiMessages;
        }

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
            console.error(TAG, 'Invalid custom JSON', e);
            throw new Error('Invalid JSON in Custom API settings. Check syntax.');
        }

        if (!reqConfig.url) throw new Error('Custom API payload must include "url".');

        // Gemini body cleanup
        if (looksGemini && reqConfig.body) {
            if (!reqConfig.body.contents) reqConfig.body.contents = historyData;
            delete reqConfig.body.messages;
            delete reqConfig.body.stream;
        }

        const headers = reqConfig.headers || { 'Content-Type': 'application/json' };
        const bodyStr = JSON.stringify(reqConfig.body);
        const safeUrl = maskSecrets(reqConfig.url);

        console.log(TAG, '──────── _tryCustomApi request ────────');
        console.log(TAG, 'modelType=', modelType, '| modelId=', modelId, '| gemini=', looksGemini);
        console.log(TAG, 'apiKey present=', !!(apiKey && String(apiKey).trim()), '| len=', (apiKey || '').length);
        console.log(TAG, 'URL=', safeUrl);
        console.log(TAG, 'headers=', JSON.parse(maskSecrets(JSON.stringify(headers))));
        console.log(TAG, 'body bytes=', bodyStr.length);
        console.log(TAG, 'body preview=\n', maskSecrets(bodyStr).slice(0, 1200));
        console.log(TAG, '───────────────────────────────────────');

        let response;
        try {
            response = await fetch(reqConfig.url, {
                method: 'POST',
                headers,
                body: bodyStr,
                signal: app.currentRequestController?.signal
            });
        } catch (netErr) {
            console.error(TAG, 'fetch threw', netErr?.name, netErr?.message);
            console.error(TAG, 'failed URL=', safeUrl);
            throw new Error(
                `Failed to fetch → ${netErr?.message || netErr}\nURL: ${safeUrl}\n` +
                (looksGemini
                    ? 'Gemini custom: set API key + model id on this model; URL must include alt=sse&key=…'
                    : 'Check URL / HTTPS / network.')
            );
        }

        console.log(TAG, 'response status=', response.status, response.statusText,
            '| ct=', response.headers.get('content-type'));

        if (!response.ok) {
            const errText = await response.text();
            console.error(TAG, 'error body=', errText.slice(0, 800));
            throw new Error(`Custom API Error (${response.status}): ${errText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
            const json = await response.json();
            let content = json.choices?.[0]?.message?.content || json.choices?.[0]?.text;
            if (!content && json.candidates?.length) {
                content = json.candidates[0].content?.parts?.map(p => p.text).join('') || '';
            }
            if (!content) content = json.message?.content || json.response;
            if (content) onChunk(content);
            return null;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
                    try {
                        const json = JSON.parse(trimmed.slice(5).trim());
                        let content = json.choices?.[0]?.delta?.content;
                        if (!content && json.candidates?.length) {
                            content = json.candidates[0].content?.parts?.map(p => p.text).join('') || '';
                        }
                        if (content) onChunk(content);
                    } catch (e) {}
                } else if (trimmed.startsWith('{') && (trimmed.includes('"message"') || trimmed.includes('"response"'))) {
                    try {
                        const json = JSON.parse(trimmed);
                        const content = json.message?.content || json.response;
                        if (content) onChunk(content);
                    } catch (e) {}
                }
            }
        }
        return null;
    }
}
