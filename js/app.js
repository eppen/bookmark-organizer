import * as BM from './bookmarks-api.js';
import { TreeView } from './tree-view.js';
import { computeSearchVisibility } from './search.js';
import { findDuplicateGroups } from './dedupe.js';
import { previewRuleClassification, applyClassification } from './classify-rules.js';
import { classifyAllWithAI, applyAiMoves } from './classify-ai.js';
import { checkLinks } from './link-check.js';
import {
  treeToExportJson,
  downloadJson,
  bookmarksToNetscapeHtml,
  downloadText,
  importFromJson,
  importFromHtml,
  exportCurrentTree
} from './import-export.js';
import { loadSettings, saveSettings, maskKey, getDefaults } from './settings.js';
import { toast } from './ui/toast.js';
import { promptModal, confirmModal } from './ui/modal.js';

const state = {
  tree: [],
  flat: { bookmarks: [], folders: [] },
  settings: null,
  selectedFolderId: '1'
};

const treeEl = document.getElementById('tree');
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');
const contextMenu = document.getElementById('contextMenu');

const treeView = new TreeView(treeEl, {
  onSelect: (node) => {
    if (BM.isFolder(node)) state.selectedFolderId = node.id;
  },
  onRename: (node) => renameNode(node),
  onMove: async (id, dest) => {
    try {
      await BM.move(id, dest);
      toast('已移动');
      await refreshTree();
    } catch (e) {
      toast(e.message || '移动失败', 'error');
    }
  },
  onContextMenu: (node, x, y) => showContextMenu(node, x, y)
});

async function refreshTree() {
  const tree = await BM.getTree();
  state.tree = tree;
  state.flat = BM.walkTree(tree);
  treeView.setTree(tree);
  const q = searchInput.value;
  if (q.trim()) applySearch(q);
}

function applySearch(q) {
  const roots = state.tree[0]?.children || state.tree;
  const result = computeSearchVisibility(
    state.tree[0] ? [state.tree[0]] : state.tree,
    q
  );
  // Also ensure root children visibility works when searching from root '0'
  if (!result.active) {
    treeView.setSearch({ active: false, matchIds: new Set(), visibleIds: new Set() });
    searchCount.textContent = '';
    return;
  }
  treeView.setSearch(result);
  searchCount.textContent = `${result.count} 项匹配`;
  void roots;
}

/* ---------------- Context menu ---------------- */

function hideContextMenu() {
  contextMenu.classList.add('hidden');
  contextMenu.replaceChildren();
}

function showContextMenu(node, x, y) {
  hideContextMenu();
  const items = [];
  const folder = BM.isFolder(node);

  if (folder) {
    items.push({ label: '新建文件夹', action: () => createFolder(node.id) });
    items.push({ label: '新建书签', action: () => createBookmark(node.id) });
    items.push({ label: '在此检测失效链接', action: () => {
      showPanel('linkcheck');
      runLinkCheck(node.id);
    }});
  }
  if (!BM.isSystemRoot(node.id)) {
    items.push({ label: '重命名', action: () => renameNode(node) });
    items.push({ label: '删除', danger: true, action: () => deleteNode(node) });
  }
  if (node.url) {
    items.push({ label: '在新标签打开', action: () => chrome.tabs.create({ url: node.url }) });
  }

  for (const it of items) {
    if (it.hr) {
      contextMenu.appendChild(document.createElement('hr'));
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = it.label;
    if (it.danger) btn.classList.add('danger');
    btn.onclick = () => {
      hideContextMenu();
      it.action();
    };
    contextMenu.appendChild(btn);
  }

  contextMenu.classList.remove('hidden');
  const pad = 8;
  const rect = contextMenu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

async function createFolder(parentId) {
  const name = await promptModal({ title: '新建文件夹', message: '文件夹名称', defaultValue: '新建文件夹' });
  if (name == null || !name.trim()) return;
  try {
    const created = await BM.create({ parentId, title: name.trim() });
    treeView.expand(parentId);
    await refreshTree();
    treeView.select(created.id);
    toast('文件夹已创建');
  } catch (e) {
    toast(e.message || '创建失败', 'error');
  }
}

async function createBookmark(parentId) {
  const title = await promptModal({ title: '新建书签', message: '标题', defaultValue: '新书签' });
  if (title == null) return;
  const url = await promptModal({ title: '新建书签', message: 'URL', defaultValue: 'https://' });
  if (url == null || !url.trim()) return;
  try {
    const created = await BM.create({ parentId, title: title.trim() || url.trim(), url: url.trim() });
    treeView.expand(parentId);
    await refreshTree();
    treeView.select(created.id);
    toast('书签已创建');
  } catch (e) {
    toast(e.message || '创建失败', 'error');
  }
}

async function renameNode(node) {
  if (BM.isSystemRoot(node.id)) return;
  const name = await promptModal({
    title: '重命名',
    message: BM.isFolder(node) ? '文件夹名称' : '书签标题',
    defaultValue: node.title || ''
  });
  if (name == null) return;
  try {
    await BM.update(node.id, { title: name.trim() });
    await refreshTree();
    treeView.select(node.id);
    toast('已重命名');
  } catch (e) {
    toast(e.message || '重命名失败', 'error');
  }
}

async function deleteNode(node) {
  if (BM.isSystemRoot(node.id)) return;
  const ok = await confirmModal({
    title: '确认删除',
    message: BM.isFolder(node)
      ? `删除文件夹「${node.title}」及其全部内容？此操作不可撤销。`
      : `删除书签「${node.title}」？`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;
  try {
    if (BM.isFolder(node)) await BM.removeTree(node.id);
    else await BM.remove(node.id);
    await refreshTree();
    toast('已删除');
  } catch (e) {
    toast(e.message || '删除失败', 'error');
  }
}

/* ---------------- Panels ---------------- */

function showPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.actions button').forEach((b) => b.classList.remove('active-tab'));
  const panel = document.getElementById(`panel-${name}`) || document.getElementById('panel-home');
  panel.classList.add('active');
  const btn = document.querySelector(`.actions button[data-panel="${name}"]`);
  if (btn) btn.classList.add('active-tab');

  if (name === 'dedupe') renderDedupePanel();
  else if (name === 'rules') renderRulesPanel();
  else if (name === 'ai') renderAiPanel();
  else if (name === 'linkcheck') renderLinkCheckPanel();
  else if (name === 'importexport') renderImportExportPanel();
  else if (name === 'settings') renderSettingsPanel();
}

function progressBar() {
  const wrap = document.createElement('div');
  wrap.className = 'progress';
  wrap.innerHTML = '<i></i>';
  wrap.set = (done, total) => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    wrap.querySelector('i').style.width = `${pct}%`;
  };
  return wrap;
}

/* ---- Dedupe ---- */

function renderDedupePanel() {
  const el = document.getElementById('panel-dedupe');
  const groups = findDuplicateGroups(state.flat.bookmarks);
  el.innerHTML = `
    <h2>查重合并</h2>
    <p class="muted">按规范化 URL 聚类（去跟踪参数、统一协议与尾斜杠）。默认保留最早创建的一条。</p>
    <div class="stat-row"><span>共 ${groups.length} 组重复</span><span>${groups.reduce((s, g) => s + g.items.length - 1, 0)} 条可删除</span></div>
    <div class="panel-toolbar">
      <button type="button" class="primary" id="dedupeApply" ${groups.length ? '' : 'disabled'}>确认合并删除</button>
      <button type="button" id="dedupeRefresh">重新扫描</button>
    </div>
    <div class="result-list" id="dedupeList"></div>`;

  const list = el.querySelector('#dedupeList');
  if (!groups.length) {
    list.innerHTML = '<div class="empty">未发现重复书签</div>';
  } else {
    groups.forEach((g, gi) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.key = g.key;
      card.innerHTML = `<h3>${g.items.length} 条 · ${escapeHtml(g.key)}</h3>`;
      for (const item of g.items) {
        const row = document.createElement('div');
        row.className = 'card-row';
        row.innerHTML = `
          <label>
            <input type="radio" name="keep-g${gi}" value="${item.id}" ${item.id === g.keepId ? 'checked' : ''} />
            <span>
              <div>${escapeHtml(item.title || '(无标题)')}</div>
              <div class="card-meta">${escapeHtml(item.url)} · ${escapeHtml(item.pathLabel || '根')}</div>
            </span>
          </label>`;
        card.appendChild(row);
      }
      list.appendChild(card);
    });
  }

  el.querySelector('#dedupeRefresh').onclick = () => renderDedupePanel();
  el.querySelector('#dedupeApply').onclick = async () => {
    const toDelete = [];
    list.querySelectorAll('.card').forEach((card) => {
      const keep = card.querySelector('input[type=radio]:checked')?.value;
      card.querySelectorAll('input[type=radio]').forEach((r) => {
        if (r.value !== keep) toDelete.push(r.value);
      });
    });
    if (!toDelete.length) {
      toast('没有可删除的项');
      return;
    }
    const ok = await confirmModal({
      title: '确认合并',
      message: `将删除 ${toDelete.length} 条重复书签，保留各组勾选项。`,
      confirmText: '删除重复',
      danger: true
    });
    if (!ok) return;
    let n = 0;
    for (const id of toDelete) {
      try {
        await BM.remove(id);
        n += 1;
      } catch {
        /* ignore single failures */
      }
    }
    toast(`已删除 ${n} 条`);
    await refreshTree();
    renderDedupePanel();
  };
}

/* ---- Rules ---- */

function renderRulesPanel() {
  const el = document.getElementById('panel-rules');
  el.innerHTML = `
    <h2>规则分类</h2>
    <p class="muted">按域名或关键词匹配，预览后移动到目标文件夹（路径相对于书签栏）。</p>
    <div class="panel-toolbar">
      <button type="button" class="primary" id="rulesPreview">预览匹配</button>
      <button type="button" id="rulesApply" disabled>确认移动</button>
      <button type="button" id="rulesEdit">编辑规则…</button>
    </div>
    <div id="rulesResult"></div>`;

  let pending = [];

  el.querySelector('#rulesEdit').onclick = () => showPanel('settings');
  el.querySelector('#rulesPreview').onclick = () => {
    pending = previewRuleClassification(state.flat.bookmarks, state.settings.rules || []);
    const box = el.querySelector('#rulesResult');
    if (!pending.length) {
      box.innerHTML = '<div class="empty">没有匹配到可分类的书签</div>';
      el.querySelector('#rulesApply').disabled = true;
      return;
    }
    box.innerHTML = `
      <div class="stat-row"><span>${pending.length} 条将移动</span></div>
      <table class="table"><thead><tr><th></th><th>书签</th><th>匹配</th><th>目标</th></tr></thead><tbody></tbody></table>`;
    const tbody = box.querySelector('tbody');
    for (const m of pending) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" checked data-id="${m.id}" /></td>
        <td><div>${escapeHtml(m.title || '')}</div><div class="card-meta">${escapeHtml(m.url)}</div></td>
        <td>${escapeHtml(m.matchType)}: ${escapeHtml(m.pattern)}</td>
        <td>${escapeHtml(m.folderPath)}</td>`;
      tbody.appendChild(tr);
    }
    el.querySelector('#rulesApply').disabled = false;
  };

  el.querySelector('#rulesApply').onclick = async () => {
    const checked = new Set(
      [...el.querySelectorAll('#rulesResult input[type=checkbox]:checked')].map((c) => c.dataset.id)
    );
    const moves = pending.filter((m) => checked.has(m.id));
    if (!moves.length) return;
    const ok = await confirmModal({
      title: '确认分类',
      message: `将移动 ${moves.length} 条书签到对应文件夹。`,
      confirmText: '移动'
    });
    if (!ok) return;
    const n = await applyClassification(moves, BM.move);
    toast(`已移动 ${n} 条`);
    await refreshTree();
    el.querySelector('#rulesPreview').click();
  };
}

/* ---- AI ---- */

function renderAiPanel() {
  const el = document.getElementById('panel-ai');
  const hasKey = Boolean(state.settings?.apiKey);
  el.innerHTML = `
    <h2>AI 智能分类</h2>
    <p class="muted">使用 OpenAI 兼容 API 批量建议文件夹路径，确认后再写入。请先在设置中配置 API。</p>
    <div class="stat-row">
      <span>API: ${hasKey ? escapeHtml(maskKey(state.settings.apiKey)) : '未配置'}</span>
      <span>模型: ${escapeHtml(state.settings?.model || '-')}</span>
      <span>待分类书签: ${state.flat.bookmarks.length}</span>
    </div>
    <div class="panel-toolbar">
      <label>范围
        <select id="aiScope">
          <option value="bar">书签栏及其子项</option>
          <option value="selected">当前选中文件夹</option>
          <option value="all">全部书签</option>
        </select>
      </label>
      <button type="button" class="primary" id="aiRun" ${hasKey ? '' : 'disabled'}>开始分析</button>
      <button type="button" id="aiApply" disabled>确认移动</button>
      <button type="button" id="aiSettings">设置</button>
    </div>
    <div id="aiProgress"></div>
    <div id="aiResult"></div>`;

  let pending = [];
  el.querySelector('#aiSettings').onclick = () => showPanel('settings');

  el.querySelector('#aiRun').onclick = async () => {
    const scope = el.querySelector('#aiScope').value;
    let bookmarks = state.flat.bookmarks;
    if (scope === 'bar') {
      bookmarks = collectBookmarksUnder('1');
    } else if (scope === 'selected') {
      const id = treeView.getSelected()?.id || state.selectedFolderId || '1';
      bookmarks = collectBookmarksUnder(BM.isFolder(treeView.getNode(id) || {}) ? id : '1');
    }

    if (!bookmarks.length) {
      toast('没有可分析的书签');
      return;
    }

    const prog = progressBar();
    const progBox = el.querySelector('#aiProgress');
    progBox.replaceChildren(prog);
    el.querySelector('#aiRun').disabled = true;
    el.querySelector('#aiApply').disabled = true;

    try {
      const folders = state.flat.folders.map((f) => f.pathLabel).filter(Boolean);
      pending = await classifyAllWithAI(bookmarks, state.settings, folders, ({ done, total }) => {
        prog.set(done, total);
      });
      renderAiResult(el.querySelector('#aiResult'), pending);
      el.querySelector('#aiApply').disabled = !pending.length;
      toast(`得到 ${pending.length} 条建议`);
    } catch (e) {
      toast(e.message || 'AI 分类失败', 'error');
      el.querySelector('#aiResult').innerHTML = `<div class="empty">${escapeHtml(e.message || '失败')}</div>`;
    } finally {
      el.querySelector('#aiRun').disabled = false;
    }
  };

  el.querySelector('#aiApply').onclick = async () => {
    const checked = new Set(
      [...el.querySelectorAll('#aiResult input[type=checkbox]:checked')].map((c) => c.dataset.id)
    );
    const moves = pending.filter((m) => checked.has(m.id));
    if (!moves.length) return;
    const ok = await confirmModal({
      title: '确认 AI 分类',
      message: `将按建议移动 ${moves.length} 条书签。`,
      confirmText: '移动'
    });
    if (!ok) return;
    const n = await applyAiMoves(moves, BM.move);
    toast(`已移动 ${n} 条`);
    await refreshTree();
    showPanel('ai');
  };
}

function renderAiResult(box, pending) {
  if (!pending.length) {
    box.innerHTML = '<div class="empty">无建议</div>';
    return;
  }
  box.innerHTML = `
    <div class="stat-row"><span>${pending.length} 条建议</span></div>
    <table class="table"><thead><tr><th></th><th>书签</th><th>当前位置</th><th>建议路径</th></tr></thead><tbody></tbody></table>`;
  const tbody = box.querySelector('tbody');
  for (const m of pending) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" checked data-id="${m.id}" /></td>
      <td><div>${escapeHtml(m.title || '')}</div><div class="card-meta">${escapeHtml(m.url || '')}</div></td>
      <td class="card-meta">${escapeHtml(m.fromPath || '')}</td>
      <td>${escapeHtml(m.folderPath)}</td>`;
    tbody.appendChild(tr);
  }
}

function collectBookmarksUnder(folderId) {
  const node = treeView.getNode(folderId);
  if (!node) return [];
  return BM.flattenBookmarks([node]).map((b) => {
    const found = state.flat.bookmarks.find((x) => x.id === b.id);
    return found || b;
  });
}

/* ---- Link check ---- */

function renderLinkCheckPanel(preselectFolderId) {
  const el = document.getElementById('panel-linkcheck');
  el.innerHTML = `
    <h2>失效链接检测</h2>
    <p class="muted">并发请求检测书签可达性。部分站点可能拦截自动化请求，结果仅供参考。</p>
    <div class="panel-toolbar">
      <label>范围
        <select id="lcScope">
          <option value="selected">当前选中文件夹</option>
          <option value="bar">书签栏</option>
          <option value="all">全部</option>
        </select>
      </label>
      <button type="button" class="primary" id="lcRun">开始检测</button>
      <button type="button" class="danger" id="lcDelete" disabled>删除失败项</button>
    </div>
    <div id="lcProgress"></div>
    <div id="lcResult"></div>`;

  let results = [];

  el.querySelector('#lcRun').onclick = () => {
    const scope = el.querySelector('#lcScope').value;
    let folderId = '1';
    if (scope === 'all') folderId = '0';
    else if (scope === 'selected') {
      folderId = treeView.getSelected()?.id || state.selectedFolderId || '1';
      if (!BM.isFolder(treeView.getNode(folderId) || { url: 'x' })) {
        folderId = state.selectedFolderId || '1';
      }
    }
    if (preselectFolderId) folderId = preselectFolderId;
    runLinkCheck(folderId, el, (r) => { results = r; });
  };

  el.querySelector('#lcDelete').onclick = async () => {
    const ids = [...el.querySelectorAll('#lcResult input[data-fail]:checked')].map((c) => c.dataset.id);
    if (!ids.length) return;
    const ok = await confirmModal({
      title: '删除失败书签',
      message: `将删除 ${ids.length} 条检测失败的书签。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    let n = 0;
    for (const id of ids) {
      try {
        await BM.remove(id);
        n += 1;
      } catch { /* ignore */ }
    }
    toast(`已删除 ${n} 条`);
    await refreshTree();
    showPanel('linkcheck');
  };
}

async function runLinkCheck(folderId, panelEl, onDone) {
  showPanel('linkcheck');
  const el = panelEl || document.getElementById('panel-linkcheck');
  if (!el.querySelector('#lcRun')) renderLinkCheckPanel(folderId);

  const node = treeView.getNode(folderId) || (await BM.getSubTree(folderId))[0];
  const bookmarks = BM.flattenBookmarks([node]);
  const progBox = el.querySelector('#lcProgress');
  const resultBox = el.querySelector('#lcResult');
  const prog = progressBar();
  progBox.replaceChildren(prog);
  resultBox.innerHTML = '';
  el.querySelector('#lcRun').disabled = true;
  el.querySelector('#lcDelete').disabled = true;

  try {
    const results = await checkLinks(bookmarks, {
      concurrency: state.settings.linkConcurrency,
      timeoutMs: state.settings.linkTimeoutMs,
      onProgress: ({ done, total }) => prog.set(done, total)
    });

    const fail = results.filter((r) => r.status === 'fail');
    const uncertain = results.filter((r) => r.status === 'uncertain');
    const redirect = results.filter((r) => r.status === 'redirect');
    const ok = results.filter((r) => r.status === 'ok');

    resultBox.innerHTML = `
      <div class="stat-row">
        <span>正常 ${ok.length}</span>
        <span>重定向 ${redirect.length}</span>
        <span>不确定 ${uncertain.length}</span>
        <span>失败 ${fail.length}</span>
      </div>
      <table class="table">
        <thead><tr><th></th><th>状态</th><th>书签</th><th>详情</th></tr></thead>
        <tbody></tbody>
      </table>`;
    const tbody = resultBox.querySelector('tbody');
    const ordered = [...fail, ...uncertain, ...redirect, ...ok];
    const statusUi = {
      ok: { badge: 'ok', label: '正常' },
      redirect: { badge: 'redirect', label: '重定向' },
      uncertain: { badge: 'uncertain', label: '不确定' },
      fail: { badge: 'fail', label: '失败' }
    };
    for (const r of ordered) {
      const tr = document.createElement('tr');
      const ui = statusUi[r.status] || statusUi.fail;
      tr.innerHTML = `
        <td>${r.status === 'fail' ? `<input type="checkbox" checked data-fail data-id="${r.id}" />` : ''}</td>
        <td><span class="badge ${ui.badge}">${ui.label}</span></td>
        <td><div>${escapeHtml(r.title || '')}</div><div class="card-meta">${escapeHtml(r.url)}</div></td>
        <td class="card-meta">${escapeHtml(r.reason || (r.finalUrl && r.finalUrl !== r.url ? r.finalUrl : `HTTP ${r.code || ''}`))}</td>`;
      tbody.appendChild(tr);
    }
    el.querySelector('#lcDelete').disabled = fail.length === 0;
    if (onDone) onDone(results);
    toast(`检测完成：失败 ${fail.length}，不确定 ${uncertain.length}`);
  } catch (e) {
    toast(e.message || '检测失败', 'error');
  } finally {
    el.querySelector('#lcRun').disabled = false;
  }
}

/* ---- Import / Export ---- */

function renderImportExportPanel() {
  const el = document.getElementById('panel-importexport');
  el.innerHTML = `
    <h2>导入 / 导出</h2>
    <p class="muted">导出当前书签树为 JSON 或 Netscape HTML；导入时合并到选中文件夹（默认书签栏）。</p>
    <div class="panel-toolbar">
      <button type="button" class="primary" id="exportJson">导出 JSON</button>
      <button type="button" id="exportHtml">导出 HTML</button>
    </div>
    <div class="form-grid" style="margin-top:20px">
      <label>导入目标文件夹 ID（可先在左侧选中文件夹）
        <input id="importParent" type="text" />
      </label>
      <label>选择文件（.json / .html）
        <input id="importFile" type="file" accept=".json,.html,.htm,text/html,application/json" />
      </label>
      <div>
        <button type="button" class="primary" id="importBtn">导入</button>
      </div>
    </div>`;

  const parentInput = el.querySelector('#importParent');
  const sel = treeView.getSelected();
  parentInput.value = (sel && BM.isFolder(sel) ? sel.id : state.selectedFolderId) || '1';

  el.querySelector('#exportJson').onclick = async () => {
    const tree = await exportCurrentTree();
    const data = treeToExportJson(tree);
    downloadJson(data, `bookmarks-${dateStamp()}.json`);
    toast('已导出 JSON');
  };

  el.querySelector('#exportHtml').onclick = async () => {
    const tree = await exportCurrentTree();
    const html = bookmarksToNetscapeHtml(tree);
    downloadText(html, `bookmarks-${dateStamp()}.html`);
    toast('已导出 HTML');
  };

  el.querySelector('#importBtn').onclick = async () => {
    const file = el.querySelector('#importFile').files?.[0];
    if (!file) {
      toast('请选择文件', 'error');
      return;
    }
    const parentId = parentInput.value.trim() || '1';
    const text = await file.text();
    try {
      let count;
      if (file.name.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const data = JSON.parse(text);
        count = await importFromJson(data, parentId);
      } else {
        count = await importFromHtml(text, parentId);
      }
      toast(`已导入 ${count} 条书签`);
      await refreshTree();
    } catch (e) {
      toast(e.message || '导入失败', 'error');
    }
  };
}

/* ---- Settings ---- */

function renderSettingsPanel() {
  const el = document.getElementById('panel-settings');
  const s = state.settings;
  el.innerHTML = `
    <h2>设置</h2>
    <div class="form-grid">
      <label>API Base URL
        <input id="setApiBase" type="url" value="${escapeAttr(s.apiBase)}" />
      </label>
      <label>API Key（留空则不修改已保存的 Key）
        <input id="setApiKey" type="password" placeholder="${s.apiKey ? maskKey(s.apiKey) : 'sk-…'}" autocomplete="off" />
      </label>
      <label>模型
        <input id="setModel" type="text" value="${escapeAttr(s.model)}" />
      </label>
      <label>AI 批大小
        <input id="setBatch" type="number" min="1" max="50" value="${Number(s.batchSize) || 20}" />
      </label>
      <label>链接检测并发
        <input id="setConc" type="number" min="1" max="32" value="${Number(s.linkConcurrency) || 8}" />
      </label>
      <label>链接检测超时 (ms)
        <input id="setTimeout" type="number" min="1000" max="60000" value="${Number(s.linkTimeoutMs) || 8000}" />
      </label>
      <label>分类规则（JSON 数组：matchType=domain|keyword, pattern, folderPath）
        <textarea id="setRules">${escapeHtml(JSON.stringify(s.rules || [], null, 2))}</textarea>
      </label>
      <div class="panel-toolbar">
        <button type="button" class="primary" id="saveSettings">保存</button>
        <button type="button" id="resetSettings">恢复默认规则</button>
      </div>
    </div>`;

  el.querySelector('#saveSettings').onclick = async () => {
    let rules;
    try {
      rules = JSON.parse(el.querySelector('#setRules').value);
      if (!Array.isArray(rules)) throw new Error('规则必须是数组');
    } catch (e) {
      toast('规则 JSON 无效: ' + e.message, 'error');
      return;
    }
    const patch = {
      apiBase: el.querySelector('#setApiBase').value.trim(),
      model: el.querySelector('#setModel').value.trim(),
      batchSize: Number(el.querySelector('#setBatch').value) || 20,
      linkConcurrency: Number(el.querySelector('#setConc').value) || 8,
      linkTimeoutMs: Number(el.querySelector('#setTimeout').value) || 8000,
      rules
    };
    const keyVal = el.querySelector('#setApiKey').value.trim();
    if (keyVal) patch.apiKey = keyVal;
    state.settings = await saveSettings(patch);
    toast('设置已保存');
    renderSettingsPanel();
  };

  el.querySelector('#resetSettings').onclick = async () => {
    const d = getDefaults();
    el.querySelector('#setRules').value = JSON.stringify(d.rules, null, 2);
    toast('已填入默认规则，点击保存生效');
  };
}

/* ---------------- Utils ---------------- */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ---------------- Wire up ---------------- */

document.querySelectorAll('.actions button[data-panel]').forEach((btn) => {
  btn.addEventListener('click', () => showPanel(btn.dataset.panel));
});

document.getElementById('btnRefresh').onclick = () => refreshTree().then(() => toast('已刷新'));
document.getElementById('btnNewFolder').onclick = () => {
  const sel = treeView.getSelected();
  const parentId = sel && BM.isFolder(sel) ? sel.id : state.selectedFolderId || '1';
  createFolder(parentId);
};

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearch(searchInput.value), 120);
});

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshTree(), 200);
}
chrome.bookmarks.onCreated.addListener(scheduleRefresh);
chrome.bookmarks.onRemoved.addListener(scheduleRefresh);
chrome.bookmarks.onChanged.addListener(scheduleRefresh);
chrome.bookmarks.onMoved.addListener(scheduleRefresh);

async function init() {
  state.settings = await loadSettings();
  await refreshTree();
  treeView.select('1');
}

init().catch((e) => {
  console.error(e);
  toast(e.message || '初始化失败', 'error');
});
