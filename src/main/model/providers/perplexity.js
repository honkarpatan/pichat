export class Perplexity {
    static formatMessages(messages) {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : msg.role,
            content: msg.content
        }));
    }

    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal } = options;
        if (!apiKey) throw new Error("Perplexity API key is missing.");

        const endpoint = 'https://api.perplexity.ai/chat/completions';
        const savedOptions = JSON.parse(localStorage.getItem('perplexityModelOptions') || '{}');

        const payload = {
            model: model || 'sonar-pro',
            messages: this.formatMessages(messages),
            stream: true,
            temperature: savedOptions.temperature ?? 0.2,
            top_p: savedOptions.top_p ?? 0.9,
            presence_penalty: savedOptions.presence_penalty ?? 0,
            frequency_penalty: savedOptions.frequency_penalty ?? 1
        };

        if (savedOptions.max_tokens) {
            payload.max_tokens = savedOptions.max_tokens;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload),
            signal: signal
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || `Perplexity Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); 

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data:')) {
                    try {
                        const json = JSON.parse(trimmed.slice(5).trim());
                        if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                            onChunk(json.choices[0].delta.content);
                        }
                    } catch (e) {
                        console.error("Perplexity JSON parse error:", e);
                    }
                }
            }
        }
    }

    static getDocsHTML() {
        return `
        <div style="font-size:12px; color:var(--primary-text-color); line-height:1.5;">
            <h4 style="color:#20b2aa; margin-bottom:8px;">Perplexity API Setup</h4>
            <p>Perplexity offers blazing fast models with built-in web search capabilities.</p>
            <ul style="padding-left:15px; margin-top:8px; color:var(--secondary-text-color);">
                <li><b>sonar-pro:</b> Best for complex queries with deep web search.</li>
                <li><b>sonar-reasoning-pro:</b> Built-in thinking/reasoning like DeepSeek R1.</li>
                <li><b>sonar:</b> Fast, lightweight model for quick answers.</li>
            </ul>
            <p style="margin-top:8px;">Get your API key from <a href="https://www.perplexity.ai/settings/api" target="_blank" style="color:#20b2aa;">Perplexity Settings</a>.</p>
        </div>`;
    }
}