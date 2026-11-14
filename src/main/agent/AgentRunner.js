// src/main/core/handler/AgentRunner.js
//
// Backward-compat shim only. The real implementation now lives in the
// modular agent/main/ folder — AgentLoop.js is the entry point, wired
// together with AgentToolExecution.js, AgentPlanning.js,
// AgentForceWritePass.js, AgentCodegenFallback.js,
// AgentFileTreeSequential.js, AgentFinish.js, AgentDescribe.js.
//
// Anything still importing './AgentRunner.js' (old path) keeps working.
// New code should import directly from './agent/main/AgentLoop.js'.
export { AgentRunner } from './agent/main/AgentLoop.js';