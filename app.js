// ===== 同步配置 =====
const CFG_KEY = 'family_menu_config';
function loadConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { apiBase: '', shareCode: 'family2024' };
}
function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  syncConfig = cfg;
}
let syncConfig = loadConfig();

// 同步状态: 'offline' | 'idle' | 'syncing' | 'done' | 'error'
let syncStatus = 'offline';

// ===== 同源自动检测 =====
// 部署到 Railway 等平台后，前端和后端在同一域名下
// 单次快速检测（5秒超时），手机 VPN 环境下不反复重试
async function autoDetectServer(opts = {}) {
  const { silent = false, force = false } = opts;

  // 没有强制检测且已有有效地址则跳过
  if (!force && syncConfig.apiBase) return true;

  // 重置为未检测状态
  if (force) {
    syncConfig.apiBase = '';
    localStorage.removeItem(CFG_KEY);
    updateSyncIndicator();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/health', {
      headers: { 'X-Share-Code': syncConfig.shareCode || 'family2024' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      syncConfig.apiBase = window.location.origin;
      localStorage.setItem(CFG_KEY, JSON.stringify(syncConfig));
      updateSyncIndicator();
      const changed = await syncPull();
      if (changed) {
        renderDishes(); renderIngredients(); renderQuick();
      }
      if (!silent) showToast('已自动连接云端 ☁️');
      return true;
    }
  } catch(e) {
    // 手机 VPN 环境下 fetch 可能超时或失败，静默处理
  }

  updateSyncIndicator();
  if (!silent) showToast('⚠️ 自动检测失败，请手动填写服务器地址', 4000);
  return false;
}

// ===== State =====
const DB_KEY = 'family_menu_v1';

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return {
    dishes: [
      { id: 1, name: '西红柿炒鸡蛋', cat: '荤菜', ingredients: '西红柿、鸡蛋、葱、盐、糖', note: '少放盐多放糖更好吃', updatedAt: Date.now() },
      { id: 2, name: '清炒时蔬', cat: '素菜', ingredients: '青菜、大蒜、盐、油', note: '', updatedAt: Date.now() },
      { id: 3, name: '冬瓜排骨汤', cat: '汤类', ingredients: '冬瓜、排骨、姜、盐', note: '先焯水去腥', updatedAt: Date.now() },
      { id: 4, name: '凉拌黄瓜', cat: '凉菜', ingredients: '黄瓜、大蒜、辣椒、醋、香油', note: '夏天必备', updatedAt: Date.now() },
    ],
    ingredients: [
      { id: 1, name: '鸡蛋', status: 'have', note: '冰箱里', updatedAt: Date.now() },
      { id: 2, name: '西红柿', status: 'low', note: '只剩2个', updatedAt: Date.now() },
      { id: 3, name: '青菜', status: 'have', note: '', updatedAt: Date.now() },
      { id: 4, name: '大蒜', status: 'have', note: '', updatedAt: Date.now() },
      { id: 5, name: '排骨', status: 'out', note: '需要买', updatedAt: Date.now() },
    ],
    nextDishId: 5,
    nextIngId: 6,
    deletedIds: []
  };
}

function saveData() {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
  scheduleSync();
}

let state = loadData();

// ===== 云端同步（改进版：拉取→合并→推送）=====
let syncTimer = null;
let pollTimer = null;
let isSyncing = false;

function scheduleSync() {
  if (!syncConfig.apiBase) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncPush(), 600);
}

async function apiFetch(path, options = {}) {
  if (!syncConfig.apiBase) throw new Error('未配置服务器');
  const url = syncConfig.apiBase.replace(/\/$/, '') + path;
  const headers = {
    'Content-Type': 'application/json',
    'X-Share-Code': syncConfig.shareCode || 'family2024'
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

// 合并数据：以 ID 为 key 做并集
// - 在 deletedIds 中的项目：跳过（已删除）
// - 两边都有：保留 updatedAt 更新的版本
// - 只有一边：保留
function mergeData(local, remote) {
  const deletedIds = new Set([
    ...(local.deletedIds || []),
    ...(remote.deletedIds || [])
  ]);

  const dishMap = new Map();
  const ingMap = new Map();

  // 先放远程数据
  (remote.dishes || []).forEach(d => {
    if (!deletedIds.has(d.id)) dishMap.set(d.id, d);
  });
  (remote.ingredients || []).forEach(i => {
    if (!deletedIds.has(i.id)) ingMap.set(i.id, i);
  });

  // 再用本地数据覆盖（updatedAt 更新的优先）
  (local.dishes || []).forEach(d => {
    if (!deletedIds.has(d.id)) {
      const existing = dishMap.get(d.id);
      if (!existing || (d.updatedAt || 0) >= (existing.updatedAt || 0)) {
        dishMap.set(d.id, d);
      }
    }
  });
  (local.ingredients || []).forEach(i => {
    if (!deletedIds.has(i.id)) {
      const existing = ingMap.get(i.id);
      if (!existing || (i.updatedAt || 0) >= (existing.updatedAt || 0)) {
        ingMap.set(i.id, i);
      }
    }
  });

  return {
    dishes: Array.from(dishMap.values()),
    ingredients: Array.from(ingMap.values()),
    nextDishId: Math.max(local.nextDishId || 1, remote.nextDishId || 1),
    nextIngId: Math.max(local.nextIngId || 1, remote.nextIngId || 1),
    deletedIds: Array.from(deletedIds)
  };
}

// 检查是否有模态框打开（避免同步时打断编辑）
function isModalOpen() {
  return !!document.querySelector('.modal-overlay.open');
}

// 同步后重新渲染当前页面
function rerenderCurrentTab() {
  if (isModalOpen()) return;
  if (currentTab === 'dishes') renderDishes();
  else if (currentTab === 'ingredients') renderIngredients();
  else if (currentTab === 'quick') renderQuick();
}

async function syncPush() {
  if (!syncConfig.apiBase || isSyncing) return;
  isSyncing = true;
  setSyncStatus('syncing');
  try {
    // 1. 先拉取服务器最新数据
    let remote;
    try {
      remote = await apiFetch('/api/data');
    } catch(e) {
      remote = { dishes: [], ingredients: [], nextDishId: 1, nextIngId: 1, deletedIds: [] };
    }

    // 2. 合并本地和远程
    const merged = mergeData(state, remote);

    // 3. 更新本地状态
    state.dishes = merged.dishes;
    state.ingredients = merged.ingredients;
    state.nextDishId = merged.nextDishId;
    state.nextIngId = merged.nextIngId;
    state.deletedIds = merged.deletedIds;
    saveDataSilent();

    // 4. 推送合并后的数据到服务器
    await apiFetch('/api/data', { method: 'POST', body: JSON.stringify(merged) });

    setSyncStatus('done');
    rerenderCurrentTab();
  } catch(e) {
    console.warn('同步推送失败:', e.message);
    setSyncStatus('error');
  } finally {
    isSyncing = false;
  }
}

async function syncPull() {
  if (!syncConfig.apiBase || isSyncing) return false;
  isSyncing = true;
  setSyncStatus('syncing');
  try {
    const remote = await apiFetch('/api/data');
    if (!remote || !remote.dishes) { isSyncing = false; return false; }

    // 合并远程数据到本地
    const merged = mergeData(state, remote);

    // 检查是否有变化
    const changed = JSON.stringify(merged.dishes) !== JSON.stringify(state.dishes) ||
                    JSON.stringify(merged.ingredients) !== JSON.stringify(state.ingredients);

    state.dishes = merged.dishes;
    state.ingredients = merged.ingredients;
    state.nextDishId = merged.nextDishId;
    state.nextIngId = merged.nextIngId;
    state.deletedIds = merged.deletedIds;
    saveDataSilent();

    // 如果合并后有变化，推送一次让服务器也有完整数据
    if (changed) {
      try {
        await apiFetch('/api/data', { method: 'POST', body: JSON.stringify(merged) });
      } catch(e) { /* 推送失败不影响拉取 */ }
    }

    setSyncStatus('done');
    return changed;
  } catch(e) {
    console.warn('同步拉取失败:', e.message);
    setSyncStatus('error');
    return false;
  } finally {
    isSyncing = false;
  }
}

// 定期轮询（每 10 秒检查一次服务器更新）
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!syncConfig.apiBase || document.hidden || isSyncing) return;
    const changed = await syncPull();
    if (changed) {
      rerenderCurrentTab();
    }
  }, 10000);
}

function saveDataSilent() {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
}

function setSyncStatus(s) {
  syncStatus = s;
  updateSyncIndicator();
}

function updateSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  if (!syncConfig.apiBase) {
    el.innerHTML = '<span style="color:#f44336;cursor:pointer;text-decoration:underline" onclick="openSettings()" title="点击配置云同步">⚠️ 未连接</span>';
    return;
  }
  const map = {
    syncing: '<span style="color:#4caf7d">🔄 同步中</span>',
    done:    '<span style="color:#4caf7d">☁️ 已同步</span>',
    error:   '<span style="color:#f44336">⚠️ 同步失败</span>',
    idle:    '<span style="color:#4caf7d">☁️ 已同步</span>',
    offline: '<span style="color:#4caf7d">☁️ 已同步</span>'
  };
  el.innerHTML = map[s] || map.offline;
}

// ===== Utils =====
function genDishId() { return state.nextDishId++; }
function genIngId()  { return state.nextIngId++;  }

function showToast(msg, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms || 1800);
}

function catClass(cat) {
  const map = { '荤菜': 'cat-meat', '素菜': 'cat-veg', '汤类': 'cat-soup', '凉菜': 'cat-cold' };
  return map[cat] || 'cat-other';
}

function statusText(s)  { return { have: '有货', low: '快没了', out: '已用完' }[s] || s; }
function statusClass(s) { return { have: 'status-have-btn', low: 'status-low-btn', out: 'status-out-btn' }[s] || ''; }
function statusDot(s)   { return { have: 'status-have', low: 'status-low', out: 'status-out' }[s] || ''; }

// ===== Navigation =====
let currentTab = 'dishes';

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === 'page-' + name);
  });
  const fab = document.getElementById('fab');
  fab.style.display = (name === 'quick') ? 'none' : 'flex';
  if (name === 'dishes') renderDishes();
  else if (name === 'ingredients') renderIngredients();
  else if (name === 'quick') renderQuick();
}

// ===== Filters =====
let dishFilter = { cat: 'all', query: '' };
let ingFilter  = { status: 'all', query: '' };

// ===== Render Dishes =====
function renderDishes() {
  const cats = ['all', '荤菜', '素菜', '汤类', '凉菜', '其他'];
  const catLabels = { all: '全部', '荤菜': '🥩荤菜', '素菜': '🥦素菜', '汤类': '🍲汤类', '凉菜': '🥗凉菜', '其他': '其他' };

  const chips = document.getElementById('dish-chips');
  chips.innerHTML = cats.map(c =>
    `<button class="chip${dishFilter.cat === c ? ' active' : ''}" onclick="setDishCat('${c}')">${catLabels[c]}</button>`
  ).join('');

  const query = dishFilter.query.toLowerCase();
  let list = state.dishes.filter(d => {
    const matchCat = dishFilter.cat === 'all' || d.cat === dishFilter.cat;
    const matchQ = !query || d.name.includes(query) || d.ingredients.toLowerCase().includes(query);
    return matchCat && matchQ;
  });

  const container = document.getElementById('dish-list');
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><div class="empty-text">还没有菜品<br>点右下角 + 添加</div></div>`;
    return;
  }
  container.innerHTML = list.map(d => `
    <div class="dish-card">
      <div class="dish-card-header">
        <span class="dish-name">${escHtml(d.name)}</span>
        <span class="dish-cat ${catClass(d.cat)}">${escHtml(d.cat)}</span>
      </div>
      ${d.ingredients ? `<div class="dish-ingredients">🧂 ${escHtml(d.ingredients)}</div>` : ''}
      ${d.note ? `<div class="dish-note">💬 ${escHtml(d.note)}</div>` : ''}
      <div class="dish-actions">
        <button class="btn-sm btn-edit" onclick="openEditDish(${d.id})">✏️ 编辑</button>
        <button class="btn-sm btn-delete" onclick="deleteDish(${d.id})">🗑 删除</button>
      </div>
    </div>
  `).join('');
}

function setDishCat(cat) { dishFilter.cat = cat; renderDishes(); }
function setDishQuery(q)  { dishFilter.query = q; renderDishes(); }

// ===== Render Ingredients =====
function renderIngredients() {
  const statuses = ['all', 'have', 'low', 'out'];
  const sLabels = { all: '全部', have: '✅有货', low: '⚠️快没了', out: '❌用完了' };

  const chips = document.getElementById('ing-chips');
  chips.innerHTML = statuses.map(s =>
    `<button class="chip${ingFilter.status === s ? ' active' : ''}" onclick="setIngStatus('${s}')">${sLabels[s]}</button>`
  ).join('');

  const query = ingFilter.query.toLowerCase();
  let list = state.ingredients.filter(i => {
    const matchS = ingFilter.status === 'all' || i.status === ingFilter.status;
    const matchQ = !query || i.name.toLowerCase().includes(query);
    return matchS && matchQ;
  });

  const container = document.getElementById('ing-list');
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-text">还没有食材<br>点右下角 + 添加</div></div>`;
    return;
  }

  const total = state.ingredients.length;
  const low   = state.ingredients.filter(i => i.status === 'low').length;
  const out   = state.ingredients.filter(i => i.status === 'out').length;

  container.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">食材总数</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--orange)">${low}</div><div class="stat-label">快没了</div></div>
      <div class="stat-card"><div class="stat-num" style="color:var(--red)">${out}</div><div class="stat-label">已用完</div></div>
    </div>
    <div class="card">
      ${list.map(i => `
        <div class="ing-item">
          <div class="ing-status-dot ${statusDot(i.status)}"></div>
          <div style="flex:1">
            <div class="ing-name">${escHtml(i.name)}</div>
            ${i.note ? `<div class="ing-note">${escHtml(i.note)}</div>` : ''}
          </div>
          <button class="status-btn ${statusClass(i.status)}" onclick="cycleIngStatus(${i.id})">${statusText(i.status)}</button>
          <button class="ing-del-btn" onclick="deleteIng(${i.id})">×</button>
        </div>
      `).join('')}
    </div>
  `;
}

function setIngStatus(s) { ingFilter.status = s; renderIngredients(); }

function cycleIngStatus(id) {
  const i = state.ingredients.find(x => x.id === id);
  if (!i) return;
  const order = ['have', 'low', 'out'];
  i.status = order[(order.indexOf(i.status) + 1) % 3];
  i.updatedAt = Date.now();
  saveData();
  renderIngredients();
  showToast(`${i.name} → ${statusText(i.status)}`);
}

function deleteIng(id) {
  const i = state.ingredients.find(x => x.id === id);
  if (!i) return;
  if (!confirm(`删除食材「${i.name}」？`)) return;
  state.ingredients = state.ingredients.filter(x => x.id !== id);
  if (!state.deletedIds) state.deletedIds = [];
  state.deletedIds.push(id);
  saveData();
  renderIngredients();
  showToast('已删除');
}

// ===== Render Quick =====
function renderQuick() {
  const low = state.ingredients.filter(i => i.status === 'low');
  const out = state.ingredients.filter(i => i.status === 'out');
  const qContainer = document.getElementById('quick-content');
  qContainer.innerHTML = `
    <div class="quick-section">
      <div class="quick-section-title">快速添加</div>
      <div class="quick-grid">
        <div class="quick-card" onclick="openAddDish()">
          <div class="qc-icon">🍳</div>
          <div class="qc-label">添加菜品</div>
          <div class="qc-count">${state.dishes.length} 道菜</div>
        </div>
        <div class="quick-card" onclick="openAddIng()">
          <div class="qc-icon">🛒</div>
          <div class="qc-label">添加食材</div>
          <div class="qc-count">${state.ingredients.length} 种食材</div>
        </div>
      </div>
    </div>
    ${(low.length || out.length) ? `
    <div class="quick-section">
      <div class="quick-section-title">⚠️ 需要关注</div>
      <div class="card">
        ${[...out, ...low].map(i => `
          <div class="ing-item">
            <div class="ing-status-dot ${statusDot(i.status)}"></div>
            <div style="flex:1">
              <div class="ing-name">${escHtml(i.name)}</div>
              ${i.note ? `<div class="ing-note">${escHtml(i.note)}</div>` : ''}
            </div>
            <button class="status-btn ${statusClass(i.status)}" onclick="cycleIngStatusAndRefresh(${i.id})">${statusText(i.status)}</button>
          </div>
        `).join('')}
      </div>
    </div>` : `<div class="quick-section"><div class="card" style="text-align:center;color:var(--green);padding:24px"><div style="font-size:36px">✅</div><div style="font-size:15px;margin-top:8px;font-weight:600">食材充足！</div></div></div>`}
    <div class="quick-section">
      <div style="display:flex;gap:8px">
        <button class="btn-primary" style="background:var(--orange);flex:1" onclick="pickRandom()">🎲 随机推荐</button>
        <button class="btn-primary" style="flex:1" onclick="syncPull().then(r => { if(r) { renderQuick(); showToast('已拉取最新数据 ✅'); } })">🔄 手动同步</button>
      </div>
    </div>
    <div id="random-result"></div>
  `;
}

function cycleIngStatusAndRefresh(id) {
  cycleIngStatus(id);
  renderQuick();
}

function pickRandom() {
  if (!state.dishes.length) { showToast('还没有菜品哦~'); return; }
  const d = state.dishes[Math.floor(Math.random() * state.dishes.length)];
  document.getElementById('random-result').innerHTML = `
    <div class="card" style="border-left: 4px solid var(--orange); margin-top:-4px">
      <div class="dish-card-header">
        <span class="dish-name">${escHtml(d.name)}</span>
        <span class="dish-cat ${catClass(d.cat)}">${escHtml(d.cat)}</span>
      </div>
      ${d.ingredients ? `<div class="dish-ingredients">🧂 ${escHtml(d.ingredients)}</div>` : ''}
      ${d.note ? `<div class="dish-note">💬 ${escHtml(d.note)}</div>` : ''}
    </div>
  `;
}

// ===== Modal: Add/Edit Dish =====
let editingDishId = null;

function openAddDish() {
  editingDishId = null;
  document.getElementById('modal-dish-title').textContent = '添加菜品';
  document.getElementById('dish-name-input').value = '';
  document.getElementById('dish-ingredients-input').value = '';
  document.getElementById('dish-note-input').value = '';
  setCatSelected('荤菜');
  openModal('modal-dish');
}

function openEditDish(id) {
  const d = state.dishes.find(x => x.id === id);
  if (!d) return;
  editingDishId = id;
  document.getElementById('modal-dish-title').textContent = '编辑菜品';
  document.getElementById('dish-name-input').value = d.name;
  document.getElementById('dish-ingredients-input').value = d.ingredients;
  document.getElementById('dish-note-input').value = d.note;
  setCatSelected(d.cat);
  openModal('modal-dish');
}

function setCatSelected(cat) {
  document.querySelectorAll('.cat-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.cat === cat);
  });
}

function saveDish() {
  const name = document.getElementById('dish-name-input').value.trim();
  if (!name) { showToast('请输入菜品名称'); return; }
  const cat  = document.querySelector('.cat-opt.selected')?.dataset.cat || '其他';
  const ingredients = document.getElementById('dish-ingredients-input').value.trim();
  const note = document.getElementById('dish-note-input').value.trim();

  if (editingDishId !== null) {
    const d = state.dishes.find(x => x.id === editingDishId);
    if (d) { d.name = name; d.cat = cat; d.ingredients = ingredients; d.note = note; d.updatedAt = Date.now(); }
    showToast('已保存');
  } else {
    state.dishes.push({ id: genDishId(), name, cat, ingredients, note, updatedAt: Date.now() });
    showToast('菜品已添加 🎉');
  }
  saveData();
  closeModal('modal-dish');
  renderDishes();
}

function deleteDish(id) {
  const d = state.dishes.find(x => x.id === id);
  if (!d) return;
  if (!confirm(`删除菜品「${d.name}」？`)) return;
  state.dishes = state.dishes.filter(x => x.id !== id);
  if (!state.deletedIds) state.deletedIds = [];
  state.deletedIds.push(id);
  saveData();
  renderDishes();
  showToast('已删除');
}

// ===== Modal: Add Ingredient =====
function openAddIng() {
  document.getElementById('ing-name-input').value = '';
  document.getElementById('ing-note-input').value = '';
  setStatusSelected('have');
  openModal('modal-ing');
}

function setStatusSelected(s) {
  document.querySelectorAll('.status-opt').forEach(el => {
    el.classList.toggle('selected', el.dataset.status === s);
  });
}

function saveIng() {
  const name = document.getElementById('ing-name-input').value.trim();
  if (!name) { showToast('请输入食材名称'); return; }
  const status = document.querySelector('.status-opt.selected')?.dataset.status || 'have';
  const note   = document.getElementById('ing-note-input').value.trim();
  state.ingredients.push({ id: genIngId(), name, status, note, updatedAt: Date.now() });
  saveData();
  closeModal('modal-ing');
  renderIngredients();
  showToast('食材已添加 ✅');
}

// ===== Modal: Settings =====
function openSettings() {
  document.getElementById('settings-api').value = syncConfig.apiBase;
  document.getElementById('settings-code').value = syncConfig.shareCode;
  openModal('modal-settings');
}

async function saveSettings() {
  let apiBase = document.getElementById('settings-api').value.trim();
  const shareCode = document.getElementById('settings-code').value.trim() || 'family2024';
  const hintEl = document.getElementById('settings-hint');

  // 先保存分享码（即使服务器地址暂时为空）
  saveConfig({ apiBase, shareCode });

  // 未填服务器地址 → 快速尝试同源自动检测（5秒超时）
  if (!apiBase) {
    hintEl.innerHTML = '<span style="color:#4caf7d">🔄 正在自动检测（约5秒）…</span> <button onclick="skipDetection()" style="padding:4px 12px;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:12px;cursor:pointer">跳过</button>';
    hintEl.style.display = 'block';
    const detected = await autoDetectServer({ silent: true });
    apiBase = syncConfig.apiBase;
    if (!apiBase) {
      hintEl.innerHTML = '<span style="color:#f44336">⚠️ 未检测到，请在下方填写 https://family-menu-production-d8aa.up.railway.app 然后保存</span>';
      hintEl.style.display = 'block';
      updateSyncIndicator();
      return;
    }
  }

  // 此时 apiBase 一定有值
  hintEl.innerHTML = '';
  hintEl.style.display = 'none';
  closeModal('modal-settings');
  updateSyncIndicator();
  showToast('配置已保存，正在同步…', 2500);
  syncPull().then(changed => {
    if (changed) {
      renderDishes(); renderIngredients(); renderQuick();
      showToast('已同步最新数据 ✅');
    } else {
      showToast('已连接，数据已是最新 ☁️');
    }
  });
  startPolling();
}

async function resetSyncSettings() {
  if (!confirm('确定要重置同步设置吗？\n\n将清除旧的服务器配置，尝试自动检测云端。\n\n（菜品和食材数据不会丢失）')) return;

  // 立即清除配置
  syncConfig = { apiBase: '', shareCode: 'family2024' };
  localStorage.removeItem(CFG_KEY);
  syncStatus = 'offline';
  updateSyncIndicator();

  document.getElementById('settings-api').value = '';
  document.getElementById('settings-code').value = 'family2024';
  const hintEl = document.getElementById('settings-hint');
  hintEl.innerHTML = '<span style="color:#4caf7d">🔄 正在自动检测（约5秒）…</span> <button onclick="skipDetection()" style="padding:4px 12px;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:12px;cursor:pointer">跳过</button>';
  hintEl.style.display = 'block';

  // 快速检测（单次5秒）
  const detected = await autoDetectServer({ force: true, silent: true });
  if (detected) {
    document.getElementById('settings-api').value = syncConfig.apiBase;
    hintEl.innerHTML = '<span style="color:#4caf7d">✅ 已自动连接云端！</span>';
    closeModal('modal-settings');
    showToast('已重置并自动连接云端 ☁️');
    startPolling();
    syncPull().then(changed => {
      if (changed) { renderDishes(); renderIngredients(); renderQuick(); }
    });
  } else {
    hintEl.innerHTML = '<span style="color:#f44336">⚠️ 未检测到。VPN 开了吗？手动填写下方地址后保存</span>';
    if (!document.getElementById('settings-api').value) {
      document.getElementById('settings-api').value = window.location.origin || '';
    }
  }
}

// 跳过检测，让用户手动填
function skipDetection() {
  var hintEl = document.getElementById('settings-hint');
  hintEl.innerHTML = '<span style="color:#9eaaa0">📝 请在下方填写服务器地址后点击保存</span>';
  var apiInput = document.getElementById('settings-api');
  if (!apiInput.value) apiInput.value = window.location.origin || '';
}

// ===== Modal helpers =====
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

// ===== FAB =====
function fabAction() {
  if (currentTab === 'dishes') openAddDish();
  else if (currentTab === 'ingredients') openAddIng();
}

// ===== Safety =====
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  // Tab clicks
  document.querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // Cat opts in dish modal
  document.querySelectorAll('.cat-opt').forEach(el => {
    el.addEventListener('click', () => setCatSelected(el.dataset.cat));
  });

  // Status opts in ing modal
  document.querySelectorAll('.status-opt').forEach(el => {
    el.addEventListener('click', () => setStatusSelected(el.dataset.status));
  });

  // Dish search
  document.getElementById('dish-search').addEventListener('input', e => setDishQuery(e.target.value));

  // Ing search
  document.getElementById('ing-search').addEventListener('input', e => {
    ingFilter.query = e.target.value;
    renderIngredients();
  });

  // Overlay close
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target === el) closeModal(el.id);
    });
  });

  // Settings save button
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Initial render
  switchTab('dishes');
  updateSyncIndicator();

  // 自动从服务器拉取最新数据
  if (syncConfig.apiBase) {
    syncPull().then(changed => {
      if (changed) {
        renderDishes();
        renderIngredients();
        renderQuick();
        showToast('已同步最新数据 ☁️');
      }
      startPolling();
    }).catch(() => {
      // 旧配置可能失效了，提示用户重置
      updateSyncIndicator();
      showToast('⚠️ 服务器连接失败，可进设置点「重置」重新检测', 4000);
    });
  } else {
    // 首次访问时尝试同源自动检测（Railway 等同源部署场景）
    autoDetectServer().then(() => {
      if (syncConfig.apiBase) startPolling();
    });
  }

  // 页面激活时（从后台切回）自动拉取一次 + 重启轮询
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && syncConfig.apiBase) {
      syncPull().then(changed => {
        if (changed) {
          rerenderCurrentTab();
        }
      });
      startPolling();
    }
  });
});
