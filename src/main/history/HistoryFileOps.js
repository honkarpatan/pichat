export class HistoryFileOps {
    // Smart Encryption/Decryption Helpers
    static encryptData(text) {
        // Handle Unicode/Emojis safely with Base64
        return "ENC::" + btoa(unescape(encodeURIComponent(text)));
    }

    static decryptData(text) {
        // Only decrypt if it starts with the ENC:: tag
        if (text.startsWith("ENC::")) {
            const base64Data = text.substring(5);
            return decodeURIComponent(escape(atob(base64Data)));
        }
        return text; // Return plain if not encrypted
    }

    static async saveActiveChat(app) {
        const fs = acode.require("fs");
        if (app.pathUrl && fs && app.currentConversation && app.currentConversation.id) {
            try {
                const convDirPath = `${app.pathUrl}/conversations`;
                const fileUrl = `${convDirPath}/chat_${app.currentConversation.id}.json`;
                
                // JSON Minified (Removed null, 2)
                let dataStr = JSON.stringify(app.currentConversation);
                
                // Apply Encryption if enabled
                if (app.enableEncryption) {
                    dataStr = this.encryptData(dataStr);
                }
                
                if (await fs(fileUrl).exists()) await fs(fileUrl).writeFile(dataStr);
                else await fs(convDirPath).createFile(`chat_${app.currentConversation.id}.json`, dataStr);
            } catch(e) { console.error("Error saving specific chat file", e); }
        }
    }

    static async renameChatFiles(app, conv) {
        const fs = acode.require("fs");
        if (app.pathUrl && fs && conv && conv.id) {
            try {
                let dataStr = JSON.stringify(conv); // Minified
                if (app.enableEncryption) {
                    dataStr = this.encryptData(dataStr);
                }
                await fs(`${app.pathUrl}/conversations/chat_${conv.id}.json`).writeFile(dataStr);
            } catch (e) { console.error('Error renaming chat files', e); }
        }
    }

    static async deleteChatFiles(app, convToDelete) {
        const fs = acode.require("fs");
        if (!convToDelete) return;

        // Delete associated image files (structured image.uri + legacy @@@IMG|)
        for (let message of convToDelete.chat) {
            if (message.role !== 'assistant') continue;
            try {
                let imagePath = null;
                if (message.type === 'image' && message.image?.uri) {
                    imagePath = message.image.uri;
                } else if (typeof message.content === 'string' && message.content.startsWith('@@@IMG|')) {
                    imagePath = message.content.split('|')[1];
                }
                if (imagePath && imagePath !== 'null' && fs) {
                    const imgFs = fs(imagePath);
                    if (await imgFs.exists()) await imgFs.delete();
                }
            } catch (error) { console.warn('Error deleting associated image:', error); }
        }

        // Delete Main JSON file gracefully
        if (app.pathUrl && fs && convToDelete.id) {
            const convDirPath = `${app.pathUrl}/conversations`;
            try {
                const file1 = `${convDirPath}/chat_${convToDelete.id}.json`;
                if(await fs(file1).exists()) await fs(file1).delete();
            } catch(e) { console.error('Error deleting JSON files', e); }
        }
    }
}