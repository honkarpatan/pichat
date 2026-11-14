import { ChatGPT } from './providers/chatgpt.js';
import { Gemini } from './providers/gemini.js';
import { Mistral } from './providers/mistral.js';
import { Ollama } from './providers/ollama.js';
import { HuggingFace } from './providers/huggingface.js';
import { Grok } from './providers/grok.js';
import { Llama } from './providers/llama.js';
import { DeepSeek } from './providers/deepseek.js';
import { Claude } from './providers/claude.js';
import { ModelIcons } from './ModelIcons.js'; 
import { ModelInfo } from './ModelInfo.js'; 
import { ModelStyles } from './ModelStyles.js'; 
import { Perplexity } from './providers/perplexity.js';
import { OpenAICompatible } from './providers/openaiCompatible.js';
import { Bedrock } from './providers/bedrock.js';
import { VertexAI } from './providers/vertex.js';
import { GitHubCopilot } from './providers/githubCopilot.js';
import { GitHubModels } from './providers/githubModels.js';

export const ModelConfig = {
    'chatgpt': {
        handler: ChatGPT,
        apiKeyName: 'gptApiKey',
        modelKeyName: 'gptSelectedModel',
        imageModelKeyName: 'gptImageModel',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true,
        // o1/o3-style power — shown on input bar when Think is on
        think_how: ['low', 'medium', 'high'],
        supportsImageGeneration: true,
        bypassAppQuota: true,
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        styles: {
            sendBtn: { backgroundColor: '#10a37f', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: ModelStyles.chatgpt 
        },
        consoleUrl: 'https://platform.openai.com/api-keys',
        consoleText: 'API Keys',
        name: "Chat GPT",
        image: ModelIcons.chatgptLogo, 
        image_bg: "#001d00",
        info: "<p>Use the right model for my request</p>",
        capability: "<p>Powered By ChatGPT OpenAI</p>",
        level: "pro",
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'gptSelectedModel', placeholder: 'e.g. gpt-4o', payload: "{\n  \"url\": \"https://api.openai.com/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}" },
                { id: 'image_model', label: 'Image Gen Model', storageKey: 'gptImageModel', placeholder: 'e.g. dall-e-3', payload: "{\n  \"url\": \"https://api.openai.com/v1/images/generations\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"prompt\": \"{{PROMPT}}\",\n    \"n\": 1,\n    \"size\": \"1024x1024\"\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 100, max: 16384, step: 100, default: 4096 },
                { type: 'range', id: 'top_p', label: 'Top P (Nucleus)', min: 0, max: 1.0, step: 0.05, default: 1.0 },
                { type: 'range', id: 'presence_penalty', label: 'Presence Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0.0 },
                { type: 'range', id: 'frequency_penalty', label: 'Frequency Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0.0 },
                { type: 'range', id: 'seed', label: 'Seed (0 = random)', min: 0, max: 2147483647, step: 1, default: 0 },
                { type: 'selection', id: 'reasoning_effort', label: 'Reasoning Effort (o-series)', default: 'medium', options: [
                    { label: 'Low', value: 'low' },
                    { label: 'Medium', value: 'medium' },
                    { label: 'High', value: 'high' }
                ]}
            ]
        }
    },
    'gemini': {
        handler: Gemini,
        apiKeyName: 'geminiApiKey',
        modelKeyName: 'geminiSelectedModel',
        imageModelKeyName: 'geminiImageModel',
        internal_web_browsing: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true, 
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: true,
        bypassAppQuota: true,
        think_how: ['HIGH', 'MEDIUM', 'LOW'],
        styles: {
            sendBtn: { backgroundColor: '#1a73e8', borderRadius: '50%', icon: ModelIcons.sendGemini },
            setupModal: ModelStyles.gemini 
        },
        consoleUrl: 'https://aistudio.google.com/app/apikey',
        consoleText: 'Get API Key',
        name: "Gemini",
        image_bg: "#fff",
        image: "https://assets-v2.lottiefiles.com/a/95ad4f50-428f-11ef-b282-5fa8dbceaeae/QqS0tmRuPD.gif",
        capability: `<img src="https://www.marktechpost.com/wp-content/uploads/2025/01/Gh2bQGbXcAAlb8X.png" style="max-width: 100%; height: auto; display: block;">`,
        level: "pro",
        info: `<div>Powered by Google Gemini Ai</div>`,
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'geminiSelectedModel', placeholder: 'e.g. gemini-1.5-flash', payload: "{\n  \"url\": \"https://generativelanguage.googleapis.com/v1beta/models/{{MODEL_ID}}:streamGenerateContent?alt=sse&key={{API_KEY}}\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\"\n  },\n  \"body\": {\n    \"contents\": \"{{MESSAGES}}\",\n    \"generationConfig\": {\n      \"temperature\": 0.7\n    }\n  }\n}" },
                { id: 'image_model', label: 'Image Gen Model', storageKey: 'geminiImageModel', placeholder: 'e.g. imagen-3.0-generate-001', payload: "{\n  \"url\": \"https://generativelanguage.googleapis.com/v1beta/models/{{MODEL_ID}}:predict?key={{API_KEY}}\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\"\n  },\n  \"body\": {\n    \"instances\": [{\"prompt\": \"{{PROMPT}}\"}],\n    \"parameters\": {\"sampleCount\": 1, \"outputOptions\": {\"mimeType\": \"image/jpeg\"}}\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'topP', label: 'Top P', min: 0, max: 1.0, step: 0.05, default: 0.95 },
                { type: 'range', id: 'topK', label: 'Top K', min: 1, max: 100, step: 1, default: 40 },
                { type: 'range', id: 'maxOutputTokens', label: 'Max Output Tokens', min: 256, max: 8192, step: 256, default: 8192 },
                { type: 'range', id: 'candidateCount', label: 'Candidate Count', min: 1, max: 4, step: 1, default: 1 },
                { type: 'range', id: 'presencePenalty', label: 'Presence Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0.0 },
                { type: 'range', id: 'frequencyPenalty', label: 'Frequency Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0.0 },
                { type: 'selection', id: 'responseMimeType', label: 'Response MIME Type', default: 'text/plain', options: [
                    { label: 'Plain text', value: 'text/plain' },
                    { label: 'JSON', value: 'application/json' }
                ]}
            ]
        }
    },
    'mistral': {
        handler: Mistral,
        apiKeyName: 'mistralApiKey',
        modelKeyName: 'mistralSelectedModel',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true, 
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        supportsTools: true,
        supportsProject: true,
        styles: {
            sendBtn: { backgroundColor: '#f97316', borderRadius: '50%', icon: ModelIcons.sendMistral },
            setupModal: ModelStyles.mistral 
        },
        consoleUrl: 'https://console.mistral.ai/api-keys/',
        consoleText: 'Mistral Keys',
        name: "Mistral",
        info: "Mistral Ai",
        capability: "",
        level: "pro",
        image_bg: "#fee",
        image: "https://d1pnnwteuly8z3.cloudfront.net/images/16ee4bc9-56c7-4611-94e5-2605fbbd24ea/c80c612c-4fb2-4ff8-89eb-9fc54007842e.png",
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'mistralSelectedModel', placeholder: 'e.g. mistral-large-latest', payload: "{\n  \"url\": \"https://api.mistral.ai/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 1.5, step: 0.05, default: 0.7 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0, max: 1.0, step: 0.05, default: 1.0 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 128, max: 32768, step: 128, default: 4096 },
                { type: 'range', id: 'presence_penalty', label: 'Presence Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0.0 },
                { type: 'range', id: 'frequency_penalty', label: 'Frequency Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0.0 },
                { type: 'range', id: 'random_seed', label: 'Random Seed (0 = random)', min: 0, max: 2147483647, step: 1, default: 0 },
                { type: 'boolean', id: 'safe_prompt', label: 'Safe Prompt (Content Filter)', default: false }
            ]
        }
    },
    'huggingface': {
        handler: HuggingFace,
        apiKeyName: 'huggingfaceApiKey',
        modelKeyName: 'huggingfaceSelectedModel',
        imageModelKeyName: 'huggingfaceImageModel',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true, 
        supportsImageGeneration: true,
        bypassAppQuota: true,
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        styles: {
            sendBtn: { backgroundColor: '#ffd21e', borderRadius: '50%', icon: ModelIcons.sendDefault },
            setupModal: ModelStyles.huggingface 
        },
        consoleUrl: 'https://huggingface.co/settings/tokens',
        consoleText: 'HF Tokens',
        image: "https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/huggingface-color.png",
        image_bg: "#fff",
        level: "smart",
        capability: "",
        info: "Hugging Face Models",
        name: "Hugging Face",
        setting_ui: {
            tabs: ['manual', 'advanced', 'custom_api', 'docs'], 
            inputs: [
                { id: 'api_key', label: 'API Key', storageKey: 'huggingfaceApiKey', placeholder: 'Enter API Key here' }, 
                { id: 'primary', label: 'Primary Model ID', storageKey: 'huggingfaceSelectedModel', placeholder: 'e.g. meta-llama/Llama-3', payload: "{\n  \"url\": \"https://router.huggingface.co/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"stream\": true\n  }\n}" },
                { id: 'image_model', label: 'Image Gen Model', storageKey: 'huggingfaceImageModel', placeholder: 'e.g. stabilityai/stable-diffusion-xl-base-1.0', payload: "{\n  \"url\": \"https://router.huggingface.co/hf-inference/models/{{MODEL_ID}}\",\n  \"headers\": {\n    \"Authorization\": \"Bearer {{API_KEY}}\",\n    \"Content-Type\": \"application/json\"\n  },\n  \"body\": {\n    \"inputs\": \"{{PROMPT}}\"\n  }\n}" }
            ],
            // HF parameters
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.2 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0.1, max: 1.0, step: 0.05, default: 0.9 },
                { type: 'range', id: 'repetition_penalty', label: 'Repetition Penalty', min: 0.0, max: 2.0, step: 0.1, default: 1.1 }
            ]
        }
    },
    'ollama': {
        handler: Ollama,
        apiKeyName: 'ollama_url', 
        modelKeyName: 'ollamaPrimaryModel',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true, 
        supportsImageGeneration: false,
        bypassAppQuota: true,
        animation: false, 
        supportsTools: true,
        supportsProject: true,
        styles: {
            sendBtn: { backgroundColor: '#222222', borderRadius: '50%', icon: ModelIcons.sendOllama },
            setupModal: ModelStyles.ollama 
        },
        consoleUrl: 'https://ollama.com/library',
        consoleText: 'Ollama Models',
        name: "Ollama",
        image: "https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/light/ollama.png",
        image_bg: "#fff",
        info: ModelInfo.ollama,
        level: "smart",
        setting_ui: {
            tabs: ['manager', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'ollamaPrimaryModel', placeholder: 'e.g. qwen2.5-coder:0.5b', payload: "{\n  \"url\": \"http://127.0.0.1:11434/api/chat\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"stream\": true,\n    \"options\": { \"temperature\": 0.8 }\n  }\n}" }
            ],
            // Ollama context and parameters
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.8 },
                { type: 'range', id: 'num_ctx', label: 'Context Window (num_ctx)', min: 1024, max: 32768, step: 1024, default: 4096 },
                { type: 'range', id: 'top_k', label: 'Top K', min: 1, max: 100, step: 1, default: 40 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0.1, max: 1.0, step: 0.05, default: 0.9 }
            ]
        }
    },
    'grok': {
        handler: Grok,
        apiKeyName: 'grokApiKey',
        modelKeyName: 'grokSelectedModel',
        imageModelKeyName: 'grokImageModel',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsImageGeneration: true, 
        bypassAppQuota: true,
        supportsStudyMode: true,
        styles: {
            sendBtn: { backgroundColor: '#000000', borderRadius: '50%', icon: ModelIcons.sendGrok },
            setupModal: ModelStyles.grok 
        },
        consoleUrl: 'https://console.x.ai/',
        consoleText: 'Grok Console',
        name: "Grok xAI",
        image: "https://images.seeklogo.com/logo-png/61/2/grok-logo-png_seeklogo-613403.png",
        image_bg: "#f4f5f3",
        level: "pro",
        capability: "xAI Grok Models",
        info: "Powered by xAI",
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'grokSelectedModel', placeholder: 'e.g. grok-2-latest', payload: "{\n  \"url\": \"https://api.x.ai/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}" },
                { id: 'image_model', label: 'Image Gen Model', storageKey: 'grokImageModel', placeholder: 'e.g. flux-1', payload: "{}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'boolean', id: 'stream', label: 'Enable Streaming', default: true }
            ]
        }
    },
    'llama': {
        handler: Llama,
        apiKeyName: 'llamaApiKey',
        modelKeyName: 'llamaSelectedModel',
        supportsImages: false,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true, 
        supportsTools: true,
        supportsProject: true,
        supportsImageGeneration: false, 
        bypassAppQuota: true,
        supportsStudyMode: true,
        styles: {
            sendBtn: { backgroundColor: '#4b5dd1', borderRadius: '50%', icon: ModelIcons.sendLlama },
            setupModal: ModelStyles.llama 
        },
        consoleUrl: 'https://console.groq.com/keys',
        consoleText: 'Get API Key (Groq)',
        name: "Meta Llama",
        fetchUrl: 'https://api.groq.com/openai/v1/models',
        image: "https://i.ibb.co/LdX6bKdD/meta-ai-icon-2.png", 
        image_bg: "#ffffff",
        info: `${ModelInfo.llama}`,
        capability: "Powered by Meta Llama (via Groq)",
        level: "pro",
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'llamaSelectedModel', placeholder: 'e.g. llama-3.3-70b-versatile', payload: "{\n  \"url\": \"https://api.groq.com/openai/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 100, max: 8192, step: 100, default: 4000 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0.1, max: 1.0, step: 0.05, default: 1.0 }
            ]
        }
    },
    'deepseek': {
        handler: DeepSeek,
        apiKeyName: 'deepseekApiKey',
        modelKeyName: 'deepseekSelectedModel',
        supportsImages: false,
        supportsFiles: true,
        supportsWeb: true, 
        supportsThink: true,
        nativeThink: true,
        // Thinking on/off power (DeepSeek rejects tools+required while thinking is on)
        think_how: ['OFF', 'ON'],
        supportsTools: true,
        supportsProject: true,
        supportsImageGeneration: false, 
        bypassAppQuota: true,
        supportsStudyMode: true,
        styles: {
            sendBtn: { backgroundColor: '#4d6bfe', borderRadius: '50%', icon: ModelIcons.sendDeepSeek },
            setupModal: ModelStyles.deepseek 
        },
        consoleUrl: 'https://platform.deepseek.com/api_keys',
        consoleText: 'DeepSeek Keys',
        name: "DeepSeek",
        fetchUrl: 'https://api.deepseek.com/models',
        image: "https://i.postimg.cc/cHMN37PG/deepseek-logo-icon.png", 
        image_bg: "#ffffff",
        info: `${ModelInfo.deepseek}`,
        capability: "DeepSeek Chat & Reasoner Models",
        level: "pro",
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'deepseekSelectedModel', placeholder: 'e.g. deepseek-reasoner', payload: "{\n  \"url\": \"https://api.deepseek.com/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0.1, max: 1.0, step: 0.05, default: 1.0 },
                { type: 'boolean', id: 'presence_penalty_enable', label: 'Enable Presence Penalty', default: false }
            ]
        }
    },
    'claude': {
        handler: Claude,
        apiKeyName: 'claudeApiKey',
        modelKeyName: 'claudeSelectedModel',
        supportsImages: true,  
        supportsFiles: true,   
        supportsWeb: true,     
        supportsThink: true,
        // Extended thinking budget tiers (mapped in Claude.generateStream)
        think_how: ['LOW', 'MEDIUM', 'HIGH'],
        supportsTools: true,
        supportsProject: true,
        supportsImageGeneration: false, 
        bypassAppQuota: true,
        supportsStudyMode: true,
        styles : {
          sendBtn: { backgroundColor :'#d97757', borderRadius: '5px', icon: ModelIcons.sendClaude },
            setupModal: ModelStyles.claude 
        },
        consoleUrl: 'https://console.anthropic.com/settings/keys',
        consoleText: 'Anthropic Keys',
        name: "Claude",
        image: `https://i.postimg.cc/FzMP8CR7/claude-logo-png-seeklogo-554534.png`, 
        image_bg: "#fdf8f6",
        info: "Anthropic Claude 3 & 3.5 Models",
        capability: "High reasoning, coding & creative writing capabilities",
        level: "pro",
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'claudeSelectedModel', placeholder: 'e.g. claude-3-5-sonnet-latest', payload: "{\n  \"url\": \"https://api.anthropic.com/v1/messages\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"x-api-key\": \"{{API_KEY}}\",\n    \"anthropic-version\": \"2023-06-01\",\n    \"anthropic-dangerous-direct-browser-access\": \"true\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"max_tokens\": 4096,\n    \"stream\": true\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 1, step: 0.05, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4096 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0, max: 1.0, step: 0.05, default: 1.0 },
                { type: 'range', id: 'top_k', label: 'Top K', min: 0, max: 100, step: 1, default: 0 },
                { type: 'selection', id: 'stop_sequences_preset', label: 'Stop Sequences', default: 'none', options: [
                    { label: 'None', value: 'none' },
                    { label: 'Double newline', value: 'dbl_nl' }
                ]}
            ]
        }
    },
    'perplexity': {
        handler: Perplexity,
        apiKeyName: 'perplexityApiKey',
        modelKeyName: 'perplexitySelectedModel',
        supportsImages: false,
        supportsFiles: true,
        supportsWeb: true, // Native support
        supportsThink: true, 
        nativeThink: true, // Sonar-reasoning natively outputs <think> tags!
        think_how: ['low', 'medium', 'high'],
        supportsImageGeneration: false, 
        bypassAppQuota: true,
        supportsStudyMode: true,
        styles : {
          sendBtn: { backgroundColor :'#20b2aa00', borderRadius: '50%', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>' },
          setupModal: ModelStyles.perplexity 
        },
        consoleUrl: 'https://www.perplexity.ai/settings/api',
        consoleText: 'Perplexity API',
        name: "Perplexity",
        image: `https://i.postimg.cc/Rh8DNGhs/perplexity-color.png`, 
        image_bg: "#053511",
        info: "Perplexity Sonar & Reasoning Models",
        capability: "Live Web Search & Deep Reasoning",
        level: "pro",
        setting_ui: {
            tabs: ['manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Primary Model', storageKey: 'perplexitySelectedModel', placeholder: 'e.g. sonar-reasoning-pro', payload: "{\n  \"url\": \"https://api.perplexity.ai/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.2,\n    \"stream\": true\n  }\n}" }
            ],
            // FULL NO-COMPROMISE CONFIGURATION
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.2 }, 
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 100, max: 8000, step: 100, default: 4000 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0.1, max: 1.0, step: 0.05, default: 0.9 },
                { type: 'range', id: 'presence_penalty', label: 'Presence Penalty', min: -2.0, max: 2.0, step: 0.1, default: 0 },
                { type: 'range', id: 'frequency_penalty', label: 'Frequency Penalty', min: -2.0, max: 2.0, step: 0.1, default: 1 },
                { 
                    type: 'selection', 
                    id: 'return_images', 
                    label: 'Return Images in Markdown', 
                    default: 'false', 
                    options: [
                        { label: 'Disable', value: 'false' },
                        { label: 'Enable', value: 'true' }
                    ] 
                }
            ]
        }
    },
    'llamacpp': {
        handler: ChatGPT, // 🟢 Llama.cpp uses OpenAI format, so ChatGPT handler is perfect!
        apiKeyName: 'llamacppApiKey',
        modelKeyName: 'llamacppSelectedModel',
        supportsImages: false,
        supportsFiles: true,
        supportsTools: true,
        supportsProject: true,
        supportsWeb: false, // Local model
        supportsThink: true, 
        supportsImageGeneration: false, 
        bypassAppQuota: true,
        supportsStudyMode: true,
        styles: {
            sendBtn: { backgroundColor: '#f4c430', borderRadius: '50%', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>' },
            setupModal: ModelStyles.llamacpp 
        },
        consoleUrl: 'https://github.com/ggerganov/llama.cpp',
        consoleText: 'Llama.cpp Docs',
        name: "Llamacpp",
        image: ModelIcons.llamaCppLogo, // Replace with valid icon
        image_bg: "#ffffff",
        info: "Connect to Local Llama.cpp Server",
        capability: "Run GGUF models locally with raw performance",
        level: "smart",
        setting_ui: {
            tabs: ['manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                { id: 'primary', label: 'Server URL', storageKey: 'llamacppSelectedModel', placeholder: 'e.g. http://127.0.0.1:8080', payload: "{\n  \"url\": \"http://127.0.0.1:8080/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}" }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'n_predict', label: 'Max Tokens (n_predict)', min: 128, max: 8192, step: 128, default: 2048 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0.1, max: 1.0, step: 0.05, default: 0.9 },
                { type: 'range', id: 'top_k', label: 'Top K', min: 1, max: 100, step: 1, default: 40 }
            ]
        }
    },

    // ─── OpenAI-compatible cloud routers / hosts ───
    'openrouter': {
        handler: OpenAICompatible,
        apiKeyName: 'openrouterApiKey',
        modelKeyName: 'openrouterSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#6566f1', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#6566f1', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://openrouter.ai/keys',
        consoleText: 'OpenRouter Keys',
        name: 'OpenRouter',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/openrouter.png',
        image_bg: '#0a0a0f',
        info: '<p>Route to 100+ models via OpenRouter (OpenAI-compatible).</p>',
        capability: 'OpenRouter multi-model gateway',
        level: 'pro',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'openrouterSelectedModel',
                    placeholder: 'e.g. anthropic/claude-3.5-sonnet',
                    payload: "{\n  \"url\": \"https://openrouter.ai/api/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\",\n    \"HTTP-Referer\": \"https://acode.app\",\n    \"X-Title\": \"Acode AI Chat\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },
    'groqcloud': {
        handler: OpenAICompatible,
        apiKeyName: 'groqcloudApiKey',
        modelKeyName: 'groqcloudSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: false,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#f55036', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#f55036', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://console.groq.com/keys',
        consoleText: 'Groq Console',
        name: 'Groq',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/groq.png',
        image_bg: '#0f0f0f',
        info: '<p>Ultra-fast inference via Groq LPU (OpenAI-compatible).</p>',
        capability: 'Groq Cloud',
        level: 'smart',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'groqcloudSelectedModel',
                    placeholder: 'e.g. llama-3.3-70b-versatile',
                    payload: "{\n  \"url\": \"https://api.groq.com/openai/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 8192, step: 256, default: 4000 }
            ]
        }
    },
    'together': {
        handler: OpenAICompatible,
        apiKeyName: 'togetherApiKey',
        modelKeyName: 'togetherSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#0f6fff', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#0f6fff', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://api.together.xyz/settings/api-keys',
        consoleText: 'Together AI Keys',
        name: 'Together AI',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/together.png',
        image_bg: '#0a1628',
        info: '<p>Open-source &amp; proprietary models via Together AI.</p>',
        capability: 'Together Inference',
        level: 'pro',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'togetherSelectedModel',
                    placeholder: 'e.g. meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
                    payload: "{\n  \"url\": \"https://api.together.xyz/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },
    'fireworks': {
        handler: OpenAICompatible,
        apiKeyName: 'fireworksApiKey',
        modelKeyName: 'fireworksSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#7c3aed', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#7c3aed', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://fireworks.ai/account/api-keys',
        consoleText: 'Fireworks Keys',
        name: 'Fireworks AI',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/fireworks.png',
        image_bg: '#1a0a2e',
        info: '<p>Fast open models via Fireworks AI inference.</p>',
        capability: 'Fireworks Inference',
        level: 'smart',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'fireworksSelectedModel',
                    placeholder: 'e.g. accounts/fireworks/models/llama-v3p1-70b-instruct',
                    payload: "{\n  \"url\": \"https://api.fireworks.ai/inference/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },
    'deepinfra': {
        handler: OpenAICompatible,
        apiKeyName: 'deepinfraApiKey',
        modelKeyName: 'deepinfraSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#22c55e', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#22c55e', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://deepinfra.com/dash/api_keys',
        consoleText: 'DeepInfra Keys',
        name: 'DeepInfra',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/deepinfra.png',
        image_bg: '#0c1a12',
        info: '<p>Serverless open models on DeepInfra (OpenAI-compatible).</p>',
        capability: 'DeepInfra',
        level: 'standard',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'deepinfraSelectedModel',
                    placeholder: 'e.g. meta-llama/Meta-Llama-3.1-70B-Instruct',
                    payload: "{\n  \"url\": \"https://api.deepinfra.com/v1/openai/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },
    'siliconflow': {
        handler: OpenAICompatible,
        apiKeyName: 'siliconflowApiKey',
        modelKeyName: 'siliconflowSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#3b82f6', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#3b82f6', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
        consoleText: 'SiliconFlow Keys',
        name: 'SiliconFlow',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/siliconcloud.png',
        image_bg: '#0b1220',
        info: '<p>SiliconFlow (SiliconCloud) — OpenAI-compatible Chinese/global models.</p>',
        capability: 'SiliconCloud',
        level: 'standard',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'siliconflowSelectedModel',
                    placeholder: 'e.g. deepseek-ai/DeepSeek-V3',
                    payload: "{\n  \"url\": \"https://api.siliconflow.cn/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"temperature\": 0.7,\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },

    'hyperbolic': {
        handler: OpenAICompatible,
        apiKeyName: 'hyperbolicApiKey',
        modelKeyName: 'hyperbolicSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#1a1a2e', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#a855f7', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://app.hyperbolic.xyz/settings',
        consoleText: 'Hyperbolic Keys',
        name: 'Hyperbolic AI',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/hyperbolic.png',
        image_bg: '#0f0a1a',
        info: '<p>Hyperbolic AI — OpenAI-compatible inference.</p>',
        capability: 'Hyperbolic',
        level: 'standard',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'hyperbolicSelectedModel',
                    placeholder: 'e.g. meta-llama/Meta-Llama-3.1-70B-Instruct',
                    payload: "{\n  \"url\": \"https://api.hyperbolic.xyz/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },
    'sambanova': {
        handler: OpenAICompatible,
        apiKeyName: 'sambanovaApiKey',
        modelKeyName: 'sambanovaSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: false,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#ee3424', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#ee3424', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://cloud.sambanova.ai/',
        consoleText: 'SambaNova Cloud',
        name: 'SambaNova',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/sambanova.png',
        image_bg: '#1a0505',
        info: '<p>SambaNova Cloud — fast open models (OpenAI-compatible).</p>',
        capability: 'SambaNova',
        level: 'smart',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'sambanovaSelectedModel',
                    placeholder: 'e.g. Meta-Llama-3.3-70B-Instruct',
                    payload: "{\n  \"url\": \"https://api.sambanova.ai/v1/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },
    'novita': {
        handler: OpenAICompatible,
        apiKeyName: 'novitaApiKey',
        modelKeyName: 'novitaSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#00d4aa', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#00d4aa', borderColor: 'rgba(255,255,255,0.12)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://novita.ai/account',
        consoleText: 'Novita Keys',
        name: 'Novita',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/novita.png',
        image_bg: '#041a14',
        info: '<p>Novita AI — OpenAI-compatible API gateway.</p>',
        capability: 'Novita',
        level: 'standard',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'custom_api', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'novitaSelectedModel',
                    placeholder: 'e.g. meta-llama/llama-3.1-70b-instruct',
                    payload: "{\n  \"url\": \"https://api.novita.ai/v3/openai/chat/completions\",\n  \"headers\": {\n    \"Content-Type\": \"application/json\",\n    \"Authorization\": \"Bearer {{API_KEY}}\"\n  },\n  \"body\": {\n    \"model\": \"{{MODEL_ID}}\",\n    \"messages\": \"{{MESSAGES}}\",\n    \"stream\": true\n  }\n}"
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4000 }
            ]
        }
    },

    // ─── Enterprise: AWS Bedrock + Google Vertex AI ───
    'bedrock': {
        handler: Bedrock,
        apiKeyName: 'bedrockApiKey',
        modelKeyName: 'bedrockSelectedModel',
        // Credential model: IAM Access Key ID (this tab) + Secret in Advanced — not a single Bedrock API key
        supportsApiKey: true,
        supportsFetchModels: true,
        apiKeyLabel: 'AWS Access Key ID',
        apiKeyPlaceholder: 'AKIA…',
        apiKeyHint: 'IAM Access Key ID. Secret Access Key + Region are in the Advanced tab (Save before Fetch).',
        fetchModelsHint: 'requires Secret + Region saved in Advanced',
        supportsImages: false,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#ff9900', borderRadius: '8px', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#ff9900', borderColor: 'rgba(255,153,0,0.25)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://console.aws.amazon.com/bedrock/',
        consoleText: 'Bedrock Console',
        name: 'AWS Bedrock',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/bedrock.png',
        image_bg: '#16161a',
        info: '<p>Amazon Bedrock ConverseStream (SigV4).</p>',
        capability: 'AWS Bedrock Runtime',
        level: 'pro',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model / Inference Profile ID',
                    storageKey: 'bedrockSelectedModel',
                    placeholder: 'e.g. anthropic.claude-3-5-sonnet-20240620-v1:0'
                }
            ],
            advancedSettings: [
                { type: 'text', id: 'secretAccessKey', label: 'Secret Access Key', default: '', placeholder: 'wJalrXUtnFEMI/K7MDENG/…', hint: 'Required. Access Key ID goes in the API Keys tab.' },
                { type: 'text', id: 'sessionToken', label: 'Session Token (optional)', default: '', placeholder: 'For temporary STS credentials' },
                { type: 'selection', id: 'region', label: 'AWS Region', default: 'us-east-1', options: [
                    { label: 'us-east-1', value: 'us-east-1' },
                    { label: 'us-west-2', value: 'us-west-2' },
                    { label: 'eu-west-1', value: 'eu-west-1' },
                    { label: 'eu-central-1', value: 'eu-central-1' },
                    { label: 'ap-northeast-1', value: 'ap-northeast-1' },
                    { label: 'ap-southeast-1', value: 'ap-southeast-1' },
                    { label: 'ap-south-1', value: 'ap-south-1' }
                ]},
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 1, step: 0.05, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 8192, step: 256, default: 4096 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0, max: 1, step: 0.05, default: 0.9 }
            ]
        }
    },
    'vertex': {
        handler: VertexAI,
        apiKeyName: 'vertexApiKey',
        modelKeyName: 'vertexSelectedModel',
        // OAuth access token (or API key if project allows) — still uses api_fetch UI
        supportsApiKey: true,
        supportsFetchModels: true,
        apiKeyLabel: 'Access Token / API Key',
        apiKeyPlaceholder: 'ya29.… or API key',
        apiKeyHint: 'Prefer gcloud auth print-access-token. Project ID + Location must be saved in Advanced before Fetch.',
        fetchModelsHint: 'needs Project ID in Advanced',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['HIGH', 'MEDIUM', 'LOW'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#4285f4', borderRadius: '50%', icon: ModelIcons.sendGemini },
            setupModal: { accentColor: '#4285f4', borderColor: 'rgba(66,133,244,0.25)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://console.cloud.google.com/vertex-ai',
        consoleText: 'Vertex AI Console',
        name: 'Google Vertex AI',
        image: 'https://i.postimg.cc/wTrxF6Lc/Vertex-AI-Logo-svg.png',
        image_bg: '#f8fafc',
        info: '<p>Gemini on Google Vertex AI (streamGenerateContent).</p>',
        capability: 'Vertex AI Gemini',
        level: 'pro',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'vertexSelectedModel',
                    placeholder: 'e.g. gemini-2.0-flash-001'
                }
            ],
            advancedSettings: [
                { type: 'text', id: 'projectId', label: 'GCP Project ID', default: '', placeholder: 'my-gcp-project', hint: 'Required. From Google Cloud Console.' },
                { type: 'selection', id: 'location', label: 'Location', default: 'us-central1', options: [
                    { label: 'us-central1', value: 'us-central1' },
                    { label: 'us-east1', value: 'us-east1' },
                    { label: 'us-west1', value: 'us-west1' },
                    { label: 'europe-west1', value: 'europe-west1' },
                    { label: 'europe-west4', value: 'europe-west4' },
                    { label: 'asia-northeast1', value: 'asia-northeast1' },
                    { label: 'asia-southeast1', value: 'asia-southeast1' },
                    { label: 'global', value: 'global' }
                ]},
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'topP', label: 'Top P', min: 0, max: 1, step: 0.05, default: 0.95 },
                { type: 'range', id: 'topK', label: 'Top K', min: 1, max: 100, step: 1, default: 40 },
                { type: 'range', id: 'maxOutputTokens', label: 'Max Output Tokens', min: 256, max: 8192, step: 256, default: 8192 }
            ]
        }
    },

    // ─── GitHub Copilot (subscription) + GitHub Models (official PAT) ───
    'githubcopilot': {
        handler: GitHubCopilot,
        apiKeyName: 'githubcopilotApiKey',
        modelKeyName: 'githubcopilotSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        apiKeyLabel: 'GitHub Token (PAT / OAuth)',
        apiKeyPlaceholder: 'ghp_… or gho_…',
        apiKeyHint: 'Needs an active Copilot plan. App exchanges this for a short-lived Copilot JWT automatically.',
        fetchModelsHint: 'lists models for your Copilot plan',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#238636', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#238636', borderColor: 'rgba(35,134,54,0.3)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://github.com/settings/copilot',
        consoleText: 'Copilot Settings',
        name: 'GitHub Copilot',
        image: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.46.0/files/dark/githubcopilot.png',
        image_bg: '#0d1117',
        info: '<p>GitHub Copilot Chat via api.githubcopilot.com (subscription required).</p>',
        capability: 'GitHub Copilot',
        level: 'pro',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'githubcopilotSelectedModel',
                    placeholder: 'e.g. gpt-4o'
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.3 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4096 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0, max: 1, step: 0.05, default: 1.0 },
                {
                    type: 'selection',
                    id: 'integrationId',
                    label: 'Integration ID',
                    default: 'vscode-chat',
                    options: [
                        { label: 'vscode-chat', value: 'vscode-chat' },
                        { label: 'copilot-chat', value: 'copilot-chat' }
                    ]
                }
            ]
        }
    },
    'githubmodels': {
        handler: GitHubModels,
        apiKeyName: 'githubmodelsApiKey',
        modelKeyName: 'githubmodelsSelectedModel',
        supportsApiKey: true,
        supportsFetchModels: true,
        apiKeyLabel: 'GitHub PAT (models:read)',
        apiKeyPlaceholder: 'github_pat_… or ghp_…',
        apiKeyHint: 'Fine-grained PAT with models: read. Official GitHub Models inference API.',
        supportsImages: true,
        supportsFiles: true,
        supportsWeb: true,
        supportsThink: true,
        think_how: ['low', 'medium', 'high'],
        supportsTools: true,
        supportsProject: true,
        supportsStudyMode: true,
        supportsImageGeneration: false,
        bypassAppQuota: true,
        styles: {
            sendBtn: { backgroundColor: '#0969da', borderRadius: '50%', icon: ModelIcons.sendChatGPT },
            setupModal: { accentColor: '#0969da', borderColor: 'rgba(9,105,218,0.3)', borderRadius: '6px', btnBorderRadius: '4px' }
        },
        consoleUrl: 'https://github.com/marketplace/models',
        consoleText: 'GitHub Models',
        name: 'GitHub Models',
        image: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/GitHub_Mark.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original',
        image_bg: '#ffffff',
        info: '<p>Official GitHub Models inference (models.github.ai).</p>',
        capability: 'GitHub Models',
        level: 'standard',
        setting_ui: {
            tabs: ['api_fetch', 'manual', 'advanced', 'docs'],
            inputs: [
                {
                    id: 'primary',
                    label: 'Model ID',
                    storageKey: 'githubmodelsSelectedModel',
                    placeholder: 'e.g. openai/gpt-4o'
                }
            ],
            advancedSettings: [
                { type: 'range', id: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1, default: 0.7 },
                { type: 'range', id: 'max_tokens', label: 'Max Tokens', min: 256, max: 16384, step: 256, default: 4096 },
                { type: 'range', id: 'top_p', label: 'Top P', min: 0, max: 1, step: 0.05, default: 1.0 }
            ]
        }
    }
};