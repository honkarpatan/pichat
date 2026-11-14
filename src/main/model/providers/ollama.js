// src/main/core/model/chat/Ollama.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";

export class Ollama {
    static async generateStream(options, app, onChunk) {
        const { model, messages, signal, tools } = options;
        const url = app.__SETTINGS?.ollama_url || 'http://127.0.0.1:11434/api/chat';
        
        // Format messages strictly for Ollama's API
        const formattedMessages = messages.map(msg => {
            if (Array.isArray(msg.content)) {
                let text = "";
                let images = [];
                msg.content.forEach(item => {
                    if (item.type === "text" && item.text) {
                        text += item.text;
                    }
                    if (item.type === "image_url" && item.image_url?.url) {
                        let base64 = item.image_url.url;
                        if (base64.includes(',')) base64 = base64.split(',')[1];
                        images.push(base64);
                    }
                });
                
                const newMsg = { role: msg.role, content: text };
                if (images.length > 0) newMsg.images = images;
                return newMsg;
            }
            return { 
                role: msg.role, 
                content: msg.content, 
                ...(msg.images && { images: msg.images }) 
            };
        });

        // 🟢 Inject Universal System Instruction
        if (tools && tools.length > 0) {
            const hasSystem = formattedMessages.some(m => m.role === 'system');
            if (!hasSystem) {
                formattedMessages.unshift({ role: 'system', content: SYSTEM_INSTRUCTION });
            }
        }

        const reqBody = {
            model: model,
            messages: formattedMessages,
            stream: true
        };

        // 🟢 Inject Tools for Ollama
        if (tools && tools.length > 0) {
            reqBody.tools = tools;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
            signal: signal
        });

        if (!response.ok) throw new Error(`Ollama API Error (${response.status})`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        
        let textBuffer = "";
        let parsedFunctionCalls = [];

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (let i = 0; i < lines.length; i++) {
                    const trimmed = lines[i].trim();
                    if (!trimmed) continue;
                    
                    try {
                        const json = JSON.parse(trimmed);
                        
                        // Normal Text Streaming
                        if (json.message && json.message.content) {
                            textBuffer += json.message.content;
                            onChunk(json.message.content); 
                        }
                        
                        // 🟢 Tool Call Parsing (Ollama format)
                        if (json.message && json.message.tool_calls) {
                            json.message.tool_calls.forEach(tc => {
                                parsedFunctionCalls.push({
                                    id: `call_${Math.random().toString(36).slice(2)}`, // Ollama sometimes lacks IDs
                                    name: tc.function.name,
                                    args: tc.function.arguments || {}
                                });
                            });
                        }
                    } catch (e) {}
                }
            }
        } finally {
            reader.releaseLock();
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

    static async fetchModels(url) {
        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
        const response = await fetch(`${cleanUrl}/api/tags`);
        const data = await response.json();
        return data.models ? data.models.map(m => m.name) : [];
    }
    
    static async generateTitle(prompt, apiKey, modelId) {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelId, prompt: prompt, stream: false })
        });
        const data = await response.json();
        return data.response;
    }

    // ==========================================
    // Ollama Specific UI Manager Logic
    // ==========================================
    static async renderManagerTab(containerElement, app) {
        containerElement.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:12px; font-weight:bold; color:#888;">Installed Models</span>
                <button id="refresh-ollama-btn" style="background:transparent; border:1px solid #444; color:#fff; border-radius:4px; padding:4px 8px; font-size:10px; cursor:pointer;">Refresh</button>
            </div>
            <div id="ollama-model-list-wrapper" style="max-height:200px; overflow-y:auto;">
                <p style="font-size:12px; color:#aaa;">Loading models... Make sure 'ollama serve' is running.</p>
            </div>
        `;

        const refreshBtn = containerElement.querySelector('#refresh-ollama-btn');
        const listWrapper = containerElement.querySelector('#ollama-model-list-wrapper');

        const loadModels = async () => {
            try {
                listWrapper.innerHTML = '<p style="font-size:12px; color:#aaa;">Fetching from localhost...</p>';
                const resInstalled = await fetch('http://localhost:11434/api/tags');
                const installedData = await resInstalled.json();
                const installed = installedData.models || [];

                const resRunning = await fetch('http://localhost:11434/api/ps');
                const runningData = await resRunning.json();
                const running = runningData.models || [];

                listWrapper.innerHTML = '';
                const normalizedInstalled = installed.map(m => m.name.toLowerCase().trim());

                installed.forEach(model => {
                    const isRunning = running.some(r => r.model?.includes(model.name) || r.name?.includes(model.name));
                    listWrapper.appendChild(this.createOllamaEntryHTML(app, model, true, isRunning, loadModels));
                });

                const suggested = [
  { name: 'qwen3.5:0.8b', size: '1.0GB*', context: '256K' }, // Context size not specified
  { name: 'opencoder:1.5b', size: '1.32GB', context: '8K' }, // From Ollama documentation
  { name: 'yi-coder:1.5b', size: '826.04MB', context: '128K' }, // Supports up to 128K tokens
  { name: 'qwen3:0.6b', size: '523MB', context: '40K' }, // Context size not specified
  { name: 'qwen3:1.7b', size: '1.4GB', context: '40K' }, // 40K tokens context window
  { name: 'qwen2.5:0.5b', size: '398MB', context: '32K' }, // Context size not specified
  { name: 'qwen2.5:1.5b', size: '986MB', context: '32K' }, // Context size not specified
  { name: 'qwen2.5:3b', size: '1.9GB', context: '32K' }, // Context size not specified
  { name: 'qwen2.5vl:3b', size: '3.2GB', context: '128K' }, // Flagship vision-language model with 128K context
  { name: 'qwen2.5-coder:0.5b', size: '506.48MB', context: '' }, // Context size not specified
  { name: 'qwen2.5-coder:1.5b', size: '986MB', context: '' }, // Context size not specified
  { name: 'qwen2-math:1.5b', size: '935MB', context: '4K' }, // 4K tokens context window
  { name: 'deepseek-r1:1.5b', size: '1.1GB', context: '128K' }, // 128K tokens context window
  { name: 'deepseek-coder:1.3b', size: '776MB', context: '16K' }, // 16K tokens context window
  { name: 'deepcoder:1.5b', size: '1.1GB', context: '128K' }, // Context size not specified
  { name: 'llama3.2:1b', size: '1.3GB', context: '128K' }, // 128K tokens context window
  { name: 'llama3.2:3b', size: '2GB', context: '128K' }, // 128K tokens context window
  { name: 'tinyllama:1.1b', size: '638MB', context: '2K' }, // Context size not specified
  { name: 'tinydolphin:1.1b', size: '637MB', context: '4K' }, // Assumed 4K tokens context
  { name: 'gemma3:1b', size: '815MB', context: '32K' }, // 32K tokens context window
  { name: 'gemma3:1b-it-qat', size: '957MB', context: '32K' }, // Context size not specified
  { name: 'codegemma:2b', size: '1.6GB', context: '8K' }, // Context size not specified
  { name: 'starcoder:1b', size: '726MB', context: '8K' }, // Context size not specified
  { name: 'starcoder2:3b', size: '1.7GB', context: '16K' }, // Context size not specified
  { name: 'phi:2.7b', size: '1.6GB', context: '2K' }, // Context size not specified
  { name: 'granite3.3:2b', size: '1.5GB', context: '128K' }, // Context size not specified
  { name: 'granite3.2:2b', size: '1.5GB', context: '128K' }, // Context size not specified
  { name: 'granite3-dense:2b', size: '1.6GB', context: '4K' }, // Context size not specified
  { name: 'granite3.1-dense:2b', size: '1.6GB', context: '128K' }, // Context size not specified
  { name: 'granite3.1-moe:1b', size: '1.4GB', context: '128K' }, // Context size not specified
  { name: 'granite3-moe:1b', size: '822MB', context: '4K' } // Context size not specified
];

                suggested.filter(m => !normalizedInstalled.includes(m.name.toLowerCase().trim())).forEach(model => {
                    listWrapper.appendChild(this.createOllamaEntryHTML(app, model, false, false, loadModels));
                });

            } catch (e) {
                listWrapper.innerHTML = '<p style="color:#f44; font-size:12px;">Failed to connect to Ollama. Ensure it is running.</p>';
            }
        };

        refreshBtn.onclick = loadModels;
        await loadModels();
    }

    static createOllamaEntryHTML(app, model, isInstalled, isRunning, reloadCallback) {
        const div = document.createElement('div');
        div.style = 'border-bottom:1px solid #333; padding:8px 0; font-size:12px;';
        const sizeText = isInstalled && model.size ? (model.size / (1024*1024*1024)).toFixed(2) + ' GB' : (model.size || '');

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:${isInstalled ? '#4caf50' : '#f44'}; font-weight:bold;">${model.name}</span>
                <span style="font-size:10px; background:#222; padding:2px 4px; border-radius:3px;">${model.context || '--'} | ${sizeText}</span>
            </div>
            <div style="display:flex; gap:5px; margin-top:5px;">
                ${isInstalled ? `
                    <button class="delete-btn" style="background:#ffb3b3bd; color:#fff; border:none; border-radius:3px; padding:3px 8px; cursor:pointer;">Delete</button>
                    ${isRunning ? `<button class="unload-btn" style="background:#ffde9da8; color:#511313; border:none; border-radius:3px; padding:3px 8px; cursor:pointer;">Unload</button>` : ''}
                ` : `
                    <button class="download-btn" style="background:rgba(93,157,96,0.57); color:#fff; border:none; border-radius:3px; padding:3px 8px; cursor:pointer;">Download</button>
                `}
            </div>
        `;

        if (isInstalled) {
            div.querySelector('.delete-btn').onclick = async () => {
                await this.deleteModel(model.name);
                reloadCallback();
            };
            if (isRunning) {
                div.querySelector('.unload-btn').onclick = async () => {
                    await fetch('http://localhost:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: model.name, messages: [], keep_alive: 0 }) });
                    window.toast(`${model.name} unloaded.`);
                    reloadCallback();
                };
            }
        } else {
            div.querySelector('.download-btn').onclick = async (e) => {
                await this.pullModel(model.name, e.target);
            };
        }
        return div;
    }

    static async deleteModel(modelName) {
        try {
            await fetch('http://localhost:11434/api/delete', { method: 'DELETE', body: JSON.stringify({ model: modelName }) });
            window.toast("Model deleted");
        } catch (error) {
            console.error('Delete error:', error);
        }
    }

    static async pullModel(modelName, toggleBtn) {
        const controller = new AbortController();
        let cancelled = false;
        const originalBg = toggleBtn.style.background;
        toggleBtn.textContent = 'Cancel';
        toggleBtn.style.background = '#333';
        
        toggleBtn.onclick = () => {
            cancelled = true;
            controller.abort();
            toggleBtn.textContent = 'Download Model';
            toggleBtn.style.background = originalBg;
        };

        try {
            const res = await fetch('http://localhost:11434/api/pull', {
                method: 'POST', body: JSON.stringify({ model: modelName }), signal: controller.signal,
            });

            if (!res || cancelled) return toggleBtn.textContent = cancelled ? 'Canceled' : 'Failed';

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                if (cancelled) break;
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const chunks = buffer.split('\n').filter(Boolean);
                buffer = chunks.pop();

                chunks.forEach(chunk => {
                    try {
                        const data = JSON.parse(chunk);
                        if (data.completed && data.total) {
                            const percent = ((data.completed / data.total) * 100).toFixed(1);
                            toggleBtn.textContent = `Cancel (${percent}%)`;
                            toggleBtn.style.background = `linear-gradient(to right, #4caf50 0%, #4caf50 ${percent}%, #333 ${percent}%)`;
                        } else if (data.status === 'success') {
                            toggleBtn.textContent = 'Downloaded';
                            toggleBtn.style.background = '#4caf50';
                        }
                    } catch (e) {}
                });
            }
        } catch (err) {
            toggleBtn.textContent = 'Error';
            toggleBtn.style.background = '#f44';
        }
    }
  
    static getDocsHTML() {
        return `
        <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 320px; scrollbar-width: thin;">
            
            <div style="background: rgba(75, 93, 209, 0.05); border: 1px solid var(--active-color, #4b5dd1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                    <span style="font-size:16px;">⚡</span>
                    <b style="color: var(--active-text-color, #4b5dd1); font-size: 13px;">Offline Setup via Codain</b>
                </div>
                <p style="margin: 0 0 8px 0; font-size: 10.5px; color: var(--secondary-text-color);">Run AI offline directly on Android using <b>Termux</b> and the <code style="color:#4caf50;">codain</code> npm package.</p>
                
                <div style="background: #0d0d0d; border: 1px solid #333; border-radius: 4px; padding: 10px; font-family: monospace; font-size: 10px; color: #ccc; line-height: 1.6;">
                    <span style="color: #666;"># 1. Install Termux from F-Droid</span><br>
                    <span style="color: #666;"># 2. Install Node.js LTS</span><br>
                    <span style="color: #4caf50;">pkg install nodejs-lts</span><br><br>

                    <span style="color: #666;"># 3. Install Codain (Global NPM Package)</span><br>
                    <span style="color: #4caf50;">npm i -g codain</span><br>
                    <span style="color: #fff;">codain --version</span><br><br>

                    <span style="color: #666;"># 4. Install Ollama Server (Req: 1.5GB Internet)</span><br>
                    <span style="color: #4caf50;">codain i</span> <span style="color: #666;"># or codain install</span><br><br>

                    <span style="color: #666;"># 5. Start / Stop Server</span><br>
                    <span style="color: #4caf50;">codain r</span> <span style="color: #666;"># Start (or codain run)</span><br>
                    <span style="color: #4caf50;">codain s</span> <span style="color: #666;"># Stop (or codain stop)</span><br><br>

                    <span style="color: #666;"># 6. Run Specific Model directly</span><br>
                    <span style="color: #4caf50;">codain r &lt;model_name&gt;</span><br><br>

                    <span style="color: #666;"># Need help?</span><br>
                    <span style="color: #fff;">codain help</span>
                </div>

                <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                    <b style="color: var(--error-text-color, #f44); font-size: 10.5px;">⚠️ Requirements:</b>
                    <ul style="margin: 4px 0 0 0; padding-left: 15px; font-size: 10px; color: var(--secondary-text-color);">
                        <li>Acode (latest version)</li>
                        <li>4GB RAM (minimum)</li>
                        <li>8GB ROM (free storage)</li>
                        <li>Ollama running locally via Codain</li>
                    </ul>
                </div>
            </div>

            <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
                <b style="color: var(--active-text-color);">⚙ Custom API (Placeholders)</b>
                <p style="margin: 4px 0; font-size: 10.5px; color: var(--secondary-text-color);">The app automatically replaces these tags in your JSON payload:</p>
                <ul style="margin: 0; padding-left: 15px; font-size: 10.5px; color: var(--secondary-text-color);">
                    <li><code style="color:#4caf50;">{{MODEL_ID}}</code> : Injects Primary Model.</li>
                    <li><code style="color:#f44; font-weight:bold;">"{{MESSAGES}}"</code> : Injects Chat History.</li>
                </ul>
            </div>

            <h4 style="margin-top: 18px; margin-bottom: 6px; color: var(--secondary-text-color); border-bottom: 1px solid var(--border-color); padding-bottom: 4px; text-transform: uppercase; font-size:10px;">More Resources</h4>
            <a href="https://github.com/ollama/ollama/blob/main/docs/api.md" target="_blank" style="color: var(--active-text-color); text-decoration: none; font-weight: bold; font-size: 11px;">Official Ollama API Documentation ↗</a>
        </div>
        `;
    }
}