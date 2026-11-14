/**
 * Cap tool results sent back to the model (Pi/Official truncate pattern).
 * Keeps UI payloads intact when callers pass { forModel: true } only on model path.
 */

const DEFAULT_MAX = 12000;
const HARD_MAX = 24000;

export function toolResultMaxChars(app) {
  try {
    const n = parseInt(app?.settingsStore?.get?.('agentToolResultMaxChars', DEFAULT_MAX), 10);
    if (Number.isFinite(n) && n >= 2000) return Math.min(n, HARD_MAX);
  } catch (_) {}
  return DEFAULT_MAX;
}

/**
 * @param {any} result
 * @param {{ maxChars?: number, toolName?: string }} opts
 * @returns {any}
 */
export function truncateToolResultForModel(result, opts = {}) {
  if (result == null) return result;
  const max = opts.maxChars || DEFAULT_MAX;
  if (typeof result === 'string') {
    if (result.length <= max) return result;
    return result.slice(0, max) + `\n…[truncated ${result.length - max} chars — narrow path/query or read a smaller range]`;
  }
  if (typeof result !== 'object') return result;

  try {
    const clone = { ...result };
    // Drop bulky fields never needed by the model
    delete clone.oldContent;
    delete clone.newContent;
    if (clone.content != null && typeof clone.content === 'string' && clone.content.length > max) {
      const keep = Math.max(1500, max - 400);
      clone.content = clone.content.slice(0, keep) +
        `\n…[truncated content ${clone.content.length - keep} chars — use start_line/end_line]`;
      clone.truncated = true;
    }
    if (Array.isArray(clone.matches) && clone.matches.length > 40) {
      clone.matches = clone.matches.slice(0, 40);
      clone.truncated = true;
      clone.message = (clone.message || '') + ` (showing 40/${result.matches.length} matches)`;
    }
    if (Array.isArray(clone.entries) && clone.entries.length > 80) {
      clone.entries = clone.entries.slice(0, 80);
      clone.truncated = true;
    }
    if (typeof clone.stdout === 'string' && clone.stdout.length > 4000) {
      clone.stdout = clone.stdout.slice(0, 4000) + '\n…[truncated stdout]';
      clone.truncated = true;
    }
    if (typeof clone.stderr === 'string' && clone.stderr.length > 2000) {
      clone.stderr = clone.stderr.slice(0, 2000) + '\n…[truncated stderr]';
    }
    // Final JSON size guard
    let json;
    try { json = JSON.stringify(clone); } catch (_) { return clone; }
    if (json.length > max) {
      return {
        success: clone.success,
        error: clone.error,
        truncated: true,
        message: `Tool result too large (${json.length} chars). Narrow the query/path. Preview: ${json.slice(0, Math.min(800, max))}`
      };
    }
    return clone;
  } catch (_) {
    return result;
  }
}
