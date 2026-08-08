const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_cid', 'utm_reader', 'utm_name', 'utm_social', 'utm_social-type',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'ref_src', 'spm', 'from'
]);

export function normalizeUrl(raw) {
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }

  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);

  const protocol = url.protocol === 'http:' || url.protocol === 'https:' ? 'https:' : url.protocol;

  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  let path = url.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const search = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';

  return `${protocol}//${host}${path}${search}`;
}

/** Group bookmark nodes by normalized URL; only groups with size > 1 */
export function findDuplicateGroups(bookmarks) {
  const map = new Map();
  for (const b of bookmarks) {
    if (!b.url) continue;
    const key = normalizeUrl(b.url);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  const groups = [];
  for (const [key, items] of map) {
    if (items.length < 2) continue;
    items.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
    groups.push({ key, items, keepId: items[0].id });
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  return groups;
}
