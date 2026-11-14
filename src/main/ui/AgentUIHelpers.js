// src/main/ui/AgentUIHelpers.js
export function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function taskCompleteBadgeHtml() {
  return `<div class="gpt-task-complete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Task completed</span></div>`;
}

export const TASK_COMPLETE_MARKER = /\s*TASK_COMPLETED\s*$/;

export function generateDiffHtml(fcName, args) {
  if (!args) return '';

  if (fcName === 'edit_file_lines') {
    const lines = args.lines || [];
    if (lines.length === 0) return '';
    const rowsHtml = lines
      .sort((a, b) => a.line - b.line)
      .map(l => {
        const isDel = l.text === '';
        const txt = isDel ? 'Line removed' : l.text;
        const cls = isDel ? 'gpt-diff-del' : 'gpt-diff-add';
        const sign = isDel ? '-' : '+';
        return `<div class="gpt-diff-row ${cls}"><span class="gpt-diff-ln">${l.line}</span><span class="gpt-diff-sign">${sign}</span><span class="gpt-diff-text">${escapeHtml(txt)}</span></div>`;
      })
      .join('');

    return `
      <div class="gpt-diff-view">
        <div class="gpt-diff-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          Proposed Line Edits
        </div>
        <div class="gpt-diff-content">${rowsHtml}</div>
      </div>`;
  }

  if (fcName === 'create_or_update_file') {
    const content = args.content || '';
    if (!content) return '';
    return `
      <div class="gpt-diff-view">
        <div class="gpt-diff-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
          Target File Content
        </div>
        <div class="gpt-diff-content">
          <div class="gpt-diff-row gpt-diff-add"><span class="gpt-diff-sign">+</span><span class="gpt-diff-text">${escapeHtml(content)}</span></div>
        </div>
      </div>`;
  }
  return '';
}

// 🟢 PRO FIX: Pass webLinks explicitly so history renderer works perfectly!
export function generateWebActionCard({ fcName, args, status, toolResult, webLinks }) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const query = args?.query || '';
  const url = args?.url || '';

  const searchIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
  const linkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
  
  if (isRunning) {
      return `
      <div class="gpt-claude-web-running">
        <span class="gpt-web-spin">${fcName === 'web_search' ? searchIcon : linkIcon}</span>
        <span>${fcName === 'web_search' ? 'Searching: ' + escapeHtml(query) : 'Reading: ' + escapeHtml(url)}</span>
      </div>`;
  }

  if (isError) {
      return `<div class="gpt-claude-web-error">Failed to ${fcName === 'web_search' ? 'search' : 'read'}: ${escapeHtml(fcName === 'web_search' ? query : url)}</div>`;
  }

  // 🟢 DONE STATE (Handles both Live toolResult AND History reload webLinks)
  const links = webLinks || toolResult?.links || [];

  if (fcName === 'web_search') {
      if (links.length > 0) {
          const linksHtml = links.map(r => {
              const link = r.url;
              const t = escapeHtml(r.title || link);
              const hostname = link ? new URL(link).hostname : '';
              const favicon = hostname ? `<img src="[https://www.google.com/s2/favicons?domain=$](https://www.google.com/s2/favicons?domain=$){hostname}&sz=32" class="gpt-web-favicon" onerror="this.style.display='none'">` : searchIcon;

              return `
              <a href="${escapeHtml(link)}" target="_blank" class="gpt-claude-link-item">
                ${favicon}
                <div style="display:flex; flex-direction:column; overflow:hidden;">
                    <span class="gpt-claude-link-title">${t}</span>
                    <span class="gpt-claude-link-host">${escapeHtml(hostname)}</span>
                </div>
              </a>`;
          }).join('');

          return `
          <details class="gpt-claude-web-details">
            <summary class="gpt-claude-web-summary">
              ${searchIcon} Searched ${links.length} sites
            </summary>
            <div class="gpt-claude-web-links">
              ${linksHtml}
            </div>
          </details>`;
      } else {
          return `
          <details class="gpt-claude-web-details">
            <summary class="gpt-claude-web-summary">
              ${searchIcon} Searched web
            </summary>
            <div class="gpt-claude-web-links" style="padding:8px; font-size:11px; color:var(--secondary-text-color);">
              No specific links found or recorded.
            </div>
          </details>`;
      }
  }

  if (fcName === 'browse_page' || fcName === 'fetch_url_content') {
      return `
      <details class="gpt-claude-web-details">
        <summary class="gpt-claude-web-summary">
          ${linkIcon} Read ${escapeHtml(url)}
        </summary>
        <div class="gpt-claude-web-links" style="padding:8px; font-size:11px; color:var(--secondary-text-color); font-family:monospace; word-break:break-all;">
          Content extracted successfully.
        </div>
      </details>`;
  }

  return '';
}

// export function processImagesIntoGallery(htmlString, app) {
    
//     console.log("processImagesIntoGallery fired", htmlString + " AND : App :",app);
//     if (!htmlString || !htmlString.includes('<img')) return htmlString;
    
//     const tempDiv = document.createElement('div');
//     tempDiv.innerHTML = htmlString;
    
//     const images = tempDiv.querySelectorAll('img');
//     if (images.length === 0) return htmlString;

//     let galleryWrapper = null;
    
//     images.forEach(img => {
//         if (img.closest('.gpt-modern-image-card') || img.closest('.gpt-image-gallery') || img.classList.contains('gpt-web-favicon')) return;
        
//         if (!galleryWrapper) {
//             galleryWrapper = document.createElement('div');
//             galleryWrapper.className = 'gpt-image-gallery';
//             img.parentNode.insertBefore(galleryWrapper, img);
//         }
        
//         const itemDiv = document.createElement('div');
//         itemDiv.className = 'gpt-image-item';
        
//         // 🟢 PRO FIX: Trigger PopupManager's Full Screen Modal directly
//         itemDiv.onclick = () => {
//         console.log("itemDiv.onclick :", app.popupManager)
//             if (app && app.popupManager && typeof app.popupManager.showImageInModal === 'function') {
//         console.log("If block .onclick :");
//                 app.popupManager.showImageInModal(img.src);
//             } else if (window.gptPreviewImage) {
//         console.log("Else if .onclick :");
//                 window.gptPreviewImage(img.src); // Fallback
//             } else {
//               console.log("Else block")
//             }
//         };
        
//         img.removeAttribute('style');
        
//         itemDiv.appendChild(img);
//         galleryWrapper.appendChild(itemDiv);
//     });
    
//     return tempDiv.innerHTML;
// }


// Add this helper function at the bottom of src/main/ui/AgentUIHelpers.js
export function processImagesIntoGallery(htmlString) {
    if (!htmlString || !htmlString.includes('<img')) return htmlString;
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    const images = tempDiv.querySelectorAll('img');
    if (images.length === 0) return htmlString;

    let galleryWrapper = null;
    
    images.forEach(img => {
        if (img.closest('.gpt-modern-image-card') || img.closest('.gpt-image-gallery') || img.classList.contains('gpt-web-favicon')) return;
        
        if (!galleryWrapper) {
            galleryWrapper = document.createElement('div');
            galleryWrapper.className = 'gpt-image-gallery';
            img.parentNode.insertBefore(galleryWrapper, img);
        }
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'gpt-image-item';
        
        // 🟢 PRO FIX: Use inline onclick so it survives .innerHTML stringification!
        // Eta click korlei vitore thaka img er src niye global function call korbe.
        itemDiv.setAttribute('onclick', "window.gptPreviewImage(this.querySelector('img').src)");
        
        img.removeAttribute('style');
        
        itemDiv.appendChild(img);
        galleryWrapper.appendChild(itemDiv);
    });
    
    return tempDiv.innerHTML;
}