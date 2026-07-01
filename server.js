const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

// 数据文件路径
// Railway 部署时通过 DATA_DIR 环境变量指向持久化 Volume
// 本地开发时使用项目目录下的 .data 文件夹
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

app.use(express.json({ limit: '2mb' }));

// 静态文件 — 提供前端页面（与后端同源部署）
app.use(express.static(__dirname));

// ===== 数据读写 =====
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { dishes: [], ingredients: [], nextDishId: 1, nextIngId: 1, deletedIds: [], updatedAt: new Date().toISOString() };
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('读取数据库失败:', e.message);
    return { dishes: [], ingredients: [], nextDishId: 1, nextIngId: 1, deletedIds: [], updatedAt: new Date().toISOString() };
  }
}

function writeDB(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  // 原子写入：先写临时文件再重命名
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

// 服务启动时初始化数据库
const initialDB = readDB();
console.log(`📦 数据库已加载: ${initialDB.dishes.length} 道菜, ${initialDB.ingredients.length} 种食材`);
console.log(`📂 数据目录: ${DATA_DIR}`);

// ===== 简单鉴权 =====
const SHARE_CODE = process.env.SHARE_CODE || 'family2024';
function checkAuth(req, res, next) {
  const code = req.headers['x-share-code'] || req.query.code;
  if (code !== SHARE_CODE) {
    return res.status(401).json({ error: '无效的分享码' });
  }
  next();
}
// 读取不需要鉴权（方便直接浏览器查看）
// 写入需要鉴权
app.use(['POST', 'PUT', 'DELETE'], checkAuth);

// ===== API 路由 =====

// 健康检查
app.get('/api/health', (req, res) => {
  const db = readDB();
  res.json({
    ok: true,
    time: new Date().toISOString(),
    counts: { dishes: db.dishes.length, ingredients: db.ingredients.length }
  });
});

// 获取全量数据
app.get('/api/data', (req, res) => {
  res.json(readDB());
});

// 全量同步（客户端推整个数据集）
app.post('/api/data', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: '数据格式错误' });
  }
  const merged = {
    dishes: Array.isArray(incoming.dishes) ? incoming.dishes : [],
    ingredients: Array.isArray(incoming.ingredients) ? incoming.ingredients : [],
    nextDishId: incoming.nextDishId || 1,
    nextIngId: incoming.nextIngId || 1,
    deletedIds: Array.isArray(incoming.deletedIds) ? incoming.deletedIds : []
  };
  writeDB(merged);
  res.json({ ok: true, updatedAt: new Date().toISOString() });
});

// ===== 菜品 CRUD =====
app.get('/api/dishes', (req, res) => {
  res.json(readDB().dishes);
});

app.post('/api/dishes', (req, res) => {
  const db = readDB();
  const dish = {
    id: db.nextDishId++,
    name: req.body.name || '',
    cat: req.body.cat || '其他',
    ingredients: req.body.ingredients || '',
    note: req.body.note || ''
  };
  db.dishes.push(dish);
  writeDB(db);
  res.json({ ok: true, dish });
});

app.put('/api/dishes/:id', (req, res) => {
  const db = readDB();
  const idx = db.dishes.findIndex(d => d.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '菜品不存在' });
  const d = db.dishes[idx];
  if (req.body.name !== undefined) d.name = req.body.name;
  if (req.body.cat !== undefined) d.cat = req.body.cat;
  if (req.body.ingredients !== undefined) d.ingredients = req.body.ingredients;
  if (req.body.note !== undefined) d.note = req.body.note;
  writeDB(db);
  res.json({ ok: true, dish: d });
});

app.delete('/api/dishes/:id', (req, res) => {
  const db = readDB();
  const before = db.dishes.length;
  db.dishes = db.dishes.filter(d => d.id !== parseInt(req.params.id));
  if (db.dishes.length === before) return res.status(404).json({ error: '菜品不存在' });
  writeDB(db);
  res.json({ ok: true });
});

// ===== 食材 CRUD =====
app.get('/api/ingredients', (req, res) => {
  res.json(readDB().ingredients);
});

app.post('/api/ingredients', (req, res) => {
  const db = readDB();
  const ing = {
    id: db.nextIngId++,
    name: req.body.name || '',
    status: req.body.status || 'have',
    note: req.body.note || ''
  };
  db.ingredients.push(ing);
  writeDB(db);
  res.json({ ok: true, ingredient: ing });
});

app.put('/api/ingredients/:id', (req, res) => {
  const db = readDB();
  const idx = db.ingredients.findIndex(i => i.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: '食材不存在' });
  const ing = db.ingredients[idx];
  if (req.body.name !== undefined) ing.name = req.body.name;
  if (req.body.status !== undefined) ing.status = req.body.status;
  if (req.body.note !== undefined) ing.note = req.body.note;
  writeDB(db);
  res.json({ ok: true, ingredient: ing });
});

app.delete('/api/ingredients/:id', (req, res) => {
  const db = readDB();
  const before = db.ingredients.length;
  db.ingredients = db.ingredients.filter(i => i.id !== parseInt(req.params.id));
  if (db.ingredients.length === before) return res.status(404).json({ error: '食材不存在' });
  writeDB(db);
  res.json({ ok: true });
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`🍳 家庭菜谱服务已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   分享码: ${SHARE_CODE}`);
  console.log(`   数据目录: ${DATA_DIR}`);
});
