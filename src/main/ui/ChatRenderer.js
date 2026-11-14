// src/main/ui/ChatRenderer.js
import { ChatUI } from './ChatUI.js';
import { buildEventMessageElement, applyEventMessageStylesOnce } from './ChatEventUI.js';
import { addCopyButton } from '../utils/editor/CodeBlockHelper.js'; 
import { Formatter } from '../utils/Formatter.js';
import { ConfigManager } from '../utils/ConfigManager.js';
import { normalizeMessage, MSG_TYPE } from '../utils/message/MessageSchema.js'; 
import { bindDiffViewCollapse } from '../utils/file/FileCards.js'; 
import { PartsRenderer } from '../utils/message/PartsRenderer.js'; 
import { getMessageParts } from '../utils/message/MessagePart.js';

const TASK_COMPLETE_MARKER = /\s*TASK_COMPLETED\s*$/;

function taskCompleteBadgeHtml() {
  return `<div class="gpt-task-complete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Task completed</span></div>`;
}

export class ChatRenderer {
  constructor(pluginContext) {
    this.app = pluginContext;
  }

  _ensureMermaidLoaded() {
      if (!window.mermaidLoading) {
          window.mermaidLoading = true;
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.8.0/dist/mermaid.min.js';
          script.onload = () => {
              window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
              window.mermaidReady = true;
              document.dispatchEvent(new CustomEvent('mermaid-ready'));
          };
          document.head.appendChild(script);
      }
  }

  _escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Same pipeline as live stream (Formatter.renderMarkdown) — one path everywhere. */
  _renderMarkdownForMessage(text) {
    return Formatter.renderMarkdown(this.app, text);
  }

  /**
   * Settings: markdownHeadingStyle = collapsible | normal
   * Default collapsible. Live stream + history share this.
   */
  shouldCollapseMarkdownHeaders(msg) {
    let style = 'collapsible';
    try {
      if (this.app.settingsStore?.get) {
        style = this.app.settingsStore.get('markdownHeadingStyle', 'collapsible') || 'collapsible';
      } else {
        const v = ConfigManager.get('markdownHeadingStyle');
        if (v && v !== 'null') style = String(v);
      }
    } catch (_) {}
    if (style === 'normal') return false;
    if (style === 'collapsible') return true;
    // legacy auto: agent/study or message flag
    if (msg?.collapseMarkdownHeaders === true) return true;
    return !!(this.app.isEnableAgentMode || this.app.isEnableStudyMode);
  }

  _convertHeadingsToCollapsibleSections(container) {
    if (!container) return;
    const HEADING_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    const children = Array.from(container.children);
    const headingLevels = children.filter(el => HEADING_TAGS.includes(el.tagName)).map(el => parseInt(el.tagName[1], 10));
    if (headingLevels.length === 0) return;

    const minLevel = Math.min(...headingLevels);
    const frag = document.createDocumentFragment();
    let current = null;

    const flush = () => {
      if (!current) return;
      const card = document.createElement('div');
      card.className = 'gpt-md-section';
      card.style.marginLeft = `${(current.level - minLevel) * 14}px`;

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'gpt-md-section-header';
      header.setAttribute('aria-expanded', 'false');
      header.innerHTML = `<span class="gpt-md-section-title">${current.headerEl.innerHTML}</span>
        <span class="gpt-md-section-chevron"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg></span>`;

      const body = document.createElement('div');
      body.className = 'gpt-md-section-body';
      const bodyInner = document.createElement('div');
      bodyInner.className = 'gpt-md-section-body-inner';
      current.bodyEls.forEach(el => bodyInner.appendChild(el));
      body.appendChild(bodyInner);

      header.addEventListener('click', () => {
        const open = card.classList.toggle('is-open');
        header.setAttribute('aria-expanded', String(open));
      });

      card.appendChild(header);
      card.appendChild(body);
      frag.appendChild(card);
      current = null;
    };

    children.forEach(el => {
      if (HEADING_TAGS.includes(el.tagName)) {
        flush();
        current = { level: parseInt(el.tagName[1], 10), headerEl: el, bodyEls: [] };
      } else if (current) {
        current.bodyEls.push(el);
      } else {
        frag.appendChild(el);
      }
    });
    flush();

    container.innerHTML = '';
    container.appendChild(frag);
  }

  _addHtmlPreviewTriggers(container) {
    if (!container) return;
    const blocks = container.querySelectorAll('pre[class*="language-"]');

    blocks.forEach(block => {
      if (block.nextElementSibling?.classList?.contains('gpt-canvas-trigger')) return;
      const codeEl = block.querySelector('code');
      if (!codeEl) return;

      const rawContent = codeEl.textContent;
      if (!rawContent || !rawContent.trim()) return;

      const langClass = Array.from(block.classList).find(c => c.startsWith('language-')) || 'language-txt';
      const lang = langClass.replace('language-', '');

      const isMermaid = lang === 'mermaid' || /^\s*(graph|flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|pie|journey|erDiagram|gitGraph|mindmap|timeline|quadrantChart)\b/.test(rawContent);

      if (isMermaid) {
          const trigger = document.createElement('div');
          trigger.className = 'gpt-canvas-trigger';
          trigger.style.cssText = "background: rgba(75, 93, 209, 0.15); border: 1px solid rgba(75, 93, 209, 0.3); border-radius: 6px; padding: 6px 12px; color: #7b8dfa; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s ease; margin-top: 5px;";
          trigger.innerHTML = `<span class="btn-text">▶ Render Diagram</span><span style="font-size:10px; opacity:0.7;">Mermaid.js</span>`;

          trigger.addEventListener('click', () => {
              let existingPreview = block.nextElementSibling?.nextElementSibling;
              if (existingPreview && existingPreview.classList.contains('gpt-mermaid-preview')) {
                  existingPreview.remove();
                  block.style.display = 'block';
                  trigger.querySelector('.btn-text').textContent = '▶ Render Diagram';
                  return;
              }

              block.style.display = 'none';

              const previewDiv = document.createElement('div');
              previewDiv.className = 'gpt-mermaid-preview';
              previewDiv.style.cssText = "background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-top: 8px; overflow-x: auto; text-align: center; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);";

              trigger.insertAdjacentElement('afterend', previewDiv);
              trigger.querySelector('.btn-text').textContent = '▼ Hide Diagram & Show Code';

              this._ensureMermaidLoaded();

              const renderId = 'mermaid-' + Math.random().toString(36).substr(2, 9);

              const diagramTarget = document.createElement('div');
              diagramTarget.className = 'mermaid';
              diagramTarget.id = renderId;
              diagramTarget.textContent = rawContent;
              previewDiv.appendChild(diagramTarget);

              const render = () => {
                  if (window.mermaidReady && window.mermaid) {
                      try {
                          window.mermaid.run({ nodes: [diagramTarget] }).catch(e => {
                              previewDiv.innerHTML = `<span style="color:#ff4d4d; font-size:12px;">Syntax error in diagram. Try asking AI to correct it.</span>`;
                          });
                      } catch(e) {}
                  } else {
                      const loader = document.createElement('span');
                      loader.style.cssText = "color:#4b5dd1; font-size:12px;";
                      loader.textContent = "Loading rendering engine...";
                      previewDiv.prepend(loader);

                      document.addEventListener('mermaid-ready', () => {
                          loader.remove();
                          render();
                      }, { once: true });
                  }
              };
              render();
          });

          block.insertAdjacentElement('afterend', trigger);
          return;
      }

      if (!this.app.canvasManager || !this.app.canvasManager.isEnabled()) return;
      const trigger = document.createElement('div');
      trigger.className = 'gpt-canvas-trigger';

      let mode = 'inline-code';
      let btnText = `▶ View ${lang.toUpperCase()} Code`;

      if (lang === 'html' || lang === 'xml') {
          mode = 'inline';
          btnText = '▶ Preview HTML';
      } else if (lang === 'md' || lang === 'markdown') {
          mode = 'inline-md';
          btnText = '▶ Preview Markdown';
      }

      trigger.textContent = btnText;
      trigger.addEventListener('click', () => {
          this.app.canvasManager.open({
              title: `${lang.toUpperCase()} Snippet`,
              mode: mode,
              src: rawContent,
              language: lang
          });
      });

      block.insertAdjacentElement('afterend', trigger);
    });
  }

  async pushTitle(title) {
    const gptTopTitle = document.querySelector('#gpt-top-title');

    if (this.app.titleTimeOut) {
      clearTimeout(this.app.titleTimeOut);
      this.app.titleTimeOut = null;
    }
    if (this.app.textStreamingInterval) {
      clearInterval(this.app.textStreamingInterval);
      this.app.textStreamingInterval = null;
    }

    if (!title) {
      if (gptTopTitle) {
        const fallback = this.app.gptTopTitle || 'New Chat';
        try { gptTopTitle.innerHTML = Formatter.formatChatTitleHtml(fallback); }
        catch (_) { gptTopTitle.textContent = fallback; }
      }
      return;
    }

    this.app.gptTitle = title;
    this.app.isTitle = title;
    const plain = Formatter.formatChatTitlePlain(title);

    return new Promise((resolve) => {
      let index = 0;
      if (gptTopTitle) gptTopTitle.textContent = '';
      this.app.textStreamingInterval = setInterval(() => {
        if (gptTopTitle) gptTopTitle.textContent += plain.charAt(index);
        index++;
        if (index >= plain.length) {
          clearInterval(this.app.textStreamingInterval);
          this.app.textStreamingInterval = null;
          if (gptTopTitle) {
            try { gptTopTitle.innerHTML = Formatter.formatChatTitleHtml(title); }
            catch (_) { gptTopTitle.textContent = plain; }
          }
          resolve(title);
        }
      }, 60);
    });
  }

  async safeToInternalUrl(imageURL) {
    const toInternalUrl = window.acode ? window.acode.require('toInternalUrl'): null;
    if (!toInternalUrl) return imageURL;
    try {
      return await toInternalUrl(imageURL);
    } catch (error) {
      return null;
    }
  }

  async renderChat() {
    this.app.chatBox = document.getElementById('chat-box');
    if (!this.app.chatBox) return;

    this.app.chatBox.innerHTML = '';
    if (!this.app.chatBox.dataset.webLinkBound) {
      this.app.chatBox.dataset.webLinkBound = '1';
      this.app.chatBox.addEventListener('click', (ev) => {
        const row = ev.target.closest?.('.gpt-file-row.is-link[data-url]');
        if (!row) return;
        const u = row.getAttribute('data-url');
        if (u) { ev.preventDefault(); try { window.open(u, '_blank'); } catch (_) {} }
      });
    }

    let newUrl;

    for (let [index, msg] of this.app.chatHistory.entries()) {
      const messageElement = document.createElement('div');
      messageElement.className = `gpt-message ${msg.role}-message`;

      const innerHolder = document.createElement('div');
      innerHolder.className = 'gpt-message-inner-holder gpt-fast-wave';

      const loadingControls = document.createElement('div');
      loadingControls.className = 'assistantLoading-message';

      if (msg.role === 'event' || msg.type === 'info' || msg.type === 'error' || msg.type === 'warn') {
        applyEventMessageStylesOnce();
        const { el, bind } = buildEventMessageElement({
          content: msg.content,
          type: msg.type || 'info',
          action: msg.action || null,
          continuePrompt: msg.continuePrompt || null
        });
        bind(this.app);
        this.app.chatBox.appendChild(el);
        continue;
      }

      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          innerHolder.innerText = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Horizontal media strip (images + file chips) above text — no vertical overlap
          const media = document.createElement('div');
          media.className = 'gpt-user-attachments';
          media.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;width:100%;margin-bottom:6px;';
          let textParts = [];
          msg.content.forEach((item) => {
            if (!item) return;
            if (item.type === 'text' && item.text) {
              textParts.push(item.text);
            } else if (item.type === 'image_url' && item.image_url?.url) {
              const img = document.createElement('img');
              img.src = item.image_url.url;
              img.alt = item.name || 'Image';
              img.className = 'gpt-user-attach-img';
              img.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color,#444);flex-shrink:0;';
              media.appendChild(img);
            } else if (item.type === 'file') {
              const chip = document.createElement('div');
              chip.className = 'gpt-user-attach-file';
              chip.title = item.name || 'file';
              chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:var(--secondary-color,rgba(0,0,0,0.2));border:1px solid var(--border-color,#444);font-size:12px;color:var(--primary-text-color);max-width:140px;';
              chip.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(item.name || 'file').replace(/</g, '&lt;')}</span>`;
              media.appendChild(chip);
            }
          });
          if (media.childNodes.length) innerHolder.appendChild(media);
          if (textParts.length) {
            const textEl = document.createElement('div');
            textEl.className = 'gpt-user-text';
            textEl.innerText = textParts.join('\n');
            innerHolder.appendChild(textEl);
          }
        }

        if (typeof ChatUI !== 'undefined' && typeof ChatUI.addLongPressListener === 'function') {
          ChatUI.addLongPressListener(this.app, messageElement, index, 'user');
        }

        ChatUI.setupCollapsibleUserMessage(messageElement);

      } else { // 🟢 ASSISTANT MESSAGE
        document.getElementById('new-chat-button').style.display = 'block';

        const normalized = normalizeMessage(msg);
        let rawContent = (normalized.content || '').trim();
        const msgType = normalized.type || MSG_TYPE.TEXT;

        if (msgType === MSG_TYPE.ERROR) {
            let parsedMessage = typeof this.app.parseImageLinks === 'function' ? this.app.parseImageLinks(rawContent) : rawContent;
            innerHolder.innerHTML = `<span style="color:#f44336; font-weight:bold;">${parsedMessage}</span>`;
        }
        else if (msgType === MSG_TYPE.HTML) {
            innerHolder.innerHTML = rawContent;
        }
        else if (msgType === MSG_TYPE.IMAGE) {
            const localUri = normalized.image?.uri || null;
            const promptText = normalized.image?.prompt || rawContent || 'Generated Image';

            if (localUri) {
                newUrl = await this.safeToInternalUrl(localUri);
                const renderUrl = newUrl || localUri;

                const imageHtml = `
                <div class="gpt-modern-image-card" style="position: relative; display: inline-block; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.25); max-width: 100%; border: 1px solid var(--border-color, rgba(255,255,255,0.1)); margin-top: 8px;">
                    <img src="${renderUrl}" style="width: 100%; height: auto; display: block; object-fit: cover;" alt="Generated Image" />
                    <div class="gpt-image-overlay-actions" style="position: absolute; bottom: 10px; right: 10px; display: flex; gap: 10px; background: rgba(0,0,0,0.65); padding: 8px 12px; border-radius: 20px; backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.3s ease;">
                        <button onclick="window.gptPreviewImage('${renderUrl}')" style="background: transparent; border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; transform: scale(1);" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" title="Fullscreen Preview">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>
                        </button>
                        <button onclick="window.gptDownloadImage('${localUri}')" style="background: transparent; border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; transform: scale(1);" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" title="Download Image">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        </button>
                    </div>
                    <style>
                        .gpt-modern-image-card:hover .gpt-image-overlay-actions { opacity: 1 !important; }
                        @media (max-width: 768px) { .gpt-modern-image-card .gpt-image-overlay-actions { opacity: 1 !important; } }
                    </style>
                </div>
                <div style="font-size:11px; color:var(--secondary-text-color); margin-top:4px; font-style: italic;"><b>Prompt:</b> ${promptText}</div>`;
                innerHolder.innerHTML = imageHtml;
            } else {
                innerHolder.innerHTML = `<div style="font-size:11px; color:var(--secondary-text-color); margin-top:4px; font-style: italic;"><b>Prompt:</b> ${promptText} <br/>(Image not saved locally)</div>`;
            }
        }
        else {
            // ── Legacy-only marker stripping (very old saves embedded actions
            // /canvas as strings inside content — pre message.parts, pre
            // message.agentActions). New messages never hit these branches.
            let legacyActions = null;
            const agentMatch = rawContent.match(/@@@AGENT_ACTIONS@@@([\s\S]*?)@@@END_AGENT_ACTIONS@@@/);
            if (agentMatch) {
                try { legacyActions = JSON.parse(agentMatch[1]); } catch (e) { console.error('Parse Error in Saved Actions', e); }
                rawContent = rawContent.replace(agentMatch[0], '').trim();
            }

            const canvasList = [];
            const fromKey = normalized.canvasFiles || msg.canvasFiles || [];
            for (const c of fromKey) if (c?.url) canvasList.push({ url: c.url, label: c.label || 'Preview' });
            const canvasRegex = /@@@CANVAS_FILE@@@(.*?)@@@(.*?)@@@END_CANVAS_FILE@@@\n*/g;
            let cmatch;
            while ((cmatch = canvasRegex.exec(rawContent)) !== null) {
                try {
                  const url = decodeURIComponent(cmatch[1] || '');
                  const label = decodeURIComponent(cmatch[2] || 'Preview');
                  if (url) canvasList.push({ url, label });
                } catch (_) {}
            }
            rawContent = rawContent.replace(canvasRegex, '').trim();

            // ✅ SINGLE SOURCE OF TRUTH — message.parts (new saves), or
            // reconstructed from legacy content+agentActions (old saves).
            // Order here is exactly what renders — no bucket re-sort.
            const partsSource = Array.isArray(msg.parts)
                ? msg
                : { content: rawContent, agentActions: legacyActions || msg.agentActions };
            let parts = getMessageParts(partsSource);

            // Strip TASK_COMPLETED from the trailing text part only
            let taskCompleted = false;
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].type === 'text') {
                    if (TASK_COMPLETE_MARKER.test(parts[i].text || '')) {
                        taskCompleted = true;
                        parts = parts.slice();
                        parts[i] = { ...parts[i], text: parts[i].text.replace(TASK_COMPLETE_MARKER, '').trim() };
                    }
                    break;
                }
            }

            // Don't show a duplicate Preview button for files already shown as file parts
            const urlsInParts = new Set(parts.filter(p => p.type === 'file' && p.url).map(p => p.url));
            let canvasTriggersHtml = '';
            for (const c of canvasList) {
                const url = c.url;
                const label = String(c.label || 'Preview').replace(/"/g, '&quot;');
                if (url && !urlsInParts.has(url)) {
                    canvasTriggersHtml += `<div class="gpt-canvas-trigger" style="margin-top:8px;margin-bottom:4px;" data-mode="file" data-src="${url.replace(/"/g, '&quot;')}" data-title="${label}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> Preview ${label}</div>`;
                }
            }

            // ── Mount: parts container, optionally wrapped in "Worked for Ns" ──
            innerHolder.innerHTML = '';
            const partsHost = document.createElement('div');
            partsHost.className = 'gpt-agent-parts gpt-history-parts';
            innerHolder.appendChild(partsHost);

            const renderer = new PartsRenderer(partsHost, {
                app: this.app,
                renderMarkdown: (t, opts) => this._renderMarkdownForMessage(t, opts),
                onLinkOpen: (u) => { try { window.open(u, '_blank'); } catch (_) {} },
                maxOpenDetails: 2
            });
            renderer.renderAll(parts);

            const hasWork = parts.some(p => p.type !== 'text');
            if (hasWork) {
                // History is always finished — never start live "Working for Xs" timers
                let dur = msg.durationSec != null ? msg.durationSec
                  : (msg.agentDurationSec != null ? msg.agentDurationSec : null);
                // Prefer persisted duration; never invent 1s when a richer value exists on message
                if (dur == null && msg.agentActions && msg.agentActions._durationSec != null) {
                  dur = msg.agentActions._durationSec;
                }
                if (dur == null || !Number.isFinite(Number(dur)) || Number(dur) < 1) {
                  // Last resort: keep previous title seconds if re-render — else 1
                  dur = 1;
                }
                renderer.mountWorkShell(innerHolder, {
                    durationSec: Math.max(1, Math.round(Number(dur))),
                    stepCount: parts.filter(p => p.type !== 'text').length,
                    open: false,
                    live: false
                });
                // Only trailing final summary outside Worked; interim text stays in
                try {
                    const shell = innerHolder.querySelector(':scope > .gpt-oc-work');
                    const body = shell?.querySelector('.gpt-oc-work-body');
                    renderer._evacuateProseOutsideWork?.(innerHolder, shell, body);
                    // Collapse via max-height/class — never display:none (blocks open transition)
                    if (shell && renderer._setWorkOpen) renderer._setWorkOpen(shell, false);
                    else {
                      shell?.classList?.remove('is-open', 'is-working');
                      if (body) {
                        body.style.display = '';
                        body.style.maxHeight = '0px';
                        body.style.opacity = '0';
                        body.style.overflow = 'hidden';
                      }
                    }
                    shell?.classList?.remove('is-working');
                    renderer._releaseAllPlanSticky?.(innerHolder);
                } catch (_) {}
            }

            if (canvasTriggersHtml) innerHolder.insertAdjacentHTML('beforeend', canvasTriggersHtml);
            if (taskCompleted) innerHolder.insertAdjacentHTML('beforeend', taskCompleteBadgeHtml());

            if (window.MathJax && typeof window.MathJax.typeset === 'function') window.MathJax.typeset([innerHolder]);
            if (typeof addCopyButton === 'function') addCopyButton(innerHolder, index);

            bindDiffViewCollapse(innerHolder);
            this.app.canvasManager?.bindTriggers(innerHolder);
            this._addHtmlPreviewTriggers(innerHolder);

            // Headings now live inside each text part's .part-text (nested one
            // level deeper than the old flat innerHolder.innerHTML did), so
            // this must run per text-part, not on innerHolder itself.
            if (this.shouldCollapseMarkdownHeaders(msg)) {
                partsHost.querySelectorAll(':scope .part-text').forEach(el => this._convertHeadingsToCollapsibleSections(el));
            }
        }

        if (typeof ChatUI !== 'undefined' && typeof ChatUI.addLongPressListener === 'function') {
            ChatUI.addLongPressListener(this.app, messageElement, index, 'assistant');
        }
      }

      messageElement.appendChild(innerHolder);

      // User meta must come AFTER inner-holder so it sits below the bubble
      if (msg.role === 'user') {
        this._attachUserFooter(messageElement, msg, index);
      }

      if (msg.role === 'assistant') {
        this._attachAssistantFooter(messageElement, msg, index);
        messageElement.appendChild(loadingControls);
      }

      this.app.chatBox.appendChild(messageElement);
    }

    // Stretch last assistant only when history does not end with an event/info row
    try {
      const hist = this.app.chatHistory || [];
      const last = hist[hist.length - 1];
      const endsWithEvent = last && (last.role === 'event' || last.type === 'info');
      document.querySelectorAll('.assistant-message.increaseChatHeight').forEach(el => el.classList.remove('increaseChatHeight'));
      if (!endsWithEvent && typeof ChatUI !== 'undefined' && typeof ChatUI.chatIncreaseHeight === 'function') {
        ChatUI.chatIncreaseHeight();
      }
    } catch (_) {}

    if (typeof ChatUI !== 'undefined' && typeof ChatUI.gptFastWaveEffect === 'function') {
      ChatUI.gptFastWaveEffect(this.app.optimize, window.appSettings?.value?.animation);
    }

    if (this.app.popupManager && typeof this.app.popupManager.setupImagePopup === 'function') {
      this.app.popupManager.setupImagePopup();
      if (typeof this.app.popupManager.tagChatImages === 'function') {
        this.app.popupManager.tagChatImages(this.app.chatBox);
      }
    }

    let currentUsage = ConfigManager.get('gpt-token-usage') || 0;
    let usageLimit = ConfigManager.get('gpt-usage-limit') || 0;

    if (parseFloat(currentUsage) >= parseFloat(usageLimit) && parseFloat(usageLimit) > 0) {
      if (this.app.paymentManager && typeof this.app.paymentManager.addPaypalSetting === 'function') {
        await this.app.paymentManager.addPaypalSetting();
      } else if (typeof this.app.addPaypalSetting === 'function') {
        await this.app.addPaypalSetting();
      }
    }
  }



    _formatMsgTime(ts) {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (_) { return ''; }
    }


    _formatModelFooterLabel(msg) {
        const sm = this.app.selectedModel || {};
        const type = String(msg?.provider || sm.type || '').toLowerCase();
        const provider = this._formatProvider(type);
        const PROVIDER_SLUGS = new Set([
            'openrouter','openai','gemini','mistral','deepseek','ollama','anthropic','claude',
            'groq','groqcloud','together','fireworks','huggingface','gpt','chatgpt','perplexity'
        ]);
        const isSlug = (s) => PROVIDER_SLUGS.has(String(s || '').toLowerCase().trim());

        let modelId = msg?.modelId || '';
        if (isSlug(modelId)) modelId = '';

        const keyMap = {
            openrouter: 'openrouterSelectedModel',
            openai: 'gptSelectedModel',
            gpt: 'gptSelectedModel',
            gemini: 'geminiSelectedModel',
            mistral: 'mistralSelectedModel',
            deepseek: 'deepseekSelectedModel',
            ollama: 'ollamaPrimaryModel',
            claude: 'claudeSelectedModel',
            anthropic: 'claudeSelectedModel',
            groqcloud: 'groqcloudSelectedModel',
            groq: 'groqcloudSelectedModel',
            huggingface: 'huggingfaceSelectedModel',
            together: 'togetherSelectedModel',
            fireworks: 'fireworksSelectedModel'
        };

        // ConfigManager holds the real API model id (e.g. qwen/qwen3.7-flash)
        if (!modelId) {
            try {
                const sk = keyMap[type];
                if (sk) {
                    const v = ConfigManager.get(sk);
                    if (v && String(v) !== 'null' && !isSlug(v)) modelId = String(v).trim();
                }
            } catch (_) {}
        }
        if (!modelId && this.app.lastSelectedModel && !isSlug(this.app.lastSelectedModel)) {
            modelId = String(this.app.lastSelectedModel).trim();
        }
        if (!modelId && sm.model && !isSlug(sm.model)) modelId = String(sm.model).trim();
        if (!modelId && msg?.modelName && !isSlug(msg.modelName)) modelId = String(msg.modelName).trim();

        // Footer shows model id only (no provider name)
        return modelId || '';
    }

    _formatProvider(type) {
        if (!type) return '';
        const map = {
            gemini: 'Gemini', openrouter: 'OpenRouter', openai: 'OpenAI',
            mistral: 'Mistral', deepseek: 'DeepSeek', ollama: 'Ollama',
            anthropic: 'Claude', claude: 'Claude', groq: 'Groq',
            huggingface: 'HuggingFace', custom: 'Custom'
        };
        const k = String(type).toLowerCase();
        return map[k] || (type.charAt(0).toUpperCase() + type.slice(1));
    }

    _msgPlainText(msg) {
        if (!msg) return '';
        let c = msg.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.find(x => x?.type === 'text')?.text || '';
        if (c && typeof c === 'object') return c.content || c.text || '';
        return String(c || '');
    }

    /** User footer BELOW bubble: counts left · time/edit/copy right (sizes from response.txt) */
    _attachUserFooter(messageElement, msg, index) {
        if (!messageElement) return;
        messageElement.querySelector('.gpt-msg-meta')?.remove();

        const text = this._msgPlainText(msg);
        const chars = msg.charCount != null ? msg.charCount : String(text || '').length;
        const words = String(text || '').trim() ? String(text).trim().split(/\s+/).filter(Boolean).length : 0;
        const time = this._formatMsgTime(msg.createdAt || msg.timestamp);

        const meta = document.createElement('div');
        meta.className = 'gpt-msg-meta gpt-user-meta';
        // Match response.txt: font-size 10px base, 11px labels, svg ~12–13px
        meta.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;padding:0 2px;font-size:10px;opacity:0.5;color:var(--primary-text-color);user-select:none;width:100%;box-sizing:border-box;';

        const timeSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
        const editSvg = `<svg width="12" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
        const copySvg = `<svg width="12" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

        meta.innerHTML = `
          <span class="gpt-meta-counts" style="display:inline-flex;align-items:center;gap:8px;font-size:11px;opacity:0.9;flex-shrink:0;">
            <span title="characters">${chars} chars</span>
            <span title="words">${words} words</span>
          </span>
          <span class="gpt-meta-actions" style="display:inline-flex;align-items:center;gap:10px;margin-left:auto;flex-shrink:0;">
            <span class="gpt-meta-time" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;">${timeSvg}<span>${time || '—'}</span></span>
            <button type="button" class="gpt-meta-edit" style="display:inline-flex;align-items:center;gap:4px;background:none;border:none;padding:0;color:inherit;cursor:pointer;font-size:11px;">${editSvg}<span>Edit</span></button>
            <button type="button" class="gpt-meta-copy" style="display:inline-flex;align-items:center;gap:4px;background:none;border:none;padding:0;color:inherit;cursor:pointer;font-size:11px;">${copySvg}<span>Copy</span></button>
          </span>
        `;
        meta.querySelector('.gpt-meta-edit').onclick = (e) => {
            e.stopPropagation();
            if (this.app.popupManager?.editMessage) {
                this.app.popupManager.editMessage(index, msg.content);
            }
        };
        meta.querySelector('.gpt-meta-copy').onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(text);
            const btn = e.currentTarget;
            const label = btn.querySelector('span:last-child') || btn;
            const prev = label.textContent;
            label.textContent = 'Copied!';
            btn.style.color = '#22c55e';
            setTimeout(() => {
                label.textContent = prev || 'Copy';
                btn.style.color = '';
            }, 1000);
        };

        // Branch navigator (edit/regenerate versions) — ‹ 1/2 ›
        const versions = msg.branches?.versions;
        if (Array.isArray(versions) && versions.length > 1) {
            const vi = msg.branches.active != null ? msg.branches.active : versions.length - 1;
            const nav = document.createElement('span');
            nav.className = 'gpt-branch-nav';
            nav.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-left:6px;font-size:11px;opacity:0.75;user-select:none;';
            const btnStyle = 'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;background:transparent;color:inherit;cursor:pointer;padding:0;';
            const chevL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
            const chevR = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
            nav.innerHTML = `
              <button type="button" class="gpt-br-prev" title="Previous version" style="${btnStyle}opacity:${vi <= 0 ? 0.25 : 0.85};" ${vi <= 0 ? 'disabled' : ''}>${chevL}</button>
              <span style="min-width:28px;text-align:center;font-size:10px;">${vi + 1}/${versions.length}</span>
              <button type="button" class="gpt-br-next" title="Next version" style="${btnStyle}opacity:${vi >= versions.length - 1 ? 0.25 : 0.85};" ${vi >= versions.length - 1 ? 'disabled' : ''}>${chevR}</button>
            `;
            nav.querySelector('.gpt-br-prev').onclick = (e) => {
                e.stopPropagation();
                this.app.popupManager?.switchVariant?.(index, -1);
            };
            nav.querySelector('.gpt-br-next').onclick = (e) => {
                e.stopPropagation();
                this.app.popupManager?.switchVariant?.(index, 1);
            };
            // put nav on the right actions side if present, else append
            const actions = meta.querySelector('.gpt-meta-actions');
            if (actions) actions.insertBefore(nav, actions.firstChild);
            else meta.appendChild(nav);
        }

        // Always below the message bubble (after inner-holder)
        messageElement.appendChild(meta);
    }

    /**
     * Assistant actions below response. Call after live turn ends AND on history render.
     * Left: copy, select, insert, dislike, retry — Right: Provider · model-id
     */
    _attachAssistantFooter(messageElement, msg, index) {
        if (!messageElement) return;
        messageElement.querySelector('.gpt-msg-actions')?.remove();

        const actions = document.createElement('div');
        actions.className = 'gpt-msg-actions';
        actions.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:8px;padding:0 2px;width:100%;box-sizing:border-box;';

        const btnStyle = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:none;background:transparent;color:var(--primary-text-color);cursor:pointer;opacity:0.55;padding:0;';
        const copySvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        const selectSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
        const insertSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>`;
        const dislikeSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`;
        const retrySvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`;

        const left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;';
        left.innerHTML = `
          <button type="button" class="gpt-act-copy" title="Copy" style="${btnStyle}">${copySvg}</button>
          <button type="button" class="gpt-act-select" title="Select text" style="${btnStyle}">${selectSvg}</button>
          <button type="button" class="gpt-act-insert" title="Insert into code" style="${btnStyle}">${insertSvg}</button>
          <button type="button" class="gpt-act-dislike" title="Bad response" style="${btnStyle}">${dislikeSvg}</button>
          <button type="button" class="gpt-act-retry" title="Regenerate" style="${btnStyle}">${retrySvg}</button>
        `;

        const getText = () => {
            let c = this._msgPlainText(msg);
            // Prefer live DOM text if history content empty (just finished stream)
            if (!c.trim()) {
                const holder = messageElement.querySelector('.gpt-message-inner-holder');
                c = holder?.innerText || holder?.textContent || '';
            }
            try {
                if (this.app.Formatter?.removeThinkTags) c = this.app.Formatter.removeThinkTags(c);
            } catch (_) {}
            return String(c || '');
        };

        left.querySelector('.gpt-act-copy').onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(getText());
            const btn = e.currentTarget;
            const tick = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`;
            const prev = btn.innerHTML;
            btn.innerHTML = tick;
            btn.style.opacity = '1';
            setTimeout(() => { btn.innerHTML = prev; btn.style.opacity = ''; }, 1000);
        };
        left.querySelector('.gpt-act-select').onclick = (e) => {
            e.stopPropagation();
            messageElement.style.userSelect = 'text';
            const holder = messageElement.querySelector('.gpt-message-inner-holder') || messageElement;
            try {
                const range = document.createRange();
                range.selectNodeContents(holder);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (_) {}
        };
        left.querySelector('.gpt-act-insert').onclick = (e) => {
            e.stopPropagation();
            const text = getText();
            try {
                if (typeof ChatUI !== 'undefined' && typeof ChatUI.insertIntoCode === 'function') {
                    ChatUI.insertIntoCode(text);
                } else if (typeof this.app.insertIntoCode === 'function') {
                    this.app.insertIntoCode(text);
                } else {
                    const editor = window.editorManager?.editor;
                    if (editor) editor.session.insert(editor.getCursorPosition(), text);
                }
            } catch (err) {
                console.warn('[insertIntoCode]', err);
            }
        };
        left.querySelector('.gpt-act-dislike').onclick = (e) => {
            e.stopPropagation();
            try {
                this.app.popupManager?.showFeedbackModal?.(null, messageElement);
            } catch (_) {}
        };
        left.querySelector('.gpt-act-retry').onclick = (e) => {
            e.stopPropagation();
            if (this.app.popupManager?.regenerateAt) {
                this.app.popupManager.regenerateAt(index);
            }
        };


        const info = document.createElement('div');
        info.className = 'gpt-msg-model-info';
        info.style.cssText = 'margin-left:auto;font-size:10px;opacity:0.4;color:var(--primary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;text-align:right;padding-left:8px;';
        info.textContent = this._formatModelFooterLabel(msg);

        // Duration + wall clock when response finished: "12s   16:17"
        const durSec = msg.durationSec != null ? msg.durationSec
          : (msg.agentDurationSec != null ? msg.agentDurationSec : null);
        const doneAt = msg.completedAt || msg.createdAt;
        if (durSec != null || doneAt) {
            const bits = [];
            if (durSec != null) bits.push(`${Math.max(1, Math.round(durSec))}s`);
            if (doneAt) {
                try {
                    bits.push(new Date(doneAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                } catch (_) {}
            }
            if (bits.length) {
                const timeEl = document.createElement('span');
                timeEl.className = 'gpt-msg-timing';
                timeEl.style.cssText = 'margin-left:8px;font-size:10px;opacity:0.4;white-space:nowrap;';
                timeEl.textContent = bits.join('   ');
                info.appendChild(document.createTextNode(''));
                // put timing left of model or after actions row
                left.appendChild(timeEl);
            }
        }

        actions.appendChild(left);
        actions.appendChild(info);
        messageElement.appendChild(actions);
    }


}