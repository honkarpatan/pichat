export class QueryParser {
    static isImageGenerationQuery(query) {
        function levenshteinDistance(a, b) {
            const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(i));
            for (let j = 1; j <= b.length; j++) dp[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                }
            }
            return dp[a.length][b.length];
        }

        function isSimilarMatch(token, keywords, threshold = 0.8) {
            return keywords.some(keyword => {
                const distance = levenshteinDistance(token, keyword);
                const similarity = 1 - distance / Math.max(token.length, keyword.length);
                return similarity >= threshold;
            });
        }

        const actionKeywords = ["generate", "create", "draw", "sketch", "illustrate"];
        const subjectKeywords = ["image", "picture", "art", "artwork", "photo", "drawing", "img", "pic"];
        const exclusionKeywords = ["how", "explain", "tutorial", "learn","why","what"];

        const tokens = query.toLowerCase().split(/\s+/).filter(token => !["can", "you", "please", "of", "the", "to", "an", "a", "is", "are"].includes(token));
        const hasAction = tokens.some(token => actionKeywords.includes(token) || isSimilarMatch(token, actionKeywords));
        const hasSubject = tokens.some(token => subjectKeywords.includes(token) || isSimilarMatch(token, subjectKeywords));
        const hasExclusion = tokens.some(token => exclusionKeywords.includes(token));

        return hasAction && hasSubject && !hasExclusion;
    }

    static isImageRequest(query) {
        const lowerQuery = query.toLowerCase();
        const imageKeywords = ['image', 'images', 'photo', 'photos', 'picture', 'pictures', 'wallpaper', 'hd', 'visual', 'png', 'jpg', 'jpeg', 'gif'];
        if (imageKeywords.some(keyword => lowerQuery.includes(keyword))) return true;

        const imageQueryPattern = /(give me|show me|i want|fetch|get)\s.*?\s(images?|photos?|pictures?|wallpapers?)/;
        if (imageQueryPattern.test(lowerQuery)) return true;

        const contextKeywords = ['4k', 'hd', 'nature', 'art', 'scenery', 'design', 'graphics'];
        if (lowerQuery.split(/\s+/).some(word => contextKeywords.includes(word)) && lowerQuery.includes('image')) return true;

        return false; 
    }

    static processMathExpressions(text) {
        return text.replace(/([a-zA-Z\s]+:\s*\$?\d+\s*[\+\-\*\/]\s*\$?\d+\s*=\s*\$?\d+)/g, '\\( $1 \\)');
    }

    static summarizeMessage(content) {
        const codeBlockRegex = /```[\s\S]*?```|`[^`]*`/g;
        const codeBlocks = content.match(codeBlockRegex) || [];
        const contentWithoutCode = content.replace(codeBlockRegex, '');
        const sentences = contentWithoutCode.match(/[^\.!\?]+[\.!\?]+/g) || [];
        
        if (sentences.length <= 3) return content;

        const firstSentence = sentences[0];
        const middleSentence = sentences[Math.floor(sentences.length / 2)];
        const lastSentence = sentences[sentences.length - 1];
        let summary = [firstSentence, middleSentence, lastSentence].join(' ');

        if (codeBlocks.length > 0) summary += '\n\nCode:\n' + codeBlocks.join('\n');
        return summary;
    }

    static checkQueryFor_Class_methods_Name(query, namesArray) {
        const keywords = /(see|optimze|optimize|chk|check|fix|fx|func|function|functions|method|methods|class|classes|interface|in|minimal|review)/i;
        if (!keywords.test(query)) return null; 

        const words = query.split(/\s+/);
        const matches = [];
        for (let word of words) {
            for (let item of namesArray) {
                if (word.toLowerCase() === item.name.toLowerCase()) matches.push(item.name);
            }
        }
        return matches.length > 0 ? matches : null;
    }
}