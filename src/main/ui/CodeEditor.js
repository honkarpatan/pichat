// src/main/ui/codeEditor.js
//
// Level-up pass: re-enabled + polished header (filename + language badge),
// working copy button, word-wrap toggle, line count. Matches the "code block
// chrome" convention modern AI tools (Claude/ChatGPT/Cursor) use.

export class CodeEditorViewer {
    static getViewerHTML(code, language, filename) {
        // Base64 encoding ensures no syntax breaks the iframe HTML structure
        const base64Code = btoa(unescape(encodeURIComponent(code)));
        const lineCount = code.split('\n').length;
        const safeLang = (language || 'plaintext').toLowerCase();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${filename}</title>
            <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
            <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.css" rel="stylesheet" />
            <style>
                * { box-sizing: border-box; }
                body { margin: 0; background: #1d1f21; color: #c5c8c6; font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace; padding: 0; overflow: hidden; display: flex; flex-direction: column; height: 100vh; }
                .header {
                    display: flex; justify-content: space-between; align-items: center;
                    background: #151515; padding: 9px 14px; border-bottom: 1px solid #333;
                    font-size: 12.5px; color: #8abeb7; flex-shrink: 0;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.4); z-index: 10;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }
                .header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
                .header-filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
                .header-lang-badge { background: #2a2a2a; padding: 2px 8px; border-radius: 10px; color: #b5bd68; font-size: 11px; flex-shrink: 0; }
                .header-lines { color: #666; font-size: 11px; flex-shrink: 0; }
                .header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
                .header-btn {
                    display: flex; align-items: center; gap: 5px; cursor: pointer;
                    background: #232323; border: 1px solid #333; border-radius: 6px;
                    padding: 4px 9px; color: #ccc; font-size: 11.5px; user-select: none;
                    transition: background 0.15s ease;
                }
                .header-btn:active { background: #333; }
                .header-btn.active { color: #8abeb7; border-color: #3a5a55; }
                .content-wrapper { flex: 1; overflow: auto; padding: 16px; background: #1d1f21; }
                pre[class*="language-"] { margin: 0 !important; border-radius: 6px !important; background: transparent !important; padding: 0 !important; }
                code[class*="language-"], pre[class*="language-"] { text-shadow: none !important; font-size: 13px; line-height: 1.5; }
                .line-numbers .line-numbers-rows { border-right: 1px solid #444; padding-right: 10px !important; }
                body.wrap-on pre[class*="language-"] > code { white-space: pre-wrap !important; word-break: break-word !important; }
            </style>
        </head>
        <body class="line-numbers">

            <div class="header">
                <div class="header-left">
                    <span class="header-filename">${filename}</span>
                    <span class="header-lang-badge">${safeLang.toUpperCase()}</span>
                    <span class="header-lines">${lineCount} lines</span>
                </div>
                <div class="header-right">
                    <div class="header-btn" id="wrap-btn" title="Toggle word wrap">↩ Wrap</div>
                    <div class="header-btn" id="copy-btn" title="Copy code">⧉ Copy</div>
                </div>
            </div>

            <div class="content-wrapper">
                <pre><code id="code-block" class="language-${safeLang}">Loading Code...</code></pre>
            </div>

            <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-autoloader.min.js"></script>

            <script>
                let decodedCode = '';
                try {
                    decodedCode = decodeURIComponent(escape(atob("${base64Code}")));
                    const codeBlock = document.getElementById('code-block');
                    codeBlock.textContent = decodedCode;
                    Prism.highlightElement(codeBlock);
                } catch(e) {
                    document.getElementById('code-block').textContent = "Error decoding file content.";
                }

                document.getElementById('copy-btn').addEventListener('click', function() {
                    const btn = this;
                    navigator.clipboard.writeText(decodedCode).then(() => {
                        const original = btn.innerHTML;
                        btn.innerHTML = '✓ Copied';
                        btn.classList.add('active');
                        setTimeout(() => { btn.innerHTML = original; btn.classList.remove('active'); }, 1200);
                    }).catch(() => {
                        btn.innerHTML = '✗ Failed';
                        setTimeout(() => { btn.innerHTML = '⧉ Copy'; }, 1200);
                    });
                });

                document.getElementById('wrap-btn').addEventListener('click', function() {
                    document.body.classList.toggle('wrap-on');
                    this.classList.toggle('active');
                });
            </script>
        </body>
        </html>`;
    }
}