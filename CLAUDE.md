# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # TypeScript check + Vite production build
npm run preview      # Preview production build locally
```

There are no test commands. TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`) serves as the primary static check; `npm run build` will catch type errors.

## Local Development Setup

This project depends on `mudlet-map-editor` as a local file dependency (`../mudlet-map-editor`). That sibling repo must be built first:

```bash
cd ../mudlet-map-editor && npm run build:lib
cd ../arkadia-map-editor && npm install
```

Copy `.env.local.example` to `.env.local` and fill in the values:

| Variable | Purpose |
|---|---|
| `VITE_GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `VITE_LOCK_API_URL` | Backend lock/auth service base URL |
| `VITE_GITHUB_REPO` | `Delwing/arkadia-mapa` |
| `VITE_GITHUB_MAP_FILE` | `map_master3.dat` |
| `VITE_GITHUB_BRANCH` | `development` |

## Architecture

### Plugin System

Plugins live under `src/plugins/*/index.{ts,tsx}` and are discovered at runtime via Vite's `import.meta.glob()` (eager). Each must default-export an `EditorPlugin` object (interface from `mudlet-map-editor`). The core lifecycle hooks used here are:

- `onAppReady()` — app init
- `onMapOpened(map)` / `onMapClosed()` — map load/unload
- `onMapSave(bytes)` — intercept save to stage bytes for upload
- `swatchSets()` — return terrain/POI palette arrays
- `sidebarTabs()` — return sidebar tab descriptors (`{ id, label, render }`)
- `renderOverlay()` — return a React element rendered above the canvas (used for OAuth callback)

Adding a plugin: create `src/plugins/<name>/index.tsx` with a default `EditorPlugin` export — no registration required.

### Current Plugin: Arkadia (`src/plugins/arkadia/index.tsx`)

Combines two concerns:

1. **Swatch sets** — Polish terrain (`TERENY`, 19 types) and POI (`POI`, 23 types) palettes, each entry mapping a display label/symbol to a Mudlet environment ID.
2. **GitHub sync tab** — Delegates to `src/plugins/github-sync/GitHubPanel.tsx` as the sidebar tab and `OAuthCallback` as the overlay.

### GitHub Sync (`src/plugins/github-sync/`)

Collaborative editing workflow: fetch latest map → acquire timed lock → edit locally → stage save → upload file + open PR → lock auto-releases.

| File | Role |
|---|---|
| `state.ts` | Module-level singleton with pub/sub. Token persisted to `localStorage`. Call `subscribe(fn)` → returns unsubscribe. Notifies all listeners synchronously on any mutation. |
| `auth.ts` | GitHub OAuth via popup window. Popup posts code to `window.opener` via `postMessage`; main window listens, calls `exchangeCode()` which hits `LOCK_API/api/auth/token`. |
| `lock.ts` | `acquireLock(token, durationMs)` / `releaseLock(token)` — thin wrappers over `LOCK_API/api/lock` and `/api/release`. |
| `api.ts` | GitHub REST calls: fetch latest map via proxy (`LOCK_API/api/map/latest`), create branch from master SHA, upload base64 file, create PR, check for existing open PRs. |
| `GitHubPanel.tsx` | Single sidebar UI component. Subscribes to state via `subscribe(() => forceUpdate())`. Guards: version must match latest release to lock/upload; must hold lock to upload; prevents duplicate PRs. |

### State Pattern

No Redux or Context — state is a plain module with exported getters/setters and a listener set. Components call `subscribe` in a `useEffect` and force a re-render via `useState` counter on notification. This is intentional: keep it simple for a single-plugin app.

### Vite Config Notes

- `fs` module is stubbed (alias to a stub from mudlet-map-editor) — the editor runs entirely in the browser.
- Node polyfills (`buffer`, `events`, `stream`, `process`, `util`) are shimmed via `vite-plugin-node-polyfills`.
- `react`, `react-dom`, and `konva` are deduped to prevent version conflicts with the sibling package.
- `VITE_BASE_PATH` controls the deployment subdirectory (set to `/<repo-name>/` in CI for GitHub Pages).

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) deploys to GitHub Pages on push to `main`. It checks out both this repo and `mudlet-map-editor` side-by-side, builds the library first, then builds this app with production env vars from repository secrets.
