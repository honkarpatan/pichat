import { buildRepoMap, formatRepoMapContext } from '../../context/RepoMap.js';

export class RepoMapAgent {
  static getToolsSchema() {
    return [
      {
        name: 'repo_map',
        description:
          'Build or refresh the project file map (.aicodex/repomap.json). Returns a compact tree of project files. Use when you need an overview of the codebase structure.',
        parameters: {
          type: 'OBJECT',
          properties: {
            force: {
              type: 'BOOLEAN',
              description: 'If true, rebuild even if a recent cache exists'
            }
          }
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    if (functionCall?.name !== 'repo_map') {
      return { error: 'Unknown tool: ' + (functionCall?.name || '') };
    }
    const force = !!(functionCall?.args?.force);
    const { map, fromCache, path, error } = await buildRepoMap({ force });
    if (error || !map) return { success: false, error: error || 'Failed to build repomap' };
    return {
      success: true,
      path,
      fromCache,
      fileCount: map.fileCount,
      truncated: map.truncated,
      byExtension: map.byExtension,
      content: formatRepoMapContext(map)
    };
  }
}
