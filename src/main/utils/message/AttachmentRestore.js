
/** Restore attachedFiles + preview from a user message content (string | array). */
export function restoreAttachmentsFromContent(app, content) {
  if (!app) return { text: '', files: [] };
  const files = [];
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (!item) continue;
      if (item.type === 'text' && item.text != null) {
        text += (text ? '\n' : '') + item.text;
      } else if (item.type === 'image_url' && item.image_url?.url) {
        files.push({
          type: 'image',
          name: item.name || 'image',
          data: item.image_url.url
        });
      } else if (item.type === 'file') {
        files.push({
          type: 'text',
          name: item.name || 'file',
          data: item.text != null ? item.text : (item.data || '')
        });
      }
    }
  } else if (content != null) {
    text = String(content);
  }
  app.attachedFiles = files;
  app.isUserSelectedImageUrl = files.find(f => f.type === 'image')
    ? { url: files.find(f => f.type === 'image').data, type: 'image_url' }
    : null;
  // Refresh input previews if UI available
  try {
    app.chatModalSetup?.renderFilePreviews?.();
  } catch (_) {}
  try {
    if (typeof app.renderFilePreviews === 'function') app.renderFilePreviews();
  } catch (_) {}
  return { text, files };
}
