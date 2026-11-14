/**
 * Parse tool calls models dump as plain text when native tool_calls fail:
 *   <function=run_shell_command>
 *   <parameter=command>ls -la /sdcard/Ay/game5/</parameter>
 *   </function>
 *
 * Also:
 *   ```bash command="list_directory"
 *   {"path":"chess/"}
 *   ```
 */

const FUNC_RE = /<function\s*=\s*([a-zA-Z0-9_]+)>([\s\S]*?)<\/function>/gi;
const PARAM_RE = /<parameter\s*=\s*([a-zA-Z0-9_]+)>([\s\S]*?)<\/parameter>/gi;
const BASH_CMD_RE = /```(?:bash|sh|shell)?\s+command\s*=\s*["']([a-zA-Z0-9_]+)["']\s*\n([\s\S]*?)```/gi;

export function parseXmlStyleToolCalls(text) {
  const src = String(text || '');
  if (!src.includes('<function') && !/command\s*=\s*["']/.test(src)) return [];

  const calls = [];
  let m;
  FUNC_RE.lastIndex = 0;
  while ((m = FUNC_RE.exec(src)) !== null) {
    const name = m[1];
    const body = m[2] || '';
    const args = {};
    let pm;
    PARAM_RE.lastIndex = 0;
    while ((pm = PARAM_RE.exec(body)) !== null) {
      const key = pm[1];
      let val = String(pm[2] || '').trim();
      // return_output true/false
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else {
        try {
          if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
            val = JSON.parse(val);
          }
        } catch (_) {}
      }
      args[key] = val;
    }
    calls.push({
      id: `xml-${name}-${calls.length}-${Date.now()}`,
      name,
      args
    });
  }

  BASH_CMD_RE.lastIndex = 0;
  while ((m = BASH_CMD_RE.exec(src)) !== null) {
    const name = m[1];
    let body = String(m[2] || '').trim();
    let args = {};
    try {
      args = JSON.parse(body);
    } catch (_) {
      // key: value lines
      if (name === 'run_shell_command' || name === 'shell') {
        args = { command: body };
      } else {
        args = { path: body };
      }
    }
    // Map alias
    const mapped = name === 'shell' ? 'run_shell_command' : name;
    calls.push({
      id: `fence-${mapped}-${calls.length}-${Date.now()}`,
      name: mapped,
      args
    });
  }

  return calls;
}

/** Remove pseudo tool markup so it doesn't show as chat garbage */
export function stripPseudoToolMarkup(text) {
  let s = String(text || '');
  s = s.replace(FUNC_RE, '');
  s = s.replace(BASH_CMD_RE, '');
  // orphan tags
  s = s.replace(/<\/?function[^>]*>/gi, '');
  s = s.replace(/<\/?parameter[^>]*>/gi, '');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export function hasPseudoToolMarkup(text) {
  const s = String(text || '');
  return /<function\s*=/i.test(s) || /```(?:bash|sh|shell)?\s+command\s*=/i.test(s);
}
