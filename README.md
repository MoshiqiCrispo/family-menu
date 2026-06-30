# 🍳 家庭菜谱管理

双人共享的家庭菜品与食材管理应用，支持离线优先 + 云端同步。

## 项目结构

```
family-menu/
├── package.json      ← 项目配置（Railway 入口）
├── server.js         ← Express 后端（API + 静态文件）
├── railway.json      ← Railway 部署配置
├── .gitignore
├── index.html        ← 前端页面
├── app.css           ← 样式
├── app.js            ← 前端逻辑 + 同步
└── manifest.json     ← PWA 配置
```

## 本地开发

```bash
npm install
npm start
```

打开 http://localhost:3456 即可使用。

---

## Railway 部署（推荐）

### 第 1 步：推送代码到 GitHub

```bash
cd family-menu
git init
git add .
git commit -m "家庭菜谱应用"
```

然后在 GitHub 新建仓库，按提示推送：

```bash
git remote add origin https://github.com/你的用户名/family-menu.git
git branch -M main
git push -u origin main
```

> 注意：`.gitignore` 已排除 `node_modules/` 和 `.data/`，无需手动处理。

### 第 2 步：在 Railway 创建项目

1. 打开 **https://railway.app**，用 GitHub 账号登录
2. 点 **New Project** → **Deploy from GitHub repo**
3. 选择 `family-menu` 仓库
4. Railway 自动检测到 `package.json`，开始安装依赖并启动

### 第 3 步：配置持久化存储（关键！）

> 不做这步，服务重启后数据会丢失。

1. 进入 Railway 项目面板，点 **Settings**
2. 找到 **Volumes** → **Add Volume**
3. **挂载路径** 填：`/app/.data`
4. 保存

### 第 4 步：设置环境变量

在 **Variables** 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `SHARE_CODE` | `你的密码` | 自定义分享码，两台手机需一致 |
| `PORT` | （不用填） | Railway 自动注入 |

例如设 `SHARE_CODE` = `myhome2026`

### 第 5 步：生成公网域名

1. **Settings** → **Networking** → **Generate Domain**
2. 得到地址，如：`https://family-menu-xxx.up.railway.app`

### 第 6 步：手机使用

1. 两台手机浏览器打开上面的域名
2. **自动连接** — 首次打开会自动检测到后端，无需手动配置
3. 如需修改分享码：点右上角 ⚙️ → 填入与第 4 步相同的分享码

**添加到主屏幕：**
- 华为鸿蒙：浏览器菜单 → 添加至桌面
- iPhone：Safari 分享按钮 → 添加到主屏幕

---

## 同步机制

| 场景 | 行为 |
|------|------|
| 日常操作 | localStorage 毫秒响应 |
| 修改后 | 0.6 秒自动推送到服务器 |
| 切回应用 | 自动拉取最新数据 |
| 无网络 | 正常使用，数据暂存本地 |
| 恢复网络 | 自动同步 |

## API 接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 否 |
| GET | `/api/data` | 获取全量数据 | 否 |
| POST | `/api/data` | 全量同步 | 是 |
| GET/POST/PUT/DELETE | `/api/dishes` | 菜品 CRUD | 读否/写是 |
| GET/POST/PUT/DELETE | `/api/ingredients` | 食材 CRUD | 读否/写是 |

所有写操作需在请求头携带 `X-Share-Code: 你的分享码`。
