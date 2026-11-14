import plugin from '../../../plugin.json';
import { ChatUI } from '../ui/ChatUI.js';
import { ConfigManager } from '../utils/ConfigManager.js';
import { TitleGenerator } from './TitleGenerator.js';

const fs = acode.require("fs");

export class ImageGenerationHandler {
  static async run(handler, prompt, config, modelType) {
    const app = handler.app;

    if (app.isFetching) return;
    app.isFetching = true;
    app._isMessageTransactionActive = true;

    // 1. Save user prompt to history
    await app.chatHistoryManager?.addMessageToHistory('user', prompt, null, null, true, false);
    if (app.chatHistoryManager && typeof app.chatHistoryManager.renderChatHistory === 'function') {
      await app.chatHistoryManager.renderChatHistory(true, false);
    }

    // 2. Prepare UI for Image Loading
    ChatUI.updateSendStopBtn(app, 'run');
    
    // 🟢 CRITICAL FIX: createMessageElement now lives inside liveUI
    const botMessageElement = handler.liveUI.createMessageElement('assistant', '');
    if (app.chatBox) app.chatBox.appendChild(botMessageElement);

    // Remove previous message height class and add to current (For Image Gen)
    document.querySelectorAll('.assistant-message').forEach(m => m.classList.remove('increaseChatHeight'));
    botMessageElement.classList.add('increaseChatHeight');

    const messageContainer = document.createElement('div');
    messageContainer.className = 'gpt-message-inner-holder gpt-fast-wave';

    const loadingControls = document.createElement('div');
    loadingControls.className = 'assistantLoading-message';
    loadingControls.innerHTML = '🎨 Generating Image... Please wait.';
    loadingControls.style.display = 'block';

    botMessageElement.appendChild(loadingControls);
    botMessageElement.appendChild(messageContainer);

    if (app.chatBox) {
        app.chatBox.scrollTop = app.chatBox.scrollHeight;
    }

    try {
      // 3. Get Model ID and API Key specifically for Image Gen
      const apiKey = config.apiKeyName ? ConfigManager.get(config.apiKeyName): '';
      const imageModelId = config.imageModelKeyName ? ConfigManager.get(config.imageModelKeyName): '';

      // Custom API Logic for Image Generation
      const isCustomImage = ConfigManager.get(`${modelType}UseCustomApi_image_model`) === 'true';
      let imageUrl = null;

      if (isCustomImage) {
        let customJsonStr = ConfigManager.get(`${modelType}CustomPayload_image_model`);
        if (customJsonStr) {
          customJsonStr = customJsonStr.replace(/{{API_KEY}}/g, apiKey || '');
          customJsonStr = customJsonStr.replace(/{{MODEL_ID}}/g, imageModelId || '');

          // Replace "{{PROMPT}}" with actual prompt safely
          customJsonStr = customJsonStr.replace(/"{{PROMPT}}"/g, JSON.stringify(prompt));

          let reqConfig;
          try {
            reqConfig = JSON.parse(customJsonStr);
          } catch(e) {
            throw new Error("Invalid JSON in Custom Image API settings. Check syntax.");
          }

          const response = await fetch(reqConfig.url, {
            method: 'POST',
            headers: reqConfig.headers || {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(reqConfig.body),
            signal: app.currentRequestController.signal
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Custom Image API Error (${response.status}): ${errText}`);
          }

          // Auto-detect if response is a direct image Blob (like HuggingFace) or JSON url
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("image/")) {
            const blob = await response.blob();
            imageUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            const data = await response.json();
            // Handle multiple popular JSON response structures
            if (data.data && data.data[0] && data.data[0].url) imageUrl = data.data[0].url;
            else if (data.data && data.data[0] && data.data[0].b64_json) imageUrl = `data:image/png;base64,${data.data[0].b64_json}`;
            else if (data.url) imageUrl = data.url;
            else if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64) imageUrl = `data:image/jpeg;base64,${data.predictions[0].bytesBase64}`;
            else throw new Error("Could not parse image URL from Custom API response.");
          }
        }
      }
      // Fallback to Native Generator if Custom is OFF
      else if (config.handler && typeof config.handler.generateImage === 'function') {
        imageUrl = await config.handler.generateImage(prompt, apiKey, imageModelId);
      } else {
        throw new Error(`${config.name} image generation handler is not fully implemented yet.`);
      }

      if (imageUrl) {
        console.log("imageUrl ",imageUrl);
        let savedLocalUri = null;
        let renderUrl = imageUrl;

        // Local Image Saving Logic (Saves Memory & Tokens)
        if (typeof fs !== 'undefined' && typeof window.ACODE_FILE_STORAGE !== 'undefined' && typeof plugin !== 'undefined') {
          try {
            const imagesDirPath = `${window.ACODE_FILE_STORAGE}/images`;
            console.log('imagesDirPath :',imagesDirPath);
            const existImagesDir = await fs(imagesDirPath).exists();
            if (!existImagesDir) {
              console.log("Image Dir was Created !");
              await fs(`${window.ACODE_FILE_STORAGE}`).createDirectory('images');
            }

            const response = await fetch(imageUrl);
            console.log('response :',response);
            const imageBlob = await response.blob();
            console.log('imageBlob :',imageBlob);
            const randomImgName = 'img_' + Date.now();
            console.log('randomImgName :',randomImgName);
            await fs(imagesDirPath).createFile(`${randomImgName}.png`, imageBlob);

            savedLocalUri = `${imagesDirPath}/${randomImgName}.png`;
            console.log('savedLocalUri :',savedLocalUri);

            if (typeof acode !== 'undefined') {
              const toInternalUrl = acode.require('toInternalUrl');
              renderUrl = await toInternalUrl(savedLocalUri);
              console.log('renderUrl :',renderUrl);
            }
          } catch(e) {
            console.error("Failed to save image locally", e);
          }
        }

        // Modern Image Card UI with Hover Overlay Actions
        const imageHtml = `
        <div class="gpt-modern-image-card" style="position: relative; display: inline-block; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.25); max-width: 100%; border: 1px solid var(--border-color, rgba(255,255,255,0.1)); margin-top: 8px;">
        <img src="${renderUrl}" style="width: 100%; height: auto; display: block; object-fit: cover;" alt="Generated Image" />
        <div class="gpt-image-overlay-actions" style="position: absolute; bottom: 10px; right: 10px; display: flex; gap: 10px; background: rgba(0,0,0,0.65); padding: 8px 12px; border-radius: 20px; backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.3s ease;">
        <button onclick="window.gptPreviewImage('${renderUrl}')" style="background: transparent; border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; transform: scale(1);" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" title="Fullscreen Preview">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>
        </button>
        <button onclick="window.gptDownloadImage('${savedLocalUri || renderUrl}')" style="background: transparent; border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; transform: scale(1);" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" title="Download Image">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        </div>
        <style>
        .gpt-modern-image-card:hover .gpt-image-overlay-actions { opacity: 1 !important; }
        @media (max-width: 768px) { .gpt-modern-image-card .gpt-image-overlay-actions { opacity: 1 !important; } }
        </style>
        </div>
        <div style="font-size:11px; color:var(--secondary-text-color); margin-top:4px;">Generated: ${prompt.substring(0, 50)}...</div>`;

        messageContainer.innerHTML = imageHtml;

        // Structured message (type: image) — no more @@@IMG| prefix
        const { makeImageMessage } = await import('../utils/message/MessageSchema.js');
        const historyContent = makeImageMessage('assistant', {
          uri: savedLocalUri || null,
          prompt
        });

        let title = null;
        const currentChat = app.conversations[parseInt(app.currentConversationIndex)];

        if (currentChat && currentChat.chat.length === 1) {
            // 🟢 CRITICAL FIX: Reference TitleGenerator directly
            title = await TitleGenerator.generate(app, prompt, config, modelType);
            if (app.chatRenderer?.pushTitle) {
                app.chatRenderer.pushTitle(title);
            }
        }

        // Unlock transaction before saving
        app._isMessageTransactionActive = false;

        if (true) {
            console.log('💾 [DEBUG] Executing Final Batch File Save for Image...');

            // 1. Add structured message to History
            await app.chatHistoryManager?.addMessageToHistory('assistant', historyContent, title, null, false, true);

            // 2. Force Sidebar UI & JSON update
            if (app.chatHistoryManager && typeof app.chatHistoryManager.renderChatHistory === 'function') {
                await app.chatHistoryManager.renderChatHistory(true, false);
            }
            if (app.chatHistoryManager && typeof app.chatHistoryManager.updateCurrentConversationIndex === 'function') {
                app.chatHistoryManager.updateCurrentConversationIndex();
            }
        }

      } else {
        throw new Error("No image URL returned from API.");
      }

    } catch (error) {
      console.error('Image Gen Error:', error);
      messageContainer.innerHTML = `<span style="color:#f11;">Error generating image: ${error.message}</span>`;

      let title = null;
      const currentChat = app.conversations[parseInt(app.currentConversationIndex)];
      if (currentChat && currentChat.chat.length === 1) title = "Image Error";

      // Unlock before saving error!
      app._isMessageTransactionActive = false;

      // Save structured error message (no @@@!!! prefix)
      const { makeErrorMessage } = await import('../utils/message/MessageSchema.js');
      await app.chatHistoryManager?.addMessageToHistory('assistant', makeErrorMessage('assistant', `Error: ${error.message}`), title, null, false, true);

      if (app.chatHistoryManager && typeof app.chatHistoryManager.renderChatHistory === 'function') {
          await app.chatHistoryManager.renderChatHistory(true, false);
      }
      if (app.chatHistoryManager && typeof app.chatHistoryManager.updateCurrentConversationIndex === 'function') {
          app.chatHistoryManager.updateCurrentConversationIndex();
      }
    } finally {
      loadingControls.style.display = 'none';
      app.isFetching = false;
      app._isMessageTransactionActive = false; // Safety catch
      ChatUI.updateSendStopBtn(app, 'stop');
      if (app.chatBox) {
        app.chatBox.scrollTop = app.chatBox.scrollHeight;
      }
    }
  }
}