// src/main/core/agent/AcodeStudyAgent.js

// 🟢 আপনার WebSearch ক্লাস ইমপোর্ট করা হলো Load Balancing এর জন্য
import { WebSearch } from '../../utils/network/WebSearch.js'; 

const TAG = '[AcodeStudyAgent]';

export class AcodeStudyAgent {
    static getToolsSchema() {
        return [
            {
                name: "fetch_educational_images",
                description: "Fetch multiple high-quality educational image URLs for a given study topic. MUST use this in Study Mode.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        topic: { type: "STRING", description: "The specific topic or concept." }
                    },
                    required: ["topic"]
                }
            }
        ];
    }

    static async executeTool(functionCall) {
        const { name, args = {} } = functionCall || {};
        if (name !== 'fetch_educational_images') return { error: `Unknown tool: ${name}` };
        
        try {
            console.log(TAG, `Fetching premium images via Tavily API for: ${args.topic}`);
            
            // 🟢 Get the next API key using your Round-Robin method!
            let apiKey;
            if (typeof WebSearch._getNextTavilyKey === 'function') {
                apiKey = WebSearch._getNextTavilyKey();
            } else {
                // Fallback just in case
                apiKey = "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";
            }

            // 🟢 Tavily API Call specifically customized for Educational Images
            const response = await fetch("https://api.tavily.com/search", {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    // "diagram" বা "illustration" যোগ করে দেওয়া হলো যাতে মানুষের ছবি না এসে সাইন্সের ডায়াগ্রাম আসে
                    query: args.topic + " high quality educational diagram illustration",
                    search_depth: "basic",
                    include_images: true, // 🔥 This is the magic parameter!
                    include_answer: false,
                    max_results: 2 // We just need images, so keeping text results low to save credits
                })
            });
            
            if (!response.ok) {
                throw new Error(`Tavily API failed with status: ${response.status}`);
            }

            const data = await response.json();
            const rawUrls = data.images || [];

            if (rawUrls.length === 0) return { error: "No relevant images found via Tavily." };

            let validUrls = [];

            // 🟢 Ping check (Just to be 100% sure the image loads and is not a 404)
            for (const imgUrl of rawUrls) {
                if (validUrls.length >= 3) break; // টপ ৩টি ছবি নিলেই হবে
                try {
                    const res = await fetch(imgUrl, { method: 'HEAD', mode: 'cors' });
                    if (res.ok) {
                        validUrls.push(imgUrl);
                    } else {
                        console.warn(TAG, `Broken link skipped: ${imgUrl}`);
                    }
                } catch (e) {
                    // CORS এর কারণে HEAD রিকোয়েস্ট ফেইল করলে, আমরা লিংকের উপর ভরসা করে সেটাকে গ্যালারিতে অ্যাড করে নেব
                    // কারণ আমাদের ফ্রন্টএন্ডে (ContextBuilder) তো `onerror="this.style.display='none'"` বসানোই আছে!
                    validUrls.push(imgUrl); 
                }
            }

            return { 
                success: true, 
                topic: args.topic,
                images: validUrls.slice(0, 3) 
            };
            
        } catch (e) {
            console.error(TAG, 'Error fetching images:', e);
            return { error: e.message || "Failed to fetch images." };
        }
    }
}