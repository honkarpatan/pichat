export const ModelInfo = {
  ollama :`<div style="text-align: left; font-size: 0.9em; line-height: 1.4; color: var(--primary-text-color);">
                <p style="margin-bottom: 8px;"><b>Introduction</b><br>Ollama's API allows you to run and interact with models programmatically.</p>
                
                <p style="margin-bottom: 8px;"><b>Base URL</b><br>After installation, Ollama's API is served by default at:<br>
                <code style="background: rgba(120, 120, 120, 0.2); padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; color: #d32f2f;">http://localhost:11434/api</code></p>
                
                <p style="margin-bottom: 8px;"><b>Example Request</b><br>
                <pre style="background: rgba(120, 120, 120, 0.1); padding: 8px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; border: 1px solid rgba(120, 120, 120, 0.2);"><code>curl http://localhost:11434/api/generate -d '{
  "model": "gemma3",
  "prompt": "Why is the sky blue?"
}'</code></pre></p>
                
                <p style="margin-bottom: 8px;"><b>Libraries & Versioning</b><br>
                Ollama has official libraries for <a href="https://github.com/ollama/ollama-python" target="_blank" style="color: #1976d2; text-decoration: none;">Python</a> and <a href="https://github.com/ollama/ollama-js" target="_blank" style="color: #1976d2; text-decoration: none;">JavaScript</a>. API is expected to be stable and backwards compatible.</p>
                
                <div style="background: rgba(25, 118, 210, 0.1); padding: 8px; border-radius: 6px; border-left: 3px solid #1976d2; margin-top: 10px;">
                    <small>Fetch the complete documentation index at:<br> <a href="https://docs.ollama.com/llms.txt" target="_blank" style="color: #1976d2; text-decoration: none; font-weight: bold;">docs.ollama.com/llms.txt</a></small> <br>
                    <small>Ollama Docs<br> <a href="https://docs.ollama.com" target="_blank" style="color: #1976d2; text-decoration: none; font-weight: bold;">docs.ollama</a></small>
                </div>
            </div>`,
  llama : `<div style="text-align: left; font-size: 0.9em; line-height: 1.4; color: var(--primary-text-color);">
                <p style="margin-bottom: 8px;"><b>Meta Llama Models</b><br>Open and highly capable foundation models built by Meta.</p>
                <p style="margin-bottom: 8px;"><b>API Provider</b><br>By default, this integration uses Groq's lightning-fast inference engine for Llama models. Get your free API key from the console.</p>
                <div style="background: rgba(25, 118, 210, 0.1); padding: 8px; border-radius: 6px; border-left: 3px solid #1976d2; margin-top: 10px;">
                    <small><b>Popular Models:</b><br><code>llama-3.3-70b-versatile</code><br><code>llama-3.1-8b-instant</code></small>
                </div>
            </div>` ,
}