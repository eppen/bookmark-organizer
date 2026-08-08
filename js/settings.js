const DEFAULTS = {
  apiBase: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  batchSize: 20,
  linkConcurrency: 8,
  linkTimeoutMs: 8000,
  rules: [
    { matchType: 'domain', pattern: 'github.com', folderPath: '开发/GitHub' },
    { matchType: 'domain', pattern: 'stackoverflow.com', folderPath: '开发/问答' },
    { matchType: 'domain', pattern: 'youtube.com', folderPath: '媒体/YouTube' },
    { matchType: 'domain', pattern: 'bilibili.com', folderPath: '媒体/Bilibili' },
    { matchType: 'domain', pattern: 'zhihu.com', folderPath: '阅读/知乎' },
    { matchType: 'keyword', pattern: '文档', folderPath: '文档' },
    { matchType: 'keyword', pattern: 'tutorial', folderPath: '学习/教程' }
  ]
};

const KEY = 'bookmarkOrganizerSettings';

export function getDefaults() {
  return structuredClone(DEFAULTS);
}

export async function loadSettings() {
  const data = await chrome.storage.local.get(KEY);
  const saved = data[KEY] || {};
  return {
    ...structuredClone(DEFAULTS),
    ...saved,
    rules: Array.isArray(saved.rules) ? saved.rules : structuredClone(DEFAULTS.rules)
  };
}

export async function saveSettings(partial) {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 3) + '••••' + key.slice(-4);
}
