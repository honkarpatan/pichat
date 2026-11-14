// src/main/core/agent/AcodeControlAgent.js
//
// 🟢 Reliability fix: gives the model an explicit, structured way to end an agent
// turn instead of relying on it to voluntarily emit the bare string "TASK_COMPLETED"
// in prose (fragile — easy for a model to forget, or to say the phrase mid-explanation
// without meaning it as the sentinel).
//
// Paired with forced tool_choice in Agent Mode (Gemini: function_calling_config
// mode "ANY", Claude: tool_choice {type:"any"}), this closes the main "lazy mode"
// failure case: the model is not ALLOWED to return plain text instead of acting —
// it must call some tool every turn, and "I'm done" is itself a tool call now,
// not a hope that the model remembers the magic word.
export class AcodeControlAgent {

    static getToolsSchema() {
        return [
            {
                name: "finish_task",
                description: "Call ONLY when the user request is FULLY done. For create game/app/files: you MUST have written real file CONTENT (not only create_folder). Folder-only = NOT done — keep writing. Pure Q&A with no file work may finish with summary only. System rejects premature finish_task.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        summary: { type: "STRING", description: "Your reply to the user: either a short 1-3 sentence summary of what you did, or a direct answer if no action was needed." }
                    },
                    required: ["summary"]
                }
            }
        ];
    }

    static async executeTool(functionCall) {
        if (functionCall?.name === 'finish_task') {
            return { success: true, finished: true, summary: functionCall.args?.summary || '' };
        }
        return { error: `Unknown tool: ${functionCall?.name}` };
    }
}