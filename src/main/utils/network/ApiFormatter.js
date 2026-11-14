export class ApiFormatter {
    
    // Extract text from a JSON-like string
    static extractText(str) {
        try {
            // Wrap the input in a valid JSON object to parse it correctly
            const jsonString = `{${str}}`;  
            const jsonObject = JSON.parse(jsonString);
            
            // Extract the text value and return it
            return jsonObject.text;
        } catch (error) {
            console.error("Invalid input:", error);
            return "";
        }
    }

    // Convert HF Chat to Gemini Model Format
    static convertToGeminiModelFormat(hfChat) {
        return {
            contents: hfChat.map(entry => ({
                role: entry.role === "assistant" ? "model" : entry.role, // Convert "assistant" to "model"
                parts: [{ text: entry.content }]
            }))
        };
    }

    // Convert HF Chat to Gemini Text Format
    static convertToGeminiTextFormat(hfChat) {
        return [
            {
                parts: hfChat.map(entry => ({ text: entry.content }))
            }
        ];
    }
    
    // Main Converter for HF to Gemini (Supports Text & Image)
    static convertHFToGemini(hfChat) {
        return hfChat.map(entry => {
            let geminiEntry = { role: entry.role === "assistant" ? "model" : entry.role, parts: [] };

            if (typeof entry.content === "string") {
                geminiEntry.parts.push({ text: entry.content });
            } else if (Array.isArray(entry.content)) {
                entry.content.forEach(item => {
                    if (item.type === "text") {
                        geminiEntry.parts.push({ text: item.text });
                    } else if (item.type === "image_url" && item.image_url?.url) {
                        geminiEntry.parts.push({
                            fileData: {
                                fileUri: item.image_url.url,
                                mimeType: "image/png" // Adjust MIME type as needed dynamically if required later
                            }
                        });
                    }
                });
            } // You can add support for file, media, record, camera here later

            return geminiEntry;
        });
    }
}