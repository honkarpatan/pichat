// src/main/core/agent/AcodePlanAgent.js
//
// Claude Code-এর TodoWrite tool-এর মতোই কাজ করে: প্রতিবার FULL updated list
// পাঠাতে হয় (diff না), status বদলালেও পুরো array আবার পাঠাবে।
export class AcodePlanAgent {
  static getToolsSchema() {
    return [{
      name: 'todo_write',
      description: "Write or update your step-by-step plan for the CURRENT task. Call FIRST for any non-trivial multi-file/multi-step task, listing every concrete step. Call AGAIN every time a step's status changes — always resend the FULL list with updated statuses. Keep each item to a few words. Skip entirely for trivial single-step requests.",
      parameters: {
        type: "OBJECT",
        properties: {
          items: {
            type: "ARRAY",
            description: "Full current plan, in order. Example: [{\"text\":\"Read chess.js\",\"status\":\"done\"},{\"text\":\"Add ai.js\",\"status\":\"in_progress\"},{\"text\":\"Wire into game.js\",\"status\":\"pending\"}]",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING", description: "Short step description" },
                status: { type: "STRING", description: "'pending' | 'in_progress' | 'done'" }
              },
              required: ["text", "status"]
            }
          }
        },
        required: ["items"]
      }
    }];
  }

  static async executeTool(functionCall) {
    if (functionCall?.name === 'todo_write') {
      const items = Array.isArray(functionCall.args?.items) ? functionCall.args.items : [];
      return { success: true, items };
    }
    return { error: `Unknown tool: ${functionCall?.name}` };
  }
}