/**
 * Normalize model reasoning streams into thinking vs visible text.
 * Handles:
 *  - <think>…</think>, <thinking>…</thinking>
 *  - BEGIN_REASON … END_REASON (spontaneous or prompted)
 *  - Orphan open tags across chunk boundaries
 *  - Optional explicit reasoning_content feed (no tags)
 */

const OPEN_RE = /(?:<\s*(?:think|thinking)\s*>|\bBEGIN_REASON\b)/i;
const CLOSE_RE = /(?:<\s*\/\s*(?:think|thinking)\s*>|\bEND_REASON\b)/i;

export class ThinkingStreamParser {
  constructor() {
    this.buf = '';
    this.inThink = false;
    this.everThought = false;
    this.closed = false;
  }

  reset() {
    this.buf = '';
    this.inThink = false;
    this.everThought = false;
    this.closed = false;
  }

  /**
   * @returns {{ thinking: string, text: string, closedThinking: boolean }}
   */
  feed(chunk) {
    const out = { thinking: '', text: '', closedThinking: false };
    if (chunk == null || chunk === '') return out;
    this.buf += String(chunk);

    if (this.buf.length > 200000) {
      if (this.inThink) {
        out.thinking += this.buf;
        this.everThought = true;
      } else {
        out.text += this.buf;
      }
      this.buf = '';
      return out;
    }

    while (this.buf.length) {
      if (this.inThink) {
        const m = this.buf.match(CLOSE_RE);
        if (!m) {
          // Hold back enough for END_REASON / </thinking> across chunk edges
          const keep = 24;
          if (this.buf.length > keep + 8) {
            out.thinking += this.buf.slice(0, -keep);
            this.buf = this.buf.slice(-keep);
            this.everThought = true;
          }
          break;
        }
        const idx = m.index;
        out.thinking += this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + m[0].length);
        // Drop trailing newline after close marker
        if (this.buf.startsWith('\n')) this.buf = this.buf.slice(1);
        this.inThink = false;
        this.closed = true;
        out.closedThinking = true;
        this.everThought = true;
        continue;
      }

      const m = this.buf.match(OPEN_RE);
      if (!m) {
        if (this.buf.length > 24) {
          const keep = 16;
          const partial = this.buf.search(/<\s*(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i);
          const partialBr = this.buf.search(/\bBEGIN_REASO?N?$/i);
          let hold = -1;
          if (partial >= 0 && this.buf.length - partial < 20) hold = partial;
          if (partialBr >= 0 && this.buf.length - partialBr < 14) {
            hold = hold < 0 ? partialBr : Math.min(hold, partialBr);
          }
          if (hold >= 0) {
            out.text += this.buf.slice(0, hold);
            this.buf = this.buf.slice(hold);
          } else {
            out.text += this.buf.slice(0, -keep);
            this.buf = this.buf.slice(-keep);
          }
        }
        break;
      }

      const idx = m.index;
      if (idx > 0) out.text += this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + m[0].length);
      if (this.buf.startsWith('\n')) this.buf = this.buf.slice(1);
      this.inThink = true;
      this.everThought = true;
      this.closed = false;
    }

    return out;
  }

  /** API-native reasoning deltas (no tags). */
  feedReasoning(delta) {
    const out = { thinking: '', text: '', closedThinking: false };
    if (delta == null || delta === '') return out;
    this.inThink = true;
    this.everThought = true;
    out.thinking = String(delta);
    return out;
  }

  endReasoning() {
    const out = { thinking: '', text: '', closedThinking: false };
    if (this.buf && this.inThink) {
      out.thinking = this.buf;
      this.buf = '';
    }
    this.inThink = false;
    this.closed = true;
    out.closedThinking = true;
    return out;
  }

  flush() {
    const out = { thinking: '', text: '', closedThinking: false };
    if (!this.buf) return out;
    if (this.inThink) {
      out.thinking = this.buf;
      this.everThought = true;
    } else {
      out.text = this.buf;
    }
    this.buf = '';
    return out;
  }
}
