/**
 * Combined rewind: restore chat length + file undo stack to a checkpoint.
 * Distinct from /fork (which keeps alternate branches).
 */
import { FileChangeHistory } from '../../utils/agent/FileChangeHistory.js';

const TAG = '[Rewind]';
const MAX_POINTS = 30;

function conv(app) {
  const idx = parseInt(app?.currentConversationIndex, 10);
  if (!Number.isFinite(idx) || idx < 0) return null;
  return app.conversations?.[idx] || app.currentConversation || null;
}

function fileUndoLen(app) {
  try {
    FileChangeHistory.hydrate(app);
    const st = app._fileHistory?.[String(app.currentConversationIndex ?? '0')];
    return Array.isArray(st?.undo) ? st.undo.length : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Snapshot current chat + file-history depth (call when a user turn starts).
 */
export function recordRewindPoint(app, label = '') {
  const c = conv(app);
  if (!c) return null;

  if (!Array.isArray(c.rewindPoints)) c.rewindPoints = [];

  const messageCount = Array.isArray(app.chatHistory)
    ? app.chatHistory.length
    : (Array.isArray(c.chat) ? c.chat.length : 0);

  const point = {
    id: `rw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    messageCount,
    fileUndoLen: fileUndoLen(app),
    label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 64)
  };

  // Avoid duplicate consecutive identical counts
  const last = c.rewindPoints[c.rewindPoints.length - 1];
  if (last && last.messageCount === point.messageCount && last.fileUndoLen === point.fileUndoLen) {
    last.at = point.at;
    if (point.label) last.label = point.label;
    return last;
  }

  c.rewindPoints.push(point);
  if (c.rewindPoints.length > MAX_POINTS) {
    c.rewindPoints = c.rewindPoints.slice(-MAX_POINTS);
  }

  console.log(TAG, 'point', point.messageCount, 'files@', point.fileUndoLen, point.label);
  return point;
}

export function listRewindPoints(app) {
  const c = conv(app);
  return Array.isArray(c?.rewindPoints) ? c.rewindPoints.slice() : [];
}

/**
 * Rewind to point index (0 = oldest) or negative (-1 = last point).
 * Restores file undos then truncates chat.
 */
export async function rewindTo(app, pointIndex = -1) {
  const c = conv(app);
  if (!c || !Array.isArray(c.rewindPoints) || !c.rewindPoints.length) {
    return { success: false, error: 'No rewind points. Send a message first.' };
  }

  let idx = pointIndex;
  if (idx < 0) idx = c.rewindPoints.length + idx;
  if (idx < 0 || idx >= c.rewindPoints.length) {
    return { success: false, error: `Invalid point index. Use 0…${c.rewindPoints.length - 1}` };
  }

  const point = c.rewindPoints[idx];
  const targetMsgs = Math.max(0, point.messageCount | 0);
  const targetFiles = Math.max(0, point.fileUndoLen | 0);

  // 1) Undo file changes until stack depth matches snapshot
  FileChangeHistory.hydrate(app);
  let undone = 0;
  let guard = 80;
  while (fileUndoLen(app) > targetFiles && guard-- > 0) {
    const r = await FileChangeHistory.undo(app);
    if (!r?.ok) break;
    undone++;
  }

  // 2) Truncate chat (discard forward messages)
  const chat = Array.isArray(c.chat) ? c.chat : [];
  c.chat = chat.slice(0, targetMsgs);
  app.chatHistory = [...c.chat];
  app.currentConversation = c;

  // Drop rewind points after this one (linear timeline)
  c.rewindPoints = c.rewindPoints.slice(0, idx + 1);

  // 3) Re-render
  try {
    const chm = app.chatHistoryManager;
    if (chm?.loadConversation) {
      await chm.loadConversation(parseInt(app.currentConversationIndex, 10), true);
    } else if (chm?.renderChatHistory) {
      await chm.renderChatHistory(true);
    }
  } catch (e) {
    console.warn(TAG, 'render', e);
  }

  // Persist
  try {
    if (app.storageManager?.saveConversations) {
      await app.storageManager.saveConversations(app.conversations);
    }
  } catch (_) {}

  console.log(TAG, 'restored msgs=', targetMsgs, 'fileUndos=', undone);
  return {
    success: true,
    messageCount: targetMsgs,
    filesUndone: undone,
    label: point.label,
    pointIndex: idx,
    message: `Rewound to point ${idx}` +
      (point.label ? ` (“${point.label}”)` : '') +
      ` — ${targetMsgs} messages, ${undone} file change(s) reverted`
  };
}

export function formatRewindList(app) {
  const pts = listRewindPoints(app);
  if (!pts.length) return 'No rewind points yet.';
  return pts
    .map((p, i) => {
      const t = new Date(p.at).toLocaleTimeString?.() || p.at;
      return `${i}. msgs=${p.messageCount} files@${p.fileUndoLen} ${t}` +
        (p.label ? ` — ${p.label}` : '');
    })
    .join('\n');
}

export const SessionRewind = {
  recordRewindPoint,
  listRewindPoints,
  rewindTo,
  formatRewindList
};
