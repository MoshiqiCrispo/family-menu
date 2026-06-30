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
// 首次访问时自动检测 /api/health，若存在则自动配置，无需手动填写
async function autoDetectServer() {
  // 已有保存的配置则不自动检测
  if (localStorage.getItem(CFG_KEY) !== null) return;
  try {
    const res = await fetch('/api/health', {
      headers: { 'X-Share-Code': syncConfig.shareCode || 'family2024' }
    });
    if (res.ok) {
      syncConfig.apiBase = window.location.origin;
      localStorage.setItem(CFG_KEY, JSON.stringify(syncConfig));
      updateSyncIndicator();
      const changed = await syncPull();
      if (changed) {
        renderDishes(); renderIngredients(); renderQuick();
      }
      showToast('已自动连接云端 ☁️');
    }
  } catch(e) { /* 当前域名无后端服务，保持离线模式 */ }
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
      { id: 1, name: '西红柿炒鸡蛋', cat: '荤菜', ingredients: '西红柿、鸡蛋、葱、盐、糖', note: '少放盐多放糖更好吃' },
      { id: 2, name: '清炒时蔬', cat: '素菜', ingredients: '青菜、大蒜、盐、油', note: '' },
      { id: 3, name: '冬瓜排骨汤', cat: '汤类', ingredients: '冬瓜、排骨、姜、盐', note: '先焯水去腥' },
      { id: 4, name: '凉拌黄瓜', cat: '凉菜', ingredients: '黄瓜、大蒜、辣椒、醋、香油', note: '夏天必备' },
    ],
    ingredients: [
      { id: 1, name: '鸡蛋', status: 'have', note: '冰箱里' },
      { id: 2, name: '西红柿', status: 'low', note: '只剩2个' },
      { id: 3, name: '青菜', status: 'have', note: '' },
      { id: 4, name: '大蒜', status: 'have', note: '' },
      { id: 5, name: '排骨', status: 'out', note: '需要买' },
    ],
    nextDishId: 5,
    nextIngId: 6
  };
}

function saveData() {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
  scheduleSync();
}

let state = loadData();

// ===== 云端同步 =====
let syncTimer = null;
function scheduleSync() {
  if (!syncConfig.apiBase) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncPush, 600);
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

async function syncPush() {
  if (!syncConfig.apiBase) return;
  setSyncStatus('syncing');
  try {
    const payload = {
      dishes: state.dishes,
      ingredients: state.ingredients,
      nextDishId: state.nextDishId,
      nextIngId: state.nextIngId
    };
    await apiFetch('/api/data', { method: 'POST', body: JSON.stringify(payload) });
    setSyncStatus('done');
  } catch(e) {
    console.warn('同步推送失败:', e.message);
    setSyncStatus('error');
  }
}

async function syncPull() {
  if (!syncConfig.apiBase) return;
  setSyncStatus('syncing');
  try {
    const remote = await apiFetch('/api/data');
    if (!remote || !remote.dishes) return;
    // 简单合并：服务端数据直接覆盖（以服务端为准）
    state.dishes = remote.dishes;
    state.ingredients = remote.ingredients;
    state.nextDishId = remote.nextDishId || state.nextDishId;
    state.nextIngId = remote.nextIngId || state.nextIngId;
    saveDataSilent();
    setSyncStatus('done');
    return true;
  } catch(e) {
    console.warn('同步拉取失败:', e.message);
    setSyncStatus('error');
    return false;
  }
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
    el.innerHTML = '<span style="color:#9eaaa0">☁️ 未配置</span>';
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
  saveData();
  renderIngredients();
  showToast(`${i.name} → ${statusText(i.status)}`);
}

function deleteIng(id) {
  const i = state.ingredients.find(x => x.id === id);
  if (!i) return;
  if (!confirm(`删除食材「${i.name}」？`)) return;
  state.ingredients = state.ingredients.filter(x => x.id !== id);
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
    if (d) { d.name = name; d.cat = cat; d.ingredients = ingredients; d.note = note; }
    showToast('已保存');
  } else {
    state.dishes.push({ id: genDishId(), name, cat, ingredients, note });
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
  state.ingredients.push({ id: genIngId(), name, status, note });
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

function saveSettings() {
  const apiBase = document.getElementById('settings-api').value.trim();
  const shareCode = document.getElementById('settings-code').value.trim() || 'family2024';
  saveConfig({ apiBase, shareCode });
  closeModal('modal-settings');
  updateSyncIndicator();
  if (apiBase) {
    showToast('配置已保存，正在同步…', 2500);
    syncPull().then(changed => {
      if (changed) { renderDishes(); renderIngredients(); renderQuick(); }
    });
  } else {
    showToast('已切换到离线模式');
  }
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
    });
  } else {
    // 首次访问时尝试同源自动检测（Railway 等同源部署场景）
    autoDetectServer();
  }

  // 页面激活时（从后台切回）自动拉取一次
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && syncConfig.apiBase) {
      syncPull().then(changed => {
        if (changed) {
          if (currentTab === 'dishes') renderDishes();
          else if (currentTab === 'ingredients') renderIngredients();
          else if (currentTab === 'quick') renderQuick();
        }
      });
    }
  });
});
