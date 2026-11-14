// src/main/core/model/chat/HuggingFace.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";

export class HuggingFace {
    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools } = options;
        
        // 🟢 PRO FIX: Shifted to Hugging Face Router API as default
        let url = 'https://router.huggingface.co/v1/chat/completions';
        const savedUrl = localStorage.getItem('huggingfaceBaseUrl');
        
        if (savedUrl) {
            let baseUrl = savedUrl.endsWith('/') ? savedUrl : savedUrl + '/';
            // Fallback backward compatibility for older custom URLs
            url = baseUrl.includes('api-inference') 
                ? `${baseUrl}${model}/v1/chat/completions` 
                : `${baseUrl}chat/completions`;
        }

        // 🟢 Inject Universal System Instruction for Agent Mode
        if (tools && tools.length > 0) {
            const hasSystem = messages.some(m => m.role === 'system');
            if (!hasSystem) {
                messages.unshift({
                    role: 'system',
                    content: SYSTEM_INSTRUCTION
                });
            }
        }

        const reqBody = {
            model: model,
            messages: messages,
            stream: true,
            max_tokens: 4000,
            temperature: (tools && tools.length > 0) ? 0.1 : 0.7
        };

        // 🟢 Enable Tools for Hugging Face Payload
        if (tools && tools.length > 0) {
            reqBody.tools = tools;
            reqBody.tool_choice = "auto";
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(reqBody),
            signal: signal
        });

        if (!response.ok) {
            let errText = await response.text();
            throw new Error(`Provider Error (${response.status}): ${errText}`);
        }

        // 🟢 Non-Streaming Support
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || "";
            if (content) onChunk(content);
            return { functionCalls: [], rawParts: [{ text: content }] };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        
        let currentToolCalls = {}; 
        let textBuffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("data:") && !trimmed.includes("[DONE]")) {
                        try {
                            const json = JSON.parse(trimmed.slice(5).trim());
                            const delta = json.choices?.[0]?.delta;
                            if (!delta) continue;

                            // Normal Text Streaming
                            if (delta.content) {
                                textBuffer += delta.content;
                                onChunk(delta.content); 
                            }

                            // 🟢 Tool Call Parsing (OpenAI compatible)
                            if (delta.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const index = tc.index;
                                    if (!currentToolCalls[index]) {
                                        currentToolCalls[index] = {
                                            id: tc.id,
                                            name: tc.function?.name || "",
                                            argsString: tc.function?.arguments || ""
                                        };
                                    } else {
                                        if (tc.function?.arguments) {
                                            currentToolCalls[index].argsString += tc.function.arguments;
                                        }
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // 🟢 Assemble Tool Calls for AgentRunner
        const toolCallsArray = Object.values(currentToolCalls);
        let parsedFunctionCalls = [];
        if (toolCallsArray.length > 0) {
            parsedFunctionCalls = toolCallsArray.map(tc => {
                let args = {};
                try { args = JSON.parse(tc.argsString); } catch(e) {}
                return { id: tc.id, name: tc.name, args: args };
            });
        }

        let parts = [];
        if (textBuffer) parts.push({ text: textBuffer });
        if (parsedFunctionCalls.length > 0) {
            parts = parts.concat(parsedFunctionCalls.map(fc => ({ functionCall: fc })));
        }

        return {
            functionCalls: parsedFunctionCalls,
            rawParts: parts 
        };
    }
    
    static async generateImage(prompt, apiKey, modelId) {
        const hfModel = modelId || "stabilityai/stable-diffusion-xl-base-1.0";
        // Note: Images still use the api-inference endpoint
        const response = await fetch(`https://api-inference.huggingface.co/models/${hfModel}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ inputs: prompt })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(err || "Failed to generate image with Hugging Face");
        }

        const blob = await response.blob();
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    static async generateTitle(prompt, apiKey, modelId) {
        let url = 'https://router.huggingface.co/v1/chat/completions';
        const savedUrl = localStorage.getItem('huggingfaceBaseUrl');
        
        if (savedUrl) {
            let baseUrl = savedUrl.endsWith('/') ? savedUrl : savedUrl + '/';
            url = baseUrl.includes('api-inference') 
                ? `${baseUrl}${modelId}/v1/chat/completions` 
                : `${baseUrl}chat/completions`;
        }

        const response = await fetch(url, {
            method: 'POST', 
            headers: { 
                'Authorization': `Bearer ${apiKey}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                model: modelId, 
                messages: [{role: 'user', content: prompt}], 
                max_tokens: 15 
            })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content;
    }
    
    static getDocsHTML() {
        return `
        <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5;">
            <p style="color: var(--secondary-text-color); font-size: 11.5px;">Hugging Face Inference API supports OpenAI-compatible payloads. Change the Base URL to use providers like Groq, Together AI, or Cerebras.</p>
            <h4 style="margin-top: 18px; margin-bottom: 6px; color: var(--secondary-text-color); border-bottom: 1px solid var(--border-color); padding-bottom: 4px; text-transform: uppercase; font-size:10px;">More</h4>
            <a href="https://huggingface.co/docs/api-inference/detailed_parameters" target="_blank" style="color: var(--active-text-color); text-decoration: none; font-weight: bold;">Official Inference API Documentation ↗</a>
        </div>
        `;
    }
}