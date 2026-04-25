# Minimal YAMF + Vite (HMR)

Small **copy-paste** example: one bundled service (`minimal-api`) with a public route (`POST /api/ping`) and a **Vite** dev UI that proxies `/api` to the **gateway** so the browser does not need CORS.

**Full end-to-end app:** see `soundclone-deployment/` in this monorepo — not duplicated here.

## What you get

- `yamf build minimal-api` / `yamf deploy --local minimal-api` (or `yamf dev` to watch `src/`)
- Vite on port **5173** with HMR for `ui/`
- Gateway on **3000** (from `YAMF_GATEWAY_URL`); dev bootstrap registry on **20000** (from `YAMF_REGISTRY_URL`)

## Prereqs

From the **YAMF repo root** (`gitea/yamf/`), after adding this package to the workspace:

```bash
pnpm install
```

Use the workspace CLI, e.g. from repo root:

```bash
pnpm exec yamf --version
```

## Terminals (typical)

**Env (same in every terminal for this run):**

```bash
export YAMF_REGISTRY_URL=http://127.0.0.1:20000
export YAMF_GATEWAY_URL=http://127.0.0.1:3000
```

1. **Registry + pm3** (one process; includes deploy-router in dev if packages resolve):

   ```bash
   pnpm exec yamf init --dev
   ```

2. **Gateway** (separate process):

   ```bash
   cd examples/minimal-hmr && pnpm run gateway
   ```

3. **Build and deploy the API** once, or use watch:

   ```bash
   cd examples/minimal-hmr
   pnpm run build:api
   pnpm run deploy:local
   ```
   Or: `pnpm run dev:yamf` to watch and redeploy on `src/api-service.mjs` changes.

4. **Vite UI:**

   ```bash
   cd examples/minimal-hmr && pnpm run dev:ui
   ```
   (Vite config is `vite.config.js` at the package root; the UI files live in `ui/`.)

   Open the URL Vite prints (e.g. `http://127.0.0.1:5173/`) and check the JSON under **POST /api/ping**.

## Registry drain vs fixed ports in tests

If several processes use the **same** `YAMF_REGISTRY_URL` and port, a new `registryServer` startup can send `REGISTRY_DRAIN` to the peer. For local demos, keep one `yamf init --dev` and one port, or use a **unique** `YAMF_REGISTRY_URL` per run (as in the CLI `cli-build-deploy` test harness). See `yamf/docs/ROADMAP.md` (Deferred, gateway–registry continuity).

## Signed bundles (optional)

`yamf deploy` can use the Phase 4 signing flags / env as documented in `yamf/docs/ROADMAP.md` and `@yamf/core` deploy-bundle helpers. This example does not generate keys; enable signing only when you have followed that doc.

## Docker “remote from host”

A separate `examples/docker-remote-yamf` (or similar) is a good next step: registry + pm3 in Compose, `yamf deploy --remote` from the host. Not required for this minimal UI flow.
