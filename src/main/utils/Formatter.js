export class Formatter {
    static getFormattedDate() {
        const currentDate = new Date();
        return `${String(currentDate.getDate()).padStart(2, '0')}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${currentDate.getFullYear()}`;
    }

    static getFormattedTime() {
        const currentDate = new Date();
        return `${currentDate.getHours()}:${currentDate.getMinutes()}:${currentDate.getSeconds()}`;
    }

    static getConversationGroupLabel(conversationDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const parts = conversationDate.split('-');
        const dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
        dateObj.setHours(0, 0, 0, 0);

        const diffTime = today.getTime() - dateObj.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return "Today";
        } else if (diffDays === 1) {
            return "Yesterday";
        } else if (diffDays > 1 && diffDays <= 7) {
            return "Last 7 Days";
        } else if (diffDays > 7 && diffDays <= 30) {
            return "Last 30 Days";
        } else {
            return "Older";
        }
    }

    static escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    static isImageLink(url) {
        const knownImageHosts = ['gstatic.com', 'imgur.com', 'flickr.com', 'unsplash.com', 'photobucket.com', 'shutterstock.com', 'pixabay.com', 'freepik.com', 'tinypic.com', '500px.com', 'deviantart.com', 'imgbox.com', 'imageshack.us', 'postimg.cc', 'picpaste.com', 'pexels.com', 'gyazo.com', 'snag.gy', 'picsee.co', 'pinterest.com', 'reddit.com', 'encrypted-tbn0.gstatic.com', 'media.istockphoto','i0.wp'];
        return knownImageHosts.some(host => url.includes(host)) || /\.(png|jpg|jpeg|gif|webp)$/i.test(url);
    }

    static generateRandomName() {
        return Math.random().toString(36).substring(2, 15);
    }

    static countTokens(message) {
        return message.split(/\s+/).length;
    }

    static replaceThinkDivTags(input) {
        // Modern HTML5 Details/Summary for Collapsible Thinking Process
        const arrowSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px; margin-bottom:-2px;"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        
        //  Removed 'open' attribute so it stays collapsed by default. Changed text to "Show Thinking".
        let output = input
            .replace(/(<think>|&lt;think&gt;)/gi, `<details class="gpt-think-box"><summary>${arrowSVG} Show Thinking</summary><div class="gpt-think-content">`)
            .replace(/(<\/think>|&lt;\/think&gt;)/gi, "</div></details>");
            
        const openCount = (output.match(/<details class="gpt-think-box"/g) || []).length;
        const closeCount = (output.match(/<\/details>/g) || []).length;
        if (openCount > closeCount) {
            output += "</div></details>";
        }
        
        return output;
    }

    static removeThinkTags(str) {
        return str.replace(/(<think>|&lt;think&gt;|<\/think>|&lt;\/think&gt;)/gi, '');
    }

    /**
     * Single markdown pipeline for live stream, finalize, and history reload.
     * - Enables markdown-it `breaks` so single `\n` becomes <br> (poems/chat).
     * - Same post-processors everywhere (image links, think blocks).
     */
    static renderMarkdown(app, text, opts = {}) {
        const src = text == null ? '' : String(text);
        const skipThinkBox = !!(opts && opts.skipThinkBox);
        let out;

        if (app?.md && typeof app.md.render === 'function') {
            // Once: single newlines → <br> (default markdown collapses them to space)
            if (!app._mdBreaksEnabled) {
                try {
                    if (typeof app.md.set === 'function') app.md.set({ breaks: true });
                    else if (app.md.options) app.md.options.breaks = true;
                    app._mdBreaksEnabled = true;
                } catch (_) {
                    app._mdBreaksEnabled = true; // don't retry every token
                }
            }
            try {
                out = app.md.render(src);
            } catch (_) {
                out = null;
            }
        }

        if (out == null) {
            // No markdown engine — escape + keep newlines visible
            out = src
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>\n');
        }

        if (typeof app?.parseImageLinks === 'function') {
            try { out = app.parseImageLinks(out); } catch (_) {}
        }
        // Never nest gpt-think-box details inside Thought row body (OpenCode: reasoning is a part, not HTML details)
        if (!skipThinkBox) {
            if (typeof app?.replaceThinkDivTags === 'function') {
                try { out = app.replaceThinkDivTags(out); } catch (_) {}
            } else {
                out = Formatter.replaceThinkDivTags(out);
            }
        } else {
            // Strip residual tags so they never show as raw or nested UI
            out = Formatter.removeThinkTags(out);
            out = out.replace(/&lt;\/?think(?:ing)?&gt;/gi, '');
        }
        return out;
    }

    /** Plain title for length / stream (strip markdown markers). */
    static formatChatTitlePlain(title) {
        let s = String(title == null ? '' : title);
        s = s.replace(/\*\*/g, '');
        s = s.replace(/\*/g, '');
        s = s.replace(/`+/g, '');
        s = s.replace(/^#+\s*/gm, '');
        s = s.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        return s;
    }

    /**
     * Safe light markdown for chat titles (sidebar + top bar).
     * Supports **bold**, *italic*, `code` only — all other text escaped.
     */
    static formatChatTitleHtml(title) {
        let s = String(title == null ? '' : title);
        s = s.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
        s = s.replace(/`([^`]+?)`/g, '<code style="font-size:0.9em;opacity:.9">$1</code>');
        s = s.replace(/^#+\s+/, '');
        // Drop leftover markers from truncated/unbalanced markdown
        s = s.replace(/\*+/g, '').replace(/`+/g, '');
        return s || 'New Chat';
    }
}
