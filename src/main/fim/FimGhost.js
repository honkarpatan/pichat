/**
 * True inline "ghost text" for CodeMirror 6.
 *
 * Unlike a position:fixed DOM popup (which floats above the editor and
 * doesn't participate in the text layout), this renders the suggestion as
 * a real Decoration.widget INSIDE the document's text flow — the same
 * mechanism GitHub Copilot / editor.inlineSuggest-style plugins use.
 *
 * - First line of the suggestion  -> inline widget right after the cursor,
 *   on the same visual line (so it reads like "the rest of what you're typing").
 * - Remaining lines (multiline)   -> block widgets stacked right below,
 *   so they occupy their own line without touching the real document.
 *
 * The view passed in is Acode's existing editorManager.editor instance —
 * we don't control its initial `extensions` array, so the field is added
 * lazily via StateEffect.appendConfig the first time it's needed.
 */
// Acode re-exports the exact CM6 module instances the editor itself uses.
// Bundling our own copy of @codemirror/view / @codemirror/state would create
// a second, incompatible set of classes (Decoration/StateField identity
// mismatch), so we pull them from Acode's registry at runtime instead.
const cm = acode.require('codemirror');
const { EditorView, Decoration, WidgetType } = cm.view;
const { StateField, StateEffect } = cm.state;

class FimGhostInlineWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-fim-ghost-inline';
    span.textContent = this.text;
    span.style.cssText = 'opacity:0.5;font-style:italic;pointer-events:none;white-space:pre;';
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

class FimGhostLineWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return other.text === this.text;
  }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'cm-fim-ghost-line';
    // zero-width space keeps empty lines from collapsing to 0 height
    div.textContent = this.text.length ? this.text : '\u200b';
    div.style.cssText = 'opacity:0.5;font-style:italic;pointer-events:none;white-space:pre;';
    return div;
  }
  ignoreEvent() {
    return true;
  }
}

function buildGhostDecorations(pos, text) {
  const lines = String(text).split('\n');
  const decos = [Decoration.widget({ widget: new FimGhostInlineWidget(lines[0]), side: 1 }).range(pos)];
  for (let i = 1; i < lines.length; i++) {
    decos.push(Decoration.widget({ widget: new FimGhostLineWidget(lines[i]), block: true, side: 1 }).range(pos));
  }
  return Decoration.set(decos, true);
}

export const setFimGhost = StateEffect.define();

export const fimGhostField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFimGhost)) {
        return e.value ? buildGhostDecorations(e.value.pos, e.value.text) : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f)
});

function ensureInstalled(view) {
  if (view.state.field(fimGhostField, false) !== undefined) return;
  view.dispatch({ effects: StateEffect.appendConfig.of([fimGhostField]) });
}

export function showFimGhost(view, pos, text) {
  if (!view) return;
  ensureInstalled(view);
  view.dispatch({ effects: setFimGhost.of({ pos, text }) });
}

export function clearFimGhost(view) {
  if (!view || view.state.field(fimGhostField, false) === undefined) return;
  view.dispatch({ effects: setFimGhost.of(null) });
}