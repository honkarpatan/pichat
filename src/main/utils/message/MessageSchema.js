/**
 * MessageSchema — structured chat messages instead of @@@!!! / @@@IMG / @@@*** prefixes.
 *
 * Canonical shape stored in history JSON:
 * {
 *   role: 'user' | 'assistant',
 *   type: 'text' | 'error' | 'html' | 'image' | 'mixed',
 *   content: string,          // plain / markdown text (never the marker soup)
 *   image?: { uri: string|null, prompt: string },
 *   agentActions?: Array,
 *   hidden_context?: any,
 *   meta?: object
 * }
 *
 * Old chats that still use string prefixes are normalized on read
 * so ChatRenderer / HistoryFileOps keep working without a bulk migration.
 */

export const MSG_TYPE = {
  TEXT: 'text',
  ERROR: 'error',
  HTML: 'html',
  IMAGE: 'image',
  MIXED: 'mixed'
};

/** Build a structured message object (pass into addMessageToHistory as content OR as full msg). */
export function makeMessage(role, {
  type = MSG_TYPE.TEXT,
  content = '',
  image = null,
  agentActions = null,
  hidden_context = null,
  meta = null,
  canvasFiles = null,
  parts = null,
  durationSec = null,
  agentDurationSec = null,
  completedAt = null
} = {}) {
  const msg = { role, type, content: content == null ? '' : String(content) };
  if (image) msg.image = { uri: image.uri ?? null, prompt: image.prompt || '' };
  if (agentActions && agentActions.length) msg.agentActions = agentActions;
  // Duration may live on empty actions array via _durationSec
  if (agentActions && agentActions._durationSec != null && !msg.agentActions) {
    msg.agentActions = agentActions;
  }
  if (hidden_context != null) msg.hidden_context = hidden_context;
  if (meta && typeof meta === 'object') msg.meta = meta;
  if (canvasFiles && canvasFiles.length) msg.canvasFiles = canvasFiles;
  if (Array.isArray(parts) && parts.length) msg.parts = parts;
  const dur = durationSec != null ? durationSec : agentDurationSec;
  if (dur != null && Number.isFinite(Number(dur))) {
    msg.durationSec = Number(dur);
    msg.agentDurationSec = Number(dur);
  }
  if (completedAt != null) msg.completedAt = completedAt;
  return msg;
}

export function makeErrorMessage(role, text, extra = {}) {
  return makeMessage(role, { type: MSG_TYPE.ERROR, content: String(text || ''), ...extra });
}

export function makeHtmlMessage(role, html, extra = {}) {
  return makeMessage(role, { type: MSG_TYPE.HTML, content: String(html || ''), ...extra });
}

export function makeImageMessage(role, { uri = null, prompt = '', content = '' } = {}) {
  return makeMessage(role, {
    type: MSG_TYPE.IMAGE,
    content: content || prompt || '',
    image: { uri, prompt: prompt || content || '' }
  });
}


const CANVAS_RE = /@@@CANVAS_FILE@@@(.*?)@@@(.*?)@@@END_CANVAS_FILE@@@\n*/g;

/** Pull legacy @@@CANVAS_FILE@@@ markers out of text → { content, canvasFiles } */
export function extractCanvasFiles(text) {
  const files = [];
  const src = String(text || '');
  let m;
  CANVAS_RE.lastIndex = 0;
  while ((m = CANVAS_RE.exec(src)) !== null) {
    try {
      const url = decodeURIComponent(m[1] || '');
      const label = decodeURIComponent(m[2] || 'Preview');
      if (url) files.push({ url, label });
    } catch (_) {}
  }
  const content = src.replace(CANVAS_RE, '').trim();
  return { content, canvasFiles: files };
}

/**
 * Normalize anything coming from history (legacy string or already structured)
 * into a consistent { type, content, image?, ... } shape for rendering.
 */
export function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { role: 'assistant', type: MSG_TYPE.TEXT, content: String(msg || '') };
  }

  // Already structured — still strip any leftover canvas markers into canvasFiles
  if (msg.type && typeof msg.content === 'string') {
    const { content, canvasFiles } = extractCanvasFiles(msg.content);
    const out = { ...msg, content };
    if (canvasFiles.length) {
      out.canvasFiles = [...(msg.canvasFiles || []), ...canvasFiles];
    } else if (msg.canvasFiles) {
      out.canvasFiles = msg.canvasFiles;
    }
    return out;
  }

  const role = msg.role || 'assistant';
  let raw = typeof msg.content === 'string' ? msg.content : '';

  // Legacy prefixes
  if (raw.startsWith('@@@!!!')) {
    return {
      ...msg,
      role,
      type: MSG_TYPE.ERROR,
      content: raw.replace(/^@@@!!!/, '')
    };
  }
  if (raw.startsWith('@@@***')) {
    return {
      ...msg,
      role,
      type: MSG_TYPE.HTML,
      content: raw.replace(/^@@@\*\*\*/, '')
    };
  }
  if (raw.startsWith('@@@IMG|')) {
    const parts = raw.split('|');
    const uri = parts[1] && parts[1] !== 'null' ? parts[1] : null;
    const prompt = parts.slice(2).join('|') || 'Generated Image';
    return {
      ...msg,
      role,
      type: MSG_TYPE.IMAGE,
      content: prompt,
      image: { uri, prompt }
    };
  }
  if (raw.startsWith('file:///')) {
    const firstSpace = raw.indexOf(' ');
    const uri = firstSpace !== -1 ? raw.substring(0, firstSpace) : raw;
    const prompt = firstSpace !== -1 ? raw.substring(firstSpace + 1) : 'Generated Image';
    return {
      ...msg,
      role,
      type: MSG_TYPE.IMAGE,
      content: prompt,
      image: { uri, prompt }
    };
  }

  const extracted = extractCanvasFiles(raw);
  const out = {
    ...msg,
    role,
    type: MSG_TYPE.TEXT,
    content: extracted.content
  };
  if (extracted.canvasFiles.length) out.canvasFiles = extracted.canvasFiles;
  if (msg.canvasFiles && msg.canvasFiles.length) {
    out.canvasFiles = [...(out.canvasFiles || []), ...msg.canvasFiles];
  }
  return out;
}

/** For writers that still expect a string path (e.g. image cleanup). */
export function getImageUri(msg) {
  const n = normalizeMessage(msg);
  if (n.type === MSG_TYPE.IMAGE && n.image?.uri) return n.image.uri;
  if (typeof msg?.content === 'string' && msg.content.startsWith('@@@IMG|')) {
    const p = msg.content.split('|')[1];
    return p && p !== 'null' ? p : null;
  }
  return null;
}
