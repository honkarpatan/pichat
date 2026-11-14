// src/main/utils/message/PartsRenderer.js
//
// Public API unchanged (upsert, scheduleUpsert, flushPending, renderAll,
// reset, mountWorkShell, finalizeWorkShell) — ChatHandler.js, LiveChatUI.js,
// ChatRenderer.js, PendingWriteGate.js, SequentialFileGate.js need no
// further changes for the icon/chevron update.
//
// 🟢 Chevron toggling now uses classList('is-open') on an SVG-wrapping span
// instead of swapping unicode ∨/∧ text — CSS rotates the icon.
// 🟢 Exports paintUpsertResult(turn, result) — the fix for interleaved text
// parts staying "raw" forever in agent mode. upsertToolPart/upsertFilePart/
// upsertPlanPart (MessagePart.js) now return { part, sealed }, where
// `sealed` is the just-finalized text part that needs one more paint to
// flip from raw/streaming into full markdown. Every call site must route
// through paintUpsertResult so that repaint actually happens.

import { PART_TYPE, PART_STATUS } from './MessagePart.js';
import { addCopyButton } from '../editor/CodeBlockHelper.js';
import { formatWorkedDuration, formatWorkingDuration } from '../agent/AgentActionUI.js'; // pure formatters
import {
  escapeHtml,
  chevronHtml,
  toolRowHtml,
  searchGroupHtml,
  fileRowHtml,
  planCardHtml,
  thinkingCardHtml,
  getOcRowCollapseMode,
  resolveOcRowOpen
} from '../OpenCodeUI.js';

function isSearchPart(part) {
  return part.type === PART_TYPE.TOOL && (part.kind === 'web' || part.fcName === 'web_search');
}

export class PartsRenderer {
  constructor(container, opts = {}) {
    this.container = container;
    this.map = new Map();        // partId -> element
    this._topEls = new Map();    // topLevelKey -> wrapper element (collapse bookkeeping)
    this._userOpen = new Map();  // topLevelKey -> bool (manual override, wins over auto-collapse)
    this._lastTouchedKey = null; // most-recent top-level key — the ONLY one auto-open by default

    this._activeGroupId = null;
    this._activeGroupEl = null;
    this._activeGroupParts = null;

    this.renderMarkdown = opts.renderMarkdown || ((t) => escapeHtml(t));
    this.collapseHeadings = typeof opts.collapseHeadings === 'function' ? opts.collapseHeadings : null;
    this.onLinkOpen = opts.onLinkOpen || ((u) => { try { window.open(u, '_blank'); } catch (_) {} });
    this.app = opts.app || null;
    this.getCollapseMode = opts.getCollapseMode || (() => getOcRowCollapseMode(this.app));

    this._raf = null;
    this._pending = new Map();
    this._lastPaint = new Map();
    this._minIntervalMs = opts.minIntervalMs != null ? opts.minIntervalMs : 90;
  }

  // ---------------------------------------------------------- public API

  upsert(part) {
    if (!part || !part.id) return null;

    if (part.type === PART_TYPE.TEXT) {
      this._breakGroup();
      return this._upsertText(part);
    }
    if (part.type === PART_TYPE.PLAN) {
      this._breakGroup();
      return this._upsertPlan(part);
    }
    if (part.type === PART_TYPE.THINKING) {
      this._breakGroup();
      return this._upsertThinking(part);
    }
    if (isSearchPart(part)) {
      return this._upsertSearch(part);
    }
    this._breakGroup();
    return this._upsertRow(part);
  }

  scheduleUpsert(part) {
    if (!part || !part.id) return;
    this._pending.set(part.id, part);
    this._ensureLoop();
  }

  flushPending() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    const batch = Array.from(this._pending.values());
    this._pending.clear();
    for (const p of batch) this.upsert(p);
  }

  renderAll(parts) {
    this.reset();
    for (const part of parts || []) this.upsert(part);
  }

  reset() {
    this.container.innerHTML = '';
    this.map.clear();
    this._topEls.clear();
    this._userOpen.clear();
    this._lastTouchedKey = null;
    this._activeGroupId = null;
    this._activeGroupEl = null;
    this._activeGroupParts = null;
    this._pending.clear();
    this._lastPaint.clear();
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  mountWorkShell(hostEl, { durationSec = null, stepCount = 0, open = true, live = true } = {}) {
    let shell = hostEl.querySelector(':scope > .gpt-oc-work');
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'gpt-oc-work';
      shell.innerHTML = `
        <div class="gpt-oc-work-header">
          <span class="gpt-oc-work-dot"></span>
          <span class="gpt-oc-work-title"></span>
          ${chevronHtml(open)}
        </div>
        <div class="gpt-oc-work-body"></div>
      `;
      hostEl.insertBefore(shell, hostEl.firstChild);
      shell.querySelector('.gpt-oc-work-body').appendChild(this.container);
      shell.querySelector('.gpt-oc-work-header').addEventListener('click', () => {
        const nowOpen = !shell.classList.contains('is-open');
        this._setWorkOpen(shell, nowOpen);
      });
      // Live stream: show body immediately (no collapse animation on first mount)
      const body0 = shell.querySelector('.gpt-oc-work-body');
      if (open) {
        shell.classList.add('is-open');
        shell.querySelector('.gpt-oc-chevron')?.classList.add('is-open');
        if (body0) {
          body0.style.maxHeight = 'none';
          body0.style.opacity = '1';
          body0.style.overflow = 'visible';
        }
      } else {
        shell.classList.remove('is-open');
        shell.querySelector('.gpt-oc-chevron')?.classList.remove('is-open');
        if (body0) {
          body0.style.maxHeight = '0px';
          body0.style.opacity = '0';
          body0.style.overflow = 'hidden';
        }
      }
      shell._workStartedAt = Date.now();
    }
    // History / finished turns: never start a live "Working for Xs" timer.
    // Only the active streaming turn (live=true + durationSec=null) ticks.
    if (durationSec != null || live === false) {
      this._stopWorkTimer(shell);
      const title = shell.querySelector('.gpt-oc-work-title');
      const sec = durationSec != null ? durationSec : 1;
      if (title) title.textContent = formatWorkedDuration(sec);
      shell.classList.remove('is-working');
    } else {
      shell.classList.add('is-working');
      if (!shell._workStartedAt) shell._workStartedAt = Date.now();
      this._tickWorkTitle(shell);
      this._startWorkTimer(shell);
    }
    return shell;
  }

  _tickWorkTitle(shell) {
    const title = shell?.querySelector?.('.gpt-oc-work-title');
    if (!title || !shell._workStartedAt) return;
    if (shell._workPaused) return; // Accept/Reject wait — do not count
    const accum = shell._workAccumMs || 0;
    const sec = Math.max(0, Math.floor((accum + (Date.now() - shell._workStartedAt)) / 1000));
    title.textContent = formatWorkingDuration(sec);
  }

  _startWorkTimer(shell) {
    if (!shell || shell._workTimer) return;
    shell._workTimer = setInterval(() => {
      if (!shell.classList.contains('is-working') || shell._workPaused) {
        if (!shell.classList.contains('is-working')) this._stopWorkTimer(shell);
        return;
      }
      this._tickWorkTitle(shell);
    }, 1000);
  }

  _stopWorkTimer(shell) {
    if (shell?._workTimer) {
      clearInterval(shell._workTimer);
      shell._workTimer = null;
    }
  }

  finalizeWorkShell(hostEl, durationSec) {
    if (!hostEl) return null;
    let shell = hostEl.querySelector(':scope > .gpt-oc-work');
    // Always kill live timer first — abort / provider switch must not leave Working for Xs ticking
    if (shell) {
      this._stopWorkTimer(shell);
      shell.classList.remove('is-working');
      if (durationSec != null && Number.isFinite(Number(durationSec))) {
        shell.dataset.durationSec = String(Math.max(1, Math.round(Number(durationSec))));
      }
    }
    // No work shell yet — only create if there is real work (tools / files / plan / thinking)
    if (!shell) {
      const hasWork = this._containerHasWorkRows();
      if (!hasWork) return null; // pure chat answer — never wrap in "Worked for Ns"
      shell = this.mountWorkShell(hostEl, { durationSec, open: false, live: false });
    }
    const body = shell.querySelector('.gpt-oc-work-body');

    // Prose outside collapsed shell
    this._evacuateProseOutsideWork(hostEl, shell, body);

    // If evacuation left work body empty of work rows, remove the empty shell entirely
    if (!this._containerHasWorkRows()) {
      try {
        // Move any leftover text out then remove shell
        const source = this.container;
        let prose = hostEl.querySelector(':scope > .gpt-oc-prose');
        if (!prose) {
          prose = document.createElement('div');
          prose.className = 'gpt-oc-prose';
          hostEl.insertBefore(prose, shell);
        }
        if (source) {
          [...source.querySelectorAll('.gpt-oc-text')].forEach(el => prose.appendChild(el));
        }
        // Re-home parts host if it was inside shell
        if (this.container && shell.contains(this.container)) {
          hostEl.insertBefore(this.container, shell);
        }
        shell.remove();
      } catch (_) {}
      this._releaseAllPlanSticky(hostEl);
      return null;
    }

    this._setWorkOpen(shell, false);
    shell.classList.remove('is-working');
    this._stopWorkTimer(shell);

    this._releaseAllPlanSticky(hostEl);
    return shell;
  }

  _containerHasWorkRows() {
    const root = this.container;
    if (!root || !root.children) return false;
    for (const el of root.children) {
      if (!el?.classList) continue;
      // tool / file / plan / thinking rows — not plain text
      if (el.classList.contains('gpt-oc-row-wrap') ||
          el.classList.contains('gpt-oc-plan-wrap') ||
          el.classList.contains('gpt-thinking-wrap') ||
          el.classList.contains('gpt-oc-group')) {
        return true;
      }
    }
    return false;
  }

  /**
   * OpenCode / Cursor style:
   * - "Let me read…", "I'll update…" stay INSIDE Worked (interleaved with tools).
   * - Only FINAL trailing summary (text AFTER the last tool/file/plan row)
   *   moves OUTSIDE under the collapsed "Worked for Ns" shell.
   */
  _evacuateProseOutsideWork(hostEl, shell, body) {
    if (!hostEl || !shell) return;
    const source = this.container
      || body?.querySelector?.('.gpt-agent-parts')
      || shell.querySelector('.gpt-oc-work-body .gpt-agent-parts')
      || body
      || shell.querySelector('.gpt-oc-work-body');
    if (!source) return;

    const children = [...source.children];
    if (!children.length) return;

    let lastWorkIdx = -1;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      if (!el.classList?.contains('gpt-oc-text')) lastWorkIdx = i;
    }

    // No tool/thinking rows at all → move ALL text outside (normal chat must not sit under Worked)
    let trailing;
    if (lastWorkIdx < 0) {
      trailing = children.filter(el => el.classList?.contains('gpt-oc-text'));
    } else {
      trailing = children.slice(lastWorkIdx + 1).filter(el =>
        el.classList?.contains('gpt-oc-text')
      );
    }
    if (!trailing.length) return;

    let prose = hostEl.querySelector(':scope > .gpt-oc-prose');
    if (!prose) {
      prose = document.createElement('div');
      prose.className = 'gpt-oc-prose';
      if (shell.nextSibling) hostEl.insertBefore(prose, shell.nextSibling);
      else hostEl.appendChild(prose);
    }
    for (const el of trailing) {
      prose.appendChild(el);
    }
  }

  _releaseAllPlanSticky(root) {
    const scope = root || document;
    const plans = scope.querySelectorAll
      ? scope.querySelectorAll('.gpt-oc-plan-wrap')
      : [];
    plans.forEach((el) => {
      el.classList.remove('is-sticky', 'is-fixed-sticky', 'is-compact', 'is-expanded');
      el.dataset.status = 'done';
      const sticky = el.querySelector('.gpt-oc-plan-sticky');
      if (sticky) {
        sticky.style.position = '';
        sticky.style.top = '';
        sticky.style.left = '';
        sticky.style.width = '';
        sticky.style.right = '';
        sticky.style.zIndex = '';
      }
      if (el._planPlaceholder) {
        try { el._planPlaceholder.remove(); } catch (_) {}
        el._planPlaceholder = null;
      }
      el._planIsStuck = false;
      // Unwire scroll handlers so old plans never re-pin
      if (el._planScrollEl && el._planOnScroll) {
        try { el._planScrollEl.removeEventListener('scroll', el._planOnScroll); } catch (_) {}
      }
      if (el._planOnResize) {
        try { window.removeEventListener('resize', el._planOnResize); } catch (_) {}
      }
      el._planScrollWired = false;
    });
  }

  // ---------------------------------------------------------- collapse bookkeeping

  _markMostRecent(key) {
    const prev = this._lastTouchedKey;
    this._lastTouchedKey = key;
    const mode = this.getCollapseMode?.() || 'running';
    // uncollapse: keep all open; remember: only collapse if user never toggled and mode wants it
    if (mode === 'uncollapse') return;
    if (mode === 'remember') return; // user-controlled only
    if (prev && prev !== key && !this._userOpen.has(prev)) {
      this._collapseTop(prev);
    }
  }

  _collapseTop(key) {
    const el = this._topEls.get(key);
    if (!el) return;
    const row = el.querySelector(':scope > .gpt-oc-row-main > .gpt-oc-row[data-toggle="1"]');
    const body = el.querySelector(':scope > .gpt-oc-row-main > .gpt-oc-row-body');
    if (!row || !body) return;
    this._setRowBodyOpen(body, false);
    row.querySelector('.gpt-oc-chevron')?.classList.remove('is-open');
  }


  /** Animate Working shell open/close; stagger rail rows on open. */
  _setWorkOpen(shell, open) {
    if (!shell) return;
    const body = shell.querySelector('.gpt-oc-work-body');
    if (!body) {
      shell.classList.toggle('is-open', !!open);
      shell.querySelector('.gpt-oc-chevron')?.classList.toggle('is-open', !!open);
      return;
    }

    // Critical: history/older code set display:none — that hides content forever
    try {
      body.style.display = '';
      body.style.removeProperty('display');
    } catch (_) {}

    if (open) {
      const host = body.querySelector('.gpt-agent-parts') || this.container || body;
      const kids = host ? [...host.children].filter((el) => el?.classList) : [];
      kids.forEach((el, i) => {
        if (
          el.classList.contains('gpt-oc-row-wrap') ||
          el.classList.contains('gpt-thinking-wrap') ||
          el.classList.contains('gpt-oc-plan-wrap') ||
          el.classList.contains('gpt-oc-group')
        ) {
          el.style.setProperty('--oc-i', String(i));
        }
      });

      body.style.overflow = 'hidden';
      body.style.opacity = '0';
      body.style.maxHeight = '0px';
      shell.classList.add('is-open');
      shell.classList.add('is-opening');
      shell.querySelector('.gpt-oc-chevron')?.classList.add('is-open');

      void body.offsetHeight;
      // Measure after display is restored
      const h = Math.max(body.scrollHeight, host?.scrollHeight || 0, 48);
      body.style.maxHeight = `${h}px`;
      body.style.opacity = '1';

      clearTimeout(shell._openAnimTimer);
      shell._openAnimTimer = setTimeout(() => {
        shell.classList.remove('is-opening');
        body.style.maxHeight = 'none';
        body.style.overflow = 'visible';
        body.style.opacity = '';
      }, Math.min(1200, 380 + kids.length * 48));
    } else {
      shell.classList.remove('is-opening');
      const h = Math.max(body.scrollHeight, 1);
      body.style.overflow = 'hidden';
      body.style.maxHeight = body.style.maxHeight === 'none' || !body.style.maxHeight
        ? `${h}px`
        : body.style.maxHeight;
      void body.offsetHeight;
      body.style.maxHeight = '0px';
      body.style.opacity = '0';
      shell.classList.remove('is-open');
      shell.querySelector('.gpt-oc-chevron')?.classList.remove('is-open');
      clearTimeout(shell._openAnimTimer);
      shell._openAnimTimer = setTimeout(() => {
        // keep maxHeight 0 — never display:none
        body.style.opacity = '';
      }, 400);
    }
  }

  _setRowBodyOpen(body, open) {
    if (!body) return;
    try {
      body.style.display = '';
      body.style.removeProperty('display');
    } catch (_) {}
    body.classList.toggle('is-expanded', !!open);
    // Never leave inline max-height when collapsed — it overrides CSS height:0
    if (open) {
      try {
        body.style.removeProperty('max-height');
        body.style.removeProperty('opacity');
        body.style.removeProperty('overflow');
        body.style.removeProperty('padding');
        body.style.removeProperty('margin');
      } catch (_) {}
      // Scrollable content area only while expanded
      body.style.maxHeight = '280px';
      body.style.overflow = 'auto';
    } else {
      try {
        body.style.maxHeight = '0px';
        body.style.opacity = '0';
        body.style.overflow = 'hidden';
        body.style.padding = '0';
        body.style.margin = '0';
        body.style.borderWidth = '0';
      } catch (_) {}
    }
  }

  _desiredOpen(key, part = null) {
    const mode = this.getCollapseMode?.() || 'running';
    const status = part?.status || '';
    return resolveOcRowOpen({
      mode,
      key,
      status,
      userOpen: this._userOpen,
      lastTouchedKey: this._lastTouchedKey
    });
  }

  _wireToggle(el, key) {
    const row = el.querySelector(':scope > .gpt-oc-row-main > .gpt-oc-row[data-toggle="1"]');
    if (!row || row._ocWired) return;
    row._ocWired = true;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.gpt-oc-eye, .gpt-card-actions')) return;
      const body = el.querySelector(':scope > .gpt-oc-row-main > .gpt-oc-row-body');
      if (!body) return;
      const nowOpen = !body.classList.contains('is-expanded');
      this._setRowBodyOpen(body, nowOpen);
      this._userOpen.set(key, nowOpen);
      row.querySelector('.gpt-oc-chevron')?.classList.toggle('is-open', nowOpen);
    });
  }

  _wireLinks(el) {
    el.querySelectorAll('.gpt-oc-entry.is-link[data-url]').forEach(row => {
      if (row._ocWired) return;
      row._ocWired = true;
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        const u = row.getAttribute('data-url');
        if (u) this.onLinkOpen(u);
      });
    });
  }

  // ---------------------------------------------------------- tool / file rows

  _upsertRow(part) {
    const key = part.id;
    this._markMostRecent(key);
    const open = this._desiredOpen(key, part);
    const prev = this._topEls.get(key);

    // Streaming file: update ONLY the diff body — avoid full replaceWith (title jitter)
    const streamingFile = part.type === PART_TYPE.FILE &&
      (part.status === 'streaming' || part.status === 'running' || part.status === PART_STATUS.STREAMING || part.status === PART_STATUS.RUNNING) &&
      prev && prev.parentNode && prev.classList.contains('gpt-oc-file');

    if (streamingFile) {
      const body = prev.querySelector('.gpt-oc-diff-body, .gpt-oc-row-body');
      if (body && (part.newContent != null || part.oldContent != null)) {
        const tmp = document.createElement('div');
        tmp.innerHTML = fileRowHtml(part, { open: true });
        const newBody = tmp.querySelector('.gpt-oc-diff-body, .gpt-oc-row-body');
        if (newBody) {
          this._setRowBodyOpen(body, true);
          body.innerHTML = newBody.innerHTML;
          if (!body._autoScrollBound) {
            body._autoScrollBound = true;
            body._autoScroll = true;
            if (body.classList.contains('is-expanded')) body.style.maxHeight = body.style.maxHeight || '280px';
        else { body.style.maxHeight = '0px'; body.style.overflow = 'hidden'; }
            body.style.overflow = body.style.overflow || 'auto';
            body.addEventListener('scroll', () => {
              const near = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
              body._autoScroll = near;
            }, { passive: true });
          }
          if (body._autoScroll !== false) body.scrollTop = body.scrollHeight;
        }
        const meta = prev.querySelector('.gpt-oc-row-meta');
        const name = (part.path || '').split('/').pop() || part.path || '';
        if (meta && name && meta.textContent !== name) meta.textContent = name;
        prev.dataset.status = part.status || prev.dataset.status;
        prev.classList.add('is-streaming');
        this.map.set(part.id, prev);
        return prev;
      }
    }

    const html = part.type === PART_TYPE.FILE ? fileRowHtml(part, { open }) : toolRowHtml(part, { open });

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const el = tmp.firstElementChild;
    el.dataset.partId = part.id;

    const isNew = !(prev && prev.parentNode);
    if (prev && prev.parentNode) prev.replaceWith(el);
    else {
      el.classList.add('gpt-oc-enter');
      this.container.appendChild(el);
    }

    // Wire auto-scroll on file diff body
    try {
      const body = el.querySelector('.gpt-oc-diff-body, .gpt-oc-row-body');
      if (body && !body._autoScrollBound) {
        body._autoScrollBound = true;
        body._autoScroll = true;
        if (body.classList.contains('is-expanded')) body.style.maxHeight = body.style.maxHeight || '280px';
        else { body.style.maxHeight = '0px'; body.style.overflow = 'hidden'; }
        body.style.overflow = body.style.overflow || 'auto';
        body.addEventListener('scroll', () => {
          const near = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
          body._autoScroll = near;
        }, { passive: true });
      }
    } catch (_) {}

    this._topEls.set(key, el);
    this.map.set(part.id, el);
    this._wireToggle(el, key);
    this._wireLinks(el);
    // Keep collapsed bodies at 0 height (no leftover inline max-height)
    try {
      const rb = el.querySelector(':scope > .gpt-oc-row-main > .gpt-oc-row-body');
      if (rb) this._setRowBodyOpen(rb, !!open);
    } catch (_) {}

    if (isNew) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('gpt-oc-enter-active'));
      });
    }
    return el;
  }


  _upsertThinking(part) {
    const id = part.id;
    const key = id;
    this._markMostRecent(key);
    const streaming = part.status === PART_STATUS.STREAMING || part.status === PART_STATUS.RUNNING;
    let open;
    if (this._userOpen.has(key)) open = this._userOpen.get(key);
    else open = streaming; // open while streaming so user sees text + auto-scroll

    const md = (t) => {
      try {
        if (this.renderMarkdown.length >= 2) return this.renderMarkdown(t, { skipThinkBox: true });
      } catch (_) {}
      // Our renderMarkdown from ChatHandler is usually (t) => Formatter.renderMarkdown(app, t)
      const raw = this.renderMarkdown(t);
      // Strip nested think-box if parent pipeline always injects it
      if (typeof raw === 'string' && raw.includes('gpt-think-box')) {
        return raw
          .replace(/<details class="gpt-think-box"[^>]*>[\s\S]*?<summary>[\s\S]*?<\/summary>/gi, '')
          .replace(/<\/div><\/details>/gi, '')
          .replace(/<details class="gpt-think-box"[^>]*>[\s\S]*?<\/details>/gi, '');
      }
      return raw;
    };
    const html = thinkingCardHtml(part, { open, renderMarkdown: md });
    let el = this.map.get(id);
    const isNew = !el || !el.parentNode;

    if (isNew) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      el = tmp.firstElementChild;
      el.classList.add('gpt-oc-enter');
      this.container.appendChild(el);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('gpt-oc-enter-active'));
      });
    } else {
      const bodyPrev = el.querySelector('.gpt-oc-row-body');
      const stick = bodyPrev && bodyPrev._autoScroll !== false &&
        (bodyPrev.scrollHeight - bodyPrev.scrollTop - bodyPrev.clientHeight < 56);
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const next = tmp.firstElementChild;
      el.replaceWith(next);
      el = next;
      if (stick || streaming) {
        const body = el.querySelector('.gpt-oc-row-body');
        if (body && body._autoScroll !== false) {
          body.scrollTop = body.scrollHeight;
        }
      }
    }

    this.map.set(id, el);
    this._topEls.set(key, el);
    this._wireToggle(el, key);

    // Smart auto-scroll: follow new tokens unless user scrolled up
    try {
      const body = el.querySelector('.gpt-oc-row-body');
      if (body && !body._thinkScrollBound) {
        body._thinkScrollBound = true;
        body._autoScroll = true;
        body.addEventListener('scroll', () => {
          const gap = body.scrollHeight - body.scrollTop - body.clientHeight;
          body._autoScroll = gap < 48;
        }, { passive: true });
      }
      if (body && streaming && body._autoScroll !== false) {
        body.scrollTop = body.scrollHeight;
      }
    } catch (_) {}

    this._lastTouchedKey = key;
    return el;
  }

  // ---------------------------------------------------------- grouped web search



  _upsertSearch(part) {
    if (!this._activeGroupParts) {
      this._activeGroupId = `group:search:${part.id}`;
      this._activeGroupParts = new Map();
      this._activeGroupEl = null;
    }
    this._activeGroupParts.set(part.id, part);
    this.map.set(part.id, null); // resolved to real element below

    const key = this._activeGroupId;
    this._markMostRecent(key);
    const open = this._desiredOpen(key, part);

    const parts = Array.from(this._activeGroupParts.values());
    const html = searchGroupHtml(parts, { open });
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const el = tmp.firstElementChild;
    el.dataset.groupId = key;

    if (this._activeGroupEl && this._activeGroupEl.parentNode) this._activeGroupEl.replaceWith(el);
    else this.container.appendChild(el);
    this._activeGroupEl = el;

    this._topEls.set(key, el);
    for (const p of parts) this.map.set(p.id, el);
    this._wireToggle(el, key);
    return el;
  }

  _breakGroup() {
    this._activeGroupId = null;
    this._activeGroupEl = null;
    this._activeGroupParts = null;
  }

  // ---------------------------------------------------------- plan (sticky + compact when scrolled)

  _upsertPlan(part) {
    const key = part.id;
    const tmp = document.createElement('div');
    tmp.innerHTML = planCardHtml(part);
    const el = tmp.firstElementChild;
    el.dataset.partId = part.id;
    const prev = this._topEls.get(key);
    const wasCompact = !!(prev && prev.classList.contains('is-compact'));
    if (prev && prev.parentNode) prev.replaceWith(el);
    else {
      el.classList.add('gpt-oc-enter');
      this.container.appendChild(el);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('gpt-oc-enter-active'));
      });
    }
    if (wasCompact) el.classList.add('is-compact');
    this._topEls.set(key, el);
    this.map.set(part.id, el);
    // Sticky ONLY while this plan is still running in the active turn
    if (part.status === PART_STATUS.RUNNING || part.status === 'running') {
      this._wirePlanSticky(el);
    } else {
      el.classList.remove('is-sticky', 'is-fixed-sticky', 'is-compact');
      // Don't attach scroll sticky for completed/historical plans
    }
    return el;
  }

  /**
   * Plan sticky against #chat-box (the real scroll container).
   * CSS position:sticky often fails inside nested flex/holders in Acode's WebView,
   * so we pin .gpt-oc-plan-sticky with position:fixed while the sentinel is above
   * the chat-box top — full width, no side-by-side gap.
   * Click compact/header toggles is-expanded (full list).
   */
  _wirePlanSticky(el) {
    if (!el) return;

    if (!el._planClickWired) {
      el._planClickWired = true;
      el.addEventListener('click', (ev) => {
        const hit = ev.target.closest('[data-plan-toggle="1"]');
        if (!hit || !el.contains(hit)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const expanded = el.classList.toggle('is-expanded');
        if (expanded) {
          el.classList.remove('is-compact');
        } else if (el._planIsStuck) {
          el.classList.add('is-compact');
        }
        // Re-measure after expand/collapse height change
        requestAnimationFrame(() => this._syncPlanSticky(el));
      });
    }

    if (el._planScrollWired) {
      this._syncPlanSticky(el);
      return;
    }
    el._planScrollWired = true;

    const scroller = this._planScrollRoot(el);
    // rAF-throttle: prevents scroll jitter from layout thrash mid-frame
    const onScroll = () => {
      if (el._planScrollRaf) return;
      el._planScrollRaf = requestAnimationFrame(() => {
        el._planScrollRaf = 0;
        this._syncPlanSticky(el);
      });
    };
    const onResize = () => {
      if (el._planScrollRaf) return;
      el._planScrollRaf = requestAnimationFrame(() => {
        el._planScrollRaf = 0;
        this._syncPlanSticky(el);
      });
    };

    if (scroller) {
      scroller.addEventListener('scroll', onScroll, { passive: true });
      el._planScrollEl = scroller;
    } else {
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('resize', onResize, { passive: true });
    el._planOnScroll = onScroll;
    el._planOnResize = onResize;

    requestAnimationFrame(() => this._syncPlanSticky(el));
  }

  _planScrollRoot(el) {
    return document.getElementById('chat-box')
      || el?.closest?.('#chat-box')
      || el?.closest?.('.chat-box')
      || this.container?.closest?.('#chat-box')
      || this.container?.closest?.('.chat-box')
      || null;
  }

  _syncPlanSticky(el) {
    if (!el || !el.isConnected) return;
    const sticky = el.querySelector('.gpt-oc-plan-sticky');
    const sentinel = el.querySelector('.gpt-oc-plan-sentinel');
    if (!sticky || !sentinel) return;

    const scroller = this._planScrollRoot(el);
    const rootRect = scroller
      ? scroller.getBoundingClientRect()
      : { top: 0, left: 0, width: window.innerWidth, bottom: window.innerHeight };

    // Pin under gpt-top-bar
    const topBar = document.querySelector('#chatContainer .gpt-top-bar, .chat-container .gpt-top-bar, .gpt-top-bar');
    const topBarBottom = topBar ? topBar.getBoundingClientRect().bottom : rootRect.top;
    const pinTop = Math.max(rootRect.top, topBarBottom);

    const sRect = sentinel.getBoundingClientRect();

    // Active plan (is-sticky): pin for the WHOLE chat scroll — do NOT unstick at
    // message bottom (that was the "disappears after scrolling a bit" bug).
    // Hysteresis: once stuck, only release when user scrolls back so the plan
    // origin is visible again — kills boundary flicker/jitter.
    const isActivePlan = el.classList.contains('is-sticky');
    const pastTop = sRect.bottom < pinTop + 4;
    const scrolledBackToOrigin = sRect.top >= pinTop - 2;

    let shouldStick = false;
    if (isActivePlan) {
      if (el._planIsStuck) {
        shouldStick = !scrolledBackToOrigin;
      } else {
        shouldStick = pastTop;
      }
    }

    if (shouldStick) {
      const wasStuck = el._planIsStuck;
      el._planIsStuck = true;

      // FIRST stick only: reserve the FULL in-flow plan height so content
      // below does not jump up when we collapse to compact + position:fixed.
      if (!wasStuck) {
        const fullH = sticky.offsetHeight || 48;
        el._planReserveH = fullH;

        if (!el._planPlaceholder) {
          const ph = document.createElement('div');
          ph.className = 'gpt-oc-plan-placeholder';
          el.insertBefore(ph, sticky);
          el._planPlaceholder = ph;
        }
        el._planPlaceholder.style.height = fullH + 'px';

        // Now collapse the floating card to compact (placeholder keeps fullH)
        if (!el.classList.contains('is-expanded')) el.classList.add('is-compact');
        el.classList.add('is-fixed-sticky');

        // Enter transition on the pinned strip
        sticky.classList.remove('gpt-oc-plan-stick-enter-active');
        sticky.classList.add('gpt-oc-plan-stick-enter');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            sticky.classList.add('gpt-oc-plan-stick-enter-active');
          });
        });
      } else {
        if (!el.classList.contains('is-expanded')) el.classList.add('is-compact');
        el.classList.add('is-fixed-sticky');
        // Keep reserved height stable (do not shrink to compact)
        if (el._planPlaceholder && el._planReserveH) {
          el._planPlaceholder.style.height = el._planReserveH + 'px';
        }
      }

      const slot = (el._planPlaceholder || el).getBoundingClientRect();
      const left = slot.left;
      const width = slot.width || rootRect.width;

      sticky.style.position = 'fixed';
      sticky.style.top = Math.max(0, pinTop) + 'px';
      sticky.style.left = left + 'px';
      sticky.style.width = Math.max(0, width) + 'px';
      sticky.style.right = 'auto';
      sticky.style.zIndex = '40';
      sticky.style.boxSizing = 'border-box';
    } else {
      el._planIsStuck = false;
      el._planReserveH = 0;
      el.classList.remove('is-fixed-sticky');
      if (!el.classList.contains('is-expanded')) el.classList.remove('is-compact');
      sticky.classList.remove('gpt-oc-plan-stick-enter', 'gpt-oc-plan-stick-enter-active');
      sticky.style.position = '';
      sticky.style.top = '';
      sticky.style.left = '';
      sticky.style.width = '';
      sticky.style.right = '';
      sticky.style.zIndex = '';
      sticky.style.boxSizing = '';
      if (el._planPlaceholder) {
        el._planPlaceholder.remove();
        el._planPlaceholder = null;
      }
    }
  }


  _upsertText(part) {
    let el = this.map.get(part.id);
    if (!el) {
      el = document.createElement('div');
      el.dataset.partId = part.id;
      el.className = 'gpt-oc-text';
      el.innerHTML = `<div class="part-text"></div>`;
      // Stay inside work body during the turn so "Let me read…" sits above Read
      this.container.appendChild(el);
      this.map.set(part.id, el);
    }
    this._patchText(el, part);
    return el;
  }

  _patchText(el, part) {
    const isStreaming = part.status === PART_STATUS.STREAMING;
    el.classList.toggle('is-streaming', isStreaming);
    const body = el.querySelector('.part-text');
    if (!body) return;
    // One path always: same markdown pipeline during stream, after seal, and
    // on history reload. scheduleUpsert already throttles (~90ms) so this is safe.
    body.innerHTML = this.renderMarkdown(part.text || '');
    // innerHTML wipes previous shells — re-apply gpt-code-view on every paint
    // so live stream matches finalize/history (not only after response ends).
    try { addCopyButton(body); } catch (_) {}
    // Live collapsible headings (same as final history) — not only on stream end
    try {
      if (typeof this.collapseHeadings === 'function') this.collapseHeadings(body);
    } catch (_) {}
  }

  // ---------------------------------------------------------- throttle loop

  _ensureLoop() {
    if (this._raf) return;
    const tick = () => {
      this._raf = null;
      const now = Date.now();
      const ready = [];
      for (const [id, p] of this._pending) {
        const last = this._lastPaint.get(id) || 0;
        if (p.status !== PART_STATUS.STREAMING || now - last >= this._minIntervalMs) ready.push([id, p]);
      }
      for (const [id, p] of ready) {
        this._pending.delete(id);
        this._lastPaint.set(id, now);
        this.upsert(p);
      }
      if (this._pending.size) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
}

/**
 * 🟢 PROBLEM 1 FIX — call this instead of `turn.renderer.upsert(part)` at
 * every call site that uses upsertToolPart/upsertFilePart/upsertPlanPart
 * (which now return { part, sealed }). Without this, the text part that
 * was streaming right before a tool/file/plan part started stays frozen
 * in its raw/plain-text form forever — markdown was never re-applied once
 * MessagePart.sealStreamingText() marked it DONE in the data layer, because
 * nothing told the DOM to repaint it.
 */
export function paintUpsertResult(turn, result) {
  if (!turn || !result) return null;
  if (result.sealed) turn.renderer.upsert(result.sealed);
  const el = turn.renderer.upsert(result.part);
  // Drop orphan DOM rows for the same file path (Writing stuck + Created)
  try {
    const part = result.part;
    if (part && (part.type === 'file' || part.path)) {
      const pathKey = String(part.path || part.label || '')
        .split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() || '';
      const keepId = part.id;
      if (pathKey && turn.renderer?.map) {
        for (const [pid, node] of [...turn.renderer.map.entries()]) {
          if (pid === keepId || !node) continue;
          const meta = (node.getAttribute?.('data-path') ||
            node.querySelector?.('.gpt-oc-row-meta')?.textContent || '')
            .split(/[/\\]/).pop()?.toLowerCase() || '';
          if (meta === pathKey) {
            try { node.remove(); } catch (_) {}
            turn.renderer.map.delete(pid);
            turn.renderer._topEls?.delete?.(pid);
          }
        }
        // Also scan container for leftover stream rows not in map
        const root = turn.renderer.container;
        if (root) {
          root.querySelectorAll('.gpt-oc-file[data-path], .gpt-oc-row-wrap[data-path]').forEach(node => {
            const meta = (node.getAttribute('data-path') || '').split(/[/\\]/).pop()?.toLowerCase() || '';
            const pid = node.getAttribute('data-part-id') || node.dataset?.partId;
            if (meta === pathKey && pid && pid !== keepId) {
              try { node.remove(); } catch (_) {}
              turn.renderer.map.delete(pid);
            }
          });
        }
      }
    }
  } catch (_) {}
  return el;
}