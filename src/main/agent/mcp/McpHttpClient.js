/**
 * Minimal MCP-over-HTTP client (no stdio — Termux/WebView safe).
 * Config: .aicodex/mcp.json or settings mcpServersJson
 */
import {
  getProjectFolder, readFile, normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';
import { ConfigManager } from '../../utils/ConfigManager.js';

const TAG = '[MCP]';
const REL = '.aicodex/mcp.json';

export async function loadMcpConfig() {
  try {
    const raw = ConfigManager.get('mcpServersJson');
    if (raw && String(raw).trim().startsWith('{')) {
      return JSON.parse(String(raw));
    }
  } catch (_) {}
  try {
    const project = await getProjectFolder();
    if (!project?.uri) return { servers: [] };
    const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
    if (r?.success && r.content) return JSON.parse(r.content);
  } catch (e) {
    console.warn(TAG, 'load config', e);
  }
  return { servers: [] };
}

async function rpc(server, method, params = {}) {
  const url = String(server.url || '').trim();
  if (!url) throw new Error('MCP server missing url');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(server.headers || {})
  };
  const body = { jsonrpc: '2.0', id: Date.now(), method, params };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

export async function listMcpServers() {
  const cfg = await loadMcpConfig();
  return (cfg.servers || []).map(s => ({
    name: s.name || s.id || 'server',
    url: s.url,
    hasHeaders: !!(s.headers && Object.keys(s.headers).length)
  }));
}

export async function listMcpTools(serverName) {
  const cfg = await loadMcpConfig();
  const server = (cfg.servers || []).find(s => String(s.name || s.id) === String(serverName));
  if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
  const result = await rpc(server, 'tools/list', {});
  return result?.tools || result || [];
}

export async function callMcpTool(serverName, toolName, args = {}) {
  const cfg = await loadMcpConfig();
  const server = (cfg.servers || []).find(s => String(s.name || s.id) === String(serverName));
  if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
  return rpc(server, 'tools/call', { name: toolName, arguments: args });
}

export class McpAgent {
  static getToolsSchema() {
    return [
      {
        name: 'mcp_list_servers',
        description: 'List configured MCP HTTP servers (.aicodex/mcp.json or settings).',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'mcp_list_tools',
        description: 'List tools on an MCP HTTP server.',
        parameters: {
          type: 'OBJECT',
          properties: { server: { type: 'STRING' } },
          required: ['server']
        }
      },
      {
        name: 'mcp_call_tool',
        description: 'Call MCP tool via JSON-RPC tools/call.',
        parameters: {
          type: 'OBJECT',
          properties: {
            server: { type: 'STRING' },
            tool: { type: 'STRING' },
            arguments: { type: 'OBJECT' }
          },
          required: ['server', 'tool']
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    const name = functionCall?.name;
    const args = functionCall?.args || {};
    try {
      if (name === 'mcp_list_servers') {
        const servers = await listMcpServers();
        return {
          success: true,
          servers,
          message: servers.length ? undefined : 'No MCP servers. Add .aicodex/mcp.json'
        };
      }
      if (name === 'mcp_list_tools') {
        return { success: true, server: args.server, tools: await listMcpTools(args.server) };
      }
      if (name === 'mcp_call_tool') {
        const result = await callMcpTool(args.server, args.tool, args.arguments || args.args || {});
        return { success: true, result };
      }
      return { error: `Unknown: ${name}` };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }
}
