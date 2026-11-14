/**
 * CM6 / Acode editor integration for FIM ghost completions.
 * Uses editorManager.editor (CodeMirror 6 EditorView) — no extra CM6 install.
 */
import { loadFimSettings, getActiveFimModelType, isFimEnabled } from './FimSettings.js';
import { supportsFim } from './FimConfig.js';
import { FimService } from './FimService.js';
import { ConfigManager } from '../utils/ConfigManager.js';
import { showFimGhost, clearFimGhost } from './FimGhost.js';

const TAG = '[FimController]';

function getView() {
  return typeof editorManager !== 'undefined' ? editorManager.editor : null;
}

function getPrefixSuffix(view, settings) {
  const state = view.state;
  const head = state.selection.main.head;
  const doc = state.doc;
  const full = doc.toString();
  const preN = Math.min(Number(settings.prefixChars) || 2048, head);
  const sufN = Math.min(Number(settings.suffixChars) || 512, full.length - head);
  const prefix = full.slice(head - preN, head);
  const suffix = full.slice(head, head + sufN);
  return { prefix, suffix, head };
}

function parseWakeKeys(str) {
  return String(str || 'Ctrl-.')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function eventMatchesCombo(e, combo) {
  const parts = combo.toLowerCase().split('-');
  const key = parts[parts.length - 1];
  const needCtrl = parts.includes('ctrl') || parts.includes('control');
  const needAlt = parts.includes('alt');
  const needShift = parts.includes('shift');
  const needMeta = parts.includes('meta') || parts.includes('cmd');
  if (!!e.ctrlKey !== needCtrl) return false;
  if (!!e.altKey !== needAlt) return false;
  if (!!e.shiftKey !== needShift) return false;
  if (!!e.metaKey !== needMeta) return false;
  const k = (e.key || '').toLowerCase();
  if (key === 'space') return k === ' ' || k === 'spacebar' || e.code === 'Space';
  if (key === '/') return k === '/';
  return k === key;
}

export const FimController = {
  _bound: false,
  _timer: null,
  _abort: null,
  _pending: null, // { text, from }
  _app: null,

  init(app) {
    this._app = app;
    if (this._bound) return;
    this._bound = true;

    document.addEventListener('keydown', this._onKeyDown, true);
    // Typing debounce via CM6 updateListener if available, else input
    this._attachViewListeners();
    if (typeof editorManager?.on === 'function') {
      editorManager.on('switch-file', () => {
        this.dismiss();
        this._attachViewListeners();
      });
    }
    console.log(TAG, 'initialized');
  },

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown, true);
    this.dismiss();
    this._bound = false;
  },

  _currentModelType() {
    // Exclusive FIM: use whichever model currently has FIM enabled
    try {
      const active = getActiveFimModelType();
      if (active && isFimEnabled(active)) return active;
    } catch (_) {}
    const t = this._app?.selectedModel?.type;
    if (t) return String(t).toLowerCase();
    try {
      return String(
        ConfigManager.get('lastSelectedModelType') ||
          ConfigManager.get('lastSelectedModel') ||
          ''
      ).toLowerCase();
    } catch (_) {
      return '';
    }
  },

  _attachViewListeners() {
    const view = getView();
    if (!view?.dom) return;
    if (view.dom._gptFimInput) return;
    view.dom._gptFimInput = true;
    view.dom.addEventListener('input', () => this._onEditorInput(), true);
  },

  _onEditorInput() {
    const modelType = this._currentModelType();
    if (!modelType || !supportsFim(modelType)) return;
    const settings = loadFimSettings(modelType);
    if (!settings.enabled || !settings.autoTrigger) return;
    if (!settings.alwaysOn && !settings.autoTrigger) return;

    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.trigger({ reason: 'debounce' }), Number(settings.debounceMs) || 450);
  },

  _onKeyDown: (e) => {
    FimController._handleKey(e);
  },

  _handleKey(e) {
    const modelType = this._currentModelType();
    if (!modelType) return;
    const settings = loadFimSettings(modelType);
    if (!settings.enabled || !supportsFim(modelType)) return;

    // Accept
    if (this._pending && (e.key === 'Tab' || eventMatchesCombo(e, settings.acceptKey || 'Tab'))) {
      if (this._pending) {
        e.preventDefault();
        e.stopPropagation();
        this.accept();
        return;
      }
    }
    // Dismiss
    if (this._pending && (e.key === 'Escape' || eventMatchesCombo(e, settings.dismissKey || 'Escape'))) {
      e.preventDefault();
      this.dismiss();
      return;
    }

    const wakes = parseWakeKeys(settings.wakeKeys);
    for (const combo of wakes) {
      if (eventMatchesCombo(e, combo)) {
        e.preventDefault();
        e.stopPropagation();
        this.trigger({ reason: 'wake', force: true });
        return;
      }
    }

    // Any other key clears ghost if not accepting
    if (this._pending && e.key.length === 1) {
      this.dismiss();
    }
  },

  async trigger({ reason = 'manual', force = false } = {}) {
    const view = getView();
    if (!view?.state) return;

    const modelType = this._currentModelType();
    if (!modelType || !supportsFim(modelType)) {
      if (force) window.toast?.('FIM not supported for this model');
      return;
    }
    const settings = loadFimSettings(modelType);
    if (!settings.enabled) {
      if (force) window.toast?.('Enable FIM in model settings → FIM tab');
      return;
    }

    const { prefix, suffix, head } = getPrefixSuffix(view, settings);
    if ((prefix || '').length < (Number(settings.minPrefixChars) || 0) && !force) return;

    if (this._abort) {
      try {
        this._abort.abort();
      } catch (_) {}
    }
    this._abort = new AbortController();
    this.dismiss();

    try {
      console.log(TAG, 'request', reason, 'prefixLen=', prefix.length, 'suffixLen=', suffix.length);
      const text = await FimService.complete({
        modelType,
        prefix,
        suffix,
        signal: this._abort.signal
      });
      const cleaned = String(text || '').replace(/\0/g, '');
      if (!cleaned) return;
      const finalText = settings.multiline === false ? cleaned.split('\n')[0] : cleaned;
      this._pending = { text: finalText, from: head };
      if (settings.showGhost !== false) this._showGhost(view, head, finalText);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn(TAG, err);
      if (force) window.toast?.(err.message || 'FIM failed');
    }
  },

  accept() {
    const view = getView();
    const pending = this._pending;
    this.dismiss();
    if (!view || !pending?.text) return;
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: head, to: head, insert: pending.text },
      selection: { anchor: head + pending.text.length }
    });
    view.focus();
  },

  dismiss() {
    this._pending = null;
    try {
      clearFimGhost(getView());
    } catch (_) {}
  },

  _showGhost(view, head, text) {
    try {
      showFimGhost(view, head, text);
    } catch (e) {
      console.warn(TAG, 'ghost failed', e);
    }
  }
};