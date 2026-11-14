// src/main/agent/main/AgentCodegenFallback.js
//
// LEGACY NAME kept for import stability.
// OpenCode direction: NO markdown codeblock collection / fence apply.
// This is now a second forced tool-write pass (tools only).

import { forceToolWritePass } from './AgentForceWritePass.js';

const TAG = '[AgentCodegenFallback]';

/**
 * @deprecated Fence-based codegen removed. Delegates to forceToolWritePass.
 */
export async function codegenFallback(app, config, contextMessages, onChunk, actionsTaken, safeLogAction, planState) {
  console.log(TAG, 'OpenCode mode — tool-only write pass (codeblock collect disabled)');
  if (app.chatHandler?.liveUI?.updateAssistantMessage) {
    app.chatHandler.liveUI.updateAssistantMessage(true, 'Writing via tools…', 8000);
  }
  safeLogAction?.({
    id: `tool-write-${Date.now()}`,
    verb: 'Tools',
    target: 'write files (no codeblocks)',
    status: 'done'
  });

  // Reuse force pass; tools list from registry path is on config via caller.
  // When tools not passed, forceToolWritePass expects tools arg — AgentLoop always had tools.
  // Callers that only pass contextMessages: we need tools. AgentLoop always has tools in scope
  // but codegenFallback signature did not include tools — fix callers to pass tools or get from ToolRegistry.

  const { ToolRegistry } = await import('../../core/tools/ToolRegistry.js');
  let tools = null;
  try {
    tools = ToolRegistry.getToolsForAgent?.(app) || ToolRegistry.getTools?.(app) || null;
  } catch (_) {}
  if (!tools && typeof ToolRegistry.list === 'function') {
    try { tools = ToolRegistry.list(); } catch (_) {}
  }

  // workingMessages = contextMessages in new call sites
  return forceToolWritePass(
    app,
    config,
    tools,
    contextMessages,
    contextMessages,
    onChunk,
    actionsTaken,
    safeLogAction,
    planState
  );
}
