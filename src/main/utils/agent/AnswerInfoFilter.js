/**
 * answer_informational_query message quality filters.
 * Subagent spam + filler status lines must not pollute UI or end mutate runs early.
 */

const FILLER_RE =
  /^(task\s+)?(successfully\s+)?(finished|completed|complete|done)\b/i;
const FILLER_PHRASE_RE =
  /\b(exploration\s+(task\s+)?(complete|completed|finished|success)|task\s+(finished|completed)\s+successfully|let'?s\s+finish\s+task|i\s+will\s+explore\s+the\s+project)\b/i;

/**
 * Short status / progress lines — not user-facing answers.
 */
export function isFillerInfoMessage(msg) {
  const t = String(msg || '').trim();
  if (!t) return true;
  if (t.length < 28) return true;
  if (FILLER_RE.test(t) && t.length < 100) return true;
  if (FILLER_PHRASE_RE.test(t) && t.length < 160 && !hasReportShape(t)) return true;
  // Pure one-liner status without structure
  if (t.length < 80 && !/[.!?].*[.!?]/s.test(t) && !hasReportShape(t) &&
      /complete|finished|success|done/i.test(t)) {
    return true;
  }
  return false;
}

function hasReportShape(t) {
  return /```|["']anchors["']|editTargets|#{1,3}\s+\w|\*\*[A-Za-z]/.test(t);
}

/**
 * Worth showing as prose (parent) or keeping as subagent report body.
 */
export function isSubstantialInfoMessage(msg) {
  const t = String(msg || '').trim();
  if (!t || isFillerInfoMessage(t)) return false;
  if (t.length >= 100) return true;
  if (hasReportShape(t)) return true;
  // Multi-sentence explanation
  if (t.length >= 60 && /[.!?]\s+[A-Z(]/.test(t)) return true;
  return false;
}

export function extractInfoMessage(fc) {
  if (!fc) return '';
  const a = fc.args || fc.arguments || {};
  return String(a.message || a.response || a.text || a.content || '').trim();
}
