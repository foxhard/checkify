import { encodePublic, encodeProtected, decodeFromHash } from './codec.js';
import {
  initTree, getNodes, renderTree, renderNode,
  insertSiblingAfter, insertChild, deleteNode,
  indentNode, unindentNode, toggleNode,
  setLabel, getPreviousNodeId,
  setMutationCallback, setReadOnly,
  moveNodeUp, moveNodeDown,
  syncAddChildButton,
} from './tree.js';

// ── App State ─────────────────────────────────────────────
let APP_MODE         = 'editing';
let shareMode        = 'public'; // 'public' | 'protected'
let cachedPassphrase = null;
let encryptGenId     = 0;
let isShareOpen      = false;
let isListsOpen      = false;
let regenTimer       = null;
let editSnapshot     = null;
let hasExistingList  = false;
let EDIT_SUBMODE     = 'visual'; // 'visual' | 'text'
let _pendingBase64   = null;     // base64 data for protected list awaiting passphrase

let currentChecklistId = null;

const LS_PREFIX = 'checkify_';

// ── Store Helpers ─────────────────────────────────────────

function _readEntry(id) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch { return null; }
}

function _writeEntry(id, title, body) {
  if (!id) return;
  try {
    localStorage.setItem(LS_PREFIX + id, JSON.stringify({ title, body, timestamp: Date.now() }));
  } catch { /* quota */ }
}

function _deleteEntry(id) {
  localStorage.removeItem(LS_PREFIX + id);
}

function _allEntries() {
  const results = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LS_PREFIX)) continue;
    const id = key.slice(LS_PREFIX.length);
    const entry = _readEntry(id);
    if (entry && typeof entry.body === 'string') results.push([id, entry]);
  }
  return results;
}

// Returns [id, entry] with the highest timestamp, or null if store is empty.
function _lastEntry() {
  const sorted = _allEntries().sort((a, b) => b[1].timestamp - a[1].timestamp);
  return sorted.length > 0 ? sorted[0] : null;
}

// ── Encode & Persist to Store ─────────────────────────────

async function _saveCurrentToStore() {
  if (!currentChecklistId || !_getTitle()) return;
  const nodes = getNodes().filter(n => n.label.trim() !== '');
  if (nodes.length === 0) return;
  let data;
  try {
    if (shareMode === 'protected' && cachedPassphrase) {
      const myId = ++encryptGenId;
      data = await encodeProtected(nodes, cachedPassphrase, _getTitle());
      if (myId !== encryptGenId) return; // stale
    } else {
      data = await encodePublic(nodes, _getTitle());
    }
  } catch { return; }
  _writeEntry(currentChecklistId, _getTitle(), data);
}

function _scheduleStoreSave() {
  clearTimeout(regenTimer);
  const delay = (shareMode === 'protected' && cachedPassphrase) ? 800 : 200;
  regenTimer = setTimeout(_saveCurrentToStore, delay);
}

// ── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setMutationCallback(afterMutation);

  const rawHash = window.location.hash.slice(1);
  const { id, data } = _splitHashId(rawHash);

  if (id && data) {
    // Shareable URL opened — clean it immediately
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const existing = _readEntry(id);
    if (existing) {
      // Already in store — load from store, ignore URL data
      currentChecklistId = id;
      await _initFromData(id, existing.body);
    } else {
      // New list from URL — save to store first (title filled in after decode)
      currentChecklistId = id;
      _writeEntry(id, '', data);
      await _initFromData(id, data);
    }
  } else {
    // Normal startup — load most recently saved list or blank editor
    const last = _lastEntry();
    if (last) {
      const [lastId, lastEntry] = last;
      currentChecklistId = lastId;
      await _initFromData(lastId, lastEntry.body);
    } else {
      enterEditingMode();
      _loadAndInit();
    }
  }

  wireEvents();
}

async function _initFromData(id, base64data) {
  if (!base64data || typeof base64data !== 'string') {
    if (id) _deleteEntry(id);
    currentChecklistId = null;
    hasExistingList = false;
    enterEditingMode();
    _loadAndInit();
    return;
  }
  const typeByte = _peekHash(base64data);
  if (typeByte & 0x01) {
    // Protected — need passphrase
    shareMode = 'protected';
    _pendingBase64 = base64data;
    hasExistingList = true;
    enterRunningMode();
    showPasswordModal();
  } else {
    try {
      shareMode = 'public';
      const { nodes, title } = await decodeFromHash(base64data, null);
      _setTitle(title);
      initTree(nodes, true);
      hasExistingList = true;
      enterRunningMode();
      // Update store entry — title may have been empty on first import
      if (id) _writeEntry(id, title, base64data);
    } catch {
      // Corrupt data — remove and fall back to editor
      if (id) _deleteEntry(id);
      currentChecklistId = null;
      hasExistingList = false;
      enterEditingMode();
      _loadAndInit();
    }
  }
}

function _splitHashId(rawHash) {
  const sep = rawHash.indexOf(';');
  if (sep === 36) {
    return { id: rawHash.slice(0, 36), data: rawHash.slice(37) };
  }
  return { id: null, data: rawHash };
}

function _peekHash(hash) {
  // Accepts bare base64 (no GUID prefix) or full raw hash
  const { data } = _splitHashId(hash);
  let str = data.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4 !== 0) str += '=';
  try {
    const bin = atob(str.slice(0, 4));
    return bin.charCodeAt(0);
  } catch { return -1; }
}

function _loadAndInit() {
  initTree(_defaultNodes(), false);
  _syncEmptyState();
  _syncTitleGate();
  setTimeout(() => document.getElementById('list-title')?.focus(), 50);
}

function _getTitle() {
  return document.getElementById('list-title')?.textContent?.trim() || '';
}

function _setTitle(title) {
  const el = document.getElementById('list-title');
  if (el) el.textContent = title || '';
}

function _defaultNodes() {
  return [{ id: crypto.randomUUID(), depth: 0, type: ' ', label: '' }];
}

// ── Text ↔ Visual conversion ──────────────────────────────

function nodesToText(nodes, title) {
  const lines = [title];
  for (const n of nodes) {
    if (!n.label.trim()) continue;
    const indent = n.depth === 1 ? '  ' : '';
    let prefix = '';
    if (n.type === 'x') prefix = '[x] ';
    else if (n.type === '-') prefix = '- ';
    lines.push(indent + prefix + n.label);
  }
  return lines.join('\n');
}

function textToNodes(text) {
  const allLines = text.split('\n');
  const title = allLines[0] || '';
  const contentLines = allLines.slice(1).filter(l => l.trim() !== '');

  const nodes = contentLines.map(line => {
    const depth = /^\s/.test(line) ? 1 : 0;
    let label = line.trim();
    let type = ' ';
    if (/^\[x\]\s/i.test(label))  { type = 'x'; label = label.slice(4); }
    else if (/^-\s/.test(label))  { type = '-'; label = label.slice(2); }
    return { id: crypto.randomUUID(), depth, type, label };
  });

  if (nodes.length === 0) nodes.push({ id: crypto.randomUUID(), depth: 0, type: ' ', label: '' });

  return { title, nodes };
}

// ── Edit sub-mode transitions ─────────────────────────────

function enterTextSubmode() {
  document.getElementById('text-editor').value = nodesToText(getNodes(), _getTitle());
  _hide('title-row'); _hide('tree-root'); _hide('empty-state'); _hide('hint-bar'); _hide('global-progress-row');
  document.getElementById('text-editor').style.display = 'block';
  _setEditorModeBtns('VISUAL');
  EDIT_SUBMODE = 'text';
  document.getElementById('text-editor').focus();
}

function enterVisualSubmode() {
  const { title, nodes } = textToNodes(document.getElementById('text-editor')?.value || '');
  _setTitle(title);
  initTree(nodes, false);
  _hide('text-editor');
  _show('title-row'); _show('tree-root'); _show('hint-bar'); _show('global-progress-row');
  _setEditorModeBtns('TEXT');
  EDIT_SUBMODE = 'visual';
  afterMutation();
  _syncTitleGate();
}

// ── Mode transitions ──────────────────────────────────────

function enterEditingMode() {
  if (EDIT_SUBMODE === 'text') {
    _hide('text-editor');
    _show('title-row'); _show('tree-root'); _show('global-progress-row');
    EDIT_SUBMODE = 'visual';
  }
  editSnapshot = { nodes: getNodes(), title: _getTitle() };
  APP_MODE = 'editing';
  _badge('EDITING', 'mode-editing');
  _hide('btn-edit'); _show('btn-save'); _hide('btn-share');
  if (hasExistingList) _show('btn-cancel'); else _hide('btn-cancel');
  const titleEl = document.getElementById('list-title');
  if (titleEl) titleEl.contentEditable = 'true';
  document.getElementById('tree-root')?.classList.remove('running');
  setReadOnly(false);
  _showEditorModeBtns();
  _show('hint-bar');
  _syncTitleGate();
}

function enterRunningMode() {
  if (EDIT_SUBMODE === 'text') {
    _hide('text-editor');
    _show('title-row'); _show('tree-root'); _show('global-progress-row');
    EDIT_SUBMODE = 'visual';
  }
  APP_MODE = 'running';
  _badge('RUNNING', 'mode-running');
  _show('btn-edit'); _hide('btn-save'); _hide('btn-cancel'); _show('btn-share');
  const titleEl = document.getElementById('list-title');
  if (titleEl) titleEl.contentEditable = 'false';
  const app = document.getElementById('app');
  app?.removeAttribute('data-title-empty');
  const treeRoot = document.getElementById('tree-root');
  if (treeRoot) { treeRoot.removeAttribute('inert'); treeRoot.classList.add('running'); }
  setReadOnly(true);
  _hideEditorModeBtns();
  _hide('hint-bar');
}

const enterEditMode = enterEditingMode;
const enterViewMode = enterRunningMode;

function _badge(text, cls) {
  const el = document.getElementById('mode-badge');
  if (!el) return;
  el.textContent = text;
  el.className = `mode-badge ${cls}`;
}

// ── Password Modal ────────────────────────────────────────

function showPasswordModal() {
  const modal = document.getElementById('password-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-password')?.focus(), 50);
}

function hidePasswordModal() {
  const modal = document.getElementById('password-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const errEl = document.getElementById('modal-error');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  const pw = document.getElementById('modal-password');
  if (pw) pw.value = '';
}

async function handleModalDecrypt() {
  const pw  = document.getElementById('modal-password');
  const btn = document.getElementById('modal-submit');
  const err = document.getElementById('modal-error');
  const passphrase = pw?.value?.trim();
  if (!passphrase) return;

  btn.textContent = 'DECRYPTING…';
  btn.disabled = true;
  if (err) { err.textContent = ''; err.classList.add('hidden'); }

  try {
    const base64data = _pendingBase64;
    if (!base64data) throw new Error('No data');
    const { nodes, title, isPublic } = await decodeFromHash(base64data, passphrase);
    cachedPassphrase = passphrase;
    shareMode = isPublic ? 'public' : 'protected';
    _setTitle(title);
    hidePasswordModal();
    _pendingBase64 = null;
    // Update store entry with correct title
    if (currentChecklistId) _writeEntry(currentChecklistId, title, base64data);
    initTree(nodes, true);
    hasExistingList = true;
  } catch {
    if (err) {
      err.textContent = 'Incorrect passphrase or corrupted data.';
      err.classList.remove('hidden');
    }
    if (pw) { pw.value = ''; pw.focus(); }
  } finally {
    btn.textContent = 'DECRYPT';
    btn.disabled = false;
  }
}

// ── Share Panel ───────────────────────────────────────────

function openSharePanel() {
  if (isListsOpen) closeListsPanel();
  const panel = document.getElementById('share-panel');
  if (!panel) return;
  _syncSharePanelState();
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('open'));
  isShareOpen = true;
  syncShareUrl();
}

function _syncSharePanelState() {
  const isProtected = shareMode === 'protected';
  const toggle      = document.getElementById('mode-toggle');
  const pubLabel    = document.getElementById('toggle-public-label');
  const protLabel   = document.getElementById('toggle-protected-label');
  const passSection = document.getElementById('passphrase-section');
  const desc        = document.getElementById('share-mode-desc');

  toggle?.setAttribute('aria-checked', isProtected ? 'true' : 'false');
  pubLabel?.classList.toggle('active', !isProtected);
  protLabel?.classList.toggle('active', isProtected);

  if (isProtected) {
    passSection?.classList.remove('hidden');
    if (desc) desc.textContent = 'Requires a passphrase to open.';
  } else {
    passSection?.classList.add('hidden');
    if (desc) desc.textContent = 'Anyone with the link can view this checklist.';
  }
}

function closeSharePanel() {
  const panel = document.getElementById('share-panel');
  if (!panel) return;
  panel.classList.remove('open');
  setTimeout(() => panel.classList.add('hidden'), 310);
  isShareOpen = false;
}

function handleToggleMode() {
  const toggle = document.getElementById('mode-toggle');
  const isProtected = toggle?.getAttribute('aria-checked') !== 'true';
  toggle?.setAttribute('aria-checked', isProtected ? 'true' : 'false');
  shareMode = isProtected ? 'protected' : 'public';

  const pubLabel    = document.getElementById('toggle-public-label');
  const protLabel   = document.getElementById('toggle-protected-label');
  const passSection = document.getElementById('passphrase-section');
  const desc        = document.getElementById('share-mode-desc');

  pubLabel?.classList.toggle('active', !isProtected);
  protLabel?.classList.toggle('active', isProtected);

  if (isProtected) {
    passSection?.classList.remove('hidden');
    if (desc) desc.textContent = 'Requires a passphrase to open.';
  } else {
    passSection?.classList.add('hidden');
    if (desc) desc.textContent = 'Anyone with the link can view this checklist.';
    cachedPassphrase = null;
  }
  _scheduleStoreSave();
  syncShareUrl();
}

function handlePassphraseInput() {
  const val = document.getElementById('share-password')?.value || '';
  cachedPassphrase = val.trim() || null;
  const hint = document.getElementById('share-passphrase-hint');
  if (hint) {
    hint.textContent = cachedPassphrase
      ? 'URL will auto-update as you edit.'
      : 'Enter a passphrase to enable URL generation.';
  }
  _scheduleStoreSave();
  syncShareUrl();
}

async function syncShareUrl() {
  const el = document.getElementById('share-url');
  if (!el) return;
  el.value = '';
  _syncCopyBtn();
  if (!currentChecklistId || !_getTitle()) return;
  const nodes = getNodes().filter(n => n.label.trim() !== '');
  if (nodes.length === 0) return;

  let base64data;
  if (shareMode === 'public') {
    try { base64data = await encodePublic(nodes, _getTitle()); }
    catch { return; }
  } else {
    if (!cachedPassphrase) {
      const hint = document.getElementById('share-passphrase-hint');
      if (hint) hint.textContent = 'Enter a passphrase to enable URL generation.';
      return;
    }
    const myId = ++encryptGenId;
    _showSpinner(true);
    try {
      base64data = await encodeProtected(nodes, cachedPassphrase, _getTitle());
      if (myId !== encryptGenId) return;
    } catch { return; }
    finally { if (myId === encryptGenId) _showSpinner(false); }
  }
  // Build shareable URL — never written to window.location
  el.value = location.origin + location.pathname + '#' + currentChecklistId + ';' + base64data;
  _syncCopyBtn();
}

async function handleCopyUrl() {
  const el     = document.getElementById('share-url');
  const status = document.getElementById('share-copy-status');
  const url    = el?.value?.trim();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    el.select();
    document.execCommand('copy');
  }
  if (status) {
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 2000);
  }
}

function _showSpinner(on) {
  const s = document.getElementById('share-spinner');
  if (!s) return;
  s.classList.toggle('hidden', !on);
  _syncCopyBtn();
}

function _syncCopyBtn() {
  const btn = document.getElementById('share-copy');
  if (!btn) return;
  const url     = document.getElementById('share-url')?.value?.trim();
  const spinning = !document.getElementById('share-spinner')?.classList.contains('hidden');
  btn.disabled = !url || spinning;
}

// ── After-mutation hook ───────────────────────────────────

function afterMutation(updateStore = false) {
  if (APP_MODE === 'running' && updateStore) _scheduleStoreSave();
  _syncGlobalProgress();
  _syncEmptyState();
}

// ── Progress ──────────────────────────────────────────────

function _syncGlobalProgress() {
  const all     = getNodes();
  const leaves  = all.filter(n => n.type !== '-');
  const checked = leaves.filter(n => n.type === 'x').length;
  const total   = leaves.length;
  const pct     = total > 0 ? (checked / total * 100) : 0;
  const fill    = document.getElementById('global-fill');
  const lbl     = document.getElementById('global-label');
  if (fill) fill.style.width  = `${pct}%`;
  if (lbl)  lbl.textContent   = `${checked} / ${total}`;
}

function _syncEmptyState() {
  const empty = document.getElementById('empty-state');
  if (!empty) return;
  empty.classList.toggle('hidden', getNodes().length > 0);
}

// ── My Lists Panel ────────────────────────────────────────

function openListsPanel() {
  if (isShareOpen) closeSharePanel();
  const panel = document.getElementById('lists-panel');
  if (!panel) return;
  renderListsPanel();
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('open'));
  isListsOpen = true;
}

function closeListsPanel() {
  const panel = document.getElementById('lists-panel');
  if (!panel) return;
  panel.classList.remove('open');
  setTimeout(() => panel.classList.add('hidden'), 310);
  isListsOpen = false;
}

function renderListsPanel() {
  const container = document.getElementById('lists-container');
  const emptyEl   = document.getElementById('lists-empty');
  if (!container) return;
  container.innerHTML = '';

  const entries = _allEntries().sort((a, b) => b[1].timestamp - a[1].timestamp);

  if (entries.length === 0) {
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');

  for (const [id, entry] of entries) {
    const item = document.createElement('div');
    item.className = 'list-item' + (id === currentChecklistId ? ' list-item-active' : '');
    item.dataset.id = id;

    const info = document.createElement('div');
    info.className = 'list-item-info';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'list-item-title';
    titleSpan.textContent = entry.title || '(untitled)';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'list-item-date';
    dateSpan.textContent = _fmtDate(entry.timestamp);

    info.appendChild(titleSpan);
    info.appendChild(dateSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'list-item-delete';
    delBtn.title = 'Delete checklist';
    delBtn.setAttribute('aria-label', 'Delete');
    delBtn.textContent = '×';
    delBtn.dataset.delete = id;

    item.appendChild(info);
    item.appendChild(delBtn);
    container.appendChild(item);
  }
}

function _fmtDate(ts) {
  if (!ts) return '';
  const d       = new Date(ts);
  const diffMs  = Date.now() - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7)  return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function handleLoadList(id) {
  const entry = _readEntry(id);
  if (!entry) return;

  if (APP_MODE === 'editing') {
    const hasContent = _getTitle().length > 0 || getNodes().some(n => n.label.trim().length > 0);
    if (hasContent && !confirm('Load this checklist? Unsaved changes will be lost.')) return;
  }

  clearTimeout(regenTimer);
  closeListsPanel();

  currentChecklistId = id;
  cachedPassphrase   = null;

  await _initFromData(id, entry.body);
}

function handleDeleteList(id) {
  const entry = _readEntry(id);
  if (!entry) return;
  if (!confirm(`Delete "${entry.title || '(untitled)'}"?`)) return;
  _deleteEntry(id);
  renderListsPanel();
  if (id === currentChecklistId) {
    closeListsPanel();
    _resetToBlank();
  }
}

// ── Cancel / Save ─────────────────────────────────────────

function handleCancel() {
  if (EDIT_SUBMODE === 'text') {
    _hide('text-editor'); _show('title-row'); _show('tree-root'); _show('hint-bar'); _show('global-progress-row');
    _setEditorModeBtns('TEXT');
    EDIT_SUBMODE = 'visual';
  }
  if (editSnapshot) {
    initTree(editSnapshot.nodes, true);
    _setTitle(editSnapshot.title);
    editSnapshot = null;
  }
  enterRunningMode();
}

async function handleSave() {
  if (EDIT_SUBMODE === 'text') enterVisualSubmode();
  if (!_getTitle()) return;
  const btn    = document.getElementById('btn-save');
  const btnLbl = btn?.querySelector('.btn-label');
  if (btn) {
    if (btnLbl) btnLbl.textContent = 'SAVING…'; else btn.textContent = 'SAVING…';
    btn.disabled = true;
  }
  try {
    const clean = getNodes().filter(n => n.label.trim() !== '');
    if (clean.length === 0) return;
    if (!currentChecklistId) currentChecklistId = crypto.randomUUID();
    initTree(clean, true);
    hasExistingList = true;
    enterRunningMode();
    // Clear any leftover hash (e.g. from a shareable URL that was opened)
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    await _saveCurrentToStore();
  } finally {
    if (btn) {
      if (btnLbl) btnLbl.textContent = 'SAVE'; else btn.textContent = 'SAVE';
      btn.disabled = false;
    }
  }
}

// ── Event Delegation on tree-root ─────────────────────────

function handleTreeClick(e) {
  if (e.target.classList.contains('node-checkbox')) {
    const nodeEl = e.target.closest('[data-id]');
    if (nodeEl) {
      toggleNode(nodeEl.dataset.id);
      afterMutation(true);
    }
    return;
  }
  const actionEl = e.target.closest('[data-action]');
  const action   = actionEl?.dataset.action;
  if (action === 'add-child') {
    const id    = actionEl.dataset.id;
    const newId = insertChild(id);
    afterMutation();
    if (newId) _focusNode(newId);
    return;
  }
  if (action === 'delete') {
    const id = actionEl.dataset.id;
    if (getNodes().length <= 1) return;
    const prevId = getPreviousNodeId(id);
    deleteNode(id);
    afterMutation();
    if (prevId) _focusNode(prevId);
    return;
  }
  if (action === 'move-up') {
    moveNodeUp(actionEl.dataset.id);
    afterMutation();
    return;
  }
  if (action === 'move-down') {
    moveNodeDown(actionEl.dataset.id);
    afterMutation();
    return;
  }
}

function handleTreeKeydown(e) {
  if (readOnlyMode()) return;
  const nodeEl = e.target.closest('[data-id]');
  if (!nodeEl) return;
  const id = nodeEl.dataset.id;

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    setLabel(id, e.target.textContent.trim());
    const newId = insertSiblingAfter(id);
    afterMutation();
    if (newId) _focusNode(newId);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    setLabel(id, e.target.textContent.trim());
    if (e.shiftKey) unindentNode(id); else indentNode(id);
    afterMutation();
    _focusNode(id);
    return;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const label = e.target.textContent.trim();
    if (label === '' && getNodes().length > 1) {
      e.preventDefault();
      const prevId = getPreviousNodeId(id);
      deleteNode(id);
      afterMutation();
      if (prevId) _focusNode(prevId);
    }
    return;
  }
}

function handleTreeBlur(e) {
  if (readOnlyMode()) return;
  const nodeEl = e.target.closest('[data-id]');
  if (!nodeEl || !e.target.classList.contains('node-label')) return;
  const id = nodeEl.dataset.id;
  setLabel(id, e.target.textContent.trim());
  // Skip renderNode if focus moved to a button within the same tree node —
  // replacing the node div would detach the button before its click fires.
  if (!e.relatedTarget || !nodeEl.contains(e.relatedTarget)) {
    renderNode(id);
  }
  afterMutation();
}

function handleTreeInput(e) {
  if (readOnlyMode()) return;
  const nodeEl = e.target.closest('[data-id]');
  if (!nodeEl || !e.target.classList.contains('node-label')) return;
  const id = nodeEl.dataset.id;
  setLabel(id, e.target.textContent.trim());
  syncAddChildButton(id);
}

function readOnlyMode() { return APP_MODE === 'running'; }

// ── List title editing ────────────────────────────────────

function handleTitleKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const firstLabel = document.querySelector('#tree-root .node-label');
    if (firstLabel) firstLabel.focus();
    else e.target.blur();
  }
}
function handleTitleBlur() { _syncTitleGate(); }

// ── Focus helper ──────────────────────────────────────────

function _focusNode(id) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-id="${id}"] .node-label`);
    if (!el) return;
    el.focus();
    const range = document.createRange();
    const sel   = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// ── New Checklist ─────────────────────────────────────────

function _resetToBlank() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  currentChecklistId = null;
  hasExistingList    = false;
  editSnapshot       = null;
  shareMode          = 'public';
  cachedPassphrase   = null;
  _pendingBase64     = null;
  encryptGenId++;
  _setTitle('');
  enterEditingMode();
  initTree(_defaultNodes(), false);
  _syncEmptyState();
  _syncTitleGate();
  setTimeout(() => document.getElementById('list-title')?.focus(), 50);
}

function handleNewChecklist() {
  if (APP_MODE === 'editing') {
    const hasContent = _getTitle().length > 0 || getNodes().some(n => n.label.trim().length > 0);
    if (hasContent && !confirm('Start a new checklist? Unsaved changes will be lost.')) return;
  }
  if (isShareOpen) closeSharePanel();
  if (isListsOpen) closeListsPanel();
  _resetToBlank();
}

// ── Wire Events ───────────────────────────────────────────

function wireEvents() {
  // Header
  document.getElementById('btn-share')?.addEventListener('click', openSharePanel);
  document.getElementById('btn-lists')?.addEventListener('click', openListsPanel);
  document.getElementById('btn-edit')?.addEventListener('click', enterEditingMode);
  document.getElementById('btn-save')?.addEventListener('click', handleSave);
  document.getElementById('btn-cancel')?.addEventListener('click', handleCancel);
  document.getElementById('btn-new')?.addEventListener('click', handleNewChecklist);

  // Modal
  document.getElementById('modal-submit')?.addEventListener('click', handleModalDecrypt);
  document.getElementById('modal-cancel')?.addEventListener('click', () => {
    hidePasswordModal();
    // Remove store entry if it was added with an empty title during this failed load
    if (currentChecklistId && _readEntry(currentChecklistId)?.title === '') {
      _deleteEntry(currentChecklistId);
    }
    _pendingBase64     = null;
    currentChecklistId = null;
    hasExistingList    = false;
    // Load the most recent saved list or fall back to blank editor
    const last = _lastEntry();
    if (last) {
      handleLoadList(last[0]);
    } else {
      enterEditingMode();
      _loadAndInit();
    }
  });
  document.getElementById('modal-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalDecrypt();
  });

  // Share panel
  document.getElementById('share-close')?.addEventListener('click', closeSharePanel);
  document.getElementById('mode-toggle')?.addEventListener('click', handleToggleMode);
  document.getElementById('mode-toggle')?.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleToggleMode(); }
  });
  document.getElementById('share-password')?.addEventListener('input', handlePassphraseInput);
  document.getElementById('share-copy')?.addEventListener('click', handleCopyUrl);

  // Lists panel — event delegation for load and delete
  document.getElementById('lists-container')?.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) { handleDeleteList(delBtn.dataset.delete); return; }
    const item = e.target.closest('[data-id]');
    if (item) handleLoadList(item.dataset.id);
  });
  document.getElementById('lists-close')?.addEventListener('click', closeListsPanel);

  // Text mode toggle (desktop + mobile)
  const _handleEditorModeToggle = () => {
    if (EDIT_SUBMODE === 'visual') enterTextSubmode();
    else enterVisualSubmode();
  };
  document.getElementById('btn-text-mode')?.addEventListener('click', _handleEditorModeToggle);
  document.getElementById('btn-text-mode-sub')?.addEventListener('click', _handleEditorModeToggle);

  // Tree
  const treeRoot = document.getElementById('tree-root');
  treeRoot?.addEventListener('click', handleTreeClick);
  treeRoot?.addEventListener('keydown', handleTreeKeydown);
  treeRoot?.addEventListener('blur', handleTreeBlur, true);
  treeRoot?.addEventListener('input', handleTreeInput);

  // Title
  const titleEl = document.getElementById('list-title');
  titleEl?.addEventListener('keydown', handleTitleKeydown);
  titleEl?.addEventListener('blur', handleTitleBlur);
  titleEl?.addEventListener('input', () => { _syncTitleGate(); });

  // Close panels on outside click
  document.addEventListener('click', e => {
    if (isShareOpen) {
      const panel   = document.getElementById('share-panel');
      const btnShare = document.getElementById('btn-share');
      if (panel && !panel.contains(e.target) && !btnShare?.contains(e.target)) closeSharePanel();
    }
    if (isListsOpen) {
      const panel    = document.getElementById('lists-panel');
      const btnLists = document.getElementById('btn-lists');
      if (panel && !panel.contains(e.target) && !btnLists?.contains(e.target)) closeListsPanel();
    }
  });

  // Escape closes any open panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isShareOpen) closeSharePanel();
      if (isListsOpen) closeListsPanel();
    }
  });

  document.getElementById('toggle-public-label')?.classList.add('active');
}

// ── Title gate ────────────────────────────────────────────

function _syncTitleGate() {
  if (APP_MODE !== 'editing') return;
  if (EDIT_SUBMODE === 'text') return;
  const hasTitle = !!_getTitle();
  const app      = document.getElementById('app');
  const treeRoot = document.getElementById('tree-root');
  app?.toggleAttribute('data-title-empty', !hasTitle);
  if (treeRoot) treeRoot.toggleAttribute('inert', !hasTitle);
}

// ── DOM helpers ───────────────────────────────────────────

function _show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function _hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function _showEditorModeBtns() {
  document.getElementById('btn-text-mode')?.classList.remove('hidden');
  document.getElementById('mode-subbar')?.classList.remove('hidden');
}
function _hideEditorModeBtns() {
  document.getElementById('btn-text-mode')?.classList.add('hidden');
  document.getElementById('mode-subbar')?.classList.add('hidden');
}
const _EDITOR_MODE_ICONS = {
  TEXT:   '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5,4 1,8 5,12"/><polyline points="11,4 15,8 11,12"/></svg>',
  VISUAL: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="3" height="3" rx="0.5"/><line x1="7" y1="4.5" x2="14" y2="4.5"/><rect x="2" y="8" width="3" height="3" rx="0.5"/><line x1="7" y1="9.5" x2="12" y2="9.5"/></svg>',
};

function _setEditorModeBtns(shortLabel) {
  document.getElementById('btn-text-mode').textContent = shortLabel;
  const long = shortLabel === 'TEXT' ? 'SWITCH TO TEXT EDITOR' : 'SWITCH TO VISUAL EDITOR';
  const sub  = document.getElementById('btn-text-mode-sub');
  if (sub) {
    const lbl = sub.querySelector('.btn-label');
    if (lbl) lbl.textContent = long; else sub.textContent = long;
    const ic = sub.querySelector('.btn-icon');
    if (ic) ic.innerHTML = _EDITOR_MODE_ICONS[shortLabel] ?? '';
  }
}
