/**
 * ask_user_question — pause agent until user answers (Official/Pi ask pattern).
 * Schema is core; execution is handled via LiveChatUI.askUserQuestions + ToolRegistry.
 */

export const ASK_USER_TOOL = 'ask_user_question';

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

export class AskUserAgent {
  static getToolsSchema() {
    return [
      {
        name: ASK_USER_TOOL,
        description:
          'Ask the user a structured choice instead of guessing. Use 1-4 questions with 2-4 options each (label + short description). Users can pick options, type a custom answer, or skip. Do not invent an "Other" option. Put "(Recommended)" in the first option label when you have a preference. Use multiSelect when several answers can apply. Group every clarifying question into ONE call.',
        parameters: {
          type: 'OBJECT',
          properties: {
            questions: {
              type: 'ARRAY',
              description: '1-4 clarifying questions',
              items: {
                type: 'OBJECT',
                properties: {
                  id: { type: 'STRING', description: 'Optional stable id' },
                  question: { type: 'STRING', description: 'Full question text' },
                  header: { type: 'STRING', description: 'Short chip label (max ~16 chars)' },
                  options: {
                    type: 'ARRAY',
                    description: '2-4 options',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        label: { type: 'STRING', description: '1-5 words' },
                        description: { type: 'STRING', description: 'What this choice means' }
                      },
                      required: ['label']
                    }
                  },
                  multiSelect: { type: 'BOOLEAN', description: 'Allow multiple options' }
                },
                required: ['question', 'options']
              }
            }
          },
          required: ['questions']
        }
      }
    ];
  }

  /** Normalize/validate; returns { ok, questions, error } */
  static parseQuestions(raw) {
    if (!Array.isArray(raw) || !raw.length) {
      return { ok: false, error: 'questions must be a non-empty array' };
    }
    const questions = [];
    for (let i = 0; i < Math.min(raw.length, MAX_QUESTIONS); i++) {
      const q = raw[i] || {};
      const question = String(q.question || q.prompt || '').trim();
      if (!question) continue;
      let options = Array.isArray(q.options) ? q.options : [];
      options = options
        .slice(0, MAX_OPTIONS)
        .map((o, j) => ({
          id: String(o?.id || `opt_${i}_${j}`),
          label: String(o?.label || o?.text || `Option ${j + 1}`).trim().slice(0, 80),
          description: String(o?.description || '').trim().slice(0, 200)
        }))
        .filter(o => o.label);
      if (options.length < MIN_OPTIONS) {
        // Allow 1 option + free text still useful
        if (!options.length) {
          options = [
            { id: `opt_${i}_0`, label: 'Yes', description: '' },
            { id: `opt_${i}_1`, label: 'No', description: '' }
          ];
        }
      }
      questions.push({
        id: String(q.id || `q_${i}`),
        question,
        header: String(q.header || '').trim().slice(0, 24),
        multiSelect: !!q.multiSelect,
        options
      });
    }
    if (!questions.length) return { ok: false, error: 'No valid questions' };
    return { ok: true, questions };
  }

  static async executeTool(functionCall) {
    // Real UI is in LiveChatUI; ToolRegistry routes ask with app
    return {
      error: 'ask_user_question must be executed through the agent UI gate',
      cancelled: true
    };
  }
}
