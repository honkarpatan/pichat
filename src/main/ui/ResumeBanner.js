/**
 * Resume / Discard incomplete agent runs — only for the CURRENT conversation.
 */
import { AicodeHarness } from '../agent/harness/AicodeHarness.js';
import { RunCheckpointStore } from '../agent/harness/RunCheckpointStore.js';
import { ToolRegistry } from '../core/tools/ToolRegistry.js';
import { pushChatEvent } from './chatInput/SlashCommands.js';

const TAG = '[ResumeBanner]';
const BANNER_ID = 'gpt-agent-resume-banner';

function formatAge(ts) {
  if (!ts) return '';
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function removeResumeBanner() {
  try { document.getElementById(BANNER_ID)?.remove(); } catch (_) {}
}

/**
 * @param {object} app
 */
export async function checkAndShowResumeBanner(app) {
  if (!app) return;
  removeResumeBanner();

  // Don't show while a generation is active
  if (app.isFetching) return;

  const conv = String(app.currentConversationIndex ?? '');

  let incomplete = [];
  try {
    // STRICT: only this conversation
    incomplete = await RunCheckpointStore.listIncomplete(5, {
      conversationId: conv,
      onlyConversation: true
    });
  } catch (e) {
    console.warn(TAG, e);
    return;
  }

  if (!incomplete?.length) return;

  const cp = incomplete[0];
  if (!cp?.runId) return;

  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.setAttribute('role', 'status');
  bar.dataset.runId = cp.runId;
  bar.dataset.conversationId = conv;
  bar.style.cssText = [
    'position:relative',
    'z-index:55',
    'width:100%',
    'box-sizing:border-box',
    'padding:8px 12px',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:10px',
    'background:var(--secondary-color,#1e1e2e)',
    'border-top:1px solid var(--border-color,#333)',
    'border-bottom:1px solid var(--border-color,#333)',
    'color:var(--primary-text-color,#eee)',
    'font-size:12px'
  ].join(';');

  const step = cp.step || 0;
  const age = formatAge(cp.updatedAt);
  const toolsN = Array.isArray(cp.loadedTools) ? cp.loadedTools.length : 0;

  bar.innerHTML = `
    <div style="min-width:0;flex:1;overflow:hidden;">
      <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        Interrupted agent run · step ${step}${age ? ` · ${age}` : ''}
      </div>
      <div style="font-size:10px;opacity:0.55;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${toolsN ? `${toolsN} tools were loaded` : 'Incomplete run'} · this chat only
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-shrink:0;">
      <button type="button" class="gpt-resume-discard" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border-color,#555);background:transparent;color:inherit;cursor:pointer;font-size:11px;">Discard</button>
      <button type="button" class="gpt-resume-go" style="padding:6px 14px;border-radius:8px;border:none;background:var(--button-background-color,#4b5dd1);color:#fff;cursor:pointer;font-size:11px;font-weight:600;">Resume</button>
    </div>
  `;

  const inputEl = document.getElementById('input-container');
  if (inputEl?.parentElement) {
    inputEl.parentElement.insertBefore(bar, inputEl);
  } else if (app.chatBox?.parentElement) {
    app.chatBox.parentElement.appendChild(bar);
  } else {
    document.body.appendChild(bar);
  }

  const hardDiscard = async (runId) => {
    // Delete this run + any other running for THIS conversation
    try {
      await RunCheckpointStore.discard(runId);
      await RunCheckpointStore.discardAll({ conversationId: conv });
    } catch (e) {
      console.warn(TAG, 'discard', e);
    }
  };

  bar.querySelector('.gpt-resume-discard').onclick = async () => {
    await hardDiscard(cp.runId);
    try {
      await pushChatEvent(app, `Discarded interrupted run (step ${step})`);
    } catch (_) {}
    removeResumeBanner();
    // Verify gone
    setTimeout(() => checkAndShowResumeBanner(app).catch(() => {}), 300);
  };

  bar.querySelector('.gpt-resume-go').onclick = async () => {
    try {
      if (Array.isArray(cp.loadedTools) && cp.loadedTools.length) {
        ToolRegistry.loadTools(app, cp.loadedTools);
      }
      app._resumedFromRunId = cp.runId;
      // Clear checkpoint BEFORE continue so restart won't show banner
      await hardDiscard(cp.runId);
      await pushChatEvent(
        app,
        `Resumed tools from step ${step}. Send a message to continue the task.`
      );
      const ta = document.querySelector('#gpt-input, #input-box, textarea.gpt-input, #chat-input');
      if (ta && !String(ta.value || '').trim()) {
        ta.value = 'Continue the previous interrupted task from where you left off.';
        try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        ta.focus?.();
      }
    } catch (e) {
      console.warn(TAG, e);
      try { await pushChatEvent(app, `Resume failed: ${e?.message || e}`); } catch (_) {}
    }
    removeResumeBanner();
  };
}

export function scheduleResumeBannerCheck(app, delayMs = 600) {
  if (!app) return;
  clearTimeout(app._resumeBannerTimer);
  app._resumeBannerTimer = setTimeout(() => {
    checkAndShowResumeBanner(app).catch(() => {});
  }, delayMs);
}
