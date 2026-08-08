import { ensureFolderPath } from './bookmarks-api.js';

function hostOf(url) {
  try {
    let h = new URL(url).hostname.toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h;
  } catch {
    return '';
  }
}

export function matchRule(bookmark, rules) {
  const title = (bookmark.title || '').toLowerCase();
  const url = (bookmark.url || '').toLowerCase();
  const host = hostOf(bookmark.url);

  for (const rule of rules) {
    const pattern = (rule.pattern || '').trim();
    if (!pattern || !rule.folderPath) continue;
    if (rule.matchType === 'domain') {
      const p = pattern.toLowerCase().replace(/^www\./, '');
      if (host === p || host.endsWith('.' + p)) {
        return rule;
      }
    } else if (rule.matchType === 'keyword') {
      const p = pattern.toLowerCase();
      if (title.includes(p) || url.includes(p)) {
        return rule;
      }
    }
  }
  return null;
}

export function previewRuleClassification(bookmarks, rules) {
  const moves = [];
  for (const b of bookmarks) {
    if (!b.url) continue;
    const rule = matchRule(b, rules);
    if (!rule) continue;
    const targetLabel = rule.folderPath.split('/').map((s) => s.trim()).filter(Boolean).join(' / ');
    // Skip when already under the same path relative to 书签栏
    if ((b.pathLabel || '') === targetLabel || (b.pathLabel || '').endsWith('书签栏 / ' + targetLabel)) {
      continue;
    }
    // Common Chrome title for bookmarks bar is localized; compare suffix path
    const pathParts = (b.pathLabel || '').split(' / ').filter(Boolean);
    const targetParts = targetLabel.split(' / ').filter(Boolean);
    if (pathParts.length >= targetParts.length) {
      const suffix = pathParts.slice(-targetParts.length).join(' / ');
      if (suffix === targetLabel) continue;
    }
    moves.push({
      id: b.id,
      title: b.title,
      url: b.url,
      parentId: b.parentId,
      fromPath: b.pathLabel || '',
      folderPath: rule.folderPath,
      matchType: rule.matchType,
      pattern: rule.pattern
    });
  }
  return moves;
}

/** Apply moves: create folders as needed under bookmarks bar, then move */
export async function applyClassification(moves, moveFn) {
  const folderCache = new Map();
  let applied = 0;
  for (const m of moves) {
    const segments = m.folderPath.split('/').map((s) => s.trim()).filter(Boolean);
    const cacheKey = segments.join('/');
    let folderId = folderCache.get(cacheKey);
    if (!folderId) {
      folderId = await ensureFolderPath(segments, '1');
      folderCache.set(cacheKey, folderId);
    }
    if (m.parentId === folderId) continue;
    await moveFn(m.id, { parentId: folderId });
    applied += 1;
  }
  return applied;
}
