/**
 * Pi-style system prompt: short, tool-list driven, no workflow scripting.
 * (Written for this plugin; follows the structure Pi uses: role, tool list,
 * a few guidelines, project context, date.)
 */
import { getUserSystemPrompt, resolveBuiltinPrompt } from '../model/SystemPrompt.js';
import { firstSentence } from './PiToolset.js';

const SNIPPETS = {
  read: 'Read a file (use start_line/end_line for large files)',
  list_directory: 'List a directory',
  glob: 'Find files by pattern',
  grep: 'Search file contents',
  write: 'Create a new file or fully rewrite one',
  create_or_update_file: 'Create a new file or fully rewrite one',
  str_replace: 'Edit an existing file by exact search/replace',
  search_replace_edit: 'Edit an existing file by exact search/replace',
  edit_file_lines: 'Replace a line range in an existing file',
  run_command: 'Run a shell command (builds, tests, git)',
  todo_write: 'Keep a short step list for multi-step work (always resend the full list)',
  ask_user_question: 'Ask the user a multiple-choice question instead of guessing'
};

export const PI_PLAN_MODE_NUDGE =
  '[PLAN MODE is ON] Research only: read, list_directory, glob, grep, fetch_content, web_search, todo_write, ask_user_question. ' +
  'Do not edit files or run mutating commands. When you understand the task, reply with a clear step-by-step plan in plain text and stop; ' +
  'the user will approve it before any change is made.';

export function buildPiSystemPrompt({ app, decls, projectText = '', planNudge = '', extra = '' }) {
  const names = new Set(decls.map((d) => d.name));
  const has = (n) => names.has(n);

  const toolLines = decls
    .map((d) => `- ${d.name}: ${SNIPPETS[d.name] || firstSentence(d.description)}`)
    .join('\n');

  const g = [];
  g.push('Look before you change: use read (with line ranges for big files), grep, glob and list_directory. Do not re-read a range you already have.');
  if (has('str_replace') || has('edit_file_lines') || has('search_replace_edit')) {
    g.push('Edit existing files with str_replace (the old text must match exactly) or edit_file_lines (line numbers from your latest read). Make the smallest change that does the job.');
  }
  if (has('write') || has('create_or_update_file')) {
    g.push('Use write only for new files or complete rewrites. Never rewrite a whole file for a small fix.');
  }
  if (has('run_command')) {
    g.push('Use run_command for builds, tests and git; prefer the file tools for reading and editing.');
  }
  if (has('todo_write')) {
    g.push('For work with several steps, keep a short plan with todo_write and update it as steps finish.');
  }
  if (has('ask_user_question')) {
    g.push('If the request is genuinely ambiguous, ask with ask_user_question instead of guessing.');
  }
  g.push('Stay inside the project workspace shown in the context blocks. Show file paths clearly.');
  g.push('Be concise. When the user only asks a question, answer in plain text.');
  g.push('There is no finish tool: when the work is done, reply with a short summary and stop calling tools.');
  g.push('Context blocks inside the user message (file tree, project memory, workflow reminders) are supplied by the app. They may mention tools you do not have (finish_task, answer_informational_query, tool_search): ignore those and only use the tools listed above.');

  const sections = [];
  if (app?._injectSimulatedThinkPrompt) {
    try { sections.push(resolveBuiltinPrompt(app, 'SIMULATED_THINK_INSTRUCTION')); } catch (_) {}
  }
  sections.push(
    'You are an expert coding agent running in Pi mode inside the Acode AI Chat plugin on an Android device. ' +
    'You help the user by reading files, running commands, editing code and writing new files.'
  );
  sections.push(`Available tools:\n${toolLines}`);
  sections.push(`Guidelines:\n${g.map((x) => `- ${x}`).join('\n')}`);

  if (projectText && projectText.trim()) sections.push(`# Project context\n${projectText.trim()}`);
  let userPrompt = '';
  try { userPrompt = getUserSystemPrompt(app); } catch (_) {}
  if (userPrompt) sections.push(`# User instructions\n${userPrompt}`);
  if (extra && extra.trim()) sections.push(extra.trim());
  if (planNudge) sections.push(planNudge);
  sections.push(`Current date: ${new Date().toISOString().slice(0, 10)}`);

  return sections.join('\n\n');
}
