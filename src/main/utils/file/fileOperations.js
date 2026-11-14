// src/main/utils/file/fileOperations.js
const fs = acode.require('fs');

function isAcodeAppDataPath(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return false;
  const s = urlOrPath.toLowerCase();
  return (
    s.includes('com.foxdebug.acode') ||
    s.includes('android%2fdata%2fcom.foxdebug') ||
    s.includes('android/data/com.foxdebug') ||
    /\/data\/(data|user)\/.*foxdebug/i.test(s)
  );
}

export function normalizeSafUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('content://') || !trimmed.includes('::')) return trimmed;

  const splitIdx = trimmed.indexOf('::');
  const treePart = trimmed.slice(0, splitIdx);
  let docPath = trimmed.slice(splitIdx + 2);

  const treeMatch = treePart.match(/\/tree\/([^/?#]+)$/);
  if (!treeMatch) return trimmed;

  let treeDocId;
  try {
    treeDocId = decodeURIComponent(treeMatch[1]);
  } catch (_) {
    treeDocId = treeMatch[1];
  }
  if (!treeDocId) return trimmed;

  if (docPath === treeDocId || docPath.startsWith(treeDocId + '/')) {
    return `${treePart}::${docPath}`;
  }

  docPath = docPath.replace(/^\/+/, '');
  const rootName = treeDocId.includes(':')
    ? treeDocId.slice(treeDocId.lastIndexOf(':') + 1)
    : treeDocId;

  if (!docPath || docPath === rootName) {
    return `${treePart}::${treeDocId}`;
  }

  if (docPath.startsWith(rootName + '/')) {
    const rest = docPath.slice(rootName.length + 1);
    return `${treePart}::${treeDocId}/${rest}`;
  }

  // If docPath has its own primary: prefix, strip it and re-anchor under treeDocId
  if (docPath.startsWith('primary:')) {
    const cleanDoc = docPath.replace(/^primary:\/*/i, '');
    if (cleanDoc === rootName) return `${treePart}::${treeDocId}`;
    if (cleanDoc.startsWith(rootName + '/')) {
      return `${treePart}::${treeDocId}/${cleanDoc.slice(rootName.length + 1)}`;
    }
    return `${treePart}::${treeDocId}/${cleanDoc}`;
  }

  return `${treePart}::${treeDocId}/${docPath}`;
}

export function joinSafPath(rootUrl, relativePath) {
  const root = normalizeSafUrl(rootUrl);
  if (!relativePath) return root;
  const rel = String(relativePath).trim().replace(/^\.?\/+/, '').replace(/\\/g, '/');
  if (!rel || rel === '.') return root;
  if (rel.startsWith('content://')) return normalizeSafUrl(rel);

  if (!root || !root.includes('::')) {
    return `${String(rootUrl || '').replace(/\/+$/, '')}/${rel}`;
  }
  const base = root.replace(/\/+$/, '');
  const after = base.split('::')[1] || '';
  const rootName = after.includes(':') ? after.slice(after.lastIndexOf(':') + 1).split('/')[0] : after.split('/')[0];
  if (rootName && (rel === rootName || rel.startsWith(rootName + '/'))) {
    const rest = rel === rootName ? '' : rel.slice(rootName.length + 1);
    return rest ? `${base}/${rest}` : base;
  }
  return `${base}/${rel}`;
}

export async function getProjectFolder(options = {}) {
  try {
    // 1) AI-chat Workspace for THIS specific chat
    try {
      const { ProjectWorkspace } = await import('../ProjectWorkspace.js');
      const { ConfigManager } = await import('../ConfigManager.js');
      let chatId = options.chatId ?? null;
      if (chatId == null) {
        const app = (typeof window !== 'undefined') && (
          window.gptApp || window.__gptApp || window.app || window.AicodeGPT
        );
        if (app?.currentConversationIndex != null && app.currentConversationIndex !== '') {
          chatId = app.currentConversationIndex;
        }
      }
      if (chatId == null) {
        const idx = ConfigManager.get('current_chat_index', null);
        if (idx != null && idx !== '') chatId = idx;
      }
      if (chatId != null) {
        const list = ProjectWorkspace.list(String(chatId));
        if (list.length) {
          const w = list[0];
          return { name: w.name, uri: normalizeSafUrl(w.url), path: w.url };
        }
      }
    } catch (_) {}

    if (options.skipAcodeProject) return null;

    // 2) Fallback: Acode sidebar addedFolder
    const added = (typeof window !== 'undefined' && window.addedFolder) || (typeof addedFolder !== 'undefined' ? addedFolder : null);
    if (Array.isArray(added) && added.length > 0) {
      for (const folder of added) {
        const url = folder?.url || folder?.uri || '';
        if (!url || isAcodeAppDataPath(url)) continue;
        const title = folder.title || folder.name || '';
        const name = title || (url.split(/[/:]/).filter(Boolean).pop() || 'project');
        return { name, uri: normalizeSafUrl(url), path: url };
      }
    }

    // 3) Fallback: Acode fileIndex (v1002+) — fileList is deprecated for SAF/file://
    try {
      const fileIndex = acode.require('fileIndex');
      if (fileIndex?.query) {
        const addedFolder = acode.require('addedfolder') || (typeof window !== 'undefined' && window.addedFolder) || [];
        const roots = (Array.isArray(addedFolder) ? addedFolder : [])
          .map(f => f?.url || f?.uri)
          .filter(url => url && !isAcodeAppDataPath(url) && (!fileIndex.supports || fileIndex.supports(url)));

        if (roots.length) {
          try { await fileIndex.whenReady?.(roots); } catch (_) {}
          const page = await fileIndex.query({ roots, text: '', limit: 30, includeDirectories: false });
          const entries = page?.entries || [];
          for (const file of entries.slice(0, 12)) {
            const url = file.url || file.uri || '';
            const path = file.path || '';
            if (!url || isAcodeAppDataPath(url) || isAcodeAppDataPath(path)) continue;
            const projectName =
              (Array.isArray(addedFolder) && addedFolder.find(f => url.startsWith(f.url || f.uri || ''))?.title)
              || path.split('/').filter(Boolean)[0]
              || (url.split(/[/:]/).filter(Boolean).pop());
            if (!projectName) continue;
            // Prefer the workspace root from addedFolder
            const rootFolder = (Array.isArray(addedFolder) ? addedFolder : []).find(f => {
              const ru = f?.url || f?.uri || '';
              return ru && (url === ru || url.startsWith(ru + '/') || url.startsWith(ru + '%2F'));
            });
            if (rootFolder?.url || rootFolder?.uri) {
              const ru = rootFolder.url || rootFolder.uri;
              return {
                name: rootFolder.title || rootFolder.name || projectName,
                uri: normalizeSafUrl(ru),
                path: ru
              };
            }
            if (url.includes('::')) {
              const parts = url.split('::');
              if (parts.length === 2) {
                const treePart = parts[0];
                const fullPath = parts[1];
                const regex = new RegExp(`(^|[:/])${String(projectName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`);
                const m = regex.exec(fullPath);
                if (m) {
                  const projectPath = fullPath.substring(0, m.index + m[0].length);
                  const projectUri = normalizeSafUrl(treePart + '::' + projectPath);
                  if (!isAcodeAppDataPath(projectUri)) {
                    return { name: projectName, uri: projectUri, path: projectPath };
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[fileOperations] fileIndex fallback failed', e?.message || e);
    }

    // 4) Legacy fileList — only non-native providers (FTP/SFTP) after Acode v1002
    try {
      const fileList = acode.require('fileList');
      if (typeof fileList === 'function') {
        const files = await Promise.resolve(fileList());
        if (files?.length) {
          const filesToCheck = Math.min(8, files.length);
          for (let i = 0; i < filesToCheck; i++) {
            const file = files[i];
            if (!file?.path || !file?.url) continue;
            if (isAcodeAppDataPath(file.url) || isAcodeAppDataPath(file.path)) continue;
            const projectName = file.path.split('/').filter(Boolean)[0];
            if (!projectName) continue;
            const parts = String(file.url).split('::');
            if (parts.length === 2) {
              const treePart = parts[0];
              const fullPath = parts[1];
              const regex = new RegExp(`(^|[:/])${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`);
              const m = regex.exec(fullPath);
              if (m) {
                const projectPath = fullPath.substring(0, m.index + m[0].length);
                const projectUri = normalizeSafUrl(treePart + '::' + projectPath);
                if (!isAcodeAppDataPath(projectUri)) {
                  return { name: projectName, uri: projectUri, path: projectPath };
                }
              }
            }
          }
        }
      }
    } catch (_) {}

    return null;
  } catch (error) {
    console.error('Error getting project folder:', error);
    return null;
  }
}

export async function getAllProjectFolders() {
  try {
    const foldersMap = new Map();
    const added = (typeof window !== 'undefined' && window.addedFolder) || (typeof addedFolder !== 'undefined' ? addedFolder : null);
    if (Array.isArray(added)) {
      for (const folder of added) {
        const url = folder?.url || folder?.uri || '';
        if (!url || isAcodeAppDataPath(url)) continue;
        const name = folder.title || folder.name || url.split(/[/:]/).filter(Boolean).pop() || 'project';
        foldersMap.set(name, { name, uri: normalizeSafUrl(url), path: url });
      }
    }
    if (foldersMap.size > 0) return Array.from(foldersMap.values());

    const main = await getProjectFolder();
    if (main) return [main];
    return [];
  } catch (error) {
    console.error('Error getting all project folders:', error);
    return [];
  }
}

export function removeFolder(uri) {
  try {
    const openFolder = acode.require('openFolder');
    const folder = openFolder.find(uri);
    if (folder) {
      folder.remove();
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

export async function removeAllOpenedFolders() {
  try {
    const folders = await getAllProjectFolders();
    if (folders.length === 0) return { removed: 0, failed: 0, folders: [] };
    let removed = 0, failed = 0;
    const removedFolders = [];
    for (const folder of folders) {
      if (removeFolder(folder.uri)) {
        removed++;
        removedFolders.push(folder);
      } else {
        failed++;
      }
    }
    return { removed, failed, folders: removedFolders };
  } catch (error) {
    return { removed: 0, failed: 0, folders: [] };
  }
}

export async function openProjectFolder(uri, options = {}) {
  try {
    const openFolder = acode.require('openFolder');
    await openFolder(uri, {
      name: options.name || 'Project',
      id: options.id || 'project-' + Date.now(),
      saveState: options.saveState !== undefined ? options.saveState : true,
      reloadOnResume: options.reloadOnResume !== undefined ? options.reloadOnResume : true
    });
    return true;
  } catch (error) {
    return false;
  }
}

export function isFolderOpened(uri) {
  try {
    const openFolder = acode.require('openFolder');
    const folder = openFolder.find(uri);
    return folder !== null && folder !== undefined;
  } catch (error) {
    return false;
  }
}

export async function replaceProjectFolder(uri, options = {}) {
  try {
    const removeResult = await removeAllOpenedFolders();
    await new Promise(resolve => setTimeout(resolve, 200));
    const opened = await openProjectFolder(uri, options);
    return {
      success: !!opened,
      removed: removeResult.removed,
      message: opened ? `Opened new project` : 'Failed to open new folder'
    };
  } catch (error) {
    return { success: false, removed: 0, message: error.message };
  }
}

export async function ensureDirectory(dirUrl) {
  dirUrl = normalizeSafUrl(dirUrl);
  try {
    await fs(dirUrl).lsDir();
    return { success: true, url: dirUrl };
  } catch (e) {
    const lastSlash = dirUrl.lastIndexOf('/');
    const docIdx = dirUrl.indexOf('::');
    if (lastSlash === -1 || lastSlash <= docIdx + 1) {
      return { success: false, message: `Cannot resolve parent root of ${dirUrl}` };
    }
    const parentUrl = dirUrl.substring(0, lastSlash);
    const folderName = dirUrl.substring(lastSlash + 1);
    const parentRes = await ensureDirectory(parentUrl);
    if (!parentRes.success) return parentRes;
    try {
      const newDirUrl = await fs(parentRes.url).createDirectory(folderName);
      return { success: true, url: newDirUrl };
    } catch (err) {
      try {
        await fs(dirUrl).lsDir();
        return { success: true, url: dirUrl };
      } catch (err2) {
        return { success: false, message: `Failed to auto-create folder '${folderName}': ${err.message}` };
      }
    }
  }
}

function _entryName(item) {
  return String(item?.name ?? item ?? '').trim();
}

/** Protected agent dirs must never become "name (1)" */
function _isProtectedDirName(name) {
  const n = String(name || '');
  return n === '.aicodex' || n === '.agents' || /^\.aicodex$/i.test(n);
}

function _findDirByName(siblings, raw) {
  if (!Array.isArray(siblings)) return null;
  let found = siblings.find(item => _entryName(item) === raw);
  if (found) return found;
  const low = raw.toLowerCase();
  found = siblings.find(item => _entryName(item).toLowerCase() === low);
  return found || null;
}

export async function createFolder(url, folderName, options = { overwrite: false }) {
  try {
    url = normalizeSafUrl(url);
    const raw = String(folderName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!raw) return { success: false, url: null, message: 'Empty folder name' };

    if (raw.includes('/')) {
      const parts = raw.split('/').filter(Boolean);
      let parentUrl = url;
      let last = null;
      for (const part of parts) {
        last = await createFolder(parentUrl, part, { overwrite: true });
        if (!last.success || !last.url) return last;
        parentUrl = normalizeSafUrl(last.url);
      }
      return last || { success: false, url: null, message: 'Empty folder path' };
    }

    const ensureRes = await ensureDirectory(url);
    if (!ensureRes.success) return { success: false, url: null, message: ensureRes.message };

    const fsInstance = fs(url);
    let siblings = [];
    try {
      siblings = await fsInstance.lsDir();
    } catch (e) {}

    const existing = _findDirByName(siblings, raw);
    if (existing?.url) {
      // Never unique-rename protected dirs (.aicodex)
      if (options.unique === true && !_isProtectedDirName(raw)) {
        const newName = await getUniqueName(url, raw);
        const dirUrl = await fsInstance.createDirectory(newName);
        return { success: true, url: dirUrl, message: `Folder created as "${newName}"` };
      }
      return { success: true, url: existing.url, message: `Folder "${raw}" already exists` };
    }

    let dirUrl;
    try {
      dirUrl = await fsInstance.createDirectory(raw);
    } catch (err) {
      try {
        siblings = await fsInstance.lsDir();
        const again = _findDirByName(siblings, raw);
        if (again?.url) {
          return { success: true, url: again.url, message: `Folder "${raw}" already exists` };
        }
      } catch (_) {}
      return { success: false, url: null, message: err?.message || String(err) };
    }

    // Platform may auto-create ".aicodex (2)" — prefer exact name if it exists
    let createdName = '';
    try {
      const s = String(dirUrl || '');
      const parts = s.replace(/\\/g, '/').split('/');
      createdName = decodeURIComponent(parts[parts.length - 1] || '');
    } catch (_) {}

    if (createdName && createdName !== raw) {
      console.warn('[createFolder] platform renamed', raw, '->', createdName);
      try {
        siblings = await fsInstance.lsDir();
        const exact = _findDirByName(siblings, raw);
        if (exact?.url) {
          return { success: true, url: exact.url, message: `Folder "${raw}" already exists (reused after rename)` };
        }
      } catch (_) {}
      if (_isProtectedDirName(raw)) {
        console.warn('[createFolder] PROTECTED dir got unique name for', raw, 'url=', dirUrl);
      }
    }

    return { success: true, url: dirUrl, message: `Folder "${raw}" created` };
  } catch (error) {
    return { success: false, url: null, message: error.message };
  }
}

export async function createFile(url, fileName, content = '', options = { overwrite: false }) {
  url = normalizeSafUrl(url);
  try {
    const rawName = String(fileName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (rawName.includes('/')) {
      const parts = rawName.split('/').filter(Boolean);
      if (parts.length >= 2) {
        let parentUrl = url;
        for (let i = 0; i < parts.length - 1; i++) {
          const folderResult = await createFolder(parentUrl, parts[i], { overwrite: true });
          if (!folderResult.success || !folderResult.url) {
            return { success: false, url: null, message: `Failed to create parent folder '${parts[i]}'` };
          }
          parentUrl = normalizeSafUrl(folderResult.url);
        }
        return await createFile(parentUrl, parts[parts.length - 1], content, options);
      }
    }
    const safeName = rawName;
    const ensureRes = await ensureDirectory(url);
    if (!ensureRes.success) {
      return { success: false, url: null, message: `Parent directory invalid: ${ensureRes.message}` };
    }

    let siblings = null;
    try {
      siblings = await fs(url).lsDir();
    } catch (dirErr) {
      return { success: false, url: null, message: `Cannot read parent directory: ${dirErr.message}` };
    }

    let existingItem = null;
    if (Array.isArray(siblings)) {
      existingItem = siblings.find(item => item.name === safeName && item.isFile);
    }

    if (existingItem) {
      if (options.overwrite) {
        await fs(existingItem.url).writeFile(content);
        return { success: true, url: existingItem.url, message: `File "${safeName}" updated` };
      } else {
        const uniqueName = await getUniqueName(url, safeName);
        await fs(url).createFile(uniqueName, content);
        return { success: true, url: `${url}/${uniqueName}`, message: `File created as "${uniqueName}"` };
      }
    }

    await fs(url).createFile(safeName, content);
    return { success: true, url: `${url}/${safeName}`, message: `File "${safeName}" created` };
  } catch (error) {
    return { success: false, url: null, message: error.message };
  }
}

export async function isExists(url, name) {
  try {
    const siblings = await fs(normalizeSafUrl(url)).lsDir();
    const item = siblings.find(entry => entry.name === name);
    if (item) {
      return { exists: true, isFile: item.isFile || false, isDirectory: item.isDirectory || false, url: item.url };
    }
    return { exists: false, isFile: false, isDirectory: false, url: null };
  } catch (error) {
    return { exists: false, isFile: false, isDirectory: false, url: null };
  }
}

export async function readFile(fileUrl, encoding = 'utf-8') {
  const norm = normalizeSafUrl(fileUrl);
  try {
    const content = await fs(norm).readFile(encoding);
    return { success: true, content, message: 'File read successfully' };
  } catch (error) {
    if (norm !== fileUrl) {
      try {
        const content = await fs(fileUrl).readFile(encoding);
        return { success: true, content, message: 'File read successfully' };
      } catch (_) {}
    }
    return { success: false, content: null, message: error.message };
  }
}

export async function writeFile(fileUrl, content) {
  try {
    await fs(normalizeSafUrl(fileUrl)).writeFile(content);
    return { success: true, message: 'File written successfully' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

export async function listDir(dirUrl) {
  const normalized = normalizeSafUrl(dirUrl);
  try {
    const entries = await fs(normalized).lsDir();
    return { success: true, entries, message: `Found ${entries.length} item(s)`, url: normalized };
  } catch (error) {
    if (normalized !== dirUrl) {
      try {
        const entries = await fs(dirUrl).lsDir();
        return { success: true, entries, message: `Found ${entries.length} item(s)`, url: dirUrl };
      } catch (_) {}
    }
    return {
      success: false,
      entries: [],
      message: error.message || 'Cannot read directory',
      hint: 'Check the directory path using list_directory on the project root URI.'
    };
  }
}

function expandPathNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  const root = [];
  const ensureDir = (list, dirName) => {
    let dir = list.find(n => n.type === 'directory' && n.name === dirName);
    if (!dir) {
      dir = { type: 'directory', name: dirName, children: [] };
      list.push(dir);
    }
    if (!dir.children) dir.children = [];
    return dir;
  };
  for (const node of nodes) {
    if (!node || node.name == null) continue;
    const name = String(node.name).replace(/\\/g, '/').replace(/^\/+/, '');
    if (node.type === 'directory') {
      if (name.includes('/')) {
        const parts = name.split('/').filter(Boolean);
        let list = root, dir = null;
        for (const part of parts) {
          dir = ensureDir(list, part);
          list = dir.children;
        }
        if (node.children?.length && dir) dir.children.push(...expandPathNodes(node.children));
      } else {
        const dir = ensureDir(root, name);
        if (node.children?.length) dir.children.push(...expandPathNodes(node.children));
      }
      continue;
    }
    if (name.includes('/')) {
      const parts = name.split('/').filter(Boolean);
      const fileName = parts.pop();
      let list = root;
      for (const part of parts) list = ensureDir(list, part).children;
      list.push({ type: 'file', name: fileName, content: node.content || '' });
    } else {
      root.push({ type: 'file', name, content: node.content || '' });
    }
  }
  return root;
}

export async function createNodes(url, nodes, onProgress = null) {
  url = normalizeSafUrl(url);
  const expanded = expandPathNodes(nodes);
  let created = 0;
  for (const node of expanded) {
    if (node.name == null) continue;
    try {
      if (node.type === 'directory') {
        const folderResult = await createFolder(url, node.name, { overwrite: true });
        if (folderResult.success) {
          created++;
          if (typeof onProgress === 'function') onProgress({ type: 'directory', name: node.name, url: folderResult.url, success: true });
          if (node.children?.length && folderResult.url) {
            const childResult = await createNodes(folderResult.url, node.children, onProgress);
            created += childResult.created;
            if (!childResult.success) return childResult;
          }
        } else {
          return { success: false, error: `Failed to create folder '${node.name}'` };
        }
      } else if (node.type === 'file') {
        const fileResult = await createFile(url, node.name, node.content || '', { overwrite: true });
        if (fileResult.success) {
          created++;
          if (typeof onProgress === 'function') {
            onProgress({ type: 'file', name: node.name, url: fileResult.url, success: true, contentPreview: String(node.content || '').slice(0, 200) });
          }
        } else {
          return { success: false, error: `Failed to create file '${node.name}': ${fileResult.message}` };
        }
      }
    } catch (error) {
      return { success: false, error: `System error on '${node.name}': ${error.message}` };
    }
  }
  return { success: true, created, message: `Created ${created} item(s)` };
}

export async function deleteItem(url) {
  url = normalizeSafUrl(url);
  try {
    await fs(url).delete();
    return { success: true, message: 'Item deleted successfully' };
  } catch (error) {
    // Directory not empty / has children — recursive delete (Linux-style)
    try {
      const listing = await listDir(url);
      const entries = listing?.entries || listing?.files || listing?.list || [];
      if (Array.isArray(entries) && entries.length) {
        for (const ent of entries) {
          const childUrl = ent.url || ent.uri || joinSafPath(url, ent.name || ent.filename || '');
          if (!childUrl) continue;
          const r = await deleteItem(childUrl);
          if (!r.success) {
            return { success: false, message: r.message || `Failed deleting child ${ent.name}` };
          }
        }
        await fs(url).delete();
        return { success: true, message: 'Item deleted recursively' };
      }
    } catch (e2) {
      return { success: false, message: error.message || e2.message };
    }
    return { success: false, message: error.message };
  }
}

export async function renameItem(url, newName) {
  url = normalizeSafUrl(url);
  try {
    const newUrl = await fs(url).renameTo(newName);
    return { success: true, newUrl, message: `Renamed to "${newName}" successfully` };
  } catch (error) {
    try {
      const parentUrl = url.substring(0, url.lastIndexOf('/'));
      const tempDirUrl = window.CACHE_STORAGE || 'file:///storage/emulated/0/Download';
      const sourceFile = await fs(url);
      await sourceFile.copyTo(tempDirUrl, newName);
      const tempFileUrl = `${tempDirUrl}/${newName}`;
      await sourceFile.delete();
      const tempFile = await fs(tempFileUrl);
      const finalUrl = await tempFile.moveTo(parentUrl, newName);
      return { success: true, newUrl: finalUrl || `${parentUrl}/${newName}`, message: `Renamed to "${newName}" successfully` };
    } catch (fallbackError) {
      return { success: false, newUrl: null, message: fallbackError.message || error.message };
    }
  }
}

export async function copyFile(sourceUrl, destUrl, desiredName) {
  try {
    sourceUrl = normalizeSafUrl(sourceUrl);
    destUrl = normalizeSafUrl(destUrl);
    const ensureRes = await ensureDirectory(destUrl);
    if (!ensureRes.success) throw new Error(`Destination directory invalid: ${ensureRes.message}`);
    let fileName = desiredName || sourceUrl.split('/').pop();
    let namePart = fileName, extPart = "";
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      namePart = fileName.substring(0, lastDotIndex);
      extPart = fileName.substring(lastDotIndex);
    }
    let finalName = fileName, counter = 1;
    while ((await isExists(destUrl, finalName)).exists) {
      finalName = `${namePart}_${counter}${extPart}`;
      counter++;
    }
    const sourceEntry = await fs(sourceUrl);
    await sourceEntry.copyTo(destUrl, finalName);
    return { success: true, message: `Saved as ${finalName}` };
  } catch (error) {
    return { success: false, message: error.message || 'Unknown error' };
  }
}

export async function moveItem(sourceUrl, destUrl) {
  try {
    sourceUrl = normalizeSafUrl(sourceUrl);
    destUrl = normalizeSafUrl(destUrl);
    const ensureRes = await ensureDirectory(destUrl);
    if (!ensureRes.success) throw new Error(`Destination directory invalid: ${ensureRes.message}`);
    const movedUrl = await fs(sourceUrl).moveTo(destUrl);
    return { success: true, url: movedUrl, message: 'Item moved successfully' };
  } catch (error) {
    return { success: false, url: null, message: error.message };
  }
}

export async function getUniqueName(url, baseName) {
  try {
    let namePart = baseName, extPart = "";
    const lastDotIndex = baseName.lastIndexOf('.');
    if (lastDotIndex > 0) {
      namePart = baseName.substring(0, lastDotIndex);
      extPart = baseName.substring(lastDotIndex);
    }
    let finalName = baseName, counter = 1;
    while ((await isExists(url, finalName)).exists) {
      finalName = `${namePart} (${counter})${extPart}`;
      counter++;
    }
    return finalName;
  } catch (error) {
    return `${baseName}_${Date.now()}`;
  }
}