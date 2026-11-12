# Candy Note · 糖果笔记

> 🌐 **Language / 语言**: [简体中文](./README.md) | **[English](./README.en.md)**

A minimalist, multi-user cloud note-taking web application powered by **Cloudflare Free Tier services (Workers + D1 + R2 + Static Assets)**. Built with **TypeScript + Vite + Vue 3 + Pinia + Element Plus + Tailwind CSS v4**, featuring full **Vitest** unit test coverage and **Chinese / English i18n** (Simplified Chinese by default).

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

4. **Dual Note Formats & Live Split Preview**
   - Supports both **Plain Text (`plain`)** and **Markdown (`markdown`)** notes.
   - Markdown mode provides **Split Preview (edit & preview side-by-side)**, Edit-only, and Preview-only modes, formatting toolbar shortcuts, and XSS-safe rendering via `DOMPurify`.

5. **Folders, Drag-and-Drop Reordering, Pinning & R2 Image Uploads**
   - Nested folder management with **drag-and-drop folder reordering**.
   - **Note pinning** (pinned notes appear in a dedicated top section), **drag-and-drop note reordering**, and **dragging notes directly onto folders** to organize them.
   - **Drag & drop images**, paste screenshots from clipboard, or upload via toolbar directly into **Cloudflare R2**, automatically inserting image references into the note.

6. **7-Day Version History & Rollback**
   - Automatically records snapshots on creation, manual save, and throttled auto-save.
   - Browse snapshots from the **past 7 days**, compare side-by-side against current content, and restore with one click (automatically creating a `before_rollback` backup snapshot first).

7. **Minimalist Light/Dark/System Theme & i18n**
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
│   ├── stores/                # Pinia stores (theme/locale/auth/note/admin)
│   ├── i18n/                  # zh-CN (default) & en-US locales
│   ├── utils/                 # Safe Markdown renderer, date/byte helpers, reorder
│   ├── components/            # FolderSidebar, NoteList, NoteEditor, VersionHistoryDrawer, Admin
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
# Run all frontend and backend Vitest unit tests
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
   pnpm deploy
   ```

---

## 📝 Changelog

- **v1.0.0**: Initial complete release of Candy Note featuring admin overview & manual user management, SVG captcha login (nickname/email + 30-day auto-login), Light/Dark/System themes, Markdown split-pane preview & Plain Text notes, drag-and-drop folder/note reordering, note pinning, drag/paste R2 image uploads, 7-day version history rollback, Chinese/English i18n (Chinese default), and comprehensive Vitest unit tests.
