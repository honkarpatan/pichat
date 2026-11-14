/**
 * Mid-run user messages (Pi steering queue idea).
 * While agent is fetching, Send queues text instead of starting a parallel run.
 * AgentLoop drains after each tool batch and injects as [STEERING] user messages.
 */
import { pushChatEvent } from '../../ui/chatInput/SlashCommands.js';

const TAG = '[SteeringQueue]';
const BADGE_ID = 'gpt-steering-badge';
const MAX_QUEUE = 8;
const MAX_TEXT = 4000;

function ensureQueue(app) {
  if (!app._steeringQueue) app._steeringQueue = [];
  return app._steeringQueue;
}

export function queueLength(app) {
  return ensureQueue(app).length;
}

export function clearSteeringQueue(app) {
  if (app) app._steeringQueue = [];
  updateSteeringBadge(app);
}

/**
 * @returns {{ ok: boolean, queued?: number, error?: string }}
 */
export function enqueueSteering(app, text) {
  const t = String(text || '').trim().slice(0, MAX_TEXT);
  if (!t) return { ok: false, error: 'empty' };
  const q = ensureQueue(app);
  if (q.length >= MAX_QUEUE) {
    return { ok: false, error: `Queue full (max ${MAX_QUEUE})` };
  }
  q.push({ text: t, at: Date.now() });
  console.log(TAG, 'enqueued', q.length, t.slice(0, 80));
  updateSteeringBadge(app);
  try {
    pushChatEvent(app, `Queued for agent (${q.length}): ${t.slice(0, 48)}${t.length > 48 ? '…' : ''}`);
  } catch (_) {}
  return { ok: true, queued: q.length };
}

/**
 * Drain all pending steering messages (clears queue).
 * @returns {string[]}
 */
export function drainSteering(app) {
  const q = ensureQueue(app);
  if (!q.length) return [];
  const texts = q.map(x => x.text);
  app._steeringQueue = [];
  updateSteeringBadge(app);
  console.log(TAG, 'drained', texts.length);
  return texts;
}

/**
 * Format injection for workingMessages (one combined user message).
 */
export function formatSteeringInjection(texts) {
  if (!texts?.length) return null;
  const body = texts.map((t, i) => `(${i + 1}) ${t}`).join('\n');
  return {
    role: 'user',
    content: [{
      text:
        `[STEERING — user message(s) while you were working]\n` +
        `Incorporate these instructions on the next steps. Do not ignore them.\n` +
        body
    }]
  };
}

export function updateSteeringBadge(app) {
  const n = queueLength(app);
  let el = document.getElementById(BADGE_ID);
  if (n <= 0) {
    try { el?.remove(); } catch (_) {}
    return;
  }
  if (!el) {
    el = document.createElement('button');
    el.id = BADGE_ID;
    el.type = 'button';
    el.title = 'Click to clear queued steering messages';
    el.style.cssText = [
      'position:absolute',
      'right:48px',
      'bottom:100%',
      'margin-bottom:4px',
      'z-index:60',
      'padding:4px 10px',
      'border-radius:999px',
      'border:1px solid var(--border-color,#444)',
      'background:var(--button-background-color,#4b5dd1)',
      'color:#fff',
      'font-size:11px',
      'font-weight:600',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,0.25)'
    ].join(';');
    el.onclick = () => {
      clearSteeringQueue(app);
      try { pushChatEvent(app, 'Cleared steering queue'); } catch (_) {}
    };
    const input = document.getElementById('input-container');
    if (input) {
      if (getComputedStyle(input).position === 'static') {
        input.style.position = 'relative';
      }
      input.appendChild(el);
    } else {
      document.body.appendChild(el);
    }
  }
  el.textContent = n === 1 ? '1 queued' : `${n} queued`;
}

function ensureFollowUp(app) {
  if (!app._followUpQueue) app._followUpQueue = [];
  return app._followUpQueue;
}

export function enqueueFollowUp(app, text) {
  const t = String(text || '').trim().slice(0, MAX_TEXT);
  if (!t) return { ok: false, error: 'empty' };
  const q = ensureFollowUp(app);
  if (q.length >= MAX_QUEUE) return { ok: false, error: `Follow-up full (max ${MAX_QUEUE})` };
  q.push({ text: t, at: Date.now() });
  console.log(TAG, 'follow-up enqueued', q.length);
  try {
    pushChatEvent(app, `Follow-up queued (${q.length}): ${t.slice(0, 48)}${t.length > 48 ? '…' : ''}`);
  } catch (_) {}
  updateFollowUpBadge(app);
  return { ok: true, queued: q.length };
}

export function drainFollowUp(app) {
  const q = ensureFollowUp(app);
  if (!q.length) return [];
  const texts = q.map(x => x.text);
  app._followUpQueue = [];
  updateFollowUpBadge(app);
  return texts;
}

export function clearFollowUpQueue(app) {
  if (app) app._followUpQueue = [];
  updateFollowUpBadge(app);
}

export function followUpLength(app) {
  return ensureFollowUp(app).length;
}

function updateFollowUpBadge(app) {
  const n = followUpLength(app);
  const ID = 'gpt-followup-badge';
  let el = document.getElementById(ID);
  if (n <= 0) {
    try { el?.remove(); } catch (_) {}
    return;
  }
  if (!el) {
    el = document.createElement('button');
    el.id = ID;
    el.type = 'button';
    el.title = 'Follow-ups run after the agent finishes';
    el.style.cssText =
      'position:absolute;right:48px;bottom:100%;margin-bottom:28px;z-index:60;padding:4px 10px;' +
      'border-radius:999px;border:1px solid var(--border-color,#444);background:var(--secondary-color,#333);' +
      'color:var(--primary-text-color,#eee);font-size:11px;font-weight:600;cursor:pointer';
    el.onclick = () => {
      clearFollowUpQueue(app);
      try { pushChatEvent(app, 'Cleared follow-up queue'); } catch (_) {}
    };
    const input = document.getElementById('input-container');
    if (input) {
      if (getComputedStyle(input).position === 'static') input.style.position = 'relative';
      input.appendChild(el);
    }
  }
  el.textContent = n === 1 ? '1 follow-up' : `${n} follow-ups`;
}

export const SteeringQueue = {
  enqueueSteering,
  drainSteering,
  formatSteeringInjection,
  clearSteeringQueue,
  queueLength,
  updateSteeringBadge,
  enqueueFollowUp,
  drainFollowUp,
  clearFollowUpQueue,
  followUpLength
};
