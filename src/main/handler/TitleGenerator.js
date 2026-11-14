import { ConfigManager } from '../utils/ConfigManager.js';

export class TitleGenerator {
    static async generate(app, userMessage, config, modelType) {
        const fallbackTitle = userMessage.split(' ').slice(0, 4).join(' ') + '...';
        try {
            if (!config || modelType === 'texttoimage') return fallbackTitle;
            const prompt = `Write a short, engaging chat title (3 to 5 words) for this prompt. Do not use quotes, punctuation or prefixes. Prompt: "${userMessage}"`;
            const apiKey = config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null;
            const modelId = config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null;

            if (config.handler.generateTitle) {
                let generatedTitle = await Promise.race([
                    config.handler.generateTitle(prompt, apiKey, modelId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
                if (generatedTitle && generatedTitle.trim().length > 0) {
                    return generatedTitle.replace(/["']/g, '').replace(/^(Title:|Chat Title:|Title\s?:|\*\*Title:\*\*)/i, '').trim();
                }
            }
        } catch (e) {}
        return fallbackTitle;
    }
}