/**
 * First-class move / rename / copy tools (deferred — load via tool_search).
 * rename_path = same-directory basename change only.
 * move_path = never treats "readme.txt" as a folder; file-like new_path → rename.
 */
import {
  getProjectFolder, normalizeSafUrl, joinSafPath, renameItem, copyFile, moveItem,
  readFile, createFile, deleteItem
} from '../../utils/file/fileOperations.js';
import { AcodeFSAgent } from './AcodeFSAgent.js';

const TAG = '[PathOps]';

async function resolve(path) {
  if (!path) return null;
  if (typeof AcodeFSAgent._resolveProjectPath === 'function') {
    return AcodeFSAgent._resolveProjectPath(path);
  }
  const project = await getProjectFolder();
  if (!project?.uri) return path;
  const rel = String(path).replace(/^\/+/, '');
  return joinSafPath(normalizeSafUrl(project.uri), rel);
}

/** Basename only — strip directories if model passes a path as new_name */
function basenameOnly(name) {
  let n = String(name || '').trim().replace(/\\/g, '/');
  if (!n) return '';
  n = n.replace(/\/+$/, '');
  const parts = n.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

/** Looks like a file name (has extension or no path separators) */
function looksLikeFileName(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  if (!s || s.endsWith('/')) return false;
  if (s.includes('/')) return false;
  return true; // single segment: file or folder name — prefer rename for extensions
}

function hasFileExtension(name) {
  const base = basenameOnly(name);
  const i = base.lastIndexOf('.');
  return i > 0 && i < base.length - 1;
}

/**
 * Robust same-dir rename: renameTo → copy+delete fallback via FS tools.
 */
async function renameInPlace(srcUrl, newName) {
  const name = basenameOnly(newName);
  if (!name) return { success: false, message: 'new_name is empty' };
  if (name.includes('/') || name.includes('\\')) {
    return { success: false, message: 'new_name must be a basename only (e.g. readme.txt), not a path' };
  }

  // Try native rename
  const res = await renameItem(srcUrl, name);
  if (res?.success) {
    return { success: true, newUrl: res.newUrl || res.url, message: res.message || `Renamed to ${name}` };
  }

  // Fallback: read + write as new name in same parent + delete old
  try {
    const read = await readFile(srcUrl, 'utf-8');
    if (!read?.success || read.content == null) {
      return { success: false, message: res?.message || 'Rename failed (could not read source)' };
    }
    // Parent URI: strip last segment from SAF url carefully
    let parentUrl = srcUrl;
    const slash = Math.max(srcUrl.lastIndexOf('/'), srcUrl.lastIndexOf('%2F'), srcUrl.lastIndexOf('%2f'));
    // Prefer resolving via project + relative parent
    const project = await getProjectFolder();
    if (project?.uri) {
      parentUrl = normalizeSafUrl(project.uri);
      // If source was under a subfolder, try to keep relative parent from path args is better
    }

    // Write new file next to old using createFile on project root with relative name
    // Prefer same directory: use join if we can detect relative path
    const createRes = await createFile(parentUrl, name, String(read.content), { overwrite: true });
    if (!createRes?.success) {
      return { success: false, message: createRes?.message || res?.message || 'Rename failed (write new name)' };
    }
    try { await deleteItem(srcUrl); } catch (_) {}
    return {
      success: true,
      newUrl: createRes.url,
      message: `Renamed to ${name} (copy+delete fallback)`,
      fallback: true
    };
  } catch (e) {
    return { success: false, message: e?.message || res?.message || 'Rename failed' };
  }
}

export class PathOpsAgent {
  static getToolsSchema() {
    const pathNote = "Relative path under project (e.g. 'demo_readme.txt') — prefer simple relative paths, not content:// URLs.";
    return [
      {
        name: 'rename_path',
        description:
          'Rename a file or folder in the SAME directory. REQUIRED when user says rename. ' +
          'path = current relative path (e.g. demo_readme.txt). new_name = NEW BASENAME ONLY (e.g. readme.txt). ' +
          'Do NOT use move_path for a simple rename. Do NOT create a folder with the new name.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: pathNote },
            new_name: { type: 'STRING', description: 'New basename only, e.g. readme.txt — NO folders, NO slashes' }
          },
          required: ['path', 'new_name']
        }
      },
      {
        name: 'move_path',
        description:
          'Move a file into another FOLDER. new_path must be a directory path (e.g. src/ or backup/). ' +
          'If you only need a new filename in the same folder, use rename_path instead. ' +
          'Never pass a bare filename like readme.txt as new_path — that is rename_path.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Source relative path' },
            new_path: {
              type: 'STRING',
              description: 'Destination FOLDER path (e.g. "subdir" or "src/"). Not a filename alone.'
            }
          },
          required: ['path', 'new_path']
        }
      },
      {
        name: 'copy_path',
        description: 'Copy a file to a new path. new_path can be a folder or a full relative file path.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Source file path' },
            new_path: { type: 'STRING', description: 'Destination folder or file relative path' }
          },
          required: ['path', 'new_path']
        }
      }
    ];
  }

  static async executeTool(functionCall) {
    const name = functionCall?.name;
    const args = functionCall?.args || {};
    try {
      if (name === 'rename_path') {
        const srcPath = String(args.path || '').trim();
        let newName = basenameOnly(args.new_name);
        // Model sometimes puts full path in new_name
        if (!newName && args.new_name) newName = basenameOnly(args.new_name);

        if (!srcPath) return { success: false, error: 'Missing path' };
        if (!newName) return { success: false, error: 'Missing new_name (basename only, e.g. readme.txt)' };

        const url = await resolve(srcPath);
        if (!url) return { success: false, error: `Could not resolve path: ${srcPath}` };

        console.log(TAG, 'rename_path', srcPath, '→', newName, url?.slice?.(-60));
        const res = await renameInPlace(url, newName);
        if (!res?.success) {
          return { success: false, error: res?.message || 'Rename failed' };
        }
        return {
          success: true,
          path: srcPath,
          new_name: newName,
          url: res.newUrl,
          message: res.message || `Renamed to ${newName}`
        };
      }

      if (name === 'move_path') {
        const srcPath = String(args.path || '').trim();
        let destPath = String(args.new_path || '').trim().replace(/\\/g, '/');

        if (!srcPath || !destPath) {
          return { success: false, error: 'path and new_path required' };
        }

        // Bare filename or file-like single segment → rename, do NOT create folder
        if (looksLikeFileName(destPath) || (hasFileExtension(destPath) && !destPath.includes('/'))) {
          console.log(TAG, 'move_path coerced to rename_path', srcPath, '→', destPath);
          return PathOpsAgent.executeTool({
            name: 'rename_path',
            args: { path: srcPath, new_name: basenameOnly(destPath) }
          });
        }

        // path/to/file.txt → move into path/to/ with name file.txt via rename after move to dir
        const destSegs = destPath.replace(/\/+$/, '').split('/').filter(Boolean);
        const destLast = destSegs[destSegs.length - 1] || '';
        const destIsFile = hasFileExtension(destLast);

        if (destIsFile && destSegs.length >= 2) {
          const destDirRel = destSegs.slice(0, -1).join('/');
          const destFileName = destLast;
          const src = await resolve(srcPath);
          const destDir = await resolve(destDirRel);
          if (!src || !destDir) return { success: false, error: 'Could not resolve paths' };

          const moved = await moveItem(src, destDir);
          if (!moved?.success) return { success: false, error: moved?.message || 'Move failed' };

          // If basename should change
          const srcBase = basenameOnly(srcPath);
          if (srcBase !== destFileName && moved.url) {
            const ren = await renameInPlace(moved.url, destFileName);
            if (!ren.success) {
              return {
                success: true,
                path: srcPath,
                new_path: destPath,
                warning: `Moved into ${destDirRel} but rename to ${destFileName} failed: ${ren.message}`,
                url: moved.url
              };
            }
            return {
              success: true,
              path: srcPath,
              new_path: destPath,
              url: ren.newUrl,
              message: `Moved to ${destPath}`
            };
          }
          return {
            success: true,
            path: srcPath,
            new_path: destPath,
            url: moved.url,
            message: 'Moved successfully'
          };
        }

        // Destination is a directory
        const src = await resolve(srcPath);
        const dest = await resolve(destPath);
        if (!src || !dest) return { success: false, error: 'Could not resolve paths' };

        const res = await moveItem(src, dest);
        if (!res?.success) return { success: false, error: res?.message || 'Move failed' };
        return {
          success: true,
          path: srcPath,
          new_path: destPath,
          url: res.url,
          message: 'Moved successfully'
        };
      }

      if (name === 'copy_path') {
        const srcPath = String(args.path || '').trim();
        let destPath = String(args.new_path || '').trim().replace(/\\/g, '/');
        const src = await resolve(srcPath);
        if (!src) return { success: false, error: 'Could not resolve source' };

        // new_path is file name only → copy as new name in project root
        if (looksLikeFileName(destPath)) {
          const project = await getProjectFolder();
          if (!project?.uri) return { success: false, error: 'No project' };
          const res = await copyFile(src, normalizeSafUrl(project.uri), basenameOnly(destPath));
          if (!res?.success) return { success: false, error: res?.message || 'Copy failed' };
          return { success: true, path: srcPath, new_path: destPath, message: res.message || 'Copied' };
        }

        const destSegs = destPath.replace(/\/+$/, '').split('/').filter(Boolean);
        const destLast = destSegs[destSegs.length - 1] || '';
        if (hasFileExtension(destLast) && destSegs.length >= 1) {
          const destDirRel = destSegs.length > 1 ? destSegs.slice(0, -1).join('/') : '.';
          const destDir = destDirRel === '.'
            ? normalizeSafUrl((await getProjectFolder())?.uri)
            : await resolve(destDirRel);
          const res = await copyFile(src, destDir, destLast);
          if (!res?.success) return { success: false, error: res?.message || 'Copy failed' };
          return { success: true, path: srcPath, new_path: destPath, message: res.message || 'Copied' };
        }

        const dest = await resolve(destPath);
        if (!dest) return { success: false, error: 'Could not resolve destination' };
        const base = basenameOnly(srcPath) || 'copy';
        const res = await copyFile(src, dest, base);
        if (!res?.success) return { success: false, error: res?.message || 'Copy failed' };
        return { success: true, path: srcPath, new_path: destPath, message: res.message || 'Copied' };
      }

      return { error: `Unknown path tool: ${name}` };
    } catch (e) {
      console.error(TAG, e);
      return { success: false, error: e?.message || String(e) };
    }
  }
}
