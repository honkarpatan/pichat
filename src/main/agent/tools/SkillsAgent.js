import { loadSkill } from '../../context/SkillsLoader.js';

export class SkillsAgent {
  static getToolsSchema() {
    return [
      {
        name: 'load_skill',
        description:
          'Load a project skill (SKILL.md) by name. Skills live under .aicodex/skills/<name>/, .agents/skills/<name>/, or skills/<name>/.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Skill folder name' }
          },
          required: ['name']
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    if (functionCall?.name !== 'load_skill') {
      return { error: 'Unknown tool: ' + (functionCall?.name || '') };
    }
    const result = await loadSkill(functionCall?.args?.name);
    if (!result.success) return result;
    return {
      success: true,
      name: result.name,
      path: result.path,
      message: 'Loaded skill "' + result.name + '" from ' + result.path + '. Follow these instructions.',
      content: result.content,
      truncated: !!result.truncated
    };
  }
}
