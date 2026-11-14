/**
 * Export current conversation as standalone HTML (shareable offline).
 */
export function buildSessionHtml(app) {
  const conv = app?.currentConversation || app?.conversations?.[parseInt(app?.currentConversationIndex, 10)];
  const chat = Array.isArray(conv?.chat) ? conv.chat : (app?.chatHistory || []);
  const title = (conv?.title || 'Chat export').replace(/[<>]/g, '');
  const model = conv?.model?.name || conv?.model?.model || app?.selectedModel?.name || '';

  const rows = chat.map((m, i) => {
    const role = m.role || 'unknown';
    let body = '';
    if (typeof m.content === 'string') body = m.content;
    else if (Array.isArray(m.content)) {
      body = m.content
        .map(c => {
          if (typeof c === 'string') return c;
          if (c?.text) return c.text;
          if (c?.type === 'text') return c.text || '';
          if (c?.type === 'image_url') return '[image]';
          return '';
        })
        .filter(Boolean)
        .join('\n');
    } else if (m.content != null) {
      try { body = JSON.stringify(m.content, null, 2); } catch (_) { body = String(m.content); }
    }
    const safe = escapeHtml(body);
    const cls = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'other';
    return `<section class="msg ${cls}" data-i="${i}"><header>${escapeHtml(role)}</header><pre>${safe}</pre></section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark light; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #0f1115; color: #e8e8e8; }
  h1 { font-size: 1.2rem; margin: 0 0 4px; }
  .meta { opacity: 0.55; font-size: 12px; margin-bottom: 20px; }
  .msg { border: 1px solid #2a2d36; border-radius: 10px; padding: 10px 12px; margin: 10px 0; background: #161a22; }
  .msg.user { border-color: #3d4a8a; }
  .msg.assistant { border-color: #2d5a3d; }
  .msg header { font-size: 11px; text-transform: uppercase; opacity: 0.6; margin-bottom: 6px; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.45; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Exported ${new Date().toISOString()} · ${escapeHtml(String(model))} · ${chat.length} messages</div>
  ${rows || '<p>No messages.</p>'}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function exportSessionToProject(app) {
  const html = buildSessionHtml(app);
  const name = `session-export-${Date.now()}.html`;
  try {
    const { getProjectFolder, createFolder, createFile } = await import('../file/fileOperations.js');
    const project = await getProjectFolder();
    if (!project?.uri) {
      return { success: false, error: 'No project folder', html };
    }
    await createFolder(project.uri, '.aicodex', { overwrite: true });
    await createFolder(project.uri, '.aicodex/exports', { overwrite: true });
    const rel = `.aicodex/exports/${name}`;
    const w = await createFile(project.uri, rel, html, { overwrite: true });
    return { success: !!w?.success, path: rel, html, bytes: html.length };
  } catch (e) {
    return { success: false, error: e?.message || String(e), html };
  }
}
