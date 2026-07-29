# Avyn

**Discord Forum Ticketing App** — a desktop app that turns Discord Forum Channel posts into triaged, actionable GitHub issues, without living in Discord to do it.

<p>
  <img src="https://img.shields.io/badge/Electron-43.2.0-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19.2.8-149ECA?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/discord.js-14.27.0-5865F2?logo=discord&logoColor=white" alt="discord.js" />
  <img src="https://img.shields.io/badge/Vite-7.3.6-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Vitest-4.1.10-6E9F18?logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/status-in%20development-yellow" alt="Status: in development" />
</p>

---

## What problem this solves

A developer supporting a community through Discord Forum Channels has to read raw forum threads directly in Discord to figure out what needs attention, then manually copy the relevant details into GitHub to actually track the work. Across multiple servers and forums this is tedious, easy to lose track of — which posts have already been looked at? — and it mixes community-facing chat with the developer's own issue-tracking workflow.

## What Avyn does about it

Avyn is an Electron desktop app with an embedded Discord bot that acts as the "interpreter" for that triage workflow. On a manual trigger, it scans every configured Discord Forum Channel — across as many servers as needed — for posts that haven't been triaged yet, pulls each post plus its full thread text into one reviewable UI, and gives the reviewer a fixed set of actions on it:

- **Generate a GitHub issue** from the post, in a compose UI seeded by the post/thread text alongside it
- **Approve / decline** the post, which reacts on the real Discord post and sends a pre-filled remark into the thread
- **Send a standalone remark** into the thread at any time, independent of triage status
- **Jump straight back to the original Discord post** to view attachments/images or continue the conversation natively

The bot only runs while the app is open, and it only ever acts when explicitly told to — no background polling, no unattended automation.

## How it's built

- The Discord bot (discord.js) runs inside an isolated Electron `utilityProcess`, not the main process — a crash in the bot can't take down the app or lose in-progress review work, and its whole lifecycle is bound to the app being open.
- Triage state is tracked with a fixed set of Discord reactions (👀 viewed, ✅ approved, ❌ declined) rather than a custom database synced against Discord's own state.
- Credentials (Discord bot token, GitHub PAT) are stored in OS-level secure storage (`safeStorage`), completely separate from the plain, human-readable local config file used for non-secret settings (forum-to-repo mappings, pulled posts, triage status) — so config can be inspected or backed up without ever exposing a secret.
- GitHub issues are created via a direct call to the GitHub REST API using a stored PAT — no dependency on the `gh` CLI being installed and separately authenticated.
- Every layer (Bot Service, Config Store, GitHub client, IPC contract, renderer components) was built test-first against a faked seam (a fake discord.js client, a fake HTTP layer, a temp-file store, a mocked IPC bridge) — there's no live Discord connection or real GitHub API call anywhere in the test suite.

See [`issues/prd.md`](issues/prd.md) for the full product spec and [`docs/FEATURES.md`](docs/FEATURES.md) for a complete feature-by-feature reference of what's built.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 43 (frameless window, custom titlebar) |
| UI | React 19 + TypeScript, no CSS framework — a shared design-token module (`theme.ts`) |
| Discord integration | discord.js 14, isolated in an Electron `utilityProcess` |
| Build tooling | electron-vite / Vite 7 |
| Testing | Vitest 4 + Testing Library, jsdom |
| Secrets | Electron `safeStorage` (OS-level encryption) |
| Non-secret config | Plain local JSON file |
| GitHub integration | Direct GitHub REST API calls (no `gh` CLI dependency) |

---

## Getting started

### Prerequisites

- Node.js (see `package.json` for dependency version constraints)
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications)), with the bot invited to your server(s) and given access to the forum channels you want it to watch
- (Optional) A GitHub Personal Access Token with `repo` scope, if you want in-app issue creation

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

Launches the Electron app with hot reload. On first run, you'll land on the Settings page to paste in your Discord bot token (required) and GitHub PAT (optional) — both are saved to OS-level secure storage immediately, and the bot connects automatically once a token is present.

### Build

```bash
npm run build
```

### Test & typecheck

```bash
npm run test        # run the full Vitest suite once
npm run test:watch  # watch mode
npm run typecheck   # tsc --noEmit
```

---

## Project structure

```
src/
  main/         # Electron main process — app lifecycle, IPC handlers, config/secret stores
    bot/        # Discord bot logic (BotService) + the utilityProcess composition root
    github/     # GitHub REST API client
    ipc/        # IPC handler logic, one file per feature area
    store/      # ConfigStore (non-secret) — SecretStore lives alongside it
  preload/      # contextBridge APIs exposed to the renderer
  renderer/     # React UI (titlebar, sidebar, triage view, settings, console drawer)
  shared/       # Types shared across main / preload / renderer (the IPC contract)
issues/         # This project's local issue tracker (backlog → ready → in-progress → qa → done)
docs/           # Feature reference and other supporting docs
```

---

## Project workflow

This repo tracks its own work as local issue files under [`issues/`](issues/kanban.md), organized as a small kanban (`backlog` → `ready` → `in-progress` → `qa` → `done`), each issue written as a thin, independently-testable vertical slice. `issues/prd.md`, `issues/prd-ui-layout.md`, and `issues/prd-visual-design.md` are the three product-requirement documents behind the app's functionality, application shell, and visual design respectively.

---

## Status

Actively in development. Core triage workflow (scan, review, approve/decline, remark, GitHub issue creation) and the full visual design pass are implemented and under test; see [`issues/kanban.md`](issues/kanban.md) for exactly what's in QA versus done.
