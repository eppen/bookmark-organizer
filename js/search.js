/**
 * Filter bookmark tree for search. Returns Set of matching node ids
 * and Set of ancestor ids that should stay visible.
 */
export function computeSearchVisibility(rootNodes, query) {
  const q = (query || '').trim().toLowerCase();
  const matchIds = new Set();
  const visibleIds = new Set();

  if (!q) {
    return { matchIds, visibleIds, active: false };
  }

  function walk(node, ancestors) {
    const title = (node.title || '').toLowerCase();
    const url = (node.url || '').toLowerCase();
    const selfMatch = title.includes(q) || url.includes(q);
    let childMatch = false;

    if (node.children) {
      for (const c of node.children) {
        if (walk(c, [...ancestors, node.id])) childMatch = true;
      }
    }

    if (selfMatch) {
      matchIds.add(node.id);
      visibleIds.add(node.id);
      for (const a of ancestors) visibleIds.add(a);
    } else if (childMatch) {
      visibleIds.add(node.id);
      for (const a of ancestors) visibleIds.add(a);
    }

    return selfMatch || childMatch;
  }

  for (const root of rootNodes) {
    walk(root, []);
  }

  return { matchIds, visibleIds, active: true, count: matchIds.size };
}
