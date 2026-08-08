/** Chrome bookmarks API wrappers */

export async function getTree() {
  return chrome.bookmarks.getTree();
}

export async function getSubTree(id) {
  return chrome.bookmarks.getSubTree(id);
}

export async function getChildren(id) {
  return chrome.bookmarks.getChildren(id);
}

export async function create(bookmark) {
  return chrome.bookmarks.create(bookmark);
}

export async function update(id, changes) {
  return chrome.bookmarks.update(id, changes);
}

export async function move(id, destination) {
  return chrome.bookmarks.move(id, destination);
}

export async function remove(id) {
  return chrome.bookmarks.remove(id);
}

export async function removeTree(id) {
  return chrome.bookmarks.removeTree(id);
}

export async function search(query) {
  return chrome.bookmarks.search(query);
}

/** Flatten all bookmark nodes (url items only) under a root node */
export function flattenBookmarks(nodes, acc = []) {
  for (const n of nodes) {
    if (n.url) acc.push(n);
    if (n.children) flattenBookmarks(n.children, acc);
  }
  return acc;
}

/** Flatten folders + bookmarks with path info */
export function walkTree(nodes, path = [], out = { bookmarks: [], folders: [] }) {
  for (const n of nodes) {
    const currentPath = n.id === '0' ? [] : [...path, n.title || '(未命名)'];
    if (n.url) {
      out.bookmarks.push({ ...n, path: currentPath.slice(0, -1), pathLabel: currentPath.slice(0, -1).join(' / ') });
    } else if (n.children) {
      if (n.id !== '0') {
        out.folders.push({ ...n, path: currentPath, pathLabel: currentPath.join(' / ') });
      }
      walkTree(n.children, currentPath, out);
    }
  }
  return out;
}

/**
 * Ensure folder path exists under parentId (default bookmarks bar = '1').
 * pathSegments: string[]
 * Returns leaf folder id.
 */
export async function ensureFolderPath(pathSegments, parentId = '1') {
  let currentParent = parentId;
  for (const raw of pathSegments) {
    const name = (raw || '').trim();
    if (!name) continue;
    const children = await getChildren(currentParent);
    let folder = children.find((c) => !c.url && c.title === name);
    if (!folder) {
      folder = await create({ parentId: currentParent, title: name });
    }
    currentParent = folder.id;
  }
  return currentParent;
}

export function isFolder(node) {
  return node && !node.url;
}

export function isSystemRoot(id) {
  return id === '0' || id === '1' || id === '2' || id === '3';
}
