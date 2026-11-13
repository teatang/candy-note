# Candy Note · 糖果笔记

[![License: MIT](https://img.shields.io/badge/License-MIT-rose.svg)](./LICENSE)

> 🌐 **Language / 语言**: [简体中文](./README.md) | **[English](./README.en.md)**

A minimalist, multi-user cloud note-taking web application powered by **Cloudflare Free Tier services (Workers + D1 + R2 + Static Assets)**. Built with **TypeScript + Vite + Vue 3 + Pinia + Element Plus + Tailwind CSS v4**, featuring comprehensive **Vitest** unit test coverage and **Chinese / English i18n** (Simplified Chinese by default).

---

## ✨ Key Features

1. **100% Cloudflare Free-Tier Edge Architecture**
   - **Cloudflare Workers + Static Assets**: Single deployable unit serving both the Vue SPA frontend and Hono REST API.
   - **Cloudflare D1**: Stores users, sessions, captchas, nested folders, notes, 7-day version snapshots, and image attachment metadata.
   - **Cloudflare R2**: Stores images dragged, pasted, or uploaded into notes, with automatic R2 cleanup when deleting notes or users.
   - **Cron Triggers**: Periodically purges expired captchas, expired sessions, and note versions older than 7 days (alongside lazy pruning).

2. **Multi-User & Admin Console (No Public Registration)**
   - Public self-registration is explicitly disabled at both UI and API layers; accounts must be manually added from the Admin Console (`/admin`).
   - Admin overview dashboard displays total/active users, note & format breakdown, folders, 7-day version snapshots, R2 attachment count & total storage size, and per-user usage/login metrics.
   - Supports creating users, editing roles/statuses, resetting passwords, and deleting users (with self-protection & last-admin safeguards).

3. **Secure Login & Long-Term Auto-Login**
   - Supports login with **Nickname (Username) or Email** + Password + **Server-generated SVG Image Captcha** (single-use, case-insensitive).
   - Supports **30-day long-term auto-login** via checkbox at login AND post-login one-click toggle in the workspace/account settings (`HttpOnly` persistent cookie).

4. **Dual Note Formats, Live Split Preview & Fullscreen Mode**
   - Supports both **Plain Text (`plain`)** and **Markdown (`markdown`)** notes, with confirmation prompts prior to real-time format switching to prevent accidental layout shifts and auto-saves.
   - Markdown mode provides **Split Preview (edit & preview side-by-side)**, Edit-only, and Preview-only modes, formatting toolbar shortcuts, XSS-safe rendering via `DOMPurify`, adaptive Light/Dark code block styling, and automatic new-tab opening (`target="_blank" rel="noopener noreferrer"`) for external note URLs.
   - **Fullscreen Editing & Viewing**: Enter distraction-free fullscreen mode in both Markdown (Split/Edit/Preview) and Plain Text notes, with one-click toggle or `Esc` shortcut exit.

5. **Folders, Drag-and-Drop Reordering, Pinning & R2 Image Uploads**
   - Nested folder management with **drag-and-drop folder reordering**.
   - **Note pinning** (pinned notes appear in a dedicated top section), **drag-and-drop note reordering**, and **dragging notes directly onto folders** to organize them.
   - **Drag & drop images**, paste screenshots from clipboard, or upload via toolbar directly into **Cloudflare R2**, automatically inserting image references into the note.

6. **7-Day Version History & Rollback**
   - Automatically records snapshots on creation, manual save, and throttled auto-save.
   - Browse snapshots from the **past 7 days**, compare side-by-side against current content, and restore with one click (automatically creating a `before_rollback` backup snapshot first).

7. **Responsive Mobile UX & Collapsible Sidebars**
   - **Collapsible Sidebars**: Independently collapse/expand the desktop Folder Sidebar and Note List from the top header or pane header, with state persisted in `localStorage`.
   - **Mobile-First Optimization**: Automatically adapts on small viewports to a slide-over folder drawer and single-pane list/editor navigation (with a quick "Back to Notes" header action), touch-friendly pin/folder controls, responsive Markdown stacked split view, and mobile-sized dialogs, tables, and history drawer.

8. **Minimalist Light/Dark/System Theme & i18n**
   - Switch seamlessly between **Light**, **Dark**, and **Follow System** modes (synced across Tailwind CSS and Element Plus).
   - Real-time switching between **Simplified Chinese (default)** and **English**.

---

## 🛠️ Tech Stack

- **Package Manager**: `pnpm`
- **Frontend**: Vue 3 (`<script setup lang="ts">`), TypeScript, Vite 6, Pinia, Vue Router, Vue I18n, Element Plus, Tailwind CSS v4, Marked, DOMPurify
- **Backend**: Cloudflare Workers, Hono, Web Crypto API (PBKDF2-SHA256 / SHA-256), Cloudflare D1, Cloudflare R2
- **Testing**: Vitest (`node:sqlite` D1 adapter + in-memory R2 adapter + `jsdom` + `@vue/test-utils`)

---

## 📁 Project Structure

```text
candy-note/
├── LICENSE                    # MIT Open Source License
├── migrations/
│   └── 0001_init.sql          # Cloudflare D1 schema and indexes
├── worker/                    # Cloudflare Worker backend (Hono + TypeScript)
│   ├── index.ts               # Worker HTTP & scheduled Cron entry point
│   ├── types.ts               # Bindings & DTO types
│   ├── db/repository.ts       # Initial admin bootstrap, snapshots & pruning
│   ├── middleware/auth.ts     # HttpOnly cookie session & admin RBAC guards
│   ├── routes/                # auth / folders / notes / files(R2) / admin routes
│   └── utils/                 # PBKDF2 crypto, SVG captcha, validation
├── src/                       # Vue 3 frontend
│   ├── api/                   # REST API client wrappers
│   ├── stores/                # Pinia stores (theme/locale/layout/auth/note/admin)
│   ├── i18n/                  # zh-CN (default) & en-US locales
│   ├── utils/                 # Safe Markdown renderer, date/byte helpers, reorder
│   ├── components/            # FolderSidebar drawer, NoteList, Fullscreen NoteEditor, VersionHistoryDrawer, Admin
│   └── views/                 # LoginView / WorkspaceView / AdminView
├── tests/                     # Vitest unit & integration tests (worker + frontend)
├── wrangler.jsonc             # Cloudflare Workers / D1 / R2 deployment config
└── vitest.config.ts           # Vitest multi-project configuration
```

---

## 🚀 Local Development & Testing

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Initialize Local D1 Database

```bash
pnpm db:migrate:local
```

### 3. Start Local Development

```bash
# Terminal 1: Start local Cloudflare Worker (with D1 & R2 emulation on port 8787)
pnpm dev:worker

# Terminal 2: Start Vite frontend dev server (port 5173, proxies /api to 8787)
pnpm dev
```

### 4. Initial Default Admin Account

When no admin user exists on first startup, Candy Note automatically bootstraps one:
- **Username**: `admin`
- **Email**: `admin@candynote.local`
- **Default Password**: `CandyAdmin123!`

> ⚠️ **Security Note**: Before deploying to production, set a custom initial password via `wrangler secret put DEFAULT_ADMIN_PASSWORD`, or change the password immediately after logging in via **Account & Auto-Login** in the top-right user menu.

### 5. Run All Unit Tests & Typechecks

```bash
# Run all frontend and backend Vitest unit tests (15 test files / 40 tests)
pnpm test

# Run TypeScript typechecks for both frontend and worker
pnpm typecheck

# Build production bundle
pnpm build
```

---

## ☁️ Deploying to Cloudflare Free Tier

1. **Authenticate Wrangler CLI**:
   ```bash
   pnpm wrangler login
   ```
2. **Create D1 Database & R2 Bucket**:
   ```bash
   pnpm wrangler d1 create candy-note-db
   pnpm wrangler r2 bucket create candy-note-files
   ```
   Copy the generated `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`.
3. **Apply Remote D1 Migrations**:
   ```bash
   pnpm db:migrate:remote
   ```
4. **Configure Production Initial Admin Secret (Recommended)**:
   ```bash
   pnpm wrangler secret put DEFAULT_ADMIN_PASSWORD
   ```
5. **Build & Deploy**:
   ```bash
   pnpm deploy2cf
   ```

---

## 📄 License

Released under the [MIT License](./LICENSE).

---

## 📝 Changelog

- **v1.1.1**:
  - Fixed Markdown preview code block colors in Light Mode by introducing distinct Light/Dark palettes for both code blocks and inline code;
  - Updated Markdown rendering so external URLs and autolinks inside notes open safely in a new tab (`target="_blank" rel="noopener noreferrer"`) while preserving `#anchor`, `mailto:`, and `tel:` links;
  - Fixed the Admin Console Add/Edit User dialog not rendering Nickname and Email inputs caused by unescaped `@` characters in `vue-i18n` v11 message strings, and expanded Vitest coverage across all i18n keys and the admin user form (15 test files / 40 tests).
- **v1.1.0**:
  - Added full responsive mobile experience: slide-over folder drawer, mobile single-pane list/editor navigation with Back action, touch-friendly controls, and mobile-adapted dialogs, admin tables, and 7-day history drawer;
  - Added distraction-free fullscreen mode for both editing and viewing (Markdown & Plain Text) with `Esc` shortcut exit;
  - Added independently collapsible desktop Folder Sidebar and Note List with persisted preferences;
  - Added [MIT License](./LICENSE), expanded unit tests (15 test files / 36 tests), and updated Chinese/English READMEs.
- **v1.0.0**: Initial complete release of Candy Note featuring admin overview & manual user management, SVG captcha login (nickname/email + 30-day auto-login), Light/Dark/System themes, Markdown split-pane preview & Plain Text notes, drag-and-drop folder/note reordering, note pinning, drag/paste R2 image uploads, 7-day version history rollback, Chinese/English i18n (Chinese default), and comprehensive Vitest unit tests.
