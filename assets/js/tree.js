// ── State ─────────────────────────────────────────────────
let nodes   = [];
let readOnly = false;
let onMutate = () => {};

export function setMutationCallback(fn) { onMutate = fn; }

// ── Public API ────────────────────────────────────────────

export function initTree(nodeList, ro = false) {
  nodes    = nodeList.map(n => ({ ...n }));
  readOnly = ro;
  renderTree();
}

export function setReadOnly(ro) {
  readOnly = ro;
  renderTree();
}

export function getNodes() {
  return nodes.map(n => ({ ...n }));
}

export function insertSiblingAfter(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return null;
  const depth = nodes[idx].depth;
  const newNode = { id: crypto.randomUUID(), depth, type: ' ', label: '' };
  nodes.splice(_subtreeEnd(idx), 0, newNode);
  renderTree();
  return newNode.id;
}

export function insertChild(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return null;
  if (!nodes[idx].label.trim()) return null;
  const depth = Math.min(1, nodes[idx].depth + 1);
  // Insert after all existing descendants
  let insertAt = idx + 1;
  while (insertAt < nodes.length && nodes[insertAt].depth > nodes[idx].depth) insertAt++;
  const newNode = { id: crypto.randomUUID(), depth, type: ' ', label: '' };
  nodes.splice(insertAt, 0, newNode);
  renderTree();
  return newNode.id;
}

export function deleteNode(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return;
  const depth = nodes[idx].depth;
  let end = idx + 1;
  while (end < nodes.length && nodes[end].depth > depth) end++;
  nodes.splice(idx, end - idx);
  renderTree();
}

export function indentNode(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1 || nodes[idx].depth >= 1) return;
  // Need a preceding sibling at the same depth to become a child of
  const depth = nodes[idx].depth;
  let precIdx = idx - 1;
  while (precIdx >= 0 && nodes[precIdx].depth > depth) precIdx--;
  if (precIdx < 0 || nodes[precIdx].depth !== depth) return;
  const diff = 1;
  const end = _subtreeEnd(idx);
  for (let i = idx; i < end; i++) nodes[i].depth += diff;
  renderTree();
}

export function unindentNode(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1 || nodes[idx].depth === 0) return;
  const end = _subtreeEnd(idx);
  for (let i = idx; i < end; i++) nodes[i].depth = Math.max(0, nodes[i].depth - 1);
  renderTree();
}

export function toggleNode(id) {
  const n = nodes.find(n => n.id === id);
  if (!n || n.type === '-') return;
  const wasChecked = n.type === 'x';
  n.type = wasChecked ? ' ' : 'x';
  const idx = nodes.findIndex(n => n.id === id);

  const changed = [id];

  if (n.depth === 0) {
    // Cascade down: sync all direct children to match parent
    for (let i = idx + 1; i < nodes.length && nodes[i].depth > 0; i++) {
      if (nodes[i].type !== '-') { nodes[i].type = n.type; changed.push(nodes[i].id); }
    }
  } else if (n.depth === 1) {
    // Cascade up: auto-check parent when all children are checked
    let parentIdx = idx - 1;
    while (parentIdx >= 0 && nodes[parentIdx].depth >= 1) parentIdx--;
    if (parentIdx >= 0 && nodes[parentIdx].type !== '-') {
      nodes[parentIdx].type = _childrenAllChecked(parentIdx) ? 'x' : ' ';
      changed.push(nodes[parentIdx].id);
    }
  }

  _patchCheckboxes(changed);
  _updateBranchProgress(id);
  if (!wasChecked) _checkConfetti(id);
}

export function setLabel(id, label) {
  const n = nodes.find(n => n.id === id);
  if (n) n.label = label.replace(/\x1F/g, '');
}

export function toggleBranch(id) {
  const n = nodes.find(n => n.id === id);
  if (!n) return;
  n.type = n.type === '-' ? ' ' : '-';
  renderTree();
}

export function branchProgress(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return { checked: 0, total: 0 };
  const depth = nodes[idx].depth;
  let checked = 0, total = 0;
  for (let i = idx + 1; i < nodes.length && nodes[i].depth > depth; i++) {
    if (nodes[i].type !== '-') { total++; if (nodes[i].type === 'x') checked++; }
  }
  return { checked, total };
}

export function getPreviousNodeId(id) {
  const idx = nodes.findIndex(n => n.id === id);
  return idx > 0 ? nodes[idx - 1].id : null;
}

// ── Rendering ─────────────────────────────────────────────

export function renderTree() {
  const root = document.getElementById('tree-root');
  const empty = document.getElementById('empty-state');
  if (!root) return;

  const focusedId = document.activeElement?.closest('[data-id]')?.dataset.id;

  root.innerHTML = '';

  if (nodes.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const connector = _connector(i);
    const el = _makeNode(n, connector, i);
    root.appendChild(el);
  }

  _updateAllProgress();

  if (focusedId) {
    const el = root.querySelector(`[data-id="${focusedId}"] .node-label`);
    if (el) {
      el.focus();
      _moveCursorToEnd(el);
    }
  }
}

export function renderNode(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return;
  const root = document.getElementById('tree-root');
  if (!root) return;
  const oldEl = root.querySelector(`.tree-node[data-id="${id}"]`);
  if (!oldEl) return;
  const newEl = _makeNode(nodes[idx], _connector(idx), idx);
  root.replaceChild(newEl, oldEl);
}

export function syncAddChildButton(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return;
  const n = nodes[idx];
  if (n.depth !== 0) return;
  const nodeEl = document.querySelector(`.tree-node[data-id="${id}"]`);
  if (!nodeEl) return;
  const actions = nodeEl.querySelector('.node-actions');
  if (!actions) return;
  const existing = actions.querySelector('[data-action="add-child"]');
  const shouldHave = !!n.label.trim();
  if (shouldHave === !!existing) return;
  if (shouldHave) {
    const btn = document.createElement('button');
    btn.className = 'node-btn add';
    btn.dataset.action = 'add-child';
    btn.dataset.id = id;
    btn.title = 'Add child';
    const ts = document.createElement('span'); ts.className = 'btn-text'; ts.textContent = '+';
    const is = document.createElement('span'); is.className = 'btn-icon';
    is.innerHTML = _NODE_ICONS['add-child'];
    btn.appendChild(ts);
    btn.appendChild(is);
    const delBtn = actions.querySelector('[data-action="delete"]');
    if (delBtn) actions.insertBefore(btn, delBtn);
    else actions.appendChild(btn);
  } else {
    existing.remove();
  }
}

// ── Internal helpers ──────────────────────────────────────

export function moveNodeUp(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx <= 0) return;

  if (nodes[idx].depth === 1) {
    if (nodes[idx - 1].depth === 0) {
      // Previous item is the parent → exit parent, become depth-0 before it
      const node = nodes.splice(idx, 1)[0];
      node.depth = 0;
      nodes.splice(idx - 1, 0, node);
    } else {
      // Previous item is a sibling → pure swap, depth unchanged
      [nodes[idx - 1], nodes[idx]] = [nodes[idx], nodes[idx - 1]];
    }
  } else {
    const hasChildren = _subtreeEnd(idx) - idx > 1;
    if (hasChildren) {
      // Has children → block swap past previous depth-0 group
      _swapWithPrevBlock(idx);
    } else if (nodes[idx - 1].depth === 1) {
      // Previous item is a child → absorb as last child of that group (depth 0→1)
      nodes[idx].depth = 1;
    } else {
      // Previous item is also depth-0 with no children → simple position swap
      [nodes[idx - 1], nodes[idx]] = [nodes[idx], nodes[idx - 1]];
    }
  }
  renderTree();
}

export function moveNodeDown(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1 || idx >= nodes.length - 1) return;

  if (nodes[idx].depth === 1) {
    if (nodes[idx + 1].depth === 1) {
      // Next item is a sibling → pure swap, depth unchanged
      [nodes[idx], nodes[idx + 1]] = [nodes[idx + 1], nodes[idx]];
    } else {
      // Next item is depth-0 (or boundary) → exit parent, become depth-0 after group
      nodes[idx].depth = 0;
    }
  } else {
    const end        = _subtreeEnd(idx);
    const hasChildren = end - idx > 1;
    if (hasChildren) {
      // Has children → block swap past next depth-0 group
      if (end >= nodes.length) return;
      _swapWithNextBlock(idx);
    } else {
      if (end >= nodes.length) return;
      const nextHasChildren = _subtreeEnd(end) - end > 1;
      if (nextHasChildren) {
        // Next group has children → become first child of that group (depth 0→1)
        const node = nodes.splice(idx, 1)[0];
        node.depth = 1;
        nodes.splice(idx + 1, 0, node); // idx+1 is right after the next depth-0 (now at idx)
      } else {
        // Next group also has no children → simple position swap
        [nodes[idx], nodes[idx + 1]] = [nodes[idx + 1], nodes[idx]];
      }
    }
  }
  renderTree();
}

function _swapWithPrevBlock(idx) {
  let prevStart = idx - 1;
  while (prevStart > 0 && nodes[prevStart].depth > 0) prevStart--;
  if (nodes[prevStart].depth !== 0) return; // no previous depth-0 block
  const myEnd   = _subtreeEnd(idx);
  const myBlock = nodes.splice(idx, myEnd - idx);
  nodes.splice(prevStart, 0, ...myBlock);
}

function _swapWithNextBlock(idx) {
  const myEnd        = _subtreeEnd(idx);
  const nextEnd      = _subtreeEnd(myEnd);
  const myBlock      = nodes.splice(idx, myEnd - idx);
  const nextBlockSize = nextEnd - myEnd;
  nodes.splice(idx + nextBlockSize, 0, ...myBlock);
}

function _childrenAllChecked(parentIdx) {
  let hasChildren = false;
  for (let i = parentIdx + 1; i < nodes.length && nodes[i].depth > 0; i++) {
    if (nodes[i].type !== '-') {
      hasChildren = true;
      if (nodes[i].type === ' ') return false;
    }
  }
  return hasChildren; // false when no children → don't auto-check parent
}

function _subtreeEnd(idx) {
  const depth = nodes[idx].depth;
  let end = idx + 1;
  while (end < nodes.length && nodes[end].depth > depth) end++;
  return end;
}

function _connector(i) {
  const depth = nodes[i].depth;
  if (depth === 0) return '  ';

  // Is there a next sibling at the same depth?
  let hasSibling = false;
  for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[j].depth < depth) break;
    if (nodes[j].depth === depth) { hasSibling = true; break; }
  }
  return hasSibling ? '├─' : '└─';
}

const _NODE_ICONS = {
  'move-up':   '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,11 8,5 13,11"/></svg>',
  'move-down': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,5 8,11 13,5"/></svg>',
  'add-child': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>',
  'delete':    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
};

function _makeNode(n, connector, idx) {
  const div = document.createElement('div');
  div.className = 'tree-node node-new';
  div.addEventListener('animationend', () => div.classList.remove('node-new'), { once: true });
  div.setAttribute('data-id', n.id);
  div.setAttribute('data-connector', connector + ' ');
  div.style.setProperty('--node-depth', n.depth);
  div.setAttribute('role', 'treeitem');
  div.setAttribute('aria-level', n.depth + 1);

  if (n.type !== '-') {
    const cb = document.createElement('div');
    cb.className = 'node-checkbox' + (n.type === 'x' ? ' checked' : '');
    cb.setAttribute('role', 'checkbox');
    cb.setAttribute('aria-checked', n.type === 'x' ? 'true' : 'false');
    cb.setAttribute('tabindex', '-1');
    div.appendChild(cb);
  }

  const isParent = n.depth === 0 && _subtreeEnd(idx) > idx + 1;
  const label = document.createElement('span');
  label.className = 'node-label'
    + (n.type === 'x' ? ' checked' : '')
    + (n.type === '-' ? ' branch' : '')
    + (isParent      ? ' parent' : '');
  label.textContent = n.label;
  if (!readOnly) {
    label.contentEditable = 'true';
    label.spellcheck = false;
  } else {
    label.style.userSelect = 'none';
    label.style.cursor = 'default';
    label.style.pointerEvents = 'none';
  }
  div.appendChild(label);

  if (n.type === '-' || isParent) {
    const prog = document.createElement('div');
    prog.className = 'node-progress';
    prog.setAttribute('data-progress-for', n.id);
    const bar  = document.createElement('div'); bar.className = 'progress-mini';
    const fill = document.createElement('div'); fill.className = 'progress-mini-fill';
    fill.setAttribute('data-fill', '');
    bar.appendChild(fill);
    const lbl  = document.createElement('span'); lbl.className = 'progress-mini-label';
    lbl.setAttribute('data-label', '');
    prog.appendChild(bar);
    prog.appendChild(lbl);
    div.appendChild(prog);
  }

  if (!readOnly) {
    const actions = document.createElement('div');
    actions.className = 'node-actions';

    const mkBtn = (action, title, text, cls) => {
      const btn = document.createElement('button');
      btn.className = `node-btn ${cls}`;
      btn.dataset.action = action;
      btn.dataset.id = n.id;
      btn.title = title;
      const ts = document.createElement('span'); ts.className = 'btn-text'; ts.textContent = text;
      const is = document.createElement('span'); is.className = 'btn-icon'; is.innerHTML = _NODE_ICONS[action] ?? text;
      btn.appendChild(ts);
      btn.appendChild(is);
      return btn;
    };

    const canDown = n.depth === 0
      ? _subtreeEnd(idx) < nodes.length  // depth-0: must have a next block
      : idx < nodes.length - 1;          // depth-1: just needs a next item

    if (idx > 0)   actions.appendChild(mkBtn('move-up',   'Move up',   '↑', 'move'));
    if (canDown)   actions.appendChild(mkBtn('move-down', 'Move down', '↓', 'move'));
    if (n.depth === 0 && n.label.trim()) actions.appendChild(mkBtn('add-child', 'Add child', '+', 'add'));
    if (idx > 0)                   actions.appendChild(mkBtn('delete',     'Delete',     '×', 'delete'));

    div.appendChild(actions);
  }

  return div;
}

function _updateAllProgress() {
  for (let i = 0; i < nodes.length; i++) {
    const isParent = nodes[i].depth === 0 && _subtreeEnd(i) > i + 1;
    if (nodes[i].type === '-' || isParent) _updateProgressEl(nodes[i].id);
  }
}

function _patchCheckboxes(ids) {
  const root = document.getElementById('tree-root');
  if (!root) return;
  for (const id of ids) {
    const n = nodes.find(n => n.id === id);
    if (!n) continue;
    const el = root.querySelector(`[data-id="${id}"]`);
    if (!el) continue;
    const isChecked = n.type === 'x';
    const cb = el.querySelector('.node-checkbox');
    if (cb) {
      cb.classList.toggle('checked', isChecked);
      cb.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    }
    el.querySelector('.node-label')?.classList.toggle('checked', isChecked);
  }
}

function _updateBranchProgress(leafId) {
  const idx = nodes.findIndex(n => n.id === leafId);
  if (idx === -1) return;
  const depth = nodes[idx].depth;
  _updateProgressEl(leafId);
  for (let i = idx - 1; i >= 0; i--) {
    const isParent = nodes[i].depth === 0 && _subtreeEnd(i) > i + 1;
    if (nodes[i].depth < depth && (nodes[i].type === '-' || isParent)) {
      _updateProgressEl(nodes[i].id);
    }
  }
  _updateGlobalProgress();
}

function _updateProgressEl(branchId) {
  const { checked, total } = branchProgress(branchId);
  const el = document.querySelector(`[data-progress-for="${branchId}"]`);
  if (!el) return;
  const fill  = el.querySelector('[data-fill]');
  const label = el.querySelector('[data-label]');
  const pct   = total > 0 ? (checked / total * 100) : 0;
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.classList.toggle('complete', pct === 100);
  }
  if (label) label.textContent = `${checked}/${total}`;
}

function _updateGlobalProgress() {
  const leaves = nodes.filter(n => n.type !== '-');
  const checked = leaves.filter(n => n.type === 'x').length;
  const total = leaves.length;
  const pct = total > 0 ? (checked / total * 100) : 0;
  const fill  = document.getElementById('global-fill');
  const label = document.getElementById('global-label');
  if (fill)  fill.style.width = `${pct}%`;
  if (label) label.textContent = `${checked} / ${total}`;
}

function _checkConfetti(id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return;
  const depth = nodes[idx].depth;
  // Find nearest ancestor branch
  for (let i = idx - 1; i >= 0; i--) {
    if (nodes[i].depth < depth && nodes[i].type === '-') {
      const { checked, total } = branchProgress(nodes[i].id);
      if (total > 0 && checked === total) {
        const el = document.querySelector(`[data-id="${id}"] .node-checkbox`);
        const rect = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2 };
        triggerConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      break;
    }
  }
  // Also check if ALL leaves are done
  const allLeaves = nodes.filter(n => n.type !== '-');
  if (allLeaves.length > 0 && allLeaves.every(n => n.type === 'x')) {
    triggerConfetti(window.innerWidth / 2, window.innerHeight / 3);
  }
}

function _moveCursorToEnd(el) {
  const range = document.createRange();
  const sel   = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Confetti ──────────────────────────────────────────────

function triggerConfetti(cx, cy) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx     = canvas.getContext('2d');
  const colors  = ['#00ffaa', '#79c0ff', '#e3b341', '#ff6b6b', '#c084fc', '#00e5ff'];
  const count   = 72;
  const frames  = 90;

  const particles = Array.from({ length: count }, () => ({
    x:   cx + (Math.random() - 0.5) * 10,
    y:   cy + (Math.random() - 0.5) * 10,
    vx:  (Math.random() - 0.5) * 9,
    vy:  -(Math.random() * 7 + 3),
    r:   Math.random() * 5 + 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot:  Math.random() * Math.PI * 2,
    drot: (Math.random() - 0.5) * 0.3,
    alpha: 1,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.28;          // gravity
      p.vx  *= 0.98;          // drag
      p.rot += p.drot;
      p.alpha = Math.max(0, 1 - frame / frames);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    frame++;
    if (frame < frames) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(draw);
}
