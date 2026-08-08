import { ensureFolderPath } from './bookmarks-api.js';

function buildPrompt(batch, existingFolders) {
  const folderList = existingFolders.slice(0, 80).join('\n') || '(暂无)';
  const items = batch.map((b) => ({
    id: b.id,
    title: b.title || '',
    url: b.url || '',
    currentPath: b.pathLabel || ''
  }));

  return `你是书签整理助手。根据书签标题与 URL，建议应放入的文件夹路径（用 / 分隔，中文即可）。
可以复用下列已有文件夹，也可以新建合理路径：
${folderList}

规则：
1. 只输出 JSON 数组，不要 markdown，不要解释。
2. 每项格式：{"id":"书签id","folderPath":"父/子"}
3. 必须覆盖输入中的每一个 id。
4. folderPath 不要以 / 开头或结尾。

输入：
${JSON.stringify(items)}`;
}

function extractJsonArray(text) {
  if (!text) throw new Error('空响应');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const data = JSON.parse(t);
  if (!Array.isArray(data)) throw new Error('响应不是数组');
  return data;
}

export async function classifyBatchWithAI(batch, settings, existingFolders) {
  const base = (settings.apiBase || '').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: settings.model || 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You output only valid JSON arrays.' },
      { role: 'user', content: buildPrompt(batch, existingFolders) }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const arr = extractJsonArray(content);
  const byId = new Map(batch.map((b) => [b.id, b]));
  const suggestions = [];
  for (const item of arr) {
    if (!item || !item.id || !item.folderPath) continue;
    const b = byId.get(String(item.id));
    if (!b) continue;
    suggestions.push({
      id: b.id,
      title: b.title,
      url: b.url,
      fromPath: b.pathLabel || '',
      folderPath: String(item.folderPath).replace(/^\/+|\/+$/g, '')
    });
  }
  return suggestions;
}

export async function classifyAllWithAI(bookmarks, settings, existingFolders, onProgress) {
  if (!settings.apiKey) throw new Error('请先在设置中填写 API Key');
  const batchSize = Math.max(1, Math.min(50, Number(settings.batchSize) || 20));
  const all = [];
  for (let i = 0; i < bookmarks.length; i += batchSize) {
    const batch = bookmarks.slice(i, i + batchSize);
    let attempt = 0;
    let result;
    while (attempt < 3) {
      try {
        result = await classifyBatchWithAI(batch, settings, existingFolders);
        break;
      } catch (e) {
        attempt += 1;
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    all.push(...result);
    if (onProgress) {
      onProgress({
        done: Math.min(i + batchSize, bookmarks.length),
        total: bookmarks.length
      });
    }
  }
  return all;
}

export async function applyAiMoves(moves, moveFn) {
  const folderCache = new Map();
  let applied = 0;
  for (const m of moves) {
    const segments = m.folderPath.split('/').map((s) => s.trim()).filter(Boolean);
    if (!segments.length) continue;
    const cacheKey = segments.join('/');
    let folderId = folderCache.get(cacheKey);
    if (!folderId) {
      folderId = await ensureFolderPath(segments, '1');
      folderCache.set(cacheKey, folderId);
    }
    await moveFn(m.id, { parentId: folderId });
    applied += 1;
  }
  return applied;
}
