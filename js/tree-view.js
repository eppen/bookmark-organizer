import { isFolder, isSystemRoot } from './bookmarks-api.js';

export class TreeView {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.roots = [];
    this.selectedId = null;
    this.expanded = new Set(['0', '1', '2']);
    this.dragId = null;
    this.searchState = { active: false, matchIds: new Set(), visibleIds: new Set() };
    this.nodeMap = new Map();

    this.container.addEventListener('click', (e) => this.#onClick(e));
    this.container.addEventListener('dblclick', (e) => this.#onDblClick(e));
    this.container.addEventListener('contextmenu', (e) => this.#onContext(e));
    this.container.addEventListener('dragstart', (e) => this.#onDragStart(e));
    this.container.addEventListener('dragover', (e) => this.#onDragOver(e));
    this.container.addEventListener('dragleave', (e) => this.#onDragLeave(e));
    this.container.addEventListener('drop', (e) => this.#onDrop(e));
    this.container.addEventListener('dragend', () => this.#clearDropTargets());
  }

  setTree(roots) {
    this.roots = roots;
    this.nodeMap.clear();
    this.#index(roots);
    this.render();
  }

  #index(nodes) {
    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
      if (n.children) this.#index(n.children);
    }
  }

  getNode(id) {
    return this.nodeMap.get(id);
  }

  getSelected() {
    return this.selectedId ? this.nodeMap.get(this.selectedId) : null;
  }

  setSearch(searchState) {
    this.searchState = searchState;
    if (searchState.active) {
      for (const id of searchState.visibleIds) {
        const n = this.nodeMap.get(id);
        if (n && isFolder(n)) this.expanded.add(id);
      }
    }
    this.render();
  }

  select(id) {
    this.selectedId = id;
    this.render();
    const node = this.getNode(id);
    if (node && this.handlers.onSelect) this.handlers.onSelect(node);
  }

  expand(id) {
    this.expanded.add(id);
  }

  render() {
    const frag = document.createDocumentFragment();
    const roots = this.roots[0]?.id === '0' ? this.roots[0].children || [] : this.roots;
    for (const n of roots) {
      this.#renderNode(n, 0, frag);
    }
    this.container.replaceChildren(frag);
  }

  #renderNode(node, depth, parent) {
    if (this.searchState.active && !this.searchState.visibleIds.has(node.id)) {
      return;
    }

    const row = document.createElement('div');
    row.className = 'tree-node';
    row.dataset.id = node.id;
    row.draggable = !isSystemRoot(node.id);
    if (this.selectedId === node.id) row.classList.add('selected');
    if (this.searchState.active && this.searchState.matchIds.has(node.id)) {
      row.classList.add('highlight');
    }

    row.style.paddingLeft = `${8 + depth * 16}px`;

    const folder = isFolder(node);
    const hasChildren = folder && (node.children?.length || 0) > 0;
    const expanded = this.expanded.has(node.id);

    const twistie = document.createElement('span');
    twistie.className = 'tree-twistie' + (hasChildren ? '' : ' empty');
    twistie.dataset.act = 'toggle';
    twistie.textContent = hasChildren ? (expanded ? '▼' : '▶') : '';
    row.appendChild(twistie);

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = folder ? (expanded ? '📂' : '📁') : '🔗';
    row.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'tree-title';
    title.textContent = node.title || (folder ? '(未命名文件夹)' : '(未命名)');
    row.appendChild(title);

    if (!folder && node.url) {
      const url = document.createElement('span');
      url.className = 'tree-url';
      url.textContent = node.url;
      row.appendChild(url);
    }

    parent.appendChild(row);

    if (folder && expanded && node.children) {
      for (const c of node.children) {
        this.#renderNode(c, depth + 1, parent);
      }
    }
  }

  #rowFromEvent(e) {
    return e.target.closest('.tree-node');
  }

  #onClick(e) {
    const row = this.#rowFromEvent(e);
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.dataset.act === 'toggle') {
      if (this.expanded.has(id)) this.expanded.delete(id);
      else this.expanded.add(id);
      this.render();
      return;
    }
    this.select(id);
  }

  #onDblClick(e) {
    const row = this.#rowFromEvent(e);
    if (!row) return;
    const node = this.getNode(row.dataset.id);
    if (!node || isSystemRoot(node.id)) return;
    if (this.handlers.onRename) this.handlers.onRename(node);
  }

  #onContext(e) {
    e.preventDefault();
    const row = this.#rowFromEvent(e);
    if (!row) return;
    this.select(row.dataset.id);
    const node = this.getNode(row.dataset.id);
    if (node && this.handlers.onContextMenu) {
      this.handlers.onContextMenu(node, e.clientX, e.clientY);
    }
  }

  #onDragStart(e) {
    const row = this.#rowFromEvent(e);
    if (!row) return;
    const id = row.dataset.id;
    if (isSystemRoot(id)) {
      e.preventDefault();
      return;
    }
    this.dragId = id;
    e.dataTransfer.setData('text/bookmark-id', id);
    e.dataTransfer.effectAllowed = 'move';
  }

  #onDragOver(e) {
    const row = this.#rowFromEvent(e);
    if (!row || !this.dragId) return;
    const target = this.getNode(row.dataset.id);
    if (!target || !isFolder(target)) return;
    if (row.dataset.id === this.dragId) return;
    if (this.#isDescendant(this.dragId, row.dataset.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.#clearDropTargets();
    row.classList.add('drop-target');
  }

  #onDragLeave(e) {
    const row = this.#rowFromEvent(e);
    if (row) row.classList.remove('drop-target');
  }

  async #onDrop(e) {
    e.preventDefault();
    const row = this.#rowFromEvent(e);
    this.#clearDropTargets();
    if (!row || !this.dragId) return;
    const targetId = row.dataset.id;
    const target = this.getNode(targetId);
    if (!target || !isFolder(target)) return;
    if (this.#isDescendant(this.dragId, targetId)) return;
    if (this.handlers.onMove) {
      await this.handlers.onMove(this.dragId, { parentId: targetId });
    }
    this.dragId = null;
  }

  #clearDropTargets() {
    this.container.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  }

  #isDescendant(ancestorId, maybeChildId) {
    const ancestor = this.getNode(ancestorId);
    if (!ancestor || !ancestor.children) return false;
    const stack = [...ancestor.children];
    while (stack.length) {
      const n = stack.pop();
      if (n.id === maybeChildId) return true;
      if (n.children) stack.push(...n.children);
    }
    return false;
  }

  scrollToId(id) {
    const el = this.container.querySelector(`.tree-node[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
}
