/**
 * Real Plan mode: research (read-only mutations blocked) → user approves → execute.
 */
import { ConfigManager } from '../../utils/ConfigManager.js';

const TAG = '[PlanMode]';

export function isPlanMode() {
  try {
    const mode = String(ConfigManager.get('agentPermissionMode') || '').toLowerCase();
    if (mode === 'plan') return true;
  } catch (_) {}
  return false;
}

export function setPlanMode(on) {
  try {
    if (on) {
      // Remember previous mode to restore after execute (optional)
      const cur = String(ConfigManager.get('agentPermissionMode') || 'ask').toLowerCase();
      if (cur !== 'plan') {
        ConfigManager.set('agentPermissionModeBeforePlan', cur === 'plan' ? 'ask' : cur);
      }
      ConfigManager.set('agentPermissionMode', 'plan');
    } else {
      const prev = String(ConfigManager.get('agentPermissionModeBeforePlan') || 'ask').toLowerCase();
      const restore = ['ask', 'edits', 'full'].includes(prev) ? prev : 'ask';
      ConfigManager.set('agentPermissionMode', restore);
    }
  } catch (e) {
    console.warn(TAG, e);
  }
}

export function planModeSystemNudge() {
  return (
    '[SYSTEM: PLAN MODE is ON. You may only research: read, list_directory, glob, grep, fetch_content, ' +
    'tool_search, todo_write, ask_user_question, subagent(type=explore), answer_informational_query, finish_task. ' +
    'Do NOT write, edit, delete, or run shell. Build a clear todo plan with todo_write. ' +
    'When the plan is ready for the user to approve, call finish_task with a short summary of the plan. ' +
    'The user must Approve before any file changes.]'
  );
}

/**
 * Render approve/revise/discard card into the live chat.
 * @param {object} app
 * @param {{ summary?: string, items?: Array<{text:string,status?:string}> }} plan
 */
export function showPlanApproveCard(app, plan = {}) {
  const items = Array.isArray(plan.items) ? plan.items : [];
  const summary = String(plan.summary || '').trim();

  // Remove prior card
  try {
    document.getElementById('gpt-plan-approve-card')?.remove();
  } catch (_) {}

  const listHtml = items.length
    ? `<ol style="margin:8px 0 0;padding-left:18px;font-size:12px;line-height:1.45;color:var(--primary-text-color);">` +
      items
        .map(
          (it) =>
            `<li style="margin-bottom:4px;">${escapeHtml(it.text || it.task || '')}` +
            (it.status ? ` <span style="opacity:0.5;font-size:10px;">(${escapeHtml(it.status)})</span>` : '') +
            `</li>`
        )
        .join('') +
      `</ol>`
    : `<div style="font-size:12px;opacity:0.7;margin-top:6px;">No structured todos — summary only.</div>`;

  const card = document.createElement('div');
  card.id = 'gpt-plan-approve-card';
  card.setAttribute('role', 'dialog');
  card.style.cssText = [
    'margin:10px 8px',
    'padding:12px 14px',
    'border-radius:12px',
    'border:1px solid var(--border-color,#444)',
    'background:var(--secondary-color,#1e1e2e)',
    'color:var(--primary-text-color,#eee)',
    'box-shadow:0 6px 20px rgba(0,0,0,0.25)'
  ].join(';');

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="width:8px;height:8px;border-radius:50%;background:#f0c14b;flex-shrink:0;"></span>
      <b style="font-size:13px;">Plan ready for approval</b>
      <span style="font-size:10px;opacity:0.55;margin-left:auto;">Plan mode</span>
    </div>
    ${summary ? `<div style="font-size:12px;line-height:1.45;opacity:0.9;white-space:pre-wrap;">${escapeHtml(summary)}</div>` : ''}
    ${listHtml}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
      <button type="button" data-act="approve" style="padding:7px 14px;border:none;border-radius:8px;background:var(--button-background-color,#4b5dd1);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Approve &amp; execute</button>
      <button type="button" data-act="revise" style="padding:7px 14px;border:1px solid var(--border-color,#555);border-radius:8px;background:transparent;color:inherit;font-size:12px;cursor:pointer;">Revise</button>
      <button type="button" data-act="discard" style="padding:7px 14px;border:1px solid var(--border-color,#555);border-radius:8px;background:transparent;color:inherit;font-size:12px;cursor:pointer;">Discard</button>
    </div>
  `;

  const host =
    document.querySelector('#chat-box') ||
    document.querySelector('.chat-box') ||
    document.body;
  host.appendChild(card);
  try {
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (_) {}

  const run = async (act) => {
    try {
      card.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
      });
    } catch (_) {}

    if (act === 'discard') {
      setPlanMode(false);
      try {
        card.innerHTML =
          '<div style="font-size:12px;opacity:0.75;">Plan discarded. Permission mode restored.</div>';
      } catch (_) {}
      if (typeof window.toast === 'function') window.toast('Plan discarded', 2000);
      return;
    }

    if (act === 'revise') {
      // Stay in plan mode — user sends follow-up
      try {
        card.innerHTML =
          '<div style="font-size:12px;opacity:0.75;">Still in Plan mode — send a message to revise the plan.</div>';
      } catch (_) {}
      const input = document.getElementById('gpt-user-input');
      if (input) {
        input.focus();
        if (!input.value.trim()) {
          input.placeholder = 'Revise the plan…';
        }
      }
      if (typeof window.toast === 'function') window.toast('Plan mode still on — revise', 2000);
      return;
    }

    // Approve & execute
    const execMode = String(ConfigManager.get('agentPlanExecuteMode') || 'edits').toLowerCase();
    const mode = ['ask', 'edits', 'full'].includes(execMode) ? execMode : 'edits';
    try {
      ConfigManager.set('agentPermissionMode', mode);
    } catch (_) {}
    app._planApprovedForExecute = true;
    app._approvedPlanSnapshot = {
      summary,
      items: items.map((it) => ({
        text: it.text || it.task || '',
        status: 'pending'
      })),
      at: Date.now()
    };

    const todoLines = items
      .map((it, i) => `${i + 1}. ${it.text || it.task || ''}`)
      .filter((l) => l.length > 3)
      .join('\n');

    const prompt =
      'Plan approved by the user. EXECUTE the plan now. Apply file changes. ' +
      'Do not re-research from scratch. Work through todos in order.\n\n' +
      (summary ? `Summary:\n${summary}\n\n` : '') +
      (todoLines ? `Todos:\n${todoLines}\n` : '');

    const input =
      document.getElementById('gpt-user-input') ||
      document.querySelector('#user-input, textarea.gpt-user-input');
    if (input) {
      input.value = prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    try {
      card.innerHTML =
        `<div style="font-size:12px;">Approved → executing with mode <b>${escapeHtml(mode)}</b>…</div>`;
    } catch (_) {}

    const send =
      document.getElementById('send-btn') ||
      document.getElementById('gpt-send-btn') ||
      document.querySelector('.gpt-send-btn, #send-button');
    if (send) {
      setTimeout(() => {
        try {
          send.click();
        } catch (_) {}
      }, 80);
    } else if (typeof window.toast === 'function') {
      window.toast('Prompt filled — press Send', 2500);
    }
  };

  card.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => run(btn.getAttribute('data-act')));
  });

  // Stash for AgentLoop
  app._pendingPlanApproval = { summary, items, shownAt: Date.now() };
  console.log(TAG, 'approve card shown items=', items.length);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const PlanMode = {
  isPlanMode,
  setPlanMode,
  planModeSystemNudge,
  showPlanApproveCard
};
