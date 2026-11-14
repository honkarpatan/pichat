// src/main/handler/ContextBuilder.js

import { EditorHelper } from '../utils/editor/EditorHelper.js';
import { AcodeFSAgent } from '../agent/tools/AcodeFSAgent.js';
import { AgentSession } from '../utils/agent/AgentSession.js';
import { getProjectFolder } from '../utils/file/fileOperations.js';

export class ContextBuilder {
  static async build(app, message) {
    let combinedHiddenContext = "";
    const conversationId = app.currentConversationIndex;

    let editor = window.editorManager?.editor;
    const activeFile = window.editorManager?.activeFile;
    const userMsg = String(message || '');
    const userWantsEditorCtx = /\b(active file|current file|current active|opened? tabs?|open (?:tabs?|files?)|editor tabs?)\b/i.test(userMsg);

    let hasAiWorkspace = false;
    try {
      const { ProjectWorkspace } = await import('../utils/ProjectWorkspace.js');
      hasAiWorkspace = ProjectWorkspace.hasAny(conversationId);
    } catch (_) {}

    if (editor && app.isEnableFunctionCatch) {
      const selectedText = EditorHelper.getSelectedText();
      app.thisLanguage = EditorHelper.getLanguage();

      if (selectedText && app.isEnableCatchSelectText) {
        combinedHiddenContext += `[User Selected Code]\nLanguage: ${app.thisLanguage}\nCode:\n${selectedText}\n\n`;
      }

      if ((!hasAiWorkspace || userWantsEditorCtx) && activeFile && activeFile.uri) {
        combinedHiddenContext += `[Active File Info]\n` +
          `Name: ${activeFile.name}\n` +
          `Language: ${app.thisLanguage}\n` +
          `URI: ${activeFile.uri}\n` +
          (app.isEnableAgentMode
            ? `Note: User is viewing this file. Call 'read' with this URI if you need to inspect or edit it.\n\n`
            : `Note: User is viewing this file. Answer in chat; do not claim you will write project files unless Agent mode is on.\n\n`);

        if (app.isEnableAgentMode && !hasAiWorkspace) {
          try {
            const proj = await getProjectFolder({ chatId: conversationId });
            const wd = AgentSession.pathToWorkingDir(activeFile.uri, proj?.name);
            if (wd) {
              AgentSession.save(conversationId, {
                workingDir: wd,
                projectName: proj?.name || '',
                projectUri: proj?.uri || ''
              });
            }
          } catch (_) {}
        }
      }
    }

    if (app.selectedModel?.prompt) {
      combinedHiddenContext += `[System Prompt]\n${app.selectedModel.prompt}\n\n`;
    }

    if (app.isEnableAgentMode) {
      if (message) AgentSession.noteGoalFromMessage(conversationId, message);

      combinedHiddenContext += `[Agent Workflow Reminder]
- Always check [Project File Tree] and [Project Memory (project_memory.md)] below first.
- To modify EXISTING files: call 'read' first, then use 'str_replace' or 'edit_file_lines'. NEVER use 'write' on existing files.
- To create NEW files: use 'write'.
- After adding files/features or fixing structural bugs, call 'update_project_memory' to keep 'project_memory.md' up to date.
- For pure questions/explanations with no file edits, call 'answer_informational_query'.\n\n`;

      try {
        const { ProjectWorkspace } = await import('../utils/ProjectWorkspace.js');
        const wsList = ProjectWorkspace.list(conversationId);
        if (wsList && wsList.length) {
          const primary = wsList[0];
          const rel = AgentSession.contentUrlToRelPath(primary.url);
          const shell = AgentSession.contentUrlToShellPath(primary.url);
          AgentSession.save(conversationId, {
            workingDir: rel || primary.name || '',
            shellPath: shell,
            projectUri: primary.url,
            projectName: primary.name || (rel || '').split('/')[0] || ''
          });
        }
        combinedHiddenContext += ProjectWorkspace.contextBlock(conversationId) + '\n\n';
      } catch (_) {}

      combinedHiddenContext += AgentSession.toPromptBlock(conversationId) + '\n\n';
      combinedHiddenContext += `${await AcodeFSAgent.getProjectContextBlock({
        chatId: conversationId,
        skipAcodeProject: hasAiWorkspace,
        includeActiveFile: !hasAiWorkspace || userWantsEditorCtx,
        includeOpenTabs: !hasAiWorkspace || userWantsEditorCtx
      })}\n`;
    }

    if (app.isEnableStudyMode) {
      combinedHiddenContext += `[Study Guide Mode Active]
You are an Ultra-Premium Educational AI Tutor. Follow this STRICT format for your response:
1. RULE FOR IMAGES: IF the user is asking about a NEW topic, you MUST call the 'fetch_educational_images' tool FIRST. IF it is a follow-up question, DO NOT fetch images and skip the gallery.
2. IF images were fetched, embed them inside this EXACT HTML format (DO NOT use Markdown for images):
<span class="study-gallery">
  <img src="URL_1" alt="Image 1" class="study-gallery" onerror="this.style.display='none'" >
  <img src="URL_2" alt="Image 2" class="study-gallery" onerror="this.style.display='none'" >
</span>
3. Start with "💡 Concept at a Glance" (1-2 lines simple summary).
4. Provide a detailed explanation using emojis and bullet points.
5. IF APPLICABLE : Include a Markdown Table.
6. IF APPLICABLE : Include a "🌍 Real-life Analogy".
7. Include a "🧠 Fun Fact".
8. End with "📝 Quick Quiz" containing 1 or 2 short self-test questions.\n\n`;
    }

    if (combinedHiddenContext.trim() !== "") {
      app.web_results = (app.web_results ? app.web_results + "\n\n" : "") + combinedHiddenContext.trim();
    }
  }
}