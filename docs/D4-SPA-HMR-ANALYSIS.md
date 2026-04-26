# D4 — SPA-friendly dev HMR (analysis)

**Status:** design + partial framework hook; **default browser behavior** remains full `location.reload()` unless the app opts in. This document ties together **YAMF** (`yamf:dev-reload`, SSE, Vite plugin), **Vite** HMR, and **app** responsibilities (e.g. SoundClone).

**Related:** [ROADMAP.md](./ROADMAP.md) (D2, D3, D4), [TEST-PLAN-FOLLOW-UP.md](./TEST-PLAN-FOLLOW-UP.md), [TEST-PLAN-CLIENT-AND-DEV-HMR.md](./TEST-PLAN-CLIENT-AND-DEV-HMR.md).

---

## Three layers (do not confuse them)

| Layer | What it does |
|--------|----------------|
| **Vite HMR** | Re-executes / accepts changed ESM; the only mechanism for true **module-level** hot updates. |
| **`yamfVitePluginDev`** (`packages/client/src/vite-plugin-yamf-dev.js`) | On Vite `handleHotUpdate`, debounced `publishMessage('yamf:dev-reload', { source: 'vite', at })` when `YAMF_DEV=on` and `YAMF_REGISTRY_URL` is set. Fans out “something in the dev graph changed” to the registry pub/sub (and thus to `yamf-dev` SSE). |
| **`connectYamfDevHmr`** (`packages/client/src/dev-hmr.js`) | Browser `EventSource`; on `reload` event, by default **`onReload` → `location.reload()`**. If you pass **`applyPatch`**, it may return **`false`** (sync or async) to **skip** that full reload. |

Full page reload on every edited file is **expected** when `connectYamfDevHmr` runs **without** `applyPatch`, because the SSE path is meant to **coordinate** with `yamf dev` deploys and other browsers, not to replace Vite’s module HMR.

---

## What “D4 / state-preserving” means in the roadmap

- **Framework:** `connectYamfDevHmr({ applyPatch, onReload })` — `applyPatch` receives payload (e.g. `service`, `hash`, `at`, `source`). Return **`false`** to skip the default `onReload` (see implementation in `dev-hmr.js`).
- **App:** After skipping, the app must **re-run** with new module code (Vite `import.meta.hot.accept` boundaries, rerender root, refetch from services, etc.). **Not** a one-line framework default.
- **Slice 3 (`broadcastRender` / `ssr-hydrate`):** Composes with **server-rendered** or hybrid UIs; a **client-only** SPA shell (e.g. SoundClone’s `createReactiveComponent` + `#main-content`) typically uses **applyPatch + rerender**, not necessarily `broadcastRender`.

---

## SoundClone-specific picture

- Shell: **`createReactiveComponent`** over `renderShell` into `#main-content` (`main.js`).
- In-memory state (player, router, stores) is **lost** on `location.reload()`.
- **`VITE_YAMF_DEV_HMR=1`**: opt-in to connect the YAMF SSE path (full tab reload on `reload` unless you add `applyPatch`).
- **Default for local UI work:** do **not** set `VITE_YAMF_DEV_HMR=1` — rely on **Vite HMR** only. See `soundclone/frontend/.env.example` and the [SoundClone deployment README](../../soundclone-deployment/README.md).

---

## Extending for “default SPA preserve” (future)

| Area | Direction |
|------|-----------|
| **YAMF** | Optional helper (e.g. `connectYamfDevHmrViteSpa({ onRerender })`) that, for `source === 'vite'`, returns `false` and calls `onRerender`. Document `applyPatch` contract clearly. |
| **Vite plugin** | Optional **`publishOnHmr: false`** or stricter `filter` so pure frontend saves do not spam pub/sub (tradeoff: other tabs / no SSE on Vite-only edits). |
| **Payload** | Standardize fields (`source`, `service`, `hash`) so apps branch: Vite-only vs `yamf dev` deploy. |
| **Config naming** | Env like `VITE_YAMF_SPA_PRESERVE=1` can gate behavior without conflating with static **SPA** file-server options. |

---

## When you still need a full reload

- Backend / service code deployed by `yamf dev` (new process, new contract).
- Vite’s own “cannot HMR, falling back to full reload” (depends on the module graph).
- Intentional “refresh all tabs” for coordinated dev.

---

## Vite still full-reloads the tab (YAMF already off)

If `VITE_YAMF_DEV_HMR` is not `1` and `YAMF_DEV` is not `on`, but **saving a file still reloads the whole page**, the cause is almost always **Vite’s HMR graph**: a dev entry (e.g. `main.js`) **statically imports** that file; when it changes, Vite invalidates the importer and, without a hot **accept** boundary, **full reloads**.

**SoundClone** (vanilla ESM, `import { Settings } from './pages/Settings.js'` in `main.js`): add `import.meta.hot.accept([...page paths], () => pageComponent.update())` after the shell’s `createReactiveComponent` mounts. See `soundclone/frontend/src/main.js`. Edits to files **not** in that list (e.g. some `components/`) can still cause a full reload until those paths are added or imports are restructured (e.g. `import.meta.glob`).

---

## References in tree

- `yamf/packages/client/src/dev-hmr.js` — `applyPatch` / `onReload`
- `yamf/packages/client/src/vite-plugin-yamf-dev.js` — `handleHotUpdate` → pub/sub
- `../../soundclone-deployment/soundclone/frontend/src/main.js` (repo root) — `connectYamfDevHmr` (gated by `VITE_YAMF_DEV_HMR === '1'`), and Vite `import.meta.hot.accept` for `pages/*`
