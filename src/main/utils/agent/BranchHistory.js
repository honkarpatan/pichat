/**
 * ChatGPT-style message branches for edit + regenerate.
 *
 * Each USER message may own:
 *   branches: {
 *     active: number,
 *     versions: [
 *       { userContent, suffix: Message[] }  // suffix = everything AFTER this user msg
 *     ]
 *   }
 *
 * Switching versions restores that version's full subtree (lower prompts/responses).
 * Newer branches start with empty suffix until the user continues chatting.
 */

function deepClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
}

function cloneContent(c) {
  return deepClone(c);
}

function getConv(app) {
  const idx = parseInt(app.currentConversationIndex, 10);
  return app.conversations?.[idx] || null;
}

function ensureBranches(userMsg) {
  if (!userMsg.branches || !Array.isArray(userMsg.branches.versions)) {
    userMsg.branches = { active: 0, versions: [] };
  }
  return userMsg.branches;
}

/** Snapshot linear chat after userIdx into the active version (if any). */
function snapshotActive(app, userIdx) {
  const conv = getConv(app);
  if (!conv?.chat) return;
  const u = conv.chat[userIdx];
  if (!u || u.role !== 'user') return;
  const b = u.branches;
  if (!b?.versions?.length) return;
  const cur = b.versions[b.active];
  if (!cur) return;
  cur.userContent = cloneContent(u.content);
  cur.suffix = deepClone(conv.chat.slice(userIdx + 1));
}

export const BranchHistory = {
  /**
   * Edit commit: keep old version (user + full suffix), start new version with new text.
   * Clears messages after userIdx. Caller should send with { regenerate: true }.
   */
  commitEdit(app, userIdx, newUserContent) {
    const conv = getConv(app);
    if (!conv?.chat) return false;
    const i = Math.max(0, parseInt(userIdx, 10));
    const u = conv.chat[i];
    if (!u || u.role !== 'user') return false;

    const b = ensureBranches(u);
    if (!b.versions.length) {
      // First branch point — save current linear state as version 0
      b.versions.push({
        userContent: cloneContent(u.content),
        suffix: deepClone(conv.chat.slice(i + 1))
      });
      b.active = 0;
    } else {
      snapshotActive(app, i);
    }

    // New version
    b.versions.push({
      userContent: cloneContent(newUserContent),
      suffix: []
    });
    b.active = b.versions.length - 1;
    u.content = newUserContent;
    if (typeof newUserContent === 'string') {
      u.charCount = newUserContent.length;
    } else if (Array.isArray(newUserContent)) {
      const tx = newUserContent.filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
      u.charCount = tx.length;
    }
    u.createdAt = Date.now();

    conv.chat.splice(i + 1); // drop lower messages from active linear view
    app.chatHistory = [...conv.chat];
    return true;
  },

  /**
   * Regenerate: same user text, new empty suffix branch (old lower chats kept in previous version).
   */
  commitRegenerate(app, userIdx) {
    const conv = getConv(app);
    if (!conv?.chat) return false;
    const i = Math.max(0, parseInt(userIdx, 10));
    const u = conv.chat[i];
    if (!u || u.role !== 'user') return false;

    const b = ensureBranches(u);
    if (!b.versions.length) {
      b.versions.push({
        userContent: cloneContent(u.content),
        suffix: deepClone(conv.chat.slice(i + 1))
      });
      b.active = 0;
    } else {
      snapshotActive(app, i);
    }

    b.versions.push({
      userContent: cloneContent(u.content),
      suffix: []
    });
    b.active = b.versions.length - 1;
    conv.chat.splice(i + 1);
    app.chatHistory = [...conv.chat];
    return true;
  },

  /** Switch branch on user message: restore userContent + full suffix. */
  async switchBranch(app, userIdx, delta) {
    const conv = getConv(app);
    if (!conv?.chat) return false;
    const i = Math.max(0, parseInt(userIdx, 10));
    const u = conv.chat[i];
    if (!u?.branches?.versions?.length || u.branches.versions.length < 2) return false;

    const b = u.branches;
    // Save what is currently on screen into active version
    snapshotActive(app, i);

    let next = (b.active != null ? b.active : 0) + delta;
    next = Math.max(0, Math.min(b.versions.length - 1, next));
    if (next === b.active) return false;

    b.active = next;
    const ver = b.versions[next];
    u.content = cloneContent(ver.userContent);
    if (typeof u.content === 'string') u.charCount = u.content.length;
    else if (Array.isArray(u.content)) {
      const tx = u.content.filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
      u.charCount = tx.length;
    }

    // Replace everything after this user with the version suffix
    conv.chat.splice(i + 1, conv.chat.length - (i + 1), ...(ver.suffix || []));
    app.chatHistory = [...conv.chat];

    try {
      await app.chatHistoryManager?.renderChatHistory?.();
      const { HistoryFileOps } = await import('../../history/HistoryFileOps.js');
      await HistoryFileOps.saveActiveChat(app);
    } catch (e) {
      console.warn('[BranchHistory.switchBranch]', e);
    }
    return true;
  },

  branchInfo(userMsg) {
    const n = userMsg?.branches?.versions?.length || 0;
    if (n < 2) return null;
    const active = userMsg.branches.active != null ? userMsg.branches.active : n - 1;
    return { active, total: n };
  },

  /** Find owning user index for an assistant message index. */
  findUserIdx(chat, asstIndex) {
    let i = asstIndex;
    while (i > 0 && chat[i]?.role !== 'user') i--;
    return chat[i]?.role === 'user' ? i : -1;
  }
};
