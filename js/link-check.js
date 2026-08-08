async function checkOne(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store'
      });
    } catch {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store'
      });
    }

    // Some servers reject HEAD
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store'
      });
    }

    const finalUrl = res.url || url;
    const redirected = normalizeForCompare(finalUrl) !== normalizeForCompare(url);
    if (res.ok) {
      return {
        status: redirected ? 'redirect' : 'ok',
        code: res.status,
        finalUrl
      };
    }
    return { status: 'fail', code: res.status, finalUrl, reason: `HTTP ${res.status}` };
  } catch (e) {
    const reason = e.name === 'AbortError' ? '超时' : (e.message || '网络错误');
    return { status: 'fail', code: 0, finalUrl: url, reason };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeForCompare(u) {
  try {
    const x = new URL(u);
    let path = x.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${x.protocol}//${x.host.toLowerCase()}${path}`;
  } catch {
    return u;
  }
}

export async function checkLinks(bookmarks, { concurrency = 8, timeoutMs = 8000, onProgress } = {}) {
  const results = [];
  let index = 0;
  let done = 0;
  const total = bookmarks.length;

  async function worker() {
    while (index < bookmarks.length) {
      const i = index++;
      const b = bookmarks[i];
      const check = await checkOne(b.url, timeoutMs);
      results[i] = {
        id: b.id,
        title: b.title,
        url: b.url,
        pathLabel: b.pathLabel || '',
        ...check
      };
      done += 1;
      if (onProgress) onProgress({ done, total });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, () => worker());
  await Promise.all(workers);
  return results;
}
