import {ConfigManager} from '../utils/ConfigManager.js';
export class ImageHandler {
    
    // ==========================================
    // 1. Upload to ImgBB (Requires app context for API keys)
    // ==========================================
    static async uploadBase64ToImgBB(app, base64String) {
        console.log('UPLOADBASE64TOIMGBB_________________]');
        
        // Shuffle the API keys randomly (using app context to access localVL)
        if (!app.localVL || app.localVL.length === 0) {
            console.error("No ImgBB API keys found.");
            return null;
        }
        
        let shuffledKeys = [...app.localVL].sort(() => Math.random() - 0.5);
        const expiration = 2592000; // 30 days in seconds

        for (let i = 0; i < shuffledKeys.length; i++) {
            const apiKey = shuffledKeys[i];

            try {
                const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}&expiration=${expiration}`, {
                    method: "POST",
                    body: new URLSearchParams({ image: base64String.split(",")[1] })
                });

                if (!response.ok) {
                    throw new Error(`API Key ${apiKey} failed with status: ${response.status}`);
                }

                const data = await response.json();
                if (data.success) {
                    console.log("Uploaded URL successfully:", data.data.url);
                    return data.data.url; // Return the uploaded image URL
                } else {
                    throw new Error(`Upload failed: ${data.error?.message || 'Unknown error'}`);
                }
            } catch (error) {
                console.warn(`Attempt ${i + 1} failed: ${error.message}`);
            }
        }

        console.error("All API keys failed. Could not upload image.");
        return null;
    }

    // ==========================================
    // 2. Upload to Gemini File API
    // ==========================================
    static async uploadBase64ToGemini(app, base64String, mimeType = "image/png") {
        // Fetch Gemini API key from app context or local storage
        const apiKey = app.geminiApiKey || app.geminiKey || ConfigManager.get('geminiApiKey');
        if (!apiKey) {
            console.error("Gemini API key not found for image upload.");
            return null;
        }

        const UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
        
        try {  
            // Convert Base64 to Binary
            const byteCharacters = atob(base64String.split(",")[1]); // Remove data URI prefix
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mimeType });
            console.log('Gemini Blob:', blob);
            
            // Upload to Gemini
            const uploadResponse = await fetch(UPLOAD_URL, {
                method: "POST",
                headers: {
                    "X-Goog-Upload-Command": "start, upload, finalize",
                    "X-Goog-Upload-Header-Content-Length": blob.size.toString(),
                    "X-Goog-Upload-Header-Content-Type": mimeType,
                },
                body: blob,
            });

            const data = await uploadResponse.json();
            if (data.file && data.file.uri) {
                console.log("File uploaded successfully to Gemini:", data.file.uri);
                return data.file.uri;
            } else {
                throw new Error(data.error?.message || "Failed to get file URI from Gemini API");
            }
        } catch (error) {
            console.error("Image upload to Gemini failed:", error);
            return null;
        }
    }

    // ==========================================
    // 3. Convert Blob URL to Standard Base64
    // ==========================================
    static async blobToBase64(blobUrl) {
        const blobToBase64Helper = (blob) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob); 
        });

        try {
            const response = await fetch(blobUrl);
            const blob = await response.blob(); 
            const base64Image = await blobToBase64Helper(blob);
            console.log("Base64 Image Generated");
            return base64Image;
        } catch (error) {
            console.error("Error converting blob to base64:", error);
            return null;
        }
    }
  
    // ==========================================
    // 4. Compress Image & Convert to Base64
    // ==========================================
    static async blobToCompressedBase64(blobUrl, quality = 0.4, maxWidth = 800, maxHeight = 800) {
        try {
            const response = await fetch(blobUrl);
            const blob = await response.blob();

            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onload = () => {
                    const img = new Image();
                    img.src = reader.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;

                        // Resize logic
                        if (width > maxWidth || height > maxHeight) {
                            if (width > height) {
                                height *= maxWidth / width;
                                width = maxWidth;
                            } else {
                                width *= maxHeight / height;
                                height = maxHeight;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;

                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // Compress to Base64 (JPEG format helps reduce size)
                        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);

                        // Calculate size for debugging
                        const sizeInBytes = (compressedBase64.length * (3 / 4)) - 2; 
                        const sizeInKB = (sizeInBytes / 1024).toFixed(2);
                        console.log("Compressed Base64 Size:", sizeInKB, "KB");

                        resolve(compressedBase64);
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        } catch (error) {
            console.error("Error compressing image:", error);
            return null;
        }
    }
}