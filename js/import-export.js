import { create, getTree } from './bookmarks-api.js';

export function treeToExportJson(nodes) {
  const mapNode = (n) => {
    if (n.url) {
      return { type: 'bookmark', title: n.title || '', url: n.url, dateAdded: n.dateAdded };
    }
    return {
      type: 'folder',
      title: n.title || '',
      dateAdded: n.dateAdded,
      children: (n.children || []).map(mapNode)
    };
  };
  // export under roots (skip synthetic root 0's wrapper details but keep children)
  const roots = (nodes[0]?.children || nodes).map(mapNode);
  return {
    format: 'bookmark-organizer',
    version: 1,
    exportedAt: new Date().toISOString(),
    roots
  };
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

export function downloadText(text, filename, mime = 'text/html') {
  const blob = new Blob([text], { type: mime });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function bookmarksToNetscapeHtml(nodes) {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ];

  const write = (list, indent) => {
    const pad = '    '.repeat(indent);
    for (const n of list) {
      if (n.url) {
        const add = n.dateAdded ? Math.floor(n.dateAdded / 1000) : 0;
        lines.push(`${pad}<DT><A HREF="${escapeAttr(n.url)}" ADD_DATE="${add}">${escapeHtml(n.title || n.url)}</A>`);
      } else {
        const add = n.dateAdded ? Math.floor(n.dateAdded / 1000) : 0;
        lines.push(`${pad}<DT><H3 ADD_DATE="${add}">${escapeHtml(n.title || 'Folder')}</H3>`);
        lines.push(`${pad}<DL><p>`);
        write(n.children || [], indent + 1);
        lines.push(`${pad}</DL><p>`);
      }
    }
  };

  write(nodes[0]?.children || nodes, 1);
  lines.push('</DL><p>');
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function importNodes(nodes, parentId) {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'bookmark' || n.url) {
      await create({ parentId, title: n.title || n.url || '未命名', url: n.url });
      count += 1;
    } else {
      const folder = await create({ parentId, title: n.title || 'Folder' });
      const children = n.children || [];
      count += await importNodes(children, folder.id);
    }
  }
  return count;
}

export async function importFromJson(data, parentId) {
  let roots = data.roots;
  if (!roots && Array.isArray(data)) roots = data;
  if (!roots) throw new Error('无法识别的 JSON 格式');
  return importNodes(roots, parentId);
}

/** Minimal Netscape Bookmark HTML parser */
export function parseNetscapeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rootDl = doc.querySelector('dl');
  if (!rootDl) throw new Error('未找到书签 HTML 结构 (DL)');

  function parseDl(dl) {
    const items = [];
    let child = dl.firstElementChild;
    while (child) {
      if (child.tagName === 'DT') {
        const h3 = child.querySelector(':scope > h3');
        const a = child.querySelector(':scope > a');
        if (h3) {
          let next = child.nextElementSibling;
          // Some exports put DL inside DT
          let folderDl = child.querySelector(':scope > dl');
          if (!folderDl && next && next.tagName === 'DL') {
            folderDl = next;
            child = next;
          }
          items.push({
            type: 'folder',
            title: h3.textContent || 'Folder',
            children: folderDl ? parseDl(folderDl) : []
          });
        } else if (a) {
          items.push({
            type: 'bookmark',
            title: a.textContent || a.getAttribute('href') || '',
            url: a.getAttribute('href') || ''
          });
        }
      }
      child = child.nextElementSibling;
    }
    return items;
  }

  return parseDl(rootDl);
}

export async function importFromHtml(html, parentId) {
  const roots = parseNetscapeHtml(html);
  return importNodes(roots, parentId);
}

export async function exportCurrentTree() {
  return getTree();
}
