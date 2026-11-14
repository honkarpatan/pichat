/**
 * M5 — Auto explore subagent trigger.
 * When parent is about to burn explore budget on large/unknown codebases,
 * spawn a read-only subagent once and inject structured report into parent context.
 */

import { runSubAgent } from '../main/SubAgentRunner.js';
import { noteToolEvidence, getFileKnowledge } from '../context/FileKnowledge.js';

const TAG = '[AutoExplore]';

/**
 * @returns {boolean} whether we should auto-spawn explore
 */
export function shouldAutoExplore(app, { phaseState, userText, actionsTaken } = {}) {
  if (!app || app._inSubAgent) return false;
  if (app._autoExploreDone) return false;
  const kind = phaseState?.kind || app._agentTaskIntent?.kind || 'mixed';
  if (kind === 'readonly') return false; // parent can explore freely for Q&A

  // Mutate tasks: after 2 explore-only steps with no mutation, prefer subagent once
  const exploreSteps = phaseState?.exploreSteps || 0;
  if (kind === 'mutate' && exploreSteps >= 2 && !phaseState?.mutated) return true;

  // Explicit large-project language
  const t = String(userText || '');
  if (/\b(entire project|whole (code)?base|all files|explore (the )?project)\b/i.test(t)) {
    return exploreSteps >= 1;
  }
  return false;
}

function buildExploreTask(userText) {
  const goal = String(userText || 'Explore the project').slice(0, 400);
  return (
    `Explore the current project to support this parent task:\n${goal}\n\n` +
    `Return a STRUCTURED report with:\n` +
    `1) Key files and what they do\n` +
    `2) JSON block:\n` +
    `\`\`\`json\n{"anchors":[{"path":"rel/path","start":1,"end":40,"why":"..."}],"notes":["..."],"editTargets":[{"path":"...","what":"..."}]}\n\`\`\`\n` +
    `Prefer grep/outline/list_directory over reading entire large files. Do not edit files.`
  );
}

/**
 * Run explore subagent once; return tool-shaped result for parent messages.
 */
export async function runAutoExplore(app, { userText, onProgress } = {}) {
  if (app._autoExploreDone || app._inSubAgent) {
    return { success: false, skipped: true };
  }
  app._autoExploreDone = true;
  console.log(TAG, 'spawning explore subagent');

  try {
    const result = await runSubAgent({
      app,
      type: 'explore',
      task: buildExploreTask(userText),
      onProgress
    });

    // Feed anchors into FileKnowledge when possible
    try {
      const structured = result.structured || parseStructuredFromReport(result.report);
      if (structured?.anchors) {
        for (const a of structured.anchors) {
          noteToolEvidence(app, 'read', {
            success: true,
            path: a.path,
            pathRelative: a.path,
            range: a.start != null ? `${a.start}-${a.end || a.start}` : undefined,
            totalLines: a.end
          }, { path: a.path, start_line: a.start, end_line: a.end });
        }
      }
    } catch (_) {}

    return {
      success: !!result.success,
      type: 'explore',
      auto: true,
      steps: result.steps,
      report: result.report,
      structured: result.structured || parseStructuredFromReport(result.report),
      message: result.report,
      planHint:
        'Parent: use this report to edit with str_replace/edit_file_lines. Do NOT re-explore the same files.'
    };
  } catch (e) {
    console.warn(TAG, e?.message || e);
    return { success: false, error: e?.message || String(e), auto: true };
  }
}

export function parseStructuredFromReport(report) {
  const text = String(report || '');
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/(\{\s*"anchors"\s*:[\s\S]*\})/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (_) {
    return null;
  }
}

export function formatAutoExploreInjection(result) {
  if (!result) return '';
  const structured = result.structured;
  let extra = '';
  if (structured?.anchors?.length) {
    extra += '\nAnchors:\n' + structured.anchors.slice(0, 20).map(a =>
      `- ${a.path}:${a.start || '?'}-${a.end || '?'} — ${a.why || ''}`
    ).join('\n');
  }
  if (structured?.editTargets?.length) {
    extra += '\nEdit targets:\n' + structured.editTargets.slice(0, 12).map(t =>
      `- ${t.path}: ${t.what || ''}`
    ).join('\n');
  }
  return (
    `[SYSTEM: Auto explore subagent finished. Do NOT repeat the same reads. Apply edits now.]\n` +
    String(result.report || result.message || '').slice(0, 12000) +
    extra
  );
}
