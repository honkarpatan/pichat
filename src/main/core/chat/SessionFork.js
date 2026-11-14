/**
 * Session fork — copy conversation history up to a message into a new chat.
 */
const TAG = '[SessionFork]';

/**
 * @param {object} app
 * @param {{ upToIndex?: number, titleSuffix?: string }} [opts]
 *   upToIndex — last message index to include (inclusive). Default: all messages.
 */
export async function forkConversation(app, opts = {}) {
  if (!app) return { success: false, error: 'No app' };
  const hist = Array.isArray(app.chatHistory) ? app.chatHistory : [];
  if (!hist.length) return { success: false, error: 'Nothing to fork — empty chat' };

  let upTo = opts.upToIndex;
  if (upTo == null || !Number.isFinite(upTo)) upTo = hist.length - 1;
  upTo = Math.max(0, Math.min(hist.length - 1, Math.floor(upTo)));

  const slice = hist.slice(0, upTo + 1).map((m) => {
    try {
      return JSON.parse(JSON.stringify(m));
    } catch (_) {
      return { ...m };
    }
  });

  const model = app.selectedModel || app.currentConversation?.model || { name: 'Chat', type: 'openrouter' };
  const chm = app.chatHistoryManager;
  if (!chm?.startNewConversation) {
    return { success: false, error: 'ChatHistoryManager unavailable' };
  }

  // Start blank chat then inject forked messages
  await chm.startNewConversation(model, false);

  const conv = app.currentConversation;
  if (!conv) return { success: false, error: 'Failed to create conversation' };

  const baseTitle =
    (app.conversations?.[parseInt(app.currentConversationIndex, 10)]?.title) ||
    conv.title ||
    'Chat';
  const suffix = opts.titleSuffix || ' (fork)';
  const title = String(baseTitle).replace(/\s*\(fork\)\s*$/i, '') + suffix;

  conv.chat = slice;
  conv.title = title.slice(0, 80);
  conv.forkedFrom = {
    at: Date.now(),
    messageCount: slice.length,
    upToIndex: upTo
  };
  app.chatHistory = slice;

  // Persist
  try {
    if (app.storageManager?.saveConversations) {
      await app.storageManager.saveConversations(app.conversations);
    } else if (typeof chm.saveConversations === 'function') {
      await chm.saveConversations();
    }
  } catch (e) {
    console.warn(TAG, 'save', e);
  }

  // Re-render
  try {
    await chm.renderChatHistory?.(true);
    await chm.loadConversation?.(parseInt(app.currentConversationIndex, 10), true);
  } catch (e) {
    console.warn(TAG, 'render', e);
  }

  console.log(TAG, 'forked', slice.length, 'messages →', app.currentConversationIndex);
  return {
    success: true,
    messageCount: slice.length,
    conversationIndex: app.currentConversationIndex,
    title: conv.title
  };
}

/**
 * List a simple text tree of message roles for /tree
 */
export function conversationTreeText(app) {
  const hist = Array.isArray(app?.chatHistory) ? app.chatHistory : [];
  if (!hist.length) return '(empty chat)';
  return hist
    .map((m, i) => {
      const role = m.role || m.type || '?';
      let preview = '';
      if (typeof m.content === 'string') preview = m.content;
      else if (Array.isArray(m.content)) {
        preview = m.content.map(p => p?.text || p?.content || '').join(' ');
      }
      preview = String(preview).replace(/\s+/g, ' ').trim().slice(0, 48);
      return `${i}. [${role}] ${preview}${preview.length >= 48 ? '…' : ''}`;
    })
    .join('\n');
}
