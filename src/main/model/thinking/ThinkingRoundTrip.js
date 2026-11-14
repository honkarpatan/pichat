/**
 * Claude extended thinking: preserve thinking / redacted_thinking blocks
 * for multi-turn and tool loops (must be echoed unchanged).
 */

const THINK_TYPES = new Set(['thinking', 'redacted_thinking']);

export function isThinkingBlock(part) {
  return !!(part && THINK_TYPES.has(part.type));
}

/**
 * Clone Anthropic thinking blocks for API echo (no mutation of signature/data).
 */
export function cloneThinkingBlock(part) {
  if (!part || !THINK_TYPES.has(part.type)) return null;
  if (part.type === 'redacted_thinking') {
    return { type: 'redacted_thinking', data: String(part.data || '') };
  }
  const out = {
    type: 'thinking',
    thinking: String(part.thinking != null ? part.thinking : '')
  };
  if (part.signature != null && part.signature !== '') {
    out.signature = String(part.signature);
  }
  return out;
}

/**
 * From assistant rawParts / content array, keep thinking blocks as-is for next request.
 * Also maps our MessagePart thinking → Anthropic shape if needed.
 */
export function extractThinkingBlocksForApi(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!p) continue;
    if (p.type === 'thinking' || p.type === 'redacted_thinking') {
      const c = cloneThinkingBlock(p);
      if (c) out.push(c);
      continue;
    }
    // Our UI MessagePart shape stored on history
    if (p.type === 'thinking_part' || (p.type === 'thinking' && p.text != null && !p.thinking)) {
      const block = {
        type: 'thinking',
        thinking: String(p.thinking != null ? p.thinking : p.text || '')
      };
      if (p.signature) block.signature = String(p.signature);
      out.push(block);
    }
    if (p.redactedData) {
      out.push({ type: 'redacted_thinking', data: String(p.redactedData) });
    }
  }
  return out;
}

/**
 * When model changes or thinking disabled, strip thinking blocks so Claude does not reject.
 */
export function stripThinkingBlocks(content) {
  if (!Array.isArray(content)) return content;
  return content.filter(p => !isThinkingBlock(p));
}

/**
 * Ensure assistant content for tool loop starts with thinking when thinking is enabled.
 * Anthropic requires final assistant turn with thinking mode to start with thinking block.
 */
export function orderAssistantContent(content, { thinkingEnabled } = {}) {
  if (!Array.isArray(content)) return content;
  const thinking = content.filter(isThinkingBlock);
  const rest = content.filter(p => !isThinkingBlock(p));
  if (!thinkingEnabled) return rest;
  return [...thinking, ...rest];
}
