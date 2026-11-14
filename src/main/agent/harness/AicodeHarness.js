/**
 * Aicode Harness — own Pi-level facade (not @earendil-works).
 * Wraps run id, loaded tools, checkpoint, future steering.
 */

import { RunCheckpointStore } from './RunCheckpointStore.js';
import { ToolRegistry } from '../../core/tools/ToolRegistry.js';
import { enqueueSteering, clearSteeringQueue } from './SteeringQueue.js';

function newRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const AicodeHarness = {
  /**
   * Begin an agent run on `app`. Resets deferred tool loads for this run.
   * @returns {{ runId: string }}
   */
  startRun(app, { conversationId } = {}) {
    const conv = conversationId || String(app.currentConversationIndex ?? '');
    // Drop any previous incomplete runs for this chat so banners don't stack
    try {
      RunCheckpointStore.discardAll({ conversationId: conv });
    } catch (_) {}
    const runId = newRunId();
    app._agentRunId = runId;
    app._agentRunStartedAt = Date.now();
    ToolRegistry.resetLoadedTools(app);
    try {
      RunCheckpointStore.save({
        runId,
        conversationId: conv,
        step: 0,
        status: 'running',
        loadedTools: [],
        meta: { model: app.selectedModel?.type || '' }
      });
    } catch (_) {}
    return { runId };
  },

  async checkpoint(app, { step, meta } = {}) {
    const runId = app?._agentRunId;
    if (!runId) return;
    try {
      await RunCheckpointStore.save({
        runId,
        conversationId: String(app.currentConversationIndex ?? ''),
        step: step || 0,
        status: 'running',
        loadedTools: ToolRegistry.getLoadedToolNames(app),
        meta: meta || {}
      });
    } catch (_) {}
  },

  async finishRun(app, status = 'done') {
    try {
      const { runAgentStopHooks } = await import('./AgentHooks.js');
      await runAgentStopHooks(app, status);
    } catch (_) {}

    const runId = app?._agentRunId;
    if (runId) {
      try { await RunCheckpointStore.markDone(runId, status); } catch (_) {}
    }
    app._agentRunId = null;
  },

  async abortRun(app) {
    return this.finishRun(app, 'aborted');
  },

  async listIncomplete(opts) {
    return RunCheckpointStore.listIncomplete(10, opts || {});
  },

  async discard(runId) {
    return RunCheckpointStore.discard(runId);
  },

  async discardAllForChat(conversationId) {
    return RunCheckpointStore.discardAll({ conversationId: String(conversationId ?? '') });
  },

  async purgeAllRunning() {
    return RunCheckpointStore.purgeAllRunning();
  },

  enqueueSteer(app, text) {
    return enqueueSteering(app, text);
  },

  clearSteer(app) {
    return clearSteeringQueue(app);
  }
};
