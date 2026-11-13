# 糖果笔记 · Candy Note

[![License: MIT](https://img.shields.io/badge/License-MIT-rose.svg)](./LICENSE)

> 🌐 **语言 / Language**: **[简体中文](./README.md)** | [English](./README.en.md)

基于 **Cloudflare 免费边缘服务（Workers + D1 + R2 + Static Assets）** 构建的多用户极简云笔记网站，采用 **TypeScript + Vite + Vue 3 + Pinia + Element Plus + Tailwind CSS v4** 开发，并全面配备 **Vitest** 前后端单元测试与中英文 **i18n** 国际化。

---

## ✨ 核心特性

1. **全 Cloudflare 免费边缘架构**
   - **Cloudflare Workers + Static Assets**：单部署单元同时承载 Vue SPA 前端与 Hono REST API 后端。
   - **Cloudflare D1**：存储用户信息、会话、验证码、多级文件夹、笔记、7 天历史版本及图片元数据。
   - **Cloudflare R2**：存储笔记中拖入、粘贴或上传的图片二进制文件，并支持删除笔记/用户时自动清理释放空间。
   - **Cron Triggers**：定时清理过期验证码、过期会话及超过 7 天的历史版本快照（同时支持惰性清理）。

2. **多用户与后台管理（关闭前台注册）**
   - 严格禁用前台自主注册，仅允许管理员在管理后台 (`/admin`) 手动添加账号。
   - 管理后台提供系统概览统计（用户数、笔记/格式分布、文件夹数、7 天快照数、R2 图片附件数与总空间占用）及用户个人资源用量表。
   - 支持手动创建用户、编辑角色/状态、重置密码及删除用户（含防自我禁用/删除、防删除最后一个管理员保护）。

3. **安全登录与长时间自动登录**
   - 登录页支持输入 **用户昵称或注册邮箱** + 密码 + **服务端 SVG 图片验证码**（一次性消费，防重放）。
   - 登录页及登录成功后均支持开启/关闭 **30 天长时间自动登录**（`HttpOnly` Cookie 持久化会话）。

4. **双格式编辑器、实时预览与全屏模式**
   - 支持 **普通文本 (`plain`)** 与 **Markdown (`markdown`)** 两种笔记格式；实时切换格式前提供二次确认弹窗，防止误触导致视图变更与保存。
   - Markdown 模式支持 **边写边预览（分栏）**、纯编辑、纯预览三种视图切换，集成常用 Markdown 工具栏与 `DOMPurify` XSS 净化渲染；预览区代码块完美适配日间/夜间双套配色，笔记内外部 URL 点击自动在新标签页安全打开（`target="_blank"` + `noopener noreferrer`）。
   - **编辑与查看全屏模式**：无论处于 Markdown（边写边预览 / 纯编辑 / 纯预览）还是普通文本模式，均可一键切换沉浸全屏，支持点击按钮或按 `Esc` 键快速退出。

5. **文件夹、任意拖动排序、置顶与 R2 传图**
   - 支持多级文件夹管理，支持 **文件夹任意拖动排序**。
   - 支持 **笔记置顶**（置顶笔记独立置前展示），支持同组内 **笔记任意拖动排序**，以及将 **笔记直接拖入目标文件夹**。
   - 支持 **拖入图片文件、剪贴板粘贴截图或工具栏选图** 直接上传至 Cloudflare R2 对象存储，并自动插入图片引用。

6. **一周（7 天）内历史版本回退**
   - 每次创建、手动保存或节流自动保存都会生成版本快照，支持查看最近 **7 天内** 历史快照并与当前正文左右对比。
   - 点击回退前会自动为当前内容创建 `before_rollback` 安全备份，避免误操作。

7. **响应式移动体验与可折叠侧边栏**
   - **可折叠侧边栏**：桌面端支持独立折叠/展开左侧「文件夹侧边栏」和中间「笔记列表栏」，折叠偏好自动持久化至 `localStorage`，为写作提供更宽敞的视野。
   - **移动端友好适配**：小屏设备自动切换为「滑出式文件夹抽屉 + 列表/编辑器单栏切换」交互，并在编辑器顶部提供“返回列表”快捷按钮；同时对触摸设备（无需 hover 即可操作置顶与文件夹菜单）、Markdown 上下分栏高度、7 天历史抽屉、登录页及后台弹窗表格进行全面响应式适配。

8. **极简日夜模式与中英文 i18n**
   - 支持 **日间模式 / 夜间模式 / 跟随系统** 无缝切换（同时驱动 Tailwind CSS 与 Element Plus 暗黑主题）。
   - 支持 **简体中文（默认）/ English** 实时切换。

---

## 🛠️ 技术栈

- **包管理**：`pnpm`
- **前端**：Vue 3 (`<script setup lang="ts">`)、TypeScript、Vite 6、Pinia、Vue Router、Vue I18n、Element Plus、Tailwind CSS v4、Marked、DOMPurify
- **后端**：Cloudflare Workers、Hono、Web Crypto API (PBKDF2-SHA256 / SHA-256)、Cloudflare D1、Cloudflare R2
- **测试**：Vitest (`node:sqlite` 高保真 D1 适配器 + 内存 R2 适配器 + `jsdom` + `@vue/test-utils`)

---

## 📁 目录结构

```text
candy-note/
├── LICENSE                    # MIT 开源许可证
├── migrations/
│   └── 0001_init.sql          # Cloudflare D1 初始化数据库表结构与索引
├── worker/                    # Cloudflare Worker 后端 (Hono + TypeScript)
│   ├── index.ts               # Worker HTTP 与 Cron 定时任务入口
│   ├── types.ts               # 环境绑定与业务 DTO 类型定义
│   ├── db/repository.ts       # D1 初始化管理员及快照/清理逻辑
│   ├── middleware/auth.ts     # HttpOnly 会话认证与管理员权限守卫
│   ├── routes/                # auth / folders / notes / files(R2) / admin 路由
│   └── utils/                 # PBKDF2 加密、SVG 验证码、参数校验
├── src/                       # Vue 3 前端应用
│   ├── api/                   # REST API 客户端封装
│   ├── stores/                # Pinia 全局状态（theme/locale/layout/auth/note/admin）
│   ├── i18n/                  # zh-CN (默认) 与 en-US 国际化文案
│   ├── utils/                 # Markdown 安全渲染、日期格式化、拖动排序计算
│   ├── components/            # 文件夹抽屉/侧边栏、笔记列表、全屏编辑器、7天版本抽屉、后台组件
│   └── views/                 # LoginView / WorkspaceView / AdminView
├── tests/                     # Vitest 单元测试（worker + frontend）
├── wrangler.jsonc             # Cloudflare Workers / D1 / R2 部署配置
└── vitest.config.ts           # Vitest 多环境测试配置
```

---

## 🚀 本地开发与测试

### 1. 安装依赖

```bash
pnpm install
```

### 2. 初始化本地 D1 数据库

```bash
pnpm db:migrate:local
```

### 3. 启动本地开发（双终端或单 Worker 预览）

```bash
# 终端 1：启动 Cloudflare Worker 本地模拟服务（含 D1 与 R2，默认端口 8787）
pnpm dev:worker

# 终端 2：启动 Vite 前端热更新开发服务器（默认端口 5173，自动代理 /api 到 8787）
pnpm dev
```

### 4. 默认初始化管理员账号

首次启动系统检测到数据库中尚无管理员时，会自动创建一个初始化管理员账号：
- **用户名**：`admin`
- **邮箱**：`admin@candynote.local`
- **默认密码**：`CandyAdmin123!`

> ⚠️ **安全建议**：生产环境部署前，请使用 `wrangler secret put DEFAULT_ADMIN_PASSWORD` 自定义初始管理员密码，或在首次登录后立即在右上角菜单「账号与自动登录」中修改密码。

### 5. 运行全部单元测试与类型检查

```bash
# 执行前后端所有 Vitest 单元测试（共 15 个测试文件 / 40 项测试用例）
pnpm test

# 前后端 TypeScript 类型检查
pnpm typecheck

# 构建生产静态资源
pnpm build
```

---

## ☁️ 部署到 Cloudflare 免费版

1. **登录 Cloudflare CLI**：
   ```bash
   pnpm wrangler login
   ```
2. **创建 D1 数据库与 R2 存储桶**：
   ```bash
   pnpm wrangler d1 create candy-note-db
   pnpm wrangler r2 bucket create candy-note-files
   ```
   将生成的 `database_id` 填入 `wrangler.jsonc` 中 `d1_databases[0].database_id`。
3. **执行线上 D1 数据库迁移**：
   ```bash
   pnpm db:migrate:remote
   ```
4. **设置生产环境初始化管理员密码（推荐）**：
   ```bash
   pnpm wrangler secret put DEFAULT_ADMIN_PASSWORD
   ```
5. **一键构建并部署**：
   ```bash
   pnpm deploy2cf
   ```

---

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源许可协议发布。

---

## 📝 更新日志

- **v1.1.1**：
  - 修复 Markdown 预览模式下日间模式代码块沿用深色背景导致视觉不协调的问题，为日间与夜间模式独立配置高可读性代码块与行内代码配色；
  - 修复 Markdown 笔记预览区外部 URL 未新开浏览器标签页的问题，点击外部链接及裸网址自动附加 `target="_blank" rel="noopener noreferrer"`，同时保持页内 `#锚点` 与 `mailto:` 原行为；
  - 修复管理后台添加/编辑用户弹窗因 `vue-i18n` v11 文案中包含未转义 `@` 符号导致用户昵称与邮箱输入项未能渲染的问题，并新增覆盖全量 i18n 键编译与管理后台弹窗表单的 Vitest 用例（共 15 个文件 / 40 项测试）。
- **v1.1.0**：
  - 全面优化响应式设计与移动端体验：移动端启用文件夹滑出抽屉、列表/编辑器单栏自适应切换、触摸设备直接操作入口及弹窗/抽屉/表格小屏适配；
  - 新增编辑与查看全屏模式（Markdown 分栏/预览/纯编辑及普通文本通用），支持按 `Esc` 键快速退出；
  - 新增桌面端文件夹侧边栏与笔记列表栏独立折叠/展开开关，并持久化记忆状态；
  - 为项目添加 [MIT 开源协议](./LICENSE)，新增 `layout` 与 UI 交互单元测试（全套单元测试提升至 15 个文件 / 36 项测试）并更新中英文文档。
- **v1.0.0**：完成糖果笔记（Candy Note）核心多用户云笔记系统，涵盖后台统计与手动用户管理、SVG 图片验证码登录（支持昵称/邮箱及 30 天长时间自动登录）、日夜模式与跟随系统、Markdown 边写边预览与普通文本双格式、文件夹与笔记任意拖动排序、置顶、R2 拖拽/粘贴上传图片、7 天内历史版本回退、中英文 i18n（默认中文）及 14 组 Vitest 单元测试。
