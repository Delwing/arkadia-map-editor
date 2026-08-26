# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
yarn dev                  # Vite dev server
yarn build                # Client plugin + TypeScript check + Vite production build
yarn build:client-plugin  # Just the Arkadia web-client plugin → public/client-plugin.js
yarn preview              # Preview production build locally
```

This project uses **yarn** (`yarn.lock` is the committed lockfile; CI installs with `yarn install --frozen-lockfile`). Avoid `npm install`, which would create a competing `package-lock.json`.

There are no test commands. TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`) serves as the primary static check; `yarn build` will catch type errors.

## Local Development Setup

This project depends on `mudlet-map-editor` as a **published npm package** (pinned in `package.json` / `yarn.lock`). Install and go:

```bash
yarn install
```

The sibling repo at `../mudlet-map-editor` is the upstream source for that package, but this app does not build or link it locally — bumping the version means changing the `mudlet-map-editor` version in `package.json` and running `yarn install`. Building the sibling's library (`yarn build:lib`) only matters when publishing a new version of it to npm.

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

Combines three concerns:

1. **Swatch sets** — Polish terrain (`TERENY`, 19 types) and POI (`POI`, 23 types) palettes, each entry mapping a display label/symbol to a Mudlet environment ID.
2. **GitHub sync tab** — Delegates to `src/plugins/github-sync/GitHubPanel.tsx` as the sidebar tab and `OAuthCallback` as the overlay.
3. **Game-client bridge** — `clientBridge.ts` + the "Klient" sidebar tab (`ClientTab.tsx`). See below.

### GitHub Sync (`src/plugins/github-sync/`)

Collaborative editing workflow: fetch latest map → acquire timed lock → edit locally → stage save → upload file + open PR → lock auto-releases.

| File | Role |
|---|---|
| `state.ts` | Module-level singleton with pub/sub. Token persisted to `localStorage`. Call `subscribe(fn)` → returns unsubscribe. Notifies all listeners synchronously on any mutation. |
| `auth.ts` | GitHub OAuth via popup window. Popup posts code to `window.opener` via `postMessage`; main window listens, calls `exchangeCode()` which hits `LOCK_API/api/auth/token`. |
| `lock.ts` | `acquireLock(token, durationMs)` / `releaseLock(token)` — thin wrappers over `LOCK_API/api/lock` and `/api/release`. |
| `api.ts` | GitHub REST calls: fetch latest map via proxy (`LOCK_API/api/map/latest`), create branch from master SHA, upload base64 file, create PR, check for existing open PRs. |
| `GitHubPanel.tsx` | Single sidebar UI component. Subscribes to state via `subscribe(() => forceUpdate())`. Guards: version must match latest release to lock/upload; must hold lock to upload; prevents duplicate PRs. |

### Game-Client Bridge (`src/bridge/`, `src/client-plugin/`, `src/plugins/arkadia/clientBridge.ts`)

Connects a running [arkadia-web-client-extension](https://github.com/Delwing/arkadia-web-client-extension) session to an open editor tab, so the editor can follow the player around and capture data out of the game.

**Both halves of the protocol live in this repo** so they version together. The client half is built as a standalone ES module and hosted alongside the editor; the user pastes its URL into the web client's Scripts section.

| File | Role |
|---|---|
| `src/bridge/protocol.ts` | Message types + transport. Shared by both halves. |
| `src/client-plugin/index.ts` | The Arkadia client plugin — `init(api)` / `destroy()`. Built by `vite.client-plugin.config.ts` to `public/client-plugin.js` (gitignored; `vite build` copies it into `dist/`). |
| `public/bridge.html` | Cross-origin relay, used only in local dev (see below). |
| `src/plugins/arkadia/clientBridge.ts` | Editor half: presence tracking, applying requests, follow/pan. Same module-singleton + listener-set pattern as `github-sync/state.ts`. |
| `src/plugins/arkadia/areaSync.ts` | Works out which areas a command touched and exports them (and the whole map) in the client's format, via the binary reader's own `convertRoom`/`convertLabel`/`readerExport`. |
| `src/plugins/arkadia/ClientTab.tsx` | "Klient" sidebar tab — status, follow/live-edit toggles, map push, current position, capture log. |

The client half of live edit lives in the **sibling repo**: `api.map.applyChanges` / `syncAreas` / `replaceMap`, implemented in `arkadia-web-client-extension`'s `src/shared/map/MapHelper.ts`. Adding to that API means regenerating `plugin-types` there and republishing the tarball **before** this repo can typecheck against it.

**Transport.** Both apps deploy to the same GitHub Pages origin, so a plain `BroadcastChannel` reaches every tab and needs no configuration — that is the whole reason for hosting the plugin here. Cross-origin setups tunnel through a hidden iframe pointing at `bridge.html` on the editor's origin instead. That path is **opt-in**, set from the game with `/edytor polacz <editor url>` (or by hand via `localStorage.arkadiaMapEditorOrigin`); `/edytor polacz` with no argument clears it. `/edytor status` reports which transport is live, and the "Klient" tab shows the exact command when the editor is on localhost.

**The usual dev setup is a *published* client driving a *local* editor**, which is cross-origin twice over and needs both of the following — miss either and the plugin silently falls back and dies on a syntax error:
1. `server.cors` in `vite.config.ts` must allow `https://delwing.github.io`. **Restarting the editor dev server is required** after changing it; a server started before the change still sends no header.
2. `/edytor polacz http://localhost:<port>/` in the client, so the bridge uses the relay rather than a channel the local editor cannot hear.

**Never use `import.meta` (or any module-only syntax beyond the exports) in `src/client-plugin/`.** The host loads plugins with `import()` and, when that fails, retries by injecting a classic `<script src>` — which cannot execute an ES module at all. The fallback therefore dies on the first module-only construct in the file, so a plain *module-load* failure (CORS, 404, mixed content) surfaces as a confusing `SyntaxError` pointing at that construct instead of at the real cause. When a plugin won't load, ignore the syntax error and look for `[PluginManager] Module load error:` in the console — that line has the actual reason.

**Typing.** The plugin is written against `@arkadia/plugin-types`, a devDependency pulled from a tarball on the client's own Pages site (`https://delwing.github.io/arkadia-web-client-extension/arkadia-plugin-types.tgz`) — the same way the sibling `arkadia-mc-js` plugin consumes it. It is types-only, so `import type` erases it entirely and the bundle stays self-contained.

**Messages.** Client → editor: `client-hello` (20s heartbeat carrying the client's room count), `client-bye`, `position`, `set-room-name`, `request-map`. Editor → client: `editor-hello` (map name + room count), `editor-bye`, `result`, `sync-areas`, `push-map`.

**In-game commands.** `/edytor` (status), `/edytor nazwa [tekst]`, `/edytor mapa` (pull the editor's map), `/edytor polacz [adres]`.

**Live edit — why areas, not commands.** The editor mirrors edits by watching its undo stack, working out which *areas* a command touched, and resending those wholesale via `api.map.syncAreas`. It deliberately does **not** translate command semantics into field patches. Measured on the real map: whole map 11.0 MB / 26,988 rooms / 60 areas; median area 144 KB (390 rooms); largest 750 KB; one room 327 bytes. An area costs nothing meaningful over BroadcastChannel (in-process structured clone) and the per-area rebuild happens on any edit regardless, so paying 144 KB instead of 200 bytes buys:
- one mechanism covering rooms, labels, custom lines, added/deleted rooms, doors, locks and exit weights, instead of a growing per-kind translator;
- undo for free — commands are only read to pick areas, and the area is rebuilt from whatever the map holds afterwards;
- **cheap failure** — area collection is a deliberately generous scan for id-bearing fields, so an unrecognised future command over-collects and resends a spare area rather than silently missing an edit.

Only things that change the *set* of areas (`addArea`, `deleteArea`, `deleteAreaWithRooms`) or the shared colour palette (`setCustomEnvColor`) can't be expressed that way; those come back as `needsReload` and the client says so once per kind.

**Whole-map push.** `pushWholeMap()` sends the open map via `readerExport` — the same exporter that generates the published `mapExport.json` — so the client receives a payload indistinguishable from the file it normally downloads. Measured at ~440 ms round trip for the full map, hence explicit-only (button, or `/edytor mapa`), never per edit. Its real value is alignment: afterwards both sides provably hold the same map, so later area syncs cannot land on the wrong rooms. The client reports its room count in `client-hello` and the tab warns when it disagrees with the editor's.

**Coordinates: y is flipped between the two sides.** The editor holds raw Mudlet coordinates (y-up: north increases y); the client's renderer negates y when it builds the map (`{...e, y: -e.y}` in `MapReader`), so its space is y-down. All payloads therefore travel in **source orientation** and the client flips on the way in, keeping that conversion in exactly one place. `ClientPosition` is the exception — it carries client-space coordinates, but the editor navigates by `roomId` and reads coordinates from its own map, so they're informational only.

**Notes for future work here:**
- Room names are applied via `pushCommand({kind:'setRoomField'})`, so captures are undoable and appear in the Changes tab like any other edit.
- `pushCommand` wants a `SceneHandle` to keep the renderer in sync; plugin *lifecycle* hooks never receive one, so `captureSceneRef` latches the ref from the first render hook that does (the "Klient" tab, plus a no-op `roomPanelSections` entry). Without it we fall back to `store.bumpStructure()`, which is correct but rebuilds the whole scene.
- Following pans only; it deliberately does not touch selection unless "Zaznaczaj też bieżącą lokację" is on, so it can't clobber what the user is editing. Pans are throttled to 150ms.
- `server.cors` in `vite.config.ts` allows loopback origins plus `https://delwing.github.io`, so both a local and the published client can import the plugin cross-origin. Chrome treats `localhost` and `127.0.0.1` as different origins here. `http://localhost` counts as trustworthy, so the published (https) client *can* load from a local dev server without tripping mixed content.

### State Pattern

No Redux or Context — state is a plain module with exported getters/setters and a listener set. Components call `subscribe` in a `useEffect` and force a re-render via `useState` counter on notification. This is intentional: keep it simple for a single-plugin app.

### Vite Config Notes

- `fs` module is stubbed (alias to a stub from mudlet-map-editor) — the editor runs entirely in the browser.
- Node polyfills (`buffer`, `events`, `stream`, `process`, `util`) are shimmed via `vite-plugin-node-polyfills`.
- `react`, `react-dom`, and `konva` are deduped to prevent version conflicts with the sibling package.
- `VITE_BASE_PATH` controls the deployment subdirectory (set to `/<repo-name>/` in CI for GitHub Pages).
- `server.cors` is open to loopback origins only — needed so the Arkadia web client's dev server can import `client-plugin.js` cross-origin. Irrelevant in production, where both apps share an origin.
- `vite.client-plugin.config.ts` is a separate lib-mode build for the client plugin. It writes into `public/`, so it must run *before* `vite build`; `yarn build` chains them.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) deploys to GitHub Pages on push to `master`. It checks out this repo, runs `yarn install --frozen-lockfile` (pulling `mudlet-map-editor` from npm), then builds with production env vars from repository secrets.
